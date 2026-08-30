import type { CompatibleAiConfig } from './openai-compatible.js';

export type AiProviderCapabilityState = 'UNTESTED' | 'PROBED' | 'VERIFIED' | 'FAILED';

export interface ParsedAiProvider {
  providerId: string;
  displayName: string;
  enabled: boolean;
  model: string;
  apiStyle: CompatibleAiConfig['apiStyle'];
  capabilityState: AiProviderCapabilityState;
  config?: CompatibleAiConfig;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`AI_CONFIG_${field.toUpperCase()}_INVALID`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`AI_CONFIG_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`AI_CONFIG_${field.toUpperCase()}_INVALID`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`AI_CONFIG_${field.toUpperCase()}_INVALID`);
  }
  return value as number;
}

export function parseAiProviderDocument(
  value: unknown,
  options: {
    purpose: 'PROBE' | 'ANALYZE';
    secret: (environmentVariable: string) => string | undefined;
  },
): ParsedAiProvider {
  const root = record(value, 'root');
  const providerId = text(root.provider_id, 'provider_id');
  const displayName = text(root.display_name, 'display_name');
  const enabled = boolean(root.enabled, 'enabled');
  const model = text(root.model, 'model');
  const apiStyle = text(root.api_style, 'api_style');
  if (apiStyle !== 'chat_completions' && apiStyle !== 'responses') {
    throw new Error('AI_CONFIG_API_STYLE_INVALID');
  }
  const supported = root.supported_api_styles;
  if (
    !Array.isArray(supported) ||
    !supported.includes(apiStyle) ||
    supported.some((item) => item !== 'chat_completions' && item !== 'responses')
  ) {
    throw new Error('AI_CONFIG_SUPPORTED_API_STYLES_INVALID');
  }
  const capabilities = record(root.capabilities, 'capabilities');
  const capabilityState = text(capabilities.state, 'capability_state');
  if (!['UNTESTED', 'PROBED', 'VERIFIED', 'FAILED'].includes(capabilityState)) {
    throw new Error('AI_CONFIG_CAPABILITY_STATE_INVALID');
  }
  const parsed: ParsedAiProvider = {
    providerId,
    displayName,
    enabled,
    model,
    apiStyle,
    capabilityState: capabilityState as AiProviderCapabilityState,
  };
  if (!enabled) return parsed;
  if (options.purpose === 'ANALYZE' && capabilityState !== 'VERIFIED') {
    throw new Error('AI_PROVIDER_CAPABILITY_PROBE_REQUIRED');
  }
  if (capabilityState === 'FAILED') throw new Error('AI_PROVIDER_CAPABILITY_FAILED');
  const apiKeyEnvironment = text(root.api_key_env, 'api_key_env');
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(apiKeyEnvironment)) {
    throw new Error('AI_CONFIG_SECRET_ENV_INVALID');
  }
  const apiKey = options.secret(apiKeyEnvironment);
  if (apiKey === undefined || apiKey.trim().length === 0)
    throw new Error('AI_PROVIDER_SECRET_MISSING');
  const budgets = record(root.budgets, 'budgets');
  const rules = record(root.rules, 'rules');
  const externalContentMode = text(rules.external_content_mode, 'external_content_mode');
  if (externalContentMode !== 'PROHIBITED' && externalContentMode !== 'RIGHTS_GATED') {
    throw new Error('AI_CONFIG_EXTERNAL_CONTENT_MODE_INVALID');
  }
  if (
    boolean(
      rules.third_party_retention_not_guaranteed_by_store_false,
      'third_party_retention_not_guaranteed_by_store_false',
    ) !== true
  ) {
    throw new Error('AI_CONFIG_RETENTION_DISCLOSURE_REQUIRED');
  }
  const reasoning = capabilities.reasoning_effort;
  if (
    reasoning !== null &&
    reasoning !== undefined &&
    !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(reasoning))
  ) {
    throw new Error('AI_CONFIG_REASONING_EFFORT_INVALID');
  }
  parsed.config = {
    baseUrl: text(root.base_url, 'base_url'),
    model,
    apiStyle,
    apiKey,
    timeoutMs: positiveInteger(budgets.timeout_ms, 'timeout_ms'),
    maxOutputTokens: positiveInteger(budgets.max_output_tokens, 'max_output_tokens'),
    maxInputChars: positiveInteger(budgets.max_input_chars, 'max_input_chars'),
    maxResponseBytes: positiveInteger(budgets.max_response_bytes, 'max_response_bytes'),
    allowLoopbackHttp: boolean(root.allow_loopback_http, 'allow_loopback_http'),
    externalContentMode,
    externalContentDeletionCheckMaxAgeSeconds: positiveInteger(
      rules.external_content_deletion_check_max_age_seconds,
      'external_content_deletion_check_max_age_seconds',
    ),
    capabilities: {
      strictJsonSchema: boolean(capabilities.strict_json_schema, 'strict_json_schema'),
      jsonObject: boolean(capabilities.json_object, 'json_object'),
      chatTokenField:
        capabilities.chat_token_field === 'max_tokens'
          ? 'max_tokens'
          : capabilities.chat_token_field === 'max_completion_tokens'
            ? 'max_completion_tokens'
            : (() => {
                throw new Error('AI_CONFIG_CHAT_TOKEN_FIELD_INVALID');
              })(),
      ...(reasoning === null || reasoning === undefined
        ? {}
        : {
            reasoningEffort: reasoning as 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
          }),
      storeFalse: boolean(capabilities.store_false, 'store_false'),
    },
  };
  return parsed;
}
