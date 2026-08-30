import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'dotenv/config';

import {
  LLM_SYSTEM_PROMPT,
  analyzeCompatible,
  parseAiProviderDocument,
  validateAiAnalysisOutputV2,
  validateLlmOutput,
  type AiAnalysisValidationRequest,
  type LlmGatewayRequest,
} from '@zerotrace/llm-gateway';
import { InMemoryJobQueue } from '@zerotrace/workflow-core';

const queue = new InMemoryJobQueue();

interface LiveAnalysisRequest extends Omit<AiAnalysisValidationRequest, 'output'> {
  mode: 'ANALYZE_V2';
}

function readInput(): LlmGatewayRequest | LiveAnalysisRequest {
  const raw = readFileSync(0, 'utf8').trim();
  if (raw.length === 0) {
    throw new Error(
      'llm-worker requires a JSON LlmGatewayRequest on stdin. LLM_SYSTEM_PROMPT is read-only.',
    );
  }
  return JSON.parse(raw) as LlmGatewayRequest | LiveAnalysisRequest;
}

const AI_ANALYSIS_V2_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'conclusionType',
    'conclusions',
    'counterevidence',
    'missingItems',
    'verifiableConditions',
    'applicableAsOf',
    'promptVersion',
    'suggestedQueries',
  ],
  properties: {
    schemaVersion: { const: 'ai-analysis-v2' },
    conclusionType: {
      enum: [
        'FACT_SUMMARY',
        'HYPOTHESIS',
        'COUNTEREVIDENCE',
        'RESEARCH_QUESTION',
        'SIMILAR_CASES',
        'EXPLANATION',
      ],
    },
    conclusions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidenceIds', 'featureIds'],
        properties: {
          text: { type: 'string', minLength: 1 },
          evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          featureIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    counterevidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidenceIds'],
        properties: {
          text: { type: 'string', minLength: 1 },
          evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
    missingItems: { type: 'array', items: { type: 'string' } },
    verifiableConditions: { type: 'array', items: { type: 'string' } },
    applicableAsOf: { type: 'string' },
    promptVersion: { type: 'string' },
    suggestedQueries: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool', 'args'],
        properties: { tool: { type: 'string' }, args: { type: 'object' } },
      },
    },
  },
} as const;

const job = queue.enqueue({ type: 'LLM_VALIDATE', idempotencyKey: 'stdin' });
const claimed = queue.claim('llm-worker');
if (claimed === undefined || claimed.fencingToken === undefined) {
  throw new Error('llm-worker failed to acquire a fenced job lease.');
}
const guard = { workerId: 'llm-worker', fencingToken: claimed.fencingToken };
try {
  const request = readInput();
  if ('mode' in request && request.mode === 'ANALYZE_V2') {
    const configPath = resolve(
      process.env.ZEROTRACE_AI_PROVIDER_CONFIG ?? 'config/ai_provider.json',
    );
    const document = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    const provider = parseAiProviderDocument(document, {
      purpose: 'ANALYZE',
      secret: (name) => process.env[name],
    });
    if (provider.config === undefined) throw new Error('AI_PROVIDER_DISABLED');
    const result = await analyzeCompatible(
      provider.config,
      {
        system: LLM_SYSTEM_PROMPT,
        untrustedInput: request.userUntrustedText,
        schemaName: 'zerotrace_ai_analysis_v2',
        schema: AI_ANALYSIS_V2_JSON_SCHEMA,
        dataClasses: ['CHAIN_EVIDENCE', 'ANALYST_TEXT'],
      },
      (output) => validateAiAnalysisOutputV2({ ...request, output }),
    );
    queue.succeed(job.id, result.value.conclusions[0]?.text ?? '分析完成', guard);
    process.stdout.write(
      `${JSON.stringify(
        {
          providerId: provider.providerId,
          requestedModel: result.requestedModel,
          reportedModel: result.reportedModel,
          modelIdentity: result.modelIdentity,
          requiresModelConfirmation: result.requiresModelConfirmation,
          requestId: result.requestId,
          apiStyle: result.apiStyle,
          durationMs: result.durationMs,
          usage: result.usage,
          dataBoundary: result.dataBoundary,
          output: result.value,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const output = validateLlmOutput(request as LlmGatewayRequest);
    queue.succeed(job.id, output.narrative, guard);
    process.stdout.write(
      `${JSON.stringify({ systemPrompt: LLM_SYSTEM_PROMPT, output }, null, 2)}\n`,
    );
  }
} catch (error) {
  queue.fail(job.id, error instanceof Error ? error.message : 'llm validation failed', guard);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
