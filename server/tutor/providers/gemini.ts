import type { ProviderCompletionResult, ProviderRequest, TutorProvider } from './types';
import { GEMINI_RESPONSE_SCHEMA } from './schema';

export class GeminiProvider implements TutorProvider {
  readonly id = 'gemini';
  readonly model: string;
  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, model: string = 'gemini-flash-latest') {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  async complete(
    request: ProviderRequest,
    jsonSchema: object = GEMINI_RESPONSE_SCHEMA
  ): Promise<ProviderCompletionResult> {
    const startTime = Date.now();

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: request.userPrompt }],
        },
      ],
      system_instruction: {
        parts: [{ text: request.systemPrompt }],
      },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 2500,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey, // Crucial: never in the URL
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const status = res.status;
      const err = new Error(`Gemini request failed (${status}): ${errText}`);
      (err as unknown as { status: number }).status = status;
      throw err;
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const partText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!partText) {
      throw new Error('Gemini returned empty candidate content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(partText);
    } catch {
      throw new Error(`Gemini returned invalid JSON: ${partText.slice(0, 200)}`);
    }

    return {
      json: parsed,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: this.model,
      latencyMs,
    };
  }
}
