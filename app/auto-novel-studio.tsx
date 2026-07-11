"use client";

import {
  useRef,
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
  buildBlueprintPrompt,
  buildChapterMemoryPrompt,
  buildRollingAuditPrompt,
  buildSeedPrompt,
  applyChapterMemory,
  createAutomationState,
  parseChapterMemory,
  parseNovelBlueprint,
  parseRollingAudit,
  parseSeedOptions,
} from "@/lib/auto-novel";
import type {
  AIConfig,
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
  const automation = workspace.automation;
  const isRunning = activePhases.includes(automation.phase);
  const generatedCount = workspace.chapters.filter((item) => automation.generatedChapterIds.includes(item.id)).length;
  const estimatedSegments = Math.max(1, Math.ceil(automation.chapterWords / 2200));
  const estimatedCalls = 2 + automation.targetChapters * (estimatedSegments + 1) + Math.ceil(automation.targetChapters / 5);

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
    if (usageRef.current.requestCount >= budgetRef.current.maxRequests) {
      throw new Error(`已达到 ${budgetRef.current.maxRequests} 次模型调用上限`);
    }
    if (usageRef.current.totalTokens >= budgetRef.current.maxTokens) {
      throw new Error(`已达到 ${budgetRef.current.maxTokens.toLocaleString("zh-CN")} Token 预算上限`);
    }
    let lastError = "AI 请求失败";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...config,
            prompt,
            maxOutputTokens: prompt.includes("完整全书蓝图") ? 32_768 : 16_384,
          }),
          signal,
        });
        const payload = await response.json().catch(() => ({})) as {
          text?: string;
          error?: string;
          usage?: Record<string, unknown>;
        };
        if (response.ok && payload.text?.trim()) {
          const usage = payload.usage || {};
          const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
          const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
          const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens;
          usageRef.current = {
            requestCount: usageRef.current.requestCount + 1,
            inputTokens: usageRef.current.inputTokens + inputTokens,
            outputTokens: usageRef.current.outputTokens + outputTokens,
            totalTokens: usageRef.current.totalTokens + totalTokens,
          };
          return payload.text.trim();
        }
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

  const writeNovel = async (source: WorkspaceData) => {
    if (!ensureConfigured()) return;
    usageRef.current = source.automation.usage;
    budgetRef.current = { maxRequests: source.automation.maxRequests, maxTokens: source.automation.maxTokens };
    const runId = source.automation.runId || nextRunId();
    runTokenRef.current = runId;
    stopRequested.current = false;
    let working: WorkspaceData = {
      ...source,
      project: { ...source.project, status: "AI 创作中" },
      chapters: source.chapters.map((chapter) => source.automation.generatedChapterIds.includes(chapter.id) ? chapter : {
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
      const ordered = [...working.chapters].sort((a, b) => a.number - b.number);
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

        const shouldAudit = item.number % 5 === 0 || item.number === ordered[ordered.length - 1]?.number;
        if (shouldAudit) {
          controllerRef.current = new AbortController();
          const auditIssues = await requestStructured(
            buildRollingAuditPrompt(working, item.number),
            (value) => parseRollingAudit(value, runId),
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

      working = {
        ...working,
        project: { ...working.project, status: "初稿完成" },
        outline: working.outline.map((item) => ({ ...item, status: "已完成" })),
        automation: {
          ...working.automation,
          phase: "completed",
          currentChapterNumber: working.chapters.length,
          currentSegment: 0,
          lastError: undefined,
          usage: usageRef.current,
          updatedAt: new Date().toISOString(),
        },
      };
      setWorkspace(working);
      await onDurableCheckpoint?.(working, {
        stepKey: `${runId}:completed`,
        kind: "run_completed",
        status: "completed",
      });
      notify("全书初稿已经完成，可以进入章节审阅与导出");
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

  const buildBlueprint = async (seed: StorySeed, writeAfter = false) => {
    if (!ensureConfigured()) return;
    const currentSettings = workspace.automation;
    usageRef.current = currentSettings.usage;
    budgetRef.current = { maxRequests: currentSettings.maxRequests, maxTokens: currentSettings.maxTokens };
    setAiBusy(true);
    patchAutomation({ phase: "planning", selectedSeedId: seed.id, lastError: undefined });
    try {
      const prompt = buildBlueprintPrompt(seed, currentSettings);
      const blueprint = await requestStructured(prompt, (value) => parseNovelBlueprint(value, seed, currentSettings));
      onBackup(workspace, "AI 全书创作前自动备份");
      const nextWorkspace: WorkspaceData = {
        ...blueprint,
        automation: createAutomationState({
          runId: nextRunId(),
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
          usage: usageRef.current,
          maxRequests: currentSettings.maxRequests,
          maxTokens: currentSettings.maxTokens,
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
      patchAutomation({
        phase: "error",
        lastError: error instanceof Error ? error.message : "全书蓝图生成失败",
        usage: usageRef.current,
      });
      notify(error instanceof Error ? error.message : "全书蓝图生成失败");
    } finally {
      if (!writeAfter) setAiBusy(false);
    }
  };

  const generateSeeds = async (continueAutomatically = false) => {
    if (!ensureConfigured() || aiBusy) return;
    const currentSettings = workspace.automation;
    usageRef.current = currentSettings.usage;
    budgetRef.current = { maxRequests: currentSettings.maxRequests, maxTokens: currentSettings.maxTokens };
    setAiBusy(true);
    patchAutomation({ phase: "ideating", seeds: [], selectedSeedId: undefined, lastError: undefined });
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
    setWorkspace({
      ...source,
      automation: { ...source.automation, phase: "planning", selectedSeedId: seed.id, lastError: undefined },
    });
    try {
      const prompt = buildBlueprintPrompt(seed, source.automation);
      const blueprint = await requestStructured(prompt, (value) => parseNovelBlueprint(value, seed, source.automation));
      onBackup(source, "AI 全书创作前自动备份");
      const nextWorkspace: WorkspaceData = {
        ...blueprint,
        automation: createAutomationState({
          runId: nextRunId(),
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
      setWorkspace((current) => ({
        ...current,
        automation: {
          ...current.automation,
          phase: "error",
          lastError: error instanceof Error ? error.message : "全书蓝图生成失败",
          usage: usageRef.current,
        },
      }));
      notify(error instanceof Error ? error.message : "全书蓝图生成失败");
      setAiBusy(false);
    } finally {
      if (!writeAfter) setAiBusy(false);
    }
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
  const progress = workspace.chapters.length
    ? Math.round(generatedCount / workspace.chapters.length * 100)
    : 0;

  return (
    <div className="view auto-novel-view" aria-busy={isRunning}>
      <div className="view-heading">
        <div><span className="eyebrow">AI AUTOPILOT</span><h1>AI 全书创作</h1><p>即使没有灵感，也能从故事选择开始，自动完成蓝图和全书初稿。</p></div>
        <div className="heading-actions">
          {automation.phase === "writing" ? <button className="secondary-button" onClick={() => backgroundActive ? void onPauseBackground?.() : pause()}><Pause size={16} />暂停</button> : null}
          {["paused", "error", "ready"].includes(automation.phase) && workspace.chapters.length ? <><button className="secondary-button" disabled={aiBusy || backgroundBusy} onClick={() => void writeNovel(workspace)}><Play size={16} />浏览器连续写作</button><button className="primary-button" disabled={backgroundBusy || !backgroundConfigured} onClick={() => void onStartBackground?.(workspace)}><Cloud size={16} />{backgroundBusy ? "正在启动…" : "云端后台写作"}</button></> : null}
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
        <article className={workspace.chapters.length && automation.runId ? "done" : automation.phase === "planning" ? "active" : ""}><span>02</span><div><b>全书蓝图</b><small>人物、设定、大纲、伏笔、章节</small></div>{workspace.chapters.length && automation.runId ? <Check size={17} /> : <Route size={17} />}</article>
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
          <div>{automation.phase === "writing" ? <button className="secondary-button" disabled={backgroundBusy} onClick={() => backgroundActive ? void onPauseBackground?.() : pause()}><CircleStop size={16} />暂停并保存</button> : automation.phase !== "completed" ? <><button className="secondary-button" disabled={aiBusy || backgroundBusy} onClick={() => void writeNovel(workspace)}><Play size={16} />浏览器续写</button><button className="primary-button" disabled={backgroundBusy || !backgroundConfigured} onClick={() => void onStartBackground?.(workspace)}><Cloud size={16} />云端后台续写</button></> : <button className="primary-button" onClick={() => onOpenChapter(workspace.chapters[0].id)}><BookOpenCheck size={16} />审阅全书</button>}<button className="secondary-button" disabled={isRunning} onClick={resetWorkflow}><RotateCcw size={15} />重置流程</button></div>
        </footer>
      </section>}
    </div>
  );
}
