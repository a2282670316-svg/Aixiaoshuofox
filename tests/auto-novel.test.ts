import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomatedChapterPrompt,
  applyChapterMemory,
  createAutomationState,
  parseChapterMemory,
  parseNovelBlueprint,
  parseRollingAudit,
  parseSeedOptions,
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
    ],
    world: [{ category: "地点", title: "回声港", summary: "退潮异常的港城", details: "每日凌晨退潮" }],
    relationships: [{ from: "林岚", to: "周渡", label: "互相试探", tone: "复杂", description: "共同调查但彼此隐瞒" }],
    outline: [{ act: "第一幕", title: "归来", summary: "第一名失踪者归来", chapterStart: 1, chapterEnd: chapterCount }],
    chapters: Array.from({ length: chapterCount }, (_, index) => ({ number: index + 1, title: `潮声 ${index + 1}`, summary: `第 ${index + 1} 章发生具体选择与转折`, pov: "林岚", outlineIndex: 0 })),
    foreshadows: [{ title: "停摆的表", content: "第一章埋设，终章回收", tags: ["第1章", `第${chapterCount}章`, "待回收"] }],
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
