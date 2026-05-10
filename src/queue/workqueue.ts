import { WorkQueueOptions, Job, WorkHandler } from '../types/queue.js';
import crypto from 'node:crypto';

export class WorkQueue<TInput, TOutput> {
    private readonly jobs = new Map<string, Job<TInput, TOutput>>();
    private readonly options: WorkQueueOptions;
    private readonly handler: WorkHandler<TInput, TOutput>;

    constructor(options: WorkQueueOptions, handler: WorkHandler<TInput, TOutput>) {
        this.options = options;
        this.handler = handler;
    }

    public async enqueue(input: TInput): Promise<TOutput> {
        if (this.size >= this.options.maxJobs) {
            return Promise.reject(new Error('Queue full'));
        }

        return new Promise<TOutput>((resolve, reject) => {
            const id: string = crypto.randomUUID();
            const controller: AbortController = new AbortController();
            const timer: NodeJS.Timeout = setTimeout(() => {
                const pendingJob: Job<TInput, TOutput> | undefined = this.jobs.get(id);
                if (pendingJob) {
                    pendingJob.reject(new Error('Job timeout'));
                    this.cleanup(id);
                }
            }, this.options.timeout);

            const job: Job<TInput, TOutput> = {
                id,
                input,
                resolve,
                reject,
                timer,
                controller,
            };

            this.jobs.set(id, job);
            this.run(job);
        });
    }

    private run(job: Job<TInput, TOutput>): void {
        this.handler(job.input, job.controller.signal)
            .then((result: TOutput) => {
                const activeJob: Job<TInput, TOutput> | undefined = this.jobs.get(job.id);
                if (activeJob) {
                    activeJob.resolve(result);
                    this.cleanup(job.id);
                }
            })
            .catch((error: Error) => {
                const activeJob: Job<TInput, TOutput> | undefined = this.jobs.get(job.id);
                if (activeJob) {
                    activeJob.reject(error);
                    this.cleanup(job.id);
                }
            });
    }

    private cleanup(id: string): void {
        const job: Job<TInput, TOutput> | undefined = this.jobs.get(id);
        if (job) {
            clearTimeout(job.timer);
            job.controller.abort();
            this.jobs.delete(id);
        }
    }

    public get size(): number {
        return this.jobs.size;
    }
}
