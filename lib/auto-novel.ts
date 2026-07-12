import type {
  BlueprintDraft,
  CanonLedger,
  Chapter,
  ChapterMemory,
  Character,
  ConsistencyIssue,
  Material,
  NovelAutomation,
  OutlineBeat,
  ProjectInfo,
  Relationship,
  StorySeed,
  WorkspaceData,
  WritingRange,
  WorldEntry,
} from "./types";
import { sceneCardLabel } from "./story-control";
import { compileContextManifest, contextPayloadFromManifest } from "./narrative-intelligence";

export const MAX_AUTOMATED_REPAIR_ATTEMPTS = 3;

const CHARACTER_COLORS = [
  "#4f46e5",
  "#0891b2",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0f766e",
  "#475569",
  "#a21caf",
];

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function safeId(prefix: string, index: number) {
  return `${prefix}-${Date.now()}-${index + 1}`;
}

export function restartBlueprintDraft(
  draft: BlueprintDraft,
  stage: 1 | 2 | 3 | 4 | 5,
): BlueprintDraft {
  const completedStage = (stage - 1) as BlueprintDraft["completedStage"];
  return {
    seedId: draft.seedId,
    completedStage,
    ...(completedStage >= 1 && draft.foundation ? { foundation: draft.foundation } : {}),
    ...(completedStage >= 2 && draft.world ? { world: draft.world } : {}),
    ...(completedStage >= 3 && draft.outline ? { outline: draft.outline } : {}),
    ...(completedStage >= 4 && draft.foreshadows ? { foreshadows: draft.foreshadows } : {}),
  };
}

export type WritingRangeEstimate = {
  range: WritingRange;
  chapters: Chapter[];
  pendingChapters: Chapter[];
  remainingSegments: number;
  minimumRequests: number;
  remainingRequestBudget: number;
  missingPredecessorNumbers: number[];
  errors: string[];
};

function resolveWritingRange(workspace: WorkspaceData): WritingRange {
  const ordered = [...workspace.chapters].sort((a, b) => a.number - b.number);
  const first = ordered[0]?.number || 1;
  const last = ordered.at(-1)?.number || first;
  const requestedFrom = workspace.automation.writingRange?.fromChapter ?? first;
  const requestedTo = workspace.automation.writingRange?.toChapter ?? last;
  const fromChapter = Math.min(last, Math.max(first, Math.round(requestedFrom)));
  const toChapter = Math.min(last, Math.max(first, Math.round(requestedTo)));
  return {
    fromChapter: Math.min(fromChapter, toChapter),
    toChapter: Math.max(fromChapter, toChapter),
  };
}

export function recoverOutlineEvidenceValidationBlock(workspace: WorkspaceData): WorkspaceData {
  const message = workspace.automation.lastError || "";
  if (!/\u7ae0\u7eb2\u8bc1\u636e|\u53ef\u6838\u5bf9\u7684\u7ae0\u7eb2\u8bc1\u636e/.test(message)) return workspace;
  const chapterNumber = workspace.automation.currentChapterNumber;
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter?.content.trim()) return workspace;
  const cleaned = removeChapterFromCanon(workspace, chapterNumber);
  return {
    ...cleaned,
    project: { ...cleaned.project, status: "\u521b\u4f5c\u4e2d" },
    chapters: cleaned.chapters.map((item) => item.id === chapter.id ? {
      ...item,
      memory: undefined,
      status: "\u4fee\u8ba2\u4e2d",
      generation: {
        runId: cleaned.automation.runId || item.generation?.runId || `recovery-${Date.now()}`,
        status: "generating",
        completedSegments: 1,
        baseRevision: item.generation?.baseRevision ?? item.revision ?? 0,
        repairAttempts: 0,
        draftAttempts: item.generation?.draftAttempts || 0,
      },
    } : item),
    automation: {
      ...cleaned.automation,
      phase: "paused",
      currentChapterNumber: chapterNumber,
      currentSegment: 1,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function cancelAutomationRun(workspace: WorkspaceData, now = new Date().toISOString()): WorkspaceData {
  return {
    ...workspace,
    project: { ...workspace.project, status: "\u5df2\u53d6\u6d88\u540e\u53f0\u4efb\u52a1" },
    automation: {
      ...workspace.automation,
      runId: "",
      phase: "paused",
      currentSegment: 0,
      lastError: undefined,
      taskLog: (workspace.automation.taskLog || []).map((task) =>
        ["queued", "running"].includes(task.status)
          ? { ...task, status: "cancelled" as const, finishedAt: now, error: undefined }
          : task),
      updatedAt: now,
    },
  };
}

export function estimateWritingRange(workspace: WorkspaceData): WritingRangeEstimate {
  const range = resolveWritingRange(workspace);
  const ordered = [...workspace.chapters].sort((a, b) => a.number - b.number);
  const chapters = ordered.filter((chapter) => chapter.number >= range.fromChapter && chapter.number <= range.toChapter);
  const pendingChapters = chapters.filter((chapter) => !workspace.automation.generatedChapterIds.includes(chapter.id));
  const candidateCount = workspace.automation.candidateCount || 1;
  const remainingSegments = pendingChapters.reduce((total, chapter) => {
    const contentComplete = Boolean(chapter.content.trim()) && !validateGeneratedChapterDraft(chapter, chapter.content).length;
    const validStoredCandidateCount = chapter.candidates?.filter((candidate) => !validateGeneratedChapterDraft(chapter, candidate.content).length).length || 0;
    const existingCandidateCount = validStoredCandidateCount || (contentComplete ? 1 : 0);
    return total + Math.max(0, candidateCount - existingCandidateCount);
  }, 0);
  const workflowRequests = pendingChapters.reduce((total, chapter) => {
    const contentComplete = Boolean(chapter.content.trim()) && !validateGeneratedChapterDraft(chapter, chapter.content).length;
    const validStoredCandidateCount = chapter.candidates?.filter((candidate) => !validateGeneratedChapterDraft(chapter, candidate.content).length).length || 0;
    const existingCandidateCount = validStoredCandidateCount || (contentComplete ? 1 : 0);
    const draftComplete = contentComplete && existingCandidateCount >= candidateCount;
    if (!draftComplete) return total + 2;
    if (!chapter.memory) return total + 2;
    const blocking = unresolvedChapterErrors(workspace, chapter.number).length > 0;
    if (chapter.generation?.status === "audited" && blocking) {
      return total + Math.max(0, MAX_AUTOMATED_REPAIR_ATTEMPTS - (chapter.generation.repairAttempts || 0)) * 3;
    }
    return total + 1;
  }, 0);
  const reachesWholeBookEnd = range.toChapter === (ordered.at(-1)?.number || range.toChapter)
    && ordered.filter((chapter) => chapter.number < range.fromChapter).every((chapter) => chapter.content.trim());
  const finalReviewRequests = reachesWholeBookEnd && workspace.automation.finalReview?.status !== "passed" ? 1 : 0;
  const minimumRequests = remainingSegments + workflowRequests + finalReviewRequests;
  const missingPredecessorNumbers = ordered
    .filter((chapter) => chapter.number < range.fromChapter && !chapter.content.trim())
    .map((chapter) => chapter.number);
  const remainingRequestBudget = Math.max(0, workspace.automation.maxRequests - workspace.automation.usage.requestCount);
  const errors: string[] = [];
  if (!chapters.length) errors.push("所选写作范围没有可用章节");
  const blockedChapters = chapters.filter((chapter) => chapter.generation?.status === "blocked").map((chapter) => chapter.number);
  if (blockedChapters.length) errors.push(`第 ${blockedChapters.join("、")} 章自动修复后仍未通过验收，请先人工处理错误再继续`);
  if (missingPredecessorNumbers.length) {
    errors.push(`第 ${missingPredecessorNumbers.join("、")} 章尚无正文，不能跳过前文直接生成后续章节`);
  }
  if (minimumRequests > remainingRequestBudget) {
    errors.push(`所选范围至少需要 ${minimumRequests} 次模型调用，当前仅剩 ${remainingRequestBudget} 次预算`);
  }
  return {
    range,
    chapters,
    pendingChapters,
    remainingSegments,
    minimumRequests,
    remainingRequestBudget,
    missingPredecessorNumbers,
    errors,
  };
}

export function rewindNovelFromChapter(
  workspace: WorkspaceData,
  chapterNumber: number,
  runId: string,
  now = new Date().toISOString(),
): WorkspaceData {
  const target = workspace.chapters.find((chapter) => chapter.number === chapterNumber);
  if (!target) throw new Error(`没有找到第 ${chapterNumber} 章`);
  if (!runId.trim()) throw new Error("重新写作需要新的运行编号");

  const affected = workspace.chapters.filter((chapter) => chapter.number >= chapterNumber);
  const affectedIds = new Set(affected.map((chapter) => chapter.id));
  const previousRunId = workspace.automation.runId;
  const snapshots = affected.flatMap((chapter) => chapter.content.trim() ? [{
    id: `version-${runId}-${chapter.id}`,
    chapterId: chapter.id,
    title: chapter.title,
    content: chapter.content,
    createdAt: now,
    note: `从第 ${chapterNumber} 章重写前自动存档`,
  }] : []);

  return {
    ...workspace,
    project: { ...workspace.project, status: "创作中" },
    chapters: workspace.chapters.map((chapter) => chapter.number >= chapterNumber ? {
      ...chapter,
      content: "",
      status: "待生成",
      updatedAt: now,
      revision: (chapter.revision || 0) + 1,
      memory: undefined,
      quality: undefined,
      repairReview: undefined,
      contextManifest: undefined,
      candidates: undefined,
      generation: undefined,
    } : chapter),
    issues: workspace.issues.filter((issue) =>
      (!issue.chapterNumber || issue.chapterNumber < chapterNumber)
        && (!previousRunId || !issue.id.startsWith(`audit-${previousRunId}-`))
    ),
    versions: [...snapshots, ...workspace.versions],
    canon: { ...canonBeforeChapter(workspace, chapterNumber), revision: workspace.canon.revision + 1 },
    automation: {
      ...workspace.automation,
      runId,
      phase: "paused",
      currentChapterNumber: chapterNumber,
      currentSegment: 0,
      generatedChapterIds: workspace.automation.generatedChapterIds.filter((id) => !affectedIds.has(id)),
      writingRange: {
        fromChapter: chapterNumber,
        toChapter: Math.max(chapterNumber, ...workspace.chapters.map((chapter) => chapter.number)),
      },
      lastError: undefined,
      updatedAt: now,
    },
  };
}

export function reserveModelRequest(
  usage: NovelAutomation["usage"],
  limits: Pick<NovelAutomation, "maxRequests" | "maxTokens">,
): NovelAutomation["usage"] {
  if (usage.requestCount >= limits.maxRequests) {
    throw new Error(`已达到 ${limits.maxRequests} 次模型调用上限`);
  }
  if (usage.totalTokens >= limits.maxTokens) {
    throw new Error(`已达到 ${limits.maxTokens.toLocaleString("zh-CN")} Token 预算上限`);
  }
  return { ...usage, requestCount: usage.requestCount + 1 };
}

export function detectAIStage(prompt: string) {
  if (/故事方向|三个方向|3 个.*方向/.test(prompt)) return "ideation" as const;
  if (/第 [1-5]\/5 步|全书蓝图|人物与关系|世界设定|故事大纲|逐章目录/.test(prompt)) return "blueprint" as const;
  if (/连续性记录员|事实记忆/.test(prompt)) return "memory" as const;
  if (/一致性审校|逐章一致性/.test(prompt)) return "audit" as const;
  if (/修订编辑|revisedContent|待修复问题/.test(prompt)) return "repair" as const;
  return "chapter" as const;
}

export function createAutomationState(
  patch: Partial<NovelAutomation> = {},
): NovelAutomation {
  return {
    phase: "idle",
    brief: "",
    seeds: [],
    targetChapters: 16,
    targetWords: 80000,
    chapterWords: 5000,
    currentChapterNumber: 0,
    currentSegment: 0,
    generatedChapterIds: [],
    usage: {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    maxRequests: 250,
    maxTokens: 5_000_000,
    candidateCount: 1,
    ...patch,
  };
}

function parseJson(textValue: string): JsonRecord {
  const withoutFence = textValue
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let jsonText = "";
  for (let index = 0; index < withoutFence.length; index += 1) {
    const char = withoutFence[index];
    if (start < 0) {
      if (char !== "{") continue;
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        jsonText = withoutFence.slice(start, index + 1);
        break;
      }
    }
  }
  if (!jsonText) throw new Error("AI 没有返回可识别的完整 JSON，请重试");
  try {
    return record(JSON.parse(jsonText));
  } catch {
    throw new Error("AI 返回的结构不完整，请重试生成");
  }
}

export function buildSeedPrompt(
  brief: string,
  settings: Pick<NovelAutomation, "targetChapters" | "targetWords" | "chapterWords">,
) {
  return `你是专业中文小说策划编辑。作者可以完全没有灵感，请为其提出 3 个差异明显、能够写成长篇并有明确结局的原创故事方向。

作者想法：${brief.trim() || "没有预设，请你自由发挥并优先选择高概念、强冲突、适合连续阅读的方向。"}
计划规模：约 ${settings.targetChapters} 章、${settings.targetWords} 字，每章约 ${settings.chapterWords} 字。

只输出合法 JSON，不要 Markdown，不要解释。结构必须严格如下：
{
  "options": [
    {
      "title": "暂定书名",
      "genre": "题材与类型",
      "hook": "一句有吸引力的钩子",
      "premise": "完整故事前提",
      "theme": "主题表达",
      "protagonist": "主角身份与欲望",
      "centralConflict": "核心冲突与代价",
      "endingTone": "结局方向与情绪",
      "reason": "为什么值得写",
      "recommended": true
    }
  ]
}

要求：恰好 3 个 options；只能有 1 个 recommended=true；三者在题材、主角、冲突机制和结局体验上都要明显不同；不要模仿现有作品或使用知名 IP。`;
}

export function parseSeedOptions(value: string): StorySeed[] {
  const payload = parseJson(value);
  const rawOptions = list(payload.options).slice(0, 3);
  if (rawOptions.length !== 3) {
    throw new Error("AI 没有生成完整的 3 个故事方向，请重试");
  }

  const options = rawOptions.map((item, index) => {
    const source = record(item);
    const title = text(source.title);
    const premise = text(source.premise);
    if (!title || !premise) {
      throw new Error("故事方向缺少书名或故事前提，请重试");
    }
    return {
      id: safeId("seed", index),
      title,
      genre: text(source.genre, "类型待定"),
      hook: text(source.hook, premise),
      premise,
      theme: text(source.theme, "在选择中看见人性"),
      protagonist: text(source.protagonist, "一位被迫改变的人"),
      centralConflict: text(source.centralConflict, premise),
      endingTone: text(source.endingTone, "完整收束并保留余韵"),
      reason: text(source.reason, "具备持续升级的冲突与清晰结局"),
      recommended: source.recommended === true,
    } satisfies StorySeed;
  });

  if (options.filter((item) => item.recommended).length !== 1) {
    options.forEach((item, index) => { item.recommended = index === 0; });
  }
  return options;
}

export type BlueprintStagePayload = Record<string, unknown>;
type BlueprintStageName = "characters" | "world" | "outline" | "foreshadows" | "chapters";

type BlueprintStageOptions = {
  arrays?: string[];
  project?: boolean;
  allowEmpty?: string[];
  stage?: BlueprintStageName;
  targetChapters?: number;
  outlineStage?: BlueprintStagePayload;
  foreshadowStage?: BlueprintStagePayload;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredStageText(item: JsonRecord, key: string, label: string) {
  if (!text(item[key])) throw new Error(`${label}缺少 ${key}`);
}

function stageObjects(payload: JsonRecord, key: string, min: number, max: number) {
  const items = list(payload[key]);
  if (items.length < min || items.length > max) {
    throw new Error(`${key} 数量必须为 ${min}—${max} 条，当前为 ${items.length} 条`);
  }
  if (items.some((item) => !isJsonRecord(item))) {
    throw new Error(`${key} 中包含非对象数据`);
  }
  return items as JsonRecord[];
}

function validateCharacterStage(payload: JsonRecord) {
  const project = record(payload.project);
  for (const key of ["title", "genre", "premise", "theme", "writingStyle", "pointOfView"]) {
    requiredStageText(project, key, "作品核心信息");
  }
  const contract = record(project.bookContract);
  if (Object.keys(contract).length) {
    for (const key of ["readingPromise", "protagonistFantasy", "coreSellingPoint", "escalationLadder", "relationshipMainline"]) {
      requiredStageText(contract, key, "整书契约");
    }
    if (!list(contract.absoluteRedLines).some((item) => text(item))) throw new Error("整书契约缺少 absoluteRedLines");
  }
  const characters = stageObjects(payload, "characters", 5, 8);
  const names = new Set<string>();
  for (const [index, character] of characters.entries()) {
    const label = `第 ${index + 1} 个人物`;
    for (const key of ["name", "role", "age", "identity", "goal", "conflict", "arc"]) requiredStageText(character, key, label);
    const name = text(character.name);
    if (names.has(name)) throw new Error(`人物姓名重复：${name}`);
    names.add(name);
    if (!list(character.traits).some((trait) => text(trait))) throw new Error(`${label}缺少 traits`);
  }
  const relationships = stageObjects(payload, "relationships", 1, 24);
  const relationKeys = new Set<string>();
  for (const [index, relation] of relationships.entries()) {
    const label = `第 ${index + 1} 条人物关系`;
    for (const key of ["from", "to", "label", "tone", "description"]) requiredStageText(relation, key, label);
    const from = text(relation.from);
    const to = text(relation.to);
    if (!names.has(from) || !names.has(to)) throw new Error(`${label}引用了不存在的人物`);
    if (from === to) throw new Error(`${label}不能指向同一人物`);
    if (!["正向", "复杂", "对立", "未知"].includes(text(relation.tone))) throw new Error(`${label}的 tone 无效`);
    const relationKey = [from, to].sort().join("\u0000");
    if (relationKeys.has(relationKey)) throw new Error(`${label}与已有关系重复`);
    relationKeys.add(relationKey);
  }
}

function validateWorldStage(payload: JsonRecord) {
  const world = stageObjects(payload, "world", 5, 10);
  const titles = new Set<string>();
  for (const [index, entry] of world.entries()) {
    const label = `第 ${index + 1} 条世界设定`;
    for (const key of ["category", "title", "summary", "details"]) requiredStageText(entry, key, label);
    if (!["地点", "势力", "规则", "历史", "物件"].includes(text(entry.category))) throw new Error(`${label}的 category 无效`);
    const title = text(entry.title);
    if (titles.has(title)) throw new Error(`世界设定标题重复：${title}`);
    titles.add(title);
  }
}

function validateOutlineStage(payload: JsonRecord, targetChapters?: number) {
  const outline = stageObjects(payload, "outline", 4, 8);
  let expectedStart = 1;
  for (const [index, beat] of outline.entries()) {
    const label = `第 ${index + 1} 个大纲节点`;
    for (const key of ["act", "title", "summary"]) requiredStageText(beat, key, label);
    if (!Number.isInteger(beat.chapterStart) || !Number.isInteger(beat.chapterEnd)) throw new Error(`${label}的章节范围必须是整数`);
    const start = Number(beat.chapterStart);
    const end = Number(beat.chapterEnd);
    if (start !== expectedStart) throw new Error(`${label}必须从第 ${expectedStart} 章开始，不能断档或重叠`);
    if (end < start) throw new Error(`${label}的结束章节不能早于开始章节`);
    if (targetChapters && end > targetChapters) throw new Error(`${label}超出目标章节数 ${targetChapters}`);
    expectedStart = end + 1;
  }
  if (targetChapters && expectedStart !== targetChapters + 1) {
    throw new Error(`大纲必须完整覆盖第 1—${targetChapters} 章`);
  }
}

function chapterTags(tags: unknown) {
  return list(tags).flatMap((tag) => {
    const match = text(tag).match(/^第\s*(\d+)\s*章$/);
    return match ? [Number(match[1])] : [];
  });
}

function validateForeshadowStage(payload: JsonRecord, targetChapters?: number) {
  const foreshadows = stageObjects(payload, "foreshadows", 4, 12);
  const titles = new Set<string>();
  for (const [index, item] of foreshadows.entries()) {
    const label = `第 ${index + 1} 条伏笔`;
    for (const key of ["title", "content"]) requiredStageText(item, key, label);
    const title = text(item.title);
    if (titles.has(title)) throw new Error(`伏笔标题重复：${title}`);
    titles.add(title);
    const plan = list(item.plan).filter(isJsonRecord);
    if (plan.length >= 2) {
      let previousChapter = 0;
      for (const [stepIndex, step] of plan.entries()) {
        if (!Number.isInteger(step.chapter)) throw new Error(`${label}第 ${stepIndex + 1} 个任务的 chapter 必须是整数`);
        const chapter = Number(step.chapter);
        if (chapter <= previousChapter) throw new Error(`${label}的 plan 必须按章节递增`);
        if (targetChapters && (chapter < 1 || chapter > targetChapters)) throw new Error(`${label}引用了目标范围外的章节`);
        if (!["plant", "advance", "resolve"].includes(text(step.action))) throw new Error(`${label}第 ${stepIndex + 1} 个任务的 action 无效`);
        requiredStageText(step, "instruction", `${label}第 ${stepIndex + 1} 个任务`);
        previousChapter = chapter;
      }
      if (text(plan[0].action) !== "plant") throw new Error(`${label}的第一个任务必须是 plant`);
      if (text(plan.at(-1)?.action) !== "resolve") throw new Error(`${label}的最后一个任务必须是 resolve`);
    } else {
      const tags = list(item.tags).map((tag) => text(tag)).filter(Boolean);
      const chapters = chapterTags(tags);
      if (chapters.length < 2) throw new Error(`${label}必须提供 plan，或用章节标签注明埋设和回收位置`);
      if (targetChapters && chapters.some((chapter) => chapter < 1 || chapter > targetChapters)) throw new Error(`${label}引用了目标范围外的章节`);
      if (Math.min(...chapters) === Math.max(...chapters)) throw new Error(`${label}的埋设与回收章节不能相同`);
    }
  }
}

function validateChapterStage(payload: JsonRecord, targetChapters?: number, outlineStage?: BlueprintStagePayload, foreshadowStage?: BlueprintStagePayload) {
  if (!targetChapters) throw new Error("章节校验缺少目标章节数");
  const chapters = stageObjects(payload, "chapters", targetChapters, targetChapters);
  const outline = list(outlineStage?.outline).filter(isJsonRecord);
  if (!outline.length) throw new Error("章节校验缺少大纲上下文");
  const foreshadowTitles = new Set(list(foreshadowStage?.foreshadows).filter(isJsonRecord).map((item) => text(item.title)));
  const seenNumbers = new Set<number>();
  const usedOutlineIndexes = new Set<number>();
  for (const [index, chapter] of chapters.entries()) {
    const label = `第 ${index + 1} 条章节规划`;
    for (const key of ["title", "summary", "pov", "objective", "opening", "turningPoint", "endingHook"]) requiredStageText(chapter, key, label);
    const scenes = list(chapter.scenes).filter((scene) => {
      if (typeof scene === "string") return Boolean(text(scene));
      if (!isJsonRecord(scene)) return false;
      for (const key of ["title", "objective", "conflict", "reveal", "emotionBeat"]) requiredStageText(scene, key, `${label}的场景卡`);
      return true;
    });
    if (scenes.length < 3 || scenes.length > 8) throw new Error(`${label}的 scenes 必须为 3—8 个可执行场景`);
    for (const action of list(chapter.foreshadowActions).filter(isJsonRecord)) {
      const title = text(action.title);
      if (!title || !foreshadowTitles.has(title)) throw new Error(`${label}引用了不存在的伏笔：${title || "未命名"}`);
      if (!["plant", "advance", "resolve"].includes(text(action.action))) throw new Error(`${label}的伏笔 action 无效`);
      requiredStageText(action, "instruction", `${label}的伏笔任务`);
    }
    if (!Number.isInteger(chapter.number)) throw new Error(`${label}的 number 必须是整数`);
    const number = Number(chapter.number);
    if (number < 1 || number > targetChapters || seenNumbers.has(number)) throw new Error(`章节编号必须从 1 到 ${targetChapters} 且不能重复`);
    seenNumbers.add(number);
    if (!Number.isInteger(chapter.outlineIndex)) throw new Error(`第 ${number} 章的 outlineIndex 必须是整数`);
    const outlineIndex = Number(chapter.outlineIndex);
    if (outlineIndex < 0 || outlineIndex >= outline.length) throw new Error(`第 ${number} 章引用了不存在的大纲节点`);
    const beat = outline[outlineIndex];
    const start = Number(beat.chapterStart);
    const end = Number(beat.chapterEnd);
    if (number < start || number > end) throw new Error(`第 ${number} 章不在所引用大纲节点的章节范围内`);
    usedOutlineIndexes.add(outlineIndex);
  }
  for (let number = 1; number <= targetChapters; number += 1) {
    if (!seenNumbers.has(number)) throw new Error(`章节规划缺少第 ${number} 章`);
  }
  if (usedOutlineIndexes.size !== outline.length) throw new Error("章节规划必须覆盖每一个大纲节点");
}

export function parseBlueprintStage(
  value: string,
  options: BlueprintStageOptions = {},
): BlueprintStagePayload {
  const payload = parseJson(value);
  if (options.project && !Object.keys(record(payload.project)).length) {
    throw new Error("人物步骤缺少作品核心信息");
  }
  for (const key of options.arrays || []) {
    const items = list(payload[key]);
    if (!items.length && !(options.allowEmpty || []).includes(key)) {
      throw new Error(`蓝图步骤缺少 ${key} 数据`);
    }
  }
  if (options.stage === "characters") validateCharacterStage(payload);
  if (options.stage === "world") validateWorldStage(payload);
  if (options.stage === "outline") validateOutlineStage(payload, options.targetChapters);
  if (options.stage === "foreshadows") validateForeshadowStage(payload, options.targetChapters);
  if (options.stage === "chapters") validateChapterStage(payload, options.targetChapters, options.outlineStage, options.foreshadowStage);
  return payload;
}

function seedContext(seed: StorySeed) {
  return {
    title: seed.title,
    genre: seed.genre,
    hook: seed.hook,
    premise: seed.premise,
    theme: seed.theme,
    protagonist: seed.protagonist,
    centralConflict: seed.centralConflict,
    endingTone: seed.endingTone,
  };
}

export function buildBlueprintCharactersPrompt(seed: StorySeed) {
  return `你是中文长篇小说人物总监。现在只完成全书蓝图的第 1/5 步：人物。不要生成世界观、大纲、伏笔或章节。

只输出合法 JSON：
{
  "project":{"title":"书名","genre":"题材","status":"筹备中","premise":"一句话梗概","theme":"主题","writingStyle":"文风约束","pointOfView":"叙事视角","bookContract":{"readingPromise":"读者持续能获得什么体验","protagonistFantasy":"主角替读者完成的核心幻想","coreSellingPoint":"不可替代卖点","chapter3Payoff":"第3章前兑现","chapter10Payoff":"第10章前兑现","chapter30Payoff":"第30章前兑现；短篇可写终局前兑现","escalationLadder":"冲突逐级升级路径","relationshipMainline":"核心关系变化主线","absoluteRedLines":["绝不能违反的创作红线"]}},
  "characters":[{"name":"姓名","role":"角色定位","age":"年龄","identity":"身份","goal":"外在目标","conflict":"内在冲突","arc":"人物弧光","traits":["标签"]}],
  "relationships":[{"from":"人物姓名","to":"人物姓名","label":"关系","tone":"正向|复杂|对立|未知","description":"张力与变化"}]
}

要求：人物 5—8 个；姓名唯一；目标、冲突和人物弧光必须能推动主线；关系只能引用 characters 中存在的姓名。bookContract 必须把整书卖点、读者承诺、3/10/30 章兑现节点、升级阶梯、关系主线和不可触碰红线写成可核对的执行约束。

【故事方向】
${JSON.stringify(seedContext(seed), null, 2)}`;
}

export function buildBlueprintWorldPrompt(seed: StorySeed, foundation: BlueprintStagePayload) {
  const project = record(foundation.project);
  const characters = list(foundation.characters).map((item) => {
    const character = record(item);
    return { name: text(character.name), role: text(character.role), identity: text(character.identity), goal: text(character.goal) };
  });
  return `你是中文长篇小说世界观设计师。现在只完成全书蓝图的第 2/5 步：设定。不要重复人物，不要生成大纲、伏笔或章节。

只输出合法 JSON：
{"world":[{"category":"地点|势力|规则|历史|物件","title":"名称","summary":"摘要","details":"来源、限制、日常影响与剧情用途"}]}

要求：生成 5—10 条可执行设定；每条都必须影响人物选择或核心冲突；规则必须写清限制和代价，避免百科式堆砌。

【故事方向】${JSON.stringify(seedContext(seed))}
【作品】${JSON.stringify(project)}
【人物】${JSON.stringify(characters)}`;
}

export function buildBlueprintOutlinePrompt(
  seed: StorySeed,
  settings: Pick<NovelAutomation, "targetChapters">,
  foundation: BlueprintStagePayload,
  worldStage: BlueprintStagePayload,
) {
  const characters = list(foundation.characters).map((item) => {
    const character = record(item);
    return { name: text(character.name), role: text(character.role), goal: text(character.goal), arc: text(character.arc) };
  });
  const world = list(worldStage.world).map((item) => {
    const entry = record(item);
    return { category: text(entry.category), title: text(entry.title), summary: text(entry.summary), details: text(entry.details) };
  });
  return `你是中文长篇小说结构编辑。现在只完成全书蓝图的第 3/5 步：大纲。不要生成伏笔或逐章目录。

只输出合法 JSON：
{"outline":[{"act":"幕/阶段","title":"关键节点","summary":"事件、选择、代价和变化","chapterStart":1,"chapterEnd":4}]}

要求：生成 4—8 个连续节点，完整覆盖第 1—${settings.targetChapters} 章；不能断档或越界；冲突逐级升级；最后一个节点必须解决核心冲突并完成人物弧光。

【故事方向】${JSON.stringify(seedContext(seed))}
【作品】${JSON.stringify(record(foundation.project))}
【人物】${JSON.stringify(characters)}
【设定】${JSON.stringify(world)}`;
}

export function buildBlueprintForeshadowsPrompt(
  seed: StorySeed,
  settings: Pick<NovelAutomation, "targetChapters">,
  foundation: BlueprintStagePayload,
  outlineStage: BlueprintStagePayload,
) {
  return `你是中文长篇小说伏笔编辑。现在只完成全书蓝图的第 4/5 步：伏笔。不要生成章节目录。

只输出合法 JSON：
{"foreshadows":[{"title":"伏笔名称","content":"伏笔的真相、误导方式与回收效果","plan":[{"chapter":1,"action":"plant","instruction":"本章如何自然埋设"},{"chapter":5,"action":"advance","instruction":"如何升级或制造误导"},{"chapter":12,"action":"resolve","instruction":"如何揭示并影响决战"}]}]}

要求：生成 4—12 条伏笔；每条 plan 至少包含 plant 和 resolve，可包含多个 advance；章节必须递增且不超出 1—${settings.targetChapters}；至少覆盖人物秘密、世界规则与核心谜题；结局前回收主要伏笔。

【故事方向】${JSON.stringify(seedContext(seed))}
【人物】${JSON.stringify(list(foundation.characters))}
【大纲】${JSON.stringify(list(outlineStage.outline))}`;
}

export function buildBlueprintChaptersPrompt(
  seed: StorySeed,
  settings: Pick<NovelAutomation, "targetChapters" | "chapterWords">,
  stages: { foundation: BlueprintStagePayload; world: BlueprintStagePayload; outline: BlueprintStagePayload; foreshadows: BlueprintStagePayload },
) {
  const characters = list(stages.foundation.characters).map((item) => {
    const character = record(item);
    return { name: text(character.name), role: text(character.role), goal: text(character.goal), conflict: text(character.conflict), arc: text(character.arc) };
  });
  const world = list(stages.world.world).map((item) => {
    const entry = record(item);
    return { category: text(entry.category), title: text(entry.title), summary: text(entry.summary), details: text(entry.details) };
  });
  return `你是中文长篇小说章节规划师。现在只完成全书蓝图的第 5/5 步：章节。不要重复输出人物、设定、大纲或伏笔。

只输出合法 JSON：
{"chapters":[{"number":1,"title":"章名","summary":"本章因果摘要","pov":"视角人物","outlineIndex":0,"objective":"本章必须完成的剧情目标","opening":"开场场景与即时张力","scenes":[{"title":"场景名","objective":"本场景要达成的动作目标","conflict":"阻力、对抗或两难","reveal":"新增信息或状态变化","emotionBeat":"情绪起点到落点"}],"mustAdvance":["本章必须推进的主线/关系/伏笔"],"mustPreserve":["本章不能破坏的既有事实"],"mustAvoid":["本章禁止出现的捷径、越权信息或红线"],"turningPoint":"不可逆转折或代价","endingHook":"下一章必须回应的问题","foreshadowActions":[{"title":"必须与伏笔表同名","action":"plant|advance|resolve","instruction":"本章的具体执行方式"}]}]}

硬性要求：
1. chapters 必须恰好 ${settings.targetChapters} 条，number 从 1 到 ${settings.targetChapters} 连续递增。
2. 每章目标约 ${settings.chapterWords} 字；summary 必须具体，不能写“承上启下”。
3. outlineIndex 从 0 开始，必须对应提供的大纲节点。
4. 相邻章节形成清晰因果；每章都产生新信息、选择或不可逆代价。
5. 每章必须提供 objective、opening、3—8 个结构化 scenes、mustAdvance、mustPreserve、mustAvoid、turningPoint 和 endingHook；每个场景都要有目标、冲突、揭示和情绪变化。
6. 伏笔表中每个 plan 任务必须出现在对应章的 foreshadowActions 中，不得遗漏或擅自改名。
7. 最后一章完成核心冲突、人物弧光并回收主要伏笔。

【故事方向】${JSON.stringify(seedContext(seed))}
【作品】${JSON.stringify(record(stages.foundation.project))}
【人物】${JSON.stringify(characters)}
【设定】${JSON.stringify(world)}
【大纲】${JSON.stringify(list(stages.outline.outline))}
【伏笔】${JSON.stringify(list(stages.foreshadows.foreshadows))}`;
}

function worldCategory(value: unknown): WorldEntry["category"] {
  return ["地点", "势力", "规则", "历史", "物件"].includes(String(value))
    ? value as WorldEntry["category"]
    : "规则";
}

function relationTone(value: unknown): Relationship["tone"] {
  return ["正向", "复杂", "对立", "未知"].includes(String(value))
    ? value as Relationship["tone"]
    : "复杂";
}

export function parseNovelBlueprint(
  value: string,
  seed: StorySeed,
  settings: Pick<NovelAutomation, "targetChapters" | "targetWords" | "chapterWords">,
): Omit<WorkspaceData, "automation"> {
  const payload = parseJson(value);
  const rawProject = record(payload.project);
  const now = new Date().toISOString();
  const targetChapters = clamp(settings.targetChapters, 4, 60);

  const project: ProjectInfo = {
    title: text(rawProject.title, seed.title),
    genre: text(rawProject.genre, seed.genre),
    status: text(rawProject.status, "筹备中"),
    premise: text(rawProject.premise, seed.premise),
    theme: text(rawProject.theme, seed.theme),
    targetWords: clamp(settings.targetWords, 10000, 600000),
    targetChapters,
    writingStyle: text(rawProject.writingStyle, "叙事清晰，场景具体，节奏有张有弛"),
    pointOfView: text(rawProject.pointOfView, "第三人称限知"),
    bookContract: (() => {
      const contract = record(rawProject.bookContract);
      return {
        readingPromise: text(contract.readingPromise, seed.hook || seed.premise),
        protagonistFantasy: text(contract.protagonistFantasy, seed.protagonist),
        coreSellingPoint: text(contract.coreSellingPoint, seed.hook),
        chapter3Payoff: text(contract.chapter3Payoff),
        chapter10Payoff: text(contract.chapter10Payoff),
        chapter30Payoff: text(contract.chapter30Payoff),
        escalationLadder: text(contract.escalationLadder, seed.centralConflict),
        relationshipMainline: text(contract.relationshipMainline),
        absoluteRedLines: list(contract.absoluteRedLines).map((item) => text(item)).filter(Boolean).slice(0, 20),
      };
    })(),
  };

  const characters: Character[] = list(payload.characters).slice(0, 12).map((item, index) => {
    const source = record(item);
    return {
      id: safeId("char", index),
      name: text(source.name, `人物 ${index + 1}`),
      role: text(source.role, index === 0 ? "主角" : "配角"),
      age: text(source.age, "未设定"),
      identity: text(source.identity, "身份待完善"),
      goal: text(source.goal, "推动故事走向结局"),
      conflict: text(source.conflict, "必须在欲望与代价之间选择"),
      arc: text(source.arc, "在关键选择中完成改变"),
      traits: list(source.traits).map((tag) => text(tag)).filter(Boolean).slice(0, 6),
      color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
    };
  });
  if (characters.length < 2) throw new Error("全书蓝图缺少可用的人物档案，请重新生成");

  const world: WorldEntry[] = list(payload.world).slice(0, 16).map((item, index) => {
    const source = record(item);
    return {
      id: safeId("world", index),
      category: worldCategory(source.category),
      title: text(source.title, `设定 ${index + 1}`),
      summary: text(source.summary, "与主线冲突直接相关的设定"),
      details: text(source.details, "说明来源、限制、日常影响与剧情用途"),
    };
  });

  const outline: OutlineBeat[] = list(payload.outline).slice(0, 12).map((item, index) => {
    const source = record(item);
    const start = clamp(Number(source.chapterStart) || 1, 1, targetChapters);
    const end = clamp(Number(source.chapterEnd) || start, start, targetChapters);
    return {
      id: safeId("beat", index),
      act: text(source.act, `阶段 ${index + 1}`),
      title: text(source.title, `关键节点 ${index + 1}`),
      summary: text(source.summary, "推进核心冲突并迫使主角付出代价"),
      chapterRange: `第 ${start}—${end} 章`,
      status: "待规划",
    };
  });
  if (!outline.length) throw new Error("全书蓝图缺少故事大纲，请重新生成");

  const rawChapters = list(payload.chapters)
    .map((item) => record(item))
    .sort((a, b) => Number(a.number) - Number(b.number));
  if (rawChapters.length < targetChapters) {
    throw new Error(`AI 只规划了 ${rawChapters.length} 章，少于要求的 ${targetChapters} 章，请重新生成蓝图`);
  }
  const chapters: Chapter[] = rawChapters.slice(0, targetChapters).map((source, index) => {
    const outlineIndex = clamp(Number(source.outlineIndex) || 0, 0, outline.length - 1);
    const sceneCards = list(source.scenes).filter(isJsonRecord).slice(0, 8).map((scene, sceneIndex) => ({
      id: safeId(`scene-${index + 1}`, sceneIndex),
      title: text(scene.title, `场景 ${sceneIndex + 1}`),
      objective: text(scene.objective),
      conflict: text(scene.conflict),
      reveal: text(scene.reveal),
      emotionBeat: text(scene.emotionBeat),
    }));
    const legacyScenes = list(source.scenes).map((scene) => text(scene)).filter(Boolean).slice(0, 8);
    const scenes = sceneCards.length ? sceneCards.map(sceneCardLabel) : legacyScenes;
    return {
      id: safeId("chapter", index),
      number: index + 1,
      title: text(source.title, `第 ${index + 1} 章`),
      summary: text(source.summary, "本章推进核心冲突，并以新的问题或选择收尾。"),
      content: "",
      status: "待生成",
      updatedAt: now,
      outlineBeatId: outline[outlineIndex]?.id,
      pov: text(source.pov, characters[0]?.name || project.pointOfView),
      targetWords: clamp(settings.chapterWords, 1200, 12000),
      chapterOutline: {
        objective: text(source.objective, text(source.summary, "完成本章核心剧情目标")),
        opening: text(source.opening, "从相邻章节的未解冲突自然切入"),
        scenes,
        ...(sceneCards.length ? { sceneCards } : {}),
        mustAdvance: list(source.mustAdvance).map((item) => text(item)).filter(Boolean).slice(0, 20),
        mustPreserve: list(source.mustPreserve).map((item) => text(item)).filter(Boolean).slice(0, 20),
        mustAvoid: list(source.mustAvoid).map((item) => text(item)).filter(Boolean).slice(0, 20),
        turningPoint: text(source.turningPoint, "人物做出不可逆选择并付出代价"),
        endingHook: text(source.endingHook, "以新问题或危机引向下一章"),
        foreshadowActions: list(source.foreshadowActions).filter(isJsonRecord).flatMap((action) => {
          const title = text(action.title);
          if (!title) return [];
          return [{
            title,
            action: ["plant", "advance", "resolve"].includes(text(action.action)) ? text(action.action) as "plant" | "advance" | "resolve" : "advance",
            instruction: text(action.instruction, "按伏笔计划在本章自然执行"),
          }];
        }),
      },
    };
  });

  const nameToId = new Map(characters.map((item) => [item.name, item.id]));
  const relationships: Relationship[] = list(payload.relationships).flatMap((item, index) => {
    const source = record(item);
    const fromId = nameToId.get(text(source.from));
    const toId = nameToId.get(text(source.to));
    if (!fromId || !toId || fromId === toId) return [];
    return [{
      id: safeId("rel", index),
      fromId,
      toId,
      label: text(source.label, "复杂关系"),
      tone: relationTone(source.tone),
      description: text(source.description, "关系会随主线选择发生变化。"),
    }];
  });

  const materials: Material[] = list(payload.foreshadows).slice(0, 16).map((item, index) => {
    const source = record(item);
    return {
      id: safeId("material", index),
      type: "伏笔",
      title: text(source.title, `伏笔 ${index + 1}`),
      content: text(source.content, "在前段埋设，并在结局前完成回收。"),
      tags: list(source.tags).map((tag) => text(tag)).filter(Boolean).slice(0, 8),
      createdAt: now,
      foreshadowPlan: (() => {
        const explicit = list(source.plan).filter(isJsonRecord).flatMap((step) => {
          if (!Number.isInteger(step.chapter)) return [];
          return [{
            chapterNumber: clamp(Number(step.chapter), 1, targetChapters),
            action: ["plant", "advance", "resolve"].includes(text(step.action)) ? text(step.action) as "plant" | "advance" | "resolve" : "advance",
            instruction: text(step.instruction, "按计划执行伏笔任务"),
          }];
        });
        if (explicit.length) return explicit;
        const tagged = chapterTags(source.tags).sort((a, b) => a - b);
        return tagged.map((chapterNumber, stepIndex) => ({
          chapterNumber,
          action: stepIndex === 0 ? "plant" as const : stepIndex === tagged.length - 1 ? "resolve" as const : "advance" as const,
          instruction: stepIndex === 0 ? "自然埋设伏笔" : stepIndex === tagged.length - 1 ? "回收伏笔并影响剧情" : "升级伏笔或制造误导",
        }));
      })(),
    };
  });

  return {
    project,
    ideas: [{
      id: safeId("idea", 0),
      title: seed.hook,
      content: seed.premise,
      tags: [seed.genre, "AI全书方案"],
      favorite: true,
      createdAt: now,
    }],
    world,
    characters,
    relationships,
    outline,
    chapters,
    issues: [],
    materials,
    versions: [],
    canon: {
      revision: 0,
      chapterSummaries: [],
      timeline: [],
      characterStates: [],
      threads: [],
      facts: [],
      narrativeEvents: [],
      knowledgeStates: [],
      lastAuditedChapter: 0,
    },
  };
}

export function canonBeforeChapter(workspace: WorkspaceData, chapterNumber: number): CanonLedger {
  return {
    ...workspace.canon,
    chapterSummaries: workspace.canon.chapterSummaries.filter((item) => item.chapterNumber < chapterNumber),
    timeline: workspace.canon.timeline.filter((item) => item.chapterNumber < chapterNumber),
    characterStates: workspace.canon.characterStates.filter((item) => item.chapterNumber < chapterNumber),
    facts: workspace.canon.facts.filter((item) => item.chapterNumber < chapterNumber),
    narrativeEvents: (workspace.canon.narrativeEvents || []).filter((item) => item.chapterNumber < chapterNumber),
    knowledgeStates: (workspace.canon.knowledgeStates || []).filter((item) => item.chapterNumber < chapterNumber),
    threads: workspace.canon.threads
      .filter((item) => item.openedChapter < chapterNumber)
      .map((item) => item.resolvedChapter !== undefined && item.resolvedChapter >= chapterNumber ? {
        ...item,
        status: "open" as const,
        resolvedChapter: undefined,
      } : item),
    lastAuditedChapter: Math.min(workspace.canon.lastAuditedChapter, Math.max(0, chapterNumber - 1)),
  };
}

export function compactCanonBeforeChapter(workspace: WorkspaceData, chapterNumber: number): CanonLedger {
  const full = canonBeforeChapter(workspace, chapterNumber);
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  const targetText = JSON.stringify({
    title: chapter?.title,
    summary: chapter?.summary,
    pov: chapter?.pov,
    outline: chapter?.chapterOutline,
  });
  const relevantTerms = [
    ...workspace.characters.map((item) => item.name),
    ...workspace.materials.filter((item) => item.type === "伏笔").map((item) => item.title),
  ].filter((term) => term && targetText.includes(term));
  const score = (text: string, itemChapter: number) =>
    relevantTerms.reduce((total, term) => total + (text.includes(term) ? 100 : 0), 0)
    + Math.max(0, 50 - Math.max(0, chapterNumber - itemChapter));
  const select = <T extends { id: string }>(
    items: T[],
    chapterOf: (item: T) => number,
    textOf: (item: T) => string,
    recentLimit: number,
    relevantLimit: number,
  ) => {
    const ordered = [...items].sort((a, b) => chapterOf(a) - chapterOf(b));
    const recent = ordered.slice(-recentLimit);
    const recentIds = new Set(recent.map((item) => item.id));
    const relevant = ordered
      .filter((item) => !recentIds.has(item.id) && relevantTerms.some((term) => textOf(item).includes(term)))
      .sort((a, b) => score(textOf(b), chapterOf(b)) - score(textOf(a), chapterOf(a)))
      .slice(0, relevantLimit);
    return [...relevant, ...recent].sort((a, b) => chapterOf(a) - chapterOf(b));
  };
  const latestCharacterStates = [...full.characterStates]
    .sort((a, b) => b.chapterNumber - a.chapterNumber)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.name === item.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const openThreads = full.threads.filter((item) => item.status === "open").slice(-80);
  const recentResolvedThreads = full.threads.filter((item) => item.status === "resolved").slice(-20);

  const mergeById = <T extends { id: string }>(...groups: T[][]) => [...new Map(groups.flat().map((item) => [item.id, item])).values()];
  const milestoneSummaries = full.chapterSummaries.filter((item) => item.chapterNumber === 1 || item.chapterNumber % 10 === 0).slice(-4);
  const chapterSummaries = [...new Map([...milestoneSummaries, ...full.chapterSummaries.slice(-12)].map((item) => [item.chapterId, item])).values()]
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
  const selectedTimeline = select(full.timeline, (item) => item.chapterNumber, (item) => item.event, 40, 20);
  const timeline = mergeById(full.timeline.slice(0, 10), selectedTimeline.slice(-50))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
  const selectedFacts = select(full.facts, (item) => item.chapterNumber, (item) => item.fact, 60, 30);
  const facts = mergeById(full.facts.slice(0, 20), selectedFacts.slice(-70))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
  return {
    ...full, chapterSummaries, timeline, characterStates: latestCharacterStates,
    threads: [...openThreads, ...recentResolvedThreads].slice(-100), facts,
    narrativeEvents: (full.narrativeEvents || []).slice(-120),
    knowledgeStates: (full.knowledgeStates || []).slice(-120),
  };
}

export function canonContextBeforeChapter(workspace: WorkspaceData, chapterNumber: number) {
  const compact = compactCanonBeforeChapter(workspace, chapterNumber);
  const { chapterSummaries, ...canon } = compact;
  const evidenceBackedChapters = new Set(workspace.chapters
    .filter((item) => item.number < chapterNumber && item.memory?.evidenceVersion === 1)
    .map((item) => item.number));
  const verified: CanonLedger = {
    ...canon,
    chapterSummaries: [],
    timeline: canon.timeline.filter((item) => evidenceBackedChapters.has(item.chapterNumber)),
    characterStates: canon.characterStates.filter((item) => evidenceBackedChapters.has(item.chapterNumber)),
    facts: canon.facts.filter((item) => evidenceBackedChapters.has(item.chapterNumber) && (item.level === undefined || ["author", "text"].includes(item.level))),
    threads: canon.threads
      .filter((item) => evidenceBackedChapters.has(item.openedChapter))
      .map((item) => item.resolvedChapter !== undefined && !evidenceBackedChapters.has(item.resolvedChapter)
        ? { ...item, status: "open" as const, resolvedChapter: undefined }
        : item),
  };
  return {
    verified,
    narrativeRecaps: chapterSummaries.map((item) => ({
      chapterNumber: item.chapterNumber, summary: item.summary,
      warning: "\u5bfc\u822a\u6458\u8981\uff0c\u4e0d\u80fd\u5355\u72ec\u7528\u4f5c\u4e8b\u5b9e\u8bc1\u636e",
    })),
    legacyMemoryChapters: workspace.chapters
      .filter((item) => item.number < chapterNumber && item.memory && item.memory.evidenceVersion !== 1)
      .map((item) => item.number),
  };
}

export function foreshadowTasksForChapter(workspace: WorkspaceData, chapterNumber: number) {
  const fromMaterials = workspace.materials
    .filter((material) => material.type === "伏笔")
    .flatMap((material) => (material.foreshadowPlan || [])
      .filter((step) => step.chapterNumber === chapterNumber)
      .map((step) => ({ title: material.title, content: material.content, action: step.action, instruction: step.instruction })));
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  const known = new Set(fromMaterials.map((item) => `${item.title}\u0000${item.action}`));
  const fromOutline = (chapter?.chapterOutline?.foreshadowActions || []).flatMap((action) => {
    const key = `${action.title}\u0000${action.action}`;
    if (known.has(key)) return [];
    const material = workspace.materials.find((item) => item.type === "伏笔" && item.title === action.title);
    return [{ title: action.title, content: material?.content || "", action: action.action, instruction: action.instruction }];
  });
  return [...fromMaterials, ...fromOutline];
}

export function removeChapterFromCanon(workspace: WorkspaceData, chapterNumber: number): WorkspaceData {
  return {
    ...workspace,
    canon: {
      ...workspace.canon,
      revision: workspace.canon.revision + 1,
      chapterSummaries: workspace.canon.chapterSummaries.filter((item) => item.chapterNumber !== chapterNumber),
      timeline: workspace.canon.timeline.filter((item) => item.chapterNumber !== chapterNumber),
      characterStates: workspace.canon.characterStates.filter((item) => item.chapterNumber !== chapterNumber),
      facts: workspace.canon.facts.filter((item) => item.chapterNumber !== chapterNumber),
      narrativeEvents: (workspace.canon.narrativeEvents || []).filter((item) => item.chapterNumber !== chapterNumber),
      knowledgeStates: (workspace.canon.knowledgeStates || []).filter((item) => item.chapterNumber !== chapterNumber),
      threads: workspace.canon.threads
        .filter((item) => item.openedChapter !== chapterNumber)
        .map((item) => item.resolvedChapter === chapterNumber ? { ...item, status: "open" as const, resolvedChapter: undefined } : item),
      lastAuditedChapter: Math.min(workspace.canon.lastAuditedChapter, Math.max(0, chapterNumber - 1)),
    },
  };
}

export function chapterSegmentObligations(target: Chapter, segmentIndex: number, totalSegments: number) {
  const outline = target.chapterOutline;
  const total = Math.max(1, totalSegments);
  const index = Math.max(0, Math.min(total - 1, segmentIndex));
  const scenes = outline?.scenes || [];
  const sceneStart = Math.floor(index * scenes.length / total);
  const sceneEnd = Math.floor((index + 1) * scenes.length / total);
  return {
    objective: outline?.objective || target.summary,
    opening: index === 0 ? outline?.opening : undefined,
    scenes: scenes.slice(sceneStart, Math.max(sceneStart + (scenes.length ? 1 : 0), sceneEnd)).filter(Boolean),
    turningPoint: index === total - 1 ? outline?.turningPoint : undefined,
    endingHook: index === total - 1 ? outline?.endingHook : undefined,
    forbiddenUntilLater: index < total - 1 ? [outline?.turningPoint, outline?.endingHook].filter(Boolean) : [],
  };
}

export function chapterDraftWordRange(targetWords: number) {
  const target = Math.max(500, Math.round(targetWords));
  return { minimum: target, recommendedMaximum: Math.ceil(target * 1.2) };
}

export function compileAutomatedChapterContext(workspace: WorkspaceData, target: Chapter, existingDraft = "", budgetTokens = 16_000) {
  const canonContext = canonContextBeforeChapter(workspace, target.number);
  const inputs = {
    verifiedCanon: canonContext.verified,
    existingDraft,
    foreshadowTasks: foreshadowTasksForChapter(workspace, target.number),
    narrativeRecaps: canonContext.narrativeRecaps,
  };
  const manifest = compileContextManifest(workspace, target, budgetTokens, inputs);
  return { manifest, payload: contextPayloadFromManifest(workspace, target, manifest, inputs) };
}

export function buildAutomatedChapterPrompt(
  workspace: WorkspaceData,
  target: Chapter,
  draft: { index?: number; total?: number; existingDraft: string },
) {
  const chapters = [...workspace.chapters].sort((a, b) => a.number - b.number);
  const index = chapters.findIndex((item) => item.id === target.id);
  const isFinal = index === chapters.length - 1;
  const wordRange = chapterDraftWordRange(target.targetWords);
  const { manifest: contextManifest, payload: intelligentContext } = compileAutomatedChapterContext(workspace, target, draft.existingDraft);
  const compactContext = {
    writingMode: "whole_chapter_single_pass",
    contextManifest: { budgetTokens: contextManifest.budgetTokens, estimatedTokens: contextManifest.estimatedTokens, included: contextManifest.items.filter((item) => item.included).map((item) => ({ section: item.section, source: item.source, reason: item.reason, priority: item.priority })), warnings: contextManifest.warnings },
    narrativeIntelligence: intelligentContext,
    factPriority: [
      "已验证事实账本与上一章实际结尾",
      "本章完整章纲与伏笔任务",
      "世界规则与人物最新状态",
      "人物初始档案和全书设定",
    ],
    currentChapter: {
      number: target.number, title: target.title, pov: target.pov,
      targetWords: target.targetWords,
      hardWordRequirement: {
        minimum: wordRange.minimum,
        recommendedMaximum: wordRange.recommendedMaximum,
        allowOverTarget: true,
      },
    },
  };

  return `\u4f60\u662f\u6b63\u5728\u8fde\u7eed\u521b\u4f5c\u540c\u4e00\u90e8\u957f\u7bc7\u5c0f\u8bf4\u7684\u4e2d\u6587\u4f5c\u5bb6\u3002\u8bf7\u4e00\u6b21\u6027\u5b8c\u6210\u7b2c ${target.number} \u7ae0\u300a${target.title}\u300b\u7684\u5b8c\u6574\u6b63\u6587\u3002\u4e0d\u8981\u5206\u6bb5\u8bf7\u6c42\u3001\u4e0d\u8981\u53ea\u7eed\u5199\u5c40\u90e8\u3001\u4e0d\u8981\u8f93\u51fa\u672a\u5b8c\u6210\u7ae0\u8282\u3002

\u4e8b\u5b9e\u4f18\u5148\u7ea7\uff1a\u5df2\u9a8c\u8bc1\u4e8b\u5b9e > \u672c\u7ae0\u5b8c\u6574\u7ae0\u7eb2 > \u4e16\u754c\u89c4\u5219\u4e0e\u6700\u65b0\u4eba\u7269\u72b6\u6001 > \u4f5c\u8005\u540e\u53f0\u6863\u6848\u3002\u5982\u6709\u51b2\u7a81\uff0c\u5fc5\u987b\u9075\u5faa\u4f18\u5148\u7ea7\u66f4\u9ad8\u7684\u5185\u5bb9\u3002

\u786c\u6027\u8981\u6c42\uff1a
1. \u6b63\u6587\u4e0d\u5f97\u5c11\u4e8e ${wordRange.minimum} \u4e2a\u4e2d\u6587\u5b57\u7b26\uff1b\u8d85\u8fc7\u76ee\u6807\u5b57\u6570\u53ef\u4ee5\u6b63\u5e38\u9a8c\u6536\uff0c\u4e0d\u5f97\u56e0\u8d85\u5b57\u6570\u622a\u65ad\u5267\u60c5\u6216\u505c\u6b62\u4efb\u52a1\uff1b\u5efa\u8bae\u5c3d\u91cf\u63a7\u5236\u5728 ${wordRange.recommendedMaximum} \u5b57\u5de6\u53f3\uff0c\u4f46\u8fd9\u4e0d\u662f\u786c\u6027\u4e0a\u9650\u3002
2. \u4e00\u6b21\u8f93\u51fa\u6574\u7ae0\uff0c\u5fc5\u987b\u5305\u542b opening\u3001\u5168\u90e8 scenes\u3001turningPoint \u548c endingHook\uff0c\u4e0d\u5f97\u5206\u6279\u3001\u7559\u5f85\u4e0b\u6b21\u7eed\u5199\u3002
3. \u4e25\u683c\u4f7f\u7528\u201c${target.pov || workspace.project.pointOfView}\u201d\u89c6\u89d2\uff0c\u4eba\u7269\u53ea\u80fd\u77e5\u9053 verifiedFacts \u548c povKnowledgeBoundary \u4e2d\u5df2\u786e\u8ba4\u77e5\u9053\u7684\u4fe1\u606f\u3002
4. \u81ea\u7136\u627f\u63a5\u4e0a\u4e00\u7ae0\u7684\u5b9e\u9645\u7ed3\u5c3e\uff0c\u4ece opening \u8fdb\u5165\uff0c\u4f9d\u6b21\u5b8c\u6210\u573a\u666f\u3001\u8f6c\u6298\u548c\u7ae0\u672b\u94a9\u5b50\u3002
5. existingDraftReference \u53ea\u662f\u65e7\u8349\u7a3f\u53c2\u8003\uff1b\u5982\u5176\u4e0d\u4e3a\u7a7a\uff0c\u5e94\u4fdd\u7559\u5176\u4e2d\u6709\u6548\u60c5\u8282\u548c\u6587\u98ce\uff0c\u4f46\u4ecd\u5fc5\u987b\u8fd4\u56de\u4ece\u5f00\u573a\u5230\u7ed3\u5c3e\u7684\u5b8c\u6574\u65b0\u7ae0\u8282\uff0c\u4e0d\u5f97\u53ea\u8fd4\u56de\u8ffd\u52a0\u5185\u5bb9\u3002
6. unverifiedNarrativeRecaps \u53ea\u7528\u4e8e\u5b9a\u4f4d\u524d\u6587\uff0c\u4e0d\u80fd\u5355\u72ec\u5f53\u4f5c\u4e8b\u5b9e\u8bc1\u636e\u3002\u4f5c\u8005\u540e\u53f0\u6863\u6848\u4e0d\u7b49\u4e8e\u4eba\u7269\u5df2\u77e5\u4fe1\u606f\u3002
7. problemsToAvoid \u662f\u9700\u8981\u907f\u514d\u7684\u65e7\u95ee\u9898\uff0c\u4e0d\u662f\u4e8b\u5b9e\uff0c\u4e0d\u5f97\u5c06\u95ee\u9898\u63cf\u8ff0\u5199\u8fdb\u6b63\u6587\u3002
8. \u4e0d\u5f97\u64c5\u81ea\u6539\u540d\u3001\u65b0\u589e\u6838\u5fc3\u8eab\u4efd\u3001\u6539\u53d8\u7269\u4ef6\u5f52\u5c5e\u3001\u91cd\u7f6e\u4eba\u7269\u4f24\u52bf\u6216\u63a8\u7ffb\u4e16\u754c\u89c4\u5219\u3002
9. ${isFinal ? "\u8fd9\u662f\u5168\u4e66\u6700\u540e\u4e00\u7ae0\uff1a\u5fc5\u987b\u6309\u84dd\u56fe\u89e3\u51b3\u6838\u5fc3\u51b2\u7a81\u5e76\u56de\u6536\u4e3b\u8981\u4f0f\u7b14\u3002" : "\u4e0d\u8981\u63d0\u524d\u7ed3\u675f\u5168\u4e66\u3002"}
10. foreshadowTasks \u53ea\u80fd\u6267\u884c\u5f53\u524d\u7ae0\u6307\u5b9a\u7684 plant/advance/resolve\uff0c\u4e0d\u5f97\u81ea\u884c\u56de\u6536\u5176\u4ed6\u4f0f\u7b14\u3002
11. \u53ea\u8f93\u51fa\u5b8c\u6574\u5c0f\u8bf4\u6b63\u6587\uff0c\u4e0d\u8981\u7ae0\u8282\u6807\u9898\u3001\u5b57\u6570\u8bf4\u660e\u3001\u63d0\u7eb2\u3001\u521b\u4f5c\u8bf4\u660e\u6216 Markdown\u3002

\u3010\u7ecf\u8fc7\u5206\u5c42\u7684\u5199\u4f5c\u4e0a\u4e0b\u6587\u3011
${JSON.stringify(compactContext, null, 2)}`;
}

export function validateGeneratedChapterFormat(generated: string) {
  const issues: string[] = [];
  if (/^(?:#{1,6}\s*|\u3010?\u7b2c\s*\d+\s*\u7ae0|\u521b\u4f5c\u8bf4\u660e|\u7ae0\u7eb2)/.test(generated.trim())) {
    issues.push("\u8f93\u51fa\u5305\u542b\u6807\u9898\u6216\u521b\u4f5c\u8bf4\u660e\uff0c\u4e0d\u662f\u7eaf\u6b63\u6587");
  }
  return issues;
}

export function validateGeneratedChapterDraft(target: Chapter, generated: string) {
  const issues: string[] = [];
  const length = generated.replace(/\s/g, "").length;
  const range = chapterDraftWordRange(target.targetWords);
  if (length < range.minimum) issues.push(`\u6574\u7ae0\u6b63\u6587\u53ea\u6709 ${length} \u5b57\uff0c\u4f4e\u4e8e\u786c\u6027\u4e0b\u9650 ${range.minimum} \u5b57`);
  return [...issues, ...validateGeneratedChapterFormat(generated)];
}

export function validateGeneratedChapterSegment(
  target: Chapter,
  segment: { index: number; total: number; existingDraft: string },
  generated: string,
) {
  const issues: string[] = [];
  const normalizedDraft = segment.existingDraft.replace(/\s+/g, "");
  const repeatedParagraph = generated.split(/\n{2,}/).map((item) => item.trim()).find((paragraph) => {
    const normalized = paragraph.replace(/\s+/g, "");
    return normalized.length >= 80 && normalizedDraft.includes(normalized);
  });
  if (repeatedParagraph) issues.push("\u8f93\u51fa\u91cd\u590d\u4e86\u672c\u7ae0\u5df2\u6709\u6b63\u6587");
  if (/^(?:#{1,6}\s*|\u3010?\u7b2c\s*\d+\s*\u7ae0|\u521b\u4f5c\u8bf4\u660e|\u7ae0\u7eb2)/.test(generated.trim())) {
    issues.push("\u8f93\u51fa\u5305\u542b\u6807\u9898\u6216\u521b\u4f5c\u8bf4\u660e\uff0c\u4e0d\u662f\u7eaf\u6b63\u6587");
  }
  if (segment.index < segment.total - 1) {
    const forbidden = [target.chapterOutline?.turningPoint, target.chapterOutline?.endingHook].filter((item): item is string => Boolean(item?.trim()));
    const normalizedGenerated = generated.replace(/\s+/g, "");
    for (const item of forbidden) {
      const normalized = item.replace(/\s+/g, "");
      if (normalized.length >= 6 && normalizedGenerated.includes(normalized)) {
        issues.push(`\u975e\u6700\u540e\u5206\u6bb5\u63d0\u524d\u5199\u5165\u540e\u7eed\u8f6c\u6298\u6216\u7ae0\u672b\u94a9\u5b50\uff1a${item}`);
      }
    }
  }
  return issues;
}

export function buildChapterMemoryPrompt(workspace: WorkspaceData, chapter: Chapter) {
  return `\u4f60\u662f\u957f\u7bc7\u5c0f\u8bf4\u7684\u8bc1\u636e\u5316\u8fde\u7eed\u6027\u8bb0\u5f55\u5458\u3002\u8bf7\u4ece\u521a\u5b8c\u6210\u7684\u7ae0\u8282\u6b63\u6587\u4e2d\u63d0\u53d6\u53ef\u4f9b\u540e\u7eed\u7ae0\u8282\u7ee7\u627f\u7684\u4e8b\u5b9e\u8bb0\u5fc6\u3002

\u53ea\u8f93\u51fa\u5408\u6cd5 JSON\uff0c\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\u3002\u7ed3\u6784\u5982\u4e0b\uff1a
{
  "evidenceVersion": 1,
  "summary": "300\u2014600\u5b57\u7684\u672c\u7ae0\u56e0\u679c\u6458\u8981",
  "timelineEvents": [{"event":"\u6309\u53d1\u751f\u987a\u5e8f\u8bb0\u5f55\u7684\u4e8b\u4ef6","quote":"\u80fd\u76f4\u63a5\u8bc1\u660e\u8be5\u4e8b\u4ef6\u7684\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "characterUpdates": [{"name":"\u4eba\u7269\u59d3\u540d","state":"\u672c\u7ae0\u7ed3\u675f\u7efc\u5408\u72b6\u6001","location":"\u6240\u5728\u5730\u70b9","physical":"\u8eab\u4f53\u72b6\u6001","emotion":"\u60c5\u7eea","knowledge":["\u5df2\u7ecf\u786e\u8ba4\u77e5\u9053\u7684\u4fe1\u606f"],"inventory":["\u6301\u6709\u7684\u91cd\u8981\u7269\u54c1"],"goal":"\u5f53\u524d\u76ee\u6807","quote":"\u80fd\u76f4\u63a5\u8bc1\u660e\u8be5\u72b6\u6001\u7684\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "openedThreads": [{"title":"\u672c\u7ae0\u65b0\u51fa\u73b0\u4e14\u5c1a\u672a\u89e3\u51b3\u7684\u7ebf\u7d22","quote":"\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "resolvedThreads": [{"title":"\u672c\u7ae0\u660e\u786e\u89e3\u51b3\u7684\u7ebf\u7d22","quote":"\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "establishedFacts": [{"fact":"\u540e\u6587\u4e0d\u53ef\u968f\u610f\u63a8\u7ffb\u7684\u660e\u786e\u4e8b\u5b9e","quote":"\u80fd\u76f4\u63a5\u8bc1\u660e\u8be5\u4e8b\u5b9e\u7684\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "outlineEvidence": [{"key":"objective|opening|scene|turningPoint|endingHook","label":"\u5bf9\u5e94\u7ae0\u7eb2\u9879\u76ee","status":"executed|partial|missing","score":0,"evidence":"\u6267\u884c\u5224\u65ad","quote":"\u6b63\u6587\u4e2d\u7684\u8fde\u7eed\u539f\u53e5"}],
  "narrativeEvents": [{"id":"event-1","event":"\u672c\u7ae0\u53d1\u751f\u7684\u539f\u5b50\u4e8b\u4ef6","actualOrder":1,"revealOrder":1,"participants":["\u4eba\u7269\u59d3\u540d"],"location":"\u5730\u70b9","causeIds":["\u524d\u6587\u4e8b\u4ef6 id\uff0c\u6ca1\u6709\u5219\u7a7a\u6570\u7ec4"],"effectIds":[],"quote":"\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "knowledgeChanges": [{"characterName":"\u4eba\u7269\u59d3\u540d","fact":"\u672c\u7ae0\u540e\u8be5\u4eba\u7269\u77e5\u9053\u6216\u76f8\u4fe1\u7684\u4fe1\u606f","status":"knows|believes|suspects|conceals","sourceEventId":"\u5bf9\u5e94\u4e8b\u4ef6 id\uff0c\u53ef\u7a7a","quote":"\u6b63\u6587\u8fde\u7eed\u539f\u53e5"}],
  "foreshadowUpdates": [{"title":"\u4f0f\u7b14\u540d\u79f0","status":"planted|advanced|resolved","evidence":"\u5982\u4f55\u6267\u884c","quote":"\u6b63\u6587\u4e2d\u7684\u8fde\u7eed\u539f\u53e5"}]
}

\u8bc1\u636e\u786c\u89c4\u5219\uff1a
1. timelineEvents\u3001characterUpdates\u3001openedThreads\u3001resolvedThreads\u3001establishedFacts\u3001narrativeEvents\u3001knowledgeChanges \u6bcf\u4e00\u9879\u90fd\u5fc5\u987b\u6709 quote\u3002
2. quote \u5fc5\u987b\u662f\u6b63\u6587\u4e2d\u771f\u5b9e\u5b58\u5728\u7684\u8fde\u7eed\u539f\u6587\uff0c\u4e0d\u5f97\u6539\u5199\u3001\u6982\u62ec\u6216\u62fc\u63a5\u3002
3. \u6ca1\u6709\u53ef\u5f15\u7528\u539f\u6587\u7684\u63a8\u6d4b\u3001\u89e3\u8bfb\u3001\u672a\u6765\u53ef\u80fd\u6216\u4f5c\u8005\u8bbe\u5b9a\uff0c\u4e00\u5f8b\u4e0d\u5f97\u5199\u5165\u3002
4. \u4eba\u7269\u59d3\u540d\u5fc5\u987b\u6765\u81ea\u73b0\u6709\u4eba\u7269\u6863\u6848\uff1b\u6ca1\u6709\u51fa\u573a\u6216\u72b6\u6001\u672a\u53d8\u5316\u7684\u4eba\u7269\u4e0d\u8981\u5199 characterUpdates\u3002
5. \u4e0d\u8981\u628a\u65e7\u4e8b\u5b9e\u91cd\u590d\u5f53\u4f5c\u672c\u7ae0\u65b0\u4e8b\u5b9e\uff0c\u4e0d\u8981\u628a\u7591\u95ee\u5f53\u7ed3\u8bba\uff0c\u4e0d\u8981\u628a\u4eba\u7269\u8bf4\u8c0e\u5f53\u5ba2\u89c2\u4e8b\u5b9e\u3002
6. outlineEvidence \u5fc5\u987b\u5206\u522b\u8f93\u51fa objective\u3001opening\u3001turningPoint\u3001endingHook\uff1bchapterOutline.scenes \u4e2d\u6bcf\u4e2a\u573a\u666f\u5fc5\u987b\u5355\u72ec\u8f93\u51fa\u4e00\u6761 key=scene \u7684\u8bc1\u636e\uff0c\u4e0d\u5f97\u5408\u5e76\u3002 scene \u8bc1\u636e\u7684 label \u5fc5\u987b\u9010\u5b57\u590d\u5236 chapterOutline.scenes \u4e2d\u5bf9\u5e94\u7684\u5b8c\u6574\u6587\u672c\u3002
7. narrativeEvents \u4e2d id \u5fc5\u987b\u5728\u672c\u7ae0\u5185\u552f\u4e00\uff0cknowledgeChanges.sourceEventId \u548c causeIds \u5fc5\u987b\u5f15\u7528\u8be5 id \u6216\u524d\u6587\u4e8b\u4ef6 id\u3002narrativeEvents \u5fc5\u987b\u62c6\u6210\u53ef\u5efa\u7acb\u56e0\u679c\u7684\u539f\u5b50\u4e8b\u4ef6\uff1bactualOrder \u8868\u793a\u6545\u4e8b\u4e16\u754c\u771f\u5b9e\u53d1\u751f\u987a\u5e8f\uff0crevealOrder \u8868\u793a\u8bfb\u8005\u83b7\u77e5\u987a\u5e8f\u3002knowledgeChanges \u53ea\u8bb0\u5f55\u6b63\u6587\u4e2d\u5b9e\u9645\u83b7\u5f97\u7684\u4fe1\u606f\u3002
8. \u6bcf\u4e2a\u6570\u7ec4\u6700\u591a 20 \u6761\u3002

\u3010\u4f5c\u54c1\u3011
${JSON.stringify(workspace.project)}

\u3010\u4eba\u7269\u6863\u6848\u3011
${JSON.stringify(workspace.characters.map((item) => ({ name: item.name, identity: item.identity, goal: item.goal, conflict: item.conflict })))}

\u3010\u672c\u7ae0\u4e4b\u524d\u7684\u5df2\u9a8c\u8bc1\u4e8b\u5b9e\u8d26\u672c\u3011
${JSON.stringify(canonContextBeforeChapter(workspace, chapter.number).verified)}

\u3010\u672c\u7ae0\u7ae0\u7eb2\u3011
${JSON.stringify(chapter.chapterOutline || { summary: chapter.summary })}

\u3010\u672c\u7ae0\u5e94\u6267\u884c\u7684\u4f0f\u7b14\u4efb\u52a1\u3011
${JSON.stringify(foreshadowTasksForChapter(workspace, chapter.number))}

\u3010\u7b2c ${chapter.number} \u7ae0\u300a${chapter.title}\u300b\u5b8c\u6574\u6b63\u6587\u3011
${chapter.content.slice(-60_000)}`;
}

function parseOutlineExecutionEvidence(value: unknown) {
  return list(value).filter(isJsonRecord).flatMap((item) => {
    const label = text(item.label);
    if (!label) return [];
    const key = ["objective", "opening", "scene", "turningPoint", "endingHook"].includes(text(item.key))
      ? text(item.key) as "objective" | "opening" | "scene" | "turningPoint" | "endingHook"
      : "scene";
    const status = ["executed", "partial", "missing"].includes(text(item.status))
      ? text(item.status) as "executed" | "partial" | "missing"
      : "missing";
    return [{ key, label, status, score: clamp(Number(item.score) || 0, 0, 100), evidence: text(item.evidence), quote: text(item.quote), verified: false }];
  }).slice(0, 50);
}

export function mergeRepairOutlineEvidence(memory: ChapterMemory, repairEvidence?: ChapterMemory["outlineEvidence"]): ChapterMemory {
  if (!repairEvidence?.length) return memory;
  const keyOf = (entry: NonNullable<ChapterMemory["outlineEvidence"]>[number]) =>
    `${entry.key}|${entry.label.replace(/\s+/g, "").toLowerCase()}`;
  const merged = new Map<string, NonNullable<ChapterMemory["outlineEvidence"]>[number]>();
  for (const entry of memory.outlineEvidence || []) merged.set(keyOf(entry), entry);
  for (const entry of repairEvidence) {
    const key = keyOf(entry);
    const current = merged.get(key);
    const repairIsStronger = entry.status === "executed" && entry.score >= 60
      && (!current || current.status !== "executed" || current.score < entry.score);
    if (!current || repairIsStronger) merged.set(key, { ...entry, verified: false });
  }
  return { ...memory, outlineEvidence: [...merged.values()] };
}

export function parseChapterMemory(value: string): ChapterMemory {
  const payload = parseJson(value);
  const summary = text(payload.summary);
  if (!summary) throw new Error("\u7ae0\u8282\u8bb0\u5fc6\u7f3a\u5c11\u6709\u6548\u6458\u8981");
  const evidenceVersion = Number(payload.evidenceVersion) === 1 ? 1 as const : undefined;
  const timelineEvidence = list(payload.timelineEvents).flatMap((item) => {
    if (isJsonRecord(item)) {
      const event = text(item.event);
      return event ? [{ event, quote: text(item.quote) || undefined, verified: false }] : [];
    }
    return [];
  }).slice(0, 20);
  const threadEvidence = [
    ...list(payload.openedThreads).flatMap((item) => isJsonRecord(item) && text(item.title) ? [{ title: text(item.title), status: "opened" as const, quote: text(item.quote) || undefined, verified: false }] : []),
    ...list(payload.resolvedThreads).flatMap((item) => isJsonRecord(item) && text(item.title) ? [{ title: text(item.title), status: "resolved" as const, quote: text(item.quote) || undefined, verified: false }] : []),
  ].slice(0, 40);
  const factEvidence = list(payload.establishedFacts).flatMap((item) => {
    if (isJsonRecord(item)) {
      const fact = text(item.fact);
      return fact ? [{ fact, quote: text(item.quote) || undefined, verified: false }] : [];
    }
    return [];
  }).slice(0, 30);
  return {
    evidenceVersion,
    summary,
    timelineEvents: list(payload.timelineEvents).map((item) => isJsonRecord(item) ? text(item.event) : text(item)).filter(Boolean).slice(0, 20),
    timelineEvidence: timelineEvidence.length ? timelineEvidence : undefined,
    characterUpdates: list(payload.characterUpdates).map((item) => record(item)).flatMap((item) => {
      const name = text(item.name);
      const state = text(item.state);
      return name && state ? [{
        name, state,
        location: text(item.location) || undefined,
        physical: text(item.physical) || undefined,
        emotion: text(item.emotion) || undefined,
        knowledge: list(item.knowledge).map((entry) => text(entry)).filter(Boolean).slice(0, 100),
        inventory: list(item.inventory).map((entry) => text(entry)).filter(Boolean).slice(0, 100),
        goal: text(item.goal) || undefined,
        quote: text(item.quote) || undefined,
        verified: false,
      }] : [];
    }).slice(0, 20),
    openedThreads: list(payload.openedThreads).map((item) => isJsonRecord(item) ? text(item.title) : text(item)).filter(Boolean).slice(0, 20),
    resolvedThreads: list(payload.resolvedThreads).map((item) => isJsonRecord(item) ? text(item.title) : text(item)).filter(Boolean).slice(0, 20),
    threadEvidence: threadEvidence.length ? threadEvidence : undefined,
    establishedFacts: list(payload.establishedFacts).map((item) => isJsonRecord(item) ? text(item.fact) : text(item)).filter(Boolean).slice(0, 30),
    factEvidence: factEvidence.length ? factEvidence : undefined,
    outlineEvidence: parseOutlineExecutionEvidence(payload.outlineEvidence),
    narrativeEvents: list(payload.narrativeEvents).filter(isJsonRecord).flatMap((item, index) => {
      const event = text(item.event);
      if (!event) return [];
      return [{ id: text(item.id, `event-pending-${index + 1}`), chapterNumber: Number(item.chapterNumber) || 0, event, actualOrder: Number(item.actualOrder) || index + 1, revealOrder: Number(item.revealOrder) || index + 1, participants: list(item.participants).map((entry) => text(entry)).filter(Boolean).slice(0, 12), location: text(item.location) || undefined, causeIds: list(item.causeIds).map((entry) => text(entry)).filter(Boolean).slice(0, 12), effectIds: list(item.effectIds).map((entry) => text(entry)).filter(Boolean).slice(0, 12), quote: text(item.quote) || undefined, verified: false }];
    }).slice(0, 30),
    knowledgeChanges: list(payload.knowledgeChanges).filter(isJsonRecord).flatMap((item, index) => {
      const characterName = text(item.characterName);
      const fact = text(item.fact);
      if (!characterName || !fact) return [];
      const status = ["knows", "believes", "suspects", "conceals"].includes(text(item.status)) ? text(item.status) as "knows" | "believes" | "suspects" | "conceals" : "knows";
      return [{ id: text(item.id, `knowledge-pending-${index + 1}`), chapterNumber: Number(item.chapterNumber) || 0, characterName, fact, status, sourceEventId: text(item.sourceEventId) || undefined, quote: text(item.quote) || undefined, verified: false }];
    }).slice(0, 40),
    foreshadowUpdates: list(payload.foreshadowUpdates).filter(isJsonRecord).flatMap((item) => {
      const title = text(item.title);
      if (!title) return [];
      return [{
        title,
        status: ["planted", "advanced", "resolved"].includes(text(item.status)) ? text(item.status) as "planted" | "advanced" | "resolved" : "advanced",
        evidence: text(item.evidence), quote: text(item.quote), verified: false,
      }];
    }).slice(0, 30),
  };
}

function verifyQuotedEvidence(content: string, quote?: string) {
  const normalizedQuote = (quote || "").replace(/\s+/g, "").trim();
  if (normalizedQuote.length < 6) return false;
  return content.replace(/\s+/g, "").includes(normalizedQuote);
}

export function applyChapterMemory(
  workspace: WorkspaceData,
  chapterId: string,
  memory: ChapterMemory,
): WorkspaceData {
  const chapter = workspace.chapters.find((item) => item.id === chapterId);
  if (!chapter) return workspace;
  const chapterNumber = chapter.number;
  const evidenceRequired = memory.evidenceVersion === 1;
  const knownCharacterNames = new Set(workspace.characters.map((item) => item.name));
  const timelineEvidence = (memory.timelineEvidence || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) }));
  const threadEvidence = (memory.threadEvidence || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) }));
  const factEvidence = (memory.factEvidence || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) }));
  const eventIdMap = new Map((memory.narrativeEvents || []).map((entry, index) => [entry.id, `event-${chapterNumber}-${index + 1}`]));
  const narrativeEvents = (memory.narrativeEvents || []).map((entry, index) => ({ ...entry, id: `event-${chapterNumber}-${index + 1}`, chapterNumber, causeIds: entry.causeIds.map((id) => eventIdMap.get(id) || id), effectIds: entry.effectIds.map((id) => eventIdMap.get(id) || id), verified: verifyQuotedEvidence(chapter.content, entry.quote) })).filter((entry) => !evidenceRequired || entry.verified);
  const knowledgeChanges = (memory.knowledgeChanges || []).map((entry, index) => ({ ...entry, id: `knowledge-${chapterNumber}-${index + 1}`, chapterNumber, sourceEventId: entry.sourceEventId ? eventIdMap.get(entry.sourceEventId) || entry.sourceEventId : undefined, verified: verifyQuotedEvidence(chapter.content, entry.quote) })).filter((entry) => knownCharacterNames.has(entry.characterName) && (!evidenceRequired || entry.verified));
  const characterUpdates = memory.characterUpdates
    .map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) }))
    .filter((entry) => knownCharacterNames.has(entry.name) && (!evidenceRequired || entry.verified));
  const reliableTimeline = evidenceRequired
    ? timelineEvidence.filter((entry) => entry.verified).map((entry) => entry.event)
    : memory.timelineEvents;
  const reliableOpenedThreads = evidenceRequired
    ? threadEvidence.filter((entry) => entry.verified && entry.status === "opened").map((entry) => entry.title)
    : memory.openedThreads;
  const reliableResolvedThreads = evidenceRequired
    ? threadEvidence.filter((entry) => entry.verified && entry.status === "resolved").map((entry) => entry.title)
    : memory.resolvedThreads;
  const reliableFacts = evidenceRequired
    ? factEvidence.filter((entry) => entry.verified).map((entry) => entry.fact)
    : memory.establishedFacts;
  const factEvidenceByFact = new Map(factEvidence.filter((entry) => entry.verified).map((entry) => [entry.fact, entry.quote]));
  const verifiedMemory: ChapterMemory = {
    ...memory,
    timelineEvents: reliableTimeline, timelineEvidence,
    characterUpdates,
    openedThreads: reliableOpenedThreads, resolvedThreads: reliableResolvedThreads, threadEvidence,
    establishedFacts: reliableFacts, factEvidence,
    narrativeEvents, knowledgeChanges,
    outlineEvidence: (memory.outlineEvidence || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) })),
    foreshadowUpdates: (memory.foreshadowUpdates || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) })),
  };
  memory = verifiedMemory;
  const nextRevision = workspace.canon.revision + 1;
  const characterIds = new Map(workspace.characters.map((item) => [item.name, item.id]));
  const previousSummaries = workspace.canon.chapterSummaries.filter((item) => item.chapterId !== chapterId);
  const updatedNames = new Set(memory.characterUpdates.map((item) => item.name));
  const previousCharacterStates = workspace.canon.characterStates.filter((item) => !(item.chapterNumber === chapterNumber && updatedNames.has(item.name)));
  const foreshadowUpdates = evidenceRequired ? (memory.foreshadowUpdates || []).filter((item) => item.verified) : (memory.foreshadowUpdates || []);
  const resolvedTitles = new Set([...memory.resolvedThreads, ...foreshadowUpdates.filter((item) => item.status === "resolved").map((item) => item.title)]);
  const updatedThreads = workspace.canon.threads.map((item) => resolvedTitles.has(item.title) ? {
    ...item, status: "resolved" as const, resolvedChapter: chapterNumber,
  } : item);
  const knownThreadTitles = new Set(updatedThreads.map((item) => item.title));
  const openedThreadTitles = [...memory.openedThreads, ...foreshadowUpdates.filter((item) => item.status !== "resolved").map((item) => item.title)];
  const canon: CanonLedger = {
    ...workspace.canon,
    revision: nextRevision,
    chapterSummaries: [...previousSummaries, { chapterId, chapterNumber, summary: memory.summary }].sort((a, b) => a.chapterNumber - b.chapterNumber),
    timeline: [...workspace.canon.timeline.filter((item) => item.chapterNumber !== chapterNumber), ...memory.timelineEvents.map((event, index) => ({
      id: `timeline-${nextRevision}-${chapterNumber}-${index + 1}`, chapterNumber, event,
    }))],
    characterStates: [...previousCharacterStates, ...memory.characterUpdates.map((item) => ({
      characterId: characterIds.get(item.name), name: item.name, state: item.state, chapterNumber,
      location: item.location, physical: item.physical, emotion: item.emotion, knowledge: item.knowledge, inventory: item.inventory, goal: item.goal,
    }))],
    threads: [...updatedThreads, ...openedThreadTitles.filter((title) => !knownThreadTitles.has(title)).map((title, index) => ({
      id: `thread-${nextRevision}-${chapterNumber}-${index + 1}`, title, status: "open" as const, openedChapter: chapterNumber,
    }))],
    facts: [...workspace.canon.facts.filter((item) => item.chapterNumber !== chapterNumber), ...memory.establishedFacts.map((fact, index) => ({
      id: `fact-${nextRevision}-${chapterNumber}-${index + 1}`, chapterNumber, fact,
      level: evidenceRequired ? "text" as const : "ai_verified" as const,
      evidence: factEvidenceByFact.get(fact),
    }))],
    narrativeEvents: [...(workspace.canon.narrativeEvents || []).filter((item) => item.chapterNumber !== chapterNumber), ...narrativeEvents],
    knowledgeStates: [...(workspace.canon.knowledgeStates || []).filter((item) => item.chapterNumber !== chapterNumber), ...knowledgeChanges],
  };
  return {
    ...workspace,
    chapters: workspace.chapters.map((item) => item.id === chapterId ? {
      ...item, memory, revision: (item.revision || 0) + 1,
      generation: item.generation ? { ...item.generation, status: "generated" } : item.generation,
    } : item),
    canon,
  };
}

export function buildMechanicalStyleIssues(workspace: WorkspaceData, chapterNumber?: number): ConsistencyIssue[] {
  const chapters = workspace.chapters.filter((chapter) => chapter.content.trim() && (!chapterNumber || chapter.number === chapterNumber));
  const issues: ConsistencyIssue[] = [];
  const emptyEmotionPhrases = ["心中一震", "不禁", "莫名", "说不清", "难以言喻", "空气仿佛凝固", "陷入沉默", "一时无言"];
  const transitionPhrases = ["然而", "但是", "可是", "不过", "与此同时", "下一秒", "就在这时", "突然"];

  for (const chapter of chapters) {
    const content = chapter.content;
    const sentences = content.split(/[。！？!?]/).map((item) => item.replace(/^[s“”‘’「」『』—-]+/, "").trim()).filter((item) => item.length >= 6);
    const openings = new Map<string, number>();
    for (const sentence of sentences) {
      const opening = sentence.slice(0, 5);
      openings.set(opening, (openings.get(opening) || 0) + 1);
    }
    const repeatedOpening = [...openings.entries()].sort((a, b) => b[1] - a[1]).find(([, count]) => count >= 4);
    if (repeatedOpening) {
      issues.push({ id: `style-opening-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章句式开头机械重复`, description: `至少 ${repeatedOpening[1]} 个句子以“${repeatedOpening[0]}”开头，阅读节奏呈现模板化。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, evidence: repeatedOpening[0], source: "local", suggestedFix: "保留事件不变，调整部分句子的观察主体、动作顺序和长短节奏。" });
    }

    const emptyHits = emptyEmotionPhrases.map((phrase) => ({ phrase, count: content.split(phrase).length - 1 })).filter((item) => item.count >= 3);
    if (emptyHits.length) {
      const hit = emptyHits[0];
      issues.push({ id: `style-emotion-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章空泛情绪表达过多`, description: `“${hit.phrase}”出现 ${hit.count} 次，但没有稳定对应动作、身体反应或选择后果。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, evidence: hit.phrase, source: "local", suggestedFix: "将部分抽象情绪改为可观察动作、生理反应或人物选择，不要全部删除情绪描写。" });
    }

    const transitionHits = transitionPhrases.map((phrase) => ({ phrase, count: content.split(phrase).length - 1 })).filter((item) => item.count >= 4).sort((a, b) => b.count - a.count);
    if (transitionHits.length) {
      const hit = transitionHits[0];
      issues.push({ id: `style-transition-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章转折连接词过密`, description: `连接词“${hit.phrase}”出现 ${hit.count} 次，段落推进可能依赖显式提示而不是动作因果。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, evidence: hit.phrase, source: "local", suggestedFix: "删除可以由上下文自然表达的连接词，并用动作结果直接承接下一句。" });
    }

    const notButCount = sentences.filter((sentence) => /不是.{0,28}而是/.test(sentence)).length;
    const asIfCount = content.split("仿佛").length - 1;
    if (notButCount >= 3 || asIfCount >= 5) {
      const phrase = notButCount >= 3 ? "不是……而是……" : "仿佛";
      const count = notButCount >= 3 ? notButCount : asIfCount;
      issues.push({ id: `style-ai-pattern-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章出现高频模板句式`, description: `“${phrase}”模式出现约 ${count} 次，容易形成机械化的 AI 文风。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, evidence: phrase, source: "local", suggestedFix: "只改写重复最明显的句子，保留必要的对比和比喻，避免统一换成另一种模板。" });
    }

    const paragraphs = content.split(/\n{2,}/).map((item) => item.replace(/\s+/g, "").trim()).filter((item) => item.length >= 40);
    const paragraphCounts = new Map<string, number>();
    for (const paragraph of paragraphs) paragraphCounts.set(paragraph, (paragraphCounts.get(paragraph) || 0) + 1);
    const duplicate = [...paragraphCounts.entries()].find(([, count]) => count >= 2);
    if (duplicate) {
      issues.push({ id: `style-paragraph-${chapter.id}`, severity: "错误", category: "文风", title: `第 ${chapter.number} 章存在重复段落`, description: "同一段正文重复出现，可能来自分段续写时的上下文回声。", location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, evidence: duplicate[0].slice(0, 120), source: "local", suggestedFix: "删除重复副本，保留与前后因果衔接更自然的一处。" });
    }

    const sentenceLengths = sentences.map((sentence) => sentence.length);
    if (sentenceLengths.length >= 24) {
      const average = sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length;
      const variance = sentenceLengths.reduce((sum, value) => sum + (value - average) ** 2, 0) / sentenceLengths.length;
      const coefficient = Math.sqrt(variance) / Math.max(1, average);
      if (coefficient < 0.34) {
        issues.push({ id: `style-rhythm-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章句长节奏过度均匀`, description: `句长离散度仅 ${coefficient.toFixed(2)}，大量句子以相近长度匀速推进，容易呈现模型化节奏。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, source: "local", evidence: sentences.slice(0, 3).join(" / ").slice(0, 160), suggestedFix: "只在关键动作、停顿和揭示处拉开长短句差异，不要整章随机打碎句子。" });
      }
    }

    const explanatoryClosings = paragraphs.filter((paragraph) => /(?:这意味着|他终于明白|她终于明白|说到底|归根结底|这一刻.{0,18}(?:明白|知道|意识到))[^。！？]{0,36}[。！？]?$/.test(paragraph));
    if (explanatoryClosings.length >= 3) {
      issues.push({ id: `style-explain-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章解释式段尾过多`, description: `${explanatoryClosings.length} 个段落在结尾直接总结意义，削弱动作、意象和潜台词。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, source: "local", evidence: explanatoryClosings[0].slice(-140), suggestedFix: "保留必要结论，只把重复总结改成可见后果、人物反应或未说出口的选择。" });
    }

    const subjectOpenings = paragraphs.map((paragraph) => paragraph.slice(0, 3)).filter((opening) => /^(他|她)/.test(opening));
    const dominantSubject = [...new Set(subjectOpenings)].map((opening) => ({ opening, count: subjectOpenings.filter((item) => item === opening).length })).sort((a, b) => b.count - a.count)[0];
    if (dominantSubject && dominantSubject.count >= 6) {
      issues.push({ id: `style-subject-${chapter.id}`, severity: "提示", category: "文风", title: `第 ${chapter.number} 章段落起笔主体重复`, description: `至少 ${dominantSubject.count} 个段落以“${dominantSubject.opening}”起笔，镜头组织可能过于单一。`, location: `第 ${chapter.number} 章`, resolved: false, chapterNumber: chapter.number, source: "local", evidence: dominantSubject.opening, suggestedFix: "人工确认后，在少量段落改用环境变化、对话后果或物件动作起笔。" });
    }

    const ending = content.slice(-260);
    const endingMatch = ending.match(/一切才刚刚开始|命运的齿轮.{0,12}(?:转动|开始)|没有人知道.{0,30}(?:将会|发生)|新的风暴.{0,20}(?:来临|开始)|他知道.{0,30}才刚刚开始/);
    if (endingMatch) {
      issues.push({ id: `style-ending-${chapter.id}`, severity: "警告", category: "文风", title: `第 ${chapter.number} 章使用总结式模板结尾`, description: `章末以“${endingMatch[0]}”概括悬念，没有把钩子落到具体的新信息、行动或代价上。`, location: `第 ${chapter.number} 章结尾`, resolved: false, chapterNumber: chapter.number, evidence: endingMatch[0], source: "local", suggestedFix: "用具体物件、消息、决定或即时危险收尾，让读者直接看到下一章必须回应的问题。" });
    }
  }
  return issues.map(withAuditConfidence);
}

export function buildNarrativeHealthIssues(workspace: WorkspaceData): ConsistencyIssue[] {
  const drafted = workspace.chapters.filter((chapter) => chapter.content.trim()).sort((a, b) => a.number - b.number);
  const currentChapter = drafted.at(-1)?.number || 0;
  if (!currentChapter) return [];
  const issues: ConsistencyIssue[] = [];
  const threadDormancyLimit = Math.max(3, Math.min(6, Math.round(workspace.project.targetChapters / 12)));

  for (const thread of workspace.canon.threads.filter((item) => item.status === "open")) {
    const dormantChapters = currentChapter - thread.openedChapter;
    if (dormantChapters < threadDormancyLimit) continue;
    issues.push({
      id: `health-thread-${thread.id}`,
      severity: dormantChapters >= threadDormancyLimit * 2 ? "错误" : "警告",
      category: "情节",
      title: `长期未推进的故事线：${thread.title}`,
      description: `该故事线从第 ${thread.openedChapter} 章开启，至第 ${currentChapter} 章仍没有解决记录，已经停滞 ${dormantChapters} 章。`,
      location: `第 ${currentChapter} 章`,
      resolved: false,
      chapterNumber: currentChapter,
      source: "local",
      suggestedFix: `在第 ${currentChapter} 章用行动、信息或关系变化推进“${thread.title}”；若暂不回收，也要让读者看到它仍在变化。`,
    });
  }

  const coreCharacters = workspace.characters.filter((character) => /主角|核心/.test(character.role));
  for (const character of coreCharacters) {
    const memoryMentions = drafted.flatMap((chapter) => chapter.memory?.characterUpdates?.some((update) => update.name === character.name) ? [chapter.number] : []);
    const povMentions = drafted.flatMap((chapter) => chapter.pov === character.name ? [chapter.number] : []);
    const lastMention = Math.max(0, ...memoryMentions, ...povMentions);
    const absentChapters = currentChapter - lastMention;
    if (currentChapter < 4 || absentChapters < 4) continue;
    issues.push({
      id: `health-character-${character.id}`,
      severity: absentChapters >= 7 ? "错误" : "警告",
      category: "人物",
      title: `核心人物长期离场：${character.name}`,
      description: `“${character.name}”已经连续 ${absentChapters} 章没有进入视角或章节记忆，人物目标与弧光可能停止推进。`,
      location: `第 ${currentChapter} 章`,
      resolved: false,
      chapterNumber: currentChapter,
      source: "local",
      suggestedFix: `让“${character.name}”以行动、消息、后果或他人反应重新影响当前主线，不必强行安排本人出场。`,
    });
  }

  for (const chapter of workspace.chapters) {
    const cards = chapter.chapterOutline?.sceneCards || [];
    if (!cards.length) continue;
    const incomplete = cards.filter((card) => !card.title.trim() || !card.objective.trim() || !card.conflict.trim() || !card.reveal.trim() || !card.emotionBeat.trim());
    if (!incomplete.length) continue;
    issues.push({
      id: `health-scenes-${chapter.id}`,
      severity: chapter.content.trim() ? "错误" : "警告",
      category: "情节",
      title: `第 ${chapter.number} 章场景执行卡不完整`,
      description: `${incomplete.length} 个场景缺少目标、冲突、揭示或情绪变化，正文生成与章纲验收容易出现空转。`,
      location: `第 ${chapter.number} 章章纲`,
      resolved: false,
      chapterNumber: chapter.number,
      source: "local",
      suggestedFix: "先补齐场景执行卡，再以最小改动补足正文中的行动、阻力和结果。",
    });
  }

  const lowQualityRun = drafted.filter((chapter) => chapter.quality).slice(-3);
  if (lowQualityRun.length === 3 && lowQualityRun.every((chapter) => (chapter.quality?.overall || 0) < 70)) {
    const range = `第 ${lowQualityRun[0].number}—${lowQualityRun[2].number} 章`;
    issues.push({
      id: `health-quality-plateau-${lowQualityRun[2].number}`,
      severity: "错误",
      category: "情节",
      title: "连续章节质量进入平台期",
      description: `${range}连续低于 70 分，逐章小修已经没有形成稳定改善。`,
      location: range,
      resolved: false,
      chapterNumber: lowQualityRun[2].number,
      source: "local",
      suggestedFix: "暂停重复润色，回到整书契约、章纲目标和场景执行卡重新定位共同根因，再按依赖顺序修复。",
    });
  }

  for (const chapter of drafted) {
    const errors = workspace.issues.filter((issue) => !issue.resolved && issue.severity === "错误" && issue.chapterNumber === chapter.number);
    if ((chapter.generation?.repairAttempts || 0) < MAX_AUTOMATED_REPAIR_ATTEMPTS || !errors.length) continue;
    issues.push({
      id: `health-repair-plateau-${chapter.id}`,
      severity: "错误",
      category: "情节",
      title: `第 ${chapter.number} 章自动修复已进入平台期`,
      description: `已连续自动修复 ${chapter.generation?.repairAttempts || 0} 次但仍有 ${errors.length} 项错误，继续使用同一策略可能重复改写而不解决根因。`,
      location: `第 ${chapter.number} 章`,
      resolved: false,
      chapterNumber: chapter.number,
      source: "local",
      suggestedFix: "冻结自动重试，人工确认根因或调整章纲、事实账本与修复范围后再继续。",
    });
  }

  return issues.map(withAuditConfidence);
}

export function buildRollingAuditPrompt(workspace: WorkspaceData, throughChapter: number, repairFocus: ConsistencyIssue[] = []) {
  const chapter = workspace.chapters.find((item) => item.number === throughChapter);
  if (!chapter) throw new Error(`找不到第 ${throughChapter} 章，无法进行一致性审校`);
  const previousChapter = [...workspace.chapters].sort((a, b) => a.number - b.number).find((item) => item.number === throughChapter - 1);
  return `你是长篇小说的逐章一致性审校编辑。只检查第 ${throughChapter} 章，并将它与本章之前已确定的事实、章纲和伏笔任务对比。

只输出合法 JSON：
{"issues":[{"severity":"错误|警告|提示","category":"时间线|人物|世界规则|情节|文风","title":"问题标题","description":"问题的影响","chapterNumber":${throughChapter},"evidence":"正文中的具体证据","suggestedFix":"不改变其他剧情的最小修复方案","location":"第${throughChapter}章的具体场景"}]}

必须检查：
1. 人物的位置、知情范围、伤势、目标和关系是否与前文一致。
2. 时间、地点、物件、世界规则和因果链是否冲突。
3. chapterOutline 的 objective、scenes、turningPoint 和 endingHook 是否真正完成。
4. foreshadowTasks 是否在正文中被执行，不得把尚未到回收章的伏笔判为遗漏。
5. 检查本章是否产生有效的信息增量、主角进展或代价，避免只有气氛与重复讨论。
6. 检查核心关系、人物情绪弧和已开启故事线是否至少有一项发生可验证变化。
7. 检查连续章节是否重复同一种冲突、揭示或结尾钩子，形成节奏平台期。
8. 只报告有明确文本证据的问题；没有问题返回 {"issues":[]}；最多 8 项。
9. 如果提供“本轮修复前问题”，必须逐项核对修复后的正文：仍存在就按原类别报告，确实消失则不要重复报告。

【本轮修复前问题】
${repairFocus.length ? JSON.stringify(repairFocus.map((issue) => ({ fingerprint: issue.fingerprint || consistencyIssueFingerprint(issue), title: issue.title, description: issue.description, evidence: issue.evidence, suggestedFix: issue.suggestedFix }))) : "无，本轮为常规审校"}

【作品与规则】
${JSON.stringify({ project: workspace.project, world: workspace.world, characters: workspace.characters, relationships: workspace.relationships })}

【第 ${throughChapter} 章之前的事实账本】
${JSON.stringify(canonContextBeforeChapter(workspace, throughChapter).verified)}

【上一章结尾】
${previousChapter?.content.slice(-6000) || "无"}

【本章章纲】
${JSON.stringify(chapter.chapterOutline || { summary: chapter.summary })}

【本章伏笔任务】
${JSON.stringify(foreshadowTasksForChapter(workspace, throughChapter))}

【第 ${throughChapter} 章正文】
${chapter.content.slice(-40_000)}`;
}

export function parseRollingAudit(value: string, runId: string, defaultChapterNumber?: number, chapterContent = ""): ConsistencyIssue[] {
  const payload = parseJson(value);
  const normalizedContent = chapterContent.replace(/\s+/g, "");
  return list(payload.issues).map((item) => record(item)).flatMap((item, index) => {
    const title = text(item.title);
    const description = text(item.description);
    if (!title || !description) return [];
    const requestedSeverity = ["\u9519\u8bef", "\u8b66\u544a", "\u63d0\u793a"].includes(String(item.severity)) ? item.severity as ConsistencyIssue["severity"] : "\u63d0\u793a";
    const evidence = text(item.evidence);
    const normalizedEvidence = evidence.replace(/\s+/g, "");
    const evidenceVerified = !chapterContent || (normalizedEvidence.length >= 6 && normalizedContent.includes(normalizedEvidence));
    if (requestedSeverity !== "\u63d0\u793a" && !evidenceVerified) return [];
    const chapterNumber = Number.isInteger(item.chapterNumber) ? Number(item.chapterNumber) : defaultChapterNumber;
    return [{
      id: `audit-${runId}-${Date.now()}-${index + 1}`,
      severity: requestedSeverity,
      category: ["\u65f6\u95f4\u7ebf", "\u4eba\u7269", "\u4e16\u754c\u89c4\u5219", "\u60c5\u8282", "\u6587\u98ce"].includes(String(item.category)) ? item.category as ConsistencyIssue["category"] : "\u60c5\u8282",
      title,
      description,
      location: text(item.location, chapterNumber ? `\u7b2c ${chapterNumber} \u7ae0` : "\u5168\u4e66"),
      resolved: false,
      chapterNumber,
      evidence,
      suggestedFix: text(item.suggestedFix),
      source: "ai" as const,
      confidence: evidenceVerified ? "high" as const : "low" as const,
      evidenceClass: evidenceVerified ? "quoted" as const : "subjective" as const,
      autoRepairable: evidenceVerified && requestedSeverity !== "提示",
      verificationNote: evidenceVerified ? "正文引文已通过本地逐字核对" : "仅供人工参考，未找到可核对引文",
    }];
  }).slice(0, 8);
}

export function evaluateChapterQuality(workspace: WorkspaceData, chapterNumber: number) {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter) throw new Error(`找不到第 ${chapterNumber} 章`);
  const actualLength = chapter.content.replace(/\s+/g, "").length;
  const lengthRange = chapterDraftWordRange(chapter.targetWords);
  const length = actualLength < lengthRange.minimum
    ? clamp(actualLength / Math.max(1, lengthRange.minimum) * 100, 0, 100)
    : 100;
  const outlineFields = chapter.chapterOutline ? [
    chapter.chapterOutline.objective,
    chapter.chapterOutline.opening,
    ...chapter.chapterOutline.scenes,
    chapter.chapterOutline.turningPoint,
    chapter.chapterOutline.endingHook,
  ] : [];
  const outlineEvidence = chapter.memory?.outlineEvidence || [];
  const verifiedOutline = outlineEvidence.filter((entry) => entry.verified);
  const outlineBase = outlineEvidence.length
    ? verifiedOutline.reduce((sum, entry) => sum + entry.score, 0) / outlineEvidence.length
    : outlineFields.length ? outlineFields.filter(Boolean).length / outlineFields.length * 40 : 20;
  const chapterIssues = workspace.issues.filter((issue) => !issue.resolved && issue.chapterNumber === chapterNumber);
  const outlinePenalty = chapterIssues.filter((issue) => /章纲|场景|转折|钩子|目标/.test(issue.title + issue.description)).length * 18;
  const outline = clamp(outlineBase - outlinePenalty, 0, 100);
  const errors = chapterIssues.filter((issue) => issue.severity === "错误").length;
  const warnings = chapterIssues.filter((issue) => issue.severity === "警告").length;
  const continuity = clamp(100 - errors * 30 - warnings * 12, 0, 100);
  const tasks = foreshadowTasksForChapter(workspace, chapterNumber);
  const updates = chapter.memory?.foreshadowUpdates || [];
  const matched = tasks.filter((task) => updates.some((update) => update.verified && update.title === task.title && update.status === (task.action === "plant" ? "planted" : task.action === "resolve" ? "resolved" : "advanced"))).length;
  const foreshadow = tasks.length ? clamp(matched / tasks.length * 100, 0, 100) : 100;
  const styleIssues = chapterIssues.filter((issue) => issue.category === "文风").length;
  const style = clamp(100 - styleIssues * 18, 0, 100);
  const overall = clamp(length * .2 + outline * .25 + continuity * .3 + foreshadow * .15 + style * .1, 0, 100);
  const notes = [
    ...(length < 100 ? ["\u6b63\u6587\u5c1a\u672a\u8fbe\u5230\u76ee\u6807\u5b57\u6570"] : []),
    ...(outline < 80 ? ["章纲目标、场景、转折或章末钩子需要继续落实"] : []),
    ...(continuity < 80 ? ["仍有一致性问题需要处理"] : []),
    ...(foreshadow < 100 ? ["本章伏笔任务尚未全部验证"] : []),
  ];
  return { overall, length, outline, continuity, foreshadow, style, evaluatedAt: new Date().toISOString(), notes, outlineEvidence };
}

export function buildForeshadowLedger(workspace: WorkspaceData) {
  return workspace.materials.filter((material) => material.type === "伏笔").map((material) => {
    const plan = material.foreshadowPlan || [];
    const evidence = workspace.chapters.flatMap((chapter) => (chapter.memory?.foreshadowUpdates || [])
      .filter((update) => update.title === material.title && update.verified)
      .map((update) => ({ chapterNumber: chapter.number, status: update.status, evidence: update.evidence })));
    const plannedResolve = plan.find((step) => step.action === "resolve")?.chapterNumber;
    const actualResolve = evidence.find((item) => item.status === "resolved")?.chapterNumber;
    const planted = evidence.some((item) => item.status === "planted");
    const currentChapter = workspace.automation.currentChapterNumber || Math.max(0, ...workspace.chapters.filter((item) => item.content.trim()).map((item) => item.number));
    const status = actualResolve ? "已回收" : plannedResolve && currentChapter > plannedResolve ? "已延期" : planted ? "已埋设" : "计划中";
    return { material, plan, evidence, plannedResolve, actualResolve, status };
  });
}

export function latestCharacterTracking(workspace: WorkspaceData) {
  return workspace.characters.map((character) => {
    const history = workspace.canon.characterStates.filter((state) => state.characterId === character.id || state.name === character.name).sort((a, b) => a.chapterNumber - b.chapterNumber);
    const latest = history.at(-1);
    return { character, latest, history };
  });
}

export function buildChapterQualityIssues(workspace: WorkspaceData, chapterNumber: number, runId: string): ConsistencyIssue[] {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter) return [];
  const actualLength = chapter.content.replace(/\s+/g, "").length;
  const range = chapterDraftWordRange(chapter.targetWords);
  if (actualLength >= range.minimum) return [];
  return [{
    id: `quality-${runId}-${chapterNumber}-${chapter.revision || 0}-length`,
    severity: "\u9519\u8bef",
    category: "\u60c5\u8282",
    title: "\u7ae0\u8282\u6b63\u6587\u5b57\u6570\u4e0d\u8db3",
    description: `\u672c\u7ae0\u786c\u6027\u6700\u4f4e ${range.minimum} \u5b57\uff0c\u5f53\u524d\u7ea6 ${actualLength} \u5b57\u3002\u8d85\u8fc7\u76ee\u6807\u5b57\u6570\u53ef\u4ee5\u6b63\u5e38\u9a8c\u6536\uff0c\u4f46\u4e0d\u80fd\u5c11\u4e8e\u76ee\u6807\u3002`,
    location: `\u7b2c ${chapterNumber} \u7ae0`,
    resolved: false,
    chapterNumber,
    evidence: `\u5f53\u524d\u6b63\u6587\u7ea6 ${actualLength} \u5b57`,
    suggestedFix: "\u5728\u4e0d\u6539\u53d8\u65e2\u5b9a\u5267\u60c5\u7684\u524d\u63d0\u4e0b\u8865\u8db3\u573a\u666f\u884c\u52a8\u3001\u4eba\u7269\u53cd\u5e94\u3001\u56e0\u679c\u8fc7\u6e21\u548c\u7ae0\u672b\u94a9\u5b50\u3002",
    source: "local",
  }];
}

export function buildChapterPlanDeviationIssues(workspace: WorkspaceData, chapterNumber: number, runId: string): ConsistencyIssue[] {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter?.chapterOutline || !chapter.memory) return [];
  const evidence = chapter.memory.outlineEvidence || [];
  const normalizeOutlineLabel = (value: string) => value.replace(/\s+/g, "").replace(/[，。！？；：、“”‘’（）()《》〈〉【】\[\]]/g, "").toLowerCase();
  const hasExecutedEvidence = (key: "objective" | "opening" | "scene" | "turningPoint" | "endingHook", expected: string) =>
    evidence.some((entry) => entry.key === key
      && (key !== "scene" || normalizeOutlineLabel(entry.label) === normalizeOutlineLabel(expected))
      && entry.verified && entry.status === "executed" && entry.score >= 60);
  const issues: ConsistencyIssue[] = [];
  const required = [
    { key: "objective" as const, label: "\u7ae0\u8282\u76ee\u6807", expected: chapter.chapterOutline.objective },
    { key: "opening" as const, label: "\u5f00\u573a", expected: chapter.chapterOutline.opening },
    { key: "turningPoint" as const, label: "\u6838\u5fc3\u8f6c\u6298", expected: chapter.chapterOutline.turningPoint },
    { key: "endingHook" as const, label: "\u7ae0\u672b\u94a9\u5b50", expected: chapter.chapterOutline.endingHook },
  ].filter((item) => item.expected?.trim());
  for (const item of required) {
    const executed = hasExecutedEvidence(item.key, item.expected);
    if (!executed) issues.push({
      id: `plan-${runId}-${chapterNumber}-${item.key}`, severity: "\u9519\u8bef", category: "\u60c5\u8282",
      title: `\u672c\u7ae0${item.label}\u672a\u88ab\u6b63\u6587\u8bc1\u636e\u8bc1\u660e`,
      description: `\u7ae0\u7eb2\u8981\u6c42\u201c${item.expected}\u201d\uff0c\u4f46\u7ae0\u8282\u8bb0\u5fc6\u4e2d\u6ca1\u6709\u627e\u5230\u53ef\u6838\u5bf9\u7684\u5df2\u6267\u884c\u539f\u6587\u3002`,
      location: `\u7b2c ${chapterNumber} \u7ae0`, resolved: false, chapterNumber,
      suggestedFix: `\u4ee5\u6700\u5c0f\u6539\u52a8\u8865\u8db3${item.label}\uff0c\u4e0d\u6539\u53d8\u5176\u4ed6\u5df2\u5b8c\u6210\u5267\u60c5\u3002`, source: "local",
    });
  }
  const missingScenes = chapter.chapterOutline.scenes.filter((scene) => !hasExecutedEvidence("scene", scene));
  const executedScenes = chapter.chapterOutline.scenes.length - missingScenes.length;
  if (missingScenes.length) {
    issues.push({
      id: `plan-${runId}-${chapterNumber}-scenes`, severity: "\u9519\u8bef", category: "\u60c5\u8282", title: "\u7ae0\u7eb2\u573a\u666f\u6267\u884c\u4e0d\u5b8c\u6574",
      description: `\u8ba1\u5212 ${chapter.chapterOutline.scenes.length} \u4e2a\u573a\u666f\uff0c\u53ea\u6709 ${executedScenes} \u4e2a\u573a\u666f\u627e\u5230\u5df2\u9a8c\u8bc1\u7684\u6b63\u6587\u8bc1\u636e\u3002\u7f3a\u5931\uff1a${missingScenes.map((scene, index) => `${index + 1}. ${scene}`).join("\uff1b")}`,
      location: `\u7b2c ${chapterNumber} \u7ae0`, resolved: false, chapterNumber, suggestedFix: "\u8865\u8db3\u7f3a\u5931\u573a\u666f\u7684\u884c\u52a8\u3001\u51b2\u7a81\u548c\u56e0\u679c\u8fc7\u6e21\u3002", source: "local",
    });
  }
  const foreshadowUpdates = chapter.memory.foreshadowUpdates || [];
  for (const task of foreshadowTasksForChapter(workspace, chapterNumber)) {
    const expectedStatus = task.action === "plant" ? "planted" : task.action === "resolve" ? "resolved" : "advanced";
    const executed = foreshadowUpdates.some((entry) => entry.title === task.title && entry.status === expectedStatus && entry.verified);
    if (!executed) issues.push({
      id: `plan-${runId}-${chapterNumber}-foreshadow-${task.title}`, severity: "\u9519\u8bef", category: "\u60c5\u8282", title: `\u4f0f\u7b14\u4efb\u52a1\u672a\u6267\u884c\uff1a${task.title}`,
      description: `\u672c\u7ae0\u5e94\u5bf9\u201c${task.title}\u201d\u6267\u884c ${task.action}\uff0c\u4f46\u672a\u627e\u5230\u5339\u914d\u6b63\u6587\u539f\u53e5\u3002`,
      location: `\u7b2c ${chapterNumber} \u7ae0`, resolved: false, chapterNumber, suggestedFix: task.instruction || "\u6309\u672c\u7ae0\u4f0f\u7b14\u8ba1\u5212\u505a\u6700\u5c0f\u8865\u5199\u3002", source: "local",
    });
  }
  return issues;
}

export function buildMemoryEvidenceIssues(workspace: WorkspaceData, chapterNumber: number, runId: string): ConsistencyIssue[] {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  const memory = chapter?.memory;
  if (!memory || memory.evidenceVersion !== 1) return [];
  const rejected = [
    ...(memory.timelineEvidence || []), ...(memory.threadEvidence || []), ...(memory.factEvidence || []), ...(memory.characterUpdates || []),
  ].filter((entry) => entry.verified === false).length;
  if (!rejected) return [];
  return [{
    id: `memory-evidence-${runId}-${chapterNumber}`, severity: "\u8b66\u544a", category: "\u65f6\u95f4\u7ebf", title: "\u5df2\u62e6\u622a\u65e0\u6b63\u6587\u8bc1\u636e\u7684\u7ae0\u8282\u8bb0\u5fc6",
    description: `\u6709 ${rejected} \u6761\u6a21\u578b\u63d0\u53d6\u7684\u4e8b\u5b9e\u3001\u4eba\u7269\u72b6\u6001\u6216\u7ebf\u7d22\u65e0\u6cd5\u4e0e\u6b63\u6587\u539f\u53e5\u5339\u914d\uff0c\u5df2\u963b\u6b62\u5b83\u4eec\u8fdb\u5165\u540e\u7eed\u4e8b\u5b9e\u8d26\u672c\u3002`,
    location: `\u7b2c ${chapterNumber} \u7ae0\u8bb0\u5fc6`, resolved: false, chapterNumber, suggestedFix: "\u53ef\u91cd\u5efa\u672c\u7ae0\u8bb0\u5fc6\uff0c\u6216\u4eba\u5de5\u786e\u8ba4\u6b63\u6587\u540e\u518d\u5199\u5165\u4e8b\u5b9e\u3002", source: "local",
  }];
}

export function consistencyIssueFingerprint(issue: Pick<ConsistencyIssue, "chapterNumber" | "category" | "title" | "evidence">) {
  const normalized = `${issue.chapterNumber || 0}|${issue.category}|${issue.title.replace(/^修复后新发现（待二次确认）：/, "")}|${issue.evidence || ""}`
    .toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, "").slice(0, 1200);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `issue-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function withAuditConfidence(issue: ConsistencyIssue): ConsistencyIssue {
  if (issue.confidence && issue.evidenceClass && issue.autoRepairable !== undefined) return issue;
  const evidenceClass = issue.evidenceClass || (issue.source === "local" ? "deterministic" : issue.evidence?.trim() ? "quoted" : "subjective");
  const confidence = issue.confidence || (evidenceClass === "deterministic" || evidenceClass === "quoted" ? "high" : evidenceClass === "inferred" ? "medium" : "low");
  return {
    ...issue,
    confidence,
    evidenceClass,
    autoRepairable: issue.autoRepairable ?? (confidence !== "low" && issue.severity !== "提示"),
    verificationNote: issue.verificationNote || (evidenceClass === "deterministic" ? "由本地确定性规则命中" : evidenceClass === "quoted" ? "正文引文已核对" : "需要人工判断"),
  };
}

function withIssueFingerprint(issue: ConsistencyIssue): ConsistencyIssue {
  const classified = withAuditConfidence(issue);
  return { ...classified, fingerprint: classified.fingerprint || consistencyIssueFingerprint(classified) };
}

function issueBigrams(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

function issueSimilarity(left: ConsistencyIssue, right: ConsistencyIssue) {
  if (left.category !== right.category) return 0;
  const leftEvidence = (left.evidence || "").replace(/\s+/g, "");
  const rightEvidence = (right.evidence || "").replace(/\s+/g, "");
  if (leftEvidence.length >= 6 && rightEvidence.length >= 6 && (leftEvidence.includes(rightEvidence) || rightEvidence.includes(leftEvidence))) return 1;
  const leftGrams = issueBigrams(`${left.title} ${left.description}`);
  const rightGrams = issueBigrams(`${right.title} ${right.description}`);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  return shared / Math.max(1, Math.min(leftGrams.size, rightGrams.size));
}

export function stabilizeRepairAuditIssues(previousIssues: ConsistencyIssue[], incoming: ConsistencyIssue[]) {
  const previousErrors = previousIssues.filter((issue) => issue.severity === "\u9519\u8bef");
  return incoming.map((issue) => {
    if (issue.source !== "ai" || issue.severity !== "\u9519\u8bef") return issue;
    const confirmed = previousErrors.some((previous) => issueSimilarity(previous, issue) >= 0.28);
    if (confirmed) return issue;
    return {
      ...issue,
      severity: "\u8b66\u544a" as const,
      title: `\u4fee\u590d\u540e\u65b0\u53d1\u73b0\uff08\u5f85\u4e8c\u6b21\u786e\u8ba4\uff09\uff1a${issue.title}`,
      description: `\u8be5\u95ee\u9898\u4e0d\u5728\u672c\u8f6e\u4fee\u590d\u8303\u56f4\u5185\uff0c\u4e3a\u907f\u514d AI \u5ba1\u6821\u6ce2\u52a8\u5bfc\u81f4\u65e0\u9650\u4fee\u590d\uff0c\u5148\u964d\u4e3a\u5f85\u590d\u6838\u8b66\u544a\u3002\u82e5\u4e0b\u4e00\u6b21\u72ec\u7acb\u5ba1\u6821\u4ecd\u547d\u4e2d\u540c\u4e00\u95ee\u9898\uff0c\u518d\u5347\u7ea7\u4e3a\u9519\u8bef\u3002\n${issue.description}`,
    };
  });
}

export function unresolvedChapterErrors(workspace: WorkspaceData, chapterNumber: number) {
  return workspace.issues.filter((issue) =>
    !issue.resolved && issue.severity === "错误" && issue.chapterNumber === chapterNumber
      && issue.autoRepairable !== false && issue.confidence !== "low"
  );
}

export function replaceChapterAuditIssues(
  workspace: WorkspaceData,
  chapterNumber: number,
  incoming: ConsistencyIssue[],
): WorkspaceData {
  return {
    ...workspace,
    issues: [
      ...workspace.issues.map((issue) =>
        issue.chapterNumber === chapterNumber && !issue.resolved ? { ...issue, resolved: true } : issue
      ),
      ...incoming.map(withIssueFingerprint),
    ],
  };
}

export function buildConsistencyRepairPrompt(workspace: WorkspaceData, issue: ConsistencyIssue, chapter: Chapter) {
  const wordRange = chapterDraftWordRange(chapter.targetWords);
  return `你是长篇小说修订编辑。请对第 ${chapter.number} 章做最小必要修订，只返回需要替换的局部补丁，不得重写整章。

只输出合法 JSON：
{"edits":[{"oldText":"正文中精确且唯一的原文","newText":"替换后的正文","reason":"该处如何修复指定问题"}],"outlineEvidence":[{"key":"objective|opening|scene|turningPoint|endingHook","label":"逐字复制对应章纲项目","status":"executed|partial|missing","score":0,"evidence":"执行判断","quote":"修订后正文中的连续原句"}],"changeSummary":"本次局部修改摘要"}

修订规则：
1. edits 最多 12 项，oldText 必须是原始正文中完全一致且只出现一次的连续原文。
2. 只修复指定问题，不修改无关剧情、文风、人物声音或章末钩子。
3. 不得把完整章节放入 oldText 或 newText，所有 oldText 总长度不得超过原文的 30%。
4. 不擅自增加新设定或提前泄露后续剧情。
5. 修改后整章不得少于 ${wordRange.minimum} 字，建议不超过 ${wordRange.recommendedMaximum} 字。
6. 不要输出 Markdown、完整正文或补丁之外的说明。
7. oldText 与 newText 不得相同，也不得只是空格、换行变化；必须真正改变造成问题的事实、行为、时间、地点或因果表达。
8. 如果待修复问题涉及章纲目标、开场、场景、核心转折、章末钩子或综合质量，必须同时返回完整 outlineEvidence：objective、opening、turningPoint、endingHook 各一条，章纲中的每个 scene 各一条。label 必须逐字复制对应章纲项目；quote 必须逐字复制修订后正文中真实存在的连续原句，不得概括、拼接或编造。
9. 待修复问题如果列出多项错误，必须在同一轮补丁中一起处理，不能只修第一项；“章节综合质量未达标”是其他缺口的汇总结果，优先修复其列出的具体章纲与场景缺口。

【待修复问题】
${JSON.stringify({ ...issue, fingerprint: issue.fingerprint || consistencyIssueFingerprint(issue) })}

【本章之前的事实】
${JSON.stringify(canonContextBeforeChapter(workspace, chapter.number).verified)}

【本章章纲】
${JSON.stringify(chapter.chapterOutline || { summary: chapter.summary })}

【本章伏笔任务】
${JSON.stringify(foreshadowTasksForChapter(workspace, chapter.number))}

【原始正文】
${chapter.content.slice(-80_000)}`;
}

export type ConsistencyRepairEdit = { oldText: string; newText: string; reason: string };

export function applyConsistencyRepairEdits(originalContent: string, edits: ConsistencyRepairEdit[]) {
  if (!edits.length || edits.length > 12) throw new Error("修复补丁数量必须为 1 到 12 项");
  const uniqueOldText = new Set<string>();
  let changedCharacters = 0;
  let revisedContent = originalContent;
  for (const edit of edits) {
    const oldText = edit.oldText.trim();
    const newText = edit.newText.trim();
    if (oldText.length < 6 || !newText) throw new Error("修复补丁的原文或新文无效");
    if (oldText === newText || oldText.replace(/\s+/g, "") === newText.replace(/\s+/g, "")) {
      throw new Error("修复补丁没有产生实际变化");
    }
    if (uniqueOldText.has(oldText)) throw new Error("修复补丁包含重复原文");
    uniqueOldText.add(oldText);
    const first = revisedContent.indexOf(oldText);
    const second = first < 0 ? -1 : revisedContent.indexOf(oldText, first + oldText.length);
    if (first < 0) throw new Error("修复补丁的 oldText 在原文中不存在");
    if (second >= 0) throw new Error("修复补丁的 oldText 在原文中不唯一");
    changedCharacters += oldText.length;
    revisedContent = revisedContent.slice(0, first) + newText + revisedContent.slice(first + oldText.length);
  }
  const maximumChanged = Math.max(300, Math.floor(originalContent.length * 0.3));
  if (changedCharacters > maximumChanged) throw new Error("修复范围过大，已拒绝整章重写");
  return revisedContent;
}

export function parseConsistencyRepair(value: string, originalContent?: string) {
  const payload = parseJson(value);
  const edits = list(payload.edits).filter(isJsonRecord).map((item) => ({
    oldText: text(item.oldText), newText: text(item.newText), reason: text(item.reason),
  })).filter((item) => item.oldText && item.newText);
  let revisedContent = "";
  if (edits.length) {
    if (originalContent === undefined) throw new Error("应用局部修复补丁时缺少原始正文");
    revisedContent = applyConsistencyRepairEdits(originalContent, edits);
  } else {
    if (originalContent !== undefined) throw new Error("AI 未返回 edits 局部补丁，已拒绝使用完整章节覆盖");
    revisedContent = text(payload.revisedContent);
    if (!revisedContent) throw new Error("AI 没有返回可用的局部修复补丁");
  }
  if (originalContent !== undefined && revisedContent === originalContent) throw new Error("AI 修复后的正文与原文完全相同");
  if (revisedContent.replace(/\s+/g, "").length < 300) throw new Error("AI 修订结果过短，已拒绝覆盖原章节");
  const suppliedSummary = text(payload.changeSummary, "已按一致性问题完成局部修订");
  const changeSummary = edits.length ? `${suppliedSummary}（实际应用 ${edits.length} 处局部修改）` : suppliedSummary;
  const outlineEvidence = parseOutlineExecutionEvidence(payload.outlineEvidence);
  return { revisedContent, edits, outlineEvidence, changeSummary };
}

export function validateConsistencyRepairOutlineEvidence(
  chapter: Chapter,
  issue: Pick<ConsistencyIssue, "title" | "description" | "suggestedFix">,
  repair: { revisedContent: string; outlineEvidence?: ChapterMemory["outlineEvidence"] },
) {
  const scope = `${issue.title} ${issue.description} ${issue.suggestedFix || ""}`;
  if (!/章纲|场景|开场|转折|钩子|目标|综合质量/.test(scope) || !chapter.chapterOutline) return [];
  const normalize = (value: string) => value.replace(/\s+/g, "").replace(/[，。！？；：、“”‘’（）()《》〈〉【】\[\]]/g, "").toLowerCase();
  const evidence = repair.outlineEvidence || [];
  const expected = [
    { key: "objective" as const, label: chapter.chapterOutline.objective },
    { key: "opening" as const, label: chapter.chapterOutline.opening },
    ...chapter.chapterOutline.scenes.map((label) => ({ key: "scene" as const, label })),
    { key: "turningPoint" as const, label: chapter.chapterOutline.turningPoint },
    { key: "endingHook" as const, label: chapter.chapterOutline.endingHook },
  ].filter((entry) => entry.label?.trim());
  return expected.flatMap((entry) => {
    const matched = evidence.find((candidate) => candidate.key === entry.key && normalize(candidate.label) === normalize(entry.label));
    if (!matched) return [`缺少章纲证据：${entry.label}`];
    if (matched.status !== "executed" || matched.score < 60) return [`章纲证据未标记为已执行：${entry.label}`];
    if (!verifyQuotedEvidence(repair.revisedContent, matched.quote)) return [`章纲证据 quote 无法在修订后正文中核对：${entry.label}`];
    return [];
  });
}

export function buildCharacterContinuityIssues(workspace: WorkspaceData, chapterNumber: number): ConsistencyIssue[] {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter?.memory) return [];
  const issues: ConsistencyIssue[] = [];
  for (const update of chapter.memory.characterUpdates) {
    const previous = workspace.canon.characterStates
      .filter((state) => state.name === update.name && state.chapterNumber < chapterNumber)
      .sort((left, right) => right.chapterNumber - left.chapterNumber)[0];
    if (!previous) continue;
    const currentKnowledge = new Set(update.knowledge || []);
    const forgotten = (previous.knowledge || []).filter((fact) => !currentKnowledge.has(fact));
    if (forgotten.length) {
      issues.push({
        id: `character-knowledge-${chapterNumber}-${update.name}`,
        severity: "\u9519\u8bef",
        category: "\u4eba\u7269",
        title: `${update.name}\u7684\u5df2\u77e5\u4fe1\u606f\u51fa\u73b0\u56de\u9000`,
        description: `\u4e0a\u4e00\u72b6\u6001\u5df2\u786e\u8ba4\u77e5\u9053\uff1a${forgotten.join("\uff1b")}\uff0c\u672c\u7ae0\u72b6\u6001\u672a\u4fdd\u7559\u3002`,
        location: `\u7b2c ${chapterNumber} \u7ae0`,
        resolved: false,
        chapterNumber,
        evidence: update.state,
        suggestedFix: "\u786e\u8ba4\u4eba\u7269\u662f\u5426\u771f\u7684\u5931\u5fc6\uff1b\u5426\u5219\u6062\u590d\u5df2\u77e5\u4fe1\u606f\u5e76\u4fee\u6b63\u884c\u4e3a\u3002",
        source: "local",
      });
    }
    if (previous.location && update.location && previous.location !== update.location && !/[\u5230\u8fbe\u79bb\u5f00\u8d76\u5f80\u8fd4\u56de\u8f6c\u79fb\u4e58\u5750\u6b65\u884c]/.test(update.state)) {
      issues.push({
        id: `character-location-${chapterNumber}-${update.name}`,
        severity: "\u8b66\u544a",
        category: "\u4eba\u7269",
        title: `${update.name}\u7684\u5730\u70b9\u53d8\u5316\u7f3a\u5c11\u8fc7\u6e21\u8bc1\u636e`,
        description: `\u4eba\u7269\u4ece\u201c${previous.location}\u201d\u53d8\u4e3a\u201c${update.location}\u201d\uff0c\u72b6\u6001\u6458\u8981\u4e2d\u6ca1\u6709\u660e\u786e\u79fb\u52a8\u8fc7\u7a0b\u3002`,
        location: `\u7b2c ${chapterNumber} \u7ae0`,
        resolved: false,
        chapterNumber,
        evidence: update.state,
        suggestedFix: "\u8865\u5145\u573a\u666f\u8f6c\u6362\u3001\u65f6\u95f4\u6d41\u901d\u6216\u4ea4\u901a\u8fc7\u7a0b\u3002",
        source: "local",
      });
    }
  }
  return issues;
}

export interface RepairQueueGroup {
  chapterNumber: number;
  issues: ConsistencyIssue[];
  dependsOn: number[];
  affectedChapters: number[];
}

function repairIssueTokens(issue: ConsistencyIssue) {
  return new Set(`${issue.title} ${issue.description}`.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
}

export function buildRepairDependencyQueue(workspace: WorkspaceData): RepairQueueGroup[] {
  const grouped = new Map<number, ConsistencyIssue[]>();
  for (const issue of workspace.issues) {
    if (issue.resolved || issue.severity !== "\u9519\u8bef" || !issue.chapterNumber) continue;
    grouped.set(issue.chapterNumber, [...(grouped.get(issue.chapterNumber) || []), issue]);
  }
  const groups = [...grouped.entries()].sort((left, right) => left[0] - right[0]).map(([chapterNumber, issues]) => ({ chapterNumber, issues, dependsOn: [] as number[], affectedChapters: [] as number[] }));
  for (let index = 0; index < groups.length; index += 1) {
    const current = groups[index];
    const currentTokens = new Set(current.issues.flatMap((issue) => [...repairIssueTokens(issue)]));
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      const prior = groups[priorIndex];
      const sameCategory = current.issues.some((issue) => prior.issues.some((candidate) => candidate.category === issue.category));
      const sharedToken = prior.issues.some((issue) => [...repairIssueTokens(issue)].some((token) => currentTokens.has(token)));
      if (sameCategory && sharedToken) {
        current.dependsOn.push(prior.chapterNumber);
        prior.affectedChapters.push(current.chapterNumber);
      }
    }
  }
  return groups;
}
