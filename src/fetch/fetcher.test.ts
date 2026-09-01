import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fetcher } from './fetcher.js';
import { FetcherOptions } from '../types/fetch.js';
import { validateUrl } from './url-validator.js';
import { fileTypeFromBuffer } from 'file-type';

vi.mock('file-type', () => ({
    fileTypeFromBuffer: vi.fn(),
}));

vi.mock('../fetch/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./url-validator.js')>();
    return {
        ...actual,
        validateUrl: vi.fn().mockImplementation(actual.validateUrl),
    };
});

const sharpMocks = vi.hoisted(() => ({
    toFile: vi.fn(),
    metadata: vi.fn(),
    webp: vi.fn(),
    resize: vi.fn(),
}));

vi.mock('sharp', () => {
    const instance = {
        resize: sharpMocks.resize,
        webp: sharpMocks.webp,
        toFile: sharpMocks.toFile,
        metadata: sharpMocks.metadata,
    };
    sharpMocks.resize.mockReturnValue(instance);
    sharpMocks.webp.mockReturnValue(instance);
    return { default: vi.fn(() => instance) };
});

const fsMocks = vi.hoisted(() => ({
    mkdir: vi.fn(),
    access: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    default: fsMocks,
}));

describe('Fetcher', () => {
    const defaultOptions: FetcherOptions = {
        maxRedirects: 2,
        maxFetchSize: 1024,
        allowedContentTypes: ['text/html', 'application/json'],
        timeout: 1000,
    };

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
        vi.mocked(validateUrl).mockClear();
        vi.mocked(fileTypeFromBuffer).mockReset();
        sharpMocks.toFile.mockReset();
        sharpMocks.metadata.mockReset();
        fsMocks.mkdir.mockReset().mockResolvedValue(undefined);
        fsMocks.access.mockReset().mockRejectedValue(new Error('ENOENT'));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should successfully fetch a resource', async () => {
        const mockData = new TextEncoder().encode('<html>hello world</html>');
        const mockResponse = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.enqueue(mockData);
                    controller.close();
                },
            }),
        };

        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);
        vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.url).toBe('https://example.com');
            expect(result.size).toBe(mockData.length);
            expect(result.contentType).toBe('text/html; charset=utf-8');
            expect(result.mimeType).toBe('text/html');
        }
    });

    it('should follow redirects manually', async () => {
        const mockRedirect = {
            ok: false,
            status: 302,
            headers: new Headers({ location: 'https://example.com/target' }),
        };

        const mockFinal = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.enqueue(new TextEncoder().encode('<html>final content</html>'));
                    controller.close();
                },
            }),
        };

        vi.mocked(fetch)
            .mockResolvedValueOnce(mockRedirect as Response)
            .mockResolvedValueOnce(mockFinal as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.url).toBe('https://example.com/target');
        }
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should fail if too many redirects', async () => {
        const mockRedirect = {
            ok: false,
            status: 302,
            headers: new Headers({ location: 'https://example.com/next' }),
        };

        vi.mocked(fetch).mockResolvedValue(mockRedirect as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Too many redirects');
        }
    });

    it('should fail if response size exceeds maxFetchSize', async () => {
        const mockResponse = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.enqueue(new Uint8Array(2048));
                    controller.close();
                },
            }),
        };

        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Response too large');
        }
    });

    it('should fail if content type is not allowed', async () => {
        const mockResponse = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.close();
                },
            }),
        };

        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Content type not allowed');
        }
    });

    it('should fail for non-2xx status', async () => {
        const mockResponse = {
            ok: false,
            status: 404,
            headers: new Headers(),
        };

        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Request failed: 404');
        }
    });

    it('should fail for network errors', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Network error: Connection refused');
        }
    });

    it('should respect AbortSignal', async () => {
        const controller = new AbortController();
        controller.abort();

        vi.mocked(fetch).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', controller.signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('Request aborted');
        }
    });

    it('should fetch raw text for verification files', async () => {
        const mockData = new TextEncoder().encode('verification-token\n');
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/plain' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.enqueue(mockData);
                    controller.close();
                },
            }),
        } as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetchText(
            'https://example.com/.well-known/serchat',
            new AbortController().signal,
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.url).toBe('https://example.com/.well-known/serchat');
            expect(result.body).toBe('verification-token\n');
            expect(result.contentType).toBe('text/plain');
        }
    });

    it.each([
        ['CGNAT', 'http://100.64.0.1/'],
        ['IANA special purpose', 'http://192.0.0.1/'],
        ['Documentation TEST-NET-1', 'http://192.0.2.1/'],
        ['Documentation TEST-NET-2', 'http://198.51.100.1/'],
        ['Documentation TEST-NET-3', 'http://203.0.113.1/'],
        ['Benchmark testing range', 'http://198.18.0.1/'],
        ['Reserved class E', 'http://240.0.0.1/'],
        ['Broadcast', 'http://255.255.255.255/'],
        ['IPv6 unique local', 'http://[fc00::1]/'],
        ['IPv6 link-local', 'http://[fe80::1]/'],
        ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/'],
        ['IPv4-mapped IPv6 private', 'http://[::ffff:192.168.1.1]/'],
    ])('should block %s address (%s)', async (_name: string, url: string) => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.close();
                },
            }),
        } as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch(url, new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('URL not allowed');
        }
    });

    it('should block redirect to CGNAT IP', async () => {
        const mockRedirect = {
            ok: false,
            status: 302,
            headers: new Headers({ location: 'http://100.64.0.1/' }),
        };

        const mockSuccess = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: new ReadableStream({
                start(controller): void {
                    controller.close();
                },
            }),
        };

        vi.mocked(fetch)
            .mockResolvedValueOnce(mockRedirect as Response)
            .mockResolvedValueOnce(mockSuccess as Response);

        const fetcher = new Fetcher(defaultOptions);
        const result = await fetcher.fetch('https://example.com', new AbortController().signal);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('URL not allowed');
        }
    });

    describe('New Edge Cases', () => {
        it('should fail if redirect is to a blocked IP', async () => {
            vi.mocked(validateUrl)
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: false, reason: 'URL not allowed' });

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 302,
                headers: new Headers({ location: 'http://127.0.0.1/' }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('URL not allowed');
            }
        });

        it('should fail if redirect chain leads to blocked IP', async () => {
            vi.mocked(validateUrl)
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: false, reason: 'URL not allowed' });

            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: 'https://example.com/step2' }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: 'http://169.254.169.254/' }),
                } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch(
                'https://example.com/step1',
                new AbortController().signal,
            );

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('URL not allowed');
            }
        });

        it('should succeed for a chain of good redirects', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: 'https://example.com/target' }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/html' }),
                    body: new ReadableStream({
                        start(c): void {
                            c.enqueue(new TextEncoder().encode('<html>ok</html>'));
                            c.close();
                        },
                    }),
                } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch(
                'https://example.com/start',
                new AbortController().signal,
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.url).toBe('https://example.com/target');
            }
        });

        it('should fail if redirect is missing location header', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 302,
                headers: new Headers(),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toContain('without location header');
            }
        });

        it('should resolve relative redirects correctly', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: '/relative/path' }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/html' }),
                    body: new ReadableStream({
                        start(c): void {
                            c.enqueue(new TextEncoder().encode('<html>ok</html>'));
                            c.close();
                        },
                    }),
                } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch(
                'https://example.com/base/file',
                new AbortController().signal,
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.url).toBe('https://example.com/relative/path');
            }
        });

        it('should fail if too many redirects in a row', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: false,
                status: 302,
                headers: new Headers({ location: 'https://example.com/next' }),
            } as Response);

            const fetcher = new Fetcher({ ...defaultOptions, maxRedirects: 5 });
            const result = await fetcher.fetch(
                'https://example.com/0',
                new AbortController().signal,
            );

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Too many redirects');
            }
            expect(fetch).toHaveBeenCalledTimes(6);
        });

        it('should allow content-type with suffixes and whitespace', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html ; charset=utf-8' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new TextEncoder().encode('<html>ok</html>'));
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.mimeType).toBe('text/html');
            }
        });

        it('should fail if content-type header is missing', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers(),
                body: new ReadableStream({
                    start(c): void {
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Content type not allowed');
            }
        });

        it('should fail if response is exactly maxFetchSize + 1', async () => {
            const size = defaultOptions.maxFetchSize + 1;
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        const buf = new Uint8Array(size);
                        buf.set(new TextEncoder().encode('<html>'));
                        c.enqueue(buf);
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Response too large');
            }
        });

        it('should succeed if response is exactly maxFetchSize', async () => {
            const size = defaultOptions.maxFetchSize;
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        const buf = new Uint8Array(size);
                        buf.set(new TextEncoder().encode('<html>'));
                        c.enqueue(buf);
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.size).toBe(size);
            }
        });

        it('should fail if signal is already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', controller.signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Request aborted');
            }
        });

        it('should fail if validateUrl fails on initial URL', async () => {
            vi.mocked(validateUrl).mockResolvedValueOnce({
                ok: false,
                reason: 'URL not allowed: invalid scheme',
            });

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('ftp://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('URL not allowed');
            }
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should handle multiple sequential fetches independently', async () => {
            vi.mocked(fetch).mockImplementation(
                async () =>
                    ({
                        ok: true,
                        status: 200,
                        headers: new Headers({ 'content-type': 'text/html' }),
                        body: new ReadableStream({
                            start(c): void {
                                c.enqueue(new TextEncoder().encode('<html>ok</html>'));
                                c.close();
                            },
                        }),
                    }) as Response,
            );

            const fetcher = new Fetcher(defaultOptions);
            const result1 = await fetcher.fetch(
                'https://example.com/1',
                new AbortController().signal,
            );
            const result2 = await fetcher.fetch(
                'https://example.com/2',
                new AbortController().signal,
            );

            expect(result1.ok).toBe(true);
            expect(result2.ok).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should fail if redirect location is empty string', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 302,
                headers: new Headers({ location: '' }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toContain('without location header');
            }
        });

        it('should fail if redirected to non-http scheme', async () => {
            vi.mocked(validateUrl)
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: false, reason: 'URL not allowed: invalid scheme' });

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 302,
                headers: new Headers({ location: 'ftp://example.com' }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('URL not allowed');
            }
        });

        it('should succeed with exactly maxRedirects', async () => {
            const max = 2;
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: '/1' }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 302,
                    headers: new Headers({ location: '/2' }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/html' }),
                    body: new ReadableStream({
                        start(c): void {
                            c.enqueue(new TextEncoder().encode('<html>ok</html>'));
                            c.close();
                        },
                    }),
                } as Response);

            const fetcher = new Fetcher({ ...defaultOptions, maxRedirects: max });
            const result = await fetcher.fetch(
                'https://example.com/0',
                new AbortController().signal,
            );

            expect(result.ok).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        it('should fail if Content-Type header is empty', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': '' }),
                body: new ReadableStream({
                    start(c): void {
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Content type not allowed');
            }
        });

        it('should succeed with empty response body', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher({
                ...defaultOptions,
                allowedContentTypes: [...defaultOptions.allowedContentTypes, 'text/plain'],
            });
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.size).toBe(0);
            }
        });

        it('should fail if split chunks exceed maxFetchSize', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new Uint8Array(512));
                        c.enqueue(new Uint8Array(600));
                        c.close();
                    },
                }),
            } as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Response too large');
            }
        });

        it('should fail if aborted mid-stream', async () => {
            const controller = new AbortController();
            const mockReader = {
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array(10) })
                    .mockImplementation(async () => {
                        controller.abort();
                        throw new DOMException('Aborted', 'AbortError');
                    }),
                releaseLock: vi.fn(),
                cancel: vi.fn().mockResolvedValue(undefined),
            };

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: {
                    getReader: () => mockReader,
                },
            } as unknown as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', controller.signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Request aborted');
            }
        });

        it('should fail if response body is null', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                body: null,
            } as unknown as Response);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('Response body is empty');
            }
        });
    });

    describe('image dimension extraction', () => {
        it('should attach width/height when directly fetching an image', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'image/png' }),
                body: new ReadableStream({
                    start(c): void {
                        c.enqueue(new Uint8Array([1, 2, 3, 4]));
                        c.close();
                    },
                }),
            } as Response);

            vi.mocked(fileTypeFromBuffer).mockResolvedValue({
                mime: 'image/png',
                ext: 'png',
            } as never);

            sharpMocks.toFile.mockResolvedValue({
                width: 1200,
                height: 675,
            } as never);

            const fetcher = new Fetcher({
                ...defaultOptions,
                allowedContentTypes: [...defaultOptions.allowedContentTypes, 'image/png'],
            });
            const result = await fetcher.fetch(
                'https://example.com/photo.png',
                new AbortController().signal,
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.image).toBeDefined();
                expect(result.imageWidth).toBe(1200);
                expect(result.imageHeight).toBe(675);
            }
        });

        it('should attach width/height for an og:image found on an HTML page', async () => {
            const html =
                '<html><head><meta property="og:image" content="https://example.com/photo.jpg"></head></html>';

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
                            c.enqueue(new Uint8Array([5, 6, 7, 8]));
                            c.close();
                        },
                    }),
                } as Response);

            vi.mocked(fileTypeFromBuffer)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' } as never);

            sharpMocks.toFile.mockResolvedValue({
                width: 800,
                height: 420,
            } as never);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.image).toBeDefined();
                expect(result.imageWidth).toBe(800);
                expect(result.imageHeight).toBe(420);
            }
        });

        it('should read width/height from an already-cached proxied image without re-fetching it', async () => {
            const html =
                '<html><head><meta property="og:image" content="https://example.com/photo.jpg"></head></html>';

            vi.mocked(fetch).mockResolvedValueOnce({
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

            vi.mocked(fileTypeFromBuffer).mockResolvedValueOnce(undefined);
            fsMocks.access.mockResolvedValue(undefined);
            sharpMocks.metadata.mockResolvedValue({ width: 500, height: 300 } as never);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.imageWidth).toBe(500);
                expect(result.imageHeight).toBe(300);
            }
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(sharpMocks.toFile).not.toHaveBeenCalled();
        });

        it('should omit width/height when the cached file has no readable metadata', async () => {
            const html =
                '<html><head><meta property="og:image" content="https://example.com/photo.jpg"></head></html>';

            vi.mocked(fetch).mockResolvedValueOnce({
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

            vi.mocked(fileTypeFromBuffer).mockResolvedValueOnce(undefined);
            fsMocks.access.mockResolvedValue(undefined);
            sharpMocks.metadata.mockResolvedValue({} as never);

            const fetcher = new Fetcher(defaultOptions);
            const result = await fetcher.fetch('https://example.com', new AbortController().signal);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.image).toBeUndefined();
                expect(result.imageWidth).toBeUndefined();
                expect(result.imageHeight).toBeUndefined();
            }
        });
    });
});
