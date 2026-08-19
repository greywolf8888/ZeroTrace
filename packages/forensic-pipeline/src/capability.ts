import type { TokenAnalyzeRequest, WorkstationStatus } from '@zerotrace/schemas';

export const FORENSIC_PIPELINE_MODEL_VERSION = 'forensic-pipeline-v1.0.0';
export const FORENSIC_PIPELINE_POLICY_VERSION = 'token-auto-materialize-v1';

const SUPPORTED_FULL_LIFETIME = new Set(['EVM:eip155:56']);

export interface CapabilityDecision {
  status: Extract<WorkstationStatus, 'UNSUPPORTED' | 'RUNNING'>;
  reason?: string;
}

export function decideTokenAnalyzeCapability(request: TokenAnalyzeRequest): CapabilityDecision {
  if (request.snapshotPolicy !== 'FINALIZED') {
    return {
      status: 'UNSUPPORTED',
      reason: '当前仅支持 FINALIZED 快照策略，拒绝非最终确认头。',
    };
  }
  const key = `${request.ledger}:${request.chainId}`;
  if (!SUPPORTED_FULL_LIFETIME.has(key)) {
    return {
      status: 'UNSUPPORTED',
      reason: `能力矩阵未覆盖 ${request.ledger} ${request.chainId}；拒绝猜测其他链的解码器。`,
    };
  }
  if (request.ledger === 'EVM' && !/^0x[0-9a-fA-F]{40}$/.test(request.token)) {
    return { status: 'UNSUPPORTED', reason: 'EVM Token 必须是 20 字节十六进制地址。' };
  }
  return { status: 'RUNNING' };
}
