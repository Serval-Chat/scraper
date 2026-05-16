import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
    IncomingWsEvent,
    IWsEnvelope,
    OutgoingWsEvent,
    ScrapeEvent,
    FetchTextEvent,
    PingEvent,
} from '../types/ws.js';
import { WorkQueue } from '../queue/workqueue.js';
import { FetchResult, TextFetchResult } from '../types/fetch.js';
import { WsHandler, WsHandlerFn, buildHandlerMap } from './decorators.js';
import { ILogger, ConsoleLogger } from './logger.js';

export interface WsServerOptions {
    host?: string;
    port: number;
    logger?: ILogger;
}

export class WsServer {
    private httpServer?: http.Server;
    private wss?: WebSocketServer;
    private handlers?: Map<string, WsHandlerFn>;

    private readonly options: WsServerOptions;
    private readonly queue: WorkQueue<string, FetchResult>;
    private readonly textQueue: WorkQueue<string, TextFetchResult>;
    private readonly logger: ILogger;

    constructor(
        options: WsServerOptions,
        queue: WorkQueue<string, FetchResult>,
        textQueue?: WorkQueue<string, TextFetchResult>,
    ) {
        this.options = options;
        this.queue = queue;
        this.textQueue = textQueue ?? (queue as unknown as WorkQueue<string, TextFetchResult>);
        this.logger = options.logger ?? new ConsoleLogger('WsServer');
    }

    public start(): void {
        this.handlers = buildHandlerMap(this);

        this.httpServer = http.createServer((req, res) => {
            if (req.url?.startsWith('/cache/')) {
                const fileName = req.url.replace('/cache/', '');
                const filePath = path.join(process.cwd(), 'public', 'cache', fileName);

                fs.readFile(filePath, (err, data) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('Not found');
                        return;
                    }
                    res.writeHead(200, {
                        'Content-Type': 'image/webp',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(data);
                });
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws: WebSocket) => {
            this.logger.info('Client connected');

            ws.on('message', (data: Buffer | string) => {
                this.handleMessage(ws, data).catch((err: unknown) => {
                    this.logger.error('Unhandled error in message handler', err);
                });
            });

            ws.on('close', () => {
                this.logger.info('Client disconnected');
            });

            ws.on('error', (err: Error) => {
                this.logger.error('WebSocket error', err);
            });
        });

        this.httpServer.listen(this.options.port, this.options.host, () => {
            this.logger.info(
                `Listening on http://${this.options.host || 'localhost'}:${this.options.port}`,
            );
        });
    }

    public stop(): void {
        if (this.wss) {
            this.wss.close();
            this.wss = undefined;
        }
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = undefined;
        }
    }

    private async handleMessage(ws: WebSocket, data: unknown): Promise<void> {
        const envelope = this.parseEnvelope(data);
        if (!envelope) return;

        const handler = this.handlers?.get(envelope.event.type);

        if (!handler) {
            this.logger.warn('Unknown event type received', { type: envelope.event.type });
            this.sendResponse(ws, envelope, {
                type: 'JobFailure',
                payload: { reason: `Unknown event type: "${envelope.event.type}"` },
            });
            return;
        }

        await handler(ws, envelope);
    }

    private parseEnvelope(data: unknown): IWsEnvelope<IncomingWsEvent> | null {
        let envelope: IWsEnvelope<IncomingWsEvent>;
        try {
            const raw = Buffer.isBuffer(data) ? data.toString() : String(data);
            envelope = JSON.parse(raw) as IWsEnvelope<IncomingWsEvent>;
        } catch (err) {
            this.logger.error('Failed to parse incoming message', err);
            return null;
        }

        if (!envelope.id || !envelope.event?.type) {
            this.logger.error('Malformed envelope — missing id or event.type', envelope);
            return null;
        }

        return envelope;
    }

    @WsHandler('scrape')
    private async onScrape(ws: WebSocket, envelope: IWsEnvelope<ScrapeEvent>): Promise<void> {
        const url = envelope.event.payload.url;

        if (!url) {
            this.sendResponse(ws, envelope, {
                type: 'JobFailure',
                payload: { reason: 'Missing URL in scrape payload' },
            });
            return;
        }

        try {
            const fetchResult = await this.queue.enqueue(url);
            this.sendResponse(ws, envelope, {
                type: 'JobSuccess',
                payload: fetchResult,
            });
        } catch (error) {
            const err = error as Error;
            this.sendResponse(ws, envelope, {
                type: 'JobFailure',
                payload: { reason: err.message || 'Unknown error' },
            });
        }
    }

    @WsHandler('fetchText')
    private async onFetchText(ws: WebSocket, envelope: IWsEnvelope<FetchTextEvent>): Promise<void> {
        const url = envelope.event.payload.url;

        if (!url) {
            this.sendResponse(ws, envelope, {
                type: 'JobFailure',
                payload: { reason: 'Missing URL in fetchText payload' },
            });
            return;
        }

        try {
            const fetchResult = await this.textQueue.enqueue(url);
            this.sendResponse(ws, envelope, {
                type: 'JobSuccess',
                payload: fetchResult,
            });
        } catch (error) {
            const err = error as Error;
            this.sendResponse(ws, envelope, {
                type: 'JobFailure',
                payload: { reason: err.message || 'Unknown error' },
            });
        }
    }

    @WsHandler('ping')
    private onPing(ws: WebSocket, envelope: IWsEnvelope<PingEvent>): void {
        this.sendResponse(ws, envelope, { type: 'pong', payload: null });
    }

    private sendResponse(
        ws: WebSocket,
        requestEnvelope: IWsEnvelope,
        event: OutgoingWsEvent,
    ): void {
        const response: IWsEnvelope<OutgoingWsEvent> = {
            id: crypto.randomUUID(),
            event,
            meta: {
                replyTo: requestEnvelope.id,
                ts: Date.now(),
            },
        };

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(response));
        }
    }
}
