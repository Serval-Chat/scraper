export interface FetchSuccess {
    ok: true;
    url: string; // final URL after redirects
    size: number; // bytes
    contentType: string;
    mimeType: string;
    title?: string;
    description?: string;
    image?: string;
    video?: string;
    providerName?: string;
    themeColor?: string;
}

export interface FetchFailure {
    ok: false;
    url: string; // original URL
    reason: string;
}

export type FetchResult = FetchSuccess | FetchFailure;

export interface FetcherOptions {
    maxRedirects: number;
    maxFetchSize: number; // bytes
    allowedContentTypes: string[];
    timeout: number; // ms
}
