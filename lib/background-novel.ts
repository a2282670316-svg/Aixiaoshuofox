import { clampStageOutputTokens } from "./ai-limits";
import OpenAI from "openai";
import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { ensureNovelSchema, getProject, saveAutomationCheckpoint } from "@/db/novel-store";
import {
  applyChapterMemory,
  buildAutomatedChapterPrompt,
  cancelAutomationRun,
  chapterDraftWordRange,
  MAX_AUTOMATED_REPAIR_ATTEMPTS,
  buildChapterMemoryPrompt,
  buildChapterQualityIssues,
  buildChapterPlanDeviationIssues,
  buildMemoryEvidenceIssues,
  buildCharacterContinuityIssues,
  buildConsistencyRepairPrompt,
  buildRollingAuditPrompt,
  estimateWritingRange,
  evaluateChapterQuality,
  parseChapterMemory,
  parseConsistencyRepair,
  parseRollingAudit,
  removeChapterFromCanon,
  replaceChapterAuditIssues,
  stabilizeRepairAuditIssues,
  unresolvedChapterErrors,
  validateGeneratedChapterDraft,
  validateGeneratedChapterFormat,
} from "@/lib/auto-novel";
import type { Chapter, ConsistencyIssue, WorkspaceData } from "@/lib/types";

type BackgroundKind = "chapter_segment" | "chapter_memory" | "rolling_audit" | "consistency_repair";

type BackgroundStep = {
  stepKey: string;
  kind: BackgroundKind;
  prompt: string;
  chapterNumber: number;
  segmentNumber?: number;
};

type BackgroundJobRow = {
  id: string;
  response_id: string;
  run_id: string;
  project_id: string;
  owner_id: string;
  step_key: string;
  kind: BackgroundKind;
  chapter_number: number | null;
  segment_number: number | null;
  status: string;
  attempts: number;
};

type RetrievedBackgroundResponse = {
  status: string;
  output_text?: string;
  metadata?: Record<string, string> | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};

function configuredValue(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function backgroundConfiguration() {
  const apiKey = configuredValue(env.BACKGROUND_AI_API_KEY) || configuredValue(env.OPENAI_API_KEY);
  const model = configuredValue(env.BACKGROUND_AI_MODEL) || configuredValue(env.OPENAI_MODEL);
  const baseUrl = configuredValue(env.BACKGROUND_AI_BASE_URL) || "https://api.openai.com/v1";
  return {
    apiKey: Boolean(apiKey),
    model,
    baseUrl,
    provider: configuredValue(env.BACKGROUND_AI_BASE_URL) ? "第三方 Responses" : "OpenAI Responses",
    webhookSecret: Boolean(configuredValue(env.OPENAI_WEBHOOK_SECRET)),
    workerSecret: Boolean(configuredValue(env.BACKGROUND_WORKER_SECRET)),
  };
}

function openAIClient() {
  const apiKey = configuredValue(env.BACKGROUND_AI_API_KEY) || configuredValue(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("服务器尚未配置 BACKGROUND_AI_API_KEY");
  const baseURL = configuredValue(env.BACKGROUND_AI_BASE_URL) || undefined;
  return new OpenAI({ apiKey, baseURL });
}

function backgroundModel() {
  return configuredValue(env.BACKGROUND_AI_MODEL) || configuredValue(env.OPENAI_MODEL);
}

function chapterSegments(chapter: Chapter) {
  void chapter;
  return 1;
}

function reserveBackgroundRequest(workspace: WorkspaceData): WorkspaceData {
  if (workspace.automation.usage.requestCount >= workspace.automation.maxRequests) throw new Error("已达到最大模型调用次数");
  if (workspace.automation.usage.totalTokens >= workspace.automation.maxTokens) throw new Error("已达到最大 Token 预算");
  return {
    ...workspace,
    automation: {
      ...workspace.automation,
      usage: { ...workspace.automation.usage, requestCount: workspace.automation.usage.requestCount + 1 },
      updatedAt: new Date().toISOString(),
    },
  };
}

function applyBackgroundTokenUsage(workspace: WorkspaceData, usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null | undefined) {
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  const totalTokens = Number(usage?.total_tokens || inputTokens + outputTokens);
  return {
    ...workspace,
    automation: {
      ...workspace.automation,
      usage: {
        requestCount: workspace.automation.usage.requestCount,
        inputTokens: workspace.automation.usage.inputTokens + inputTokens,
        outputTokens: workspace.automation.usage.outputTokens + outputTokens,
        totalTokens: workspace.automation.usage.totalTokens + totalTokens,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

function prepareWritingWorkspace(source: WorkspaceData): WorkspaceData {
  const runId = source.automation.runId || `auto-${Date.now()}-${crypto.randomUUID()}`;
  const schedule = estimateWritingRange(source);
  if (schedule.errors.length) throw new Error(schedule.errors[0]);
  return {
    ...source,
    project: { ...source.project, status: "AI 后台创作中" },
    chapters: source.chapters.map((chapter) => source.automation.generatedChapterIds.includes(chapter.id) || chapter.number < schedule.range.fromChapter || chapter.number > schedule.range.toChapter ? chapter : {
      ...chapter,
      revision: chapter.revision || 0,
      generation: {
        runId,
        status: chapter.generation?.status || "planned",
        completedSegments: chapter.content.trim() && !validateGeneratedChapterDraft(chapter, chapter.content).length ? 1 : 0,
        baseRevision: chapter.generation?.baseRevision ?? chapter.revision ?? 0,
        repairAttempts: chapter.generation?.repairAttempts || 0,
        draftAttempts: chapter.generation?.draftAttempts || 0,
      },
    }),
    automation: {
      ...source.automation,
      runId,
      phase: "writing",
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    },
  };
}

function nextBackgroundStep(workspace: WorkspaceData): BackgroundStep | null {
  const runId = workspace.automation.runId;
  if (!runId) throw new Error("自动创作缺少运行编号");
  const schedule = estimateWritingRange(workspace);

  for (const chapter of schedule.chapters) {
    const generation = chapter.generation;
    const repairAttempts = generation?.repairAttempts || 0;
    const blockingIssues = unresolvedChapterErrors(workspace, chapter.number);
    const accepted = generation?.status === "accepted"
      || (workspace.automation.generatedChapterIds.includes(chapter.id)
        && workspace.canon.lastAuditedChapter >= chapter.number
        && !blockingIssues.length);
    if (accepted) continue;
    if (generation?.status === "blocked") return null;

    const total = chapterSegments(chapter);
    const completedSegments = Math.min(total, generation?.completedSegments || 0);
    if (completedSegments < total) {
      return {
        stepKey: `${runId}:chapter:${chapter.number}:draft:${(generation?.draftAttempts || 0) + 1}`,
        kind: "chapter_segment",
        chapterNumber: chapter.number,
        segmentNumber: 1,
        prompt: buildAutomatedChapterPrompt(workspace, chapter, { existingDraft: chapter.content }),
      };
    }
    if (!chapter.memory) {
      return {
        stepKey: `${runId}:chapter:${chapter.number}:memory:${repairAttempts}`,
        kind: "chapter_memory",
        chapterNumber: chapter.number,
        prompt: buildChapterMemoryPrompt(workspace, chapter),
      };
    }
    if (generation?.status === "audited" && blockingIssues.length) {
      if (repairAttempts >= MAX_AUTOMATED_REPAIR_ATTEMPTS) return null;
      const combinedIssue: ConsistencyIssue = {
        ...blockingIssues[0],
        title: `第 ${chapter.number} 章自动验收未通过（${blockingIssues.length} 项）`,
        description: blockingIssues.map((issue, index) => `${index + 1}. ${issue.title}：${issue.description}`).join("\n"),
        suggestedFix: blockingIssues.map((issue) => issue.suggestedFix).filter(Boolean).join("；"),
      };
      return {
        stepKey: `${runId}:chapter:${chapter.number}:repair:${repairAttempts + 1}`,
        kind: "consistency_repair",
        chapterNumber: chapter.number,
        prompt: buildConsistencyRepairPrompt(workspace, combinedIssue, chapter),
      };
    }
    return {
      stepKey: `${runId}:audit:${chapter.number}:${repairAttempts}`,
      kind: "rolling_audit",
      chapterNumber: chapter.number,
      prompt: buildRollingAuditPrompt(workspace, chapter.number),
    };
  }
  return null;
}

async function finishRun(ownerId: string, projectId: string, workspace: WorkspaceData) {
  const runId = workspace.automation.runId;
  const schedule = estimateWritingRange(workspace);
  const allGenerated = workspace.chapters.every((chapter) => workspace.automation.generatedChapterIds.includes(chapter.id));
  const finished: WorkspaceData = {
    ...workspace,
    project: { ...workspace.project, status: allGenerated ? "初稿完成" : "创作中" },
    outline: allGenerated ? workspace.outline.map((item) => ({ ...item, status: "已完成" })) : workspace.outline,
    automation: {
      ...workspace.automation,
      phase: allGenerated ? "completed" : "paused",
      currentChapterNumber: allGenerated ? workspace.chapters.length : schedule.range.toChapter,
      currentSegment: 0,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveAutomationCheckpoint(ownerId, projectId, finished, {
    stepKey: `${runId}:${allGenerated ? "completed" : `range-completed:${schedule.range.fromChapter}-${schedule.range.toChapter}`}`,
    kind: allGenerated ? "run_completed" : "range_completed",
    status: "completed",
  });
  return finished;
}

async function submitStep(ownerId: string, projectId: string, workspace: WorkspaceData, step: BackgroundStep, respectPause = false) {
  const runId = workspace.automation.runId;
  if (!runId) throw new Error("自动创作缺少运行编号");
  if (respectPause) {
    const latest = await getProject(ownerId, projectId);
    if (latest?.workspace.automation.phase === "paused") return null;
  }
  const existing = await getD1().prepare(`SELECT response_id, status FROM background_responses
    WHERE run_id = ? AND step_key = ?`).bind(runId, step.stepKey).first();
  if (existing && ["queued", "processing", "completed"].includes(String(existing.status))) {
    return { responseId: String(existing.response_id), providerStatus: String(existing.status), step };
  }

  if (workspace.automation.usage.requestCount >= workspace.automation.maxRequests) throw new Error("已达到最大模型调用次数");
  if (workspace.automation.usage.totalTokens >= workspace.automation.maxTokens) throw new Error("已达到最大 Token 预算");
  const stage = step.kind === "chapter_segment" ? "chapter" : step.kind === "chapter_memory" ? "memory" : step.kind === "rolling_audit" ? "audit" : "repair";
  const stageConfig = workspace.automation.stageModels?.[stage];
  const model = stageConfig?.model?.trim() || backgroundModel();
  if (!model) throw new Error("服务器尚未配置 BACKGROUND_AI_MODEL");
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO background_responses
    (id, response_id, run_id, project_id, owner_id, step_key, kind, chapter_number,
     segment_number, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?)
    ON CONFLICT(run_id, step_key) DO UPDATE SET response_id = excluded.response_id,
      status = 'queued', attempts = background_responses.attempts + 1,
      last_error = NULL, updated_at = excluded.updated_at`)
    .bind(jobId, `pending:${jobId}`, runId, projectId, ownerId, step.stepKey, step.kind,
      step.chapterNumber, step.segmentNumber ?? null, now, now)
    .run();
  if (respectPause) {
    const latest = await getProject(ownerId, projectId);
    if (latest?.workspace.automation.phase === "paused") {
      await getD1().prepare("UPDATE background_responses SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), jobId).run();
      return null;
    }
  }
  const reservedWorkspace = reserveBackgroundRequest(workspace);
  await saveAutomationCheckpoint(ownerId, projectId, reservedWorkspace);
  try {
    const response = await openAIClient().responses.create({
      model,
      input: step.prompt,
      instructions: "你是严谨、尊重作者意图的中文长篇小说创作助手。严格遵循用户要求的输出格式。",
      background: true,
      store: true,
      temperature: stageConfig?.temperature,
      reasoning: stageConfig?.reasoningEffort ? { effort: stageConfig.reasoningEffort } : undefined,
      text: stageConfig?.verbosity ? { verbosity: stageConfig.verbosity } : undefined,
      max_output_tokens: clampStageOutputTokens(stageConfig?.maxOutputTokens, 16_000),
      metadata: { novel_job_id: jobId, novel_run_id: runId.slice(0, 64) },
    });
    await getD1().prepare("UPDATE background_responses SET response_id = ?, updated_at = ? WHERE id = ?")
      .bind(response.id, new Date().toISOString(), jobId).run();
    return { responseId: response.id, providerStatus: response.status, step, workspace: reservedWorkspace };
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交后台响应失败";
    await getD1().prepare("UPDATE background_responses SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
      .bind(message.slice(0, 4000), new Date().toISOString(), jobId).run();
    throw error;
  }
}

export async function enqueueNextBackgroundStep(ownerId: string, projectId: string, source?: WorkspaceData) {
  await ensureNovelSchema();
  const project = await getProject(ownerId, projectId);
  if (!project) throw new Error("找不到云端作品");
  if (source && project.workspace.automation.phase === "paused") {
    return { status: "paused", workspace: project.workspace };
  }
  let workspace = prepareWritingWorkspace(source || project.workspace);
  if (!workspace.chapters.length) throw new Error("请先生成全书蓝图和章节目录");
  await saveAutomationCheckpoint(ownerId, projectId, workspace);
  const step = nextBackgroundStep(workspace);
  if (!step) {
    workspace = await finishRun(ownerId, projectId, workspace);
    return { status: workspace.automation.phase === "completed" ? "completed" : "range_completed", workspace };
  }
  const submitted = await submitStep(ownerId, projectId, workspace, step, Boolean(source));
  if (!submitted) {
    const paused = await getProject(ownerId, projectId);
    return { status: "paused", workspace: paused?.workspace || workspace };
  }
  return { status: "queued", workspace: submitted.workspace || workspace, ...submitted };
}

function applyCompletedStep(workspace: WorkspaceData, job: BackgroundJobRow, output: string) {
  const runId = workspace.automation.runId!;
  const chapter = workspace.chapters.find((item) => item.number === job.chapter_number);
  if (!chapter) throw new Error(`找不到第 ${job.chapter_number} 章`);
  const now = new Date().toISOString();

  if (job.kind === "chapter_segment") {
    const formatIssues = validateGeneratedChapterFormat(output);
    if (formatIssues.length) throw new Error(`\u540e\u53f0\u6574\u7ae0\u6b63\u6587\u672a\u901a\u8fc7\u683c\u5f0f\u68c0\u67e5\uff1a${formatIssues.join("\uff1b")}`);
    const cleaned = removeChapterFromCanon(workspace, chapter.number);
    const actualLength = output.replace(/\s/g, "").length;
    const minimumWords = chapterDraftWordRange(chapter.targetWords).minimum;
    if (actualLength < minimumWords) {
      return {
        ...cleaned,
        chapters: cleaned.chapters.map((item) => item.id === chapter.id ? {
          ...item,
          content: output.trim(),
          memory: undefined,
          status: "\u4fee\u8ba2\u4e2d" as const,
          updatedAt: now,
          generation: {
            runId,
            status: "planned" as const,
            completedSegments: 0,
            baseRevision: item.generation?.baseRevision ?? item.revision ?? 0,
            repairAttempts: item.generation?.repairAttempts || 0,
            draftAttempts: (item.generation?.draftAttempts || 0) + 1,
          },
        } : item),
        automation: {
          ...cleaned.automation,
          phase: "writing" as const,
          currentChapterNumber: chapter.number,
          currentSegment: 0,
          lastError: undefined,
          updatedAt: now,
        },
      };
    }
    return {
      ...cleaned,
      chapters: cleaned.chapters.map((item) => item.id === chapter.id ? {
        ...item,
        content: output.trim(),
        memory: undefined,
        status: "\u4fee\u8ba2\u4e2d" as const,
        updatedAt: now,
        generation: {
          runId,
          status: "generating" as const,
          completedSegments: 1,
          baseRevision: item.generation?.baseRevision ?? item.revision ?? 0,
          repairAttempts: item.generation?.repairAttempts || 0,
          draftAttempts: item.generation?.draftAttempts || 0,
        },
      } : item),
      automation: {
        ...cleaned.automation,
        phase: "writing" as const,
        currentChapterNumber: chapter.number,
        currentSegment: 1,
        updatedAt: now,
      },
    };
  }

  if (job.kind === "consistency_repair") {
    const repaired = parseConsistencyRepair(output, chapter.content);
    const repairValidation = validateGeneratedChapterDraft(chapter, repaired.revisedContent);
    if (repairValidation.length) throw new Error(`\u540e\u53f0\u4fee\u590d\u540e\u7684\u5b8c\u6574\u6b63\u6587\u672a\u901a\u8fc7\u68c0\u67e5\uff1a${repairValidation.join("\uff1b")}`);
    const repairAttempts = (chapter.generation?.repairAttempts || 0) + 1;
    const repairVersionId = `version-${Date.now()}-${chapter.number}`;
    let updated = removeChapterFromCanon(workspace, chapter.number);
    updated = {
      ...updated,
      chapters: updated.chapters.map((item) => item.id === chapter.id ? {
        ...item,
        content: repaired.revisedContent,
        status: "修订中" as const,
        memory: undefined,
        revision: (item.revision || 0) + 1,
        updatedAt: now,
        repairReview: { beforeVersionId: repairVersionId, changeSummary: repaired.changeSummary, createdAt: now, status: "pending" },
        generation: item.generation ? { ...item.generation, status: "repairing" as const, repairAttempts } : item.generation,
      } : item),
      versions: [{
        id: repairVersionId,
        chapterId: chapter.id,
        title: chapter.title,
        content: chapter.content,
        createdAt: now,
        note: "自动闭环修复前存档",
      }, ...updated.versions],
      issues: updated.issues.map((issue) => issue.chapterNumber === chapter.number && !issue.resolved ? { ...issue, resolved: true } : issue),
      automation: { ...updated.automation, updatedAt: now },
    };
    return updated;
  }

  if (job.kind === "chapter_memory") {
    let updated = applyChapterMemory(workspace, chapter.id, parseChapterMemory(output));
    updated = {
      ...updated,
      chapters: updated.chapters.map((item) => item.id === chapter.id ? {
        ...item,
        status: "修订中" as const,
        generation: item.generation ? { ...item.generation, status: "generated" as const } : item.generation,
      } : item),
      automation: {
        ...updated.automation,
        currentChapterNumber: chapter.number,
        currentSegment: 0,
        updatedAt: now,
      },
    };
    return updated;
  }

  const aiIssues = parseRollingAudit(output, runId, chapter.number, chapter.content);
  const rawAuditIssues = [...buildChapterQualityIssues(workspace, chapter.number, runId), ...buildChapterPlanDeviationIssues(workspace, chapter.number, runId), ...buildMemoryEvidenceIssues(workspace, chapter.number, runId), ...buildCharacterContinuityIssues(workspace, chapter.number), ...aiIssues];
  const auditIssues = (chapter.generation?.repairAttempts || 0) > 0
    ? stabilizeRepairAuditIssues(workspace.issues.filter((issue) => issue.chapterNumber === chapter.number), rawAuditIssues)
    : rawAuditIssues;
  let updated = replaceChapterAuditIssues(workspace, chapter.number, auditIssues);
  let quality = evaluateChapterQuality(updated, chapter.number);
  if (quality.overall < 70) {
    updated = { ...updated, issues: [...updated.issues, { id: `quality-score-${runId}-${chapter.number}-${chapter.revision || 0}`, severity: "错误", category: "情节", title: "章节综合质量未达到验收线", description: `当前综合质量 ${quality.overall} 分，低于 70 分验收线。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, suggestedFix: quality.notes.join("；"), source: "local" }] };
    quality = evaluateChapterQuality(updated, chapter.number);
  }
  const blockingIssues = unresolvedChapterErrors(updated, chapter.number);
  const repairAttempts = chapter.generation?.repairAttempts || 0;
  const accepted = !blockingIssues.length;
  const blocked = !accepted && repairAttempts >= MAX_AUTOMATED_REPAIR_ATTEMPTS;
  updated = {
    ...updated,
    project: blocked ? { ...updated.project, status: "等待人工确认" } : updated.project,
    chapters: updated.chapters.map((item) => item.id === chapter.id ? {
      ...item,
      status: accepted ? "已完成" as const : "修订中" as const,
      quality,
      generation: item.generation ? {
        ...item.generation,
        status: accepted ? "accepted" as const : blocked ? "blocked" as const : "audited" as const,
        acceptedAt: accepted ? now : undefined,
      } : item.generation,
    } : item),
    canon: { ...updated.canon, lastAuditedChapter: Math.max(updated.canon.lastAuditedChapter, chapter.number) },
    automation: {
      ...updated.automation,
      phase: blocked ? "paused" as const : "writing" as const,
      generatedChapterIds: accepted
        ? [...new Set([...updated.automation.generatedChapterIds, chapter.id])]
        : updated.automation.generatedChapterIds.filter((id) => id !== chapter.id),
      currentChapterNumber: accepted ? chapter.number + 1 : chapter.number,
      currentSegment: 0,
      lastError: blocked ? `\u7b2c ${chapter.number} \u7ae0\u5df2\u81ea\u52a8\u4fee\u590d ${repairAttempts} \u6b21\uff0c\u4ecd\u6709 ${blockingIssues.length} \u9879\u6709\u6b63\u6587\u8bc1\u636e\u7684\u9519\u8bef\uff0c\u5df2\u6682\u505c\u7b49\u5f85\u4eba\u5de5\u786e\u8ba4` : undefined,
      updatedAt: now,
    },
  };
  return updated;
}

export async function completeBackgroundResponse(responseId: string, webhookId: string) {
  await ensureNovelSchema();
  const db = getD1();
  let response: RetrievedBackgroundResponse | undefined;
  let job = await db.prepare("SELECT * FROM background_responses WHERE response_id = ?").bind(responseId).first<BackgroundJobRow>();
  if (!job) {
    response = await openAIClient().responses.retrieve(responseId) as RetrievedBackgroundResponse;
    const jobId = response.metadata?.novel_job_id;
    if (jobId) {
      await db.prepare("UPDATE background_responses SET response_id = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
        .bind(responseId, new Date().toISOString(), jobId).run();
      job = await db.prepare("SELECT * FROM background_responses WHERE id = ?").bind(jobId).first<BackgroundJobRow>();
    }
  }
  if (!job) return { status: "ignored" };
  const eventInsert = await db.prepare(`INSERT OR IGNORE INTO webhook_events
    (id, event_type, response_id, received_at) VALUES (?, 'response.completed', ?, ?)`)
    .bind(webhookId, responseId, new Date().toISOString()).run();
  if (!eventInsert.meta.changes) return { status: "duplicate" };

  const claimed = await db.prepare(`UPDATE background_responses SET status = 'processing', updated_at = ?
    WHERE id = ? AND status = 'queued'`).bind(new Date().toISOString(), job.id).run();
  if (!claimed.meta.changes) return { status: "ignored" };

  try {
    response ||= await openAIClient().responses.retrieve(responseId) as RetrievedBackgroundResponse;
    if (response.status !== "completed") throw new Error(`后台响应状态为 ${response.status}`);
    const output = response.output_text?.trim();
    if (!output) throw new Error("后台模型没有返回可用文本");
    const project = await getProject(job.owner_id, job.project_id);
    if (!project) throw new Error("后台作品已经不存在");
    if (project.workspace.automation.phase === "paused" || project.workspace.automation.runId !== job.run_id) {
      await db.prepare("UPDATE background_responses SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), job.id).run();
      return { status: "paused" };
    }
    let workspace = applyCompletedStep(project.workspace, job, output);
    workspace = applyBackgroundTokenUsage(workspace, response.usage);
    const retryingShortDraft = job.kind === "chapter_segment" && (workspace.chapters.find((item) => item.number === job.chapter_number)?.generation?.completedSegments || 0) === 0;
    const taskLabel = job.kind === "chapter_segment"
      ? retryingShortDraft ? `\u7b2c ${job.chapter_number} \u7ae0\u5b57\u6570\u4e0d\u8db3\uff0c\u81ea\u52a8\u6574\u7ae0\u91cd\u5199` : `\u751f\u6210\u7b2c ${job.chapter_number} \u7ae0\u5b8c\u6574\u6b63\u6587`
      : job.kind === "chapter_memory" ? `\u63d0\u53d6\u7b2c ${job.chapter_number} \u7ae0\u4e8b\u5b9e\u8bb0\u5fc6`
        : job.kind === "rolling_audit" ? `\u5ba1\u6821\u7b2c ${job.chapter_number} \u7ae0` : `\u4fee\u590d\u7b2c ${job.chapter_number} \u7ae0`;
    workspace = { ...workspace, automation: { ...workspace.automation, taskLog: [{ id: job.id, runId: job.run_id, kind: job.kind, label: taskLabel, status: "completed" as const, chapterNumber: job.chapter_number ?? undefined, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, ...(workspace.automation.taskLog || []).filter((task) => task.id !== job.id)].slice(0, 500) } };
    await saveAutomationCheckpoint(job.owner_id, job.project_id, workspace, {
      stepKey: job.step_key,
      kind: job.kind,
      chapterNumber: job.chapter_number ?? undefined,
      segmentNumber: job.segment_number ?? undefined,
      status: "completed",
      outputExcerpt: output.slice(-1500),
      contextHash: `canon:${workspace.canon.revision}`,
    });
    const committed = await db.prepare("UPDATE background_responses SET status = 'completed', updated_at = ? WHERE response_id = ? AND status = 'processing'")
      .bind(new Date().toISOString(), responseId).run();
    if (!committed.meta.changes) {
      const paused: WorkspaceData = {
        ...workspace,
        project: { ...workspace.project, status: "已暂停" },
        automation: { ...workspace.automation, phase: "paused", updatedAt: new Date().toISOString() },
      };
      await saveAutomationCheckpoint(job.owner_id, job.project_id, paused, {
        stepKey: `${job.run_id}:paused:${job.chapter_number || 0}:${job.segment_number || 0}`,
        kind: "run_paused",
        chapterNumber: job.chapter_number ?? undefined,
        segmentNumber: job.segment_number ?? undefined,
        status: "completed",
      });
      return { status: "paused" };
    }
    const next = await enqueueNextBackgroundStep(job.owner_id, job.project_id, workspace);
    return { status: "completed", next: next.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "后台处理失败";
    await db.prepare("UPDATE background_responses SET status = 'failed', last_error = ?, updated_at = ? WHERE response_id = ?")
      .bind(message.slice(0, 4000), new Date().toISOString(), responseId).run();
    const project = await getProject(job.owner_id, job.project_id);
    if (project && job.kind === "consistency_repair" && (job.attempts || 1) < 2 && project.workspace.automation.phase !== "paused") {
      const retry = await enqueueNextBackgroundStep(job.owner_id, job.project_id, project.workspace);
      return { status: "retrying", error: message, next: retry.status };
    }
    if (project) {
      const failed: WorkspaceData = {
        ...project.workspace,
        automation: { ...project.workspace.automation, phase: "error", lastError: message, updatedAt: new Date().toISOString() },
      };
      await saveAutomationCheckpoint(job.owner_id, job.project_id, failed, {
        stepKey: `${job.run_id}:failed:${job.chapter_number || 0}:${job.segment_number || 0}`,
        kind: "run_failed",
        chapterNumber: job.chapter_number ?? undefined,
        segmentNumber: job.segment_number ?? undefined,
        status: "failed",
        error: message,
      });
    }
    return { status: "failed", error: message };
  }
}

export async function pauseBackgroundRun(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  const project = await getProject(ownerId, projectId);
  if (!project) throw new Error("找不到云端作品");
  const active = await getD1().prepare(`SELECT response_id FROM background_responses
    WHERE project_id = ? AND owner_id = ? AND status IN ('queued', 'processing') ORDER BY created_at DESC LIMIT 1`)
    .bind(projectId, ownerId).first();
  if (active?.response_id) {
    try { await openAIClient().responses.cancel(String(active.response_id)); } catch { /* already terminal */ }
    await getD1().prepare("UPDATE background_responses SET status = 'cancelled', updated_at = ? WHERE response_id = ?")
      .bind(new Date().toISOString(), String(active.response_id)).run();
  }
  const paused: WorkspaceData = {
    ...project.workspace,
    project: { ...project.workspace.project, status: "已暂停" },
    automation: { ...project.workspace.automation, phase: "paused", updatedAt: new Date().toISOString() },
  };
  await saveAutomationCheckpoint(ownerId, projectId, paused, {
    stepKey: `${paused.automation.runId}:paused:${paused.automation.currentChapterNumber}:${paused.automation.currentSegment}`,
    kind: "run_paused",
    status: "completed",
  });
  return paused;
}

export async function cancelBackgroundRun(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  const project = await getProject(ownerId, projectId);
  if (!project) throw new Error("\u627e\u4e0d\u5230\u4e91\u7aef\u4f5c\u54c1");
  const db = getD1();
  const active = await db.prepare(`SELECT id, response_id FROM background_responses
    WHERE project_id = ? AND owner_id = ? AND status IN ('queued', 'processing') ORDER BY created_at ASC`)
    .bind(projectId, ownerId).all<{ id: string; response_id: string }>();
  const now = new Date().toISOString();
  await db.prepare(`UPDATE background_responses SET status = 'cancelled', updated_at = ?
    WHERE project_id = ? AND owner_id = ? AND status IN ('queued', 'processing')`)
    .bind(now, projectId, ownerId).run();
  for (const row of active.results || []) {
    const responseId = String(row.response_id || "");
    if (!responseId || responseId.startsWith("pending:")) continue;
    try { await openAIClient().responses.cancel(responseId); } catch { /* already terminal */ }
  }
  const cancelled = cancelAutomationRun(project.workspace, now);
  await saveAutomationCheckpoint(ownerId, projectId, cancelled, {
    stepKey: `cancelled:${project.workspace.automation.runId || "run"}:${now}`,
    kind: "run_cancelled",
    status: "completed",
  });
  return cancelled;
}

export async function backgroundRunSummary(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  const db = getD1();
  const project = await db.prepare(`SELECT id, revision, updated_at, status FROM projects WHERE id = ? AND owner_id = ?`)
    .bind(projectId, ownerId).first();
  if (!project) return null;
  const run = await db.prepare(`SELECT phase, current_chapter, current_segment, request_count, total_tokens, updated_at
    FROM automation_runs WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(projectId, ownerId).first();
  const active = await db.prepare(`SELECT status, kind, chapter_number, segment_number, updated_at
    FROM background_responses WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(projectId, ownerId).first();
  return {
    project: {
      id: String(project.id), revision: Number(project.revision) || 1, updatedAt: String(project.updated_at), status: String(project.status),
    },
    automation: run ? {
      phase: String(run.phase), currentChapterNumber: Number(run.current_chapter) || 0, currentSegment: Number(run.current_segment) || 0,
      requestCount: Number(run.request_count) || 0, totalTokens: Number(run.total_tokens) || 0, updatedAt: String(run.updated_at),
    } : null,
    active: active || null,
    configuration: backgroundConfiguration(),
  };
}

export async function backgroundRunStatus(ownerId: string, projectId: string) {
  await ensureNovelSchema();
  const project = await getProject(ownerId, projectId);
  if (!project) return null;
  const active = await getD1().prepare(`SELECT response_id, step_key, kind, chapter_number, segment_number, status, last_error, updated_at
    FROM background_responses WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(projectId, ownerId).first();
  return { project, active: active || null, configuration: backgroundConfiguration() };
}

export async function pollBackgroundResponses(projectId?: string) {
  await ensureNovelSchema();
  const db = getD1();
  const query = projectId
    ? db.prepare(`SELECT response_id FROM background_responses
        WHERE project_id = ? AND status = 'queued' AND response_id NOT LIKE 'pending:%'
        ORDER BY created_at ASC LIMIT 5`).bind(projectId)
    : db.prepare(`SELECT response_id FROM background_responses
        WHERE status = 'queued' AND response_id NOT LIKE 'pending:%'
        ORDER BY created_at ASC LIMIT 5`);
  const rows = await query.all<{ response_id: string }>();
  const results: Array<{ responseId: string; status: string; error?: string }> = [];
  for (const row of rows.results || []) {
    const responseId = String(row.response_id);
    try {
      const response = await openAIClient().responses.retrieve(responseId) as RetrievedBackgroundResponse;
      if (["queued", "in_progress"].includes(response.status)) {
        results.push({ responseId, status: response.status });
        continue;
      }
      const completed = await completeBackgroundResponse(responseId, `poll:${responseId}:${response.status}`);
      results.push({ responseId, status: completed.status });
    } catch (error) {
      results.push({ responseId, status: "retry", error: error instanceof Error ? error.message : "轮询失败" });
    }
  }
  return results;
}
