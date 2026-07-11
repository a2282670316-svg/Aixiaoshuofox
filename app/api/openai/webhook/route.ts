import OpenAI from "openai";
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { completeBackgroundResponse } from "@/lib/background-novel";

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(request: Request) {
  const secret = env.OPENAI_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook 尚未配置" }, { status: 503 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook 内容过大" }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook 内容过大" }, { status: 413 });
  }

  let event: Awaited<ReturnType<OpenAI["webhooks"]["unwrap"]>>;
  try {
    event = await new OpenAI({ apiKey: env.OPENAI_API_KEY || "webhook-verification-only" })
      .webhooks.unwrap(raw, request.headers, secret);
  } catch {
    return NextResponse.json({ error: "Webhook 签名无效" }, { status: 400 });
  }

  if (event.type !== "response.completed") return NextResponse.json({ received: true });
  const responseId = event.data.id;
  const webhookId = request.headers.get("webhook-id")?.trim() || event.id;
  const result = await completeBackgroundResponse(responseId, webhookId);
  return NextResponse.json({ received: true, status: result.status });
}
