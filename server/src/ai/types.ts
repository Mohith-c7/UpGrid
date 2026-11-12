/** Provider-agnostic contract. Tests inject a fake; production uses GeminiProvider. */
export interface AiMessage { role: 'user' | 'model'; text: string }

export interface GenerateRequest {
  system: string;
  messages: AiMessage[];
  /** ask for JSON output (provider enforces mime type); `schema` is a JSON Schema when the provider supports it */
  json?: boolean;
  schema?: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** optional true streaming; the service falls back to generate() + chunking when absent */
  generateStream?(req: GenerateRequest): AsyncIterable<{ text?: string; inputTokens?: number; outputTokens?: number }>;
}

/** Thrown by providers; `retryable` marks transient failures (timeouts, 429, 5xx). */
export class ProviderError extends Error {
  constructor(message: string, public retryable = false, public status?: number) {
    super(message);
  }
}
