import { NextResponse } from "next/server";
import {
  backgroundConfiguration,
  backgroundRunStatus,
  enqueueNextBackgroundStep,
  pauseBackgroundRun,
} from "@/lib/background-novel";
import { isRecord, readJsonBody, rejectCrossOrigin, requestOwner } from "@/app/api/_lib/request";

export async function GET(request: Request) {
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录后使用云端后台写作" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return NextResponse.json({ configuration: backgroundConfiguration() });
  const status = await backgroundRunStatus(ownerId, projectId);
  if (!status) return NextResponse.json({ error: "找不到作品" }, { status: 404 });
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录后使用云端后台写作" }, { status: 401 });
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request, 32_000);
  } catch (error) {
    const status = error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400;
    return NextResponse.json({ error: status === 413 ? "请求内容过大" : "请求内容不是有效 JSON" }, { status });
  }
  if (!isRecord(rawBody)) return NextResponse.json({ error: "请求内容必须是 JSON 对象" }, { status: 400 });
  const body = rawBody;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const action = body.action;
  if (!projectId || !["start", "retry", "pause"].includes(String(action))) {
    return NextResponse.json({ error: "作品编号或操作无效" }, { status: 400 });
  }

  try {
    if (action === "pause") {
      const workspace = await pauseBackgroundRun(ownerId, projectId);
      return NextResponse.json({ status: "paused", workspace });
    }
    const configuration = backgroundConfiguration();
    if (!configuration.apiKey || !configuration.model || !configuration.webhookSecret) {
      return NextResponse.json({
        error: "服务器后台写作尚未配置完成",
        missing: {
          apiKey: !configuration.apiKey,
          model: !configuration.model,
          webhookSecret: !configuration.webhookSecret,
        },
      }, { status: 503 });
    }
    const result = await enqueueNextBackgroundStep(ownerId, projectId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "后台写作操作失败" }, { status: 400 });
  }
}
