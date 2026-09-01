import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFfprobeOutput, readVideoDimensions } from './video-dimensions.js';

const execFileAsync = promisify(execFile);

const ffmpegAvailable = ((): boolean => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

describe('parseFfprobeOutput', () => {
    const stream = (extra: Record<string, unknown> = {}): string =>
        JSON.stringify({ streams: [{ width: 1920, height: 1080, ...extra }] });

    it('reads width and height from the first video stream', () => {
        expect(parseFfprobeOutput(stream())).toEqual({
            width: 1920,
            height: 1080,
        });
    });

    it('swaps dimensions for a 90 degree display rotation', () => {
        expect(
            parseFfprobeOutput(stream({ side_data_list: [{ rotation: 90 }] })),
        ).toEqual({ width: 1080, height: 1920 });
    });

    it('swaps dimensions for a -90 degree display rotation', () => {
        expect(
            parseFfprobeOutput(stream({ side_data_list: [{ rotation: -90 }] })),
        ).toEqual({ width: 1080, height: 1920 });
    });

    it('leaves dimensions alone for a 180 degree rotation', () => {
        expect(
            parseFfprobeOutput(stream({ side_data_list: [{ rotation: 180 }] })),
        ).toEqual({ width: 1920, height: 1080 });
    });

    it('ignores side data entries that carry no rotation', () => {
        expect(
            parseFfprobeOutput(
                stream({ side_data_list: [{ some_other_field: 1 }] }),
            ),
        ).toEqual({ width: 1920, height: 1080 });
    });

    it('returns null when there are no streams', () => {
        expect(parseFfprobeOutput(JSON.stringify({ streams: [] }))).toBeNull();
    });

    it('returns null when dimensions are missing', () => {
        expect(
            parseFfprobeOutput(JSON.stringify({ streams: [{ codec: 'h264' }] })),
        ).toBeNull();
    });

    it('returns null for zero dimensions', () => {
        expect(
            parseFfprobeOutput(
                JSON.stringify({ streams: [{ width: 0, height: 0 }] }),
            ),
        ).toBeNull();
    });

    it('returns null for malformed json rather than throwing', () => {
        expect(parseFfprobeOutput('not json at all')).toBeNull();
    });

    it('returns null for empty output', () => {
        expect(parseFfprobeOutput('')).toBeNull();
    });
});

describe('readVideoDimensions (real ffprobe)', () => {
    let workDir = '';

    beforeAll(async () => {
        if (ffmpegAvailable) {
            workDir = path.join(
                os.tmpdir(),
                `serchat-vid-test-${crypto.randomUUID()}`,
            );
            await fs.mkdir(workDir, { recursive: true });
        }
    });

    afterAll(async () => {
        if (workDir) await fs.rm(workDir, { recursive: true, force: true });
    });

    const generate = async (args: string[], name: string): Promise<Buffer> => {
        const out = path.join(workDir, name);
        await execFileAsync('ffmpeg', ['-y', ...args, out]);
        return fs.readFile(out);
    };

    it.runIf(ffmpegAvailable)(
        'reads dimensions from a real mp4',
        async () => {
            const buf = await generate(
                [
                    '-f',
                    'lavfi',
                    '-i',
                    'testsrc=size=320x240:rate=10:duration=1',
                    '-pix_fmt',
                    'yuv420p',
                ],
                'plain.mp4',
            );
            await expect(readVideoDimensions(buf)).resolves.toEqual({
                width: 320,
                height: 240,
            });
        },
        20_000,
    );

    it.runIf(ffmpegAvailable)(
        'reads dimensions from a real webm',
        async () => {
            const buf = await generate(
                [
                    '-f',
                    'lavfi',
                    '-i',
                    'testsrc=size=256x144:rate=10:duration=1',
                    '-c:v',
                    'libvpx-vp9',
                    '-pix_fmt',
                    'yuv420p',
                ],
                'plain.webm',
            );
            await expect(readVideoDimensions(buf)).resolves.toEqual({
                width: 256,
                height: 144,
            });
        },
        30_000,
    );

    it.runIf(ffmpegAvailable)(
        'swaps dimensions for a rotated mp4, as phone video arrives',
        async () => {
            const source = path.join(workDir, 'preroto.mp4');
            await execFileAsync('ffmpeg', [
                '-y',
                '-f',
                'lavfi',
                '-i',
                'testsrc=size=320x240:rate=10:duration=1',
                '-pix_fmt',
                'yuv420p',
                source,
            ]);
            const out = path.join(workDir, 'rotated.mp4');
            await execFileAsync('ffmpeg', [
                '-y',
                '-display_rotation',
                '90',
                '-i',
                source,
                '-c',
                'copy',
                out,
            ]);
            const buf = await fs.readFile(out);
            await expect(readVideoDimensions(buf)).resolves.toEqual({
                width: 240,
                height: 320,
            });
        },
        20_000,
    );

    it('returns null for bytes that are not a video', async () => {
        await expect(
            readVideoDimensions(Buffer.from('definitely not a video file')),
        ).resolves.toBeNull();
    });

    it('returns null for an empty buffer', async () => {
        await expect(readVideoDimensions(Buffer.alloc(0))).resolves.toBeNull();
    });
});
