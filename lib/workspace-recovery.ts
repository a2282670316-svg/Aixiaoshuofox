import type { GenerationRecoveryStep, WorkspaceData } from "@/lib/types";

const STALE_TASK_AGE_MS = 30 * 60 * 1000;

export function reconcileInterruptedTasks(
  workspace: WorkspaceData,
  now = new Date(),
  staleAfterMs = STALE_TASK_AGE_MS,
): WorkspaceData {
  let changed = false;
  const nowTime = now.getTime();
  const taskLog = (workspace.automation.taskLog || []).map((task) => {
    if (task.status !== "queued" && task.status !== "running") return task;
    const started = Date.parse(task.startedAt);
    if (Number.isFinite(started) && nowTime - started < staleAfterMs) return task;
    changed = true;
    return {
      ...task,
      status: "failed" as const,
      finishedAt: now.toISOString(),
      error: task.error || "\u4e0a\u6b21\u9875\u9762\u4e2d\u65ad\uff0c\u4efb\u52a1\u5df2\u8f6c\u5165\u5f85\u6062\u590d\u72b6\u6001",
    };
  });
  if (!changed) return workspace;
  return {
    ...workspace,
    automation: {
      ...workspace.automation,
      phase: ["ideating", "planning", "writing"].includes(workspace.automation.phase) ? "paused" : workspace.automation.phase,
      taskLog,
      lastError: workspace.automation.lastError || "\u68c0\u6d4b\u5230\u4e0a\u6b21\u672a\u5b8c\u6210\u4efb\u52a1\uff0c\u53ef\u5728\u6062\u590d\u4e2d\u5fc3\u7ee7\u7eed",
      updatedAt: now.toISOString(),
    },
  };
}

function blueprintStageFromKind(kind: string) {
  return ({
    blueprint_foundation: 1,
    blueprint_world: 2,
    blueprint_outline: 3,
    blueprint_foreshadows: 4,
    blueprint_chapters: 5,
  } as Record<string, 1 | 2 | 3 | 4 | 5>)[kind];
}

export function recoverWorkspaceFromStep(workspace: WorkspaceData, step: GenerationRecoveryStep): WorkspaceData {
  const now = new Date().toISOString();
  const blueprintStage = blueprintStageFromKind(step.kind);
  if (blueprintStage !== undefined) {
    const currentDraft = workspace.automation.blueprintDraft;
    return {
      ...workspace,
      automation: {
        ...workspace.automation,
        runId: step.runId,
        phase: "paused",
        blueprintDraft: currentDraft ? { ...currentDraft, completedStage: Math.min(currentDraft.completedStage, step.status === "completed" ? blueprintStage : blueprintStage - 1) as 0 | 1 | 2 | 3 | 4 | 5 } : currentDraft,
        lastError: undefined,
        updatedAt: now,
      },
    };
  }

  const chapterNumber = step.chapterNumber || workspace.automation.currentChapterNumber || 1;
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  const segment = step.kind === "chapter_segment"
    ? Math.max(0, (step.segmentNumber || 1) - (step.status === "failed" ? 1 : 0))
    : Math.max(0, chapter?.generation?.completedSegments || workspace.automation.currentSegment || 0);
  return {
    ...workspace,
    automation: {
      ...workspace.automation,
      runId: step.runId,
      phase: "paused",
      currentChapterNumber: chapterNumber,
      currentSegment: segment,
      writingRange: { fromChapter: chapterNumber, toChapter: workspace.automation.writingRange?.toChapter || workspace.automation.targetChapters },
      generatedChapterIds: workspace.automation.generatedChapterIds.filter((id) => id !== chapter?.id),
      lastError: undefined,
      updatedAt: now,
    },
  };
}
