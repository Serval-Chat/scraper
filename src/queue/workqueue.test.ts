import { describe, it, expect, vi } from 'vitest';
import { WorkQueue } from './workqueue.js';
import { WorkQueueOptions } from '../types/queue.js';

describe('WorkQueue', () => {
    const defaultOptions: WorkQueueOptions = {
        maxJobs: 2,
        timeout: 100,
    };

    it('should process a job successfully', async () => {
        const handler = vi.fn(async (input: string): Promise<string> => {
            return `Processed: ${input}`;
        });
        const queue = new WorkQueue<string, string>(defaultOptions, handler);

        const result = await queue.enqueue('test');
        expect(result).toBe('Processed: test');
        expect(queue.size).toBe(0);
    });

    it('should reject when queue is full', async () => {
        const handler = async (): Promise<string> => {
            return new Promise<string>(() => {
                /* never resolves */
            });
        };
        const queue = new WorkQueue<string, string>(defaultOptions, handler);

        void queue.enqueue('job1');
        void queue.enqueue('job2');
        expect(queue.size).toBe(2);

        await expect(queue.enqueue('job3')).rejects.toThrow('Queue full');
    });

    it('should timeout a job and abort signal', async () => {
        vi.useFakeTimers();
        let aborted = false;
        const handler = async (_input: string, signal: AbortSignal): Promise<string> => {
            signal.addEventListener('abort', () => {
                aborted = true;
            });
            return new Promise<string>((resolve) => setTimeout(() => resolve('done'), 200));
        };
        const queue = new WorkQueue<string, string>(defaultOptions, handler);

        const promise = queue.enqueue('test');

        vi.advanceTimersByTime(defaultOptions.timeout + 1);

        await expect(promise).rejects.toThrow('Job timeout');
        expect(queue.size).toBe(0);
        expect(aborted).toBe(true);
        vi.useRealTimers();
    });

    it('should handle handler errors', async () => {
        const handler = async (): Promise<string> => {
            throw new Error('Handler failed');
        };
        const queue = new WorkQueue<string, string>(defaultOptions, handler);

        await expect(queue.enqueue('test')).rejects.toThrow('Handler failed');
        expect(queue.size).toBe(0);
    });

    it('should free capacity after job completion', async () => {
        const handler = async (input: string): Promise<string> => {
            if (input === 'fast') return 'fast done';
            return new Promise<string>((resolve) => setTimeout(() => resolve('slow done'), 50));
        };
        const queue = new WorkQueue<string, string>({ maxJobs: 1, timeout: 500 }, handler);

        const promise1 = queue.enqueue('slow');
        expect(queue.size).toBe(1);

        await expect(queue.enqueue('other')).rejects.toThrow('Queue full');

        await promise1;
        expect(queue.size).toBe(0);

        const result = await queue.enqueue('fast');
        expect(result).toBe('fast done');
    });
});
