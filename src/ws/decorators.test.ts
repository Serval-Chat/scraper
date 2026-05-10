import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WsHandler, buildHandlerMap, registeredEvents } from './decorators.js';
import type { IWsEnvelope } from '../types/ws.js';

class SingleHandlerServer {
    public calls: string[] = [];

    @WsHandler('ping')
    public onPing(): void {
        this.calls.push('ping');
    }
}

class MultiHandlerServer {
    public calls: string[] = [];

    @WsHandler('scrape')
    public onScrape(): void {
        this.calls.push('scrape');
    }

    @WsHandler('ping')
    public onPing(): void {
        this.calls.push('ping');
    }
}

const noHandlerInstance = {};

const fakeWs = {} as WebSocket;
const fakeEnvelope = { id: 'x', event: { type: 'ping', payload: null } } as IWsEnvelope;

describe('@WsHandler / buildHandlerMap', () => {
    describe('registeredEvents()', () => {
        it('returns empty set when no handlers are decorated', () => {
            expect(registeredEvents(noHandlerInstance).size).toBe(0);
        });

        it('returns the single registered event type', () => {
            const server = new SingleHandlerServer();
            expect(registeredEvents(server)).toEqual(new Set(['ping']));
        });

        it('returns all registered event types for multiple handlers', () => {
            const server = new MultiHandlerServer();
            expect(registeredEvents(server)).toEqual(new Set(['scrape', 'ping']));
        });
    });

    describe('buildHandlerMap()', () => {
        it('returns an empty map when no handlers are decorated', () => {
            expect(buildHandlerMap(noHandlerInstance).size).toBe(0);
        });

        it('maps the event type to a callable function', () => {
            const server = new SingleHandlerServer();
            const map = buildHandlerMap(server);
            expect(map.has('ping')).toBe(true);
            expect(typeof map.get('ping')).toBe('function');
        });

        it('dispatches to the correct method', () => {
            const server = new MultiHandlerServer();
            const map = buildHandlerMap(server);

            map.get('scrape')?.(fakeWs, fakeEnvelope);
            map.get('ping')?.(fakeWs, fakeEnvelope);

            expect(server.calls).toEqual(['scrape', 'ping']);
        });

        it('binds the method to the instance (preserves `this`)', () => {
            const server = new SingleHandlerServer();
            const handler = buildHandlerMap(server).get('ping');

            handler?.(fakeWs, fakeEnvelope);
            expect(server.calls).toContain('ping');
        });

        it('each instance has its own independent handler map', () => {
            const a = new MultiHandlerServer();
            const b = new MultiHandlerServer();

            buildHandlerMap(a).get('scrape')?.(fakeWs, fakeEnvelope);

            expect(a.calls).toEqual(['scrape']);
            expect(b.calls).toEqual([]);

            buildHandlerMap(b).get('ping')?.(fakeWs, fakeEnvelope);
            expect(b.calls).toEqual(['ping']);
        });

        it('does not include unregistered event types', () => {
            const server = new SingleHandlerServer();
            const map = buildHandlerMap(server);
            expect(map.has('scrape')).toBe(false);
            expect(map.has('unknown')).toBe(false);
        });

        it('last decorator wins when the same event type is declared twice', () => {
            class DuplicateServer {
                public calls: string[] = [];

                @WsHandler('ping')
                public onPingA(): void {
                    this.calls.push('A');
                }

                @WsHandler('ping')
                public onPingB(): void {
                    this.calls.push('B');
                }
            }

            const server = new DuplicateServer();
            buildHandlerMap(server).get('ping')?.(fakeWs, fakeEnvelope);
            expect(server.calls.length).toBe(1);
        });
    });

    describe('@WsHandler with async methods', () => {
        it('works with async handler methods', async () => {
            const spy = vi.fn().mockResolvedValue(undefined);

            class AsyncServer {
                @WsHandler('scrape')
                public async onScrape(): Promise<void> {
                    await (spy as () => Promise<void>)();
                }
            }

            const server = new AsyncServer();
            await buildHandlerMap(server).get('scrape')?.(fakeWs, fakeEnvelope);
            expect(spy).toHaveBeenCalledOnce();
        });
    });
});
