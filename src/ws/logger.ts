export interface ILogger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
}

export class ConsoleLogger implements ILogger {
    readonly #prefix: string;

    constructor(prefix = '') {
        this.#prefix = prefix;
    }

    #fmt(msg: string): string {
        return this.#prefix ? `[${this.#prefix}] ${msg}` : msg;
    }

    debug(msg: string, ...args: unknown[]): void {
        console.debug(this.#fmt(msg), ...args);
    }

    info(msg: string, ...args: unknown[]): void {
        console.info(this.#fmt(msg), ...args);
    }

    warn(msg: string, ...args: unknown[]): void {
        console.warn(this.#fmt(msg), ...args);
    }

    error(msg: string, ...args: unknown[]): void {
        console.error(this.#fmt(msg), ...args);
    }
}

export class SilentLogger implements ILogger {
    debug(_msg: string, ..._args: unknown[]): void {
        void 0;
    }
    info(_msg: string, ..._args: unknown[]): void {
        void 0;
    }
    warn(_msg: string, ..._args: unknown[]): void {
        void 0;
    }
    error(_msg: string, ..._args: unknown[]): void {
        void 0;
    }
}
