import { google } from "googleapis";
import { getSubtitles } from "youtube-captions-scraper";
import dotenv from "dotenv";
import ytDlpWrap from "yt-dlp-wrap";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

dotenv.config();

// Get directory name in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path for temporary files
const TEMP_DIR = path.join(os.tmpdir(), "youtube-analysis-app");

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const youtube = google.youtube({
  version: "v3",
  auth: process.env.YOUTUBE_API_KEY,
});

// Initialize yt-dlp
const YTDlpWrap = ytDlpWrap.default || ytDlpWrap;
const ytDlp = new YTDlpWrap();

/**
 * Fetches videos from a YouTube channel
 * @param {string} channelId - The YouTube channel ID
 * @returns {Promise<Array>} - List of video objects with ID, title, and other metadata
 */
export async function fetchChannelVideos(channelId) {
  try {
    // First, get the uploads playlist ID for the channel
    const channelResponse = await youtube.channels.list({
      id: channelId,
      part: "contentDetails",
    });

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      throw new Error("Channel not found");
    }

    const uploadsPlaylistId = channelResponse.data.items[0].contentDetails.relatedPlaylists.uploads;

    // Get videos from the uploads playlist
    const videosResponse = await youtube.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: "snippet,contentDetails",
      maxResults: 3, // Adjust as needed
    });

    if (!videosResponse.data.items) {
      return [];
    }

    // Return only the basic video information without fetching comments and captions
    const videos = videosResponse.data.items.map((item) => ({
      id: item.contentDetails.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      publishedAt: item.snippet.publishedAt,
      thumbnails: item.snippet.thumbnails,
    }));

    return videos;
  } catch (error) {
    console.error("Error fetching channel videos:", error);
    throw error;
  }
}

/**
 * Fetches detailed information for a single video including comments and captions
 * @param {Object} videoBasicInfo - Basic video information object
 * @returns {Promise<Object>} - Complete video object with comments and captions
 */
export async function fetchVideoDetails(videoBasicInfo) {
  try {
    const videoId = videoBasicInfo.id;
    console.log(`Fetching details for video: ${videoBasicInfo.title} (${videoId})`);

    const video = {
      ...videoBasicInfo,
      comments: [],
      captions: { captions: [], captionsText: "" },
    };

    // Fetch comments for the video
    try {
      video.comments = await fetchVideoComments(videoId);
      console.log(`Fetched ${video.comments.length} comments for video ${videoId}`);
    } catch (error) {
      console.warn(`Could not fetch comments for video ${videoId}: ${error.message}`);
    }

    // Fetch captions for the video
    try {
      video.captions = await fetchVideoCaptions(videoId);
      console.log(
        `Fetched captions for video ${videoId} (${video.captions.captionsText.length} chars)`
      );
    } catch (error) {
      console.warn(`Could not fetch captions for video ${videoId}: ${error.message}`);
    }

    return video;
  } catch (error) {
    console.error(`Error fetching details for video ${videoBasicInfo.id}:`, error);
    throw error;
  }
}

/**
 * Fetches comments for a YouTube video
 * @param {string} videoId - The YouTube video ID
 * @returns {Promise<Array>} - List of comment objects
 */
async function fetchVideoComments(videoId) {
  try {
    const commentsResponse = await youtube.commentThreads.list({
      videoId: videoId,
      part: "snippet",
      maxResults: 10, // Adjust as needed
    });

    if (!commentsResponse.data.items) {
      return [];
    }

    // Format the comment data
    return commentsResponse.data.items.map((item) => ({
      id: item.id,
      authorDisplayName: item.snippet.topLevelComment.snippet.authorDisplayName,
      authorProfileImageUrl: item.snippet.topLevelComment.snippet.authorProfileImageUrl,
      authorChannelUrl: item.snippet.topLevelComment.snippet.authorChannelUrl,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      likeCount: item.snippet.topLevelComment.snippet.likeCount,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (error) {
    console.error(`Error fetching comments for video ${videoId}:`, error);
    return [];
  }
}

/**
 * Fetches captions for a YouTube video
 * @param {string} videoId - The YouTube video ID
 * @returns {Promise<Array>} - List of caption objects
 */
export async function fetchVideoCaptions(videoId) {
  try {
    // First try to get captions using yt-dlp
    const ytDlpCaptions = await fetchCaptionsWithYtDlp(videoId);

    if (ytDlpCaptions && ytDlpCaptions.length > 0) {
      const captionsText = ytDlpCaptions
        .map((caption) => caption.text.trim())
        .filter((text) => text.length > 0)
        .join(" ")
        .replace(/\s+/g, " "); // Replace multiple spaces with a single space

      return { captions: ytDlpCaptions, captionsText };
    }

    // Fallback to youtube-captions-scraper if yt-dlp fails
    console.log(`Falling back to youtube-captions-scraper for video ${videoId}`);
    const captions = await getSubtitles({
      videoID: videoId,
      lang: "en", // Default to English, can be customized
    });

    const captionsText = captions
      .map((caption) => caption.text.trim())
      .filter((text) => text.length > 0)
      .join(" ")
      .replace(/\s+/g, " "); // Replace multiple spaces with a single space

    return { captions, captionsText };
  } catch (error) {
    console.error(`Error fetching captions for video ${videoId}:`, error);
    return { captions: [], captionsText: "" };
  }
}

/**
 * Fetches auto captions using yt-dlp
 * @param {string} videoId - The YouTube video ID
 * @returns {Promise<Array>} - List of caption objects with start, dur and text properties
 */
async function fetchCaptionsWithYtDlp(videoId) {
  try {
    // Create temp filenames
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const captionFile = path.join(TEMP_DIR, `${videoId}.en.json`);

    console.log(`Fetching captions for ${videoId} using yt-dlp...`);

    // Download auto-generated captions in JSON3 format
    await ytDlp.execPromise([
      videoUrl,
      "--skip-download",
      "--write-auto-sub",
      "--sub-format",
      "json3",
      "--sub-lang",
      "en",
      "-o",
      path.join(TEMP_DIR, videoId),
    ]);

    // Find the caption file - could be named differently
    const files = fs.readdirSync(TEMP_DIR);
    const captionFileName = files.find((f) => f.includes(videoId) && f.includes(".en.json"));

    if (!captionFileName) {
      console.log(`No caption file found for ${videoId}`);
      return [];
    }

    const captionFilePath = path.join(TEMP_DIR, captionFileName);

    // Parse JSON3 file into caption objects
    const jsonContent = fs.readFileSync(captionFilePath, "utf8");
    const captions = parseJson3ToCaptions(jsonContent);

    // Clean up temp file
    try {
      fs.unlinkSync(captionFilePath);
    } catch (e) {
      console.warn(`Couldn't delete temp file ${captionFilePath}:`, e);
    }

    return captions;
  } catch (error) {
    console.error(`Error fetching captions with yt-dlp for ${videoId}:`, error);
    return [];
  }
}

/**
 * Parse JSON3 content into caption objects
 * @param {string} jsonContent - JSON3 file content
 * @returns {Array} - List of caption objects
 */
function parseJson3ToCaptions(jsonContent) {
  try {
    const captionsData = JSON.parse(jsonContent);

    if (!captionsData || !captionsData.events) {
      return [];
    }

    const captions = [];

    // Process each caption event
    captionsData.events.forEach((event) => {
      // Skip events without text segments
      if (!event.segs || event.segs.length === 0) {
        return;
      }

      // Extract start time in seconds
      const start = event.tStartMs / 1000;

      // Calculate duration in seconds
      const duration = (event.dDurationMs || 0) / 1000;

      // Extract and concatenate all text segments
      const text = event.segs
        .map((seg) => seg.utf8)
        .join("")
        .trim();

      // Only add non-empty captions
      if (text) {
        captions.push({
          start: start,
          dur: duration,
          text: text,
        });
      }
    });

    return captions;
  } catch (error) {
    console.error("Error parsing JSON3 captions:", error);
    return [];
  }
}

/**
 * Fetches caption text only (without timing information) for a YouTube video
 * @param {string} videoId - The YouTube video ID
 * @returns {Promise<string>} - Caption text as a single string
 */
export async function fetchVideoTextOnly(videoId) {
  try {
    const result = await fetchVideoCaptions(videoId);
    // Simply return the captionsText property that's already extracted
    return result.captionsText || "";
  } catch (error) {
    console.error(`Error fetching text-only captions for ${videoId}:`, error);
    return "";
  }
}
