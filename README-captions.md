# YouTube Auto-Caption Extraction

This application supports extracting auto-generated captions from YouTube videos using yt-dlp, a powerful media downloader.

## Requirements

1. **yt-dlp** must be installed on your system.
   - For Windows: You can download it from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) or install with `pip install yt-dlp`
   - For macOS: Install via Homebrew with `brew install yt-dlp`
   - For Linux: Install via your package manager or with pip

2. **Node.js dependencies**:
   - The application uses the `yt-dlp-wrap` package which should be installed via:
   ```
   npm install yt-dlp-wrap --save
   ```

## How It Works

The application fetches captions using these methods:

1. Uses yt-dlp to download auto-generated captions in JSON3 format
2. Parses the JSON3 data to extract captions with timing information
3. If yt-dlp fails, falls back to using the youtube-captions-scraper package

The yt-dlp method is more reliable for getting auto-generated captions, which are often not available via the standard YouTube API.

## Caption Formats

The application supports two ways of accessing captions:

### 1. Full Caption Objects (with timing)

```javascript
import { fetchVideoCaptions } from "./services/youtube-service.js";

const captions = await fetchVideoCaptions("dQw4w9WgXcQ");
console.log(captions);
// Output: Array of objects with start, duration, and text
```

### 2. Text-Only Captions (without timing)

```javascript
import { fetchVideoTextOnly } from "./services/youtube-service.js";

const captionText = await fetchVideoTextOnly("dQw4w9WgXcQ");
console.log(captionText);
// Output: String containing all caption text concatenated
```

## Testing Captions

A test script is provided to verify caption extraction works correctly:

```
node test-captions.js
```

This will:
1. Fetch captions for a sample video 
2. Display sample captions with timing information
3. Extract and display text-only captions
4. Save both formats to files for inspection

## Integration with Analysis

The clean caption text is combined with video comments for analysis. This provides valuable context about the video content that might not be fully captured in the comments alone.

## Troubleshooting

If you encounter issues with caption extraction:

1. Make sure yt-dlp is installed and accessible in your PATH
2. Check if the video has auto-generated captions available
3. For non-English videos, you may need to modify the language parameter in the `fetchCaptionsWithYtDlp` function

## Technical Details

### JSON3 Format

The application uses yt-dlp's JSON3 caption format, which provides:
- Precise timing information
- Clean text segments
- Proper handling of line breaks and formatting

### Caption Object Format

Captions are returned in the following format:

```javascript
{
  start: 0,       // Start time in seconds
  dur: 3.5,       // Duration in seconds
  text: "Caption text without HTML formatting"
}
``` 