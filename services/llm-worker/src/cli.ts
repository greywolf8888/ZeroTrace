import { readFileSync } from 'node:fs';

import {
  LLM_SYSTEM_PROMPT,
  validateLlmOutput,
  type LlmGatewayRequest,
} from '@zerotrace/llm-gateway';
import { InMemoryJobQueue } from '@zerotrace/workflow-core';

const queue = new InMemoryJobQueue();

function readInput(): LlmGatewayRequest {
  const raw = readFileSync(0, 'utf8').trim();
  if (raw.length === 0) {
    throw new Error(
      'llm-worker requires a JSON LlmGatewayRequest on stdin. LLM_SYSTEM_PROMPT is read-only.',
    );
  }
  return JSON.parse(raw) as LlmGatewayRequest;
}

const job = queue.enqueue({ type: 'LLM_VALIDATE', idempotencyKey: 'stdin' });
const claimed = queue.claim('llm-worker');
if (claimed === undefined || claimed.fencingToken === undefined) {
  throw new Error('llm-worker failed to acquire a fenced job lease.');
}
const guard = { workerId: 'llm-worker', fencingToken: claimed.fencingToken };
try {
  const request = readInput();
  const output = validateLlmOutput(request);
  queue.succeed(job.id, output.narrative, guard);
  process.stdout.write(`${JSON.stringify({ systemPrompt: LLM_SYSTEM_PROMPT, output }, null, 2)}\n`);
} catch (error) {
  queue.fail(job.id, error instanceof Error ? error.message : 'llm validation failed', guard);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
