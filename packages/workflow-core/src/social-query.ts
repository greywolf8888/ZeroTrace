export interface QueryIdentity {
  chain: 'BSC' | 'SOLANA';
  address: string;
  verifiedHandle?: string;
  aliases?: readonly string[];
}
function phrase(s: string): string {
  if (
    !s.trim() ||
    s.length > 160 ||
    [...s].some(
      (character) => character === '"' || character === '\\' || character.charCodeAt(0) <= 31,
    )
  )
    throw new Error('UNSAFE_QUERY_TERM');
  return `"${s.trim()}"`;
}
export function buildIdentityQueries(
  i: QueryIdentity,
  version: string,
): { assetKey: string; version: string; queries: { role: string; query: string }[] } {
  if (!version) throw new Error('QUERY_VERSION_REQUIRED');
  if (
    i.chain === 'BSC'
      ? !/^0x[0-9a-fA-F]{40}$/.test(i.address)
      : !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(i.address)
  )
    throw new Error('INVALID_CHAIN_ADDRESS');
  // Solana lexical check is not mint validation: downstream must verify decoded length, account owner/type.
  const addr = i.chain === 'BSC' ? i.address.toLowerCase() : i.address;
  const queries = [
    { role: 'IDENTITY', query: phrase(addr) },
    {
      role: 'COUNTEREVIDENCE',
      query: `${phrase(addr)} ("cannot sell" OR honeypot OR "无法卖出" OR "撤池")`,
    },
  ];
  if (i.verifiedHandle) {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(i.verifiedHandle)) throw new Error('INVALID_HANDLE');
    queries.push({ role: 'DECLARED_ACCOUNT', query: `from:${i.verifiedHandle}` });
  }
  for (const a of (i.aliases ?? []).slice(0, 8))
    queries.push({ role: 'ALIAS_LEAD_ONLY', query: phrase(a) });
  return { assetKey: `${i.chain}:${addr}`, version, queries };
}
export function compileApprovedQuery(q: string, maxChars: number, approvedVersion: string): string {
  if (
    !approvedVersion ||
    !Number.isSafeInteger(maxChars) ||
    maxChars <= 0 ||
    q.length > maxChars ||
    [...q].some(
      (character) => character === '\r' || character === '\n' || character.charCodeAt(0) === 0,
    )
  )
    throw new Error('QUERY_NOT_APPROVED_OR_TOO_LONG');
  return q; // Provider syntax/capability probing remains mandatory, not silently rewritten.
}
