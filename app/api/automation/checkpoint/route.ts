import { NextResponse } from "next/server";
import { saveAutomationCheckpoint, type GenerationStepInput } from "@/db/novel-store";
import { DEMO_WORKSPACE } from "@/lib/demo-data";
import { normalizeWorkspaceData } from "@/lib/workspace";
import { isRecord, readJsonBody, rejectCrossOrigin, requestOwner } from "../../_lib/request";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录后使用持久任务" }, { status: 401 });
  try {
    const raw = await readJsonBody(request);
    if (!isRecord(raw) || !raw.workspace) {
      return NextResponse.json({ error: "缺少任务检查点" }, { status: 400 });
    }
    const workspace = normalizeWorkspaceData(raw.workspace, DEMO_WORKSPACE);
    if (!workspace.automation.runId) {
      return NextResponse.json({ error: "缺少自动任务 ID" }, { status: 400 });
    }
    const projectId = typeof raw.projectId === "string" && raw.projectId.trim()
      ? raw.projectId.slice(0, 200)
      : crypto.randomUUID();
    const rawStep = isRecord(raw.step) ? raw.step : null;
    const step: GenerationStepInput | undefined = rawStep && typeof rawStep.stepKey === "string" && typeof rawStep.kind === "string"
      ? {
          stepKey: rawStep.stepKey.slice(0, 300),
          kind: rawStep.kind.slice(0, 100),
          chapterNumber: typeof rawStep.chapterNumber === "number" ? rawStep.chapterNumber : undefined,
          segmentNumber: typeof rawStep.segmentNumber === "number" ? rawStep.segmentNumber : undefined,
          status: rawStep.status === "failed" ? "failed" : "completed",
          attempts: typeof rawStep.attempts === "number" ? Math.max(1, Math.min(10, rawStep.attempts)) : 1,
          contextHash: typeof rawStep.contextHash === "string" ? rawStep.contextHash : undefined,
          outputExcerpt: typeof rawStep.outputExcerpt === "string" ? rawStep.outputExcerpt : undefined,
          error: typeof rawStep.error === "string" ? rawStep.error : undefined,
        }
      : undefined;
    return NextResponse.json(await saveAutomationCheckpoint(ownerId, projectId, workspace, step));
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
      return NextResponse.json({ error: "任务检查点过大" }, { status: 413 });
    }
    return NextResponse.json({ error: "持久化任务检查点失败" }, { status: 503 });
  }
}
