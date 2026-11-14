import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';
export { canonicalJson } from './canonical.js';

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
