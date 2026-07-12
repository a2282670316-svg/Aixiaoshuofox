import type {
  CanonLedger,
  Chapter,
  ChapterCandidate,
  CharacterVoiceProfile,
  ConsistencyIssue,
  ContextManifest,
  ContextManifestItem,
  PacingPoint,
  WorkspaceData,
  WritingPreferenceProfile,
} from "./types";

function estimateTokens(value: unknown) {
  const serialized = JSON.stringify(value ?? null);
  return Math.max(1, Math.ceil(serialized.length / 2.4));
}

function preview(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").slice(0, 180);
}

export function compileContextManifest(
  workspace: WorkspaceData,
  target: Chapter,
  budgetTokens = 16_000,
  inputs: { verifiedCanon?: CanonLedger; existingDraft?: string; foreshadowTasks?: unknown[]; narrativeRecaps?: Array<{ chapterNumber: number; summary: string; warning?: string }> } = {},
): ContextManifest {
  const verifiedCanon = inputs.verifiedCanon || workspace.canon;
  const previous = [...workspace.chapters].sort((a, b) => a.number - b.number).find((item) => item.number === target.number - 1);
  const povCharacterNames = workspace.characters.filter((character) => target.pov?.includes(character.name)).map((character) => character.name);
  if (!povCharacterNames.length && target.pov) povCharacterNames.push(target.pov);
  const latestStates = [...verifiedCanon.characterStates]
    .filter((item) => item.chapterNumber < target.number)
    .sort((a, b) => b.chapterNumber - a.chapterNumber)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.name === item.name) === index);
  const openThreads = verifiedCanon.threads.filter((item) => item.openedChapter < target.number && (item.status === "open" || (item.resolvedChapter || 0) >= target.number));
  const eventTerms = new Set([
    target.pov,
    ...workspace.characters.filter((item) => JSON.stringify(target.chapterOutline || target.summary).includes(item.name)).map((item) => item.name),
    ...(target.chapterOutline?.foreshadowActions || []).map((item) => item.title),
  ].filter(Boolean) as string[]);
  const relevantEvents = (verifiedCanon.narrativeEvents || [])
    .filter((item) => item.chapterNumber < target.number && (item.chapterNumber >= target.number - 4 || item.participants.some((name) => eventTerms.has(name)) || [...eventTerms].some((term) => item.event.includes(term))))
    .slice(-80);
  const knowledge = (verifiedCanon.knowledgeStates || [])
    .filter((item) => item.chapterNumber < target.number && (!povCharacterNames.length || povCharacterNames.includes(item.characterName)))
    .slice(-80);
  const verifiedFacts = {
    timeline: verifiedCanon.timeline.filter((item) => item.chapterNumber < target.number),
    facts: verifiedCanon.facts.filter((item) => item.chapterNumber < target.number),
  };
  const foreshadowTasks = inputs.foreshadowTasks || target.chapterOutline?.foreshadowActions || [];
  const problems = workspace.issues
    .filter((item) => !item.resolved && (!item.chapterNumber || item.chapterNumber <= target.number))
    .map((item) => ({ title: item.title, description: item.description, suggestedFix: item.suggestedFix }));
  const narrativeRecaps = inputs.narrativeRecaps || verifiedCanon.chapterSummaries
    .filter((item) => item.chapterNumber < target.number)
    .map((item) => ({ chapterNumber: item.chapterNumber, summary: item.summary, warning: "导航摘要，不能单独用作事实证据" }));
  const candidates: Array<Omit<ContextManifestItem, "included"> & { required?: boolean; payload: unknown }> = [
    { id: "contract", section: "整书契约", source: "project.bookContract", reason: "固定读者承诺、卖点与红线", priority: 100, estimatedTokens: estimateTokens(workspace.project.bookContract), contentPreview: preview(workspace.project.bookContract), required: true, payload: workspace.project.bookContract },
    { id: "project-identity", section: "作品定位", source: "project", reason: "固定题材、主题、文风与叙事视角", priority: 100, estimatedTokens: estimateTokens({ title: workspace.project.title, genre: workspace.project.genre, premise: workspace.project.premise, theme: workspace.project.theme, writingStyle: workspace.project.writingStyle, pointOfView: workspace.project.pointOfView }), contentPreview: preview(workspace.project), required: true, payload: workspace.project },
    { id: "chapter-outline", section: "本章章纲", source: `chapters.${target.number}.chapterOutline`, reason: "当前章节的硬性执行目标", priority: 100, estimatedTokens: estimateTokens(target.chapterOutline || target.summary), contentPreview: preview(target.chapterOutline || target.summary), required: true, payload: target.chapterOutline || target.summary },
    { id: "outline-beat", section: "全书节拍", source: `outline.${target.outlineBeatId || "none"}`, reason: "保持本章在全书结构中的阶段职责", priority: 99, estimatedTokens: estimateTokens(workspace.outline.find((item) => item.id === target.outlineBeatId) || null), contentPreview: preview(workspace.outline.find((item) => item.id === target.outlineBeatId) || "无"), required: true, payload: workspace.outline.find((item) => item.id === target.outlineBeatId) || null },
    { id: "previous-ending", section: "上一章结尾", source: previous ? `chapters.${previous.number}.content` : "none", reason: "保证场景连续衔接", priority: 98, estimatedTokens: estimateTokens(previous?.content.slice(-8000) || ""), contentPreview: preview(previous?.content.slice(-8000) || "无"), required: true, payload: previous?.content.slice(-8000) || "无" },
    { id: "verified-facts", section: "已验证事实", source: "canon.timeline+facts", reason: "提供可核对的事实与时间线底座", priority: 99, estimatedTokens: estimateTokens(verifiedFacts), contentPreview: preview(verifiedFacts), required: true, payload: verifiedFacts },
    { id: "foreshadow-tasks", section: "本章伏笔任务", source: `chapters.${target.number}.chapterOutline.foreshadowActions`, reason: "限定本章允许埋设、推进和回收的伏笔", priority: 99, estimatedTokens: estimateTokens(foreshadowTasks), contentPreview: preview(foreshadowTasks), required: true, payload: foreshadowTasks },
    { id: "world-rules", section: "世界规则", source: "world", reason: "阻止能力、制度与物件规则漂移", priority: 92, estimatedTokens: estimateTokens(workspace.world), contentPreview: preview(workspace.world), payload: workspace.world },
    { id: "character-dossiers", section: "人物档案", source: "characters", reason: "保持身份、欲望与人物弧一致", priority: 90, estimatedTokens: estimateTokens(workspace.characters), contentPreview: preview(workspace.characters), payload: workspace.characters },
    { id: "latest-states", section: "人物最新状态", source: "canon.characterStates", reason: "继承位置、伤势、目标、知情和道具", priority: 96, estimatedTokens: estimateTokens(latestStates), contentPreview: preview(latestStates), required: true, payload: latestStates },
    { id: "knowledge", section: "视角知识边界", source: "canon.knowledgeStates", reason: "防止人物知道尚未获知的信息", priority: 97, estimatedTokens: estimateTokens(knowledge), contentPreview: preview(knowledge), required: true, payload: knowledge },
    { id: "narrative-events", section: "因果事件网", source: "canon.narrativeEvents", reason: "继承真实发生顺序、揭示顺序与因果链", priority: 95, estimatedTokens: estimateTokens(relevantEvents), contentPreview: preview(relevantEvents), payload: relevantEvents },
    { id: "open-threads", section: "未回收线索", source: "canon.threads", reason: "防止故事线遗忘或提前回收", priority: 88, estimatedTokens: estimateTokens(openThreads), contentPreview: preview(openThreads), payload: openThreads },
    { id: "relationships", section: "人物关系", source: "relationships", reason: "保持互动基调与关系变化连续", priority: 78, estimatedTokens: estimateTokens(workspace.relationships), contentPreview: preview(workspace.relationships), payload: workspace.relationships },
    { id: "preferences", section: "用户偏好", source: "storyControl.writingPreferences", reason: "继承用户已选择的节奏与表达偏好", priority: 72, estimatedTokens: estimateTokens(workspace.storyControl?.writingPreferences), contentPreview: preview(workspace.storyControl?.writingPreferences || {}), payload: workspace.storyControl?.writingPreferences || {} },
    { id: "existing-draft", section: "现有草稿", source: `chapters.${target.number}.content`, reason: "重写时保留有效情节和文风", priority: 70, estimatedTokens: estimateTokens(inputs.existingDraft || ""), contentPreview: preview(inputs.existingDraft || "无"), payload: inputs.existingDraft || "" },
    { id: "problems", section: "待规避问题", source: "issues", reason: "避免重复已发现的问题", priority: 68, estimatedTokens: estimateTokens(problems), contentPreview: preview(problems), payload: problems },
    { id: "narrative-recaps", section: "导航摘要", source: "canon.chapterSummaries", reason: "帮助定位前文，但不可替代正文证据", priority: 60, estimatedTokens: estimateTokens(narrativeRecaps), contentPreview: preview(narrativeRecaps), payload: narrativeRecaps },
  ];
  let used = 0;
  const items = [...candidates].sort((a, b) => b.priority - a.priority).map((item) => {
    const included = Boolean(item.required) || used + item.estimatedTokens <= budgetTokens;
    if (included) used += item.estimatedTokens;
    return { id: item.id, section: item.section, source: item.source, reason: item.reason, priority: item.priority, estimatedTokens: item.estimatedTokens, contentPreview: item.contentPreview, included };
  });
  const excluded = items.filter((item) => !item.included);
  return {
    chapterNumber: target.number,
    generatedAt: new Date().toISOString(),
    budgetTokens,
    estimatedTokens: used,
    items,
    warnings: [
      ...(used > budgetTokens ? [`硬性上下文约 ${used} Token，已超过 ${budgetTokens} Token 预算；仍保留以避免事实断裂。`] : []),
      ...(excluded.length ? [`因预算排除 ${excluded.length} 个低优先级上下文区块，可在追踪面板查看。`] : []),
      ...(!(verifiedCanon.narrativeEvents || []).length && target.number > 1 ? ["前文章节尚无结构化因果事件，将回退到事实账本和章节摘要。"] : []),
    ],
  };
}

export function contextPayloadFromManifest(
  workspace: WorkspaceData,
  target: Chapter,
  manifest: ContextManifest,
  inputs: { verifiedCanon?: CanonLedger; existingDraft?: string; foreshadowTasks?: unknown[]; narrativeRecaps?: Array<{ chapterNumber: number; summary: string; warning?: string }> } = {},
) {
  const verifiedCanon = inputs.verifiedCanon || workspace.canon;
  const previous = workspace.chapters.find((item) => item.number === target.number - 1);
  const povCharacterNames = workspace.characters.filter((character) => target.pov?.includes(character.name)).map((character) => character.name);
  if (!povCharacterNames.length && target.pov) povCharacterNames.push(target.pov);
  const included = new Set(manifest.items.filter((item) => item.included).map((item) => item.id));
  const latestStates = [...verifiedCanon.characterStates].filter((item) => item.chapterNumber < target.number).sort((a, b) => b.chapterNumber - a.chapterNumber).filter((item, index, list) => list.findIndex((candidate) => candidate.name === item.name) === index);
  const openThreads = verifiedCanon.threads.filter((item) => item.openedChapter < target.number && (item.status === "open" || (item.resolvedChapter || 0) >= target.number));
  const eventTerms = new Set([
    target.pov,
    ...workspace.characters.filter((item) => JSON.stringify(target.chapterOutline || target.summary).includes(item.name)).map((item) => item.name),
    ...(target.chapterOutline?.foreshadowActions || []).map((item) => item.title),
  ].filter(Boolean) as string[]);
  const relevantEvents = (verifiedCanon.narrativeEvents || [])
    .filter((item) => item.chapterNumber < target.number && (item.chapterNumber >= target.number - 4 || item.participants.some((name) => eventTerms.has(name)) || [...eventTerms].some((term) => item.event.includes(term))))
    .slice(-80);
  const payload: Record<string, unknown> = {};
  if (included.has("contract")) payload.bookContract = workspace.project.bookContract;
  if (included.has("project-identity")) payload.projectIdentity = { title: workspace.project.title, genre: workspace.project.genre, premise: workspace.project.premise, theme: workspace.project.theme, writingStyle: workspace.project.writingStyle, pointOfView: workspace.project.pointOfView };
  if (included.has("chapter-outline")) payload.chapterOutline = target.chapterOutline || target.summary;
  if (included.has("outline-beat")) payload.outlineBeat = workspace.outline.find((item) => item.id === target.outlineBeatId) || null;
  if (included.has("previous-ending")) payload.previousChapterEnding = previous?.content.slice(-8000) || "无";
  if (included.has("verified-facts")) payload.verifiedFacts = {
    timeline: verifiedCanon.timeline.filter((item) => item.chapterNumber < target.number),
    facts: verifiedCanon.facts.filter((item) => item.chapterNumber < target.number),
  };
  if (included.has("foreshadow-tasks")) payload.foreshadowTasks = inputs.foreshadowTasks || target.chapterOutline?.foreshadowActions || [];
  if (included.has("world-rules")) payload.worldRules = workspace.world;
  if (included.has("character-dossiers")) payload.characterDossiers = workspace.characters;
  if (included.has("latest-states")) payload.latestCharacterStates = latestStates;
  if (included.has("knowledge")) payload.povKnowledgeBoundary = (verifiedCanon.knowledgeStates || []).filter((item) => item.chapterNumber < target.number && (!povCharacterNames.length || povCharacterNames.includes(item.characterName))).slice(-80);
  if (included.has("narrative-events")) payload.narrativeWorld = relevantEvents;
  if (included.has("open-threads")) payload.openThreads = openThreads;
  if (included.has("relationships")) payload.relationships = workspace.relationships;
  if (included.has("preferences")) payload.userWritingPreferences = workspace.storyControl?.writingPreferences;
  if (included.has("existing-draft")) payload.existingDraftReference = (inputs.existingDraft || "").slice(0, 40_000);
  if (included.has("problems")) payload.problemsToAvoid = workspace.issues
    .filter((item) => !item.resolved && (!item.chapterNumber || item.chapterNumber <= target.number))
    .map((item) => ({ title: item.title, description: item.description, suggestedFix: item.suggestedFix }));
  if (included.has("narrative-recaps")) payload.unverifiedNarrativeRecaps = inputs.narrativeRecaps || verifiedCanon.chapterSummaries
    .filter((item) => item.chapterNumber < target.number)
    .map((item) => ({ chapterNumber: item.chapterNumber, summary: item.summary, warning: "导航摘要，不能单独用作事实证据" }));
  return payload;
}

export function derivePacingCurve(workspace: WorkspaceData): PacingPoint[] {
  return workspace.chapters.filter((chapter) => chapter.content.trim()).sort((a, b) => a.number - b.number).map((chapter) => {
    const content = chapter.content;
    const length = Math.max(1, content.length);
    const hits = (pattern: RegExp) => (content.match(pattern) || []).length;
    const action = Math.min(100, Math.round((hits(/冲|撞|追|逃|砸|扑|抓|推|拔|奔|闯|打|杀|躲/g) * 9000 / length) + 25));
    const revelation = Math.min(100, Math.round(((chapter.memory?.establishedFacts.length || 0) * 10) + ((chapter.memory?.resolvedThreads.length || 0) * 14) + hits(/原来|真相|竟然|才明白|意味着/g) * 5));
    const emotion = Math.min(100, Math.round((hits(/哭|笑|颤|怒|怕|恨|悔|疼|沉默|哽咽/g) * 6500 / length) + 20));
    const change = Math.min(100, Math.round(((chapter.memory?.characterUpdates.length || 0) * 12) + ((chapter.memory?.openedThreads.length || 0) * 7) + ((chapter.memory?.resolvedThreads.length || 0) * 12)));
    const tension = Math.min(100, Math.round(action * .32 + revelation * .28 + emotion * .2 + change * .2));
    return { chapterNumber: chapter.number, tension, action, revelation, emotion, change, label: tension >= 72 ? "高压" : tension >= 45 ? "推进" : "蓄力" };
  });
}

function dialogueSamples(workspace: WorkspaceData, characterName: string) {
  const samples: Array<{ text: string; chapter: number }> = [];
  for (const chapter of workspace.chapters) {
    const regex = /“([^”]{2,160})”/g;
    for (const match of chapter.content.matchAll(regex)) {
      const start = match.index || 0;
      const before = chapter.content.slice(Math.max(0, start - 45), start);
      const after = chapter.content.slice(start + match[0].length, start + match[0].length + 28);
      if (before.includes(characterName) || after.includes(characterName)) samples.push({ text: match[1], chapter: chapter.number });
    }
  }
  return samples;
}

export function deriveCharacterVoiceProfiles(workspace: WorkspaceData): CharacterVoiceProfile[] {
  const modalLexicon = ["吧", "呢", "啊", "罢了", "当然", "大概", "也许", "必须", "别", "请", "我觉得", "你知道"];
  return workspace.characters.map((character) => {
    const samples = dialogueSamples(workspace, character.name);
    const all = samples.map((item) => item.text);
    const phraseCounts = new Map<string, number>();
    for (const sample of all) for (const phrase of sample.split(/[，。！？、；：\s]/).filter((item) => item.length >= 3 && item.length <= 8)) phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    return {
      characterName: character.name,
      sampleCount: samples.length,
      averageLength: samples.length ? Math.round(all.reduce((sum, item) => sum + item.length, 0) / samples.length) : 0,
      questionRate: samples.length ? Math.round(all.filter((item) => /[？?]/.test(item)).length / samples.length * 100) : 0,
      exclamationRate: samples.length ? Math.round(all.filter((item) => /[！!]/.test(item)).length / samples.length * 100) : 0,
      modalWords: modalLexicon.map((word) => ({ word, count: all.reduce((sum, item) => sum + item.split(word).length - 1, 0) })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 5).map((item) => item.word),
      signaturePhrases: [...phraseCounts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([phrase]) => phrase),
      updatedThroughChapter: samples.at(-1)?.chapter || 0,
    };
  });
}

export function buildNarrativeIntelligenceIssues(workspace: WorkspaceData): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const events = workspace.canon.narrativeEvents || [];
  const knownEventIds = new Set(events.map((item) => item.id));
  for (const event of events) {
    const missingCauses = event.causeIds.filter((id) => !knownEventIds.has(id));
    if (event.verified && missingCauses.length) issues.push({ id: `world-cause-${event.id}`, severity: "警告", category: "情节", title: `因果链存在断点：${event.event.slice(0, 24)}`, description: `事件引用了 ${missingCauses.length} 个不存在的前因，后续生成可能把结果写成无来源突变。`, location: `第 ${event.chapterNumber} 章`, chapterNumber: event.chapterNumber, resolved: false, evidence: event.quote, source: "local", confidence: "high", evidenceClass: "deterministic", autoRepairable: false, suggestedFix: "补充真实前因事件，或删除错误的因果引用后重新审校。" });
  }
  for (const knowledge of workspace.canon.knowledgeStates || []) {
    if (!knowledge.verified || !knowledge.sourceEventId || knownEventIds.has(knowledge.sourceEventId)) continue;
    issues.push({ id: `knowledge-source-${knowledge.id}`, severity: "警告", category: "人物", title: `人物知识缺少来源：${knowledge.characterName}`, description: `“${knowledge.fact}”被记为人物已知，但对应来源事件不存在，可能造成越权知情。`, location: `第 ${knowledge.chapterNumber} 章`, chapterNumber: knowledge.chapterNumber, resolved: false, evidence: knowledge.quote, source: "local", confidence: "high", evidenceClass: "deterministic", autoRepairable: false, suggestedFix: "补回人物获得信息的事件证据，或将该知识状态移除后重建章节记忆。" });
  }
  const curve = derivePacingCurve(workspace);
  for (let index = 2; index < curve.length; index += 1) {
    const run = curve.slice(index - 2, index + 1);
    if (run.every((item) => item.tension < 38) && Math.max(...run.map((item) => item.tension)) - Math.min(...run.map((item) => item.tension)) < 8) {
      const last = run[2];
      issues.push({ id: `pacing-flat-${last.chapterNumber}`, severity: "警告", category: "情节", title: `第 ${run[0].chapterNumber}—${last.chapterNumber} 章节奏持续低平`, description: "连续三章的行动、揭示、情绪和状态变化均偏低，读者可能感到剧情停滞。", location: `第 ${run[0].chapterNumber}—${last.chapterNumber} 章`, chapterNumber: last.chapterNumber, resolved: false, source: "local", confidence: "medium", evidenceClass: "deterministic", autoRepairable: true, suggestedFix: "在不提前回收谜底的前提下，增加一次不可逆选择、信息增量或具体代价。" });
    }
  }
  const profiles = deriveCharacterVoiceProfiles(workspace).filter((item) => item.sampleCount >= 5);
  for (let i = 0; i < profiles.length; i += 1) for (let j = i + 1; j < profiles.length; j += 1) {
    const a = profiles[i], b = profiles[j];
    const modalOverlap = a.modalWords.filter((word) => b.modalWords.includes(word)).length;
    if (Math.abs(a.averageLength - b.averageLength) <= 3 && Math.abs(a.questionRate - b.questionRate) <= 8 && modalOverlap >= 2) {
      issues.push({ id: `voice-similar-${a.characterName}-${b.characterName}`, severity: "提示", category: "文风", title: `人物声纹趋同：${a.characterName} / ${b.characterName}`, description: `两人的对白长度、疑问句比例和常用语气词高度接近，辨识度可能不足。`, location: "全书对白", resolved: false, source: "local", confidence: "low", evidenceClass: "subjective", autoRepairable: false, suggestedFix: "先人工确认是否确实同质，再分别强化措辞习惯、句长、回避话题和表达目的。" });
    }
  }
  return issues;
}

export function scoreChapterCandidate(workspace: WorkspaceData, chapter: Chapter, content: string) {
  const target = Math.max(1, chapter.targetWords);
  const lengthScore = Math.max(0, 100 - Math.abs(content.length - target) / target * 80);
  const outlineTerms = [chapter.chapterOutline?.opening, ...(chapter.chapterOutline?.scenes || []), chapter.chapterOutline?.turningPoint, chapter.chapterOutline?.endingHook].filter(Boolean) as string[];
  const keywordScore = outlineTerms.length ? outlineTerms.reduce((sum, item) => sum + (item.split(/[，。；、\s]/).filter((term) => term.length >= 2).some((term) => content.includes(term)) ? 1 : 0), 0) / outlineTerms.length * 100 : 70;
  const templatePenalty = (content.match(/不是.{0,28}而是|仿佛|一切才刚刚开始|命运的齿轮/g) || []).length * 4;
  const preference = workspace.storyControl?.writingPreferences;
  const dialogueRatio = (content.match(/“[^”]+”/g) || []).join("").length / Math.max(1, content.length);
  const preferenceScore = !preference ? 70 : preference.preferredDialogueRatio === "high" ? Math.min(100, dialogueRatio * 400) : preference.preferredDialogueRatio === "low" ? Math.max(0, 100 - dialogueRatio * 400) : Math.max(0, 100 - Math.abs(dialogueRatio - .25) * 250);
  const score = Math.max(0, Math.min(100, Math.round(lengthScore * .35 + keywordScore * .4 + preferenceScore * .25 - templatePenalty)));
  return { score, reasons: [`篇幅匹配 ${Math.round(lengthScore)} 分`, `章纲覆盖 ${Math.round(keywordScore)} 分`, `用户偏好 ${Math.round(preferenceScore)} 分`, ...(templatePenalty ? [`模板表达扣 ${templatePenalty} 分`] : [])] };
}

export function rankChapterCandidates(workspace: WorkspaceData, chapter: Chapter, contents: string[]): ChapterCandidate[] {
  const uniqueContents = contents.filter((content, index, list) => {
    const normalized = content.replace(/\s+/g, "").trim();
    return normalized && list.findIndex((candidate) => candidate.replace(/\s+/g, "").trim() === normalized) === index;
  });
  return uniqueContents.map((content, index) => {
    const result = scoreChapterCandidate(workspace, chapter, content);
    return { id: `candidate-${chapter.id}-${Date.now()}-${index + 1}`, content, createdAt: new Date().toISOString(), ...result };
  }).sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, selected: index === 0 }));
}

export function learnWritingPreference(
  current: WritingPreferenceProfile | undefined,
  accepted: ChapterCandidate,
  rejected: ChapterCandidate[] = [],
): WritingPreferenceProfile {
  const dialogueRatio = (accepted.content.match(/“[^”]+”/g) || []).join("").length / Math.max(1, accepted.content.length);
  const fastHits = (accepted.content.match(/冲|追|逃|撞|突然|立刻|猛地/g) || []).length / Math.max(1, accepted.content.length) * 1000;
  const signal = `候选得分${accepted.score}；对白占比${Math.round(dialogueRatio * 100)}%；动作密度${fastHits.toFixed(1)}`;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    acceptedCandidateSignals: [...(current?.acceptedCandidateSignals || []), signal].slice(-20),
    rejectedCandidateSignals: [...(current?.rejectedCandidateSignals || []), ...rejected.map((item) => `拒绝候选得分${item.score}`)].slice(-20),
    preferredPacing: fastHits >= 5 ? "fast" : fastHits <= 2 ? "slow" : current?.preferredPacing || "balanced",
    preferredDialogueRatio: dialogueRatio >= .32 ? "high" : dialogueRatio <= .14 ? "low" : current?.preferredDialogueRatio || "balanced",
    notes: [...(current?.notes || []), "偏好由实际候选选择自动学习，可在整书控制中重置。"].slice(-8),
  };
}
