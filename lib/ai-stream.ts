export type AIStreamPayload = {
  text: string;
  usage?: Record<string, unknown>;
  finishReason?: string;
  apiMode?: "chat" | "responses";
};

function parseEventBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

export async function readAIResponse(
  response: Response,
  onDelta?: (chunk: string, accumulated: string) => void,
): Promise<AIStreamPayload> {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const raw = await response.text();
    let payload: AIStreamPayload & { error?: string } = { text: "" };
    try { payload = JSON.parse(raw) as AIStreamPayload & { error?: string }; } catch { payload.error = raw.trim(); }
    if (!response.ok) throw new Error(payload.error || `模型接口返回 ${response.status}`);
    if (!payload.text?.trim()) throw new Error(payload.error || "模型没有返回可用文本");
    return payload;
  }
  if (!response.body) throw new Error("模型没有返回流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: Record<string, unknown> | undefined;
  let finishReason: string | undefined;
  let apiMode: "chat" | "responses" | undefined;
  const consume = (block: string) => {
    const parsed = parseEventBlock(block);
    if (!parsed.data) return;
    const data = JSON.parse(parsed.data) as { text?: string; error?: string; usage?: Record<string, unknown>; finishReason?: string; apiMode?: "chat" | "responses" };
    if (parsed.event === "error") throw new Error(data.error || "模型流式输出失败");
    if (parsed.event === "delta" && data.text) {
      text += data.text;
      onDelta?.(data.text, text);
    }
    if (parsed.event === "done") {
      usage = data.usage;
      finishReason = data.finishReason;
      apiMode = data.apiMode;
    }
  };
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.trim()) consume(block);
      boundary = buffer.indexOf("\n\n");
    }
    if (chunk.done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!text.trim()) throw new Error("模型没有返回可用文本");
  return { text, usage, finishReason, apiMode };
}
