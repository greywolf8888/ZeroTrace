import { describe, it, expect } from 'vitest';
import { assertReadonlySuggestions } from './permissions.js';
describe('V9 unconditional LLM permission enforcement', () => {
  it('blocks transaction suggestions without injection keywords', () => {
    expect(() => assertReadonlySuggestions([{ tool: 'send_transaction', args: {} }])).toThrow(
      /NOT_ALLOWED/,
    );
  });
  it('allows only a read-only suggestion, not its unchecked execution', () => {
    expect(() =>
      assertReadonlySuggestions([{ tool: 'get_evidence', args: { id: 'ev_test' } }]),
    ).not.toThrow();
  });
  it('blocks prototype pollution and unbounded arguments', () => {
    expect(() =>
      assertReadonlySuggestions([{ tool: 'get_evidence', args: JSON.parse('{"__proto__":{}}') }]),
    ).toThrow();
    expect(() =>
      assertReadonlySuggestions(
        Array.from({ length: 13 }, () => ({ tool: 'get_evidence', args: {} })),
      ),
    ).toThrow();
  });
});
