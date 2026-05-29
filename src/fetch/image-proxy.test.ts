import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fetcher } from './fetcher.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { validateUrl } from './url-validator.js';

vi.mock('sharp', () => ({
    default: vi.fn(() => ({
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toFile: vi.fn().mockResolvedValue({}),
    })),
}));
vi.mock('node:fs/promises');
vi.mock('./url-validator.js', () => ({
    validateUrl: vi.fn(),
}));

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
        vi.mocked(validateUrl).mockResolvedValue({ ok: true });
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

        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new TextEncoder().encode(html));
                        c.close();
                    },
                }),
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'image/png' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(Buffer.from('fake image data'));
                        c.close();
                    },
                }),
            } as Response);

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.image).toMatch(/^[a-f0-9]{32}\.webp$/);
        }

        expect(sharp).toHaveBeenCalled();
        expect(fetch).toHaveBeenNthCalledWith(
            2,
            'https://example.com/image.png',
            expect.objectContaining({ redirect: 'manual' }),
        );
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

        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new TextEncoder().encode(html));
                        c.close();
                    },
                }),
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'image/jpeg' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(Buffer.from('fake data'));
                        c.close();
                    },
                }),
            } as Response);

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

        const fetcher = new Fetcher(defaultOptions);
        await fetcher.fetch('https://mysite.com/blog/post-1', new AbortController().signal);

        expect(fetch).toHaveBeenNthCalledWith(
            2,
            'https://mysite.com/assets/hero.jpg',
            expect.objectContaining({ redirect: 'manual' }),
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

        expect(fetch).toHaveBeenCalledTimes(1);
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

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not proxy og:image when it redirects to a blocked private address', async () => {
        const html = `
            <html>
                <head>
                    <meta property="og:image" content="https://cdn.example.com/image.png">
                </head>
                <body></body>
            </html>
        `;

        vi.mocked(validateUrl)
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, reason: 'URL not allowed' });

        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new TextEncoder().encode(html));
                        c.close();
                    },
                }),
            } as Response)
            .mockResolvedValueOnce({
                ok: false,
                status: 302,
                headers: new Headers({ location: 'http://10.0.0.2/internal.png' }),
            } as Response);

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.image).toBeUndefined();
        }

        expect(validateUrl).toHaveBeenNthCalledWith(3, 'http://10.0.0.2/internal.png');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(sharp).not.toHaveBeenCalled();
    });

    it('should set animated: true in sharp options for animated GIF images', async () => {
        const html = `
            <html>
                <head>
                    <meta property="og:image" content="https://example.com/animation.gif">
                </head>
                <body></body>
            </html>
        `;

        const gifBuffer = Buffer.from(
            'GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;',
        );
        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new TextEncoder().encode(html));
                        c.close();
                    },
                }),
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'image/gif' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(gifBuffer);
                        c.close();
                    },
                }),
            } as Response);

        vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        expect(sharp).toHaveBeenCalledWith(gifBuffer, { animated: true });
    });
});
