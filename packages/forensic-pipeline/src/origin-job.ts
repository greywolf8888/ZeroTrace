export const ORIGIN_HISTORY_JOB_TYPE = 'TOKEN_ORIGIN_HISTORY';

export function originHistoryWithoutReader(): {
  status: 'OFFLINE';
  limitations: string[];
} {
  return {
    status: 'OFFLINE',
    limitations: [
      '起源与历史任务需要 SQD/Portal 只读读取器。当前未配置，拒绝用空持有人或 0 库存伪造时间线。',
    ],
  };
}
