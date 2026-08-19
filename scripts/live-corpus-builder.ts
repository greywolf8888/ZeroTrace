import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const PAIR_CREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
const SKIP = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  '0x55d398326f99059ff775485246999027b3197955',
  '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  FACTORY.toLowerCase(),
]);
const URLS = ['https://bsc-dataseed.bnbchain.org', 'https://bsc.nodereal.io'];

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  const parsed = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) throw new Error(parsed.error.message ?? 'rpc');
  return parsed.result;
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`;
}

const headHex = (await rpc(URLS[0]!, 'eth_blockNumber', [])) as string;
const head = Number.parseInt(headHex, 16);
const tokens: string[] = [];
let cursor = head;
while (tokens.length < 50 && cursor > 0) {
  const from = Math.max(0, cursor - 200);
  let logs: Array<{ topics?: string[] }> = [];
  try {
    logs = (await rpc(URLS[0]!, 'eth_getLogs', [
      {
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${cursor.toString(16)}`,
        address: FACTORY,
        topics: [PAIR_CREATED],
      },
    ])) as Array<{ topics?: string[] }>;
  } catch (error) {
    if (error instanceof Error && /limit/i.test(error.message)) {
      cursor = from;
      continue;
    }
    throw error;
  }
  for (const item of logs) {
    const token0 = item.topics?.[1] === undefined ? undefined : topicAddress(item.topics[1]);
    const token1 = item.topics?.[2] === undefined ? undefined : topicAddress(item.topics[2]);
    for (const token of [token0, token1]) {
      if (token === undefined || SKIP.has(token) || tokens.includes(token)) continue;
      tokens.push(token);
      if (tokens.length >= 50) break;
    }
    if (tokens.length >= 50) break;
  }
  cursor = from - 1;
  if (head - cursor > 20_000) break;
}

const windowFrom = cursor + 1;

const verified: Array<{ token: string; codeAgree: boolean; empty: boolean }> = [];
for (const token of tokens) {
  const [left, right] = await Promise.all([
    rpc(URLS[0]!, 'eth_getCode', [token, 'latest']),
    rpc(URLS[1]!, 'eth_getCode', [token, 'latest']),
  ]);
  verified.push({
    token,
    codeAgree: left === right,
    empty: left === '0x',
  });
}

const document = {
  schemaVersion: 'zerotrace-live-corpus-v1',
  capturedAt: new Date().toISOString(),
  head: headHex,
  window: { fromBlock: windowFrom, toBlock: head },
  reviewed: false,
  note: '自动从 Pancake PairCreated 收集；未经分析员核验，不得记 G12 PASS。',
  tokens: verified,
};

writeFileSync(
  join(root, 'docs/terminal-market-structure/token-corpus.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ collected: verified.length, agreed: verified.filter((item) => item.codeAgree).length, reviewed: false }, null, 2)}\n`,
);
