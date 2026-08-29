import type { AiConfig } from './types.js';

/** Đọc cấu hình AI từ env. Trả về null nếu chưa có API key (scanner vẫn chạy, chỉ tắt phần sinh fix). */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim() || 'glm-4.6';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

/** Gọi chat/completions (OpenAI-compatible) và yêu cầu trả về JSON. Retry 1 lần nếu provider không nhận response_format. */
export async function chatJson(
  config: AiConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<unknown> {
  const url = `${config.baseUrl}/chat/completions`;
  const baseBody = {
    model: config.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 8000,
  };

  const doFetch = async (body: unknown): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

  let res = await doFetch({ ...baseBody, response_format: { type: 'json_object' } });
  if (res.status === 400 || res.status === 422) {
    // provider không hỗ trợ response_format — thử lại không kèm
    res = await doFetch(baseBody);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI API lỗi HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI API trả về nội dung rỗng');
  return extractJson(content);
}
