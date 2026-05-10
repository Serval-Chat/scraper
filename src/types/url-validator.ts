export interface UrlValidationSuccess {
    ok: true;
}

export interface UrlValidationFailure {
    ok: false;
    reason: string;
}

export type UrlValidationResult = UrlValidationSuccess | UrlValidationFailure;
