import { getD1 } from "./index";
import type { AutomationRecoveryData, AutomationRecoveryRun, GenerationRecoveryStep, WorkspaceData } from "@/lib/types";
import { mergeAutomationWorkspace, pruneWorkspaceHistory } from "@/lib/workspace";

export type ProjectSummary = {
  id: string;
  title: string;
  genre: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type GenerationStepInput = {
  stepKey: string;
  kind: string;
  chapterNumber?: number;
  segmentNumber?: number;
  status: "completed" | "failed";
  attempts?: number;
  contextHash?: string;
  outputExcerpt?: string;
  error?: string;
};

let schemaReady: Promise<void> | null = null;

export function ensureNovelSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getD1();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '筹备中',
        workspace_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_id, updated_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        current_chapter INTEGER NOT NULL DEFAULT 0,
        current_segment INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS automation_runs_project_updated_idx ON automation_runs (project_id, updated_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS automation_runs_owner_status_idx ON automation_runs (owner_id, status)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS generation_steps (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        step_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        chapter_number INTEGER,
        segment_number INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        context_hash TEXT,
        output_excerpt TEXT,
        error TEXT,
        usage_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS generation_steps_run_step_key_uidx ON generation_steps (run_id, step_key)"),
      db.prepare("CREATE INDEX IF NOT EXISTS generation_steps_project_chapter_idx ON generation_steps (project_id, chapter_number)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS canon_states (
        project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL,
        last_audited_chapter INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS workspace_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        label TEXT NOT NULL,
        workspace_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS workspace_snapshots_project_created_idx ON workspace_snapshots (project_id, created_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS background_responses (
        id TEXT PRIMARY KEY NOT NULL,
        response_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        chapter_number INTEGER,
        segment_number INTEGER,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS background_responses_response_id_uidx ON background_responses (response_id)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS background_responses_run_step_key_uidx ON background_responses (run_id, step_key)"),
      db.prepare("CREATE INDEX IF NOT EXISTS background_responses_project_status_idx ON background_responses (project_id, status)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY NOT NULL,
        event_type TEXT NOT NULL,
        response_id TEXT,
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
    ]);
    const projectColumns = await db.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
    if (!(projectColumns.results || []).some((column) => String(column.name) === "revision")) {
      await db.prepare("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1").run();
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  await ensureNovelSchema();
  const result = await getD1().prepare(`SELECT id, title, genre, status, created_at, updated_at, revision
    FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(ownerId).all();
  return (result.results || []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    genre: String(row.genre),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revision: Number(row.revision) || 1,
  }));
}

export async function getProject(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  const row = await getD1().prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).first();
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    genre: String(row.genre),
    status: String(row.status),
    workspace: JSON.parse(String(row.workspace_json)) as WorkspaceData,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revision: Number(row.revision) || 1,
  };
}

export async function saveProject(
  ownerId: string,
  projectId: string,
  workspace: WorkspaceData,
  expectedRevision?: number,
) {
  await ensureNovelSchema();
  const db = getD1();
  const now = new Date().toISOString();
  const serialized = JSON.stringify(workspace);
  if (expectedRevision === undefined) {
    const result = await db.prepare(`INSERT OR IGNORE INTO projects
      (id, owner_id, title, genre, status, workspace_json, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(projectId, ownerId, workspace.project.title, workspace.project.genre, workspace.project.status, serialized, now, now)
      .run();
    if (!result.meta.changes) throw new Error("PROJECT_CONFLICT");
  } else {
    const result = await db.prepare(`UPDATE projects SET
      title = ?, genre = ?, status = ?, workspace_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND owner_id = ? AND revision = ?`)
      .bind(workspace.project.title, workspace.project.genre, workspace.project.status, serialized, now, projectId, ownerId, expectedRevision)
      .run();
    if (!result.meta.changes) throw new Error("PROJECT_CONFLICT");
  }
  const saved = await getProject(ownerId, projectId);
  if (!saved) throw new Error("Project ownership mismatch");
  return saved;
}

export async function deleteProject(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  return getD1().prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).run();
}

export async function saveSnapshot(ownerId: string, projectId: string, label: string, workspace: WorkspaceData) {
  await ensureNovelSchema();
  const id = crypto.randomUUID();
  await getD1().prepare(`INSERT INTO workspace_snapshots
    (id, project_id, owner_id, label, workspace_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, projectId, ownerId, label.slice(0, 200), JSON.stringify(workspace), new Date().toISOString())
    .run();
  await getD1().prepare(`DELETE FROM workspace_snapshots WHERE id IN (
    SELECT id FROM workspace_snapshots WHERE project_id = ? AND owner_id = ?
    ORDER BY created_at DESC LIMIT -1 OFFSET 10
  )`).bind(projectId, ownerId).run();
  return id;
}

export async function saveAutomationCheckpoint(
  ownerId: string,
  projectId: string,
  workspace: WorkspaceData,
  step?: GenerationStepInput,
  expectedRevision?: number,
) {
  await ensureNovelSchema();
  const db = getD1();
  const ownership = await db.prepare("SELECT owner_id FROM projects WHERE id = ?").bind(projectId).first();
  if (ownership && String(ownership.owner_id) !== ownerId) throw new Error("Project ownership mismatch");

  let candidate = pruneWorkspaceHistory(workspace);
  let savedProject: Awaited<ReturnType<typeof saveProject>> | null = null;
  for (let attempt = 0; attempt < 2 && !savedProject; attempt += 1) {
    const existing = await getProject(ownerId, projectId);
    if (expectedRevision !== undefined && existing?.revision !== expectedRevision) throw new Error("PROJECT_CONFLICT");
    const nextWorkspace = existing && expectedRevision === undefined
      ? mergeAutomationWorkspace(existing.workspace, candidate)
      : candidate;
    try {
      savedProject = await saveProject(ownerId, projectId, nextWorkspace, existing?.revision);
      candidate = savedProject.workspace;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "PROJECT_CONFLICT" || expectedRevision !== undefined || attempt > 0) throw error;
    }
  }
  if (!savedProject) throw new Error("PROJECT_CONFLICT");

  const run = candidate.automation;
  if (!run.runId) throw new Error("Automation run id is missing");
  const existingRun = await db.prepare("SELECT owner_id FROM automation_runs WHERE id = ?").bind(run.runId).first();
  if (existingRun && String(existingRun.owner_id) !== ownerId) throw new Error("Run ownership mismatch");
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`INSERT INTO automation_runs
      (id, project_id, owner_id, status, phase, current_chapter, current_segment,
       request_count, input_tokens, output_tokens, total_tokens, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, phase = excluded.phase,
        current_chapter = excluded.current_chapter, current_segment = excluded.current_segment,
        request_count = excluded.request_count, input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens, total_tokens = excluded.total_tokens,
        last_error = excluded.last_error, updated_at = excluded.updated_at
      WHERE automation_runs.owner_id = excluded.owner_id`)
      .bind(run.runId, projectId, ownerId, run.phase, run.phase, run.currentChapterNumber, run.currentSegment,
        run.usage.requestCount, run.usage.inputTokens, run.usage.outputTokens, run.usage.totalTokens,
        run.lastError || null, now, now),
    db.prepare(`INSERT INTO canon_states (project_id, revision, state_json, last_audited_chapter, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json,
        last_audited_chapter = excluded.last_audited_chapter, updated_at = excluded.updated_at`)
      .bind(projectId, candidate.canon.revision, JSON.stringify(candidate.canon), candidate.canon.lastAuditedChapter, now),
  ];
  if (step) {
    statements.push(db.prepare(`INSERT INTO generation_steps
      (id, run_id, project_id, step_key, kind, chapter_number, segment_number, status,
       attempts, context_hash, output_excerpt, error, usage_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, step_key) DO UPDATE SET status = excluded.status,
        attempts = excluded.attempts, context_hash = excluded.context_hash,
        output_excerpt = excluded.output_excerpt, error = excluded.error,
        usage_json = excluded.usage_json, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), run.runId, projectId, step.stepKey, step.kind,
        step.chapterNumber ?? null, step.segmentNumber ?? null, step.status,
        step.attempts ?? 1, step.contextHash ?? null, step.outputExcerpt?.slice(0, 4000) ?? null,
        step.error?.slice(0, 4000) ?? null, JSON.stringify(run.usage), now, now));
  }
  await db.batch(statements);
  return { projectId, runId: run.runId, revision: savedProject.revision, updatedAt: now };
}


export async function listAutomationRecovery(ownerId: string, projectId: string): Promise<AutomationRecoveryData | null> {
  await ensureNovelSchema();
  const project = await getProject(ownerId, projectId);
  if (!project) return null;
  const db = getD1();
  const runResult = await db.prepare(`SELECT * FROM automation_runs
    WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 10`).bind(projectId, ownerId).all();
  const rows = runResult.results || [];
  const runs: AutomationRecoveryRun[] = [];
  for (const row of rows) {
    const runId = String(row.id);
    const stepResult = await db.prepare(`SELECT * FROM generation_steps
      WHERE project_id = ? AND run_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(projectId, runId).all();
    const steps: GenerationRecoveryStep[] = (stepResult.results || []).map((step) => {
      let usage: GenerationRecoveryStep["usage"];
      try {
        usage = step.usage_json ? JSON.parse(String(step.usage_json)) as GenerationRecoveryStep["usage"] : undefined;
      } catch {
        usage = undefined;
      }
      return {
        id: String(step.id),
        runId,
        stepKey: String(step.step_key),
        kind: String(step.kind),
        chapterNumber: step.chapter_number === null || step.chapter_number === undefined ? undefined : Number(step.chapter_number),
        segmentNumber: step.segment_number === null || step.segment_number === undefined ? undefined : Number(step.segment_number),
        status: String(step.status) === "failed" ? "failed" : "completed",
        attempts: Number(step.attempts) || 1,
        contextHash: step.context_hash ? String(step.context_hash) : undefined,
        outputExcerpt: step.output_excerpt ? String(step.output_excerpt) : undefined,
        error: step.error ? String(step.error) : undefined,
        usage,
        createdAt: String(step.created_at),
        updatedAt: String(step.updated_at),
      };
    });
    runs.push({
      id: runId,
      status: String(row.status),
      phase: String(row.phase) as AutomationRecoveryRun["phase"],
      currentChapterNumber: Number(row.current_chapter) || 0,
      currentSegment: Number(row.current_segment) || 0,
      usage: {
        requestCount: Number(row.request_count) || 0,
        inputTokens: Number(row.input_tokens) || 0,
        outputTokens: Number(row.output_tokens) || 0,
        totalTokens: Number(row.total_tokens) || 0,
      },
      lastError: row.last_error ? String(row.last_error) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      steps,
    });
  }
  return { projectId, runs };
}
