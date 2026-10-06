import { LedgerError } from './types.js';

// 工程资源策略，非链参数；每个进程的Arc读者共享，测试传输不接触真实RPC。
let active = 0;
const queue: {
  run: () => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
}[] = [];
let nextStart = 0;
export async function rpcPermit(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new LedgerError('READ_DEADLINE', '有界读取已到期限。');
  if (active >= 2)
    await new Promise<void>((resolve, reject) => {
      if (queue.length >= 16) {
        reject(new LedgerError('RPC_QUEUE_LIMIT', '共享读取队列已满，请稍后重试。', 429));
        return;
      }
      const item: {
        run: () => void;
        reject: (e: Error) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = { run: resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        item.abort = () => {
          const i = queue.indexOf(item);
          if (i >= 0) queue.splice(i, 1);
          reject(new LedgerError('READ_DEADLINE', '有界读取已到期限。'));
        };
        signal.addEventListener('abort', item.abort, { once: true });
      }
      queue.push(item);
    });
  else active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const item = queue.shift();
    if (item) {
      if (item.abort) item.signal?.removeEventListener('abort', item.abort);
      item.run();
    } else active--;
  };
}
export async function rpcSpacing(signal?: AbortSignal): Promise<void> {
  const delay = Math.max(0, nextStart - Date.now());
  nextStart = Math.max(Date.now(), nextStart) + 500;
  if (!delay) {
    if (signal?.aborted) throw new LedgerError('READ_DEADLINE', '读取期限已到。');
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(new LedgerError('READ_DEADLINE', '读取期限已到。'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, delay);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}
