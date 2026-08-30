/** Read-only HTTP observation adapter. Defaults cannot authorize any network or spend.
 * Credentials, durable quota reservation, DNS/egress policy and dispatch leases are injected by
 * the existing provider-plane. No source is treated as independent of its upstream platform. */
export type JsonPath = readonly string[];
export interface SocialSourceConfig {
  id: string;
  origin: string | null;
  identityVerified: boolean;
  rightsApproved: boolean;
  enabled: boolean;
  contractVersion: string;
  upstreamGroup: 'X';
  documentation: string | null;
  authentication: {
    kind: 'NONE' | 'BEARER' | 'HEADER';
    secretRef: string | null;
    headerName: string | null;
  };
  search: {
    path: string;
    queryParameter: string;
    cursorParameter: string;
    countParameter: string | null;
    latestParameter: string | null;
    latestValue: string | null;
    maxCount: number;
    maxQueryChars: number;
    itemsPath: JsonPath;
    cursorPath: JsonPath;
    missingCursorMeansEnd: boolean;
    successPath: JsonPath | null;
    successValue: string | number | null;
    idPath: JsonPath;
    textPath: JsonPath;
    createdAtPath: JsonPath;
    authorIdPath: JsonPath | null;
    authorHandlePath: JsonPath | null;
  } | null;
}
export interface SearchPlan {
  sourceId: string;
  origin: string;
  url: string;
  contractVersion: string;
  queryVersion: string;
  cursor: string | null;
}
export interface SocialPost {
  id: string;
  text: string;
  createdAt: string;
  observedAt: string;
  authorId: string | null;
  authorHandle: string | null;
  sourceId: string;
  upstreamGroup: 'X';
  permalink: string;
}
export interface SearchPage {
  posts: SocialPost[];
  nextCursor: string | null;
}
function own(o: unknown, k: string): unknown {
  if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('UNSAFE_MAPPING_PATH');
  if (!o || typeof o !== 'object' || !Object.hasOwn(o, k)) return undefined;
  return (o as Record<string, unknown>)[k];
}
function at(o: unknown, p: JsonPath): unknown {
  if (p.length > 12) throw new Error('MAPPING_PATH_TOO_DEEP');
  let v = o;
  for (const k of p) v = own(v, k);
  return v;
}
function s(v: unknown, max = 200000): string {
  if (typeof v !== 'string' || v.length > max) throw new Error('SOURCE_SCHEMA_MISMATCH');
  return v;
}
function postId(v: unknown): string {
  const t = s(v, 25);
  if (!/^[1-9][0-9]*$/.test(t)) throw new Error('UNSAFE_POST_OR_USER_ID');
  return t;
}
export function validateOrigin(value: string | null): string {
  if (!value) throw new Error('SOURCE_IDENTITY_UNVERIFIED');
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !['', '/'].includes(u.pathname)
  )
    throw new Error('UNSAFE_SOURCE_ORIGIN');
  const h = u.hostname.toLowerCase();
  if (
    !h.includes('.') ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.test') ||
    h.includes(':') ||
    /^[0-9.]+$/.test(h)
  )
    throw new Error('NONPUBLIC_ORIGIN');
  return u.origin;
}
function ready(c: SocialSourceConfig): NonNullable<SocialSourceConfig['search']> {
  if (
    !c.enabled ||
    !c.identityVerified ||
    !c.rightsApproved ||
    !c.documentation ||
    !c.contractVersion ||
    !c.search
  )
    throw new Error('SOURCE_NOT_READY');
  if (
    !Number.isSafeInteger(c.search.maxCount) ||
    c.search.maxCount < 1 ||
    c.search.maxCount > 1000 ||
    !Number.isSafeInteger(c.search.maxQueryChars) ||
    c.search.maxQueryChars < 1 ||
    c.search.maxQueryChars > 20000
  )
    throw new Error('INVALID_SOURCE_LIMITS');
  return c.search;
}
export function makeSearchPlan(
  c: SocialSourceConfig,
  query: string,
  version: string,
  cursor: string | null = null,
  count = 30,
): SearchPlan {
  const e = ready(c),
    origin = validateOrigin(c.origin);
  if (!version || !query.trim() || /[\u0000-\u001f]/u.test(query) || query.length > e.maxQueryChars)
    throw new Error('INVALID_QUERY');
  if (!Number.isSafeInteger(count) || count < 1 || count > e.maxCount)
    throw new Error('INVALID_PAGE_SIZE');
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 8192))
    throw new Error('INVALID_CURSOR');
  if (
    !e.path.startsWith('/') ||
    e.path.startsWith('//') ||
    e.path.includes('?') ||
    e.path.includes('#') ||
    e.path.includes('\\') ||
    decodeURIComponent(e.path).split('/').includes('..')
  )
    throw new Error('UNSAFE_ENDPOINT_PATH');
  const url = new URL(e.path, origin);
  if (url.origin !== origin) throw new Error('ORIGIN_CHANGED');
  const names = [e.queryParameter, e.cursorParameter, e.countParameter, e.latestParameter].filter(
    (v): v is string => v !== null,
  );
  if (
    names.some((k) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)) ||
    new Set(names).size !== names.length
  )
    throw new Error('INVALID_PARAMETER_MAPPING');
  url.searchParams.set(e.queryParameter, query);
  if (cursor !== null) url.searchParams.set(e.cursorParameter, cursor);
  if (e.countParameter) url.searchParams.set(e.countParameter, String(count));
  if (e.latestParameter && e.latestValue) url.searchParams.set(e.latestParameter, e.latestValue);
  return {
    sourceId: c.id,
    origin,
    url: url.toString(),
    contractVersion: c.contractVersion,
    queryVersion: version,
    cursor,
  };
}
export function normalizeSearchPage(
  c: SocialSourceConfig,
  body: unknown,
  observedAt: string,
): SearchPage {
  const e = ready(c);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('INVALID_OBSERVATION_TIME');
  if (e.successPath && at(body, e.successPath) !== e.successValue)
    throw new Error('UPSTREAM_APPLICATION_ERROR');
  const items = at(body, e.itemsPath);
  if (!Array.isArray(items)) throw new Error('MISSING_RESULT_ARRAY');
  if (items.length > Math.max(e.maxCount * 4, 400)) throw new Error('UNEXPECTED_RESULT_SIZE');
  const rawCursor = at(body, e.cursorPath);
  if (rawCursor === undefined && !e.missingCursorMeansEnd)
    throw new Error('MISSING_CURSOR_CONTRACT');
  const nextCursor = rawCursor === undefined || rawCursor === null ? null : s(rawCursor, 8192);
  if (nextCursor === '') throw new Error('INVALID_EMPTY_CURSOR');
  const posts: SocialPost[] = [];
  const seen = new Map<string, string>();
  for (const item of items) {
    const id = postId(at(item, e.idPath)),
      text = s(at(item, e.textPath));
    const dt = s(at(item, e.createdAtPath), 100);
    if (!Number.isFinite(Date.parse(dt))) throw new Error('INVALID_POST_TIME');
    const a = e.authorIdPath ? at(item, e.authorIdPath) : undefined;
    const h = e.authorHandlePath ? at(item, e.authorHandlePath) : undefined;
    const authorId = a === undefined || a === null ? null : postId(a);
    const authorHandle = h === undefined || h === null ? null : s(h, 100);
    const p: SocialPost = {
      id,
      text,
      createdAt: new Date(dt).toISOString(),
      observedAt,
      authorId,
      authorHandle,
      sourceId: c.id,
      upstreamGroup: 'X',
      permalink: `https://x.com/i/status/${id}`,
    };
    const sig = JSON.stringify(p);
    if (seen.has(id)) {
      if (seen.get(id) !== sig) throw new Error('CONFLICTING_POST_VERSION');
      continue;
    }
    seen.set(id, sig);
    posts.push(p);
  }
  return { posts, nextCursor };
}
export interface FetchDependencies {
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  /** Must resolve DNS and enforce the deployment's approved public destination policy. */
  approvePublicOrigin: (origin: string) => Promise<boolean>;
  /** Atomically consumes a reserved, unexpired, plan-bound dispatch lease exactly once. */
  claimDispatch: (plan: SearchPlan) => Promise<boolean>;
  readSecret: (ref: string) => Promise<string>;
}
export async function fetchSearchPage(
  c: SocialSourceConfig,
  plan: SearchPlan,
  d: FetchDependencies,
  options: { timeoutMs: number; maxBytes: number },
  observedAt: string,
): Promise<SearchPage> {
  ready(c);
  const origin = validateOrigin(c.origin);
  if (
    plan.sourceId !== c.id ||
    plan.contractVersion !== c.contractVersion ||
    plan.origin !== origin ||
    new URL(plan.url).origin !== origin
  )
    throw new Error('PLAN_SOURCE_MISMATCH');
  // A persisted plan must still use the fixed approved endpoint. No arbitrary URL tool is exposed.
  if (new URL(plan.url).pathname !== new URL(c.search!.path, origin).pathname)
    throw new Error('PLAN_ENDPOINT_MISMATCH');
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120000 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > 20000000
  )
    throw new Error('INVALID_FETCH_LIMITS');
  if (!(await d.approvePublicOrigin(origin))) throw new Error('EGRESS_NOT_APPROVED');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const auth = c.authentication;
  if (auth.kind !== 'NONE') {
    if (!auth.secretRef) throw new Error('SECRET_REFERENCE_MISSING');
    const secret = await d.readSecret(auth.secretRef);
    if (!secret || /[\r\n]/.test(secret)) throw new Error('INVALID_CREDENTIAL');
    const key = auth.kind === 'BEARER' ? 'Authorization' : auth.headerName;
    if (!key || !/^(authorization|x-[a-z0-9-]+)$/i.test(key)) throw new Error('UNSAFE_AUTH_HEADER');
    headers[key] = auth.kind === 'BEARER' ? `Bearer ${secret}` : secret;
  }
  if (!(await d.claimDispatch(plan))) throw new Error('BUDGET_OR_DISPATCH_NOT_APPROVED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const r = await d.fetcher(plan.url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`SOURCE_HTTP_${r.status}`);
    if (r.url && new URL(r.url).origin !== origin) throw new Error('RESPONSE_ORIGIN_CHANGED');
    if (!r.headers.get('content-type')?.toLowerCase().includes('json'))
      throw new Error('SOURCE_NOT_JSON');
    const length = r.headers.get('content-length');
    if (length && Number(length) > options.maxBytes) throw new Error('BODY_LIMIT');
    if (!r.body) throw new Error('EMPTY_BODY');
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > options.maxBytes) {
          await reader.cancel();
          throw new Error('BODY_LIMIT');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const b of chunks) {
      merged.set(b, offset);
      offset += b.length;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
    } catch {
      throw new Error('SOURCE_INVALID_JSON');
    }
    return normalizeSearchPage(c, body, observedAt);
  } finally {
    clearTimeout(timer);
  }
}
export const FXEMBED_TEMPLATE: SocialSourceConfig = {
  id: 'fxembed',
  origin: 'https://api.fxtwitter.com',
  identityVerified: true,
  rightsApproved: false,
  enabled: false,
  documentation: 'https://docs.fxembed.com/api/twitter/operations/2search/',
  contractVersion: 'fxembed-docs-2026-08-30',
  upstreamGroup: 'X',
  authentication: { kind: 'NONE', secretRef: null, headerName: null },
  search: {
    path: '/2/search',
    queryParameter: 'q',
    cursorParameter: 'cursor',
    countParameter: 'count',
    latestParameter: 'feed',
    latestValue: 'latest',
    maxCount: 100,
    maxQueryChars: 512,
    itemsPath: ['results'],
    cursorPath: ['cursor', 'bottom'],
    missingCursorMeansEnd: false,
    successPath: ['code'],
    successValue: 200,
    idPath: ['id'],
    textPath: ['text'],
    createdAtPath: ['created_at'],
    authorIdPath: ['author', 'id'],
    authorHandlePath: ['author', 'screen_name'],
  },
};
export const XAPID_TEMPLATE: SocialSourceConfig = {
  id: 'xapid',
  origin: null,
  identityVerified: false,
  rightsApproved: false,
  enabled: false,
  documentation: null,
  contractVersion: 'UNVERIFIED',
  upstreamGroup: 'X',
  authentication: { kind: 'NONE', secretRef: null, headerName: null },
  search: null,
};
