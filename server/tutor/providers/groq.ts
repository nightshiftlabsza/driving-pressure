import type { ProviderCompletionResult, ProviderRequest, TutorProvider } from './types';

export class GroqProvider implements TutorProvider {
  readonly id = 'groq';
  readonly model: string;
  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, model: string = 'openai/gpt-oss-120b') {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  }

  estimateTokens(text: string): number {
    // Standard conservative heuristic for mixed clinical/JSON text
    return Math.ceil(text.length / 3.5);
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletionResult> {
    const combinedInput = `${request.systemPrompt}\n${request.userPrompt}`;
    const estimatedInputTokens = this.estimateTokens(combinedInput);

    // Groq free plan allows 8,000 tokens/min; refuse >6,000 to leave safety margin
    if (estimatedInputTokens > 6000) {
      const err = new Error(
        `Groq token limit: estimated ${estimatedInputTokens} tokens exceeds 6,000 limit`
      );
      (err as unknown as { code: string }).code = 'GROQ_TOKEN_LIMIT_EXCEEDED';
      throw err;
    }

    const startTime = Date.now();

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1500,
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const status = res.status;
      const err = new Error(`Groq request failed (${status}): ${errText}`);
      (err as unknown as { status: number }).status = status;
      throw err;
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Groq returned empty response content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Groq returned invalid JSON: ${content.slice(0, 200)}`);
    }

    return {
      json: parsed,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? estimatedInputTokens,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      model: this.model,
      latencyMs,
    };
  }
}
