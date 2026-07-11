import type {
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
    foreshadows: workspace.materials.filter((item) => item.type === "伏笔"),
    unresolvedIssues: workspace.issues.filter((item) => !item.resolved),
    canon: workspace.canon,
  };

  return `你是正在连续创作同一部长篇小说的中文作家。请完成第 ${target.number} 章《${target.title}》正文的第 ${segment.index + 1}/${segment.total} 段。

硬性要求：
1. 本次目标约 ${segmentTarget} 个中文字符，允许上下浮动 20%；完整章节目标约 ${target.targetWords} 字。
2. 严格使用“${target.pov || workspace.project.pointOfView}”视角，延续前文事实、时态、语气与人物动机。
3. 必须落实本章梗概中的事件、选择、代价与转折，不能用总结代替场景。
4. ${isFirstSegment ? "这是本章第一段：自然承接上一章并迅速进入场景。" : "这是本章续写段：必须紧接 existingDraftEnding，不得重写或概述已经写过的内容。"}
5. ${isLastSegment ? "这是本章最后一段：完成本章转折，并形成下一章需要回应的钩子。" : "这不是本章最后一段：推进冲突，但不要提前完成本章转折或写章节收束。"}
6. 不得擅自改名，不得推翻世界规则，不得把尚未发生的后续梗概提前写成既定事实。
7. ${isFinal && isLastSegment ? "这是全书最后一章的最后一段：必须解决核心冲突、完成人物弧光、回收主要伏笔，并给出有余韵但明确的结局。" : "不要提前结束全书。"}
8. 只输出本段新增小说正文，不要重复已有正文，不要标题、提纲、创作说明或 Markdown。

【全书与相邻章节上下文】
${JSON.stringify(compactContext, null, 2)}`;
}

export function buildChapterMemoryPrompt(workspace: WorkspaceData, chapter: Chapter) {
  return `你是长篇小说的连续性记录员。请从刚完成的章节正文中提取可供后续章节继承的事实记忆。

只输出合法 JSON，不要 Markdown，不要解释。结构如下：
{
  "summary": "300—600字的本章因果摘要",
  "timelineEvents": ["按发生顺序记录的事件"],
  "characterUpdates": [{"name":"人物姓名","state":"本章结束时的位置、身体、情绪、已知信息、目标或关系变化"}],
  "openedThreads": ["本章新出现且尚未解决的线索或承诺"],
  "resolvedThreads": ["本章明确解决或回收的线索"],
  "establishedFacts": ["后文不可随意推翻的明确事实"]
}

要求：只记录正文能够支持的内容；不要推测未来；人物姓名必须沿用现有人物档案；每个数组最多 20 条。

【作品】
${JSON.stringify(workspace.project)}

【人物档案】
${JSON.stringify(workspace.characters.map((item) => ({ name: item.name, identity: item.identity, goal: item.goal, conflict: item.conflict })))}

【已有事实账本】
${JSON.stringify(workspace.canon)}

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
      return name && state ? [{ name, state }] : [];
    }).slice(0, 20),
    openedThreads: list(payload.openedThreads).map((item) => text(item)).filter(Boolean).slice(0, 20),
    resolvedThreads: list(payload.resolvedThreads).map((item) => text(item)).filter(Boolean).slice(0, 20),
    establishedFacts: list(payload.establishedFacts).map((item) => text(item)).filter(Boolean).slice(0, 30),
  };
}

export function applyChapterMemory(
  workspace: WorkspaceData,
  chapterId: string,
  memory: ChapterMemory,
): WorkspaceData {
  const chapter = workspace.chapters.find((item) => item.id === chapterId);
  if (!chapter) return workspace;
  const chapterNumber = chapter.number;
  const nextRevision = workspace.canon.revision + 1;
  const characterIds = new Map(workspace.characters.map((item) => [item.name, item.id]));
  const previousSummaries = workspace.canon.chapterSummaries.filter((item) => item.chapterId !== chapterId);
  const updatedNames = new Set(memory.characterUpdates.map((item) => item.name));
  const previousCharacterStates = workspace.canon.characterStates.filter((item) => !updatedNames.has(item.name));
  const resolvedTitles = new Set(memory.resolvedThreads);
  const updatedThreads = workspace.canon.threads.map((item) => resolvedTitles.has(item.title) ? {
    ...item,
    status: "resolved" as const,
    resolvedChapter: chapterNumber,
  } : item);
  const knownThreadTitles = new Set(updatedThreads.map((item) => item.title));
  const canon: CanonLedger = {
    ...workspace.canon,
    revision: nextRevision,
    chapterSummaries: [...previousSummaries, { chapterId, chapterNumber, summary: memory.summary }]
      .sort((a, b) => a.chapterNumber - b.chapterNumber),
    timeline: [...workspace.canon.timeline, ...memory.timelineEvents.map((event, index) => ({
      id: `timeline-${nextRevision}-${chapterNumber}-${index + 1}`,
      chapterNumber,
      event,
    }))],
    characterStates: [...previousCharacterStates, ...memory.characterUpdates.map((item) => ({
      characterId: characterIds.get(item.name),
      name: item.name,
      state: item.state,
      chapterNumber,
    }))],
    threads: [...updatedThreads, ...memory.openedThreads.filter((title) => !knownThreadTitles.has(title)).map((title, index) => ({
      id: `thread-${nextRevision}-${chapterNumber}-${index + 1}`,
      title,
      status: "open" as const,
      openedChapter: chapterNumber,
    }))],
    facts: [...workspace.canon.facts, ...memory.establishedFacts.map((fact, index) => ({
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
  return `你是长篇小说连续性审校编辑。请依据事实账本和已经完成的章节摘要，找出有文本证据支持的冲突或遗漏。

只输出合法 JSON：
{"issues":[{"severity":"错误|警告|提示","category":"时间线|人物|世界规则|情节|文风","title":"问题标题","description":"证据与修复建议","location":"章节位置"}]}

要求：最多 12 项；不要把有意伏笔误判为错误；不要虚构正文中不存在的问题；若没有问题返回 {"issues":[]}。

【作品设定】
${JSON.stringify(workspace.project)}

【事实账本】
${JSON.stringify(workspace.canon)}

【已完成章节摘要（截至第 ${throughChapter} 章）】
${JSON.stringify(workspace.canon.chapterSummaries.filter((item) => item.chapterNumber <= throughChapter))}`;
}

export function parseRollingAudit(value: string, runId: string): ConsistencyIssue[] {
  const payload = parseJson(value);
  return list(payload.issues).map((item) => record(item)).flatMap((item, index) => {
    const title = text(item.title);
    const description = text(item.description);
    if (!title || !description) return [];
    return [{
      id: `audit-${runId}-${Date.now()}-${index + 1}`,
      severity: ["错误", "警告", "提示"].includes(String(item.severity)) ? item.severity as ConsistencyIssue["severity"] : "提示",
      category: ["时间线", "人物", "世界规则", "情节", "文风"].includes(String(item.category)) ? item.category as ConsistencyIssue["category"] : "情节",
      title,
      description,
      location: text(item.location, "全书"),
      resolved: false,
    }];
  }).slice(0, 12);
}
