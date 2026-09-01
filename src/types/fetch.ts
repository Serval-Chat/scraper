export interface FetchSuccess {
    ok: true;
    url: string; // final URL after redirects
    size: number; // bytes
    contentType: string;
    mimeType: string;
    title?: string;
    description?: string;
    image?: string;
    imageWidth?: number;
    imageHeight?: number;
    video?: string;
    videoWidth?: number;
    videoHeight?: number;
    embedVideoUrl?: string;
    authorName?: string;
    authorUrl?: string;
    providerName?: string;
    providerUrl?: string;
    themeColor?: string;
}

export interface TextFetchSuccess {
    ok: true;
    url: string; // final URL after redirects
    size: number; // bytes
    contentType: string;
    body: string;
}

export interface FetchFailure {
    ok: false;
    url: string; // original URL
    reason: string;
}

export type FetchResult = FetchSuccess | FetchFailure;
export type TextFetchResult = TextFetchSuccess | FetchFailure;

export interface FetcherOptions {
    maxRedirects: number;
    maxFetchSize: number; // bytes
    allowedContentTypes: string[];
    timeout: number; // ms
}
