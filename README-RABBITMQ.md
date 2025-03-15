# YouTube Analysis App with RabbitMQ Integration

This document explains how the YouTube Analysis App has been enhanced with RabbitMQ to separate the YouTube service from the analysis service.

## Architecture Overview

The application now uses a message queue architecture with the following components:

1. **Web Server (index.js)**: Handles HTTP requests, fetches YouTube data, and enqueues analysis jobs
2. **Worker (worker.js)**: Consumes analysis jobs from the queue and processes them
3. **RabbitMQ**: Message broker that decouples the web server from the analysis process

## Benefits of This Architecture

- **Scalability**: Multiple workers can process jobs in parallel
- **Resilience**: If the analysis service crashes, the queue preserves jobs
- **Reduced CPU Load**: The web server remains responsive while intensive analysis happens elsewhere
- **Better User Experience**: Users get immediate feedback that their job is queued

## Prerequisites

- Node.js and npm
- RabbitMQ server installed and running

## RabbitMQ Installation

### Windows
1. Download and install RabbitMQ from the [official website](https://www.rabbitmq.com/download.html)
2. Install Erlang (required by RabbitMQ)
3. Start the RabbitMQ service

### macOS
```bash
brew update
brew install rabbitmq
brew services start rabbitmq
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install rabbitmq-server
sudo systemctl start rabbitmq-server
```

## Configuration

1. Add the RabbitMQ connection URL to your `.env` file:
```
RABBITMQ_URL=amqp://localhost
```

2. For production, use a proper RabbitMQ server URL with credentials:
```
RABBITMQ_URL=amqp://username:password@hostname:port
```

## Running the Application

### Option 1: Using the batch file (Windows)
```
start-all.bat
```

### Option 2: Manual start
In one terminal:
```
npm run start
```

In another terminal:
```
npm run worker
```

## How It Works

1. When a user submits a channel ID for analysis, the server:
   - Fetches videos and comments from YouTube
   - Creates a job with a unique ID
   - Sends the job to the RabbitMQ queue
   - Returns an immediate response to the user with the job ID

2. The worker:
   - Listens for jobs in the queue
   - Processes each job using the analysis service
   - Logs the results

## Future Enhancements

- Add a job status endpoint to check analysis progress
- Implement a results storage system (database)
- Create a notification system when analysis is complete
- Add more workers for parallel processing
- Implement job prioritization

## Troubleshooting

- **RabbitMQ Connection Issues**: Ensure RabbitMQ is running with `rabbitmqctl status`
- **Worker Not Processing**: Check worker logs for errors
- **Message Processing Failures**: Messages that fail processing are requeued automatically 