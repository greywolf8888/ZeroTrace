// 独立离线入口不包含 fetch、RPC 或服务端数据库依赖。
import { readBundleFile } from './read-bundle.js';
import { replayReportBundle } from '@zerotrace/arc-task-ledger';
import { pathToFileURL } from 'node:url';
export async function offlineReplay(file: string) {
  return replayReportBundle(await readBundleFile(file));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw Error('Usage: tsx examples/arc-task-ledger/replay-bundle.ts bundle.json');
  offlineReplay(file)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(JSON.stringify({ state: 'REPLAY_REJECTED', code: e.code ?? 'INVALID_BUNDLE' }));
      process.exitCode = 1;
    });
}
