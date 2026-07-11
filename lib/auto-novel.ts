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

export function resolveWritingRange(workspace: WorkspaceData): WritingRange {
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

export function estimateWritingRange(workspace: WorkspaceData): WritingRangeEstimate {
  const range = resolveWritingRange(workspace);
  const ordered = [...workspace.chapters].sort((a, b) => a.number - b.number);
  const chapters = ordered.filter((chapter) => chapter.number >= range.fromChapter && chapter.number <= range.toChapter);
  const pendingChapters = chapters.filter((chapter) => !workspace.automation.generatedChapterIds.includes(chapter.id));
  const remainingSegments = pendingChapters.reduce((total, chapter) => {
    const segments = Math.max(1, Math.ceil(chapter.targetWords / 2200));
    return total + Math.max(0, segments - Math.min(segments, chapter.generation?.completedSegments || 0));
  }, 0);
  const workflowRequests = pendingChapters.reduce((total, chapter) => {
    const segments = Math.max(1, Math.ceil(chapter.targetWords / 2200));
    const completedSegments = Math.min(segments, chapter.generation?.completedSegments || 0);
    if (completedSegments < segments) return total + 2;
    if (!chapter.memory) return total + 2;
    const blocking = workspace.issues.some((issue) => !issue.resolved && issue.severity === "错误" && issue.chapterNumber === chapter.number);
    if (chapter.generation?.status === "audited" && blocking) {
      return total + ((chapter.generation.repairAttempts || 0) < 1 ? 3 : 0);
    }
    return total + 1;
  }, 0);
  const minimumRequests = remainingSegments + workflowRequests;
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
      generation: undefined,
    } : chapter),
    issues: previousRunId
      ? workspace.issues.filter((issue) => !issue.id.startsWith(`audit-${previousRunId}-`))
      : workspace.issues,
    versions: [...snapshots, ...workspace.versions],
    canon: {
      ...workspace.canon,
      revision: workspace.canon.revision + 1,
      chapterSummaries: workspace.canon.chapterSummaries.filter((item) => item.chapterNumber < chapterNumber),
      timeline: workspace.canon.timeline.filter((item) => item.chapterNumber < chapterNumber),
      characterStates: workspace.canon.characterStates.filter((item) => item.chapterNumber < chapterNumber),
      facts: workspace.canon.facts.filter((item) => item.chapterNumber < chapterNumber),
      threads: workspace.canon.threads
        .filter((item) => item.openedChapter < chapterNumber)
        .map((item) => item.resolvedChapter !== undefined && item.resolvedChapter >= chapterNumber ? {
          ...item,
          status: "open" as const,
          resolvedChapter: undefined,
        } : item),
      lastAuditedChapter: Math.min(workspace.canon.lastAuditedChapter, Math.max(0, chapterNumber - 1)),
    },
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

export function buildBlueprintPrompt(
  seed: StorySeed,
  settings: Pick<NovelAutomation, "targetChapters" | "targetWords" | "chapterWords">,
) {
  return `你是资深中文长篇小说总策划。请把选定方向扩展成可以逐章直接写作的完整全书蓝图。

【选定方向】
书名：${seed.title}
类型：${seed.genre}
钩子：${seed.hook}
故事前提：${seed.premise}
主题：${seed.theme}
主角：${seed.protagonist}
核心冲突：${seed.centralConflict}
结局方向：${seed.endingTone}

【硬性规模】
- 恰好 ${settings.targetChapters} 章
- 全书目标约 ${settings.targetWords} 字
- 每章目标约 ${settings.chapterWords} 字

只输出合法 JSON，不要 Markdown，不要解释。结构如下：
{
  "project": {
    "title": "书名",
    "genre": "题材",
    "status": "筹备中",
    "premise": "一句话梗概",
    "theme": "主题",
    "writingStyle": "文风约束",
    "pointOfView": "叙事视角"
  },
  "characters": [
    {"name":"姓名","role":"角色定位","age":"年龄","identity":"身份","goal":"外在目标","conflict":"内在冲突","arc":"人物弧光","traits":["标签"]}
  ],
  "world": [
    {"category":"地点|势力|规则|历史|物件","title":"名称","summary":"摘要","details":"可执行细节与限制"}
  ],
  "relationships": [
    {"from":"人物姓名","to":"人物姓名","label":"关系","tone":"正向|复杂|对立|未知","description":"张力与变化"}
  ],
  "outline": [
    {"act":"幕/阶段","title":"关键节点","summary":"事件、选择、代价和变化","chapterStart":1,"chapterEnd":4}
  ],
  "chapters": [
    {"number":1,"title":"章名","summary":"本章必须发生的事件、人物选择、转折、结尾钩子","pov":"视角人物","outlineIndex":0}
  ],
  "foreshadows": [
    {"title":"伏笔名称","content":"埋设与回收计划","tags":["第1章","第8章","待回收"]}
  ]
}

质量要求：人物 5—8 个；世界观 5—10 条；大纲节点 4—8 个；chapters 必须恰好 ${settings.targetChapters} 条且 number 从 1 连续递增。每章 summary 必须具体说明新信息、选择、代价、转折和结尾钩子，不能只写“承上启下”。最后一章要完成核心冲突和人物弧光。`;
}

export type BlueprintStagePayload = Record<string, unknown>;
export type BlueprintStageName = "characters" | "world" | "outline" | "foreshadows" | "chapters";

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
    const scenes = list(chapter.scenes).map((scene) => text(scene)).filter(Boolean);
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
  "project":{"title":"书名","genre":"题材","status":"筹备中","premise":"一句话梗概","theme":"主题","writingStyle":"文风约束","pointOfView":"叙事视角"},
  "characters":[{"name":"姓名","role":"角色定位","age":"年龄","identity":"身份","goal":"外在目标","conflict":"内在冲突","arc":"人物弧光","traits":["标签"]}],
  "relationships":[{"from":"人物姓名","to":"人物姓名","label":"关系","tone":"正向|复杂|对立|未知","description":"张力与变化"}]
}

要求：人物 5—8 个；姓名唯一；目标、冲突和人物弧光必须能推动主线；关系只能引用 characters 中存在的姓名。

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
{"chapters":[{"number":1,"title":"章名","summary":"本章因果摘要","pov":"视角人物","outlineIndex":0,"objective":"本章必须完成的剧情目标","opening":"开场场景与即时张力","scenes":["场景1：地点、行动、冲突与结果","场景2：…","场景3：…"],"turningPoint":"不可逆转折或代价","endingHook":"下一章必须回应的问题","foreshadowActions":[{"title":"必须与伏笔表同名","action":"plant|advance|resolve","instruction":"本章的具体执行方式"}]}]}

硬性要求：
1. chapters 必须恰好 ${settings.targetChapters} 条，number 从 1 到 ${settings.targetChapters} 连续递增。
2. 每章目标约 ${settings.chapterWords} 字；summary 必须具体，不能写“承上启下”。
3. outlineIndex 从 0 开始，必须对应提供的大纲节点。
4. 相邻章节形成清晰因果；每章都产生新信息、选择或不可逆代价。
5. 每章必须提供 objective、opening、3—8 个 scenes、turningPoint 和 endingHook，形成可直接写作的章纲。
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
        scenes: list(source.scenes).map((scene) => text(scene)).filter(Boolean).slice(0, 8),
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

  return {
    ...full,
    chapterSummaries: full.chapterSummaries.slice(-16),
    timeline: select(full.timeline, (item) => item.chapterNumber, (item) => item.event, 40, 20),
    characterStates: latestCharacterStates,
    threads: [...openThreads, ...recentResolvedThreads].slice(-100),
    facts: select(full.facts, (item) => item.chapterNumber, (item) => item.fact, 60, 30),
  };
}

export function foreshadowTasksForChapter(workspace: WorkspaceData, chapterNumber: number) {
  const fromMaterials = workspace.materials
    .filter((material) => material.type === "伏笔")
    .flatMap((material) => (material.foreshadowPlan || [])
      .filter((step) => step.chapterNumber === chapterNumber)
      .map((step) => ({ title: material.title, content: material.content, action: step.action, instruction: step.instruction })));
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  const known = new Set(fromMaterials.map((item) => `${item.title} ${item.action}`));
  const fromOutline = (chapter?.chapterOutline?.foreshadowActions || []).flatMap((action) => {
    const key = `${action.title} ${action.action}`;
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
      threads: workspace.canon.threads
        .filter((item) => item.openedChapter !== chapterNumber)
        .map((item) => item.resolvedChapter === chapterNumber ? { ...item, status: "open" as const, resolvedChapter: undefined } : item),
      lastAuditedChapter: Math.min(workspace.canon.lastAuditedChapter, Math.max(0, chapterNumber - 1)),
    },
  };
}

export function buildAutomatedChapterPrompt(
  workspace: WorkspaceData,
  target: Chapter,
  segment: { index: number; total: number; existingDraft: string },
) {
  const chapters = [...workspace.chapters].sort((a, b) => a.number - b.number);
  const index = chapters.findIndex((item) => item.id === target.id);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  const outlineBeat = workspace.outline.find((item) => item.id === target.outlineBeatId);
  const isFinal = index === chapters.length - 1;
  const isFirstSegment = segment.index === 0;
  const isLastSegment = segment.index === segment.total - 1;
  const segmentTarget = Math.ceil(target.targetWords / segment.total);
  const compactContext = {
    project: workspace.project,
    characters: workspace.characters,
    world: workspace.world,
    relationships: workspace.relationships.map((relation) => ({
      from: workspace.characters.find((item) => item.id === relation.fromId)?.name,
      to: workspace.characters.find((item) => item.id === relation.toId)?.name,
      label: relation.label,
      tone: relation.tone,
      description: relation.description,
    })),
    outlineBeat,
    chapterOutline: target.chapterOutline,
    foreshadowTasks: foreshadowTasksForChapter(workspace, target.number),
    currentChapter: {
      number: target.number,
      title: target.title,
      summary: target.summary,
      pov: target.pov,
      targetWords: target.targetWords,
      segment: `${segment.index + 1}/${segment.total}`,
      existingDraftEnding: segment.existingDraft.slice(-5000),
    },
    previousChapter: previous ? {
      number: previous.number,
      title: previous.title,
      summary: previous.summary,
      ending: previous.content.slice(-6000),
    } : null,
    nextChapter: next ? {
      number: next.number,
      title: next.title,
      summary: next.summary,
    } : null,
    unresolvedIssues: workspace.issues.filter((item) => !item.resolved && (!item.chapterNumber || item.chapterNumber <= target.number)),
    canon: compactCanonBeforeChapter(workspace, target.number),
  };

  return `你是正在连续创作同一部长篇小说的中文作家。请完成第 ${target.number} 章《${target.title}》正文的第 ${segment.index + 1}/${segment.total} 段。

硬性要求：
1. 本次目标约 ${segmentTarget} 个中文字符，允许上下浮动 20%；完整章节目标约 ${target.targetWords} 字。
2. 严格使用“${target.pov || workspace.project.pointOfView}”视角，延续前文事实、时态、语气与人物动机。
3. 必须逐项落实 chapterOutline 的 objective、scenes、turningPoint 和 endingHook，不能用总结代替场景。
4. ${isFirstSegment ? "这是本章第一段：自然承接上一章并迅速进入场景。" : "这是本章续写段：必须紧接 existingDraftEnding，不得重写或概述已经写过的内容。"}
5. ${isLastSegment ? "这是本章最后一段：完成本章转折，并形成下一章需要回应的钩子。" : "这不是本章最后一段：推进冲突，但不要提前完成本章转折或写章节收束。"}
6. 不得擅自改名，不得推翻世界规则，不得把尚未发生的后续梗概提前写成既定事实。
7. ${isFinal && isLastSegment ? "这是全书最后一章的最后一段：必须解决核心冲突、完成人物弧光、回收主要伏笔，并给出有余韵但明确的结局。" : "不要提前结束全书。"}
8. foreshadowTasks 中的 plant/advance/resolve 任务必须在本章以可被读者感知、但不生硬说明的方式执行。
9. 只输出本段新增小说正文，不要重复已有正文，不要标题、提纲、创作说明或 Markdown。

【全书与相邻章节上下文】
${JSON.stringify(compactContext, null, 2)}`;
}

export function buildChapterMemoryPrompt(workspace: WorkspaceData, chapter: Chapter) {
  return `你是长篇小说的连续性记录员。请从刚完成的章节正文中提取可供后续章节继承的事实记忆。

只输出合法 JSON，不要 Markdown，不要解释。结构如下：
{
  "summary": "300—600字的本章因果摘要",
  "timelineEvents": ["按发生顺序记录的事件"],
  "characterUpdates": [{"name":"人物姓名","state":"本章结束综合状态","location":"所在地点","physical":"身体状态","emotion":"情绪","knowledge":["已经确认知道的信息"],"inventory":["持有的重要物品"],"goal":"当前目标"}],
  "openedThreads": ["本章新出现且尚未解决的线索或承诺"],
  "resolvedThreads": ["本章明确解决或回收的线索"],
  "establishedFacts": ["后文不可随意推翻的明确事实"],
  "outlineEvidence": [{"key":"objective|opening|scene|turningPoint|endingHook","label":"对应章纲项目","status":"executed|partial|missing","score":0,"evidence":"执行判断","quote":"正文中的连续原文引用"}],
  "foreshadowUpdates": [{"title":"伏笔名称","status":"planted|advanced|resolved","evidence":"如何执行","quote":"正文中的连续原文引用"}]
}

要求：只记录正文能够支持的内容；不要推测未来；人物姓名必须沿用现有人物档案；每个数组最多 20 条。

【作品】
${JSON.stringify(workspace.project)}

【人物档案】
${JSON.stringify(workspace.characters.map((item) => ({ name: item.name, identity: item.identity, goal: item.goal, conflict: item.conflict })))}

【本章之前的事实账本】
${JSON.stringify(compactCanonBeforeChapter(workspace, chapter.number))}

【本章应执行的伏笔任务】
${JSON.stringify(foreshadowTasksForChapter(workspace, chapter.number))}

【第 ${chapter.number} 章《${chapter.title}》正文】
${chapter.content.slice(-30_000)}`;
}

export function parseChapterMemory(value: string): ChapterMemory {
  const payload = parseJson(value);
  const summary = text(payload.summary);
  if (!summary) throw new Error("章节记忆缺少有效摘要");
  return {
    summary,
    timelineEvents: list(payload.timelineEvents).map((item) => text(item)).filter(Boolean).slice(0, 20),
    characterUpdates: list(payload.characterUpdates).map((item) => record(item)).flatMap((item) => {
      const name = text(item.name);
      const state = text(item.state);
      return name && state ? [{
        name,
        state,
        location: text(item.location) || undefined,
        physical: text(item.physical) || undefined,
        emotion: text(item.emotion) || undefined,
        knowledge: list(item.knowledge).map((entry) => text(entry)).filter(Boolean).slice(0, 100),
        inventory: list(item.inventory).map((entry) => text(entry)).filter(Boolean).slice(0, 100),
        goal: text(item.goal) || undefined,
      }] : [];
    }).slice(0, 20),
    openedThreads: list(payload.openedThreads).map((item) => text(item)).filter(Boolean).slice(0, 20),
    resolvedThreads: list(payload.resolvedThreads).map((item) => text(item)).filter(Boolean).slice(0, 20),
    establishedFacts: list(payload.establishedFacts).map((item) => text(item)).filter(Boolean).slice(0, 30),
    outlineEvidence: list(payload.outlineEvidence).filter(isJsonRecord).flatMap((item) => {
      const label = text(item.label);
      if (!label) return [];
      const key = ["objective", "opening", "scene", "turningPoint", "endingHook"].includes(text(item.key))
        ? text(item.key) as "objective" | "opening" | "scene" | "turningPoint" | "endingHook"
        : "scene";
      const status = ["executed", "partial", "missing"].includes(text(item.status))
        ? text(item.status) as "executed" | "partial" | "missing"
        : "missing";
      return [{ key, label, status, score: clamp(Number(item.score) || 0, 0, 100), evidence: text(item.evidence), quote: text(item.quote), verified: false }];
    }).slice(0, 50),
    foreshadowUpdates: list(payload.foreshadowUpdates).filter(isJsonRecord).flatMap((item) => {
      const title = text(item.title);
      if (!title) return [];
      return [{
        title,
        status: ["planted", "advanced", "resolved"].includes(text(item.status)) ? text(item.status) as "planted" | "advanced" | "resolved" : "advanced",
        evidence: text(item.evidence),
        quote: text(item.quote),
        verified: false,
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
  const verifiedMemory: ChapterMemory = {
    ...memory,
    outlineEvidence: (memory.outlineEvidence || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) })),
    foreshadowUpdates: (memory.foreshadowUpdates || []).map((entry) => ({ ...entry, verified: verifyQuotedEvidence(chapter.content, entry.quote) })),
  };
  memory = verifiedMemory;
  const nextRevision = workspace.canon.revision + 1;
  const characterIds = new Map(workspace.characters.map((item) => [item.name, item.id]));
  const previousSummaries = workspace.canon.chapterSummaries.filter((item) => item.chapterId !== chapterId);
  const updatedNames = new Set(memory.characterUpdates.map((item) => item.name));
  const previousCharacterStates = workspace.canon.characterStates.filter((item) => !(item.chapterNumber === chapterNumber && updatedNames.has(item.name)));
  const foreshadowUpdates = memory.foreshadowUpdates || [];
  const resolvedTitles = new Set([...memory.resolvedThreads, ...foreshadowUpdates.filter((item) => item.status === "resolved").map((item) => item.title)]);
  const updatedThreads = workspace.canon.threads.map((item) => resolvedTitles.has(item.title) ? {
    ...item,
    status: "resolved" as const,
    resolvedChapter: chapterNumber,
  } : item);
  const knownThreadTitles = new Set(updatedThreads.map((item) => item.title));
  const openedThreadTitles = [...memory.openedThreads, ...foreshadowUpdates.filter((item) => item.status !== "resolved").map((item) => item.title)];
  const canon: CanonLedger = {
    ...workspace.canon,
    revision: nextRevision,
    chapterSummaries: [...previousSummaries, { chapterId, chapterNumber, summary: memory.summary }]
      .sort((a, b) => a.chapterNumber - b.chapterNumber),
    timeline: [...workspace.canon.timeline.filter((item) => item.chapterNumber !== chapterNumber), ...memory.timelineEvents.map((event, index) => ({
      id: `timeline-${nextRevision}-${chapterNumber}-${index + 1}`,
      chapterNumber,
      event,
    }))],
    characterStates: [...previousCharacterStates, ...memory.characterUpdates.map((item) => ({
      characterId: characterIds.get(item.name),
      name: item.name,
      state: item.state,
      chapterNumber,
      location: item.location,
      physical: item.physical,
      emotion: item.emotion,
      knowledge: item.knowledge,
      inventory: item.inventory,
      goal: item.goal,
    }))],
    threads: [...updatedThreads, ...openedThreadTitles.filter((title) => !knownThreadTitles.has(title)).map((title, index) => ({
      id: `thread-${nextRevision}-${chapterNumber}-${index + 1}`,
      title,
      status: "open" as const,
      openedChapter: chapterNumber,
    }))],
    facts: [...workspace.canon.facts.filter((item) => item.chapterNumber !== chapterNumber), ...memory.establishedFacts.map((fact, index) => ({
      id: `fact-${nextRevision}-${chapterNumber}-${index + 1}`,
      chapterNumber,
      fact,
    }))],
  };
  return {
    ...workspace,
    chapters: workspace.chapters.map((item) => item.id === chapterId ? {
      ...item,
      memory,
      revision: (item.revision || 0) + 1,
      generation: item.generation ? { ...item.generation, status: "generated" } : item.generation,
    } : item),
    canon,
  };
}

export function buildRollingAuditPrompt(workspace: WorkspaceData, throughChapter: number) {
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
5. 只报告有明确文本证据的问题；没有问题返回 {"issues":[]}；最多 8 项。

【作品与规则】
${JSON.stringify({ project: workspace.project, world: workspace.world, characters: workspace.characters, relationships: workspace.relationships })}

【第 ${throughChapter} 章之前的事实账本】
${JSON.stringify(compactCanonBeforeChapter(workspace, throughChapter))}

【上一章结尾】
${previousChapter?.content.slice(-6000) || "无"}

【本章章纲】
${JSON.stringify(chapter.chapterOutline || { summary: chapter.summary })}

【本章伏笔任务】
${JSON.stringify(foreshadowTasksForChapter(workspace, throughChapter))}

【第 ${throughChapter} 章正文】
${chapter.content.slice(-40_000)}`;
}

export function parseRollingAudit(value: string, runId: string, defaultChapterNumber?: number): ConsistencyIssue[] {
  const payload = parseJson(value);
  return list(payload.issues).map((item) => record(item)).flatMap((item, index) => {
    const title = text(item.title);
    const description = text(item.description);
    if (!title || !description) return [];
    const chapterNumber = Number.isInteger(item.chapterNumber) ? Number(item.chapterNumber) : defaultChapterNumber;
    return [{
      id: `audit-${runId}-${Date.now()}-${index + 1}`,
      severity: ["错误", "警告", "提示"].includes(String(item.severity)) ? item.severity as ConsistencyIssue["severity"] : "提示",
      category: ["时间线", "人物", "世界规则", "情节", "文风"].includes(String(item.category)) ? item.category as ConsistencyIssue["category"] : "情节",
      title,
      description,
      location: text(item.location, chapterNumber ? `第 ${chapterNumber} 章` : "全书"),
      resolved: false,
      chapterNumber,
      evidence: text(item.evidence),
      suggestedFix: text(item.suggestedFix),
      source: "ai" as const,
    }];
  }).slice(0, 8);
}

export function evaluateChapterQuality(workspace: WorkspaceData, chapterNumber: number) {
  const chapter = workspace.chapters.find((item) => item.number === chapterNumber);
  if (!chapter) throw new Error(`找不到第 ${chapterNumber} 章`);
  const lengthRatio = chapter.content.replace(/\s+/g, "").length / Math.max(1, chapter.targetWords);
  const length = clamp(lengthRatio * 100, 0, 100);
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
    ...(length < 70 ? ["正文长度尚未达到 70% 验收线"] : []),
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
  const minimumLength = Math.max(300, Math.floor(chapter.targetWords * 0.7));
  if (actualLength >= minimumLength) return [];
  return [{
    id: `quality-${runId}-${chapterNumber}-${chapter.revision || 0}-length`,
    severity: "错误",
    category: "情节",
    title: "章节正文长度未达到验收线",
    description: `本章目标 ${chapter.targetWords} 字，当前约 ${actualLength} 字；低于自动验收线 ${minimumLength} 字，可能存在情节、场景或转折未充分展开。`,
    location: `第 ${chapterNumber} 章`,
    resolved: false,
    chapterNumber,
    evidence: `当前正文约 ${actualLength} 字`,
    suggestedFix: "在不改变既定剧情的前提下补足场景行动、人物反应、因果过渡和章末钩子，再重新审校。",
    source: "local",
  }];
}

export function unresolvedChapterErrors(workspace: WorkspaceData, chapterNumber: number) {
  return workspace.issues.filter((issue) =>
    !issue.resolved && issue.severity === "错误" && issue.chapterNumber === chapterNumber
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
      ...incoming,
    ],
  };
}

export function buildConsistencyRepairPrompt(workspace: WorkspaceData, issue: ConsistencyIssue, chapter: Chapter) {
  return `你是长篇小说修订编辑。请对第 ${chapter.number} 章做最小必要修订，解决指定一致性问题，不得改写无关剧情、文风、人物声音或章末钩子。

只输出合法 JSON：
{"revisedContent":"修订后的完整章节正文","changeSummary":"修改了什么以及为什么"}

修订规则：
1. 必须保留完整章节，不能只输出差异片段。
2. 只修复指定问题，不擅自增加新设定或提前泄露后续剧情。
3. 继续完成本章章纲和伏笔任务。
4. revisedContent 不要包含 Markdown 代码块或修订说明。

【待修复问题】
${JSON.stringify(issue)}

【本章之前的事实】
${JSON.stringify(compactCanonBeforeChapter(workspace, chapter.number))}

【本章章纲】
${JSON.stringify(chapter.chapterOutline || { summary: chapter.summary })}

【本章伏笔任务】
${JSON.stringify(foreshadowTasksForChapter(workspace, chapter.number))}

【原始正文】
${chapter.content.slice(-80_000)}`;
}

export function parseConsistencyRepair(value: string) {
  const payload = parseJson(value);
  const revisedContent = text(payload.revisedContent);
  if (revisedContent.replace(/\s+/g, "").length < 300) throw new Error("AI 修订结果过短，已拒绝覆盖原章节");
  return { revisedContent, changeSummary: text(payload.changeSummary, "已按一致性问题完成最小修订") };
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
