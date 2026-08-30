/** Always enforced before any proposed tool is queued. This is not an execution dispatcher. */
export const READONLY_LLM_TOOLS = [
  'search_subject',
  'get_snapshot',
  'query_raw_fact',
  'get_evidence',
  'traverse_entity_graph',
  'get_supply_report',
  'get_campaign',
  'get_capital_ledger',
  'run_exit_scenario',
  'replay_finding',
] as const;
const ALLOWED = new Set<string>(READONLY_LLM_TOOLS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function safeJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('LLM_ARGUMENT_DEPTH');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('LLM_NONFINITE_ARGUMENT');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error('LLM_ARGUMENT_ARRAY_LIMIT');
    value.forEach((item) => safeJson(item, depth + 1));
    return;
  }
  if (typeof value !== 'object') throw new Error('LLM_NON_JSON_ARGUMENT');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error('LLM_ARGUMENT_PROTOTYPE');
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('LLM_FORBIDDEN_ARGUMENT_KEY');
    safeJson(item, depth + 1);
  }
}
export function assertReadonlySuggestions(items: readonly { tool: string; args: unknown }[]): void {
  if (items.length > 12) throw new Error('LLM_TOOL_BUDGET');
  for (const item of items) {
    // Never depend on spotting an English prompt-injection phrase.
    if (!ALLOWED.has(item.tool)) throw new Error('LLM_TOOL_NOT_ALLOWED: ' + item.tool);
    if (item.args === null || typeof item.args !== 'object' || Array.isArray(item.args)) {
      throw new Error('LLM_TOOL_ARGUMENTS_MUST_BE_OBJECT');
    }
    safeJson(item.args);
    if (JSON.stringify(item.args).length > 16_384) throw new Error('LLM_ARGUMENT_BYTES_LIMIT');
  }
}
