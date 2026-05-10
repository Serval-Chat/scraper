export interface WorkQueueOptions {
    maxJobs: number; // max concurrent jobs
    timeout: number; // ms before a job is rejected
}

export interface Job<TInput, TOutput> {
    id: string;
    input: TInput;
    resolve: (value: TOutput) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
    controller: AbortController;
}

export type WorkHandler<TInput, TOutput> = (input: TInput, signal: AbortSignal) => Promise<TOutput>;
