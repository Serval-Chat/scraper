import { FetcherOptions, FetchResult, TextFetchResult } from '../types/fetch.js';
import { validateUrl } from './url-validator.js';
import { UrlValidationResult } from '../types/url-validator.js';
import { fileTypeFromBuffer } from 'file-type';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class Fetcher {
    private readonly options: FetcherOptions;

    constructor(options: FetcherOptions) {
        this.options = options;
    }

    private readonly youtubeVideoIdRegex =
        /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

    public async fetch(url: string, signal: AbortSignal): Promise<FetchResult> {
        console.log(`[Scraper] Starting fetch for: ${url}`);

        const youtubeMatch = this.youtubeVideoIdRegex.exec(url);
        if (youtubeMatch) {
            const videoId = youtubeMatch[1];
            return this.fetchYouTube(url, videoId, signal);
        }

        try {
            const fetched = await this.fetchBytes(url, signal);
            if (!fetched.ok) return fetched;

            const { currentUrl, contentTypeHeader, data, totalSize } = fetched;
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
                return { ok: false, url, reason: 'Content type not allowed' };
            }

            if (mimeType.startsWith('image/')) {
                const proxiedUrl = await this.proxyImage(currentUrl, signal, data);
                let title: string | undefined;
                try {
                    title = path.basename(new URL(currentUrl).pathname);
                } catch (err) {
                    console.error(`[Scraper] Failed to parse title from ${currentUrl}:`, err);
                }
                return {
                    ok: true,
                    url: currentUrl,
                    size: totalSize,
                    contentType: contentTypeHeader,
                    mimeType,
                    image: proxiedUrl ? proxiedUrl : undefined,
                    title: title || undefined,
                };
            }

            if (mimeType.startsWith('video/')) {
                let title: string | undefined;
                try {
                    title = path.basename(new URL(currentUrl).pathname);
                } catch (err) {
                    console.error(`[Scraper] Failed to parse title from ${currentUrl}:`, err);
                }
                return {
                    ok: true,
                    url: currentUrl,
                    size: totalSize,
                    contentType: contentTypeHeader,
                    mimeType,
                    video: currentUrl,
                    title: title || undefined,
                };
            }

            const html = data.toString('utf-8');
            const $ = cheerio.load(html);

            const title =
                $('meta[property="og:title"]').attr('content') || $('title').text() || undefined;
            const description =
                $('meta[property="og:description"]').attr('content') ||
                $('meta[name="description"]').attr('content') ||
                undefined;
            const image = $('meta[property="og:image"]').attr('content') || undefined;
            const providerName = $('meta[property="og:site_name"]').attr('content') || undefined;
            const themeColor = $('meta[name="theme-color"]').attr('content') || undefined;

            const result: FetchResult = {
                ok: true,
                url: currentUrl,
                size: totalSize,
                contentType: contentTypeHeader,
                mimeType,
                title,
                description,
                providerName,
                themeColor,
            };

            if (image) {
                try {
                    const absoluteImageUrl = new URL(image, currentUrl).href;

                    if (absoluteImageUrl.startsWith('http')) {
                        const proxiedUrl = await this.proxyImage(absoluteImageUrl, signal);
                        if (proxiedUrl) {
                            result.image = proxiedUrl;
                        }
                    }
                } catch (err) {
                    console.error(`[Scraper] Failed to proxy image ${image}:`, err);
                }
            }

            return result;
        } catch (error: unknown) {
            if (signal.aborted) {
                return { ok: false, url, reason: 'Request aborted' };
            }

            if (error instanceof Error) {
                if (error.name === 'TimeoutError') {
                    return { ok: false, url, reason: 'Request timed out' };
                }
                return { ok: false, url, reason: `Network error: ${error.message}` };
            }

            return { ok: false, url, reason: `Network error: ${String(error)}` };
        }
    }

    private async fetchYouTube(
        url: string,
        videoId: string,
        signal: AbortSignal,
    ): Promise<FetchResult> {
        console.log(`[Scraper] YouTube fast-path for video ID: ${videoId}`);

        const embedVideoUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
        const fallbackThumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const timeoutSignal = AbortSignal.timeout(5000);
            const combined = AbortSignal.any([signal, timeoutSignal]);

            const resp = await fetch(oembedUrl, {
                headers: { 'User-Agent': 'Serchat/1.0' },
                signal: combined,
            });

            const thumbnailUrl = resp.ok
                ? ((await resp.json()) as {
                      title?: string;
                      author_name?: string;
                      author_url?: string;
                      thumbnail_url?: string;
                      thumbnail_width?: number;
                      thumbnail_height?: number;
                  })
                : null;

            const data =
                typeof thumbnailUrl === 'object' && thumbnailUrl !== null
                    ? thumbnailUrl
                    : {
                          title: undefined,
                          author_name: undefined,
                          author_url: undefined,
                          thumbnail_url: undefined,
                      };

            const rawThumbUrl = data.thumbnail_url ?? fallbackThumbnailUrl;
            const proxiedThumb = await this.proxyImage(rawThumbUrl, signal);

            return {
                ok: true,
                url,
                size: 0,
                contentType: 'text/html',
                mimeType: 'text/html',
                title: data.title,
                embedVideoUrl,
                authorName: data.author_name,
                authorUrl: data.author_url,
                providerName: 'YouTube',
                providerUrl: 'https://www.youtube.com',
                image: proxiedThumb ?? undefined,
            };
        } catch (err) {
            console.error(`[Scraper] YouTube oEmbed failed for ${url}:`, err);
            const proxiedThumb = await this.proxyImage(fallbackThumbnailUrl, signal);
            return {
                ok: true,
                url,
                size: 0,
                contentType: 'text/html',
                mimeType: 'text/html',
                embedVideoUrl,
                providerName: 'YouTube',
                providerUrl: 'https://www.youtube.com',
                image: proxiedThumb ?? undefined,
            };
        }
    }

    public async fetchText(url: string, signal: AbortSignal): Promise<TextFetchResult> {
        console.log(`[Scraper] Starting text fetch for: ${url}`);

        try {
            const fetched = await this.fetchBytes(url, signal);
            if (!fetched.ok) return fetched;

            return {
                ok: true,
                url: fetched.currentUrl,
                size: fetched.totalSize,
                contentType: fetched.contentTypeHeader,
                body: fetched.data.toString('utf-8'),
            };
        } catch (error: unknown) {
            if (signal.aborted) {
                return { ok: false, url, reason: 'Request aborted' };
            }

            if (error instanceof Error) {
                if (error.name === 'TimeoutError') {
                    return { ok: false, url, reason: 'Request timed out' };
                }
                return { ok: false, url, reason: `Network error: ${error.message}` };
            }

            return { ok: false, url, reason: `Network error: ${String(error)}` };
        }
    }

    private async fetchBytes(
        url: string,
        signal: AbortSignal,
    ): Promise<
        | {
              ok: true;
              currentUrl: string;
              contentTypeHeader: string;
              data: Buffer;
              totalSize: number;
          }
        | { ok: false; url: string; reason: string }
    > {
        const originalUrl: string = url;
        let currentUrl: string = url;
        let redirects = 0;

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

            return {
                ok: true,
                currentUrl,
                contentTypeHeader,
                data: Buffer.concat(chunks),
                totalSize,
            };
        }
    }

    private async proxyImage(
        imageUrl: string,
        signal: AbortSignal,
        preFetchedData?: Buffer,
    ): Promise<string | null> {
        try {
            const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
            const cacheDir = path.join(process.cwd(), 'public', 'cache');
            const fileName = `${hash}.webp`;
            const filePath = path.join(cacheDir, fileName);

            await fs.mkdir(cacheDir, { recursive: true });

            try {
                await fs.access(filePath);
                return fileName;
            } catch (err) {
                // Cache miss, we need to process the image
                void err;
            }

            let buffer: Buffer;
            if (preFetchedData) {
                buffer = preFetchedData;
            } else {
                const fetched = await this.fetchBytes(imageUrl, signal);
                if (!fetched.ok) {
                    return null;
                }
                buffer = fetched.data;
            }

            const fileType = await fileTypeFromBuffer(buffer);
            const isAnimated = fileType?.mime === 'image/gif' || fileType?.mime === 'image/webp';

            await sharp(buffer, { animated: isAnimated })
                .resize(1200, 630, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(filePath);

            return fileName;
        } catch (err) {
            console.error(`[Scraper] proxyImage failed for ${imageUrl}:`, err);
            return null;
        }
    }
}
