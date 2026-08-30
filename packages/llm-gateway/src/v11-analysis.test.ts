import { describe, expect, it } from 'vitest';

import {
  analyzeCompatible,
  mapAiAnalysisV2ToLegacy,
  parseAiProviderDocument,
  validateAiAnalysisOutputV2,
  type CompatibleAiConfig,
} from './index.js';

const evidence = `ev_${'1'.repeat(24)}`;

function provider(overrides: Record<string, unknown> = {}) {
  return {
    provider_id: 'analysis-ai',
    display_name: '分析助手',
    enabled: true,
    base_url: 'https://ai.example/v1',
    api_key_env: 'ZEROTRACE_ANALYSIS_API_KEY',
    model: '5.6sol',
    api_style: 'chat_completions',
    supported_api_styles: ['chat_completions', 'responses'],
    allow_loopback_http: false,
    capabilities: {
      state: 'VERIFIED',
      strict_json_schema: true,
      json_object: true,
      chat_token_field: 'max_completion_tokens',
      reasoning_effort: null,
      store_false: false,
    },
    budgets: {
      timeout_ms: 90_000,
      max_output_tokens: 6_000,
      max_input_chars: 100_000,
      max_response_bytes: 2_000_000,
    },
    ...overrides,
  };
}

const outputV2 = {
  schemaVersion: 'ai-analysis-v2' as const,
  conclusionType: 'HYPOTHESIS' as const,
  conclusions: [{ text: '存在待核验的行为相似。', evidenceIds: [evidence], featureIds: ['f-1'] }],
  counterevidence: [{ text: '也可能是公共服务节点。', evidenceIds: [evidence] }],
  missingItems: ['缺少独立来源'],
  verifiableConditions: ['补充来源后重算'],
  applicableAsOf: '2026-08-31T00:00:00.000Z',
  promptVersion: 'prompt-v2',
  suggestedQueries: [{ tool: 'get_evidence', args: { id: evidence } }],
};

describe('V11 AI 接入与引用边界', () => {
  it('禁用配置不读取密钥，分析配置要求探测并保留用户模型原值', () => {
    const disabled = parseAiProviderDocument(
      provider({
        enabled: false,
        base_url: '',
        capabilities: { ...provider().capabilities, state: 'UNTESTED' },
      }),
      { purpose: 'ANALYZE', secret: () => undefined },
    );
    expect(disabled).toMatchObject({ enabled: false, model: '5.6sol' });
    expect(disabled.config).toBeUndefined();

    expect(() =>
      parseAiProviderDocument(
        provider({ capabilities: { ...provider().capabilities, state: 'UNTESTED' } }),
        { purpose: 'ANALYZE', secret: () => 'secret' },
      ),
    ).toThrow('AI_PROVIDER_CAPABILITY_PROBE_REQUIRED');
    const probe = parseAiProviderDocument(
      provider({ capabilities: { ...provider().capabilities, state: 'UNTESTED' } }),
      { purpose: 'PROBE', secret: () => 'secret' },
    );
    expect(probe.config?.model).toBe('5.6sol');
  });

  it('逐条核对 Evidence/特征/时点并显式标记旧结构映射损失', () => {
    const parsed = validateAiAnalysisOutputV2({
      knownEvidenceIds: [evidence],
      knownFeatureIds: ['f-1'],
      availableAsOf: '2026-08-31T00:00:00.000Z',
      promptVersion: 'prompt-v2',
      userUntrustedText: '比较资料',
      output: outputV2,
    });
    const mapped = mapAiAnalysisV2ToLegacy(parsed);
    expect(mapped.mappingVersion).toBe('ai-analysis-v2-to-llm-structured-output-v1');
    expect(mapped.losses).toHaveLength(1);
    expect(mapped.output.evidenceIds).toEqual([evidence]);

    expect(() =>
      validateAiAnalysisOutputV2({
        knownEvidenceIds: [],
        knownFeatureIds: ['f-1'],
        availableAsOf: '2026-08-31T00:00:00.000Z',
        promptVersion: 'prompt-v2',
        userUntrustedText: '',
        output: outputV2,
      }),
    ).toThrow('unknown Evidence ID');
    expect(() =>
      validateAiAnalysisOutputV2({
        knownEvidenceIds: [evidence],
        knownFeatureIds: [],
        availableAsOf: '2026-08-31T00:00:00.000Z',
        promptVersion: 'prompt-v2',
        userUntrustedText: '',
        output: outputV2,
      }),
    ).toThrow('unknown feature ID');
  });

  it('Chat Completions 与 Responses 请求字段分离并报告模型不匹配', async () => {
    const parsed = parseAiProviderDocument(provider(), {
      purpose: 'ANALYZE',
      secret: () => 'secret',
    });
    const chatBodies: Record<string, unknown>[] = [];
    const chat = await analyzeCompatible(
      parsed.config!,
      {
        system: '系统',
        untrustedInput: '资料',
        schemaName: 'analysis',
        schema: { type: 'object' },
      },
      (value) => value as { ok: boolean },
      async (_url, init) => {
        chatBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            model: 'reported-other-model',
            choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
          { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } },
        );
      },
    );
    expect(chatBodies[0]).toHaveProperty('messages');
    expect(chatBodies[0]).not.toHaveProperty('input');
    expect(chat).toMatchObject({
      requestedModel: '5.6sol',
      reportedModel: 'reported-other-model',
      modelIdentity: 'MISMATCH',
      requiresModelConfirmation: true,
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    });

    const responsesConfig: CompatibleAiConfig = { ...parsed.config!, apiStyle: 'responses' };
    const responseBodies: Record<string, unknown>[] = [];
    const response = await analyzeCompatible(
      responsesConfig,
      {
        system: '系统',
        untrustedInput: '资料',
        schemaName: 'analysis',
        schema: { type: 'object' },
      },
      (value) => value as { ok: boolean },
      async (_url, init) => {
        responseBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            model: '5.6sol',
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    expect(responseBodies[0]).toHaveProperty('input');
    expect(responseBodies[0]).not.toHaveProperty('messages');
    expect(response.modelIdentity).toBe('MATCHED');
    expect(response.requiresModelConfirmation).toBe(false);
  });
});
