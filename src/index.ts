import 'dotenv/config';
import { Fetcher } from './fetch/fetcher.js';
import { WorkQueue } from './queue/workqueue.js';
import { WsServer } from './ws/server.js';
import { FetchResult } from './types/fetch.js';

const fetcher = new Fetcher({
    maxRedirects: 5,
    maxFetchSize: 5 * 1024 * 1024, // 5MB
    allowedContentTypes: ['text/html', 'application/json', 'text/plain'],
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

const wsServer = new WsServer(
    { port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000 },
    queue,
);

wsServer.start();

process.on('SIGINT', () => {
    console.log('Shutting down...');
    wsServer.stop();
    process.exit(0);
});
