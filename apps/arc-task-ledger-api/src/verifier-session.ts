import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { LedgerError } from '@zerotrace/arc-task-ledger';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function verifierSessions(secret: string) {
  const mac = (purpose: string, value: string) =>
    createHmac('sha256', secret).update(`zasv:${purpose}:v1:${value}`).digest('base64url');
  const equal = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const read = (request: FastifyRequest): string | null => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : request.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('zasv_session='))
          ?.slice(13);
    if (!token || token.length > 300) return null;
    const [nonce, expiry, sig, ...extra] = token.split('.');
    if (
      extra.length ||
      !nonce ||
      !/^[\w-]{43}$/.test(nonce) ||
      !expiry ||
      !/^\d{13}$/.test(expiry) ||
      !sig ||
      !equal(sig, mac('session', `${nonce}.${expiry}`)) ||
      +expiry < Date.now() ||
      +expiry > Date.now() + 604800000
    )
      return null;
    return token;
  };
  const origin = (request: FastifyRequest) => {
    const value = request.headers.origin;
    if (!value) {
      if (
        request.headers['x-arc-client'] !== 'zasv-sdk-v1' ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'none')
      )
        throw new LedgerError('ORIGIN_REQUIRED', '浏览器请求需要受信任来源。', 403);
      return;
    }
    const allowed = [
      process.env.ARC_PUBLIC_ORIGIN ?? 'https://web--atl-web--xtd599t97njk.code.run',
    ];
    if (['localhost', '127.0.0.1'].includes(request.hostname))
      allowed.push('http://127.0.0.1:5195', 'http://localhost:5195');
    if (!allowed.includes(value) || request.headers['sec-fetch-site'] === 'cross-site')
      throw new LedgerError('ORIGIN_REJECTED', '请求来源未授权。', 403);
  };
  return {
    issue(request: FastifyRequest, reply: FastifyReply) {
      origin(request);
      const token =
        read(request) ?? `${randomBytes(32).toString('base64url')}.${Date.now() + 604800000}`;
      const signed = token.split('.').length === 3 ? token : `${token}.${mac('session', token)}`;
      const secure = !['localhost', '127.0.0.1'].includes(request.hostname);
      reply.header(
        'set-cookie',
        `zasv_session=${signed}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure ? '; Secure' : ''}`,
      );
      return {
        csrfToken: mac('csrf', signed),
        expiresAt: new Date(+signed.split('.')[1]!).toISOString(),
        ...(request.headers.origin ? {} : { sessionToken: signed }),
      };
    },
    owner(request: FastifyRequest, required = false) {
      const token = read(request);
      if (!token && required)
        throw new LedgerError('SESSION_REQUIRED', '请建立自己的核验会话。', 401);
      return token ? mac('owner', token) : null;
    },
    authorize(request: FastifyRequest) {
      origin(request);
      const token = read(request);
      if (!token) throw new LedgerError('SESSION_REQUIRED', '请建立自己的核验会话。', 401);
      const csrf = request.headers['x-zasv-csrf'];
      if (typeof csrf !== 'string' || !equal(csrf, mac('csrf', token)))
        throw new LedgerError('CSRF_REJECTED', '请求校验凭据不正确。', 403);
      return mac('owner', token);
    },
  };
}
