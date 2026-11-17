export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderCompletionResult {
  json: unknown;
  usage: ProviderUsage;
  model: string;
  latencyMs: number;
}

export interface ProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TutorProvider {
  readonly id: string; // 'gemini' | 'groq' | 'ollama'
  readonly model: string;
  complete(request: ProviderRequest, jsonSchema?: object): Promise<ProviderCompletionResult>;
}
