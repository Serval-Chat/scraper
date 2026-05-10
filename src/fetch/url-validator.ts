import { lookup } from 'node:dns/promises';
import { UrlValidationResult } from '../types/url-validator.js';

function ipv4ToLong(ip: string): number {
    const parts: number[] = ip.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv4InSubnet(ipLong: number, subnet: string, bits: number): boolean {
    const mask: number = bits === 0 ? 0 : ~(Math.pow(2, 32 - bits) - 1) >>> 0;
    const subnetLong: number = ipv4ToLong(subnet);
    return (ipLong & mask) === (subnetLong & mask);
}

function isIPv4Blocked(ip: string): boolean {
    const ipLong: number = ipv4ToLong(ip);
    const blockedSubnets: { range: string; mask: number }[] = [
        { range: '0.0.0.0', mask: 8 },
        { range: '10.0.0.0', mask: 8 },
        { range: '100.64.0.0', mask: 10 },
        { range: '127.0.0.0', mask: 8 },
        { range: '169.254.0.0', mask: 16 },
        { range: '172.16.0.0', mask: 12 },
        { range: '192.0.0.0', mask: 24 },
        { range: '192.0.2.0', mask: 24 },
        { range: '192.168.0.0', mask: 16 },
        { range: '198.18.0.0', mask: 15 },
        { range: '198.51.100.0', mask: 24 },
        { range: '203.0.113.0', mask: 24 },
        { range: '240.0.0.0', mask: 4 },
        { range: '255.255.255.255', mask: 32 },
    ];

    return blockedSubnets.some((s) => isIPv4InSubnet(ipLong, s.range, s.mask));
}

function isIPv6Blocked(ip: string): boolean {
    const lower: string = ip.toLowerCase();

    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (
        lower.startsWith('fe8') ||
        lower.startsWith('fe9') ||
        lower.startsWith('fea') ||
        lower.startsWith('feb')
    )
        return true;

    if (lower.startsWith('::ffff:')) {
        const ipv4Part: string = ip.split(':').pop() || '';
        if (ipv4Part.includes('.')) {
            return isIPv4Blocked(ipv4Part);
        }
    }

    return false;
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
    try {
        if (url.trimStart() !== url) {
            return { ok: false, reason: 'URL not allowed' };
        }

        const parsed: URL = new URL(url);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { ok: false, reason: 'URL not allowed: invalid scheme' };
        }

        const hostname: string = parsed.hostname;
        if (!hostname) {
            return { ok: false, reason: 'URL not allowed' };
        }

        if (
            hostname.includes(' ') ||
            hostname.includes('\t') ||
            hostname.includes('\n') ||
            hostname.includes('\r') ||
            hostname.includes('\0')
        ) {
            return { ok: false, reason: 'URL not allowed' };
        }

        if (hostname.toLowerCase() === 'localhost') {
            return { ok: false, reason: 'URL not allowed' };
        }

        if (parsed.username || parsed.password) {
            return { ok: false, reason: 'URL not allowed' };
        }

        if (parsed.pathname.includes('//')) {
            return { ok: false, reason: 'URL not allowed' };
        }

        let address: string;
        let family: number;
        try {
            const result = await lookup(hostname);
            address = result.address;
            family = result.family;
        } catch {
            return { ok: false, reason: 'URL not allowed: DNS resolution failed' };
        }

        if (family === 4) {
            if (isIPv4Blocked(address)) {
                return { ok: false, reason: 'URL not allowed' };
            }
        } else if (family === 6) {
            if (isIPv6Blocked(address)) {
                return { ok: false, reason: 'URL not allowed' };
            }
        }

        return { ok: true };
    } catch {
        return { ok: false, reason: 'URL not allowed' };
    }
}
