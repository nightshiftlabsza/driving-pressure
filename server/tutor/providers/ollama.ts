import type { ProviderCompletionResult, ProviderRequest, TutorProvider } from './types';
import { TUTOR_JSON_SCHEMA } from './schema';

export class OllamaProvider implements TutorProvider {
  readonly id = 'ollama';
  readonly model: string;
  private endpoint: string;
  private keepAlive: string;

  constructor(
    model: string = process.env.OLLAMA_MODEL || 'qwen3:8b',
    endpoint: string = 'http://localhost:11434/api/chat',
    keepAlive: string = '30m'
  ) {
    this.model = model;
    this.endpoint = endpoint;
    this.keepAlive = keepAlive;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(
    request: ProviderRequest,
    jsonSchema: object = TUTOR_JSON_SCHEMA
  ): Promise<ProviderCompletionResult> {
    const startTime = Date.now();

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      format: jsonSchema,
      stream: false,
      keep_alive: this.keepAlive,
      options: {
        temperature: request.temperature ?? 0.2,
      },
    };

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (fetchErr: unknown) {
      const err = new Error(
        `Ollama unavailable at ${this.endpoint}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
      );
      (err as unknown as { code: string }).code = 'OLLAMA_UNAVAILABLE';
      throw err;
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Ollama request failed (${res.status}): ${errText}`);
      (err as unknown as { status: number; code: string }).code = 'OLLAMA_UNAVAILABLE';
      throw err;
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const content = data.message?.content;
    if (!content) {
      throw new Error('Ollama returned empty response content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Ollama returned invalid JSON: ${content.slice(0, 200)}`);
    }

    return {
      json: parsed,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      model: this.model,
      latencyMs,
    };
  }
}
