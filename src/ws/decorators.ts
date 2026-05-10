import type { WebSocket } from 'ws';
import type { IWsEnvelope, IncomingWsEvent } from '../types/ws.js';

export type WsHandlerFn = (ws: WebSocket, envelope: IWsEnvelope) => void | Promise<void>;

const HANDLERS_KEY = Symbol('wsHandlers');

function asMeta(instance: object): { [HANDLERS_KEY]?: Map<string, string> } {
    return instance as { [HANDLERS_KEY]?: Map<string, string> };
}

export function WsHandler(eventType: string) {
    return function <This extends object>(
        _method: unknown,
        context: ClassMethodDecoratorContext<This>,
    ): void {
        context.addInitializer(function (this: This) {
            const meta = asMeta(this);
            const existing = meta[HANDLERS_KEY] ?? new Map<string, string>();
            meta[HANDLERS_KEY] = existing;
            existing.set(eventType, String(context.name));
        });
    };
}

export function buildHandlerMap(instance: object): Map<string, WsHandlerFn> {
    const meta = asMeta(instance);
    const map = new Map<string, WsHandlerFn>();
    if (!meta[HANDLERS_KEY]) return map;

    for (const [eventType, methodName] of meta[HANDLERS_KEY]) {
        const fn = (instance as Record<string, unknown>)[methodName];
        if (typeof fn === 'function') {
            map.set(eventType, (fn as WsHandlerFn).bind(instance));
        }
    }
    return map;
}

export function registeredEvents(instance: object): ReadonlySet<string> {
    const meta = asMeta(instance);
    return new Set(meta[HANDLERS_KEY]?.keys() ?? []);
}

export type { IWsEnvelope, IncomingWsEvent };
