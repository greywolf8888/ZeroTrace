import { describe, expect, it } from 'vitest';

import {
  independentSourceCount,
  selectLabelsForAi,
  visibleLabelAt,
  type ObservationLabel,
} from './observation-policy.js';

function label(overrides: Partial<ObservationLabel> = {}): ObservationLabel {
  return {
    id: 'label-1',
    chain: 'BSC',
    address: `0x${'1'.repeat(40)}`,
    label: '测试标签',
    source: 'source-a',
    upstreamGroup: 'group-a',
    knownAt: '2026-01-01T00:00:00.000Z',
    validFrom: null,
    validUntil: null,
    revokedAt: null,
    revocationKnownAt: null,
    visibility: 'PRIVATE',
    externalAiAllowed: true,
    kind: 'SOURCE_CLAIM',
    ...overrides,
  };
}

const asOf = '2026-01-02T00:00:00.000Z';

describe('point-in-time label observation policy', () => {
  it('keeps future knowledge, validity windows, and revocation knowledge distinct', () => {
    expect(visibleLabelAt(label(), asOf)).toBe(true);
    expect(visibleLabelAt(label({ knownAt: '2026-01-03T00:00:00.000Z' }), asOf)).toBe(false);
    expect(visibleLabelAt(label({ validFrom: '2026-01-03T00:00:00.000Z' }), asOf)).toBe(false);
    expect(visibleLabelAt(label({ validUntil: asOf }), asOf)).toBe(false);
    expect(
      visibleLabelAt(
        label({
          revokedAt: '2026-01-01T12:00:00.000Z',
          revocationKnownAt: '2026-01-03T00:00:00.000Z',
        }),
        asOf,
      ),
    ).toBe(true);
    expect(
      visibleLabelAt(
        label({
          revokedAt: '2026-01-03T00:00:00.000Z',
          revocationKnownAt: '2026-01-01T12:00:00.000Z',
        }),
        asOf,
      ),
    ).toBe(true);
    expect(
      visibleLabelAt(
        label({
          revokedAt: '2026-01-01T12:00:00.000Z',
          revocationKnownAt: '2026-01-01T13:00:00.000Z',
        }),
        asOf,
      ),
    ).toBe(false);
    expect(() => visibleLabelAt(label({ revokedAt: asOf }), asOf)).toThrow(
      'REVOCATION_KNOWLEDGE_TIME_REQUIRED',
    );
  });

  it('rejects invalid times instead of treating them as current state', () => {
    expect(() => visibleLabelAt(label(), 'invalid')).toThrow('INVALID_OBSERVATION_TIME');
    expect(() => visibleLabelAt(label({ knownAt: 'invalid' }), asOf)).toThrow(
      'INVALID_OBSERVATION_TIME',
    );
    expect(() => visibleLabelAt(label({ validFrom: 'invalid' }), asOf)).toThrow(
      'INVALID_OBSERVATION_TIME',
    );
    expect(() => visibleLabelAt(label({ validUntil: 'invalid' }), asOf)).toThrow(
      'INVALID_OBSERVATION_TIME',
    );
  });

  it('exports only explicitly allowed visible observations to AI', () => {
    expect(
      selectLabelsForAi(
        [
          label({ id: 'allowed' }),
          label({ id: 'private', externalAiAllowed: false }),
          label({ id: 'future', knownAt: '2026-01-03T00:00:00.000Z' }),
        ],
        asOf,
      ).map((item) => item.id),
    ).toEqual(['allowed']);
  });

  it('counts independent upstream groups without treating notes or AI output as sources', () => {
    expect(
      independentSourceCount([
        label({ id: 'a', upstreamGroup: 'group-a' }),
        label({ id: 'a-duplicate', upstreamGroup: 'group-a', kind: 'CHAIN_OBSERVATION' }),
        label({ id: 'b', upstreamGroup: 'group-b', kind: 'CHAIN_OBSERVATION' }),
        label({ id: 'ai', upstreamGroup: 'group-c', kind: 'AI_HYPOTHESIS' }),
        label({ id: 'note', upstreamGroup: 'group-d', kind: 'USER_NOTE' }),
      ]),
    ).toBe(2);
  });
});
