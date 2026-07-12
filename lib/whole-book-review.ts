import {
  buildMechanicalStyleIssues,
  buildNarrativeHealthIssues,
  withAuditConfidence,
  canonBeforeChapter,
} from "./auto-novel";
import { buildNarrativeIntelligenceIssues, derivePacingCurve, deriveCharacterVoiceProfiles } from "./narrative-intelligence";
import {
  deriveResourceLedger,
  propagationDebtIssues,
  syncStorylinesFromWorkspace,
} from "./story-governance";
import type { ConsistencyIssue, WorkspaceData } from "./types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseJson(value: string): JsonRecord {
  const cleaned = value.replace(/^\uFEFF/, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("全书总审校没有返回合法 JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  return record(parsed);
}

function uniqueIssues(issues: ConsistencyIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.chapterNumber || 0, issue.category, issue.title, issue.evidence || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildWholeBookAuditPrompt(workspace: WorkspaceData) {
  const contract = workspace.project.bookContract;
  const chapterDigest = [...workspace.chapters].sort((a, b) => a.number - b.number).map((chapter) => ({
    number: chapter.number,
    title: chapter.title,
    outline: chapter.chapterOutline ? {
      objective: chapter.chapterOutline.objective,
      turningPoint: chapter.chapterOutline.turningPoint,
      endingHook: chapter.chapterOutline.endingHook,
    } : undefined,
    summary: chapter.memory?.summary || chapter.summary,
    openingExcerpt: chapter.content.slice(0, 500),
    endingExcerpt: chapter.content.slice(-900),
    timeline: chapter.memory?.timelineEvents,
    characterUpdates: chapter.memory?.characterUpdates,
    foreshadowUpdates: chapter.memory?.foreshadowUpdates,
    narrativeEvents: chapter.memory?.narrativeEvents,
    knowledgeChanges: chapter.memory?.knowledgeChanges,
    quality: chapter.quality,
  }));
  const control = workspace.storyControl;
  return `你是长篇小说的全书终审编辑。所有章节已经分别通过逐章验收，现在进行跨章节总审校。
只输出合法 JSON：
{"issues":[{"severity":"错误|警告|提示","category":"时间线|人物|世界规则|情节|文风","title":"问题标题","description":"跨章节影响","chapterNumber":必须修复的具体章节号,"evidence":"该章正文中逐字存在的连续原句","suggestedFix":"不改变其他已完成剧情的最小修复方案","location":"第N章的具体位置"}]}

终审要求：
1. 检查整书契约的读者承诺、核心卖点、主角核心幻想、关系主线和第3/10/30章兑现节点是否有可核对的正文结果。
2. 检查主线、人物线、感情线和谜题线是否长期停滞，结局前应回收的线程是否仍然悬空。
3. 检查人物位置、知情范围、伤势、道具、秘密、能力次数和关系变化是否跨章连续。
4. 检查时间线、世界规则、因果链、物件归属与伏笔种植/推进/回收是否矛盾。
5. 检查连续章节是否重复同一种冲突、揭示、情绪节拍或结尾钩子。
6. 最终章必须完成主要冲突、人物选择和主题回响，不得只是宣布“一切才刚刚开始”。
7. 只能报告能够定位到某一具体章节、并能提供该章正文逐字原句的问题。无法定位、只有主观偏好或没有正文证据的问题不要报告。
8. chapterNumber 必须是已有章节号；evidence 必须是该章正文中真实存在的连续原句，禁止概括、拼接和编造。
9. 没有问题返回 {"issues":[]}；最多 24 项，优先报告会破坏全书闭环的问题。

【作品】
${JSON.stringify({ project: workspace.project, contract, outline: workspace.outline })}

【章节终审摘要】
${JSON.stringify(chapterDigest)}

【已验证事实账本】
${JSON.stringify(workspace.canon)}

【故事线、节奏、人物声纹与传播债务】
${JSON.stringify({ storylines: control?.storylines || [], propagationDebts: control?.propagationDebts || [], pacingCurve: derivePacingCurve(workspace), voiceProfiles: deriveCharacterVoiceProfiles(workspace) })}`;
}

export function parseWholeBookAudit(value: string, runId: string, workspace: WorkspaceData): ConsistencyIssue[] {
  const payload = parseJson(value);
  const chapters = new Map(workspace.chapters.map((chapter) => [chapter.number, chapter]));
  return list(payload.issues).map(record).flatMap((item, index) => {
    const title = text(item.title);
    const description = text(item.description);
    const chapterNumber = Number(item.chapterNumber);
    const chapter = Number.isInteger(chapterNumber) ? chapters.get(chapterNumber) : undefined;
    if (!title || !description || !chapter) return [];
    const evidence = text(item.evidence);
    const normalizedEvidence = evidence.replace(/\s+/g, "");
    const verified = normalizedEvidence.length >= 6 && chapter.content.replace(/\s+/g, "").includes(normalizedEvidence);
    const severity = ["错误", "警告", "提示"].includes(String(item.severity)) ? item.severity as ConsistencyIssue["severity"] : "警告";
    if (severity !== "提示" && !verified) return [];
    const category = ["时间线", "人物", "世界规则", "情节", "文风"].includes(String(item.category)) ? item.category as ConsistencyIssue["category"] : "情节";
    return [{
      id: `whole-book-${runId}-${chapterNumber}-${index + 1}`,
      severity,
      category,
      title,
      description,
      location: text(item.location, `第 ${chapterNumber} 章`),
      resolved: false,
      chapterNumber,
      evidence,
      suggestedFix: text(item.suggestedFix, "以最小改动修复该处，并重建本章及后续事实记忆。"),
      source: "ai" as const,
      confidence: verified ? "high" as const : "low" as const,
      evidenceClass: verified ? "quoted" as const : "subjective" as const,
      autoRepairable: verified && severity !== "提示",
      verificationNote: verified ? "全书终审引文已通过本地逐字核对" : "未找到可核对引文，仅供人工参考",
    }];
  }).slice(0, 24);
}

export function clearPropagationDebtsAfterReview(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    storyControl: {
      ...(workspace.storyControl || { propagationDebts: [], storylines: [], resourceLedger: [] }),
      propagationDebts: (workspace.storyControl?.propagationDebts || []).map((debt) => ({ ...debt, status: "\u5df2\u6e05\u507f" as const })),
    },
  };
}

export function collectWholeBookReviewIssues(workspace: WorkspaceData, aiIssues: ConsistencyIssue[] = []) {
  const local = [
    ...buildMechanicalStyleIssues(workspace),
    ...buildNarrativeHealthIssues(workspace),
    ...buildNarrativeIntelligenceIssues(workspace),
    ...propagationDebtIssues(workspace).map(withAuditConfidence),
  ];
  const previousReviewIds = new Set(workspace.automation.finalReview?.issueIds || []);
  const existingErrors = workspace.issues.filter((issue) => !issue.resolved && issue.severity === "错误" && !previousReviewIds.has(issue.id));
  return uniqueIssues([...existingErrors, ...local, ...aiIssues].map(withAuditConfidence)).filter((issue) => Boolean(issue.chapterNumber));
}

export function wholeBookBlockingIssues(issues: ConsistencyIssue[]) {
  return issues.filter((issue) => issue.severity !== "提示" && issue.confidence !== "low");
}

export function buildWholeBookRepairQueue(issues: ConsistencyIssue[]) {
  return Array.from(new Set(wholeBookBlockingIssues(issues).filter((issue) => issue.autoRepairable !== false).flatMap((issue) => issue.chapterNumber ? [issue.chapterNumber] : []))).sort((a, b) => a - b);
}

export function replaceWholeBookReviewIssues(workspace: WorkspaceData, issues: ConsistencyIssue[], status: "reviewing" | "repairing" | "blocked" = "reviewing"): WorkspaceData {
  const previousIds = new Set(workspace.automation.finalReview?.issueIds || []);
  const now = new Date().toISOString();
  const normalized = uniqueIssues(issues);
  return {
    ...workspace,
    issues: [
      ...workspace.issues.map((issue) => previousIds.has(issue.id) && !issue.resolved ? { ...issue, resolved: true } : issue),
      ...normalized,
    ],
    automation: {
      ...workspace.automation,
      phase: "reviewing",
      finalReview: {
        status,
        round: (workspace.automation.finalReview?.round || 0) + 1,
        issueIds: normalized.map((issue) => issue.id),
        repairQueue: buildWholeBookRepairQueue(normalized),
        repairAttempts: workspace.automation.finalReview?.repairAttempts || {},
        startedAt: workspace.automation.finalReview?.startedAt || now,
        lastError: status === "blocked" ? "全书终审仍有无法自动清除的问题" : undefined,
      },
      updatedAt: now,
    },
  };
}

export function prepareWholeBookReview(workspace: WorkspaceData): WorkspaceData {
  const now = new Date().toISOString();
  return {
    ...workspace,
    storyControl: {
      ...(workspace.storyControl || { propagationDebts: [], storylines: [], resourceLedger: [] }),
      storylines: syncStorylinesFromWorkspace(workspace),
      resourceLedger: deriveResourceLedger(workspace),
      propagationDebts: (workspace.storyControl?.propagationDebts || []).map((debt) => debt.status === "已清偿" ? debt : { ...debt, status: "复审中" as const }),
    },
    automation: {
      ...workspace.automation,
      phase: "reviewing",
      finalReview: {
        status: workspace.automation.finalReview?.status === "repairing" ? "repairing" : "reviewing",
        round: workspace.automation.finalReview?.round || 0,
        issueIds: workspace.automation.finalReview?.issueIds || [],
        repairQueue: workspace.automation.finalReview?.repairQueue || [],
        repairAttempts: workspace.automation.finalReview?.repairAttempts || {},
        startedAt: workspace.automation.finalReview?.startedAt || now,
      },
      updatedAt: now,
    },
  };
}

export function removeCanonFromChapterOnward(workspace: WorkspaceData, chapterNumber: number): WorkspaceData {
  return {
    ...workspace,
    canon: { ...canonBeforeChapter(workspace, chapterNumber), revision: workspace.canon.revision + 1 },
    chapters: workspace.chapters.map((chapter) => chapter.number >= chapterNumber ? {
      ...chapter,
      memory: undefined,
      quality: undefined,
      contextManifest: undefined,
      candidates: undefined,
      generation: chapter.generation ? { ...chapter.generation, status: "generated" as const } : chapter.generation,
    } : chapter),
  };
}

export function markWholeBookReviewPassed(workspace: WorkspaceData): WorkspaceData {
  const now = new Date().toISOString();
  const previousIds = new Set(workspace.automation.finalReview?.issueIds || []);
  return {
    ...workspace,
    project: { ...workspace.project, status: "全书验收完成" },
    outline: workspace.outline.map((item) => ({ ...item, status: "已完成" })),
    issues: workspace.issues.map((issue) => previousIds.has(issue.id) && !issue.resolved ? { ...issue, resolved: true } : issue),
    storyControl: {
      ...(workspace.storyControl || { propagationDebts: [], storylines: [], resourceLedger: [] }),
      storylines: syncStorylinesFromWorkspace(workspace),
      resourceLedger: deriveResourceLedger(workspace),
      propagationDebts: (workspace.storyControl?.propagationDebts || []).map((debt) => ({ ...debt, status: "已清偿" as const })),
    },
    automation: {
      ...workspace.automation,
      phase: "completed",
      currentChapterNumber: workspace.chapters.length,
      currentSegment: 0,
      lastError: undefined,
      finalReview: {
        status: "passed",
        round: workspace.automation.finalReview?.round || 1,
        issueIds: [],
        repairQueue: [],
        repairAttempts: workspace.automation.finalReview?.repairAttempts || {},
        startedAt: workspace.automation.finalReview?.startedAt || now,
        completedAt: now,
      },
      updatedAt: now,
    },
  };
}

