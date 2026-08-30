import { describe, expect, it } from 'vitest';

import { buildCorpusCandidateRecords, type CorpusCodeObservation } from './corpus-records.js';

const first = `0x${'1'.repeat(40)}`;
const second = `0x${'2'.repeat(40)}`;
const third = `0x${'3'.repeat(40)}`;

describe('历史候选全集记录', () => {
  it('保留不可用、空代码和未验证候选，不筛掉失败分母', () => {
    const observations = new Map<string, readonly CorpusCodeObservation[]>([
      [
        first,
        [
          { providerId: 'operator-a', state: 'KNOWN', code: '0x6000' },
          { providerId: 'operator-b', state: 'UNAVAILABLE', errorCode: 'PROVIDER_DOWN' },
        ],
      ],
      [
        second,
        [
          { providerId: 'operator-a', state: 'KNOWN', code: '0x' },
          { providerId: 'operator-b', state: 'KNOWN', code: '0x' },
        ],
      ],
    ]);

    const records = buildCorpusCandidateRecords([first, second, third], observations);

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.verification)).toEqual([
      'UNAVAILABLE',
      'AGREED_EMPTY',
      'UNAVAILABLE',
    ]);
    expect(records.every((record) => record.outcome === 'UNDETERMINED')).toBe(true);
  });

  it('去重规范地址并把 Operator 分歧保持为分歧', () => {
    const observations = new Map<string, readonly CorpusCodeObservation[]>([
      [
        first,
        [
          { providerId: 'operator-a', state: 'KNOWN', code: '0x6000' },
          { providerId: 'operator-b', state: 'KNOWN', code: '0x6001' },
        ],
      ],
    ]);

    expect(
      buildCorpusCandidateRecords([first.toUpperCase().replace('0X', '0x'), first], observations),
    ).toMatchObject([{ token: first, verification: 'DISAGREED' }]);
  });
});
