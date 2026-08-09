import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ProviderError } from './errors.js';

export interface ProviderUrlPolicy {
  allowedHosts: readonly string[];
  allowPrivateNetworks: boolean;
  allowHttpForPrivateNetworks?: boolean;
}

function matchesAllowedHost(hostname: string, allowed: string): boolean {
  const normalized = allowed.trim().toLowerCase();
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === normalized;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? '';
  if (normalized === '::' || normalized === '::1') return true;
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
    return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped?.[1] === undefined ? false : isPrivateIpv4(mapped[1]);
}

export function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export function validateProviderUrlSyntax(rawUrl: string, policy: ProviderUrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new ProviderError('INVALID_PROVIDER_URL', 'Provider URL is not a valid absolute URL.', {
      cause: error,
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new ProviderError(
      'INVALID_PROVIDER_URL',
      'Provider credentials must not be embedded in a URL.',
    );
  }
  if (
    url.protocol !== 'https:' &&
    !(policy.allowPrivateNetworks && policy.allowHttpForPrivateNetworks && url.protocol === 'http:')
  ) {
    throw new ProviderError('INVALID_PROVIDER_URL', 'Provider URL must use HTTPS.');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    policy.allowedHosts.length > 0 &&
    !policy.allowedHosts.some((host) => matchesAllowedHost(hostname, host))
  ) {
    throw new ProviderError(
      'PROVIDER_HOST_NOT_ALLOWED',
      `Provider host ${hostname} is not allowlisted.`,
    );
  }
  if (!policy.allowPrivateNetworks && isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname)) {
    throw new ProviderError(
      'PRIVATE_NETWORK_BLOCKED',
      'Private or reserved provider IP addresses are blocked.',
    );
  }
  return url;
}

export async function assertProviderUrlSafe(
  rawUrl: string,
  policy: ProviderUrlPolicy,
): Promise<URL> {
  const url = validateProviderUrlSyntax(rawUrl, policy);
  if (policy.allowPrivateNetworks || isIP(url.hostname) !== 0) return url;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new ProviderError('HTTP_ERROR', 'Provider hostname could not be resolved.', {
      retryable: true,
      cause: error,
    });
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new ProviderError(
      'PRIVATE_NETWORK_BLOCKED',
      'Provider hostname resolved to a private or reserved address.',
    );
  }
  return url;
}
