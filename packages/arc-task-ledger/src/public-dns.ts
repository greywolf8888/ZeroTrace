import { isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import { isPrivateOrReservedIp } from '@zerotrace/chain-adapters/security';
import { LedgerError } from './types.js';

// 可选、进程内 Google Public DNS HTTPS 解析；固定官方 bootstrap，TLS 仍核验 dns.google。
// 来源 https://developers.google.com/speed/public-dns/docs/doh/json 与 /using（8.8.8.8）。
export function validatePublicAnswers(answer: {
  Status?: number;
  TC?: boolean;
  Answer?: { type: number; data: string; TTL: number }[];
}) {
  const addresses = (answer.Answer ?? [])
    .filter((a) => a.type === 1)
    .map((a) => ({ address: a.data, family: 4 }));
  if (
    answer.Status !== 0 ||
    answer.TC === true ||
    addresses.length === 0 ||
    addresses.some((a) => isIP(a.address) !== 4 || isPrivateOrReservedIp(a.address))
  )
    throw new LedgerError('PRIVATE_NETWORK_BLOCKED', '公共 DNS 未返回可安全连接的公网地址。');
  return addresses;
}
export function createPublicDns(hosts: readonly string[]) {
  const agent = new Agent({
    connect: {
      lookup(_host, options, callback) {
        if (options.all) callback(null, [{ address: '8.8.8.8', family: 4 }]);
        else callback(null, '8.8.8.8', 4);
      },
    },
  });
  const observations: {
    hostname: string;
    source: string;
    retrievedAt: string;
    response: unknown;
  }[] = [];
  const cache = new Map<
    string,
    { expires: number; addresses: { address: string; family: number }[] }
  >();
  return {
    observations,
    async resolve(hostname: string) {
      if (!hosts.includes(hostname))
        throw new LedgerError('PROVIDER_HOST_NOT_ALLOWED', '公共解析仅限登记的 RPC 主机。', 403);
      const cached = cache.get(hostname);
      if (cached && cached.expires > Date.now()) return cached.addresses;
      const source = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`;
      const response = await fetch(source, {
        dispatcher: agent,
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok)
        throw Object.assign(new Error('公共 DNS 不可用。'), {
          code: 'HTTP_ERROR',
          statusCode: response.status,
        });
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.byteLength;
        if (size > 8192) {
          await response.body?.cancel().catch(() => undefined);
          throw new LedgerError('DNS_RESPONSE_LIMIT', 'DNS 响应超出上限。');
        }
        parts.push(chunk);
      }
      const raw = Buffer.concat(parts).toString('utf8');
      const answer = JSON.parse(raw) as {
        Status: number;
        TC?: boolean;
        Answer?: { type: number; data: string; TTL: number }[];
      };
      const addresses = validatePublicAnswers(answer);
      const ttl = Math.min(
        60,
        ...answer
          .Answer!.filter((a) => a.type === 1)
          .map((a) => (Number.isFinite(a.TTL) ? Math.max(1, a.TTL) : 1)),
      );
      observations.push({
        hostname,
        source,
        retrievedAt: new Date().toISOString(),
        response: answer,
      });
      cache.set(hostname, { expires: Date.now() + ttl * 1000, addresses });
      return addresses;
    },
    close: () => agent.close(),
  };
}
