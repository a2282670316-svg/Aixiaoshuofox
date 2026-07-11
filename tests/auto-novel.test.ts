import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomatedChapterPrompt,
  buildBlueprintChaptersPrompt,
  applyChapterMemory,
  createAutomationState,
  parseChapterMemory,
  parseBlueprintStage,
  parseNovelBlueprint,
  parseRollingAudit,
  parseSeedOptions,
  reserveModelRequest,
  restartBlueprintDraft,
  rewindNovelFromChapter,
} from "../lib/auto-novel";
import type { StorySeed, WorkspaceData } from "../lib/types";
import { DEMO_WORKSPACE } from "../lib/demo-data";
import { normalizeWorkspaceData } from "../lib/workspace";
import { normalizeAIEndpoint } from "../lib/ai-endpoint";

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
    chapters: Array.from({ length: chapterCount }, (_, index) => ({ number: index + 1, title: `潮声 ${index + 1}`, summary: `第 ${index + 1} 章发生具体选择、不可逆代价与结尾转折`, pov: "林岚", outlineIndex: Math.min(index, 3) })),
    foreshadows: ["停摆的表", "删改档案", "缺失录音", "旧船票"].map((title, index) => ({ title, content: `第1章埋设线索 ${index + 1}，终章揭示来源并完成回收`, tags: ["第1章", `第${chapterCount}章`, "待回收"] })),
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
  const chapters = parseBlueprintStage(JSON.stringify({ chapters: complete.chapters }), { stage: "chapters", targetChapters: settings.targetChapters, outlineStage: outline });
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
    () => parseBlueprintStage(JSON.stringify({ chapters: duplicateChapters }), { stage: "chapters", targetChapters: 4, outlineStage: outline }),
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
