/** Provider-neutral analysis transport. No wallet or trade execution capability. */
export interface CompatibleAiConfig {
  baseUrl: string;
  model: string;
  apiStyle: 'chat_completions' | 'responses';
  apiKey: string; // Load from the server secret store, never a browser bundle or persisted config.
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
  maxResponseBytes: number;
  allowLoopbackHttp?: boolean;
  capabilities: {
    strictJsonSchema: boolean;
    jsonObject: boolean;
    chatTokenField: 'max_completion_tokens' | 'max_tokens';
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    storeFalse?: boolean;
  };
}
export interface CompatibleAiResult<T> {
  value: T;
  requestedModel: string;
  reportedModel: string | null;
  requestId: string | null;
  apiStyle: CompatibleAiConfig['apiStyle'];
}
export function compatibleEndpoint(config: CompatibleAiConfig): URL {
  const url = new URL(config.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('AI_ENDPOINT_HAS_CREDENTIAL_OR_QUERY');
  if (url.protocol !== 'https:' && !(config.allowLoopbackHttp && local && url.protocol === 'http:'))
    throw new Error('AI_ENDPOINT_REQUIRES_HTTPS');
  const tail = config.apiStyle === 'responses' ? 'responses' : 'chat/completions';
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + tail;
  return url;
}
function validateConfig(c: CompatibleAiConfig): void {
  compatibleEndpoint(c);
  if (
    c.capabilities.reasoningEffort !== undefined &&
    !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(c.capabilities.reasoningEffort)
  )
    throw new Error('AI_UNSUPPORTED_REASONING_VALUE');
  if (!c.model.trim() || !c.apiKey.trim()) throw new Error('AI_MODEL_AND_SECRET_REQUIRED');
  for (const x of [c.timeoutMs, c.maxOutputTokens, c.maxInputChars, c.maxResponseBytes]) {
    if (!Number.isSafeInteger(x) || x <= 0) throw new Error('AI_INVALID_BUDGET');
  }
  if (c.timeoutMs > 600_000 || c.maxResponseBytes > 8_000_000)
    throw new Error('AI_BUDGET_TOO_LARGE');
}
async function boundedBody(response: Response, limit: number): Promise<string> {
  const announced = response.headers.get('content-length');
  if (announced !== null && Number(announced) > limit) throw new Error('AI_RESPONSE_TOO_LARGE');
  if (response.body === null) throw new Error('AI_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('AI_RESPONSE_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}
export async function analyzeCompatible<T>(
  config: CompatibleAiConfig,
  task: {
    system: string;
    untrustedInput: string;
    schemaName: string;
    schema: Record<string, unknown>;
  },
  validate: (value: unknown) => T,
  transport: typeof fetch = fetch,
): Promise<CompatibleAiResult<T>> {
  validateConfig(config);
  if (task.system.length + task.untrustedInput.length > config.maxInputChars)
    throw new Error('AI_INPUT_BUDGET_EXCEEDED');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(task.schemaName)) throw new Error('AI_INVALID_SCHEMA_NAME');
  const c = config.capabilities;
  const body: Record<string, unknown> = { model: config.model };
  const messages = [
    { role: 'system', content: task.system },
    { role: 'user', content: task.untrustedInput },
  ];
  if (config.apiStyle === 'chat_completions') {
    body.messages = messages;
    body[c.chatTokenField] = config.maxOutputTokens;
    if (c.strictJsonSchema)
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: task.schemaName, strict: true, schema: task.schema },
      };
    else if (c.jsonObject) body.response_format = { type: 'json_object' };
    if (c.reasoningEffort !== undefined) body.reasoning_effort = c.reasoningEffort;
  } else {
    body.input = messages;
    body.max_output_tokens = config.maxOutputTokens;
    if (c.strictJsonSchema)
      body.text = {
        format: { type: 'json_schema', name: task.schemaName, strict: true, schema: task.schema },
      };
    else if (c.jsonObject) body.text = { format: { type: 'json_object' } };
    if (c.reasoningEffort !== undefined) body.reasoning = { effort: c.reasoningEffort };
  }
  if (c.storeFalse) body.store = false;
  // No tools or transaction endpoints are exposed. Suggested queries are validated elsewhere.
  const response = await transport(compatibleEndpoint(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    // Do not leak response bodies, endpoints, credentials or provider exception text.
    throw new Error('AI_HTTP_' + String(response.status));
  }
  const data: unknown = JSON.parse(await boundedBody(response, config.maxResponseBytes));
  if (data === null || typeof data !== 'object') throw new Error('AI_INVALID_ENVELOPE');
  const d = data as Record<string, unknown>;
  let text = '';
  if (config.apiStyle === 'chat_completions') {
    const choices = d.choices;
    if (!Array.isArray(choices) || choices.length !== 1) throw new Error('AI_INVALID_CHOICES');
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message?.refusal) throw new Error('AI_REFUSAL');
    if (choice.finish_reason !== 'stop') throw new Error('AI_INCOMPLETE_OR_TOOL_REPLY');
    if (!message || typeof message.content !== 'string') throw new Error('AI_MISSING_CONTENT');
    if (message.tool_calls !== undefined) throw new Error('AI_UNEXPECTED_TOOL_CALL');
    text = message.content;
  } else {
    if (d.status !== 'completed' || d.incomplete_details) throw new Error('AI_INCOMPLETE_RESPONSE');
    if (!Array.isArray(d.output)) throw new Error('AI_MISSING_OUTPUT');
    const fragments: string[] = [];
    for (const item of d.output as Record<string, unknown>[]) {
      if (item.type === 'reasoning') continue;
      if (item.type !== 'message') throw new Error('AI_UNEXPECTED_OUTPUT_TYPE');
      if (!Array.isArray(item.content)) throw new Error('AI_INVALID_MESSAGE_CONTENT');
      for (const part of item.content as Record<string, unknown>[]) {
        if (part.type === 'refusal') throw new Error('AI_REFUSAL');
        if (part.type !== 'output_text' || typeof part.text !== 'string')
          throw new Error('AI_UNEXPECTED_CONTENT_TYPE');
        fragments.push(part.text);
      }
    }
    text = fragments.join('');
  }
  if (!text.trim()) throw new Error('AI_EMPTY_ANALYSIS');
  // Schema compliance is never treated as truth: caller must also check evidence and permissions.
  const value = validate(JSON.parse(text));
  return {
    value,
    requestedModel: config.model,
    reportedModel: typeof d.model === 'string' ? d.model : null,
    requestId: response.headers.get('x-request-id'),
    apiStyle: config.apiStyle,
  };
}
