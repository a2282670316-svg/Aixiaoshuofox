import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomatedChapterPrompt,
  applyConsistencyRepairEdits,
  chapterDraftWordRange,
  buildCharacterContinuityIssues,
  buildRepairDependencyQueue,
  buildBlueprintChaptersPrompt,
  buildChapterQualityIssues,
  buildChapterPlanDeviationIssues,
  buildMemoryEvidenceIssues,
  chapterSegmentObligations,
  applyChapterMemory,
  canonBeforeChapter,
  cancelAutomationRun,
  canonContextBeforeChapter,
  compactCanonBeforeChapter,
  consistencyIssueFingerprint,
  foreshadowTasksForChapter,
  createAutomationState,
  detectAIStage,
  estimateWritingRange,
  evaluateChapterQuality,
  buildForeshadowLedger,
  latestCharacterTracking,
  parseChapterMemory,
  parseBlueprintStage,
  parseNovelBlueprint,
  parseConsistencyRepair,
  parseRollingAudit,
  parseSeedOptions,
  reserveModelRequest,
  removeChapterFromCanon,
  replaceChapterAuditIssues,
  restartBlueprintDraft,
  stabilizeRepairAuditIssues,
  unresolvedChapterErrors,
  rewindNovelFromChapter,
  validateGeneratedChapterDraft,
  validateGeneratedChapterSegment,
} from "../lib/auto-novel";
import type { StorySeed, WorkspaceData } from "../lib/types";
import { DEMO_WORKSPACE } from "../lib/demo-data";
import { mergeAutomationWorkspace, normalizeWorkspaceData, pruneWorkspaceHistory } from "../lib/workspace";
import { normalizeAIEndpoint } from "../lib/ai-endpoint";
import { reconcileInterruptedTasks, recoverWorkspaceFromStep } from "../lib/workspace-recovery";

test("accepts public HTTP model endpoints and non-default ports", () => {
  assert.equal(
    normalizeAIEndpoint("http://models.example.com:8080/v1"),
    "http://models.example.com:8080/v1/chat/completions",
  );
});

test("allows local HTTP endpoints only for local development", () => {
  assert.throws(() => normalizeAIEndpoint("http://127.0.0.1:11434/v1"), /云端代理不能连接/);
  assert.equal(
    normalizeAIEndpoint("http://127.0.0.1:11434/v1", { allowPrivateNetwork: true }),
    "http://127.0.0.1:11434/v1/chat/completions",
  );
});

test("keeps explicit Responses API endpoints intact", () => {
  assert.equal(
    normalizeAIEndpoint("http://models.example.com:8080/v1/responses"),
    "http://models.example.com:8080/v1/responses",
  );
});

test("parses exactly three zero-inspiration story choices", () => {
  const options = parseSeedOptions(`结果如下：${JSON.stringify({
    options: [
      { title: "纸月", genre: "科幻", hook: "档案中出现 {月亮}", premise: "月亮是一份被篡改的档案。", recommended: false },
      { title: "归潮", genre: "悬疑", premise: "失踪者随退潮归来。", recommended: true },
      { title: "长夜餐厅", genre: "奇幻", premise: "每道菜会交换一段人生。", recommended: false },
    ],
  })}以上为三个方向。`);

  assert.equal(options.length, 3);
  assert.equal(options.filter((item) => item.recommended).length, 1);
  assert.equal(options[1].title, "归潮");
});

const seed: StorySeed = {
  id: "seed-1",
  title: "归潮",
  genre: "悬疑",
  hook: "失踪者随退潮归来",
  premise: "海港每次退潮都会送回一名失踪者，但他们失去了同一段记忆。",
  theme: "记忆与责任",
  protagonist: "调查记者林岚",
  centralConflict: "找出归来者共同隐瞒的真相",
  endingTone: "真相落地但保留余韵",
  reason: "规则清晰且冲突可持续升级",
  recommended: true,
};

function blueprintJson(chapterCount = 4) {
  return JSON.stringify({
    project: { title: "归潮", genre: "悬疑", premise: seed.premise, theme: seed.theme, writingStyle: "冷峻", pointOfView: "第三人称限知" },
    characters: [
      { name: "林岚", role: "主角", age: "30", identity: "记者", goal: "查明真相", conflict: "害怕承担后果", arc: "从旁观到负责", traits: ["敏锐"] },
      { name: "周渡", role: "盟友", age: "34", identity: "医生", goal: "保护归来者", conflict: "隐瞒事实", arc: "公开证据", traits: ["克制"] },
      { name: "陈屿", role: "对手", age: "45", identity: "港务主管", goal: "封锁旧案", conflict: "维护秩序与赎罪", arc: "承认责任", traits: ["强硬"] },
      { name: "苏禾", role: "归来者", age: "26", identity: "潜水员", goal: "找回记忆", conflict: "恐惧真相", arc: "主动作证", traits: ["警觉"] },
      { name: "许婆", role: "见证者", age: "68", identity: "钟表匠", goal: "完成旧日承诺", conflict: "沉默会保护也会伤害", arc: "交出档案", traits: ["寡言"] },
    ],
    world: [
      { category: "地点", title: "回声港", summary: "退潮异常的港城", details: "每日凌晨退潮，封港会切断居民生计" },
      { category: "规则", title: "归潮规则", summary: "退潮会送回一名失踪者", details: "归来者丢失同一小时记忆，强行回忆会昏厥" },
      { category: "势力", title: "港务会", summary: "控制港口档案与封锁线", details: "以维持秩序为名删改事故记录" },
      { category: "历史", title: "十年前沉船", summary: "共同失踪事件的源头", details: "官方结论与幸存者证词矛盾" },
      { category: "物件", title: "停摆手表", summary: "所有归来者都携带同款旧表", details: "表针固定在三点十七分且无法维修" },
    ],
    relationships: [{ from: "林岚", to: "周渡", label: "互相试探", tone: "复杂", description: "共同调查但彼此隐瞒" }],
    outline: [
      { act: "第一幕", title: "归来", summary: "第一名失踪者归来并留下手表", chapterStart: 1, chapterEnd: 1 },
      { act: "第二幕", title: "封锁", summary: "调查触及港务会并付出代价", chapterStart: 2, chapterEnd: 2 },
      { act: "第三幕", title: "记忆", summary: "归来者恢复片段并揭示沉船关联", chapterStart: 3, chapterEnd: 3 },
      { act: "终幕", title: "真相", summary: "公开证据、解决冲突并完成人物弧光", chapterStart: 4, chapterEnd: chapterCount },
    ],
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      number: index + 1,
      title: `潮声 ${index + 1}`,
      summary: `第 ${index + 1} 章发生具体选择、不可逆代价与结尾转折`,
      pov: "林岚",
      outlineIndex: Math.min(index, 3),
      objective: `完成第 ${index + 1} 章的核心调查目标`,
      opening: "从上一章留下的危机切入",
      scenes: ["林岚获得线索", "调查受到阻挠", "做出不可逆选择"],
      turningPoint: "新证据迫使林岚改变计划",
      endingHook: "一条更危险的线索出现",
      foreshadowActions: ["停摆的表", "删改档案", "缺失录音", "旧船票"].flatMap((title) => index === 0
        ? [{ title, action: "plant", instruction: "在调查现场自然埋设" }]
        : index === chapterCount - 1 ? [{ title, action: "resolve", instruction: "揭示真相并影响结局" }] : []),
    })),
    foreshadows: ["停摆的表", "删改档案", "缺失录音", "旧船票"].map((title, index) => ({
      title,
      content: `第1章埋设线索 ${index + 1}，终章揭示来源并完成回收`,
      plan: [
        { chapter: 1, action: "plant", instruction: "在调查现场自然埋设" },
        { chapter: chapterCount, action: "resolve", instruction: "在结局揭示并回收" },
      ],
    })),
  });
}

test("turns a validated blueprint into a complete writable workspace", () => {
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);

  assert.equal(parsed.chapters.length, 4);
  assert.deepEqual(parsed.chapters.map((item) => item.number), [1, 2, 3, 4]);
  assert.ok(parsed.chapters.every((item) => item.status === "待生成" && item.targetWords === 4000));
  assert.equal(parsed.relationships.length, 1);
  assert.equal(parsed.materials[0].type, "伏笔");
});



test("assembles five independently validated blueprint stages", () => {
  const complete = JSON.parse(blueprintJson()) as Record<string, unknown>;
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const foundation = parseBlueprintStage(JSON.stringify({ project: complete.project, characters: complete.characters, relationships: complete.relationships }), { stage: "characters" });
  const world = parseBlueprintStage(JSON.stringify({ world: complete.world }), { stage: "world" });
  const outline = parseBlueprintStage(JSON.stringify({ outline: complete.outline }), { stage: "outline", targetChapters: settings.targetChapters });
  const foreshadows = parseBlueprintStage(JSON.stringify({ foreshadows: complete.foreshadows }), { stage: "foreshadows", targetChapters: settings.targetChapters });
  const chapters = parseBlueprintStage(JSON.stringify({ chapters: complete.chapters }), { stage: "chapters", targetChapters: settings.targetChapters, outlineStage: outline, foreshadowStage: foreshadows });
  const assembled = parseNovelBlueprint(JSON.stringify({ ...foundation, ...world, ...outline, ...foreshadows, ...chapters }), seed, settings);
  const chapterPrompt = buildBlueprintChaptersPrompt(seed, settings, { foundation, world, outline, foreshadows });

  assert.equal(assembled.chapters.length, 4);
  assert.match(chapterPrompt, /第 5\/5 步：章节/);
  assert.doesNotMatch(chapterPrompt, /"characters":\[/);
  assert.throws(() => parseBlueprintStage('{"world":[]}', { arrays: ["world"] }), /缺少 world 数据/);
});

test("rejects malformed staged blueprint business rules", () => {
  const complete = JSON.parse(blueprintJson()) as Record<string, unknown>;
  const duplicateCharacters = structuredClone(complete) as Record<string, unknown>;
  const characterItems = duplicateCharacters.characters as Array<Record<string, unknown>>;
  characterItems[1].name = characterItems[0].name;
  assert.throws(
    () => parseBlueprintStage(JSON.stringify({ project: duplicateCharacters.project, characters: characterItems, relationships: duplicateCharacters.relationships }), { stage: "characters" }),
    /人物姓名重复/,
  );

  const brokenOutline = structuredClone(complete.outline) as Array<Record<string, unknown>>;
  brokenOutline[1].chapterStart = 3;
  assert.throws(
    () => parseBlueprintStage(JSON.stringify({ outline: brokenOutline }), { stage: "outline", targetChapters: 4 }),
    /不能断档或重叠/,
  );

  const outline = parseBlueprintStage(JSON.stringify({ outline: complete.outline }), { stage: "outline", targetChapters: 4 });
  const duplicateChapters = structuredClone(complete.chapters) as Array<Record<string, unknown>>;
  duplicateChapters[1].number = 1;
  assert.throws(
    () => parseBlueprintStage(JSON.stringify({ chapters: duplicateChapters }), { stage: "chapters", targetChapters: 4, outlineStage: outline, foreshadowStage: { foreshadows: complete.foreshadows } }),
    /不能重复/,
  );
  assert.throws(
    () => parseBlueprintStage('{"world":[null,null,null,null,null]}', { stage: "world" }),
    /非对象数据/,
  );
});

test("invalidates downstream blueprint stages when one stage is redone", () => {
  const complete = JSON.parse(blueprintJson()) as Record<string, unknown>;
  const draft = {
    seedId: seed.id,
    completedStage: 5 as const,
    foundation: { project: complete.project, characters: complete.characters, relationships: complete.relationships },
    world: { world: complete.world },
    outline: { outline: complete.outline },
    foreshadows: { foreshadows: complete.foreshadows },
    chapters: { chapters: complete.chapters },
  };

  const restarted = restartBlueprintDraft(draft, 3);
  assert.equal(restarted.completedStage, 2);
  assert.ok(restarted.foundation);
  assert.ok(restarted.world);
  assert.equal(restarted.outline, undefined);
  assert.equal(restarted.foreshadows, undefined);
  assert.equal(restarted.chapters, undefined);
});

test("counts every model attempt before it is sent", () => {
  const limits = { maxRequests: 2, maxTokens: 1000 };
  let usage = createAutomationState().usage;
  usage = reserveModelRequest(usage, limits);
  usage = reserveModelRequest(usage, limits);
  assert.equal(usage.requestCount, 2);
  assert.throws(() => reserveModelRequest(usage, limits), /2 次模型调用上限/);
  assert.throws(
    () => reserveModelRequest({ ...usage, requestCount: 0, totalTokens: 1000 }, limits),
    /Token 预算上限/,
  );
});

test("rejects an incomplete chapter blueprint without mutating a workspace", () => {
  const settings = createAutomationState({ targetChapters: 5, targetWords: 20000, chapterWords: 4000 });
  assert.throws(
    () => parseNovelBlueprint(blueprintJson(4), seed, settings),
    /少于要求的 5 章/,
  );
});

test("chapter prompts use committed history but never future chapter prose", () => {
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const workspace: WorkspaceData = {
    ...parsed,
    chapters: parsed.chapters.map((item, index) => ({
      ...item,
      content: index === 0 ? "已经提交的上一章正文" : index === 2 ? "不应泄露的未来章节正文" : "",
    })),
    automation: settings,
  };
  const prompt = buildAutomatedChapterPrompt(workspace, workspace.chapters[1], {
    index: 0,
    total: 2,
    existingDraft: "",
  });

  assert.match(prompt, /已经提交的上一章正文/);
  assert.match(prompt, /完成第 2 章的核心调查目标/);
  assert.doesNotMatch(prompt, /不应泄露的未来章节正文/);
});

test("normalizes older or partial workspace backups safely", () => {
  const normalized = normalizeWorkspaceData({
    project: { title: "旧备份" },
    chapters: [
      { id: "same", number: 1, title: "第一章", content: "正文", status: "unknown" },
      { id: "same", number: 1, title: "第二章", content: null },
    ],
    characters: [{ id: "char-1", name: "阿青", traits: null }],
    relationships: [{ fromId: "missing", toId: "char-1" }],
  }, DEMO_WORKSPACE);

  assert.deepEqual(normalized.chapters.map((item) => item.number), [1, 2]);
  assert.equal(new Set(normalized.chapters.map((item) => item.id)).size, 2);
  assert.equal(normalized.chapters[0].status, "草稿");
  assert.deepEqual(normalized.characters[0].traits, []);
  assert.deepEqual(normalized.relationships, []);
  assert.equal(normalized.automation.phase, "idle");
  assert.equal(normalized.canon.revision, 0);
  assert.equal(normalized.automation.usage.totalTokens, 0);
});

test("preserves a valid staged blueprint checkpoint for recovery", () => {
  const complete = JSON.parse(blueprintJson()) as Record<string, unknown>;
  const normalized = normalizeWorkspaceData({
    ...DEMO_WORKSPACE,
    automation: {
      ...DEMO_WORKSPACE.automation,
      runId: "planning-run",
      phase: "planning",
      blueprintDraft: {
        seedId: seed.id,
        completedStage: 2,
        foundation: { project: complete.project, characters: complete.characters, relationships: complete.relationships },
        world: { world: complete.world },
        outline: { outline: complete.outline },
      },
    },
  }, DEMO_WORKSPACE);

  assert.equal(normalized.automation.blueprintDraft?.completedStage, 2);
  assert.ok(normalized.automation.blueprintDraft?.foundation);
  assert.ok(normalized.automation.blueprintDraft?.world);
  assert.equal(normalized.automation.blueprintDraft?.outline, undefined);
});

test("commits chapter memory into the long-form canon ledger", () => {
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const workspace: WorkspaceData = { ...parsed, automation: settings };
  const memory = parseChapterMemory(JSON.stringify({
    summary: "林岚在退潮时发现第一名归来者，并决定隐瞒手表停摆的时间。",
    timelineEvents: ["凌晨退潮后第一名归来者出现"],
    characterUpdates: [{ name: "林岚", state: "掌握手表线索，决定暂不公开" }],
    openedThreads: ["停摆的手表为何指向同一时刻"],
    resolvedThreads: [],
    establishedFacts: ["归来者的手表停在凌晨三点十七分"],
  }));
  const updated = applyChapterMemory(workspace, workspace.chapters[0].id, memory);

  assert.equal(updated.canon.revision, 1);
  assert.equal(updated.canon.chapterSummaries.length, 1);
  assert.equal(updated.canon.characterStates[0].name, "林岚");
  assert.equal(updated.canon.threads[0].status, "open");
  assert.equal(updated.canon.facts[0].level, "ai_verified");
  assert.equal(updated.chapters[0].memory?.summary, memory.summary);
});

test("parses rolling continuity audit issues", () => {
  const issues = parseRollingAudit(JSON.stringify({
    issues: [{
      severity: "警告",
      category: "时间线",
      title: "退潮时间冲突",
      description: "第一章与第五章记录的退潮时刻不同，需要统一。",
      location: "第1、5章",
    }],
  }), "run-1");

  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "警告");
  assert.equal(issues[0].resolved, false);
});


test("rewinds writing from a chapter without keeping future canon", () => {
  const settings = createAutomationState({
    runId: "old-run",
    phase: "completed",
    targetChapters: 4,
    targetWords: 16000,
    chapterWords: 4000,
    currentChapterNumber: 4,
  });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const chapters = parsed.chapters.map((chapter) => ({
    ...chapter,
    content: `第${chapter.number}章旧正文`,
    status: "已完成" as const,
    revision: 1,
    memory: {
      summary: `第${chapter.number}章摘要`,
      timelineEvents: [],
      characterUpdates: [],
      openedThreads: [],
      resolvedThreads: [],
      establishedFacts: [],
    },
    generation: { runId: "old-run", status: "audited" as const, completedSegments: 2, baseRevision: 0 },
  }));
  const workspace: WorkspaceData = {
    ...parsed,
    chapters,
    issues: [
      { id: "audit-old-run-1", severity: "警告", category: "情节", title: "旧审校", description: "未来内容", location: "第3章", resolved: false },
      { id: "local-1", severity: "提示", category: "文风", title: "人工记录", description: "保留", location: "全书", resolved: false },
    ],
    canon: {
      revision: 8,
      chapterSummaries: chapters.map((chapter) => ({ chapterId: chapter.id, chapterNumber: chapter.number, summary: chapter.memory!.summary })),
      timeline: chapters.map((chapter) => ({ id: `timeline-${chapter.number}`, chapterNumber: chapter.number, event: "事件" })),
      characterStates: chapters.map((chapter) => ({ name: "林岚", state: `状态${chapter.number}`, chapterNumber: chapter.number })),
      threads: [
        { id: "thread-1", title: "旧线索", status: "resolved", openedChapter: 1, resolvedChapter: 3 },
        { id: "thread-2", title: "未来线索", status: "open", openedChapter: 3 },
      ],
      facts: chapters.map((chapter) => ({ id: `fact-${chapter.number}`, chapterNumber: chapter.number, fact: "事实" })),
      lastAuditedChapter: 4,
    },
    automation: {
      ...settings,
      generatedChapterIds: chapters.map((chapter) => chapter.id),
      usage: { requestCount: 42, inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    },
  };

  const rewound = rewindNovelFromChapter(workspace, 3, "new-run", "2026-07-11T12:00:00.000Z");

  assert.equal(rewound.chapters[1].content, "第2章旧正文");
  assert.equal(rewound.chapters[2].content, "");
  assert.equal(rewound.chapters[2].status, "待生成");
  assert.equal(rewound.chapters[2].memory, undefined);
  assert.equal(rewound.versions.length, 2);
  assert.equal(rewound.canon.chapterSummaries.length, 2);
  assert.equal(rewound.canon.timeline.length, 2);
  assert.equal(rewound.canon.facts.length, 2);
  assert.equal(rewound.canon.lastAuditedChapter, 2);
  assert.equal(rewound.canon.threads.length, 1);
  assert.equal(rewound.canon.threads[0].status, "open");
  assert.equal(rewound.canon.threads[0].resolvedChapter, undefined);
  assert.deepEqual(rewound.issues.map((issue) => issue.id), ["local-1"]);
  assert.equal(rewound.automation.runId, "new-run");
  assert.equal(rewound.automation.phase, "paused");
  assert.equal(rewound.automation.currentChapterNumber, 3);
  assert.deepEqual(rewound.automation.generatedChapterIds, chapters.slice(0, 2).map((chapter) => chapter.id));
  assert.equal(rewound.automation.usage.requestCount, 42);
});

test("rejects rewinding to a chapter that does not exist", () => {
  assert.throws(() => rewindNovelFromChapter(DEMO_WORKSPACE, 999, "new-run"), /没有找到第 999 章/);
});


test("estimates a persisted chapter writing range and its minimum request budget", () => {
  const settings = createAutomationState({
    targetChapters: 4,
    targetWords: 16000,
    chapterWords: 4000,
    maxRequests: 30,
    writingRange: { fromChapter: 2, toChapter: 3 },
  });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const firstChapter = parsed.chapters[0];
  const workspace: WorkspaceData = {
    ...parsed,
    chapters: parsed.chapters.map((chapter) => chapter.id === firstChapter.id ? { ...chapter, content: "已完成的前置章节" } : chapter),
    automation: {
      ...settings,
      generatedChapterIds: [firstChapter.id],
      usage: { requestCount: 5, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    },
  };

  const estimate = estimateWritingRange(workspace);
  assert.deepEqual(estimate.range, { fromChapter: 2, toChapter: 3 });
  assert.equal(estimate.chapters.length, 2);
  assert.equal(estimate.pendingChapters.length, 2);
  assert.equal(estimate.remainingSegments, 2);
  assert.equal(estimate.minimumRequests, 6);
  assert.equal(estimate.remainingRequestBudget, 25);
  assert.deepEqual(estimate.errors, []);
});

test("blocks a writing range that skips empty predecessors or exceeds request budget", () => {
  const settings = createAutomationState({
    targetChapters: 4,
    targetWords: 16000,
    chapterWords: 4000,
    maxRequests: 5,
    writingRange: { fromChapter: 3, toChapter: 4 },
  });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const workspace: WorkspaceData = { ...parsed, automation: settings };
  const estimate = estimateWritingRange(workspace);

  assert.deepEqual(estimate.missingPredecessorNumbers, [1, 2]);
  assert.equal(estimate.errors.length, 2);
  assert.match(estimate.errors[0], /不能跳过前文/);
  assert.match(estimate.errors[1], /仅剩 5 次预算/);
});

test("normalizes an imported writing range to existing chapter bounds", () => {
  const normalized = normalizeWorkspaceData({
    ...DEMO_WORKSPACE,
    automation: {
      ...DEMO_WORKSPACE.automation,
      writingRange: { fromChapter: 999, toChapter: -5 },
    },
  }, DEMO_WORKSPACE);

  assert.deepEqual(normalized.automation.writingRange, {
    fromChapter: normalized.chapters[0].number,
    toChapter: normalized.chapters.at(-1)!.number,
  });
});


test("preserves an active background writing phase only when explicitly requested", () => {
  const source = {
    ...DEMO_WORKSPACE,
    project: { ...DEMO_WORKSPACE.project, status: "AI 后台创作中" },
    automation: { ...DEMO_WORKSPACE.automation, phase: "writing" },
  };

  assert.equal(normalizeWorkspaceData(source, DEMO_WORKSPACE).automation.phase, "paused");
  assert.equal(normalizeWorkspaceData(source, DEMO_WORKSPACE, { preserveWritingPhase: true }).automation.phase, "writing");
});


test("filters future canon and exposes only the current chapter foreshadow tasks", () => {
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const workspace: WorkspaceData = {
    ...parsed,
    automation: settings,
    canon: {
      ...parsed.canon,
      facts: [
        { id: "fact-1", chapterNumber: 1, fact: "第一章已确认事实" },
        { id: "fact-4", chapterNumber: 4, fact: "第四章未来真相" },
      ],
    },
  };

  const prior = canonBeforeChapter(workspace, 2);
  assert.deepEqual(prior.facts.map((item) => item.fact), ["第一章已确认事实"]);
  assert.deepEqual(foreshadowTasksForChapter(workspace, 1).map((item) => item.action), ["plant", "plant", "plant", "plant"]);
  assert.equal(foreshadowTasksForChapter(workspace, 2).length, 0);
});

test("tracks planted and resolved foreshadows in chapter memory", () => {
  const settings = createAutomationState({ targetChapters: 4, targetWords: 16000, chapterWords: 4000 });
  const parsed = parseNovelBlueprint(blueprintJson(), seed, settings);
  const workspace: WorkspaceData = { ...parsed, automation: settings };
  const planted = parseChapterMemory(JSON.stringify({
    summary: "第一章埋下停摆的表。",
    timelineEvents: [], characterUpdates: [], openedThreads: [], resolvedThreads: [], establishedFacts: [],
    foreshadowUpdates: [{ title: "停摆的表", status: "planted", evidence: "林岚在码头发现停摆手表" }],
  }));
  const afterPlant = applyChapterMemory(workspace, workspace.chapters[0].id, planted);
  assert.equal(afterPlant.canon.threads.find((item) => item.title === "停摆的表")?.status, "open");

  const resolved = parseChapterMemory(JSON.stringify({
    summary: "终章揭示手表来源。",
    timelineEvents: [], characterUpdates: [], openedThreads: [], resolvedThreads: [], establishedFacts: [],
    foreshadowUpdates: [{ title: "停摆的表", status: "resolved", evidence: "旧船日志证明手表来源" }],
  }));
  const afterResolve = applyChapterMemory(afterPlant, afterPlant.chapters[3].id, resolved);
  const thread = afterResolve.canon.threads.find((item) => item.title === "停摆的表");
  assert.equal(thread?.status, "resolved");
  assert.equal(thread?.resolvedChapter, 4);
  assert.equal(afterResolve.chapters[3].memory?.foreshadowUpdates?.[0].evidence, "旧船日志证明手表来源");
});

test("parses structured chapter audit evidence and a full AI repair", () => {
  const issues = parseRollingAudit(JSON.stringify({ issues: [{
    severity: "错误", category: "人物", title: "知情范围冲突", description: "角色提前知道未来信息",
    chapterNumber: 2, evidence: "角色直接说出尚未发现的档案编号", suggestedFix: "改成猜测而不是确认", location: "第2章中段",
  }] }), "run-structured", 2, "\u4ed6\u7ffb\u5f00\u6587\u4ef6\uff0c\u89d2\u8272\u76f4\u63a5\u8bf4\u51fa\u5c1a\u672a\u53d1\u73b0\u7684\u6863\u6848\u7f16\u53f7\uff0c\u6240\u6709\u4eba\u90fd\u6123\u4f4f\u4e86\u3002");
  assert.equal(issues[0].chapterNumber, 2);
  assert.equal(issues[0].source, "ai");
  assert.match(issues[0].evidence || "", /档案编号/);
  const unsupported = parseRollingAudit(JSON.stringify({ issues: [{ severity: "\u9519\u8bef", category: "\u4eba\u7269", title: "\u65e0\u8bc1\u636e\u9519\u8bef", description: "\u6a21\u578b\u731c\u6d4b", evidence: "\u6b63\u6587\u4e2d\u4e0d\u5b58\u5728\u7684\u53e5\u5b50" }] }), "run-unverified", 2, "\u5b9e\u9645\u6b63\u6587\u6ca1\u6709\u8fd9\u6bb5\u5185\u5bb9");
  assert.equal(unsupported.length, 0);

  const repair = parseConsistencyRepair(JSON.stringify({ revisedContent: "修".repeat(400), changeSummary: "收窄角色知情范围" }));
  assert.equal(repair.changeSummary, "收窄角色知情范围");
  assert.throws(() => parseConsistencyRepair(JSON.stringify({ revisedContent: "太短", changeSummary: "无" })), /过短/);
});

test("applies only bounded unique repair patches", () => {
  const original = `opening\nThe brass key remained locked in the drawer.\n${"ending detail ".repeat(40)}`;
  const payload = JSON.stringify({ edits: [{ oldText: "The brass key remained locked in the drawer.", newText: "The brass key had already been removed from the drawer.", reason: "align inventory" }], changeSummary: "one local replacement" });
  const repair = parseConsistencyRepair(payload, original);
  assert.match(repair.revisedContent, /already been removed/);
  assert.match(repair.revisedContent, /ending detail/);
  assert.equal(repair.edits.length, 1);
  assert.throws(() => applyConsistencyRepairEdits("repeat phrase repeat phrase", [{ oldText: "repeat phrase", newText: "changed", reason: "ambiguous" }]), /oldText/);
  assert.throws(() => applyConsistencyRepairEdits("a".repeat(1000) + " unique target", [{ oldText: "a".repeat(400), newText: "replacement", reason: "too broad" }]), /oldText/);
});

test("creates stable fingerprints for the same continuity issue", () => {
  const base = { chapterNumber: 12, category: "\u4eba\u7269" as const, title: "Knowledge conflict", evidence: "archive code" };
  const first = consistencyIssueFingerprint(base);
  const second = consistencyIssueFingerprint({ ...base, title: "\u4fee\u590d\u540e\u65b0\u53d1\u73b0\uff08\u5f85\u4e8c\u6b21\u786e\u8ba4\uff09\uff1aKnowledge conflict" });
  assert.equal(first, second);
});

test("keeps repair scope stable and parks newly discovered AI errors for confirmation", () => {
  const baseline = { ...DEMO_WORKSPACE.issues[0], severity: "\u9519\u8bef" as const, category: "\u4eba\u7269" as const, source: "ai" as const, title: "\u89d2\u8272\u77e5\u60c5\u8303\u56f4\u51b2\u7a81", description: "\u89d2\u8272\u63d0\u524d\u77e5\u9053\u6863\u6848\u7f16\u53f7", evidence: "\u6863\u6848\u7f16\u53f7" };
  const related = { ...baseline, id: "related", title: "\u4eba\u7269\u77e5\u60c5\u8303\u56f4\u4ecd\u7136\u51b2\u7a81", description: "\u4ed6\u4ecd\u7136\u63d0\u524d\u8bf4\u51fa\u6863\u6848\u7f16\u53f7" };
  const novel = { ...baseline, id: "novel", category: "\u65f6\u95f4\u7ebf" as const, title: "\u65b0\u7684\u65f6\u95f4\u51b2\u7a81", description: "\u4fee\u590d\u540e\u5ba1\u6821\u9996\u6b21\u63d0\u51fa", evidence: "\u51cc\u6668\u4e09\u70b9" };
  const local = { ...novel, id: "local", source: "local" as const };
  const stabilized = stabilizeRepairAuditIssues([baseline], [related, novel, local]);
  assert.equal(stabilized[0].severity, "\u9519\u8bef");
  assert.equal(stabilized[1].severity, "\u8b66\u544a");
  assert.match(stabilized[1].title, /\u5f85\u4e8c\u6b21\u786e\u8ba4/);
  assert.equal(stabilized[2].severity, "\u9519\u8bef");
});

test("removes one chapter from canon before rebuilding it", () => {
  const workspace: WorkspaceData = {
    ...DEMO_WORKSPACE,
    canon: {
      ...DEMO_WORKSPACE.canon,
      chapterSummaries: [
        { chapterId: "a", chapterNumber: 1, summary: "一" },
        { chapterId: "b", chapterNumber: 2, summary: "二" },
      ],
      facts: [
        { id: "f1", chapterNumber: 1, fact: "一" },
        { id: "f2", chapterNumber: 2, fact: "二" },
      ],
    },
  };
  const cleaned = removeChapterFromCanon(workspace, 2);
  assert.deepEqual(cleaned.canon.chapterSummaries.map((item) => item.chapterNumber), [1]);
  assert.deepEqual(cleaned.canon.facts.map((item) => item.chapterNumber), [1]);
});


test("blocks chapter acceptance when the final draft is materially too short", () => {
  const chapter = { ...DEMO_WORKSPACE.chapters[0], number: 1, targetWords: 2000, content: "短".repeat(900), revision: 3 };
  const workspace: WorkspaceData = { ...DEMO_WORKSPACE, chapters: [chapter] };
  const issues = buildChapterQualityIssues(workspace, 1, "quality-run");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "错误");
  const audited = replaceChapterAuditIssues(workspace, 1, issues);
  assert.equal(unresolvedChapterErrors(audited, 1).length, 1);
  const longChapter = { ...chapter, content: "L".repeat(5000) };
  const longIssues = buildChapterQualityIssues({ ...workspace, chapters: [longChapter] }, 1, "quality-long");
  assert.equal(longIssues.length, 0);
});

test("re-audit resolves stale chapter issues before adding the new result", () => {
  const oldIssue = { ...DEMO_WORKSPACE.issues[0], id: "old", chapterNumber: 1, resolved: false };
  const nextIssue = { ...oldIssue, id: "new", title: "复审新问题" };
  const workspace: WorkspaceData = { ...DEMO_WORKSPACE, issues: [oldIssue] };
  const replaced = replaceChapterAuditIssues(workspace, 1, [nextIssue]);
  assert.equal(replaced.issues.find((item) => item.id === "old")?.resolved, true);
  assert.equal(replaced.issues.find((item) => item.id === "new")?.resolved, false);
});


test("compacts long-form canon while retaining relevant older facts", () => {
  const target = { ...DEMO_WORKSPACE.chapters[0], id: "chapter-120", number: 120, title: "沈砚的最终调查", summary: "沈砚核对旧案事实" };
  const workspace: WorkspaceData = {
    ...DEMO_WORKSPACE,
    chapters: [...DEMO_WORKSPACE.chapters, target],
    canon: {
      ...DEMO_WORKSPACE.canon,
      chapterSummaries: Array.from({ length: 119 }, (_, index) => ({ chapterId: `c-${index + 1}`, chapterNumber: index + 1, summary: `第 ${index + 1} 章摘要` })),
      timeline: Array.from({ length: 119 }, (_, index) => ({ id: `t-${index + 1}`, chapterNumber: index + 1, event: `事件 ${index + 1}` })),
      facts: Array.from({ length: 119 }, (_, index) => ({ id: `f-${index + 1}`, chapterNumber: index + 1, fact: index === 0 ? "沈砚从未公开旧钥匙" : `普通事实 ${index + 1}` })),
    },
  };
  const compact = compactCanonBeforeChapter(workspace, 120);
  assert.ok(compact.chapterSummaries.length <= 16);
  assert.ok(compact.timeline.length <= 60);
  assert.ok(compact.facts.length <= 90);
  assert.ok(compact.facts.some((item) => item.fact.includes("沈砚")));
});


test("selects independent models by writing stage", () => {
  assert.equal(detectAIStage("生成三个故事方向"), "ideation");
  assert.equal(detectAIStage("第 3/5 步：故事大纲"), "blueprint");
  assert.equal(detectAIStage("你是长篇小说的连续性记录员"), "memory");
  assert.equal(detectAIStage("逐章一致性审校"), "audit");
  assert.equal(detectAIStage("请输出 revisedContent 修订全文"), "repair");
  assert.equal(detectAIStage("继续创作本章正文"), "chapter");
});

test("calculates chapter quality and tracks foreshadows and character state", () => {
  const chapter = { ...DEMO_WORKSPACE.chapters[0], targetWords: 1000, content: "正文".repeat(500), memory: { summary: "完成", timelineEvents: [], characterUpdates: [{ name: DEMO_WORKSPACE.characters[0].name, state: "在码头继续调查" }], openedThreads: [], resolvedThreads: [], establishedFacts: [], foreshadowUpdates: [] } };
  const workspace: WorkspaceData = { ...DEMO_WORKSPACE, chapters: [chapter], issues: [], canon: { ...DEMO_WORKSPACE.canon, characterStates: [{ characterId: DEMO_WORKSPACE.characters[0].id, name: DEMO_WORKSPACE.characters[0].name, state: "在码头继续调查", chapterNumber: chapter.number }] } };
  const quality = evaluateChapterQuality(workspace, chapter.number);
  assert.ok(quality.overall >= 70);
  assert.equal(latestCharacterTracking(workspace)[0].latest?.chapterNumber, chapter.number);
  assert.equal(buildForeshadowLedger(workspace).length, workspace.materials.filter((item) => item.type === "伏笔").length);
});

test("normalizes stage models, task logs, quality and repair review", () => {
  const source: WorkspaceData = { ...DEMO_WORKSPACE, chapters: [{ ...DEMO_WORKSPACE.chapters[0], quality: { overall: 88, length: 90, outline: 80, continuity: 92, foreshadow: 100, style: 85, evaluatedAt: new Date().toISOString(), notes: [] }, repairReview: { beforeVersionId: "v1", changeSummary: "修复冲突", createdAt: new Date().toISOString(), status: "pending" } }], automation: { ...DEMO_WORKSPACE.automation, stageModels: { audit: { model: "audit-model", maxOutputTokens: 4096, temperature: 0.1, reasoningEffort: "high", verbosity: "medium" } }, taskLog: [{ id: "task-1", kind: "audit", label: "审校", status: "completed", startedAt: new Date().toISOString() }] } };
  source.chapters[0].generation = { runId: "draft-retry", status: "planned", completedSegments: 0, baseRevision: 0, draftAttempts: 3 };
  const normalized = normalizeWorkspaceData(source, DEMO_WORKSPACE);
  assert.equal(normalized.chapters[0].quality?.overall, 88);
  assert.equal(normalized.chapters[0].repairReview?.status, "pending");
  assert.equal(normalized.automation.stageModels?.audit?.model, "audit-model");
  assert.equal(normalized.automation.stageModels?.audit?.temperature, 0.1);
  assert.equal(normalized.automation.stageModels?.audit?.reasoningEffort, "high");
  assert.equal(normalized.automation.stageModels?.audit?.verbosity, "medium");
  assert.equal(normalized.automation.taskLog?.[0].status, "completed");
  assert.equal(normalized.chapters[0].generation?.draftAttempts, 3);
});


test("preserves a newer manual chapter while merging background automation progress", () => {
  const local = structuredClone(DEMO_WORKSPACE);
  const remote = structuredClone(DEMO_WORKSPACE);
  local.chapters[0] = { ...local.chapters[0], content: "manual revision", revision: 5, updatedAt: "2026-07-11T10:00:00.000Z" };
  remote.chapters[0] = { ...remote.chapters[0], content: "background revision", revision: 4, updatedAt: "2026-07-11T11:00:00.000Z" };
  remote.automation = { ...remote.automation, phase: "writing", currentChapterNumber: 2 };
  const merged = mergeAutomationWorkspace(local, remote);
  assert.equal(merged.chapters[0].content, "manual revision");
  assert.equal(merged.automation.currentChapterNumber, 2);
});

test("caps persisted chapter versions, resolved issues and task history", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  const chapterId = workspace.chapters[0].id;
  workspace.versions = Array.from({ length: 30 }, (_, index) => ({ id: `v-${index}`, chapterId, title: "chapter", content: `${index}`, createdAt: new Date(2026, 0, index + 1).toISOString(), note: "test" }));
  workspace.issues = Array.from({ length: 450 }, (_, index) => ({ id: `i-${index}`, severity: DEMO_WORKSPACE.issues[0].severity, category: DEMO_WORKSPACE.issues[0].category, title: "old", description: "old", location: "book", resolved: true }));
  workspace.automation.taskLog = Array.from({ length: 260 }, (_, index) => ({ id: `t-${index}`, kind: "test", label: "test", status: "completed" as const, startedAt: new Date().toISOString() }));
  const pruned = pruneWorkspaceHistory(workspace);
  assert.equal(pruned.versions.length, 12);
  assert.equal(pruned.issues.length, 400);
  assert.equal(pruned.automation.taskLog?.length, 200);
});


test("verifies outline and foreshadow evidence against exact chapter text", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  const chapter = { ...workspace.chapters[0], content: "The brass key was hidden beneath the lamp.", targetWords: 40 };
  workspace.chapters = [chapter];
  const memory = parseChapterMemory(JSON.stringify({
    summary: "The key is discovered.", timelineEvents: [], characterUpdates: [], openedThreads: [], resolvedThreads: [], establishedFacts: [],
    outlineEvidence: [{ key: "objective", label: "find key", status: "executed", score: 92, evidence: "key found", quote: "brass key was hidden" }],
    foreshadowUpdates: [{ title: workspace.materials.find((item) => item.foreshadowPlan?.length)?.title || "key", status: "planted", evidence: "key shown", quote: "brass key was hidden" }],
  }));
  const applied = applyChapterMemory(workspace, chapter.id, memory);
  assert.equal(applied.chapters[0].memory?.outlineEvidence?.[0].verified, true);
  assert.equal(applied.chapters[0].memory?.foreshadowUpdates?.[0].verified, true);
  assert.ok(evaluateChapterQuality(applied, chapter.number).outline >= 90);
});

test("detects character knowledge regression and orders dependent repairs", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  const name = workspace.characters[0].name;
  const chapter = workspace.chapters[1];
  chapter.memory = { summary: "state", timelineEvents: [], characterUpdates: [{ name, state: "acts unaware", knowledge: [] }], openedThreads: [], resolvedThreads: [], establishedFacts: [] };
  workspace.canon.characterStates = [{ name, state: "knows identity", knowledge: ["identity secret"], chapterNumber: chapter.number - 1 }];
  assert.ok(buildCharacterContinuityIssues(workspace, chapter.number).some((issue) => issue.id.startsWith("character-knowledge")));
  workspace.issues = [
    { id: "root", severity: "\u9519\u8bef", category: "\u4eba\u7269", title: "identity conflict", description: "identity secret is wrong", location: "chapter 1", resolved: false, chapterNumber: 1 },
    { id: "derived", severity: "\u9519\u8bef", category: "\u4eba\u7269", title: "identity conflict later", description: "identity secret remains wrong", location: "chapter 2", resolved: false, chapterNumber: 2 },
  ];
  const queue = buildRepairDependencyQueue(workspace);
  assert.deepEqual(queue.map((item) => item.chapterNumber), [1, 2]);
  assert.deepEqual(queue[1].dependsOn, [1]);
  assert.deepEqual(queue[0].affectedChapters, [2]);
});


test("marks stale foreground tasks as interrupted after reload", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.automation.phase = "writing";
  workspace.automation.taskLog = [{
    id: "stale", kind: "repair", label: "repair", status: "running", startedAt: "2026-07-11T00:00:00.000Z",
  }];
  const reconciled = reconcileInterruptedTasks(workspace, new Date("2026-07-11T01:00:00.000Z"));
  assert.equal(reconciled.automation.phase, "paused");
  assert.equal(reconciled.automation.taskLog?.[0].status, "failed");
  assert.match(reconciled.automation.taskLog?.[0].error || "", /\u4e2d\u65ad/);
});

test("recovers chapter writing from a persisted generation step", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.automation.generatedChapterIds = [workspace.chapters[0].id];
  const recovered = recoverWorkspaceFromStep(workspace, {
    id: "step", runId: "run-recovery", stepKey: "chapter-1-segment-2", kind: "chapter_segment",
    chapterNumber: 1, segmentNumber: 2, status: "completed", attempts: 1,
    createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.equal(recovered.automation.runId, "run-recovery");
  assert.equal(recovered.automation.phase, "paused");
  assert.equal(recovered.automation.currentChapterNumber, 1);
  assert.equal(recovered.automation.currentSegment, 2);
  assert.equal(recovered.automation.generatedChapterIds.includes(workspace.chapters[0].id), false);
});


test("assigns chapter outline obligations to the correct writing segment", () => {
  const target = structuredClone(DEMO_WORKSPACE.chapters[0]);
  target.chapterOutline = {
    objective: "find the key", opening: "enter the harbor", scenes: ["question guard", "search warehouse", "escape"],
    turningPoint: "the key opens the wrong door", endingHook: "a voice answers", foreshadowActions: [],
  };
  const first = chapterSegmentObligations(target, 0, 3);
  const last = chapterSegmentObligations(target, 2, 3);
  assert.equal(first.opening, "enter the harbor");
  assert.equal(first.turningPoint, undefined);
  assert.ok(first.forbiddenUntilLater.includes("the key opens the wrong door"));
  assert.equal(last.turningPoint, "the key opens the wrong door");
  assert.equal(last.endingHook, "a voice answers");
});

test("does not expose the next chapter summary to the current prose prompt", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.chapters[1].summary = "UNIQUE_FUTURE_REVEAL_92831";
  const prompt = buildAutomatedChapterPrompt(workspace, workspace.chapters[0], { index: 0, total: 2, existingDraft: "" });
  assert.equal(prompt.includes("UNIQUE_FUTURE_REVEAL_92831"), false);
  assert.match(prompt, /wholeChapterObligations/);
  assert.match(prompt, /whole_chapter_single_pass/);
  assert.doesNotMatch(prompt, /\u5206\u6bb5\u4efb\u52a1/);
});

test("rejects unsupported memory claims before they enter the canon ledger", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  const chapter = workspace.chapters[0];
  chapter.content = "The brass key entered the pocket. She stayed at the harbor.";
  const memory = parseChapterMemory(JSON.stringify({
    evidenceVersion: 1, summary: "The key changes hands.",
    timelineEvents: [{ event: "The key enters the pocket", quote: "The brass key entered the pocket" }],
    characterUpdates: [
      { name: workspace.characters[0].name, state: "holds the brass key", inventory: ["brass key"], quote: "The brass key entered the pocket" },
      { name: "Unknown Person", state: "knows every secret", quote: "The brass key entered the pocket" },
    ],
    openedThreads: [], resolvedThreads: [],
    establishedFacts: [
      { fact: "The protagonist holds the brass key", quote: "The brass key entered the pocket" },
      { fact: "The mayor supplied the key", quote: "The mayor handed over the key" },
    ],
    outlineEvidence: [], foreshadowUpdates: [],
  }));
  const updated = applyChapterMemory(workspace, chapter.id, memory);
  assert.deepEqual(updated.canon.facts.map((item) => item.fact), ["The protagonist holds the brass key"]);
  assert.equal(updated.canon.characterStates.some((item) => item.name === "Unknown Person"), false);
  assert.equal(updated.chapters[0].memory?.factEvidence?.filter((item) => item.verified).length, 1);
  assert.equal(buildMemoryEvidenceIssues(updated, chapter.number, "run").length, 1);
});

test("turns missing verified outline evidence into blocking errors", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  const chapter = workspace.chapters[0];
  chapter.chapterOutline = { objective: "find key", opening: "enter warehouse", scenes: ["search shelves"], turningPoint: "someone waits behind door", endingHook: "lights go out", foreshadowActions: [] };
  chapter.memory = {
    evidenceVersion: 1, summary: "Only objective completed", timelineEvents: [], characterUpdates: [], openedThreads: [], resolvedThreads: [], establishedFacts: [],
    outlineEvidence: [{ key: "objective", label: "find key", status: "executed", score: 90, quote: "find key", verified: true }],
  };
  workspace.chapters = [chapter];
  const issues = buildChapterPlanDeviationIssues(workspace, chapter.number, "run");
  assert.ok(issues.length >= 4);
  assert.ok(issues.every((issue) => issue.severity === String.fromCodePoint(0x9519, 0x8bef)));
  assert.ok(issues.some((issue) => issue.id.endsWith("turningPoint")));
  assert.ok(issues.some((issue) => issue.id.endsWith("scenes")));
});

test("preserves structured character memory and evidence across persistence normalization", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.chapters[0].memory = {
    evidenceVersion: 1, summary: "state update", timelineEvents: ["arrives at harbor"],
    timelineEvidence: [{ event: "arrives at harbor", quote: "walks into harbor", verified: true }],
    characterUpdates: [{ name: workspace.characters[0].name, state: "investigating", location: "harbor", physical: "injured", emotion: "alert", knowledge: ["tide time"], inventory: ["brass key"], goal: "find ship", quote: "walks into harbor", verified: true }],
    openedThreads: ["missing ship"], resolvedThreads: [], establishedFacts: ["key is held"],
    threadEvidence: [{ title: "missing ship", status: "opened", quote: "ship is gone", verified: true }],
    factEvidence: [{ fact: "key is held", quote: "holds the key", verified: true }],
  };
  const normalized = normalizeWorkspaceData(workspace, DEMO_WORKSPACE);
  const memory = normalized.chapters[0].memory!;
  assert.equal(memory.evidenceVersion, 1);
  assert.equal(memory.characterUpdates[0].location, "harbor");
  assert.deepEqual(memory.characterUpdates[0].knowledge, ["tide time"]);
  assert.equal(memory.factEvidence?.[0].verified, true);
});


test("rejects repeated prose and premature ending hooks before saving a segment", () => {
  const target = structuredClone(DEMO_WORKSPACE.chapters[0]);
  target.chapterOutline = { objective: "investigate", opening: "arrive", scenes: ["search"], turningPoint: "THE_LOCKED_DOOR_OPENS", endingHook: "THE_LIGHTS_GO_OUT", foreshadowActions: [] };
  const repeated = "A".repeat(90);
  const issues = validateGeneratedChapterSegment(target, { index: 0, total: 2, existingDraft: repeated }, `${repeated}\n\nTHE_LIGHTS_GO_OUT`);
  assert.equal(issues.length, 2);
  assert.equal(validateGeneratedChapterSegment(target, { index: 1, total: 2, existingDraft: repeated }, "A clean final segment." ).length, 0);
});

test("keeps legacy unsupported canon out of verified writing context", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.chapters[0].memory = {
    summary: "legacy generated memory", timelineEvents: ["legacy event"], characterUpdates: [],
    openedThreads: [], resolvedThreads: [], establishedFacts: ["legacy unsupported fact"],
  };
  workspace.canon.timeline = [{ id: "legacy-event", chapterNumber: 1, event: "legacy event" }];
  workspace.canon.facts = [{ id: "legacy-fact", chapterNumber: 1, fact: "legacy unsupported fact" }];
  const legacy = canonContextBeforeChapter(workspace, 2);
  assert.equal(legacy.verified.timeline.length, 0);
  assert.equal(legacy.verified.facts.length, 0);
  assert.deepEqual(legacy.legacyMemoryChapters, [1]);

  workspace.chapters[0].memory.evidenceVersion = 1;
  const rebuilt = canonContextBeforeChapter(workspace, 2);
  assert.equal(rebuilt.verified.timeline.length, 1);
  assert.equal(rebuilt.verified.facts.length, 1);
});

test("requires the full target word count but accepts chapters over target", () => {
  const target = structuredClone(DEMO_WORKSPACE.chapters[0]);
  target.targetWords = 4000;
  assert.deepEqual(chapterDraftWordRange(target.targetWords), { minimum: 4000, recommendedMaximum: 4800 });
  assert.equal(validateGeneratedChapterDraft(target, "A".repeat(3999)).length, 1);
  assert.equal(validateGeneratedChapterDraft(target, "A".repeat(4000)).length, 0);
  assert.equal(validateGeneratedChapterDraft(target, "A".repeat(4800)).length, 0);
  assert.equal(validateGeneratedChapterDraft(target, "A".repeat(8000)).length, 0);
  const prompt = buildAutomatedChapterPrompt(DEMO_WORKSPACE, target, { existingDraft: "old partial draft" });
  assert.match(prompt, /4000/);
  assert.match(prompt, /4800/);
  assert.match(prompt, /allowOverTarget/);
  assert.match(prompt, /whole_chapter_single_pass/);
});

test("cancels an automation run without deleting completed chapters", () => {
  const workspace = structuredClone(DEMO_WORKSPACE);
  workspace.automation.runId = "active-run";
  workspace.automation.phase = "writing";
  workspace.automation.lastError = "old error";
  workspace.automation.taskLog = [
    { id: "running", kind: "chapter_segment", label: "running", status: "running", startedAt: "2026-07-12T00:00:00.000Z" },
    { id: "queued", kind: "chapter_memory", label: "queued", status: "queued", startedAt: "2026-07-12T00:00:00.000Z" },
    { id: "done", kind: "rolling_audit", label: "done", status: "completed", startedAt: "2026-07-12T00:00:00.000Z" },
  ];
  const originalContent = workspace.chapters[0].content;
  const cancelled = cancelAutomationRun(workspace, "2026-07-12T01:00:00.000Z");
  assert.equal(cancelled.automation.phase, "paused");
  assert.equal(cancelled.automation.runId, "");
  assert.equal(cancelled.automation.lastError, undefined);
  assert.equal(cancelled.automation.taskLog?.[0].status, "cancelled");
  assert.equal(cancelled.automation.taskLog?.[1].status, "cancelled");
  assert.equal(cancelled.automation.taskLog?.[2].status, "completed");
  assert.equal(cancelled.chapters[0].content, originalContent);
});
