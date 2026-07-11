import { NextResponse } from "next/server";
import { resolveAIEndpoint, type AIEndpointMode } from "@/lib/ai-endpoint";
import { DEFAULT_STAGE_OUTPUT_TOKENS, MAX_STAGE_OUTPUT_TOKENS, MIN_STAGE_OUTPUT_TOKENS } from "@/lib/ai-limits";
import type { AIStage } from "@/lib/types";

type AIRequestBody = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiMode?: AIEndpointMode;
  stage?: AIStage;
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  prompt?: string;
};

const MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 12_000_000;
const UPSTREAM_TIMEOUT_MS = 600_000;

const AI_RATE_WINDOW_MS = 60_000;
const AI_RATE_LIMIT = 30;
const AI_CONCURRENCY_LIMIT = 3;
type RateState = { windowStartedAt: number; requests: number; active: number };
const aiRateStates = new Map<string, RateState>();

function requestIdentity(request: Request) {
  const owner = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (owner) return `owner:${owner}`;
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0];
  return `ip:${forwarded?.trim() || "unknown"}`;
}

function reserveAIRequestSlot(request: Request) {
  const now = Date.now();
  const key = requestIdentity(request);
  const previous = aiRateStates.get(key);
  const state = !previous || now - previous.windowStartedAt >= AI_RATE_WINDOW_MS
    ? { windowStartedAt: now, requests: 0, active: previous?.active || 0 }
    : previous;
  if (state.requests >= AI_RATE_LIMIT) return { error: "AI 请求过于频繁，请稍后再试", status: 429 } as const;
  if (state.active >= AI_CONCURRENCY_LIMIT) return { error: "同时运行的 AI 请求过多，请等待当前任务完成", status: 429 } as const;
  state.requests += 1;
  state.active += 1;
  aiRateStates.set(key, state);
  return {
    release: () => {
      const current = aiRateStates.get(key);
      if (!current) return;
      current.active = Math.max(0, current.active - 1);
      if (!current.active && Date.now() - current.windowStartedAt > AI_RATE_WINDOW_MS * 2) aiRateStates.delete(key);
    },
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("模型响应过大");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("模型响应过大");
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value + decoder.decode();
}

function extractText(payload: Record<string, unknown>) {
  const choices = payload.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String(part.text ?? "");
        return "";
      })
      .join("");
  }

  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output)) {
    return payload.output.flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) return [];
      return item.content.flatMap((content) => isRecord(content) && content.type === "output_text" && typeof content.text === "string" ? [content.text] : []);
    }).join("");
  }
  return "";
}

export async function POST(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "拒绝跨站 AI 请求" }, { status: 403 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  }

  let rawBody: unknown;

  try {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    }
    rawBody = JSON.parse(rawText) as unknown;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的 JSON" }, { status: 400 });
  }

  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: "请求内容必须是 JSON 对象" }, { status: 400 });
  }
  const body = rawBody as AIRequestBody;
  if (typeof body.baseUrl !== "string" || typeof body.apiKey !== "string" || typeof body.model !== "string" || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "接口地址、API Key、模型名称和提示词必须是文本" }, { status: 400 });
  }

  const apiKey = body.apiKey.trim();
  const model = body.model.trim();
  const prompt = body.prompt.trim();

  if (!model || !prompt || !body.baseUrl.trim()) {
    return NextResponse.json({ error: "请完整填写接口地址与模型名称" }, { status: 400 });
  }
  if (body.baseUrl.length > 2048 || apiKey.length > 10000 || model.length > 300) {
    return NextResponse.json({ error: "接口配置字段过长" }, { status: 400 });
  }
  if (prompt.length > 120_000) {
    return NextResponse.json({ error: "本次上下文过长，请精简后重试" }, { status: 413 });
  }
  if (body.temperature !== undefined && typeof body.temperature !== "number") {
    return NextResponse.json({ error: "创作温度必须是数字" }, { status: 400 });
  }
  const temperature = body.temperature === undefined ? 0.8 : body.temperature;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return NextResponse.json({ error: "创作温度必须是 0 到 2 之间的数字" }, { status: 400 });
  }
  if (body.stage !== undefined && !["ideation", "blueprint", "chapter", "memory", "audit", "repair"].includes(body.stage)) {
    return NextResponse.json({ error: "AI 任务阶段无效" }, { status: 400 });
  }
  if (body.reasoningEffort !== undefined && !["none", "low", "medium", "high", "xhigh"].includes(body.reasoningEffort)) {
    return NextResponse.json({ error: "推理强度无效" }, { status: 400 });
  }
  if (body.verbosity !== undefined && !["low", "medium", "high"].includes(body.verbosity)) {
    return NextResponse.json({ error: "输出详细度无效" }, { status: 400 });
  }
  if (body.apiMode !== undefined && !["auto", "chat", "responses"].includes(body.apiMode)) {
    return NextResponse.json({ error: "接口模式无效" }, { status: 400 });
  }
  const maxOutputTokens = body.maxOutputTokens === undefined ? DEFAULT_STAGE_OUTPUT_TOKENS : body.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < MIN_STAGE_OUTPUT_TOKENS || maxOutputTokens > MAX_STAGE_OUTPUT_TOKENS) {
    return NextResponse.json({ error: "最大输出 Token 必须是 256 到 65536 之间的整数" }, { status: 400 });
  }

  let endpoint: ReturnType<typeof resolveAIEndpoint>;
  try {
    const requestHostname = new URL(request.url).hostname.toLowerCase();
    const allowPrivateNetwork = ["localhost", "127.0.0.1", "::1", "terminal.local"].includes(requestHostname);
    endpoint = resolveAIEndpoint(body.baseUrl, { allowPrivateNetwork, mode: body.apiMode || "auto" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "接口地址无效" },
      { status: 400 },
    );
  }

  const slot = reserveAIRequestSlot(request);
  if ("error" in slot) return NextResponse.json({ error: slot.error }, { status: slot.status });

  try {
    const upstreamSignal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
    const callUpstream = (url: string, mode: "chat" | "responses") => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        ...(mode === "responses" ? {
          instructions: "你是严谨、尊重作者意图的中文长篇小说创作助手。",
          input: prompt,
          ...(body.temperature !== undefined ? { temperature } : {}),
          ...(body.reasoningEffort ? { reasoning: { effort: body.reasoningEffort } } : {}),
          ...(body.verbosity ? { text: { verbosity: body.verbosity } } : {}),
          max_output_tokens: maxOutputTokens,
        } : {
          temperature,
          ...(body.reasoningEffort ? { reasoning_effort: body.reasoningEffort } : {}),
          ...(body.verbosity ? { verbosity: body.verbosity } : {}),
          max_tokens: maxOutputTokens,
          messages: [
            { role: "system", content: "你是严谨、尊重作者意图的中文长篇小说创作助手。" },
            { role: "user", content: prompt },
          ],
        }),
      }),
      redirect: "manual",
      signal: upstreamSignal,
    });
    let selectedMode = endpoint.mode;
    let upstream = await callUpstream(endpoint.url, selectedMode);
    if (upstream.status === 404 && endpoint.automatic) {
      await upstream.body?.cancel();
      const responsesEndpoint = resolveAIEndpoint(body.baseUrl, {
        allowPrivateNetwork: ["localhost", "127.0.0.1", "::1", "terminal.local"].includes(new URL(request.url).hostname.toLowerCase()),
        mode: "responses",
      });
      selectedMode = "responses";
      upstream = await callUpstream(responsesEndpoint.url, selectedMode);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return NextResponse.json({ error: "模型接口不允许重定向" }, { status: 502 });
    }
    const rawPayload = await readLimitedText(upstream);
    const payload = (() => {
      try {
        const parsed = JSON.parse(rawPayload) as unknown;
        return isRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    })();
    if (!upstream.ok) {
      const providerError = payload.error as Record<string, unknown> | string | undefined;
      const message =
        typeof providerError === "string"
          ? providerError
          : typeof providerError?.message === "string"
            ? providerError.message
            : `模型接口返回 ${upstream.status}`;
      const hint = upstream.status === 404 ? "；请检查接口模式与地址，Responses 地址通常以 /v1/responses 结尾" : "";
      return NextResponse.json({ error: `${message}${hint}` }, { status: upstream.status });
    }

    const text = extractText(payload).trim();
    if (!text) {
      return NextResponse.json({ error: "模型没有返回可用文本" }, { status: 502 });
    }
    const choices = payload.choices as Array<Record<string, unknown>> | undefined;
    const finishReason = typeof choices?.[0]?.finish_reason === "string"
      ? choices[0].finish_reason
      : isRecord(payload.incomplete_details) && typeof payload.incomplete_details.reason === "string"
        ? payload.incomplete_details.reason
        : undefined;
    if (finishReason === "length" || finishReason === "max_output_tokens") {
      return NextResponse.json({ error: "模型输出因长度限制被截断，请减小每章字数或更换支持更长输出的模型" }, { status: 422 });
    }

    return NextResponse.json({
      text,
      finishReason,
      apiMode: selectedMode,
      usage: isRecord(payload.usage) ? payload.usage : undefined,
    });
  } catch (error) {
    const cancelled = request.signal.aborted;
    const timedOut = !cancelled && error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    const message = cancelled
      ? "AI 请求已取消"
      : timedOut
        ? "模型在 10 分钟内没有完成响应。请求已安全停止；建议降低单章字数或最大输出 Token 后重试。"
        : error instanceof Error && error.message === "模型响应过大"
          ? error.message
          : "无法连接模型接口";
    return NextResponse.json({ error: message }, { status: cancelled ? 499 : timedOut ? 504 : 502 });
  } finally {
    slot.release();
  }
}
