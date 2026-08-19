import type { TokenAnalyzeResponse } from '../generated-api/client.js';

type WorkstationStatus = TokenAnalyzeResponse['status'];

const STATUS_ZH: Record<WorkstationStatus, string> = {
  IDLE: '空闲',
  QUEUED: '排队中',
  RUNNING: '运行中',
  PARTIAL: '部分结果',
  COMPLETE: '完成',
  STALE: '已过期',
  SOURCE_CONFLICT: '来源冲突',
  FAILED: '失败',
  CANCELLED: '已取消',
  OFFLINE: '离线',
  UNSUPPORTED: '不支持',
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
      {reason === undefined ? null : <span>{reason}</span>}
      {capturedAt === undefined ? (
        <span>无快照时间戳 · 不得当新结果使用</span>
      ) : (
        <time dateTime={capturedAt}>{capturedAt}</time>
      )}
    </div>
  );
}

export { STATUS_ZH };
