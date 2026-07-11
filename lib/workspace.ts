import { MAX_STAGE_OUTPUT_TOKENS } from "./ai-limits";
import { createAutomationState } from "./auto-novel";
import type {
  AutomationPhase,
  BlueprintDraft,
  CanonLedger,
  ChapterMemory,
  ChapterStatus,
  ConsistencyIssue,
  Material,
  NovelAutomation,
  OutlineBeat,
  Relationship,
  StorySeed,
  WorkspaceData,
  WorldEntry,
} from "./types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function objects(value: unknown, limit = 500): JsonRecord[] {
  return Array.isArray(value)
    ? value.slice(0, limit).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function stringValue(value: unknown, fallback = "", max = 200_000) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function stringList(value: unknown, limit = 30) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 200)).slice(0, limit)
    : [];
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function dateValue(value: unknown) {
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) return value;
  return new Date().toISOString();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function nextId(prefix: string, raw: unknown, index: number, seen: Set<string>) {
  const candidate = typeof raw === "string" && raw.trim() ? raw.slice(0, 160) : `${prefix}-${Date.now()}-${index + 1}`;
  let result = candidate;
  let suffix = 2;
  while (seen.has(result)) result = `${candidate}-${suffix++}`;
  seen.add(result);
  return result;
}

function normalizeSeeds(value: unknown): StorySeed[] {
  const seen = new Set<string>();
  return objects(value, 3).flatMap((source, index) => {
    const title = stringValue(source.title).trim();
    const premise = stringValue(source.premise).trim();
    if (!title || !premise) return [];
    return [{
      id: nextId("seed", source.id, index, seen),
      title,
      genre: stringValue(source.genre, "类型待定", 120),
      hook: stringValue(source.hook, premise, 500),
      premise,
      theme: stringValue(source.theme, "", 1000),
      protagonist: stringValue(source.protagonist, "", 1000),
      centralConflict: stringValue(source.centralConflict, premise, 2000),
      endingTone: stringValue(source.endingTone, "", 500),
      reason: stringValue(source.reason, "", 1000),
      recommended: source.recommended === true,
    }];
  });
}

export function normalizeWorkspaceData(
  value: unknown,
  fallback: WorkspaceData,
  options: { preserveWritingPhase?: boolean } = {},
): WorkspaceData {
  const source = record(value);
  const rawProject = record(source.project);
  if (typeof rawProject.title !== "string" || !rawProject.title.trim()) {
    throw new Error("作品数据缺少有效书名");
  }
  if (!Array.isArray(source.chapters)) {
    throw new Error("作品数据缺少章节列表");
  }

  const characterIds = new Set<string>();
  const characters = objects(source.characters, 100).map((item, index) => ({
    id: nextId("char", item.id, index, characterIds),
    name: stringValue(item.name, `人物 ${index + 1}`, 120),
    role: stringValue(item.role, "配角", 120),
    age: stringValue(item.age, "", 80),
    identity: stringValue(item.identity, "", 1000),
    goal: stringValue(item.goal, "", 4000),
    conflict: stringValue(item.conflict, "", 4000),
    arc: stringValue(item.arc, "", 4000),
    traits: stringList(item.traits, 20),
    color: /^#[0-9a-f]{6}$/i.test(String(item.color)) ? String(item.color) : "#4f46e5",
  }));

  const worldIds = new Set<string>();
  const world = objects(source.world, 200).map((item, index) => ({
    id: nextId("world", item.id, index, worldIds),
    category: enumValue<WorldEntry["category"]>(item.category, ["地点", "势力", "规则", "历史", "物件"], "规则"),
    title: stringValue(item.title, `设定 ${index + 1}`, 200),
    summary: stringValue(item.summary, "", 4000),
    details: stringValue(item.details, "", 20_000),
  }));

  const outlineIds = new Set<string>();
  const outline = objects(source.outline, 200).map((item, index) => ({
    id: nextId("beat", item.id, index, outlineIds),
    act: stringValue(item.act, `阶段 ${index + 1}`, 200),
    title: stringValue(item.title, `节点 ${index + 1}`, 300),
    summary: stringValue(item.summary, "", 10_000),
    chapterRange: stringValue(item.chapterRange, "待分配", 120),
    status: enumValue<OutlineBeat["status"]>(item.status, ["待规划", "进行中", "已完成"], "待规划"),
  }));

  const chapterIds = new Set<string>();
  const usedNumbers = new Set<number>();
  const chapters = objects(source.chapters, 200).map((item, index) => {
    let chapterNumber = numberValue(item.number, index + 1, 1, 9999);
    while (usedNumbers.has(chapterNumber)) chapterNumber += 1;
    usedNumbers.add(chapterNumber);
    const outlineBeatId = typeof item.outlineBeatId === "string" && outlineIds.has(item.outlineBeatId)
      ? item.outlineBeatId
      : undefined;
    const rawChapterOutline = record(item.chapterOutline);
    const summaryFallback = stringValue(item.summary, "", 20_000);
    const rawScenes = stringList(rawChapterOutline.scenes, 12);
    const chapterOutline = {
      objective: stringValue(rawChapterOutline.objective, summaryFallback || "推进本章核心冲突", 4000),
      opening: stringValue(rawChapterOutline.opening, "承接上一章的未解问题进入场景", 4000),
      scenes: rawScenes.length ? rawScenes : [summaryFallback || "人物在场景中行动、受阻并做出选择"],
      turningPoint: stringValue(rawChapterOutline.turningPoint, "主角做出不可逆选择并付出代价", 4000),
      endingHook: stringValue(rawChapterOutline.endingHook, "以新问题或危机引向下一章", 4000),
      foreshadowActions: objects(rawChapterOutline.foreshadowActions, 20).flatMap((action) => {
        const title = stringValue(action.title, "", 500).trim();
        if (!title) return [];
        return [{
          title,
          action: enumValue(action.action, ["plant", "advance", "resolve"] as const, "advance"),
          instruction: stringValue(action.instruction, "", 4000),
        }];
      }),
    };
    const rawMemory = record(item.memory);
    const memory: ChapterMemory | undefined = typeof rawMemory.summary === "string" ? {
      evidenceVersion: rawMemory.evidenceVersion === 1 ? 1 : undefined,
      summary: stringValue(rawMemory.summary, "", 20_000),
      timelineEvents: stringList(rawMemory.timelineEvents, 100),
      timelineEvidence: objects(rawMemory.timelineEvidence, 100).flatMap((entry) => {
        const event = stringValue(entry.event, "", 4000).trim();
        return event ? [{ event, quote: typeof entry.quote === "string" ? entry.quote.slice(0, 2000) : undefined, verified: Boolean(entry.verified) }] : [];
      }),
      characterUpdates: objects(rawMemory.characterUpdates, 100).map((update) => ({
        name: stringValue(update.name, "\u672a\u77e5\u4eba\u7269", 200),
        state: stringValue(update.state, "", 4000),
        location: typeof update.location === "string" ? update.location.slice(0, 1000) : undefined,
        physical: typeof update.physical === "string" ? update.physical.slice(0, 1000) : undefined,
        emotion: typeof update.emotion === "string" ? update.emotion.slice(0, 1000) : undefined,
        knowledge: stringList(update.knowledge, 100),
        inventory: stringList(update.inventory, 100),
        goal: typeof update.goal === "string" ? update.goal.slice(0, 2000) : undefined,
        quote: typeof update.quote === "string" ? update.quote.slice(0, 2000) : undefined,
        verified: typeof update.verified === "boolean" ? update.verified : undefined,
      })),
      openedThreads: stringList(rawMemory.openedThreads, 100),
      resolvedThreads: stringList(rawMemory.resolvedThreads, 100),
      threadEvidence: objects(rawMemory.threadEvidence, 100).flatMap((entry) => {
        const title = stringValue(entry.title, "", 1000).trim();
        return title ? [{ title, status: enumValue(entry.status, ["opened", "resolved"] as const, "opened"), quote: typeof entry.quote === "string" ? entry.quote.slice(0, 2000) : undefined, verified: Boolean(entry.verified) }] : [];
      }),
      establishedFacts: stringList(rawMemory.establishedFacts, 200),
      factEvidence: objects(rawMemory.factEvidence, 200).flatMap((entry) => {
        const fact = stringValue(entry.fact, "", 4000).trim();
        return fact ? [{ fact, quote: typeof entry.quote === "string" ? entry.quote.slice(0, 2000) : undefined, verified: Boolean(entry.verified) }] : [];
      }),
      outlineEvidence: objects(rawMemory.outlineEvidence, 100).map((entry, index) => ({
        key: enumValue(entry.key, ["objective", "opening", "scene", "turningPoint", "endingHook"] as const, "scene"),
        label: stringValue(entry.label, `outline-${index + 1}`, 1000),
        status: enumValue(entry.status, ["executed", "partial", "missing"] as const, "missing"),
        score: numberValue(entry.score, 0, 0, 100),
        evidence: typeof entry.evidence === "string" ? entry.evidence.slice(0, 4000) : undefined,
        quote: typeof entry.quote === "string" ? entry.quote.slice(0, 1000) : undefined,
        verified: Boolean(entry.verified),
      })),
      foreshadowUpdates: objects(rawMemory.foreshadowUpdates, 100).flatMap((update) => {
        const title = stringValue(update.title, "", 500).trim();
        if (!title) return [];
        return [{
          title,
          status: enumValue(update.status, ["planted", "advanced", "resolved"] as const, "advanced"),
          evidence: stringValue(update.evidence, "", 4000),
          quote: typeof update.quote === "string" ? update.quote.slice(0, 1000) : undefined,
          verified: Boolean(update.verified),
        }];
      }),
    } : undefined;
    const rawQuality = record(item.quality);
    const quality = typeof rawQuality.overall === "number" ? {
      overall: numberValue(rawQuality.overall, 0, 0, 100),
      length: numberValue(rawQuality.length, 0, 0, 100),
      outline: numberValue(rawQuality.outline, 0, 0, 100),
      continuity: numberValue(rawQuality.continuity, 0, 0, 100),
      foreshadow: numberValue(rawQuality.foreshadow, 0, 0, 100),
      style: numberValue(rawQuality.style, 0, 0, 100),
      evaluatedAt: dateValue(rawQuality.evaluatedAt),
      notes: stringList(rawQuality.notes, 20),
      outlineEvidence: objects(rawQuality.outlineEvidence, 100).map((entry, index) => ({
        key: enumValue(entry.key, ["objective", "opening", "scene", "turningPoint", "endingHook"] as const, "scene"),
        label: stringValue(entry.label, `outline-${index + 1}`, 1000),
        status: enumValue(entry.status, ["executed", "partial", "missing"] as const, "missing"),
        score: numberValue(entry.score, 0, 0, 100),
        evidence: typeof entry.evidence === "string" ? entry.evidence.slice(0, 4000) : undefined,
        quote: typeof entry.quote === "string" ? entry.quote.slice(0, 1000) : undefined,
        verified: Boolean(entry.verified),
      })),
    } : undefined;
    const rawRepairReview = record(item.repairReview);
    const repairReview = typeof rawRepairReview.beforeVersionId === "string" ? {
      beforeVersionId: rawRepairReview.beforeVersionId.slice(0, 200),
      changeSummary: stringValue(rawRepairReview.changeSummary, "", 4000),
      createdAt: dateValue(rawRepairReview.createdAt),
      status: enumValue(rawRepairReview.status, ["pending", "accepted", "reverted"] as const, "pending"),
    } : undefined;
    const rawGeneration = record(item.generation);
    const generation = typeof rawGeneration.runId === "string" ? {
      runId: rawGeneration.runId.slice(0, 200),
      status: enumValue(rawGeneration.status, ["planned", "generating", "generated", "audited", "repairing", "accepted", "blocked"] as const, "planned"),
      completedSegments: numberValue(rawGeneration.completedSegments, 0, 0, 20),
      baseRevision: numberValue(rawGeneration.baseRevision, 0, 0, 1_000_000),
      repairAttempts: numberValue(rawGeneration.repairAttempts, 0, 0, 10),
      draftAttempts: numberValue(rawGeneration.draftAttempts, 0, 0, 1_000),
      acceptedAt: typeof rawGeneration.acceptedAt === "string" ? rawGeneration.acceptedAt.slice(0, 100) : undefined,
    } : undefined;
    return {
      id: nextId("chapter", item.id, index, chapterIds),
      number: chapterNumber,
      title: stringValue(item.title, `第 ${chapterNumber} 章`, 300),
      summary: stringValue(item.summary, "", 20_000),
      content: stringValue(item.content, "", 2_000_000),
      status: enumValue<ChapterStatus>(item.status, ["待生成", "草稿", "修订中", "已完成"], "草稿"),
      updatedAt: dateValue(item.updatedAt),
      outlineBeatId,
      pov: typeof item.pov === "string" ? item.pov.slice(0, 200) : undefined,
      targetWords: numberValue(item.targetWords, 4000, 100, 50_000),
      chapterOutline,
      revision: numberValue(item.revision, 0, 0, 1_000_000),
      memory,
      quality,
      repairReview,
      generation,
    };
  }).sort((a, b) => a.number - b.number);

  const relationshipIds = new Set<string>();
  const relationships: Relationship[] = objects(source.relationships, 500).flatMap((item, index) => {
    if (typeof item.fromId !== "string" || typeof item.toId !== "string" || !characterIds.has(item.fromId) || !characterIds.has(item.toId) || item.fromId === item.toId) return [];
    return [{
      id: nextId("rel", item.id, index, relationshipIds),
      fromId: item.fromId,
      toId: item.toId,
      label: stringValue(item.label, "复杂关系", 300),
      tone: enumValue<Relationship["tone"]>(item.tone, ["正向", "复杂", "对立", "未知"], "复杂"),
      description: stringValue(item.description, "", 10_000),
    }];
  });

  const ideaIds = new Set<string>();
  const ideas = objects(source.ideas, 500).map((item, index) => ({
    id: nextId("idea", item.id, index, ideaIds),
    title: stringValue(item.title, `灵感 ${index + 1}`, 300),
    content: stringValue(item.content, "", 30_000),
    tags: stringList(item.tags),
    favorite: item.favorite === true,
    createdAt: dateValue(item.createdAt),
  }));

  const issueIds = new Set<string>();
  const issues: ConsistencyIssue[] = objects(source.issues, 1000).map((item, index) => ({
    id: nextId("issue", item.id, index, issueIds),
    severity: enumValue<ConsistencyIssue["severity"]>(item.severity, ["错误", "警告", "提示"], "提示"),
    category: enumValue<ConsistencyIssue["category"]>(item.category, ["时间线", "人物", "世界规则", "情节", "文风"], "情节"),
    title: stringValue(item.title, `问题 ${index + 1}`, 500),
    description: stringValue(item.description, "", 20_000),
    location: stringValue(item.location, "未指定", 500),
    resolved: item.resolved === true,
    chapterNumber: Number.isInteger(item.chapterNumber) ? numberValue(item.chapterNumber, 1, 1, 9999) : undefined,
    evidence: typeof item.evidence === "string" ? item.evidence.slice(0, 10_000) : undefined,
    suggestedFix: typeof item.suggestedFix === "string" ? item.suggestedFix.slice(0, 10_000) : undefined,
    source: enumValue(item.source, ["local", "ai"] as const, "local"),
    fingerprint: typeof item.fingerprint === "string" ? item.fingerprint.slice(0, 200) : undefined,
  }));

  const materialIds = new Set<string>();
  const materials: Material[] = objects(source.materials, 1000).map((item, index) => ({
    id: nextId("material", item.id, index, materialIds),
    type: enumValue<Material["type"]>(item.type, ["伏笔", "摘录", "研究", "场景", "对白"], "摘录"),
    title: stringValue(item.title, `素材 ${index + 1}`, 500),
    content: stringValue(item.content, "", 50_000),
    tags: stringList(item.tags),
    createdAt: dateValue(item.createdAt),
    foreshadowPlan: (() => {
      const explicit = objects(item.foreshadowPlan, 30).flatMap((step) => {
        if (!Number.isInteger(step.chapterNumber)) return [];
        return [{
          chapterNumber: numberValue(step.chapterNumber, 1, 1, 9999),
          action: enumValue(step.action, ["plant", "advance", "resolve"] as const, "advance"),
          instruction: stringValue(step.instruction, "", 4000),
        }];
      });
      if (explicit.length) return explicit;
      const tagged = stringList(item.tags, 30).flatMap((tag) => {
        const match = tag.match(/^第\s*(\d+)\s*章$/);
        return match ? [Number(match[1])] : [];
      }).sort((a, b) => a - b);
      return tagged.map((chapterNumber, stepIndex) => ({
        chapterNumber,
        action: stepIndex === 0 ? "plant" as const : stepIndex === tagged.length - 1 ? "resolve" as const : "advance" as const,
        instruction: stepIndex === 0 ? "自然埋设伏笔" : stepIndex === tagged.length - 1 ? "回收伏笔并影响剧情" : "升级伏笔或制造误导",
      }));
    })(),
  }));

  const versionIds = new Set<string>();
  const versions = objects(source.versions, 2000).flatMap((item, index) => {
    if (typeof item.chapterId !== "string" || !chapterIds.has(item.chapterId)) return [];
    return [{
      id: nextId("version", item.id, index, versionIds),
      chapterId: item.chapterId,
      title: stringValue(item.title, "章节版本", 300),
      content: stringValue(item.content, "", 2_000_000),
      createdAt: dateValue(item.createdAt),
      note: stringValue(item.note, "历史版本", 500),
    }];
  });

  const rawAutomation = record(source.automation);
  const rawUsage = record(rawAutomation.usage);
  const rawWritingRange = record(rawAutomation.writingRange);
  const firstChapterNumber = chapters[0]?.number || 1;
  const lastChapterNumber = chapters.at(-1)?.number || firstChapterNumber;
  const rangeFrom = numberValue(rawWritingRange.fromChapter, firstChapterNumber, firstChapterNumber, lastChapterNumber);
  const rangeTo = numberValue(rawWritingRange.toChapter, lastChapterNumber, firstChapterNumber, lastChapterNumber);
  const rawBlueprintDraft = record(rawAutomation.blueprintDraft);
  const draftStage = numberValue(rawBlueprintDraft.completedStage, 0, 0, 5) as BlueprintDraft["completedStage"];
  const blueprintDraft: BlueprintDraft | undefined = typeof rawBlueprintDraft.seedId === "string" && rawBlueprintDraft.seedId.trim()
    ? {
        seedId: rawBlueprintDraft.seedId.slice(0, 160),
        completedStage: draftStage,
        ...(draftStage >= 1 && Object.keys(record(rawBlueprintDraft.foundation)).length ? { foundation: record(rawBlueprintDraft.foundation) } : {}),
        ...(draftStage >= 2 && Object.keys(record(rawBlueprintDraft.world)).length ? { world: record(rawBlueprintDraft.world) } : {}),
        ...(draftStage >= 3 && Object.keys(record(rawBlueprintDraft.outline)).length ? { outline: record(rawBlueprintDraft.outline) } : {}),
        ...(draftStage >= 4 && Object.keys(record(rawBlueprintDraft.foreshadows)).length ? { foreshadows: record(rawBlueprintDraft.foreshadows) } : {}),
        ...(draftStage >= 5 && Object.keys(record(rawBlueprintDraft.chapters)).length ? { chapters: record(rawBlueprintDraft.chapters) } : {}),
      }
    : undefined;
  const allowedPhases: AutomationPhase[] = ["idle", "ideating", "choosing", "planning", "ready", "writing", "paused", "completed", "error"];
  const storedPhase = enumValue<AutomationPhase>(rawAutomation.phase, allowedPhases, "idle");
  const automation = createAutomationState({
    runId: typeof rawAutomation.runId === "string" ? rawAutomation.runId.slice(0, 200) : undefined,
    phase: storedPhase === "writing" && !options.preserveWritingPhase ? "paused" : storedPhase,
    brief: stringValue(rawAutomation.brief, "", 10_000),
    seeds: normalizeSeeds(rawAutomation.seeds),
    selectedSeedId: typeof rawAutomation.selectedSeedId === "string" ? rawAutomation.selectedSeedId.slice(0, 160) : undefined,
    targetChapters: numberValue(rawAutomation.targetChapters, fallback.automation.targetChapters, 4, 60),
    targetWords: numberValue(rawAutomation.targetWords, fallback.automation.targetWords, 10_000, 600_000),
    chapterWords: numberValue(rawAutomation.chapterWords, fallback.automation.chapterWords, 1200, 12_000),
    currentChapterNumber: numberValue(rawAutomation.currentChapterNumber, 0, 0, 9999),
    currentSegment: numberValue(rawAutomation.currentSegment, 0, 0, 20),
    generatedChapterIds: stringList(rawAutomation.generatedChapterIds, 200).filter((item) => chapterIds.has(item)),
    writingRange: chapters.length ? {
      fromChapter: Math.min(rangeFrom, rangeTo),
      toChapter: Math.max(rangeFrom, rangeTo),
    } : undefined,
    usage: {
      requestCount: numberValue(rawUsage.requestCount, 0, 0, 1_000_000),
      inputTokens: numberValue(rawUsage.inputTokens, 0, 0, 1_000_000_000),
      outputTokens: numberValue(rawUsage.outputTokens, 0, 0, 1_000_000_000),
      totalTokens: numberValue(rawUsage.totalTokens, 0, 0, 1_000_000_000),
    },
    maxRequests: numberValue(rawAutomation.maxRequests, 250, 1, 10_000),
    maxTokens: numberValue(rawAutomation.maxTokens, 5_000_000, 1_000, 1_000_000_000),
    stageModels: Object.fromEntries(Object.entries(record(rawAutomation.stageModels)).flatMap(([stage, value]) => {
      if (!["ideation", "blueprint", "chapter", "memory", "audit", "repair"].includes(stage)) return [];
      const config = record(value);
      return [[stage, {
        model: typeof config.model === "string" ? config.model.slice(0, 300) : undefined,
        maxOutputTokens: typeof config.maxOutputTokens === "number" ? numberValue(config.maxOutputTokens, 16_384, 256, MAX_STAGE_OUTPUT_TOKENS) : undefined,
        temperature: typeof config.temperature === "number" && Number.isFinite(config.temperature) ? Math.min(2, Math.max(0, Math.round(config.temperature * 10) / 10)) : undefined,
        reasoningEffort: ["none", "low", "medium", "high", "xhigh"].includes(String(config.reasoningEffort)) ? config.reasoningEffort : undefined,
        verbosity: ["low", "medium", "high"].includes(String(config.verbosity)) ? config.verbosity : undefined,
      }]];
    })),
    taskLog: objects(rawAutomation.taskLog, 500).map((item, index) => ({
      id: stringValue(item.id, "task-" + (index + 1), 200),
      runId: typeof item.runId === "string" ? item.runId.slice(0, 200) : undefined,
      kind: stringValue(item.kind, "task", 200), label: stringValue(item.label, "AI 任务", 500),
      status: enumValue(item.status, ["queued", "running", "completed", "failed", "cancelled"] as const, "completed"),
      chapterNumber: typeof item.chapterNumber === "number" ? numberValue(item.chapterNumber, 1, 1, 9999) : undefined,
      startedAt: dateValue(item.startedAt), finishedAt: typeof item.finishedAt === "string" ? dateValue(item.finishedAt) : undefined,
      error: typeof item.error === "string" ? item.error.slice(0, 2000) : undefined,
    })),
    lastError: typeof rawAutomation.lastError === "string" ? rawAutomation.lastError.slice(0, 2000) : undefined,
    blueprintDraft,
    updatedAt: typeof rawAutomation.updatedAt === "string" ? dateValue(rawAutomation.updatedAt) : undefined,
  } as Partial<NovelAutomation>);

  const rawCanon = record(source.canon);
  const canon: CanonLedger = {
    revision: numberValue(rawCanon.revision, 0, 0, 1_000_000),
    chapterSummaries: objects(rawCanon.chapterSummaries, 500).flatMap((item) => {
      if (typeof item.chapterId !== "string" || !chapterIds.has(item.chapterId)) return [];
      return [{
        chapterId: item.chapterId,
        chapterNumber: numberValue(item.chapterNumber, 1, 1, 9999),
        summary: stringValue(item.summary, "", 20_000),
      }];
    }),
    timeline: objects(rawCanon.timeline, 5000).map((item, index) => ({
      id: stringValue(item.id, `timeline-${index + 1}`, 200),
      chapterNumber: numberValue(item.chapterNumber, 1, 1, 9999),
      event: stringValue(item.event, "", 4000),
    })),
    characterStates: objects(rawCanon.characterStates, 2000).map((item) => ({
      characterId: typeof item.characterId === "string" && characterIds.has(item.characterId) ? item.characterId : undefined,
      name: stringValue(item.name, "未知人物", 200),
      state: stringValue(item.state, "", 4000),
      chapterNumber: numberValue(item.chapterNumber, 1, 1, 9999),
      location: typeof item.location === "string" ? item.location.slice(0, 500) : undefined,
      physical: typeof item.physical === "string" ? item.physical.slice(0, 1000) : undefined,
      emotion: typeof item.emotion === "string" ? item.emotion.slice(0, 1000) : undefined,
      knowledge: stringList(item.knowledge, 100),
      inventory: stringList(item.inventory, 100),
      goal: typeof item.goal === "string" ? item.goal.slice(0, 2000) : undefined,
    })),
    threads: objects(rawCanon.threads, 2000).map((item, index) => ({
      id: stringValue(item.id, `thread-${index + 1}`, 200),
      title: stringValue(item.title, `线索 ${index + 1}`, 1000),
      status: enumValue(item.status, ["open", "resolved"] as const, "open"),
      openedChapter: numberValue(item.openedChapter, 1, 1, 9999),
      resolvedChapter: item.resolvedChapter === undefined ? undefined : numberValue(item.resolvedChapter, 1, 1, 9999),
    })),
    facts: objects(rawCanon.facts, 5000).map((item, index) => ({
      id: stringValue(item.id, `fact-${index + 1}`, 200),
      chapterNumber: numberValue(item.chapterNumber, 1, 1, 9999),
      fact: stringValue(item.fact, "", 4000),
      level: enumValue(item.level, ["author", "text", "ai_verified", "inferred"] as const, "inferred"),
      evidence: typeof item.evidence === "string" ? item.evidence.slice(0, 2000) : undefined,
    })),
    lastAuditedChapter: numberValue(rawCanon.lastAuditedChapter, 0, 0, 9999),
  };

  return {
    project: {
      title: rawProject.title.trim().slice(0, 300),
      genre: stringValue(rawProject.genre, fallback.project.genre, 300),
      status: stringValue(rawProject.status, fallback.project.status, 120),
      premise: stringValue(rawProject.premise, fallback.project.premise, 20_000),
      theme: stringValue(rawProject.theme, fallback.project.theme, 20_000),
      targetWords: numberValue(rawProject.targetWords, fallback.project.targetWords, 1000, 2_000_000),
      targetChapters: numberValue(rawProject.targetChapters, fallback.project.targetChapters, 1, 200),
      writingStyle: stringValue(rawProject.writingStyle, fallback.project.writingStyle, 20_000),
      pointOfView: stringValue(rawProject.pointOfView, fallback.project.pointOfView, 1000),
    },
    ideas,
    world,
    characters,
    relationships,
    outline,
    chapters,
    issues,
    materials,
    versions,
    canon,
    automation,
  };
}

export function cloneWorkspace(workspace: WorkspaceData): WorkspaceData {
  return JSON.parse(JSON.stringify(workspace)) as WorkspaceData;
}

export function createBlankWorkspace(fallback: WorkspaceData): WorkspaceData {
  return {
    project: {
      title: "未命名新作",
      genre: "待定",
      status: "筹备中",
      premise: "",
      theme: "",
      targetWords: 80000,
      targetChapters: 16,
      writingStyle: "",
      pointOfView: "第三人称限知",
    },
    ideas: [],
    world: [],
    characters: [],
    relationships: [],
    outline: [],
    chapters: [],
    issues: [],
    materials: [],
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
    automation: createAutomationState({
      targetChapters: fallback.automation.targetChapters,
      targetWords: fallback.automation.targetWords,
      chapterWords: fallback.automation.chapterWords,
      maxRequests: fallback.automation.maxRequests,
      maxTokens: fallback.automation.maxTokens,
    }),
  };
}

const MAX_VERSIONS_PER_CHAPTER = 12;
const MAX_RESOLVED_ISSUES = 400;
const MAX_TASK_LOGS = 200;

export function pruneWorkspaceHistory(workspace: WorkspaceData): WorkspaceData {
  const versionCounts = new Map<string, number>();
  const versions = [...workspace.versions]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((version) => {
      const count = versionCounts.get(version.chapterId) || 0;
      if (count >= MAX_VERSIONS_PER_CHAPTER) return false;
      versionCounts.set(version.chapterId, count + 1);
      return true;
    });
  const unresolved = workspace.issues.filter((issue) => !issue.resolved);
  const resolved = workspace.issues.filter((issue) => issue.resolved).slice(-MAX_RESOLVED_ISSUES);
  return {
    ...workspace,
    versions,
    issues: [...resolved, ...unresolved],
    automation: {
      ...workspace.automation,
      taskLog: (workspace.automation.taskLog || []).slice(0, MAX_TASK_LOGS),
    },
  };
}

export function mergeAutomationWorkspace(local: WorkspaceData, remote: WorkspaceData): WorkspaceData {
  const localById = new Map(local.chapters.map((chapter) => [chapter.id, chapter]));
  let preservedManualChapter = false;
  const chapters = remote.chapters.map((remoteChapter) => {
    const localChapter = localById.get(remoteChapter.id);
    if (!localChapter) return remoteChapter;
    const localRevision = localChapter.revision || 0;
    const remoteRevision = remoteChapter.revision || 0;
    if (localRevision > remoteRevision) {
      preservedManualChapter = true;
      return localChapter;
    }
    if (localRevision < remoteRevision) return remoteChapter;
    return localChapter.updatedAt > remoteChapter.updatedAt ? localChapter : remoteChapter;
  });
  for (const localChapter of local.chapters) {
    if (!remote.chapters.some((chapter) => chapter.id === localChapter.id)) chapters.push(localChapter);
  }
  const issueMap = new Map(local.issues.map((issue) => [issue.id, issue]));
  for (const issue of remote.issues) issueMap.set(issue.id, issue);
  const versionMap = new Map(local.versions.map((version) => [version.id, version]));
  for (const version of remote.versions) versionMap.set(version.id, version);
  return pruneWorkspaceHistory({
    ...local,
    project: { ...local.project, status: remote.project.status },
    chapters: chapters.sort((left, right) => left.number - right.number),
    issues: [...issueMap.values()],
    versions: [...versionMap.values()],
    canon: preservedManualChapter ? local.canon : remote.canon,
    automation: remote.automation,
  });
}
