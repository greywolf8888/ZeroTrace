export type CorpusCodeObservation =
  | { providerId: string; state: 'KNOWN'; code: string }
  | { providerId: string; state: 'UNAVAILABLE'; errorCode: string };

export type CorpusVerificationState =
  'AGREED_CONTRACT' | 'AGREED_EMPTY' | 'DISAGREED' | 'UNAVAILABLE';

export interface CorpusCandidateRecord {
  token: string;
  verification: CorpusVerificationState;
  outcome: 'UNDETERMINED';
  sourceSet: string[];
  limitations: string[];
}

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

function canonicalToken(value: string): string {
  const token = value.toLowerCase();
  if (!EVM_ADDRESS.test(token)) throw new Error('INVALID_CORPUS_TOKEN');
  return token;
}

export function buildCorpusCandidateRecords(
  candidates: readonly string[],
  observations: ReadonlyMap<string, readonly CorpusCodeObservation[]>,
): CorpusCandidateRecord[] {
  const tokens = [...new Set(candidates.map(canonicalToken))];
  return tokens.map((token) => {
    const values = observations.get(token) ?? [];
    const sourceSet = [...new Set(values.map((value) => value.providerId))].sort();
    const known = values.filter(
      (value): value is Extract<CorpusCodeObservation, { state: 'KNOWN' }> =>
        value.state === 'KNOWN',
    );
    const unavailable = values.filter((value) => value.state === 'UNAVAILABLE');
    if (sourceSet.length < 2 || known.length < 2 || unavailable.length > 0) {
      return {
        token,
        verification: 'UNAVAILABLE',
        outcome: 'UNDETERMINED',
        sourceSet,
        limitations: [
          sourceSet.length < 2
            ? '少于两个独立 Operator，不能确认 bytecode 一致性。'
            : '至少一个 Operator 读取不可用，不能确认 bytecode 一致性。',
        ],
      };
    }
    const codes = new Set(known.map((value) => value.code.toLowerCase()));
    if (codes.size !== 1) {
      return {
        token,
        verification: 'DISAGREED',
        outcome: 'UNDETERMINED',
        sourceSet,
        limitations: ['Operator 返回的 bytecode 不一致，候选保留但不得进入正式分析。'],
      };
    }
    const code = known[0]?.code.toLowerCase();
    return {
      token,
      verification: code === '0x' ? 'AGREED_EMPTY' : 'AGREED_CONTRACT',
      outcome: 'UNDETERMINED',
      sourceSet,
      limitations:
        code === '0x'
          ? ['两个 Operator 均返回空 bytecode；候选保留为负对照。']
          : ['尚未执行固定规则的进入、退出与结算结果判定。'],
    };
  });
}
