import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
  saveSnapshot,
} from "@/db/novel-store";
import { DEMO_WORKSPACE } from "@/lib/demo-data";
import { normalizeWorkspaceData } from "@/lib/workspace";
import { isRecord, readJsonBody, rejectCrossOrigin, requestOwner } from "../_lib/request";

export async function GET(request: Request) {
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录后使用云端作品库" }, { status: 401 });
  try {
    const projectId = new URL(request.url).searchParams.get("id");
    if (projectId) {
      const project = await getProject(ownerId, projectId);
      return project
        ? NextResponse.json({ project })
        : NextResponse.json({ error: "没有找到该作品" }, { status: 404 });
    }
    return NextResponse.json({ projects: await listProjects(ownerId) });
  } catch {
    return NextResponse.json({ error: "云端作品库暂时不可用" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录后保存云端作品" }, { status: 401 });
  try {
    const raw = await readJsonBody(request);
    if (!isRecord(raw) || !raw.workspace) {
      return NextResponse.json({ error: "缺少作品数据" }, { status: 400 });
    }
    if (raw.expectedRevision !== undefined && (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1)) {
      return NextResponse.json({ error: "云端作品版本号无效" }, { status: 400 });
    }
    const workspace = normalizeWorkspaceData(raw.workspace, DEMO_WORKSPACE);
    const projectId = typeof raw.projectId === "string" && raw.projectId.trim()
      ? raw.projectId.slice(0, 200)
      : crypto.randomUUID();
    const expectedRevision = Number.isInteger(raw.expectedRevision) && Number(raw.expectedRevision) > 0 ? Number(raw.expectedRevision) : undefined;
    if (raw.createSnapshot === true) {
      const existing = await getProject(ownerId, projectId);
      if (existing && expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error("PROJECT_CONFLICT");
      if (existing) await saveSnapshot(ownerId, projectId, typeof raw.snapshotLabel === "string" ? raw.snapshotLabel : "云端保存前快照", existing.workspace);
    }
    const project = await saveProject(ownerId, projectId, workspace, expectedRevision);
    return NextResponse.json({ projectId, project });
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_CONFLICT") {
      return NextResponse.json({ error: "云端作品已在其他页面或设备更新，请重新载入后再保存", conflict: true }, { status: 409 });
    }
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
      return NextResponse.json({ error: "作品数据超过云端单次保存限制" }, { status: 413 });
    }
    return NextResponse.json({ error: "保存云端作品失败" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const ownerId = requestOwner(request);
  if (!ownerId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("id");
  if (!projectId) return NextResponse.json({ error: "缺少作品 ID" }, { status: 400 });
  try {
    await deleteProject(ownerId, projectId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除云端作品失败" }, { status: 503 });
  }
}
