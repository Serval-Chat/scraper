import { FetchResult, TextFetchResult } from './fetch.js';

export interface IWsEvent<TType extends string = string, TPayload = unknown> {
    type: TType;
    payload: TPayload;
}

export interface IWsEnvelope<TEvent extends IWsEvent = IWsEvent> {
    id: string;
    event: TEvent;
    meta?: {
        replyTo?: string;
        ts?: number;
    };
}

export interface ScrapePayload {
    url: string;
}

export interface FetchTextPayload {
    url: string;
}

export type ScrapeEvent = IWsEvent<'scrape', ScrapePayload>;
export type FetchTextEvent = IWsEvent<'fetchText', FetchTextPayload>;
export type PingEvent = IWsEvent<'ping', null>;
export type PongEvent = IWsEvent<'pong', null>;
export type JobSuccessEvent = IWsEvent<'JobSuccess', FetchResult | TextFetchResult>;
export type JobFailureEvent = IWsEvent<'JobFailure', { reason: string }>;

export type IncomingWsEvent = ScrapeEvent | FetchTextEvent | PingEvent;
export type OutgoingWsEvent = JobSuccessEvent | JobFailureEvent | PongEvent;
