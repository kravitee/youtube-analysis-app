import amqplib from "amqplib";
import dotenv from "dotenv";

dotenv.config();

// RabbitMQ connection URL from environment variables
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

// Queue names
export const QUEUES = {
  VIDEO_ANALYSIS: "video_analysis_queue",
  ANALYSIS_RESULTS: "analysis_results_queue",
};

let connection = null;
let channel = null;

/**
 * Initialize RabbitMQ connection and channel
 * @returns {Promise<Object>} - The RabbitMQ channel
 */
export async function initializeRabbitMQ() {
  try {
    console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);

    // Create a connection
    connection = await amqplib.connect(RABBITMQ_URL);

    // Create a channel
    channel = await connection.createChannel();

    // Ensure queues exist
    await channel.assertQueue(QUEUES.VIDEO_ANALYSIS, {
      durable: true, // Queue survives broker restart
    });

    await channel.assertQueue(QUEUES.ANALYSIS_RESULTS, {
      durable: true, // Queue survives broker restart
    });

    console.log("RabbitMQ connection established successfully");

    // Setup graceful shutdown
    process.on("SIGINT", async () => {
      await closeRabbitMQ();
      process.exit(0);
    });

    return channel;
  } catch (error) {
    console.error("Failed to initialize RabbitMQ:", error);
    throw error;
  }
}

/**
 * Close RabbitMQ connection
 */
export async function closeRabbitMQ() {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    console.log("RabbitMQ connection closed");
  } catch (error) {
    console.error("Error closing RabbitMQ connection:", error);
  }
}

/**
 * Send a message to a queue
 * @param {string} queue - Queue name
 * @param {Object} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
export async function sendToQueue(queue, message) {
  try {
    if (!channel) {
      await initializeRabbitMQ();
    }

    const success = channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true, // Message survives broker restart
    });

    console.log(`Message sent to queue ${queue}: ${JSON.stringify(message).substring(0, 100)}...`);
    return success;
  } catch (error) {
    console.error(`Error sending message to queue ${queue}:`, error);
    throw error;
  }
}

/**
 * Consume messages from a queue
 * @param {string} queue - Queue name
 * @param {Function} callback - Function to process messages
 */
export async function consumeFromQueue(queue, callback) {
  try {
    if (!channel) {
      await initializeRabbitMQ();
    }

    console.log(`Starting to consume messages from queue: ${queue}`);

    await channel.consume(
      queue,
      async (msg) => {
        if (msg) {
          try {
            const content = JSON.parse(msg.content.toString());
            console.log(`Received message from queue ${queue}`);

            // Process the message
            await callback(content);

            // Acknowledge the message
            channel.ack(msg);
          } catch (error) {
            console.error(`Error processing message from queue ${queue}:`, error);
            // Reject the message and requeue it
            channel.nack(msg, false, true);
          }
        }
      },
      {
        noAck: false, // Manual acknowledgment
      }
    );
  } catch (error) {
    console.error(`Error consuming from queue ${queue}:`, error);
    throw error;
  }
}
