import 'dotenv/config';
import { Fetcher } from './fetch/fetcher.js';
import { WorkQueue } from './queue/workqueue.js';
import { WsServer } from './ws/server.js';
import { FetchResult } from './types/fetch.js';
import fs from 'node:fs';
import path from 'node:path';

const cacheDir = path.join(process.cwd(), 'public', 'cache');
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

if (!process.env.HOST) {
    console.error('Error: HOST environment variable is required');
    process.exit(1);
}

if (!process.env.PORT) {
    console.error('Error: PORT environment variable is required');
    process.exit(1);
}

const host = process.env.HOST;
const port = parseInt(process.env.PORT, 10);

const fetcher = new Fetcher({
    maxRedirects: 5,
    maxFetchSize: 5 * 1024 * 1024, // 5MB
    allowedContentTypes: [
        'text/html',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime',
    ],
    timeout: 10000,
});

const queue = new WorkQueue<string, FetchResult>(
    {
        maxJobs: 10,
        timeout: 15000,
    },
    async (url: string, signal: AbortSignal) => {
        return await fetcher.fetch(url, signal);
    },
);

const wsServer = new WsServer({ host, port }, queue);

wsServer.start();

process.on('SIGINT', () => {
    console.log('Shutting down...');
    wsServer.stop();
    process.exit(0);
});
