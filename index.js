import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { fetchChannelVideos, fetchVideoDetails } from "./services/youtube-service.js";
import {
  initializeRabbitMQ,
  sendToQueue,
  consumeFromQueue,
  QUEUES,
} from "./services/rabbitmq-service.js";

// Initialize environment variables
dotenv.config();

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, "public")));

// Initialize RabbitMQ when the server starts
let rabbitInitialized = false;

// Simple in-memory job tracking (would use a database in production)
const jobData = {};

async function ensureRabbitMQInitialized() {
  if (!rabbitInitialized) {
    await initializeRabbitMQ();
    rabbitInitialized = true;
  }
}

/**
 * Process messages from the results queue
 * @param {Object} message - The message from the results queue
 */
async function processResultsMessage(message) {
  try {
    const { type, jobId, videoId } = message;

    if (!jobId || !jobData[jobId]) {
      console.warn(`Received message for unknown job: ${jobId}`);
      return;
    }

    // Initialize videos object if it doesn't exist
    if (!jobData[jobId].videos) {
      jobData[jobId].videos = {};
    }

    if (type === "status_update") {
      // Update individual video status
      if (!jobData[jobId].videos[videoId]) {
        jobData[jobId].videos[videoId] = {
          id: videoId,
          status: message.status,
          lastUpdated: message.timestamp,
        };
      } else {
        // Update existing video record
        jobData[jobId].videos[videoId] = {
          ...jobData[jobId].videos[videoId],
          status: message.status,
          lastUpdated: message.timestamp,
          error: message.error,
        };
      }

      // Update overall job status based on video statuses
      updateJobStats(jobId);

      console.log(`Updated status for video ${videoId} in job ${jobId} to ${message.status}`);
      console.log(
        `Overall job status: ${jobData[jobId].status} (${jobData[jobId].completedVideos}/${
          Object.keys(jobData[jobId].videos).length
        } completed)`
      );
    } else if (type === "video_results") {
      // Store video analysis results
      if (!jobData[jobId].videos[videoId]) {
        jobData[jobId].videos[videoId] = {
          id: videoId,
          status: "completed",
          lastUpdated: message.timestamp,
          results: message.results,
          completedAt: message.timestamp,
        };
      } else {
        // Update existing video record with results
        jobData[jobId].videos[videoId] = {
          ...jobData[jobId].videos[videoId],
          status: "completed",
          lastUpdated: message.timestamp,
          results: message.results,
          completedAt: message.timestamp,
        };
      }

      // Update overall job status
      updateJobStats(jobId);

      console.log(`Stored results for video ${videoId} in job ${jobId}`);
      console.log(
        `Job status: ${jobData[jobId].completedVideos}/${jobData[jobId].totalVideos} videos completed`
      );
    }
  } catch (error) {
    console.error("Error processing results message:", error);
  }
}

/**
 * Update job statistics based on video statuses
 * @param {string} jobId - The job ID to update
 */
function updateJobStats(jobId) {
  const job = jobData[jobId];
  const videos = Object.values(job.videos || {});

  // Count videos by status
  const failedCount = videos.filter((v) => v.status === "failed").length;
  const completedCount = videos.filter((v) => v.status === "completed").length;
  const processingCount = videos.filter((v) => v.status === "processing").length;

  // Determine overall status
  let overallStatus = "processing";
  if (failedCount === videos.length) {
    overallStatus = "failed";
  } else if (completedCount === videos.length) {
    overallStatus = "completed";
  } else if (completedCount > 0 && processingCount === 0) {
    overallStatus = "partially_completed";
  }

  // Collect all completed results for convenience
  const results = Object.entries(job.videos || {})
    .filter(([_, video]) => video.status === "completed" && video.results)
    .map(([videoId, video]) => ({
      videoId,
      title: video.title,
      results: video.results,
    }));

  // Update job stats
  jobData[jobId] = {
    ...jobData[jobId],
    status: overallStatus,
    lastUpdated: new Date().toISOString(),
    processedVideos: videos.length,
    completedVideos: completedCount,
    failedVideos: failedCount,
    results: results,
  };
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.post("/analyze", async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "Channel ID is required" });
    }

    // Ensure RabbitMQ is initialized
    await ensureRabbitMQInitialized();

    // Create a job ID
    const jobId = `job-${Date.now()}`;

    // Start by fetching basic info for all videos
    console.log(`Fetching basic video info for channel: ${channelId}`);
    const videoBasicInfoList = await fetchChannelVideos(channelId);

    if (videoBasicInfoList.length === 0) {
      return res.status(404).json({
        error: "No videos found",
        message: "Could not find any videos for the specified channel ID",
      });
    }

    // Initialize job status
    jobData[jobId] = {
      status: "initializing",
      channelId,
      totalVideos: videoBasicInfoList.length,
      timestamp: new Date().toISOString(),
      completedVideos: 0,
      failedVideos: 0,
      estimatedCompletionTime: new Date(
        Date.now() + videoBasicInfoList.length * 120000
      ).toISOString(), // Rough estimate: 2 minutes per video
    };

    jobData[jobId].videos = {};

    // Return an immediate response indicating the job was created
    const response = {
      status: "initializing",
      jobId,
      message: `Analysis job for ${videoBasicInfoList.length} videos has been created`,
      videoCount: videoBasicInfoList.length,
      estimatedTime: `${Math.ceil(videoBasicInfoList.length * 2)} minutes`, // Rough estimate
      checkStatusUrl: `/job-status/${jobId}`,
    };

    // Send response to client immediately, but continue processing
    res.json(response);

    // Process each video one by one (after sending response)
    console.log(`Starting to process ${videoBasicInfoList.length} videos one by one...`);

    // Use a for loop instead of Promise.all to process in sequence
    for (let i = 0; i < videoBasicInfoList.length; i++) {
      const videoBasicInfo = videoBasicInfoList[i];

      try {
        // Update job status
        jobData[jobId].status = "processing";

        // Fetch full details for this video (comments, captions, etc.)
        const videoDetails = await fetchVideoDetails(videoBasicInfo);

        // Send this video to the queue
        await sendToQueue(QUEUES.VIDEO_ANALYSIS, {
          jobId,
          channelId,
          video: videoDetails,
          timestamp: new Date().toISOString(),
        });

        console.log(
          `Sent video ${i + 1}/${videoBasicInfoList.length} to queue: ${videoDetails.title}`
        );

        // Initialize the video status
        jobData[jobId].videos[videoDetails.id] = {
          status: "queued",
          title: videoDetails.title,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error(`Error processing video ${videoBasicInfo.id}:`, error);

        // Mark this video as failed
        jobData[jobId].videos[videoBasicInfo.id] = {
          status: "failed",
          title: videoBasicInfo.title,
          error: error.message,
          timestamp: new Date().toISOString(),
        };

        jobData[jobId].failedVideos++;
      }
    }

    // Update job status after all videos have been queued
    jobData[jobId].status = "queued";
    jobData[jobId].lastUpdated = new Date().toISOString();

    console.log(`All ${videoBasicInfoList.length} videos have been queued for job ${jobId}`);
  } catch (error) {
    console.error("Error in analysis:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Job status endpoint
app.get("/job-status/:jobId", (req, res) => {
  const { jobId } = req.params;

  // Check if job exists in our tracking
  if (jobData[jobId]) {
    return res.json({
      jobId,
      ...jobData[jobId],
      videos: jobData[jobId].videos || {},
    });
  }

  // If job not found
  return res.status(404).json({
    error: "Job not found",
    message: "The requested job ID does not exist or has expired",
  });
});

// Results endpoint - get the results of a completed job
app.get("/job-results/:jobId", (req, res) => {
  const { jobId } = req.params;

  // Check if job exists and has results
  if (
    jobData[jobId] &&
    (jobData[jobId].status === "completed" || jobData[jobId].status === "partially_completed") &&
    jobData[jobId].results &&
    jobData[jobId].results.length > 0
  ) {
    return res.json({
      jobId,
      status: jobData[jobId].status,
      totalVideos: jobData[jobId].totalVideos,
      completedVideos: jobData[jobId].completedVideos,
      failedVideos: jobData[jobId].failedVideos,
      results: jobData[jobId].results, // This now contains an array of objects with videoId, title, and results
    });
  }

  // If job not found
  if (!jobData[jobId]) {
    return res.status(404).json({
      error: "Job not found",
      message: "The requested job ID does not exist or has expired",
    });
  }

  // If job is still in progress
  return res.json({
    jobId,
    status: jobData[jobId].status,
    totalVideos: jobData[jobId].totalVideos,
    completedVideos: jobData[jobId].completedVideos || 0,
    failedVideos: jobData[jobId].failedVideos || 0,
    message: "Analysis is still in progress, check back later",
    videos: jobData[jobId].videos || {},
  });
});

// Start the server
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("To analyze your YouTube channel, open this URL in your browser");

  // Initialize RabbitMQ when the server starts
  try {
    await ensureRabbitMQInitialized();
    console.log("RabbitMQ initialized successfully");

    // Start consuming messages from the results queue
    await consumeFromQueue(QUEUES.ANALYSIS_RESULTS, processResultsMessage);
    console.log("Listening for analysis results...");
  } catch (error) {
    console.error("Failed to initialize RabbitMQ:", error);
    console.log("Server will continue running, but message queuing will not be available");
  }
});
