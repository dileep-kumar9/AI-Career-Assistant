import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { AIUnavailableError } from '../errors.js';
import { logger } from '../logger.js';

export type AITask = 'parse' | 'jd' | 'generate' | 'edit' | 'semantic' | 'entry' | 'profile' | 'answer' | 'cover' | 'email' | 'interview' | 'evaluate' | 'learning' | 'chat' | 'interview_turn' | 'interview_summary';

export interface AIJsonRequest {
  task: AITask;
  system: string;
  prompt: string;
  /** JSON Schema (strict: every object has additionalProperties:false + required). */
  schema: Record<string, unknown>;
  /** Optional native PDF input (used for resume extraction). */
  pdfBase64?: string;
  /** Lower effort for cheap/simple tasks such as semantic scoring. */
  effort?: 'low' | 'medium' | 'high';
}

export interface AIProvider {
  readonly name: string;
  generateJSON(req: AIJsonRequest): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function parseJsonText(provider: string, text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some providers wrap JSON in prose; take the outermost object.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError(provider, 'Provider returned malformed JSON.');
  }
}

/** Claude via the official Anthropic SDK, using structured JSON outputs. */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(private cfg: AppConfig['ai']) {
    this.client = new Anthropic({ apiKey: cfg.anthropicKey, timeout: cfg.timeoutMs, maxRetries: 2 });
  }

  async generateJSON(req: AIJsonRequest): Promise<unknown> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 } });
    content.push({ type: 'text', text: req.prompt });
    const effort = (req.effort || this.cfg.anthropicEffort || undefined) as Anthropic.Beta.BetaOutputConfig['effort'];
    try {
      // Streaming avoids HTTP timeouts on long structured outputs.
      const stream = this.client.beta.messages.stream({
        model: this.cfg.anthropicModel,
        max_tokens: 32000,
        system: req.system,
        messages: [{ role: 'user', content }],
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: req.schema }, ...(effort ? { effort } : {}) },
        // Server-side refusal fallbacks route a declined request to another model.
        ...(this.cfg.anthropicFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new ProviderError(this.name, 'The model declined this request.', 422);
      if (message.stop_reason === 'max_tokens') throw new ProviderError(this.name, 'The model response was truncated.', 502);
      const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      if (!text.trim()) throw new ProviderError(this.name, 'Empty response.', 502);
      return parseJsonText(this.name, text);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new ProviderError(this.name, 'Rate limited.', 429);
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderError(this.name, 'Invalid Anthropic API key.', 401);
      if (e instanceof Anthropic.BadRequestError) throw new ProviderError(this.name, `Bad request: ${e.message}`, 400);
      if (e instanceof Anthropic.APIError) throw new ProviderError(this.name, `API error ${e.status ?? ''}`.trim(), e.status ?? 502);
      throw new ProviderError(this.name, (e as Error)?.message || 'Request failed.', 503);
    }
  }
}

/** Removes keywords Gemini's response schema does not accept. */
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties') continue;
    if (k === 'anyOf' && Array.isArray(v)) {
      // Gemini expresses nullability with `nullable`, not anyOf [T, null].
      const nonNull = v.filter((x: any) => x?.type !== 'null');
      if (nonNull.length === 1) {
        Object.assign(out, geminiSchema(nonNull[0]) as object, { nullable: true });
        continue;
      }
    }
    out[k] = geminiSchema(v);
  }
  return out;
}

async function fetchJson(provider: string, url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const payload: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new ProviderError(provider, payload?.error?.message || payload?.message || `HTTP ${r.status}`, r.status);
    return payload;
  } catch (e: any) {
    if (e instanceof ProviderError) throw e;
    if (e?.name === 'AbortError') throw new ProviderError(provider, 'Timed out.', 504);
    throw new ProviderError(provider, e?.message || 'Network error.', 503);
  } finally {
    clearTimeout(timer);
  }
}

export class GeminiProvider implements AIProvider {
  readonly name: string;
  private model: string;
  /** After a quota (429) error the model is skipped for a while instead of failing every request first. */
  private coolUntil = 0;
  constructor(
    private cfg: AppConfig['ai'],
    model?: string,
  ) {
    this.model = model || cfg.geminiModel;
    this.name = `gemini:${this.model}`;
  }
  async generateJSON(req: AIJsonRequest) {
    if (Date.now() < this.coolUntil) throw new ProviderError(this.name, 'Quota exhausted; using the fallback model for now.', 429);
    const parts: any[] = [];
    if (req.pdfBase64) parts.push({ inlineData: { mimeType: 'application/pdf', data: req.pdfBase64 } });
    parts.push({ text: req.prompt });
    const call = () =>
      fetchJson(
        this.name,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.geminiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: geminiSchema(req.schema) },
          }),
        },
        this.cfg.timeoutMs,
      );
    let payload: any;
    try {
      payload = await call();
    } catch (e) {
      // "High demand" (503) is usually momentary on the free tier: retry once before falling back.
      if (e instanceof ProviderError && e.status === 429) this.coolUntil = Date.now() + (/quota|per day|daily/i.test(e.message) ? 15 * 60_000 : 60_000);
      if (!(e instanceof ProviderError) || e.status !== 503) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      payload = await call();
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    if (!text) throw new ProviderError(this.name, 'Empty response.', 502);
    return parseJsonText(this.name, text);
  }
}

/** Groq and Mistral both expose an OpenAI-compatible chat completions API. */
export class ChatCompletionsProvider implements AIProvider {
  constructor(
    readonly name: 'groq' | 'mistral',
    private url: string,
    private key: string,
    private model: string,
    private timeoutMs: number,
  ) {}
  async generateJSON(req: AIJsonRequest) {
    // Text-only provider: PDF input is ignored (prompts always include extracted text).
    const payload = await fetchJson(
      this.name,
      this.url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${req.system}\n\nRespond with a single JSON object that validates against this JSON Schema:\n${JSON.stringify(req.schema)}` },
            { role: 'user', content: req.prompt },
          ],
        }),
      },
      this.timeoutMs,
    );
    const text = payload?.choices?.[0]?.message?.content || '';
    if (!text) throw new ProviderError(this.name, 'Empty response.', 502);
    return parseJsonText(this.name, text);
  }
}

/**
 * Tries each configured provider in order. Any provider failure (rate limit,
 * outage, malformed output, validation failure) falls through to the next; if
 * all fail an AIUnavailableError is raised and callers leave data untouched.
 */
export class AIChain {
  constructor(private providers: AIProvider[]) {}

  get available() {
    return this.providers.length > 0;
  }

  get names() {
    return this.providers.map((p) => p.name);
  }

  async generate<T>(req: AIJsonRequest, validate: (raw: unknown) => T): Promise<{ data: T; provider: string }> {
    if (!this.providers.length) throw new AIUnavailableError('No AI provider is configured on the server. Set ANTHROPIC_API_KEY (or another provider key) in .env.');
    const failures: string[] = [];
    for (const p of this.providers) {
      const started = Date.now();
      try {
        const raw = await p.generateJSON(req);
        const data = validate(raw);
        logger.info('ai.success', { provider: p.name, task: req.task, ms: Date.now() - started });
        return { data, provider: p.name };
      } catch (e: any) {
        failures.push(`${p.name}: ${e?.message || 'failed'}`);
        logger.warn('ai.failure', { provider: p.name, task: req.task, status: e?.status, ms: Date.now() - started, error: String(e?.message || e).slice(0, 200) });
      }
    }
    const rateLimited = failures.length > 0 && failures.every((f) => /rate/i.test(f));
    throw new AIUnavailableError(
      rateLimited
        ? 'All AI providers are rate-limited right now. Your resume was not changed — please wait a minute and try again.'
        : 'The AI service could not complete this request. Your resume was not changed — please try again.',
    );
  }
}

export function createAIChain(cfg: AppConfig['ai']): AIChain {
  // Gemini: the main model first, then a lighter fallback model (e.g. flash-lite) when the main one is busy.
  const gemini: AIProvider[] = cfg.geminiKey
    ? [cfg.geminiModel, cfg.geminiFallbackModel].filter((m, i, all): m is string => !!m && all.indexOf(m) === i).map((m) => new GeminiProvider(cfg, m))
    : [];
  const built: Record<string, AIProvider[]> = {
    anthropic: cfg.anthropicKey ? [new AnthropicProvider(cfg)] : [],
    gemini,
    groq: cfg.groqKey ? [new ChatCompletionsProvider('groq', 'https://api.groq.com/openai/v1/chat/completions', cfg.groqKey, cfg.groqModel, cfg.timeoutMs)] : [],
    mistral: cfg.mistralKey ? [new ChatCompletionsProvider('mistral', 'https://api.mistral.ai/v1/chat/completions', cfg.mistralKey, cfg.mistralModel, cfg.timeoutMs)] : [],
  };
  return new AIChain(cfg.order.flatMap((n) => built[n] || []));
}
