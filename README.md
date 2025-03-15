# YouTube Channel Analysis Application

This Node.js application analyzes YouTube video captions and comments from your channel using the YouTube API v3 and DeepSeek API for natural language processing. It now features a RabbitMQ integration to separate the YouTube service from the analysis service.

## Features

- Fetch video data from your YouTube channel
- Extract video captions and comments
- Analyze comment sentiment and topics
- Generate content improvement suggestions
- Provide channel-level growth strategies
- **NEW**: Asynchronous processing with RabbitMQ message queue

## Prerequisites

- Node.js 18.x or higher
- YouTube API v3 key
- DeepSeek API key
- RabbitMQ server (new requirement)

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

4. Set up your API keys:
   - Edit the `.env` file in the project root
   - Add your YouTube API key, DeepSeek API key, and RabbitMQ URL

```
# YouTube API credentials
YOUTUBE_API_KEY=your_youtube_api_key_here

# DeepSeek API credentials
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# Port for the application
PORT=3000

# RabbitMQ connection URL
RABBITMQ_URL=amqp://localhost
```

## How to Get API Keys

### YouTube API Key
1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the YouTube Data API v3
4. Create credentials (API Key)
5. Restrict the API key to YouTube Data API v3

### DeepSeek API Key
1. Sign up for a DeepSeek account at [DeepSeek's website](https://deepseek.com/)
2. Navigate to your account dashboard
3. Request or generate an API key

## Running the Application

### Option 1: Using the batch file (Windows)
```
start-all.bat
```

### Option 2: Manual start
Start the main server:

```bash
npm start
```

Start the worker in a separate terminal:

```bash
npm run worker
```

Open your browser and navigate to:

```
http://localhost:3000
```

## Architecture

The application now uses a message queue architecture:

1. **Web Server**: Handles HTTP requests, fetches YouTube data, and enqueues analysis jobs
2. **Worker**: Consumes analysis jobs from the queue and processes them
3. **RabbitMQ**: Message broker that decouples the web server from the analysis process

For more details on the RabbitMQ integration, see [README-RABBITMQ.md](README-RABBITMQ.md).

## Using the Application

1. Enter your YouTube Channel ID
   - You can find your channel ID by going to your YouTube channel page
   - Click "About" then find the "Share" option
   - Your channel ID starts with "UC..."

2. Click "Analyze Channel" to start the analysis
   - You'll receive immediate feedback that your job is queued
   - The worker will process the analysis in the background

3. View the results
   - Overall channel analysis
   - Per-video analysis with sentiment and suggestions
   - Content improvement recommendations

## Limitations

- The YouTube API has quota limitations
- By default, only the top 100 comments from each video are analyzed
- Only English comments and captions are fully supported
- You need to have RabbitMQ installed and running

## Troubleshooting

If you encounter issues:

- Check that your API keys are correct in the .env file
- Ensure your YouTube Channel ID is correct
- Check console logs for any error messages
- Make sure your YouTube API quota hasn't been exceeded
- Verify that RabbitMQ is running with `rabbitmqctl status`

## License

This project is licensed under the MIT License - see the LICENSE file for details.
