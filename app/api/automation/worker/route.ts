import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { backgroundConfiguration, pollBackgroundResponses } from "@/lib/background-novel";

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function GET() {
  const configuration = backgroundConfiguration();
  return NextResponse.json({
    ready: configuration.apiKey && Boolean(configuration.model) && configuration.workerSecret,
    provider: configuration.provider,
    model: configuration.model,
  });
}

export async function POST(request: Request) {
  const secret = env.BACKGROUND_WORKER_SECRET?.trim() || "";
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return NextResponse.json({ error: "后台工作器鉴权失败" }, { status: 401 });
  }
  const results = await pollBackgroundResponses();
  return NextResponse.json({ checked: results.length, results });
}

