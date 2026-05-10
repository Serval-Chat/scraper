import { FetchResult } from './fetch.js';

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

export type ScrapeEvent = IWsEvent<'scrape', ScrapePayload>;
export type PingEvent = IWsEvent<'ping', null>;
export type PongEvent = IWsEvent<'pong', null>;
export type JobSuccessEvent = IWsEvent<'JobSuccess', FetchResult>;
export type JobFailureEvent = IWsEvent<'JobFailure', { reason: string }>;

export type IncomingWsEvent = ScrapeEvent | PingEvent;
export type OutgoingWsEvent = JobSuccessEvent | JobFailureEvent | PongEvent;
