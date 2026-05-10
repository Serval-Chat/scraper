import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fetcher } from './fetcher.js';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'node:fs/promises';

vi.mock('axios');
vi.mock('sharp', () => ({
    default: vi.fn(() => ({
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toFile: vi.fn().mockResolvedValue({}),
    })),
}));
vi.mock('node:fs/promises');

describe('Fetcher Image Proxying', () => {
    const defaultOptions = {
        maxRedirects: 2,
        maxFetchSize: 1024 * 1024,
        allowedContentTypes: ['text/html'],
        timeout: 1000,
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        process.env.HOST = 'localhost';
        process.env.PORT = '6969';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should proxy and compress images found in og:image tags', async () => {
        const html = `
            <html>
                <head>
                    <meta property="og:image" content="https://example.com/image.png">
                </head>
                <body></body>
            </html>
        `;

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(c): void {
                    c.enqueue(new TextEncoder().encode(html));
                    c.close();
                },
            }),
        } as Response);

        vi.mocked(axios.get).mockResolvedValue({
            data: Buffer.from('fake image data'),
        });

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.image).toMatch(/^[a-f0-9]{32}\.webp$/);
        }

        expect(sharp).toHaveBeenCalled();
        expect(axios.get).toHaveBeenCalledWith('https://example.com/image.png', expect.anything());
    });

    it('should resolve relative URLs in og:image', async () => {
        const html = `
            <html>
                <head>
                    <meta property="og:image" content="/assets/hero.jpg">
                </head>
                <body></body>
            </html>
        `;

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(c): void {
                    c.enqueue(new TextEncoder().encode(html));
                    c.close();
                },
            }),
        } as Response);

        vi.mocked(axios.get).mockResolvedValue({
            data: Buffer.from('fake data'),
        });

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

        const fetcher = new Fetcher(defaultOptions);
        await fetcher.fetch('https://mysite.com/blog/post-1', new AbortController().signal);

        expect(axios.get).toHaveBeenCalledWith(
            'https://mysite.com/assets/hero.jpg',
            expect.anything(),
        );
    });

    it('should NOT proxy images if og:image is missing', async () => {
        const html = `
            <html>
                <head>
                    <title>No Image Here</title>
                </head>
                <body>
                    <img src="https://example.com/not-og-image.png">
                </body>
            </html>
        `;

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(c): void {
                    c.enqueue(new TextEncoder().encode(html));
                    c.close();
                },
            }),
        } as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.image).toBeUndefined();
        }

        expect(axios.get).not.toHaveBeenCalled();
    });

    it('should NOT proxy non-http URLs (e.g. data: or javascript:)', async () => {
        const html = `
            <html>
                <head>
                    <meta property="og:image" content="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
                </head>
                <body></body>
            </html>
        `;

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(c): void {
                    c.enqueue(new TextEncoder().encode(html));
                    c.close();
                },
            }),
        } as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.image).toBeUndefined();
        }

        expect(axios.get).not.toHaveBeenCalled();
    });
});
