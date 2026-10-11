// 云卷云舒 · 与 DeepSeek 的流式对话
//
// 平台无关：Node 与 Cloudflare Workers 的 ReadableStream 都支持异步迭代，
// 所以这一份代码两边都能跑。

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-chat';

/**
 * 逐块吐出模型返回的文本（SSE）。
 * @param {{apiKey:string, model?:string, endpoint?:string, messages:Array, signal?:AbortSignal, temperature?:number, maxTokens?:number}} opts
 * @returns {AsyncGenerator<string>}
 */
export async function* streamChat(opts) {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    messages,
    signal,
    temperature = 1.15,
    maxTokens = 2048,
  } = opts;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature,
      max_tokens: maxTokens,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    const err = new Error(`上游 ${res.status}${detail ? `：${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  if (!res.body) throw new Error('上游没有返回内容');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let done = false;

  for await (const chunk of res.body) {
    // Node 给的是 Uint8Array，Worker 给的也是 Uint8Array
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        done = true;
        break;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const piece = json?.choices?.[0]?.delta?.content;
      if (piece) yield piece;
    }
    if (done) break;
  }
}
