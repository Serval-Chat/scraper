import { FetcherOptions, FetchResult } from '../types/fetch.js';
import { validateUrl } from './url-validator.js';
import { UrlValidationResult } from '../types/url-validator.js';
import { fileTypeFromBuffer } from 'file-type';

export class Fetcher {
    private readonly options: FetcherOptions;

    constructor(options: FetcherOptions) {
        this.options = options;
    }

    public async fetch(url: string, signal: AbortSignal): Promise<FetchResult> {
        const originalUrl: string = url;
        let currentUrl: string = url;
        let redirects = 0;

        try {
            while (true) {
                const validation: UrlValidationResult = await validateUrl(currentUrl);
                if (!validation.ok) {
                    return {
                        ok: false,
                        url: originalUrl,
                        reason: validation.reason.startsWith('URL not allowed:')
                            ? 'URL not allowed'
                            : validation.reason,
                    };
                }

                const timeoutSignal: AbortSignal = AbortSignal.timeout(this.options.timeout);
                const combinedSignal: AbortSignal = AbortSignal.any([signal, timeoutSignal]);

                const response: Response = await fetch(currentUrl, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: combinedSignal,
                });

                if (response.status >= 300 && response.status < 400) {
                    redirects++;
                    if (redirects > this.options.maxRedirects) {
                        return { ok: false, url: originalUrl, reason: 'Too many redirects' };
                    }

                    const location: string | null = response.headers.get('location');
                    if (!location) {
                        return {
                            ok: false,
                            url: originalUrl,
                            reason: `Redirect status ${response.status} without location header`,
                        };
                    }

                    currentUrl = new URL(location, currentUrl).toString();
                    continue;
                }

                if (!response.ok) {
                    return {
                        ok: false,
                        url: originalUrl,
                        reason: `Request failed: ${response.status}`,
                    };
                }

                const contentTypeHeader: string =
                    response.headers.get('content-type') || 'application/octet-stream';

                if (!response.body) {
                    return { ok: false, url: originalUrl, reason: 'Response body is empty' };
                }

                const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let totalSize = 0;

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        totalSize += value.length;
                        if (totalSize > this.options.maxFetchSize) {
                            await reader.cancel('Response too large');
                            return { ok: false, url: originalUrl, reason: 'Response too large' };
                        }
                        chunks.push(value);
                    }
                } finally {
                    reader.releaseLock();
                }

                const data = Buffer.concat(chunks);
                const type = await fileTypeFromBuffer(data);
                let mimeType: string | undefined = type?.mime;

                if (!mimeType) {
                    const text = data.toString('utf-8').trim();
                    if (text.startsWith('{') || text.startsWith('[')) {
                        mimeType = 'application/json';
                    } else if (
                        text.toLowerCase().includes('<!doctype html') ||
                        text.toLowerCase().includes('<html')
                    ) {
                        mimeType = 'text/html';
                    } else {
                        mimeType = 'text/plain';
                    }
                }

                if (!this.options.allowedContentTypes.includes(mimeType)) {
                    return { ok: false, url: originalUrl, reason: 'Content type not allowed' };
                }

                return {
                    ok: true,
                    url: currentUrl,
                    size: totalSize,
                    contentType: contentTypeHeader,
                    mimeType,
                    data,
                };
            }
        } catch (error: unknown) {
            if (signal.aborted) {
                return { ok: false, url: originalUrl, reason: 'Request aborted' };
            }

            if (error instanceof Error) {
                if (error.name === 'TimeoutError') {
                    return { ok: false, url: originalUrl, reason: 'Request timed out' };
                }
                return { ok: false, url: originalUrl, reason: `Network error: ${error.message}` };
            }

            return { ok: false, url: originalUrl, reason: `Network error: ${String(error)}` };
        }
    }
}
