"use client";

import {
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Cloud,
  FileText,
  Gauge,
  Lightbulb,
  LoaderCircle,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  WandSparkles,
  Zap,
} from "lucide-react";
import {
  buildAutomatedChapterPrompt,
  buildBlueprintCharactersPrompt,
  buildBlueprintChaptersPrompt,
  buildBlueprintForeshadowsPrompt,
  buildBlueprintOutlinePrompt,
  buildBlueprintWorldPrompt,
  buildChapterMemoryPrompt,
  buildRollingAuditPrompt,
  buildSeedPrompt,
  applyChapterMemory,
  createAutomationState,
  estimateWritingRange,
  parseChapterMemory,
  parseBlueprintStage,
  parseNovelBlueprint,
  parseRollingAudit,
  parseSeedOptions,
  reserveModelRequest,
  restartBlueprintDraft,
  rewindNovelFromChapter,
} from "@/lib/auto-novel";
import type { BlueprintStagePayload } from "@/lib/auto-novel";
import type {
  AIConfig,
  BlueprintDraft,
  NovelAutomation,
  StorySeed,
  WorkspaceData,
} from "@/lib/types";

type Props = {
  workspace: WorkspaceData;
  config: AIConfig;
  setWorkspace: Dispatch<SetStateAction<WorkspaceData>>;
  aiBusy: boolean;
  setAiBusy: Dispatch<SetStateAction<boolean>>;
  notify: (message: string) => void;
  onNeedConfig: () => void;
  onBackup: (workspace: WorkspaceData, label: string) => void;
  onOpenChapter: (chapterId: string) => void;
  onDurableCheckpoint?: (workspace: WorkspaceData, step: {
    stepKey: string;
    kind: string;
    chapterNumber?: number;
    segmentNumber?: number;
    status: "completed" | "failed";
    outputExcerpt?: string;
    error?: string;
    contextHash?: string;
  }) => Promise<void>;
  durableProjectId?: string;
  backgroundConfigured?: boolean;
  backgroundActive?: boolean;
  backgroundBusy?: boolean;
  backgroundModel?: string;
  onStartBackground?: (workspace: WorkspaceData) => Promise<void>;
  onPauseBackground?: () => Promise<void>;
};

const activePhases: NovelAutomation["phase"][] = ["ideating", "planning", "writing"];

function countCharacters(value: string) {
  return value.replace(/\s+/g, "").length;
}

function phaseLabel(phase: NovelAutomation["phase"]) {
  return {
    idle: "尚未开始",
    ideating: "正在生成故事方向",
    choosing: "等待选择故事",
    planning: "正在搭建全书蓝图",
    ready: "蓝图已就绪",
    writing: "正在连续写作",
    paused: "已暂停，可继续",
    completed: "全书初稿已完成",
    error: "任务遇到问题",
  }[phase];
}

function nextRunId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AutoNovelStudio({
  workspace,
  config,
  setWorkspace,
  aiBusy,
  setAiBusy,
  notify,
  onNeedConfig,
  onBackup,
  onOpenChapter,
  onDurableCheckpoint,
  durableProjectId,
  backgroundConfigured,
  backgroundActive,
  backgroundBusy,
  backgroundModel,
  onStartBackground,
  onPauseBackground,
}: Props) {
  const stopRequested = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef("");
  const usageRef = useRef(workspace.automation.usage);
  const budgetRef = useRef({ maxRequests: workspace.automation.maxRequests, maxTokens: workspace.automation.maxTokens });
  const [blueprintStage, setBlueprintStage] = useState("");
  const automation = workspace.automation;
  const isRunning = activePhases.includes(automation.phase) && !(automation.phase === "planning" && !aiBusy);
  const generatedCount = workspace.chapters.filter((item) => automation.generatedChapterIds.includes(item.id)).length;
  const estimatedSegments = Math.max(1, Math.ceil(automation.chapterWords / 2200));
  const estimatedCalls = 6 + automation.targetChapters * (estimatedSegments + 1) + Math.ceil(automation.targetChapters / 5);
  const writingEstimate = estimateWritingRange(workspace);
  const scheduledWorkspace: WorkspaceData = {
    ...workspace,
    automation: { ...workspace.automation, writingRange: writingEstimate.range },
  };

  const patchAutomation = (patch: Partial<NovelAutomation>) => {
    setWorkspace((current) => ({
      ...current,
      automation: {
        ...current.automation,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const ensureConfigured = () => {
    if (config.baseUrl.trim() && config.model.trim()) return true;
    onNeedConfig();
    notify("先连接 AI 模型，再启动全书创作");
    return false;
  };

  const requestText = async (prompt: string, signal?: AbortSignal) => {
    let lastError = "AI 请求失败";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      usageRef.current = reserveModelRequest(usageRef.current, budgetRef.current);
      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...config,
            prompt,
            maxOutputTokens: prompt.includes("第 5/5 步：章节") ? 32_768 : 16_384,
          }),
          signal,
        });
        const payload = await response.json().catch(() => ({})) as {
          text?: string;
          error?: string;
          usage?: Record<string, unknown>;
        };
        const usage = payload.usage || {};
        const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
        const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
        const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens;
        usageRef.current = {
          ...usageRef.current,
          inputTokens: usageRef.current.inputTokens + inputTokens,
          outputTokens: usageRef.current.outputTokens + outputTokens,
          totalTokens: usageRef.current.totalTokens + totalTokens,
        };
        if (response.ok && payload.text?.trim()) return payload.text.trim();
        lastError = payload.error || `模型接口返回 ${response.status}`;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
          throw new Error(lastError);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error instanceof Error ? error.message : lastError;
        if (attempt === 2) throw new Error(lastError);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 900 * 2 ** attempt));
    }
    throw new Error(lastError);
  };

  const requestStructured = async <T,>(prompt: string, parser: (value: string) => T, signal?: AbortSignal) => {
    const first = await requestText(prompt, signal);
    try {
      return parser(first);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "JSON 校验失败";
      const repaired = await requestText(`请修复下面的模型输出，使其严格满足原任务要求。只输出修复后的合法 JSON，不要解释，也不要 Markdown。\n\n【校验错误】\n${reason}\n\n【原任务】\n${prompt}\n\n【待修复输出】\n${first}`, signal);
      return parser(repaired);
    }
  };

  const generateBlueprintStages = async (
    source: WorkspaceData,
    seed: StorySeed,
    settings: NovelAutomation,
  ) => {
    const runId = source.automation.runId || "";
    const requestStage = async <T,>(prompt: string, parser: (value: string) => T) => {
      if (stopRequested.current || runTokenRef.current !== runId) throw new DOMException("蓝图生成已暂停", "AbortError");
      controllerRef.current = new AbortController();
      const result = await requestStructured(prompt, parser, controllerRef.current.signal);
      if (stopRequested.current || runTokenRef.current !== runId) throw new DOMException("蓝图生成已暂停", "AbortError");
      return result;
    };

    let working = source;
    let draft: BlueprintDraft = source.automation.blueprintDraft?.seedId === seed.id
      ? source.automation.blueprintDraft
      : { seedId: seed.id, completedStage: 0 };

    const persistStage = async (
      completedStage: BlueprintDraft["completedStage"],
      key: "foundation" | "world" | "outline" | "foreshadows" | "chapters",
      payload: BlueprintStagePayload,
    ) => {
      draft = { ...draft, [key]: payload, completedStage };
      working = {
        ...working,
        automation: {
          ...working.automation,
          phase: "planning",
          selectedSeedId: seed.id,
          usage: usageRef.current,
          blueprintDraft: draft,
          updatedAt: new Date().toISOString(),
        },
      };
      setWorkspace(working);
      await onDurableCheckpoint?.(working, {
        stepKey: `${working.automation.runId}:blueprint-stage-${completedStage}`,
        kind: `blueprint_${key}`,
        status: "completed",
        outputExcerpt: JSON.stringify(payload).slice(0, 1000),
      });
    };

    let foundation: BlueprintStagePayload | undefined;
    if (draft.completedStage >= 1 && draft.foundation) {
      try {
        foundation = parseBlueprintStage(JSON.stringify(draft.foundation), { stage: "characters" });
      } catch {
        draft = { seedId: seed.id, completedStage: 0 };
      }
    }
    if (!foundation) {
      setBlueprintStage("1/5 · 正在生成人物与关系");
      foundation = await requestStage(
        buildBlueprintCharactersPrompt(seed),
        (value) => parseBlueprintStage(value, { stage: "characters" }),
      );
      await persistStage(1, "foundation", foundation);
    }

    let world: BlueprintStagePayload | undefined;
    if (draft.completedStage >= 2 && draft.world) {
      try {
        world = parseBlueprintStage(JSON.stringify(draft.world), { stage: "world" });
      } catch {
        draft = { seedId: seed.id, completedStage: 1, foundation };
      }
    }
    if (!world) {
      setBlueprintStage("2/5 · 正在生成世界设定");
      world = await requestStage(
        buildBlueprintWorldPrompt(seed, foundation),
        (value) => parseBlueprintStage(value, { stage: "world" }),
      );
      await persistStage(2, "world", world);
    }

    let outline: BlueprintStagePayload | undefined;
    if (draft.completedStage >= 3 && draft.outline) {
      try {
        outline = parseBlueprintStage(JSON.stringify(draft.outline), { stage: "outline", targetChapters: settings.targetChapters });
      } catch {
        draft = { seedId: seed.id, completedStage: 2, foundation, world };
      }
    }
    if (!outline) {
      setBlueprintStage("3/5 · 正在生成故事大纲");
      outline = await requestStage(
        buildBlueprintOutlinePrompt(seed, settings, foundation, world),
        (value) => parseBlueprintStage(value, { stage: "outline", targetChapters: settings.targetChapters }),
      );
      await persistStage(3, "outline", outline);
    }

    let foreshadows: BlueprintStagePayload | undefined;
    if (draft.completedStage >= 4 && draft.foreshadows) {
      try {
        foreshadows = parseBlueprintStage(JSON.stringify(draft.foreshadows), { stage: "foreshadows", targetChapters: settings.targetChapters });
      } catch {
        draft = { seedId: seed.id, completedStage: 3, foundation, world, outline };
      }
    }
    if (!foreshadows) {
      setBlueprintStage("4/5 · 正在设计伏笔回收");
      foreshadows = await requestStage(
        buildBlueprintForeshadowsPrompt(seed, settings, foundation, outline),
        (value) => parseBlueprintStage(value, { stage: "foreshadows", targetChapters: settings.targetChapters }),
      );
      await persistStage(4, "foreshadows", foreshadows);
    }

    let chapters: BlueprintStagePayload | undefined;
    if (draft.completedStage >= 5 && draft.chapters) {
      try {
        chapters = parseBlueprintStage(JSON.stringify(draft.chapters), {
          stage: "chapters",
          targetChapters: settings.targetChapters,
          outlineStage: outline,
          foreshadowStage: foreshadows,
        });
      } catch {
        draft = { seedId: seed.id, completedStage: 4, foundation, world, outline, foreshadows };
      }
    }
    if (!chapters) {
      setBlueprintStage("5/5 · 正在生成逐章目录");
      chapters = await requestStage(
        buildBlueprintChaptersPrompt(seed, settings, { foundation, world, outline, foreshadows }),
        (value) => parseBlueprintStage(value, {
          stage: "chapters",
          targetChapters: settings.targetChapters,
          outlineStage: outline,
          foreshadowStage: foreshadows,
        }),
      );
      await persistStage(5, "chapters", chapters);
    }

    const merged: BlueprintStagePayload = { ...foundation, ...world, ...outline, ...foreshadows, ...chapters };
    return { blueprint: parseNovelBlueprint(JSON.stringify(merged), seed, settings), draft };
  };

  const writeNovel = async (source: WorkspaceData) => {
    if (!ensureConfigured()) return;
    const schedule = estimateWritingRange(source);
    if (schedule.errors.length) {
      notify(schedule.errors[0]);
      return;
    }
    usageRef.current = source.automation.usage;
    budgetRef.current = { maxRequests: source.automation.maxRequests, maxTokens: source.automation.maxTokens };
    const runId = source.automation.runId || nextRunId();
    runTokenRef.current = runId;
    stopRequested.current = false;
    let working: WorkspaceData = {
      ...source,
      project: { ...source.project, status: "AI 创作中" },
      chapters: source.chapters.map((chapter) => source.automation.generatedChapterIds.includes(chapter.id) || chapter.number < schedule.range.fromChapter || chapter.number > schedule.range.toChapter ? chapter : {
        ...chapter,
        revision: chapter.revision || 0,
        generation: {
          runId,
          status: chapter.generation?.status || "planned",
          completedSegments: chapter.generation?.completedSegments || 0,
          baseRevision: chapter.revision || 0,
        },
      }),
      automation: {
        ...source.automation,
        runId,
        phase: "writing",
        lastError: undefined,
        usage: usageRef.current,
        updatedAt: new Date().toISOString(),
      },
    };
    setAiBusy(true);
    setWorkspace(working);

    try {
      const ordered = [...working.chapters]
        .sort((a, b) => a.number - b.number)
        .filter((chapter) => chapter.number >= schedule.range.fromChapter && chapter.number <= schedule.range.toChapter);
      for (const item of ordered) {
        if (stopRequested.current || runTokenRef.current !== runId) break;
        if (working.automation.generatedChapterIds.includes(item.id)) continue;

        const segments = Math.max(1, Math.ceil(item.targetWords / 2200));
        const resumingCurrent = working.automation.currentChapterNumber === item.number;
        let startSegment = resumingCurrent ? working.automation.currentSegment : 0;
        let draft = resumingCurrent ? item.content : "";
        if (!resumingCurrent && item.content.trim()) {
          startSegment = Math.min(segments - 1, Math.floor(countCharacters(item.content) / Math.ceil(item.targetWords / segments)));
          draft = item.content;
        }

        for (let segmentIndex = startSegment; segmentIndex < segments; segmentIndex += 1) {
          if (stopRequested.current || runTokenRef.current !== runId) break;
          const target = working.chapters.find((chapter) => chapter.id === item.id) || item;
          controllerRef.current = new AbortController();
          const prompt = buildAutomatedChapterPrompt(working, target, {
            index: segmentIndex,
            total: segments,
            existingDraft: draft,
          });
          const generated = await requestText(prompt, controllerRef.current.signal);
          if (runTokenRef.current !== runId || stopRequested.current) break;
          const minimumSegmentLength = Math.max(300, Math.floor(item.targetWords / segments * .45));
          if (countCharacters(generated) < minimumSegmentLength) {
            throw new Error(`第 ${item.number} 章第 ${segmentIndex + 1} 段只有 ${countCharacters(generated)} 字，低于最低要求 ${minimumSegmentLength} 字，任务已暂停，请重试`);
          }
          draft = `${draft.trim()}${draft.trim() ? "\n\n" : ""}${generated.trim()}`;
          const isDraftComplete = segmentIndex === segments - 1;
          working = {
            ...working,
            chapters: working.chapters.map((chapter) => chapter.id === item.id ? {
              ...chapter,
              content: draft,
              status: isDraftComplete ? "修订中" : "草稿",
              updatedAt: new Date().toISOString(),
              generation: {
                runId,
                status: "generating",
                completedSegments: segmentIndex + 1,
                baseRevision: chapter.generation?.baseRevision ?? chapter.revision ?? 0,
              },
            } : chapter),
            automation: {
              ...working.automation,
              phase: "writing",
              currentChapterNumber: item.number,
              currentSegment: segmentIndex + 1,
              usage: usageRef.current,
              updatedAt: new Date().toISOString(),
            },
          };
          setWorkspace(working);
          await onDurableCheckpoint?.(working, {
            stepKey: `${runId}:chapter:${item.number}:segment:${segmentIndex + 1}`,
            kind: "chapter_segment",
            chapterNumber: item.number,
            segmentNumber: segmentIndex + 1,
            status: "completed",
            outputExcerpt: generated.slice(-1500),
            contextHash: `canon:${working.canon.revision}:chapter:${target.revision || 0}`,
          });
        }

        if (stopRequested.current || runTokenRef.current !== runId) break;
        const draftedChapter = working.chapters.find((chapter) => chapter.id === item.id);
        if (!draftedChapter) throw new Error(`第 ${item.number} 章检查点丢失`);
        controllerRef.current = new AbortController();
        const memory = await requestStructured(
          buildChapterMemoryPrompt(working, draftedChapter),
          parseChapterMemory,
          controllerRef.current.signal,
        );
        if (stopRequested.current || runTokenRef.current !== runId) break;
        working = applyChapterMemory(working, item.id, memory);
        working = {
          ...working,
          chapters: working.chapters.map((chapter) => chapter.id === item.id ? {
            ...chapter,
            status: "已完成",
            generation: chapter.generation ? { ...chapter.generation, status: "generated" } : chapter.generation,
          } : chapter),
          automation: {
            ...working.automation,
            generatedChapterIds: [...new Set([...working.automation.generatedChapterIds, item.id])],
            usage: usageRef.current,
            updatedAt: new Date().toISOString(),
          },
        };
        setWorkspace(working);
        await onDurableCheckpoint?.(working, {
          stepKey: `${runId}:chapter:${item.number}:memory`,
          kind: "chapter_memory",
          chapterNumber: item.number,
          status: "completed",
          outputExcerpt: memory.summary,
          contextHash: `canon:${working.canon.revision}`,
        });

        {
          controllerRef.current = new AbortController();
          const auditIssues = await requestStructured(
            buildRollingAuditPrompt(working, item.number),
            (value) => parseRollingAudit(value, runId, item.number),
            controllerRef.current.signal,
          );
          if (stopRequested.current || runTokenRef.current !== runId) break;
          working = {
            ...working,
            issues: [...working.issues, ...auditIssues.filter((candidate) => !working.issues.some((issue) => issue.title === candidate.title && issue.location === candidate.location))],
            chapters: working.chapters.map((chapter) => chapter.id === item.id ? {
              ...chapter,
              generation: chapter.generation ? { ...chapter.generation, status: "audited" } : chapter.generation,
            } : chapter),
            canon: { ...working.canon, lastAuditedChapter: item.number },
            automation: { ...working.automation, usage: usageRef.current, updatedAt: new Date().toISOString() },
          };
          setWorkspace(working);
          await onDurableCheckpoint?.(working, {
            stepKey: `${runId}:audit:${item.number}`,
            kind: "rolling_audit",
            chapterNumber: item.number,
            status: "completed",
            outputExcerpt: auditIssues.map((issue) => issue.title).join("；"),
            contextHash: `canon:${working.canon.revision}`,
          });
        }

        working = {
          ...working,
          automation: {
            ...working.automation,
            currentChapterNumber: item.number + 1,
            currentSegment: 0,
            usage: usageRef.current,
            updatedAt: new Date().toISOString(),
          },
        };
        setWorkspace(working);
      }

      if (stopRequested.current || runTokenRef.current !== runId) {
        working = {
          ...working,
          automation: {
            ...working.automation,
            phase: "paused",
            usage: usageRef.current,
            updatedAt: new Date().toISOString(),
          },
        };
        setWorkspace(working);
        await onDurableCheckpoint?.(working, {
          stepKey: `${runId}:paused:${working.automation.currentChapterNumber}:${working.automation.currentSegment}`,
          kind: "run_paused",
          status: "completed",
        });
        notify("全书创作已暂停，进度已经保存");
        return;
      }

      const allGenerated = working.chapters.every((chapter) => working.automation.generatedChapterIds.includes(chapter.id));
      working = {
        ...working,
        project: { ...working.project, status: allGenerated ? "初稿完成" : "创作中" },
        outline: allGenerated ? working.outline.map((item) => ({ ...item, status: "已完成" })) : working.outline,
        automation: {
          ...working.automation,
          phase: allGenerated ? "completed" : "paused",
          currentChapterNumber: allGenerated ? working.chapters.length : schedule.range.toChapter,
          currentSegment: 0,
          lastError: undefined,
          usage: usageRef.current,
          updatedAt: new Date().toISOString(),
        },
      };
      setWorkspace(working);
      await onDurableCheckpoint?.(working, {
        stepKey: `${runId}:${allGenerated ? "completed" : `range-completed:${schedule.range.fromChapter}-${schedule.range.toChapter}`}`,
        kind: allGenerated ? "run_completed" : "range_completed",
        status: "completed",
      });
      notify(allGenerated
        ? "全书初稿已经完成，可以进入章节审阅与导出"
        : `第 ${schedule.range.fromChapter}—${schedule.range.toChapter} 章已生成完成，任务已在范围终点安全停靠`);
    } catch (error) {
      const paused = stopRequested.current || controllerRef.current?.signal.aborted;
      working = {
        ...working,
        automation: {
          ...working.automation,
          phase: paused ? "paused" : "error",
          lastError: paused ? undefined : error instanceof Error ? error.message : "自动创作失败",
          usage: usageRef.current,
          updatedAt: new Date().toISOString(),
        },
      };
      setWorkspace(working);
      await onDurableCheckpoint?.(working, {
        stepKey: `${runId}:${paused ? "paused" : "failed"}:${working.automation.currentChapterNumber}:${working.automation.currentSegment}`,
        kind: paused ? "run_paused" : "run_failed",
        chapterNumber: working.automation.currentChapterNumber || undefined,
        segmentNumber: working.automation.currentSegment || undefined,
        status: paused ? "completed" : "failed",
        error: working.automation.lastError,
      }).catch(() => undefined);
      notify(paused ? "已暂停并保存进度" : working.automation.lastError || "自动创作失败");
    } finally {
      controllerRef.current = null;
      setAiBusy(false);
    }
  };

  const preparePlanningWorkspace = (source: WorkspaceData, seed: StorySeed): WorkspaceData => {
    const resumableDraft = source.automation.blueprintDraft?.seedId === seed.id
      ? source.automation.blueprintDraft
      : { seedId: seed.id, completedStage: 0 as const };
    return {
      ...source,
      automation: {
        ...source.automation,
        runId: source.automation.blueprintDraft?.seedId === seed.id && source.automation.runId
          ? source.automation.runId
          : nextRunId(),
        phase: "planning",
        selectedSeedId: seed.id,
        lastError: undefined,
        blueprintDraft: resumableDraft,
        updatedAt: new Date().toISOString(),
      },
    };
  };

  const buildBlueprint = async (seed: StorySeed, writeAfter = false) => {
    if (!ensureConfigured()) return;
    const currentSettings = workspace.automation;
    usageRef.current = currentSettings.usage;
    budgetRef.current = { maxRequests: currentSettings.maxRequests, maxTokens: currentSettings.maxTokens };
    setAiBusy(true);
    const planningWorkspace = preparePlanningWorkspace(workspace, seed);
    stopRequested.current = false;
    runTokenRef.current = planningWorkspace.automation.runId || nextRunId();
    setWorkspace(planningWorkspace);
    try {
      const { blueprint, draft } = await generateBlueprintStages(planningWorkspace, seed, planningWorkspace.automation);
      onBackup(workspace, "AI 全书创作前自动备份");
      const nextWorkspace: WorkspaceData = {
        ...blueprint,
        automation: createAutomationState({
          runId: planningWorkspace.automation.runId,
          phase: "ready",
          brief: currentSettings.brief,
          seeds: currentSettings.seeds,
          selectedSeedId: seed.id,
          targetChapters: currentSettings.targetChapters,
          targetWords: currentSettings.targetWords,
          chapterWords: currentSettings.chapterWords,
          currentChapterNumber: 1,
          currentSegment: 0,
          generatedChapterIds: [],
          writingRange: { fromChapter: 1, toChapter: currentSettings.targetChapters },
          usage: usageRef.current,
          maxRequests: currentSettings.maxRequests,
          maxTokens: currentSettings.maxTokens,
          blueprintDraft: draft,
          updatedAt: new Date().toISOString(),
        }),
      };
      setWorkspace(nextWorkspace);
      await onDurableCheckpoint?.(nextWorkspace, {
        stepKey: `${nextWorkspace.automation.runId}:blueprint`,
        kind: "blueprint",
        status: "completed",
        outputExcerpt: nextWorkspace.project.premise,
      });
      notify(`《${nextWorkspace.project.title}》全书蓝图已生成`);
      if (writeAfter) await writeNovel(nextWorkspace);
    } catch (error) {
      const paused = stopRequested.current || (error instanceof DOMException && error.name === "AbortError");
      patchAutomation({
        phase: paused ? "paused" : "error",
        lastError: paused ? undefined : error instanceof Error ? error.message : "全书蓝图生成失败",
        usage: usageRef.current,
      });
      notify(paused ? "蓝图生成已暂停，阶段结果已经保存" : error instanceof Error ? error.message : "全书蓝图生成失败");
    } finally {
      controllerRef.current = null;
      setBlueprintStage("");
      if (!writeAfter || stopRequested.current) setAiBusy(false);
    }
  };

  const generateSeeds = async (continueAutomatically = false) => {
    if (!ensureConfigured() || aiBusy) return;
    const currentSettings = workspace.automation;
    usageRef.current = currentSettings.usage;
    budgetRef.current = { maxRequests: currentSettings.maxRequests, maxTokens: currentSettings.maxTokens };
    setAiBusy(true);
    patchAutomation({ phase: "ideating", seeds: [], selectedSeedId: undefined, blueprintDraft: undefined, lastError: undefined });
    try {
      const prompt = buildSeedPrompt(currentSettings.brief, currentSettings);
      const seeds = await requestStructured(prompt, parseSeedOptions);
      patchAutomation({ phase: "choosing", seeds, usage: usageRef.current });
      if (continueAutomatically) {
        const chosen = seeds.find((item) => item.recommended) || seeds[0];
        const sourceWithSeeds: WorkspaceData = {
          ...workspace,
          automation: {
            ...currentSettings,
            phase: "choosing",
            seeds,
            selectedSeedId: chosen.id,
            usage: usageRef.current,
          },
        };
        setWorkspace(sourceWithSeeds);
        setAiBusy(false);
        await buildBlueprintFrom(sourceWithSeeds, chosen, true);
      } else {
        notify("已生成 3 个故事方向，请选择一个");
        setAiBusy(false);
      }
    } catch (error) {
      patchAutomation({
        phase: "error",
        lastError: error instanceof Error ? error.message : "故事方向生成失败",
        usage: usageRef.current,
      });
      notify(error instanceof Error ? error.message : "故事方向生成失败");
      setAiBusy(false);
    }
  };

  const buildBlueprintFrom = async (source: WorkspaceData, seed: StorySeed, writeAfter: boolean) => {
    if (!ensureConfigured()) return;
    usageRef.current = source.automation.usage;
    budgetRef.current = { maxRequests: source.automation.maxRequests, maxTokens: source.automation.maxTokens };
    setAiBusy(true);
    const planningWorkspace = preparePlanningWorkspace(source, seed);
    stopRequested.current = false;
    runTokenRef.current = planningWorkspace.automation.runId || nextRunId();
    setWorkspace(planningWorkspace);
    try {
      const { blueprint, draft } = await generateBlueprintStages(planningWorkspace, seed, planningWorkspace.automation);
      onBackup(source, "AI 全书创作前自动备份");
      const nextWorkspace: WorkspaceData = {
        ...blueprint,
        automation: createAutomationState({
          runId: planningWorkspace.automation.runId,
          phase: "ready",
          brief: source.automation.brief,
          seeds: source.automation.seeds,
          selectedSeedId: seed.id,
          targetChapters: source.automation.targetChapters,
          targetWords: source.automation.targetWords,
          chapterWords: source.automation.chapterWords,
          currentChapterNumber: 1,
          currentSegment: 0,
          generatedChapterIds: [],
          usage: usageRef.current,
          maxRequests: source.automation.maxRequests,
          maxTokens: source.automation.maxTokens,
          blueprintDraft: draft,
          updatedAt: new Date().toISOString(),
        }),
      };
      setWorkspace(nextWorkspace);
      await onDurableCheckpoint?.(nextWorkspace, {
        stepKey: `${nextWorkspace.automation.runId}:blueprint`,
        kind: "blueprint",
        status: "completed",
        outputExcerpt: nextWorkspace.project.premise,
      });
      notify(`《${nextWorkspace.project.title}》全书蓝图已生成`);
      if (writeAfter) await writeNovel(nextWorkspace);
    } catch (error) {
      const paused = stopRequested.current || (error instanceof DOMException && error.name === "AbortError");
      setWorkspace((current) => ({
        ...current,
        automation: {
          ...current.automation,
          phase: paused ? "paused" : "error",
          lastError: paused ? undefined : error instanceof Error ? error.message : "全书蓝图生成失败",
          usage: usageRef.current,
        },
      }));
      notify(paused ? "蓝图生成已暂停，阶段结果已经保存" : error instanceof Error ? error.message : "全书蓝图生成失败");
    } finally {
      controllerRef.current = null;
      setBlueprintStage("");
      if (!writeAfter || stopRequested.current) setAiBusy(false);
    }
  };

  const redoBlueprintStage = async (stage: 1 | 2 | 3 | 4 | 5) => {
    const draft = workspace.automation.blueprintDraft;
    const seed = draft ? workspace.automation.seeds.find((item) => item.id === draft.seedId) : undefined;
    if (!draft || !seed || aiBusy) return;
    const labels = ["人物与关系", "世界设定", "故事大纲", "伏笔回收", "逐章目录"];
    if (!window.confirm(`将从“${labels[stage - 1]}”开始重新生成，并清除依赖它的后续蓝图结果。现有作品会先自动备份，是否继续？`)) return;
    const source: WorkspaceData = {
      ...workspace,
      automation: {
        ...workspace.automation,
        phase: "paused",
        blueprintDraft: restartBlueprintDraft(draft, stage),
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      },
    };
    await buildBlueprintFrom(source, seed, false);
  };

  const rewindWritingFromChapter = async () => {
    const chapterNumber = writingEstimate.range.fromChapter;
    const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
    if (!chapter || aiBusy || backgroundBusy || backgroundActive) return;
    const affectedCount = workspace.chapters.filter((item) => item.number >= chapter.number).length;
    if (!window.confirm(`将清空第 ${chapter.number} 章及之后 ${affectedCount} 章的正文、章节记忆和审校结果。现有正文会自动存入版本历史和完整备份，是否继续？`)) return;

    const runId = nextRunId();
    const rewoundBase = rewindNovelFromChapter(workspace, chapter.number, runId);
    const rewound: WorkspaceData = {
      ...rewoundBase,
      automation: {
        ...rewoundBase.automation,
        writingRange: writingEstimate.range,
      },
    };
    onBackup(workspace, `从第 ${chapter.number} 章重写前自动备份`);
    usageRef.current = rewound.automation.usage;
    budgetRef.current = { maxRequests: rewound.automation.maxRequests, maxTokens: rewound.automation.maxTokens };
    setWorkspace(rewound);
    await onDurableCheckpoint?.(rewound, {
      stepKey: `${runId}:rewind:${chapter.number}`,
      kind: "run_rewind",
      chapterNumber: chapter.number,
      status: "completed",
      outputExcerpt: `已回退到第 ${chapter.number} 章，计划写作至第 ${writingEstimate.range.toChapter} 章`,
      contextHash: `canon:${rewound.canon.revision}`,
    });
    notify(`已安全回退到第 ${chapter.number} 章，可按当前范围重新写作`);
  };

  const updateWritingRange = (fromChapter: number, toChapter: number) => {
    patchAutomation({
      writingRange: {
        fromChapter: Math.min(fromChapter, toChapter),
        toChapter: Math.max(fromChapter, toChapter),
      },
    });
  };

  const pause = () => {
    stopRequested.current = true;
    runTokenRef.current = `paused-${Date.now()}`;
    controllerRef.current?.abort();
    patchAutomation({ phase: "paused" });
  };

  const resetWorkflow = () => {
    if (!window.confirm("只重置 AI 全书任务状态，不会删除当前作品正文。继续吗？")) return;
    stopRequested.current = true;
    controllerRef.current?.abort();
    setWorkspace((current) => ({
      ...current,
      automation: createAutomationState({
        targetChapters: current.automation.targetChapters,
        targetWords: current.automation.targetWords,
        chapterWords: current.automation.chapterWords,
        maxRequests: current.automation.maxRequests,
        maxTokens: current.automation.maxTokens,
      }),
    }));
    notify("已重置自动创作流程");
  };

  const startAutopilot = () => {
    if (!window.confirm(`将由 AI 自动选择方向、生成蓝图并连续写作约 ${automation.targetChapters} 章。应用蓝图前会自动备份当前作品；预计至少 ${estimatedCalls} 次模型调用。是否开始？`)) return;
    void generateSeeds(true);
  };

  const selectedSeed = automation.seeds.find((item) => item.id === automation.selectedSeedId);
  const resumableSeed = automation.blueprintDraft
    ? automation.seeds.find((item) => item.id === automation.blueprintDraft?.seedId)
    : undefined;
  const progress = workspace.chapters.length
    ? Math.round(generatedCount / workspace.chapters.length * 100)
    : 0;

  return (
    <div className="view auto-novel-view" aria-busy={isRunning}>
      <div className="view-heading">
        <div><span className="eyebrow">AI AUTOPILOT</span><h1>AI 全书创作</h1><p>即使没有灵感，也能从故事选择开始，自动完成蓝图和全书初稿。</p></div>
        <div className="heading-actions">
          {["writing", "planning"].includes(automation.phase) && aiBusy ? <button className="secondary-button" onClick={() => backgroundActive ? void onPauseBackground?.() : pause()}><Pause size={16} />暂停</button> : null}
          {resumableSeed && ["planning", "paused", "error"].includes(automation.phase) && automation.blueprintDraft && automation.blueprintDraft.completedStage < 5 ? <button className="primary-button" disabled={aiBusy} onClick={() => void buildBlueprintFrom(workspace, resumableSeed, false)}><RotateCcw size={16} />从第 {Math.min(5, automation.blueprintDraft!.completedStage + 1)} 步继续蓝图</button> : null}
          {["paused", "error", "ready"].includes(automation.phase) && workspace.chapters.length ? <><button className="secondary-button" disabled={aiBusy || backgroundBusy || writingEstimate.pendingChapters.length === 0 || writingEstimate.errors.length > 0} onClick={() => void writeNovel(scheduledWorkspace)}><Play size={16} />浏览器连续写作</button><button className="primary-button" disabled={backgroundBusy || !backgroundConfigured || writingEstimate.pendingChapters.length === 0 || writingEstimate.errors.length > 0} onClick={() => void onStartBackground?.(scheduledWorkspace)}><Cloud size={16} />{backgroundBusy ? "正在启动…" : "云端后台写作"}</button></> : null}
        </div>
      </div>

      <section className="auto-hero">
        <div className="auto-hero-copy">
          <span className="auto-kicker"><Sparkles size={15} />从一个空白开始</span>
          <h2>你负责选择，AI 负责把它写成一本书。</h2>
          <p>先生成 3 个完整故事方向，再自动建立人物、世界观、大纲和章节计划，最后按章分段写作。</p>
          <div className="auto-hero-actions">
            <button className="primary-button" disabled={aiBusy} onClick={() => void generateSeeds(false)}><Lightbulb size={17} />先给我故事选择</button>
            <button className="auto-magic-button" disabled={aiBusy} onClick={startAutopilot}><Zap size={17} />完全交给 AI</button>
          </div>
        </div>
        <div className="auto-orbit" aria-hidden="true"><span><BrainCircuit size={34} /></span><i /><i /><i /></div>
      </section>

      {!config.baseUrl || !config.model ? <section className="auto-config-alert"><AlertTriangle size={18} /><div><b>还没有连接浏览器 AI 模型</b><p>配置 HTTP/HTTPS 接口和模型名称后即可生成故事；API Key 可以留空。</p></div><button onClick={onNeedConfig}>立即连接<ChevronRight size={15} /></button></section> : null}

      <div className="auto-step-grid">
        <article className={automation.seeds.length ? "done" : automation.phase === "ideating" ? "active" : ""}><span>01</span><div><b>故事方向</b><small>无灵感也能生成 3 个选择</small></div>{automation.seeds.length ? <Check size={17} /> : <Lightbulb size={17} />}</article>
        <article className={workspace.chapters.length && automation.runId ? "done" : automation.phase === "planning" ? "active" : ""}><span>02</span><div><b>全书蓝图</b><small>{automation.phase === "planning" && blueprintStage ? blueprintStage : "人物 → 设定 → 大纲 → 伏笔 → 章节"}</small></div>{workspace.chapters.length && automation.runId ? <Check size={17} /> : automation.phase === "planning" ? <LoaderCircle className="spin" size={17} /> : <Route size={17} />}</article>
        <article className={automation.phase === "completed" ? "done" : automation.phase === "writing" ? "active" : ""}><span>03</span><div><b>连续写作</b><small>逐章分段，随时暂停续跑</small></div>{automation.phase === "completed" ? <Check size={17} /> : <PenLine size={17} />}</article>
        <article className={automation.phase === "completed" ? "done" : ""}><span>04</span><div><b>完稿交付</b><small>进入章节审阅并导出全书</small></div><BookOpenCheck size={17} /></article>
      </div>

      <section className="auto-settings-card card">
        <div className="auto-section-title"><div><span>创作偏好</span><h2>可以全部留空，让 AI 决定</h2></div><small><Cloud size={14} />自动保存</small></div>
        <label className="auto-brief"><span>我有一点想法（可选）</span><textarea value={automation.brief} disabled={isRunning} onChange={(event) => patchAutomation({ brief: event.target.value })} placeholder="例如：想写带民俗元素的悬疑；或者什么都不填，直接生成。" /></label>
        <div className="auto-number-grid">
          <label><span>章节数</span><input type="number" min="4" max="60" disabled={isRunning} value={automation.targetChapters} onChange={(event) => { const targetChapters = Math.min(60, Math.max(4, Number(event.target.value) || 4)); patchAutomation({ targetChapters, targetWords: targetChapters * automation.chapterWords }); }} /><small>4—60 章</small></label>
          <label><span>每章目标字数</span><input type="number" min="1200" max="12000" step="100" disabled={isRunning} value={automation.chapterWords} onChange={(event) => { const chapterWords = Math.min(12000, Math.max(1200, Number(event.target.value) || 1200)); patchAutomation({ chapterWords, targetWords: automation.targetChapters * chapterWords }); }} /><small>按约 2,200 字分段生成</small></label>
          <label><span>全书目标字数</span><input type="number" readOnly value={automation.targetChapters * automation.chapterWords} /><small>预计至少 {estimatedCalls} 次模型调用</small></label>
          <label><span>最大模型调用</span><input type="number" min="10" max="1000" disabled={isRunning} value={automation.maxRequests} onChange={(event) => patchAutomation({ maxRequests: Math.min(1000, Math.max(10, Number(event.target.value) || 10)) })} /><small>达到上限自动暂停</small></label>
          <label><span>最大 Token 预算</span><input type="number" min="10000" max="100000000" step="10000" disabled={isRunning} value={automation.maxTokens} onChange={(event) => patchAutomation({ maxTokens: Math.min(100000000, Math.max(10000, Number(event.target.value) || 10000)) })} /><small>当前已用 {automation.usage.totalTokens.toLocaleString("zh-CN")}</small></label>
        </div>
      </section>

      {automation.seeds.length > 0 && <section className="auto-seed-section">
        <div className="auto-section-title"><div><span>AI 故事提案</span><h2>选择最想读下去的一本</h2></div><button className="secondary-button compact" disabled={aiBusy} onClick={() => void generateSeeds(false)}><RotateCcw size={14} />换一批</button></div>
        <div className="auto-seed-grid" role="radiogroup" aria-label="故事方向">
          {automation.seeds.map((seed) => <article key={seed.id} className={automation.selectedSeedId === seed.id ? "selected" : ""}>
            <button className="seed-select" role="radio" aria-checked={automation.selectedSeedId === seed.id} onClick={() => patchAutomation({ selectedSeedId: seed.id, phase: "choosing" })}>
              <div>{seed.recommended && <em><Sparkles size={12} />AI 推荐</em>}<span>{seed.genre}</span></div>
              <h3>《{seed.title}》</h3>
              <strong>{seed.hook}</strong>
              <p>{seed.premise}</p>
              <dl><div><dt>主角</dt><dd>{seed.protagonist}</dd></div><div><dt>核心冲突</dt><dd>{seed.centralConflict}</dd></div><div><dt>结局气质</dt><dd>{seed.endingTone}</dd></div></dl>
              <footer><span>{seed.reason}</span><i>{automation.selectedSeedId === seed.id ? <Check size={16} /> : <ChevronRight size={16} />}</i></footer>
            </button>
          </article>)}
        </div>
        <div className="auto-seed-actions"><span>应用蓝图前会自动备份当前作品。</span><button className="primary-button" disabled={!selectedSeed || aiBusy} onClick={() => selectedSeed && void buildBlueprint(selectedSeed)}><WandSparkles size={16} />采用此方向并生成全书蓝图</button><button className="secondary-button" disabled={aiBusy} onClick={() => { const chosen = automation.seeds.find((item) => item.recommended) || automation.seeds[0]; patchAutomation({ selectedSeedId: chosen.id }); void buildBlueprint(chosen); }}><BrainCircuit size={16} />AI 替我选择</button></div>
      </section>}

      {automation.blueprintDraft?.completedStage === 5 && selectedSeed && <section className="auto-settings-card card">
        <div className="auto-section-title"><div><span>蓝图维护</span><h2>单独重做一个阶段</h2></div><small>重做上游阶段会自动刷新依赖它的后续阶段</small></div>
        <div className="heading-actions">
          {(["人物与关系", "世界设定", "故事大纲", "伏笔回收", "逐章目录"] as const).map((label, index) => <button key={label} className="secondary-button compact" disabled={aiBusy || automation.phase === "writing"} onClick={() => void redoBlueprintStage((index + 1) as 1 | 2 | 3 | 4 | 5)}><RotateCcw size={14} />重做{label}</button>)}
        </div>
      </section>}

      {workspace.chapters.length > 0 && <section className="auto-settings-card auto-scheduler-card card">
        <div className="auto-section-title"><div><span>写作调度中心</span><h2>按章节范围控制 AI 写作</h2></div><small>浏览器与云端后台共用同一计划</small></div>
        <div className="auto-scheduler-grid">
          <label><span>从第几章开始</span><select disabled={isRunning || backgroundActive} value={writingEstimate.range.fromChapter} onChange={(event) => updateWritingRange(Number(event.target.value), Math.max(Number(event.target.value), writingEstimate.range.toChapter))}>{[...workspace.chapters].sort((a, b) => a.number - b.number).map((item) => <option key={item.id} value={item.number}>第 {item.number} 章 · {item.title}</option>)}</select></label>
          <label><span>写到第几章</span><select disabled={isRunning || backgroundActive} value={writingEstimate.range.toChapter} onChange={(event) => updateWritingRange(Math.min(writingEstimate.range.fromChapter, Number(event.target.value)), Number(event.target.value))}>{[...workspace.chapters].sort((a, b) => a.number - b.number).map((item) => <option key={item.id} value={item.number}>第 {item.number} 章 · {item.title}</option>)}</select></label>
          <div className="auto-scheduler-stat"><span><FileText size={15} />待生成章节</span><b>{writingEstimate.pendingChapters.length}</b><small>共 {writingEstimate.chapters.length} 章在范围内</small></div>
          <div className="auto-scheduler-stat"><span><PenLine size={15} />剩余正文分段</span><b>{writingEstimate.remainingSegments}</b><small>按每段约 2,200 字估算</small></div>
          <div className="auto-scheduler-stat"><span><Zap size={15} />最低模型调用</span><b>{writingEstimate.minimumRequests}</b><small>当前还有 {writingEstimate.remainingRequestBudget} 次预算</small></div>
        </div>
        <div className={`auto-scheduler-health ${writingEstimate.errors.length ? "has-error" : "is-ready"}`}>
          {writingEstimate.errors.length ? <><AlertTriangle size={17} /><div><b>当前计划需要调整</b>{writingEstimate.errors.map((error) => <p key={error}>{error}</p>)}</div></> : <><Check size={17} /><div><b>写作计划已就绪</b><p>任务将在第 {writingEstimate.range.toChapter} 章完成审校后自动停靠，不会继续生成范围外章节。</p></div></>}
        </div>
        <div className="auto-scheduler-actions">
          <span>“安全回退”会清理起点之后的旧正文和未来事实，适合大幅改写。</span>
          <button className="secondary-button" disabled={isRunning || aiBusy || backgroundBusy || backgroundActive} onClick={() => void rewindWritingFromChapter()}><RotateCcw size={16} />从起点安全回退</button>
          <button className="secondary-button" disabled={isRunning || aiBusy || backgroundBusy || writingEstimate.errors.length > 0} onClick={() => void writeNovel(scheduledWorkspace)}><Play size={16} />浏览器生成范围</button>
          <button className="primary-button" disabled={isRunning || backgroundBusy || !backgroundConfigured || writingEstimate.errors.length > 0} onClick={() => void onStartBackground?.(scheduledWorkspace)}><Cloud size={16} />云端生成范围</button>
        </div>
      </section>}

      {automation.runId && workspace.chapters.length > 0 && <section className="auto-progress-card card">
        <div className="auto-progress-head"><div><span className={`auto-status status-${automation.phase}`}><i />{phaseLabel(automation.phase)}</span><h2>《{workspace.project.title}》</h2><p>{workspace.project.premise}</p></div><div className="auto-progress-ring" style={{ "--auto-progress": `${progress * 3.6}deg` } as React.CSSProperties}><span><b>{progress}%</b><small>{generatedCount}/{workspace.chapters.length} 章</small></span></div></div>
        <div className="auto-track"><i style={{ width: `${progress}%` }} /></div>
        <div className="auto-progress-meta"><span><Gauge size={15} />{automation.phase === "completed" ? "全书生成完成" : `当前：第 ${Math.min(automation.currentChapterNumber || 1, workspace.chapters.length)} 章 · 第 ${automation.currentSegment + 1} 段`}</span><span><FileText size={15} />已生成 {workspace.chapters.reduce((sum, item) => sum + countCharacters(item.content), 0).toLocaleString("zh-CN")} 字</span><span><BrainCircuit size={15} />{backgroundActive ? `${backgroundModel || "OpenAI"} · 云端后台` : config.model || "尚未配置模型"}</span><span><Zap size={15} />{automation.usage.requestCount}/{automation.maxRequests} 次 · {automation.usage.totalTokens.toLocaleString("zh-CN")} Token</span></div>
        {automation.lastError && <div className="auto-error"><AlertTriangle size={16} /><span><b>任务已停在当前检查点</b>{automation.lastError}</span></div>}
        <div className="auto-queue">
          {[...workspace.chapters].sort((a, b) => a.number - b.number).map((item) => {
            const done = automation.generatedChapterIds.includes(item.id);
            const current = automation.currentChapterNumber === item.number && automation.phase !== "completed";
            return <button key={item.id} className={current ? "current" : done ? "done" : ""} onClick={() => onOpenChapter(item.id)}><span>{done ? <Check size={14} /> : current ? <LoaderCircle className={automation.phase === "writing" ? "spin" : ""} size={14} /> : item.number}</span><div><b>第 {item.number} 章 · {item.title}</b><small>{done ? `${countCharacters(item.content).toLocaleString("zh-CN")} 字 · 已完成` : current ? "当前生成位置" : "等待生成"}</small></div><ChevronRight size={15} /></button>;
          })}
        </div>
        <footer className="auto-control-bar">
          <span>{backgroundActive ? <Cloud size={14} /> : durableProjectId ? <Cloud size={14} /> : <AlertTriangle size={14} />}{backgroundActive ? "后台工作器正在接力生成，关闭网页后任务仍会继续。" : durableProjectId ? backgroundConfigured ? "云端检查点已开启；保持后台工作器运行即可关闭网页。" : "云端检查点已开启；第三方后台模型密钥尚待配置。" : "首次运行会创建云端检查点；浏览器模式需保持页面打开。"}</span>
          <div>{automation.phase === "writing" ? <button className="secondary-button" disabled={backgroundBusy} onClick={() => backgroundActive ? void onPauseBackground?.() : pause()}><CircleStop size={16} />暂停并保存</button> : automation.phase !== "completed" ? <><button className="secondary-button" disabled={aiBusy || backgroundBusy || writingEstimate.pendingChapters.length === 0 || writingEstimate.errors.length > 0} onClick={() => void writeNovel(scheduledWorkspace)}><Play size={16} />浏览器续写</button><button className="primary-button" disabled={backgroundBusy || !backgroundConfigured || writingEstimate.pendingChapters.length === 0 || writingEstimate.errors.length > 0} onClick={() => void onStartBackground?.(scheduledWorkspace)}><Cloud size={16} />云端后台续写</button></> : <button className="primary-button" onClick={() => onOpenChapter(workspace.chapters[0].id)}><BookOpenCheck size={16} />审阅全书</button>}<button className="secondary-button" disabled={isRunning} onClick={resetWorkflow}><RotateCcw size={15} />重置流程</button></div>
        </footer>
      </section>}
    </div>
  );
}
