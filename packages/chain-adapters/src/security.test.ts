import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors.js';
import {
  assertProviderUrlSafe,
  isPrivateOrReservedIp,
  validateProviderUrlSyntax,
} from './security.js';

const strictPolicy = {
  allowedHosts: ['api.mainnet.solana.com', '*.trusted.example'],
  allowPrivateNetworks: false,
};

describe('provider URL policy', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1'])(
    'blocks private or reserved IP %s',
    (address) => expect(isPrivateOrReservedIp(address)).toBe(true),
  );

  it('accepts an explicitly allowlisted HTTPS host', () => {
    expect(validateProviderUrlSyntax('https://api.mainnet.solana.com', strictPolicy).hostname).toBe(
      'api.mainnet.solana.com',
    );
  });

  it('rejects a deceptive allowlist suffix', () => {
    expect(() =>
      validateProviderUrlSyntax('https://api.mainnet.solana.com.attacker.test', strictPolicy),
    ).toThrow(ProviderError);
  });

  it('rejects embedded credentials and plaintext transport', () => {
    expect(() =>
      validateProviderUrlSyntax('https://user:secret@api.mainnet.solana.com', strictPolicy),
    ).toThrow('credentials');
    expect(() => validateProviderUrlSyntax('http://api.mainnet.solana.com', strictPolicy)).toThrow(
      'HTTPS',
    );
  });

  it('classifies public, mapped, malformed, and reserved addresses', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('999.1.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });

  it('accepts wildcard subdomains but not the wildcard root', () => {
    expect(validateProviderUrlSyntax('https://rpc.trusted.example', strictPolicy).hostname).toBe(
      'rpc.trusted.example',
    );
    expect(() => validateProviderUrlSyntax('https://trusted.example', strictPolicy)).toThrow(
      'allowlisted',
    );
  });

  it('rejects malformed URLs, private literal IPs, and non-HTTP protocols', () => {
    expect(() => validateProviderUrlSyntax('not a url', strictPolicy)).toThrow('absolute URL');
    expect(() =>
      validateProviderUrlSyntax('https://127.0.0.1', {
        allowedHosts: ['127.0.0.1'],
        allowPrivateNetworks: false,
      }),
    ).toThrow('Private or reserved');
    expect(() => validateProviderUrlSyntax('ftp://api.mainnet.solana.com', strictPolicy)).toThrow(
      'HTTPS',
    );
  });

  it('permits intentional local HTTP only under the private-network policy', async () => {
    const localPolicy = {
      allowedHosts: ['localhost'],
      allowPrivateNetworks: true,
      allowHttpForPrivateNetworks: true,
    };
    await expect(
      assertProviderUrlSafe('http://localhost:8899', localPolicy),
    ).resolves.toMatchObject({
      protocol: 'http:',
      hostname: 'localhost',
    });
  });

  it('checks DNS answers and rejects an allowlisted hostname resolving locally', async () => {
    await expect(
      assertProviderUrlSafe('https://localhost', {
        allowedHosts: ['localhost'],
        allowPrivateNetworks: false,
      }),
    ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED' });
  });
});
