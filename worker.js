import dotenv from "dotenv";
import {
  consumeFromQueue,
  sendToQueue,
  QUEUES,
  initializeRabbitMQ,
} from "./services/rabbitmq-service.js";
import { analyzeComments } from "./services/analysis-service.js";

// Initialize environment variables
dotenv.config();

/**
 * Process a single video analysis job
 * @param {Object} message - The message containing a single video data
 */
async function processVideoAnalysis(message) {
  try {
    const { jobId, channelId, video } = message;
    console.log(`Starting analysis for job ${jobId} video: ${video.title}`);

    // Update job status to processing
    await sendJobStatusUpdate(jobId, channelId, "processing", video.id, null);

    // Process the single video analysis using the existing analysis service
    const startTime = Date.now();
    const analysis = await analyzeComments(video); // Pass video directly without wrapping in array
    const processingTime = Date.now() - startTime;

    // Log the completion
    console.log(
      `Analysis completed for job ${jobId} video: ${video.title} in ${formatTime(processingTime)}`
    );

    // Send the results to the results queue
    await sendVideoResults(jobId, channelId, video.id, analysis);

    return analysis;
  } catch (error) {
    console.error("Error processing video analysis:", error);

    // Update job status to failed
    if (message && message.jobId && message.video) {
      try {
        await sendJobStatusUpdate(
          message.jobId,
          message.channelId,
          "failed",
          message.video.id,
          error.message
        );
        console.log(`Job ${message.jobId} marked as failed and will be removed from queue`);
      } catch (statusError) {
        console.error("Failed to update job status:", statusError);
      }
    }

    // Return a value instead of throwing, so the message will be acknowledged and removed from the queue
    return {
      error: true,
      message: error.message,
      jobId: message?.jobId,
      videoId: message?.video?.id,
    };
  }
}

/**
 * Send job status update to the results queue
 * @param {string} jobId - The job ID
 * @param {string} channelId - The YouTube channel ID
 * @param {string} status - The job status
 * @param {string} videoId - The video ID
 * @param {string|null} error - Error message if any
 */
async function sendJobStatusUpdate(jobId, channelId, status, videoId, error) {
  try {
    await sendToQueue(QUEUES.ANALYSIS_RESULTS, {
      type: "status_update",
      jobId,
      channelId,
      videoId,
      status,
      timestamp: new Date().toISOString(),
      error,
    });
    console.log(`Video ${videoId} status updated to ${status}`);
  } catch (err) {
    console.error(`Failed to send status update for video ${videoId}:`, err);
  }
}

/**
 * Send job results to the results queue
 * @param {string} jobId - The job ID
 * @param {string} channelId - The YouTube channel ID
 * @param {string} videoId - The video ID
 * @param {Object} analysis - The analysis results
 */
async function sendVideoResults(jobId, channelId, videoId, analysis) {
  try {
    await sendToQueue(QUEUES.ANALYSIS_RESULTS, {
      type: "video_results",
      jobId,
      channelId,
      videoId,
      timestamp: new Date().toISOString(),
      results: analysis,
    });
    console.log(`Results for video ${videoId} sent to results queue`);
  } catch (err) {
    console.error(`Failed to send results for video ${videoId}:`, err);
  }
}

/**
 * Format time duration in a human-readable format
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} - Formatted time string
 */
function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Main worker function
 */
async function startWorker() {
  try {
    console.log("Starting YouTube analysis worker...");

    // Initialize RabbitMQ
    const channel = await initializeRabbitMQ();

    // Start consuming messages from the video analysis queue
    await consumeFromQueue(QUEUES.VIDEO_ANALYSIS, processVideoAnalysis);

    console.log("Worker is running and waiting for messages...");
  } catch (error) {
    console.error("Worker failed to start:", error);
    process.exit(1);
  }
}

// Start the worker
startWorker();
