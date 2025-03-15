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
const jobStatuses = {};

// Track videos per job
const jobVideos = {};

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

    if (!jobId || !jobStatuses[jobId]) {
      console.warn(`Received message for unknown job: ${jobId}`);
      return;
    }

    if (type === "status_update") {
      // Update individual video status
      if (!jobVideos[jobId]) {
        jobVideos[jobId] = {};
      }

      jobVideos[jobId][videoId] = {
        status: message.status,
        lastUpdated: message.timestamp,
        error: message.error,
      };

      // Update overall job status
      const videoStatuses = Object.values(jobVideos[jobId]);
      const failedCount = videoStatuses.filter((v) => v.status === "failed").length;
      const completedCount = videoStatuses.filter((v) => v.status === "completed").length;
      const processingCount = videoStatuses.filter((v) => v.status === "processing").length;

      let overallStatus = "processing";
      if (failedCount === videoStatuses.length) {
        overallStatus = "failed";
      } else if (completedCount === videoStatuses.length) {
        overallStatus = "completed";
      } else if (completedCount > 0 && processingCount === 0) {
        overallStatus = "partially_completed";
      }

      jobStatuses[jobId] = {
        ...jobStatuses[jobId],
        status: overallStatus,
        lastUpdated: message.timestamp,
        processedVideos: videoStatuses.length,
        completedVideos: completedCount,
        failedVideos: failedCount,
      };

      console.log(`Updated status for video ${videoId} in job ${jobId} to ${message.status}`);
      console.log(
        `Overall job status: ${overallStatus} (${completedCount}/${videoStatuses.length} completed)`
      );
    } else if (type === "video_results") {
      // Store video analysis results
      if (!jobVideos[jobId]) {
        jobVideos[jobId] = {};
      }

      jobVideos[jobId][videoId] = {
        status: "completed",
        lastUpdated: message.timestamp,
        results: message.results,
        completedAt: message.timestamp,
      };

      // Update overall job results and status
      const videoStatuses = Object.values(jobVideos[jobId]);
      const completedCount = videoStatuses.filter((v) => v.status === "completed").length;
      const totalVideos = jobStatuses[jobId].totalVideos || 0;

      // Collect all completed results
      const allResults = Object.entries(jobVideos[jobId])
        .filter(([_, data]) => data.status === "completed" && data.results)
        .map(([videoId, data]) => ({
          videoId,
          results: data.results,
        }));

      let overallStatus = "processing";
      if (completedCount === totalVideos) {
        overallStatus = "completed";
      } else if (completedCount > 0) {
        overallStatus = "partially_completed";
      }

      jobStatuses[jobId] = {
        ...jobStatuses[jobId],
        status: overallStatus,
        lastUpdated: message.timestamp,
        processedVideos: videoStatuses.length,
        completedVideos: completedCount,
        results: allResults,
      };

      console.log(`Stored results for video ${videoId} in job ${jobId}`);
      console.log(`Job status: ${completedCount}/${totalVideos} videos completed`);
    }
  } catch (error) {
    console.error("Error processing results message:", error);
  }
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
    jobStatuses[jobId] = {
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

    jobVideos[jobId] = {};

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
        console.log(
          `Fetching details for video ${i + 1}/${videoBasicInfoList.length}: ${
            videoBasicInfo.title
          }`
        );

        // Update job status
        jobStatuses[jobId].status = "processing";
        jobStatuses[jobId].currentVideo = {
          index: i + 1,
          id: videoBasicInfo.id,
          title: videoBasicInfo.title,
        };

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
        jobVideos[jobId][videoDetails.id] = {
          status: "queued",
          title: videoDetails.title,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error(`Error processing video ${videoBasicInfo.id}:`, error);

        // Mark this video as failed
        jobVideos[jobId][videoBasicInfo.id] = {
          status: "failed",
          title: videoBasicInfo.title,
          error: error.message,
          timestamp: new Date().toISOString(),
        };

        jobStatuses[jobId].failedVideos++;
      }
    }

    // Update job status after all videos have been queued
    jobStatuses[jobId].status = "queued";
    jobStatuses[jobId].lastUpdated = new Date().toISOString();

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
  if (jobStatuses[jobId]) {
    return res.json({
      jobId,
      ...jobStatuses[jobId],
      videos: jobVideos[jobId] || {},
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

  // Check if job exists and is completed
  if (
    jobStatuses[jobId] &&
    (jobStatuses[jobId].status === "completed" ||
      jobStatuses[jobId].status === "partially_completed") &&
    jobStatuses[jobId].results
  ) {
    return res.json({
      jobId,
      status: jobStatuses[jobId].status,
      totalVideos: jobStatuses[jobId].totalVideos,
      completedVideos: jobStatuses[jobId].completedVideos,
      failedVideos: jobStatuses[jobId].failedVideos,
      results: jobStatuses[jobId].results,
    });
  }

  // If job not found
  if (!jobStatuses[jobId]) {
    return res.status(404).json({
      error: "Job not found",
      message: "The requested job ID does not exist or has expired",
    });
  }

  // If job is still in progress
  return res.json({
    jobId,
    status: jobStatuses[jobId].status,
    totalVideos: jobStatuses[jobId].totalVideos,
    completedVideos: jobStatuses[jobId].completedVideos || 0,
    failedVideos: jobStatuses[jobId].failedVideos || 0,
    message: "Analysis is still in progress, check back later",
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
