import { GoogleGenAI } from '@google/genai';
import { AiProvider, GenerateRequest, GenerateResult, ProviderError } from './types';

function buildClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) return new GoogleGenAI({ apiKey: key });
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  if (!project || !location) throw new Error('AI provider is not configured');
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  let credentials: Record<string, unknown> | undefined;
  if (raw) {
    try { credentials = JSON.parse(raw); } catch { throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON'); }
  }
  return new GoogleGenAI({
    vertexai: true, project, location,
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  } as any);
}

function toError(e: any): ProviderError {
  const status = Number(e?.status ?? e?.code ?? e?.error?.code);
  const retryable = !status || status === 429 || status >= 500 || e?.name === 'AbortError';
  return new ProviderError(String(e?.message || 'provider error').slice(0, 300), retryable, Number.isFinite(status) ? status : undefined);
}

/** Thin adapter over the official @google/genai SDK. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI | null = null;
  constructor(private model: string) {}

  private ai() { return (this.client ||= buildClient()); }

  private params(req: GenerateRequest) {
    return {
      model: this.model,
      contents: req.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature,
        abortSignal: req.signal,
        ...(req.json ? { responseMimeType: 'application/json', ...(req.schema ? { responseJsonSchema: req.schema } : {}) } : {}),
      },
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      const r = await this.ai().models.generateContent(this.params(req) as any);
      return { text: r.text ?? '', inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0 };
    } catch (e) { throw toError(e); }
  }

  async *generateStream(req: GenerateRequest) {
    try {
      const stream = await this.ai().models.generateContentStream(this.params(req) as any);
      for await (const chunk of stream) {
        yield { text: chunk.text ?? '', inputTokens: chunk.usageMetadata?.promptTokenCount, outputTokens: chunk.usageMetadata?.candidatesTokenCount };
      }
    } catch (e) { throw toError(e); }
  }
}
