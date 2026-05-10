import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WsServer } from './server.js';
import { WorkQueue } from '../queue/workqueue.js';
import { FetchResult } from '../types/fetch.js';
import { IWsEnvelope, IncomingWsEvent } from '../types/ws.js';
import { SilentLogger } from './logger.js';

interface ParsedResponse<TPayload = Record<string, unknown>> {
    id: string;
    event: { type: string; payload: TPayload };
    meta?: { replyTo?: string; ts?: number };
}

describe('WsServer', () => {
    let wsServer: WsServer;
    let mockQueue: { enqueue: ReturnType<typeof vi.fn> };
    let clientWs: WebSocket;

    beforeEach(async () => {
        mockQueue = { enqueue: vi.fn() };

        wsServer = new WsServer(
            { port: 0, logger: new SilentLogger() },
            mockQueue as unknown as WorkQueue<string, FetchResult>,
        );
        wsServer.start();

        const wss = (wsServer as unknown as { wss: WebSocketServer }).wss;
        const { port } = wss.address() as { port: number };

        clientWs = new WebSocket(`ws://localhost:${port}`);
        await new Promise<void>((resolve) => {
            clientWs.on('open', resolve);
        });
    });

    afterEach(() => {
        clientWs.close();
        wsServer.stop();
        vi.clearAllMocks();
    });

    const sendRequest = async <TPayload = Record<string, unknown>>(
        event: IncomingWsEvent,
    ): Promise<ParsedResponse<TPayload>> => {
        const envelope: IWsEnvelope<IncomingWsEvent> = { id: 'test-id-123', event };
        return new Promise((resolve) => {
            clientWs.once('message', (data) => {
                resolve(JSON.parse(data.toString()));
            });
            clientWs.send(JSON.stringify(envelope));
        });
    };

    it('should handle a successful scrape job', async () => {
        const mockFetchResult: FetchResult = {
            ok: true,
            url: 'https://example.com',
            size: 100,
            contentType: 'text/html',
            mimeType: 'text/html',
            data: Buffer.from('hello'),
        };
        mockQueue.enqueue.mockResolvedValueOnce(mockFetchResult);

        const response = await sendRequest<FetchResult>({
            type: 'scrape',
            payload: { url: 'https://example.com' },
        });

        expect(mockQueue.enqueue).toHaveBeenCalledWith('https://example.com');
        expect(response.meta?.replyTo).toBe('test-id-123');
        expect(response.event.type).toBe('JobSuccess');
        expect(response.event.payload.ok).toBe(true);
        if (response.event.payload.ok) {
            expect(response.event.payload.url).toBe('https://example.com');
        }
    });

    it('should handle a job failure from the queue', async () => {
        mockQueue.enqueue.mockRejectedValueOnce(new Error('Queue full'));

        const response = await sendRequest<{ reason: string }>({
            type: 'scrape',
            payload: { url: 'https://example.com' },
        });

        expect(mockQueue.enqueue).toHaveBeenCalledWith('https://example.com');
        expect(response.meta?.replyTo).toBe('test-id-123');
        expect(response.event.type).toBe('JobFailure');
        expect(response.event.payload.reason).toBe('Queue full');
    });

    it('should return JobFailure when the scrape URL is missing', async () => {
        const response = await sendRequest<{ reason: string }>({
            type: 'scrape',
            payload: { url: '' },
        });

        expect(mockQueue.enqueue).not.toHaveBeenCalled();
        expect(response.event.type).toBe('JobFailure');
        expect(response.event.payload.reason).toContain('Missing URL');
    });

    it('should respond to ping with pong', async () => {
        const response = await sendRequest<null>({ type: 'ping', payload: null });

        expect(response.meta?.replyTo).toBe('test-id-123');
        expect(response.event.type).toBe('pong');
        expect(response.event.payload).toBeNull();
    });

    it('should return JobFailure for an unknown event type', async () => {
        const response = await sendRequest<{ reason: string }>({
            type: 'unknown_event',
            payload: null,
        } as unknown as IncomingWsEvent);

        expect(mockQueue.enqueue).not.toHaveBeenCalled();
        expect(response.event.type).toBe('JobFailure');
        expect(response.event.payload.reason).toContain('unknown_event');
    });

    it('should call the injected logger on connection events', async () => {
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        const server2 = new WsServer(
            { port: 0, logger },
            mockQueue as unknown as WorkQueue<string, FetchResult>,
        );
        server2.start();

        const wss2 = (server2 as unknown as { wss: WebSocketServer }).wss;
        const { port } = wss2.address() as { port: number };

        const client2 = new WebSocket(`ws://localhost:${port}`);
        await new Promise<void>((resolve) => {
            client2.on('open', resolve);
        });

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Listening'));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('connected'));

        client2.close();
        server2.stop();
    });

    it('should call logger.warn for unknown event types', async () => {
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        const server3 = new WsServer(
            { port: 0, logger },
            mockQueue as unknown as WorkQueue<string, FetchResult>,
        );
        server3.start();

        const wss3 = (server3 as unknown as { wss: WebSocketServer }).wss;
        const { port } = wss3.address() as { port: number };

        const client3 = new WebSocket(`ws://localhost:${port}`);
        await new Promise<void>((resolve) => {
            client3.on('open', resolve);
        });

        const envelope: IWsEnvelope = {
            id: 'warn-test',
            event: { type: 'no_such_event', payload: null },
        };
        await new Promise<void>((resolve) => {
            client3.once('message', () => resolve());
            client3.send(JSON.stringify(envelope));
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Unknown event type'),
            expect.anything(),
        );

        client3.close();
        server3.stop();
    });

    it('response envelope should include a fresh UUID id and a timestamp', async () => {
        mockQueue.enqueue.mockResolvedValueOnce({
            ok: true,
            url: 'https://x.com',
            size: 0,
            contentType: 'text/html',
            mimeType: 'text/html',
            data: Buffer.alloc(0),
        });

        const response = await sendRequest({ type: 'scrape', payload: { url: 'https://x.com' } });

        expect(response.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(response.meta?.ts).toBeTypeOf('number');
        expect(response.meta?.replyTo).toBe('test-id-123');
    });
});
