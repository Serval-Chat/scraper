import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const FFPROBE_TIMEOUT_MS = 10_000;
const FFPROBE_MAX_BUFFER = 1024 * 1024;

export interface VideoDimensions {
    width: number;
    height: number;
}

interface FfprobeStream {
    width?: number;
    height?: number;
    side_data_list?: { rotation?: number }[];
}

export const parseFfprobeOutput = (stdout: string): VideoDimensions | null => {
    try {
        const parsed = JSON.parse(stdout) as { streams?: FfprobeStream[] };
        const stream = parsed.streams?.[0];
        if (!stream) return null;

        const { width, height } = stream;
        if (
            typeof width !== 'number' ||
            typeof height !== 'number' ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
        ) {
            return null;
        }

        const rotation = stream.side_data_list?.find(
            (entry) => typeof entry.rotation === 'number',
        )?.rotation;
        const quarterTurn =
            typeof rotation === 'number' && Math.abs(rotation % 180) === 90;

        return quarterTurn
            ? { width: height, height: width }
            : { width, height };
    } catch {
        return null;
    }
};

export const readVideoDimensions = async (
    buf: Buffer,
): Promise<VideoDimensions | null> => {
    const tmpPath = path.join(
        os.tmpdir(),
        `serchat-probe-${crypto.randomUUID()}`,
    );

    try {
        await fs.writeFile(tmpPath, buf);
        const { stdout } = await execFileAsync(
            'ffprobe',
            [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_streams',
                '-of',
                'json',
                tmpPath,
            ],
            { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: FFPROBE_MAX_BUFFER },
        );
        return parseFfprobeOutput(stdout);
    } catch (err) {
        console.error('[Scraper] ffprobe failed to read video dimensions:', err);
        return null;
    } finally {
        await fs.rm(tmpPath, { force: true }).catch((err: unknown): void => {
            console.error(`[Scraper] failed to clean up ${tmpPath}:`, err);
        });
    }
};
