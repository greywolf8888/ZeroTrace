import type { TokenAnalyzeResponse } from '../generated-api/client.js';
import { zhUserMessage } from '../i18n/zh-CN.js';

type WorkstationStatus = TokenAnalyzeResponse['status'];

const STATUS_ZH: Record<WorkstationStatus, string> = {
  IDLE: '尚未开始',
  QUEUED: '已排队',
  RUNNING: '正在分析',
  PARTIAL: '已有部分结果',
  COMPLETE: '可使用',
  STALE: '结果已过期',
  SOURCE_CONFLICT: '来源冲突',
  FAILED: '失败',
  CANCELLED: '已取消',
  OFFLINE: '数据源不可用',
  UNSUPPORTED: '暂不支持',
};

export function WorkstationStatusBanner({
  status,
  reason,
  capturedAt,
}: {
  status: WorkstationStatus;
  reason?: string;
  capturedAt?: string;
}) {
  return (
    <div className={`workstation-status workstation-status-${status.toLowerCase()}`} role="status">
      <strong>{STATUS_ZH[status]}</strong>
      {reason === undefined ? null : (
        <span>{zhUserMessage(reason, '任务未完成，请检查数据源状态后重试。')}</span>
      )}
      {capturedAt === undefined ? (
        <span>无快照时间戳 · 不得当新结果使用</span>
      ) : (
        <time dateTime={capturedAt}>{new Date(capturedAt).toLocaleString('zh-CN')}</time>
      )}
    </div>
  );
}

export { STATUS_ZH };
