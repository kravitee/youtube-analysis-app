import axios from "axios";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1";

// Initialize OpenAI client with DeepSeek configuration
const deepseekClient = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_API_URL,
});

/**
 * Utility function to format time duration in a human-readable format
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
 * Analyzes video comments and captions to generate insights
 * @param {Object} video - A video object with comments and captions
 * @returns {Promise<Object>} - Analysis results and suggestions
 */
export async function analyzeComments(video) {
  try {
    const startTime = Date.now();

    // Log the start of analysis
    console.log(`Starting analysis for video: ${video.title}`);

    // Skip video with no comments
    if (!video.comments || video.comments.length === 0) {
      console.log(`Skipped video (no comments available)`);
      return {
        videoId: video.id,
        title: video.title,
        analysis: "No comments available for analysis",
        suggestions: [],
      };
    }

    // Extract useful information from the video
    const videoData = {
      id: video.id,
      title: video.title,
      commentCount: video.comments.length,
      comments: video.comments.map((c) => c.text).join("\n"),
      // Use the text-only captions directly from the fetchVideoCaptions result
      captionsText: video.captions.captionsText || "",
    };

    // Analyze using DeepSeek API
    console.log(
      `Processing video: Analyzing ${videoData.commentCount} comments and ${videoData.captionsText.length} characters of captions`
    );
    const analysis = await analyzeWithDeepSeek(videoData);

    const videoAnalysis = {
      videoId: video.id,
      title: video.title,
      commentCount: video.comments.length,
      analysis: analysis.summary,
      sentimentScore: analysis.sentiment_score,
      topTopics: analysis.top_5_topics,
      suggestions: analysis.suggestions_for_improvement,
    };

    const videoTime = Date.now() - startTime;
    console.log(`Completed analysis of video in ${formatTime(videoTime)}`);

    return videoAnalysis;
  } catch (error) {
    console.error("Error in comment analysis:", error);
    throw error;
  }
}

/**
 * Uses DeepSeek API to analyze video data
 * @param {Object} videoData - Video data including comments and captions
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeWithDeepSeek(videoData) {
  try {
    console.log(`Building analysis prompt for video: ${videoData.title} (ID: ${videoData.id})`);
    const prompt = buildAnalysisPrompt(videoData);
    console.log(`Prompt built, sending to DeepSeek API (${prompt.length} characters)`);

    const response = await deepseekClient.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "You are an expert YouTube content analyst. Your task is to analyze video comments, provide insights, and suggest improvements to help content creators optimize their videos.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    console.log(`Received response from DeepSeek API for video: ${videoData.title}`);

    // Parse the response to extract structured data
    console.log("Parsing analysis response...");
    const parsedResponse = parseAnalysisResponse(response.choices[0].message.content);
    console.log(`Analysis complete for video: ${videoData.title}`);

    return parsedResponse;
  } catch (error) {
    console.error(`Error calling DeepSeek API for video ${videoData.id}:`, error.message);
    return {
      summary: "Failed to analyze with DeepSeek API",
      sentiment_score: 0,
      top_5_topics: [],
      suggestions_for_improvement: ["Check API key and try again"],
    };
  }
}

/**
 * Ensures a prompt doesn't exceed the maximum allowed length
 * @param {string} prompt - The prompt to truncate
 * @param {number} maxLength - Maximum length in characters (default: 65500)
 * @returns {string} - Truncated prompt
 */
function truncatePrompt(prompt, maxLength = 65500) {
  if (prompt.length <= maxLength) return prompt;

  // If too long, cut the prompt and add a note about truncation
  const truncationNote = "\n\n[Note: Content has been truncated due to length limits]";
  return prompt.slice(0, maxLength - truncationNote.length) + truncationNote;
}

/**
 * Builds the prompt for DeepSeek analysis
 * @param {Object} videoData - Video data
 * @returns {string} - Formatted prompt
 */
function buildAnalysisPrompt(videoData) {
  // Calculate available space for comments and captions
  const basePromptText = `
Analyze the following YouTube video comments and provide insights:

Video Title: ${videoData.title}
Video ID: ${videoData.id}
Number of Comments: ${videoData.commentCount}

COMMENTS:
[comments_placeholder]

${videoData.captionsText ? `CAPTIONS:\n[captions_placeholder]` : ""}

Please provide a structured JSON response with the following:
1. A summary of the overall sentiment and main topics
2. A sentiment score from -1 (very negative) to 1 (very positive)
3. Top 5 topics or themes mentioned
4. Specific suggestions for improving content based on feedback
5. Any notable criticisms or praises
`;

  // Replace placeholders with actual content, allocating space proportionally
  const maxPromptLength = 65500;
  const baseLength =
    basePromptText.length -
    "[comments_placeholder]".length -
    (videoData.captionsText ? "[captions_placeholder]".length : 0);

  // Reserve space for the base prompt structure
  const availableSpace = maxPromptLength - baseLength;

  let commentsText, captionsText;
  if (videoData.captionsText) {
    // If we have captions, allocate 80% to comments, 20% to captions
    const commentsLength = Math.floor(availableSpace * 0.8);
    const captionsLength = availableSpace - commentsLength;

    commentsText = videoData.comments.slice(0, commentsLength);
    captionsText = videoData.captionsText.slice(0, captionsLength);
  } else {
    // If no captions, allocate all space to comments
    commentsText = videoData.comments.slice(0, availableSpace);
    captionsText = "";
  }

  // Construct the final prompt - fix the replacement to avoid overriding
  // First create a copy of the base prompt text
  let prompt = basePromptText;

  // Replace each placeholder separately
  prompt = prompt.replace("[comments_placeholder]", commentsText);
  prompt = prompt.replace("[captions_placeholder]", captionsText);

  return prompt;
}

/**
 * Parses the DeepSeek API response to extract structured data
 * @param {string} responseText - Raw API response
 * @returns {Object} - Structured analysis data
 */
function parseAnalysisResponse(responseText) {
  try {
    // Try to find and parse JSON in the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // Fallback to simple parsing if no JSON found
    return {
      summary: responseText.slice(0, 500),
      sentiment_score: extractSentimentScore(responseText),
      top_5_topics: extractTopics(responseText),
      suggestions_for_improvement: extractSuggestions(responseText),
    };
  } catch (error) {
    console.error("Error parsing analysis response:", error);
    return {
      summary: responseText.slice(0, 500),
      sentimentScore: 0,
      topTopics: [],
      suggestions: ["Could not parse structured insights"],
    };
  }
}

/**
 * Extracts sentiment score from text response
 */
function extractSentimentScore(text) {
  const sentimentMatch = text.match(/sentiment.*?(-?\d+(\.\d+)?)/i);
  return sentimentMatch ? parseFloat(sentimentMatch[1]) : 0;
}

/**
 * Extracts topics from text response
 */
function extractTopics(text) {
  const topicsSection = text.match(/topics?:.*?(\\n\\n|$)/is);
  if (!topicsSection) return [];

  const topics = topicsSection[0].match(/[\\n-][^\\n-].*?(?=\\n|$)/g);
  return topics
    ? topics
        .map((t) => t.replace(/^[\\n-\s]+/, "").trim())
        .filter((t) => t.length > 0)
        .slice(0, 5)
    : [];
}

/**
 * Extracts suggestions from text response
 */
function extractSuggestions(text) {
  const suggestionsSection = text.match(/suggestions?:.*?(\\n\\n|$)/is);
  if (!suggestionsSection) return [];

  const suggestions = suggestionsSection[0].match(/[\\n-][^\\n-].*?(?=\\n|$)/g);
  return suggestions
    ? suggestions.map((s) => s.replace(/^[\\n-\s]+/, "").trim()).filter((s) => s.length > 0)
    : [];
}

/**
 * Extracts text-only content from captions
 * @param {Array} captions - Array of caption objects
 * @returns {string} - Concatenated caption text
 */
function extractCaptionText(captions) {
  if (!captions || captions.length === 0) {
    return "";
  }

  return captions
    .map((caption) => caption.text || caption.part || "")
    .filter((text) => text.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
