import type {
  ConsistencyIssue,
  PropagationDebt,
  ResourceLedgerEntry,
  StoryControlSnapshot,
  StoryControlSourceType,
  StoryControlState,
  Storyline,
  WorkspaceData,
} from "./types";

export const EMPTY_STORY_CONTROL: StoryControlState = {
  propagationDebts: [],
  storylines: [],
  resourceLedger: [],
};

function signature(value: unknown) {
  return JSON.stringify(value);
}

function snapshotItems<T extends { id: string }>(items: T[], label: (item: T) => string, select: (item: T) => unknown) {
  return items.map((item) => ({ id: item.id, label: label(item), signature: signature(select(item)) }));
}

export function buildStoryControlSnapshot(workspace: WorkspaceData): StoryControlSnapshot {
  return {
    createdAt: new Date().toISOString(),
    projectSignature: signature({
      premise: workspace.project.premise,
      theme: workspace.project.theme,
      writingStyle: workspace.project.writingStyle,
      pointOfView: workspace.project.pointOfView,
    }),
    bookContractSignature: signature(workspace.project.bookContract || {}),
    characters: snapshotItems(workspace.characters, (item) => item.name, (item) => ({ name: item.name, role: item.role, identity: item.identity, goal: item.goal, conflict: item.conflict, arc: item.arc, traits: item.traits })),
    world: snapshotItems(workspace.world, (item) => item.title, (item) => ({ category: item.category, title: item.title, summary: item.summary, details: item.details })),
    outline: snapshotItems(workspace.outline, (item) => item.title, (item) => ({ act: item.act, title: item.title, summary: item.summary, chapterRange: item.chapterRange })),
  };
}

function draftedNumbers(workspace: WorkspaceData) {
  return workspace.chapters.filter((chapter) => chapter.content.trim()).map((chapter) => chapter.number).sort((a, b) => a - b);
}

function affectedByLabel(workspace: WorkspaceData, label: string) {
  const drafted = workspace.chapters.filter((chapter) => chapter.content.trim()).sort((a, b) => a.number - b.number);
  const mentioned = drafted.filter((chapter) => [chapter.title, chapter.summary, chapter.content, JSON.stringify(chapter.memory || {})].join("\n").includes(label));
  const first = mentioned[0]?.number;
  if (first) return drafted.filter((chapter) => chapter.number >= first).map((chapter) => chapter.number);
  return drafted.at(-1) ? [drafted.at(-1)!.number] : [];
}

function createDebt(
  workspace: WorkspaceData,
  sourceType: StoryControlSourceType,
  sourceId: string,
  sourceTitle: string,
  changeType: PropagationDebt["changeType"],
  reason: string,
  affectedChapters: number[],
): PropagationDebt | null {
  if (!affectedChapters.length) return null;
  return {
    id: `debt-${sourceType}-${sourceId}-${Date.now()}`,
    sourceType,
    sourceId,
    sourceTitle,
    changeType,
    reason,
    affectedChapters: [...new Set(affectedChapters)].sort((a, b) => a - b),
    createdAt: new Date().toISOString(),
    status: "待复审",
  };
}

function diffItems(
  workspace: WorkspaceData,
  sourceType: StoryControlSourceType,
  previous: StoryControlSnapshot["characters"],
  current: StoryControlSnapshot["characters"],
  affected: (id: string, label: string) => number[],
) {
  const before = new Map(previous.map((item) => [item.id, item]));
  const after = new Map(current.map((item) => [item.id, item]));
  const debts: PropagationDebt[] = [];
  for (const item of current) {
    const prior = before.get(item.id);
    if (prior?.signature === item.signature) continue;
    const changeType = prior ? "修改" : "新增";
    const debt = createDebt(workspace, sourceType, item.id, item.label, changeType, `${sourceType}“${item.label}”已${changeType}，引用旧设定的章节需要按顺序重新审校。`, affected(item.id, prior?.label || item.label));
    if (debt) debts.push(debt);
  }
  for (const item of previous) {
    if (after.has(item.id)) continue;
    const debt = createDebt(workspace, sourceType, item.id, item.label, "删除", `${sourceType}“${item.label}”已删除，仍依赖该设定的章节需要清理引用。`, affected(item.id, item.label));
    if (debt) debts.push(debt);
  }
  return debts;
}

export function detectPropagationDebts(previous: StoryControlSnapshot, current: StoryControlSnapshot, workspace: WorkspaceData) {
  const debts: PropagationDebt[] = [];
  const drafted = draftedNumbers(workspace);
  if (previous.projectSignature !== current.projectSignature) {
    const debt = createDebt(workspace, "整书契约", "project-core", workspace.project.title, "修改", "作品梗概、主题、文风或叙事视角发生变化，已完成章节可能仍执行旧的全局约束。", drafted);
    if (debt) debts.push(debt);
  }
  if (previous.bookContractSignature !== current.bookContractSignature) {
    const debt = createDebt(workspace, "整书契约", "book-contract", workspace.project.title, "修改", "读者承诺、卖点、兑现节点或创作红线发生变化，需要重新核对已完成章节。", drafted);
    if (debt) debts.push(debt);
  }
  debts.push(...diffItems(workspace, "人物", previous.characters, current.characters, (_id, label) => affectedByLabel(workspace, label)));
  debts.push(...diffItems(workspace, "世界规则", previous.world, current.world, (_id, label) => affectedByLabel(workspace, label)));
  debts.push(...diffItems(workspace, "大纲", previous.outline, current.outline, (id, label) => {
    const direct = workspace.chapters.filter((chapter) => chapter.content.trim() && chapter.outlineBeatId === id).map((chapter) => chapter.number);
    const first = direct.length ? Math.min(...direct) : undefined;
    return first ? drafted.filter((number) => number >= first) : affectedByLabel(workspace, label);
  }));
  return debts;
}

export function mergePropagationDebts(existing: PropagationDebt[], incoming: PropagationDebt[]) {
  const merged = [...existing];
  for (const debt of incoming) {
    const index = merged.findIndex((item) => item.sourceType === debt.sourceType && item.sourceId === debt.sourceId && item.status !== "已清偿");
    if (index < 0) merged.unshift(debt);
    else merged[index] = { ...merged[index], ...debt, id: merged[index].id, affectedChapters: [...new Set([...merged[index].affectedChapters, ...debt.affectedChapters])].sort((a, b) => a - b), status: "待复审" };
  }
  return merged.slice(0, 100);
}

export function syncStorylinesFromWorkspace(workspace: WorkspaceData): Storyline[] {
  const currentChapter = Math.max(0, ...draftedNumbers(workspace));
  const existing = new Map((workspace.storyControl?.storylines || []).map((item) => [item.id, item]));
  const lines: Storyline[] = [{
    id: "storyline-main",
    title: workspace.project.title,
    type: "主线",
    status: currentChapter ? "活跃" : "待回收",
    summary: workspace.project.premise,
    characterIds: workspace.characters.filter((item) => /主角|核心/.test(item.role)).map((item) => item.id),
    openedChapter: 1,
    lastAdvancedChapter: currentChapter,
    targetChapter: workspace.project.targetChapters,
  }];
  for (const thread of workspace.canon.threads) {
    const prior = existing.get(`storyline-thread-${thread.id}`);
    const gap = currentChapter - (thread.resolvedChapter || thread.openedChapter);
    lines.push({
      id: `storyline-thread-${thread.id}`,
      title: thread.title,
      type: "谜题线",
      status: thread.status === "resolved" ? "已完成" : gap >= 5 ? "停滞" : "待回收",
      summary: prior?.summary || "来自事实账本的未解决故事线。",
      characterIds: prior?.characterIds || [],
      openedChapter: thread.openedChapter,
      lastAdvancedChapter: prior?.lastAdvancedChapter || thread.openedChapter,
      targetChapter: prior?.targetChapter,
      linkedThreadId: thread.id,
    });
  }
  for (const relation of workspace.relationships) {
    const from = workspace.characters.find((item) => item.id === relation.fromId);
    const to = workspace.characters.find((item) => item.id === relation.toId);
    if (!from || !to) continue;
    const prior = existing.get(`storyline-relation-${relation.id}`);
    const romantic = /爱|恋|婚|夫妻|暧昧|感情/.test(relation.label + relation.description);
    lines.push({
      id: `storyline-relation-${relation.id}`,
      title: `${from.name} × ${to.name}`,
      type: romantic ? "感情线" : "人物线",
      status: prior?.status || "活跃",
      summary: relation.description || relation.label,
      characterIds: [from.id, to.id],
      openedChapter: prior?.openedChapter || 1,
      lastAdvancedChapter: prior?.lastAdvancedChapter || currentChapter,
      targetChapter: prior?.targetChapter,
    });
  }
  const generatedIds = new Set(lines.map((line) => line.id));
  const custom = (workspace.storyControl?.storylines || []).filter((line) => !generatedIds.has(line.id) && !line.id.startsWith("storyline-thread-") && !line.id.startsWith("storyline-relation-"));
  return [...lines, ...custom];
}

export function deriveCharacterInteractions(workspace: WorkspaceData) {
  return workspace.relationships.map((relation) => {
    const from = workspace.characters.find((item) => item.id === relation.fromId);
    const to = workspace.characters.find((item) => item.id === relation.toId);
    const chapters = workspace.chapters.filter((chapter) => {
      const names = chapter.memory?.characterUpdates?.map((item) => item.name) || [];
      return Boolean(from && to && names.includes(from.name) && names.includes(to.name));
    }).map((chapter) => chapter.number);
    return { id: relation.id, from: from?.name || "未知", to: to?.name || "未知", label: relation.label, tone: relation.tone, count: chapters.length, lastChapter: chapters.length ? Math.max(...chapters) : 0 };
  }).sort((a, b) => b.lastChapter - a.lastChapter || b.count - a.count);
}

export function deriveResourceLedger(workspace: WorkspaceData): ResourceLedgerEntry[] {
  const manual = (workspace.storyControl?.resourceLedger || []).filter((item) => item.source === "manual");
  const derived = new Map<string, ResourceLedgerEntry>();
  const latestStates = [...workspace.canon.characterStates].sort((a, b) => a.chapterNumber - b.chapterNumber);
  for (const state of latestStates) {
    if (state.physical && !/正常|健康|无伤/.test(state.physical)) {
      derived.set(`canon-injury-${state.name}`, { id: `canon-injury-${state.name}`, ownerName: state.name, type: "伤势", name: "身体状态", state: state.physical, lastChapter: state.chapterNumber, source: "canon", status: /痊愈|恢复/.test(state.physical) ? "解决" : "持有" });
    }
    for (const item of state.inventory || []) {
      derived.set(`canon-item-${state.name}-${item}`, { id: `canon-item-${state.name}-${item}`, ownerName: state.name, type: "道具", name: item, state: "人物记忆记录为持有", lastChapter: state.chapterNumber, source: "canon", status: "持有" });
    }
    for (const knowledge of (state.knowledge || []).slice(-10)) {
      derived.set(`canon-secret-${state.name}-${knowledge}`, { id: `canon-secret-${state.name}-${knowledge}`, ownerName: state.name, type: "秘密", name: knowledge.slice(0, 80), state: "该人物已经知情", lastChapter: state.chapterNumber, source: "canon", status: "持有" });
    }
  }
  return [...manual, ...derived.values()].sort((a, b) => b.lastChapter - a.lastChapter).slice(0, 200);
}

export function propagationDebtIssues(workspace: WorkspaceData): ConsistencyIssue[] {
  return (workspace.storyControl?.propagationDebts || []).filter((debt) => debt.status !== "已清偿").flatMap((debt) => debt.affectedChapters.map((chapterNumber) => ({
    id: `propagation-${debt.id}-${chapterNumber}`,
    severity: "警告" as const,
    category: debt.sourceType === "人物" ? "人物" as const : debt.sourceType === "世界规则" ? "世界规则" as const : "情节" as const,
    title: `设定变更传播债务：${debt.sourceTitle}`,
    description: debt.reason,
    location: `第 ${chapterNumber} 章`,
    resolved: false,
    chapterNumber,
    source: "local" as const,
    suggestedFix: "按章节顺序重新审校；只修复仍引用旧设定的具体段落，并在修复后重建事实记忆。",
  })));
}
