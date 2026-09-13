const IORedis = require('ioredis');
const { Queue } = require('bullmq');

/**
 * Shared Redis connection and BullMQ queue for the gateway.
 * Centralises the connection config so it is defined in one place only.
 */
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

const ingestQueue = new Queue('ingestion', { connection });

module.exports = { connection, ingestQueue };
