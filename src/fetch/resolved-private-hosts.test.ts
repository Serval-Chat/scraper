import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LookupAddress } from 'node:dns';
import * as dns from 'node:dns/promises';
import { Fetcher } from './fetcher.js';
import { FetcherOptions } from '../types/fetch.js';

vi.mock('node:dns/promises', () => ({
    lookup: vi.fn(),
}));

describe('Fetcher resolved private host blocking', () => {
    const defaultOptions: FetcherOptions = {
        maxRedirects: 2,
        maxFetchSize: 1024,
        allowedContentTypes: ['text/html', 'application/json'],
        timeout: 1000,
    };

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it.each([
        ['_metadata.ser.chat', '169.254.169.254'],
        ['_private.ser.chat', '10.0.0.2'],
    ])('does not scrape %s when it resolves to %s', async (hostname, address) => {
        vi.mocked(dns.lookup).mockResolvedValue({
            address,
            family: 4,
        } as unknown as LookupAddress);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch(`https://${hostname}/`, new AbortController().signal);

        expect(dns.lookup).toHaveBeenCalledWith(hostname);
        expect(fetch).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('URL not allowed');
    });
});
