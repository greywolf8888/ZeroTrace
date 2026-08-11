export interface PublicWorkerError {
  code: string;
  retryable: boolean;
}

const SAFE_ERROR_CODE = /^[A-Z0-9_:-]{1,160}$/;

export function publicWorkerError(error: unknown): PublicWorkerError {
  let current = error;
  let retryable = false;
  let fallbackCode = 'INGESTION_FAILED';

  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    const record = current as Record<string, unknown>;
    retryable ||= record.retryable === true;
    if (typeof record.code === 'string' && SAFE_ERROR_CODE.test(record.code)) {
      if (record.code !== 'INGESTION_FAILED') {
        return { code: record.code, retryable };
      }
      fallbackCode = record.code;
    }
    current = record.cause;
  }

  return { code: fallbackCode, retryable };
}
