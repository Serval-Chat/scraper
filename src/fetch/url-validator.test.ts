import { describe, it, expect, vi } from 'vitest';
import { validateUrl } from './url-validator.js';
import type { LookupAddress } from 'node:dns';
import * as dns from 'node:dns/promises';

vi.mock('node:dns/promises', () => ({
    lookup: vi.fn(),
}));

describe('validateUrl', () => {
    const mockDns = (address: string, family = 4): void => {
        vi.mocked(dns.lookup).mockResolvedValue({ address, family } as unknown as LookupAddress);
    };

    const mockDnsFail = (): void => {
        vi.mocked(dns.lookup).mockRejectedValue(new Error('DNS failed'));
    };

    describe('Scheme checks', () => {
        it('should allow http', async () => {
            mockDns('1.1.1.1');
            const result = await validateUrl('http://example.com');
            expect(result.ok).toBe(true);
        });

        it('should allow https', async () => {
            mockDns('1.1.1.1');
            const result = await validateUrl('https://example.com');
            expect(result.ok).toBe(true);
        });

        it('should block ftp', async () => {
            const result = await validateUrl('ftp://example.com');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('URL not allowed: invalid scheme');
        });

        it('should block file', async () => {
            const result = await validateUrl('file:///etc/passwd');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('URL not allowed: invalid scheme');
        });

        it('should block javascript', async () => {
            const result = await validateUrl('javascript:alert(1)');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('URL not allowed: invalid scheme');
        });
    });

    describe('Loopback checks', () => {
        it('should block 127.0.0.1', async () => {
            mockDns('127.0.0.1');
            const result = await validateUrl('http://127.0.0.1');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('URL not allowed');
        });

        it('should block 127.0.0.2', async () => {
            mockDns('127.0.0.2');
            const result = await validateUrl('http://127.0.0.2');
            expect(result.ok).toBe(false);
        });

        it('should block localhost hostname', async () => {
            const result = await validateUrl('http://localhost');
            expect(result.ok).toBe(false);
        });

        it('should block ::1 IPv6 loopback', async () => {
            mockDns('::1', 6);
            const result = await validateUrl('http://[::1]');
            expect(result.ok).toBe(false);
        });
    });

    describe('Private range checks', () => {
        it('should block 10.0.0.1', async () => {
            mockDns('10.0.0.1');
            const result = await validateUrl('http://10.0.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 10.255.255.255', async () => {
            mockDns('10.255.255.255');
            const result = await validateUrl('http://10.255.255.255');
            expect(result.ok).toBe(false);
        });

        it('should block 172.16.0.1', async () => {
            mockDns('172.16.0.1');
            const result = await validateUrl('http://172.16.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 172.31.255.255', async () => {
            mockDns('172.31.255.255');
            const result = await validateUrl('http://172.31.255.255');
            expect(result.ok).toBe(false);
        });

        it('should pass 172.15.255.255', async () => {
            mockDns('172.15.255.255');
            const result = await validateUrl('http://172.15.255.255');
            expect(result.ok).toBe(true);
        });

        it('should block 192.168.0.1', async () => {
            mockDns('192.168.0.1');
            const result = await validateUrl('http://192.168.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 192.168.255.255', async () => {
            mockDns('192.168.255.255');
            const result = await validateUrl('http://192.168.255.255');
            expect(result.ok).toBe(false);
        });
    });

    describe('CGNAT and special checks', () => {
        it('should block 100.64.0.1', async () => {
            mockDns('100.64.0.1');
            const result = await validateUrl('http://100.64.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 100.127.255.255', async () => {
            mockDns('100.127.255.255');
            const result = await validateUrl('http://100.127.255.255');
            expect(result.ok).toBe(false);
        });

        it('should pass 100.63.255.255', async () => {
            mockDns('100.63.255.255');
            const result = await validateUrl('http://100.63.255.255');
            expect(result.ok).toBe(true);
        });

        it('should block 192.0.0.1', async () => {
            mockDns('192.0.0.1');
            const result = await validateUrl('http://192.0.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 192.0.2.1', async () => {
            mockDns('192.0.2.1');
            const result = await validateUrl('http://192.0.2.1');
            expect(result.ok).toBe(false);
        });

        it('should block 198.51.100.1', async () => {
            mockDns('198.51.100.1');
            const result = await validateUrl('http://198.51.100.1');
            expect(result.ok).toBe(false);
        });

        it('should block 203.0.113.1', async () => {
            mockDns('203.0.113.1');
            const result = await validateUrl('http://203.0.113.1');
            expect(result.ok).toBe(false);
        });

        it('should block 198.18.0.1', async () => {
            mockDns('198.18.0.1');
            const result = await validateUrl('http://198.18.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 198.19.255.255', async () => {
            mockDns('198.19.255.255');
            const result = await validateUrl('http://198.19.255.255');
            expect(result.ok).toBe(false);
        });
    });

    describe('Reserved and Link-local checks', () => {
        it('should block 240.0.0.1', async () => {
            mockDns('240.0.0.1');
            const result = await validateUrl('http://240.0.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 254.255.255.255', async () => {
            mockDns('254.255.255.255');
            const result = await validateUrl('http://254.255.255.255');
            expect(result.ok).toBe(false);
        });

        it('should block 255.255.255.255 broadcast', async () => {
            mockDns('255.255.255.255');
            const result = await validateUrl('http://255.255.255.255');
            expect(result.ok).toBe(false);
        });

        it('should block 0.0.0.1', async () => {
            mockDns('0.0.0.1');
            const result = await validateUrl('http://0.0.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block 169.254.0.1', async () => {
            mockDns('169.254.0.1');
            const result = await validateUrl('http://169.254.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block AWS metadata IP 169.254.169.254', async () => {
            mockDns('169.254.169.254');
            const result = await validateUrl('http://169.254.169.254');
            expect(result.ok).toBe(false);
        });
    });

    describe('IPv6 checks', () => {
        it('should block fc00::1', async () => {
            mockDns('fc00::1', 6);
            const result = await validateUrl('http://[fc00::1]');
            expect(result.ok).toBe(false);
        });

        it('should block fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', async () => {
            mockDns('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 6);
            const result = await validateUrl('http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]');
            expect(result.ok).toBe(false);
        });

        it('should block fe80::1', async () => {
            mockDns('fe80::1', 6);
            const result = await validateUrl('http://[fe80::1]');
            expect(result.ok).toBe(false);
        });

        it('should block febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', async () => {
            mockDns('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 6);
            const result = await validateUrl('http://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]');
            expect(result.ok).toBe(false);
        });

        it('should block ::ffff:127.0.0.1 mapped loopback', async () => {
            mockDns('::ffff:127.0.0.1', 6);
            const result = await validateUrl('http://[::ffff:127.0.0.1]');
            expect(result.ok).toBe(false);
        });

        it('should block ::ffff:192.168.1.1 mapped private', async () => {
            mockDns('::ffff:192.168.1.1', 6);
            const result = await validateUrl('http://[::ffff:192.168.1.1]');
            expect(result.ok).toBe(false);
        });

        it('should block ::ffff:10.0.0.1 mapped private', async () => {
            mockDns('::ffff:10.0.0.1', 6);
            const result = await validateUrl('http://[::ffff:10.0.0.1]');
            expect(result.ok).toBe(false);
        });

        it('should block ::ffff:169.254.169.254 mapped AWS metadata', async () => {
            mockDns('::ffff:169.254.169.254', 6);
            const result = await validateUrl('http://[::ffff:169.254.169.254]');
            expect(result.ok).toBe(false);
        });
    });

    describe('DNS and boundary cases', () => {
        it('should handle DNS failure', async () => {
            mockDnsFail();
            const result = await validateUrl('http://nonexistent.com');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('URL not allowed: DNS resolution failed');
        });

        it('should block empty string', async () => {
            const result = await validateUrl('');
            expect(result.ok).toBe(false);
        });

        it('should block not a valid URL', async () => {
            const result = await validateUrl('not a url');
            expect(result.ok).toBe(false);
        });

        it('should block URL with no hostname', async () => {
            const result = await validateUrl('http:///path');
            expect(result.ok).toBe(false);
        });

        it('should allow valid public IP (1.1.1.1)', async () => {
            mockDns('1.1.1.1');
            const result = await validateUrl('http://1.1.1.1');
            expect(result.ok).toBe(true);
        });

        it('should allow valid public IP (8.8.8.8)', async () => {
            mockDns('8.8.8.8');
            const result = await validateUrl('http://8.8.8.8');
            expect(result.ok).toBe(true);
        });

        it('should allow valid public hostname (example.com)', async () => {
            mockDns('93.184.216.34');
            const result = await validateUrl('https://example.com');
            expect(result.ok).toBe(true);
        });
    });

    describe('Edge case bypass attempts', () => {
        it('should block space in IP', async () => {
            const result = await validateUrl('http://1.1.1. 1');
            expect(result.ok).toBe(false);
        });

        it('should block space before TLD', async () => {
            const result = await validateUrl('http://evil.com .1.1.1.1');
            expect(result.ok).toBe(false);
        });

        it('should block URL encoded space as bypass', async () => {
            const result = await validateUrl('http://evil.com%20.1.1.1.1');
            expect(result.ok).toBe(false);
        });

        it('should block tab character in hostname', async () => {
            const result = await validateUrl('http://1.1.1.1%09');
            expect(result.ok).toBe(false);
        });

        it('should block newline in hostname', async () => {
            const result = await validateUrl('http://1.1.1.1%0a');
            expect(result.ok).toBe(false);
        });

        it('should block carriage return in hostname', async () => {
            const result = await validateUrl('http://1.1.1.1%0d');
            expect(result.ok).toBe(false);
        });

        it('should block null byte in hostname', async () => {
            const result = await validateUrl('http://1.1.1.1%00');
            expect(result.ok).toBe(false);
        });

        it('should block double slash bypass attempt', async () => {
            const result = await validateUrl('http://1.1.1.1//');
            expect(result.ok).toBe(false);
        });

        it('should block leading whitespace', async () => {
            const result = await validateUrl('   http://1.1.1.1');
            expect(result.ok).toBe(false);
        });

        it('should block mixed case scheme bypass (HTTP)', async () => {
            mockDns('127.0.0.1');
            const result = await validateUrl('HTTP://127.0.0.1');
            expect(result.ok).toBe(false);
        });

        it('should block credentials in URL as bypass attempt', async () => {
            mockDns('93.184.216.34');
            const result = await validateUrl('http://127.0.0.1:80@evil.com');
            expect(result.ok).toBe(false);
        });

        it('should block hostname confusion via @ symbol', async () => {
            mockDns('127.0.0.1');
            const result = await validateUrl('http://evil.com@127.0.0.1');
            expect(result.ok).toBe(false);
        });
    });
});
