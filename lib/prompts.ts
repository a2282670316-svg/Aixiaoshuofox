import { canonBeforeChapter, foreshadowTasksForChapter } from "./auto-novel";
import type { Chapter, WorkspaceData } from "./types";

const taskInstructions: Record<string, string> = {
  "自由对话": "直接回应作者的创作问题。给出具体、可执行的建议，并说明建议如何服务于主题和人物弧光。",
  "续写本章": "从当前正文结尾自然续写 800—1200 字。保持视角、语气和叙事时态一致；推进冲突，不要总结，不要添加解释性前言。",
  "润色改写": "在不改变事实、情节走向和人物意图的前提下润色当前正文。强化画面、节奏与感官细节，减少空泛形容，直接输出改写后的正文。",
  "情节推进": "基于当前章纲和未回收线索，提供 3 个差异明显的下一步情节方案。每个方案包含触发事件、人物选择、代价和可回收伏笔。",
  "生成章节": "严格按照当前章纲生成 1800—2500 字章节草稿。依次落实本章目标、场景推进、转折、结尾钩子与伏笔任务；保持人物动机和世界规则一致，直接输出正文。",
  "生成大纲": "为当前小说生成结构清晰的分幕大纲，包含关键转折、中点反转、最低谷、高潮与伏笔回收位置。不要推翻已有设定。",
  "灵感发散": "围绕作者输入生成 6 个可用于本书的新灵感，覆盖冲突、人物秘密、场景、意象、反转与伏笔，并避免彼此重复。",
  "一致性审校": "审查提供的设定、大纲与章节，列出可被文本证据支持的冲突。按严重程度、类别、位置、问题、修复建议输出；不要虚构不存在的细节。",
  "人物深化": "深化指定人物，给出外在目标、内在需求、错误信念、秘密、关键关系、压力下的行为与可落地的人物弧光节点。",
  "世界构建": "扩展指定世界观条目，补充历史成因、日常影响、权力关系、限制条件和可直接进入剧情的冲突钩子。",
};

function compactChapter(chapter: Chapter) {
  return {
    number: chapter.number,
    title: chapter.title,
    summary: chapter.summary,
    status: chapter.status,
    pov: chapter.pov,
    chapterOutline: chapter.chapterOutline,
    content: chapter.content.slice(-12000),
  };
}

export function buildNovelContext(workspace: WorkspaceData, chapterId?: string) {
  const currentChapter = workspace.chapters.find((chapter) => chapter.id === chapterId);
  const targetNumber = currentChapter?.number;
  const nearbyChapters = currentChapter
    ? workspace.chapters
        .filter((chapter) => chapter.number <= currentChapter.number && chapter.number >= currentChapter.number - 2)
        .sort((a, b) => a.number - b.number)
        .map(compactChapter)
    : [...workspace.chapters].sort((a, b) => a.number - b.number).slice(-5).map((chapter) => ({
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary,
        status: chapter.status,
      }));

  return {
    project: workspace.project,
    characters: workspace.characters.map((character) => ({
      name: character.name,
      role: character.role,
      age: character.age,
      identity: character.identity,
      goal: character.goal,
      conflict: character.conflict,
      arc: character.arc,
      traits: character.traits,
    })),
    world: workspace.world.map((entry) => ({
      category: entry.category,
      title: entry.title,
      summary: entry.summary,
      details: entry.details,
    })),
    relationships: workspace.relationships.map((relationship) => ({
      from: workspace.characters.find((character) => character.id === relationship.fromId)?.name,
      to: workspace.characters.find((character) => character.id === relationship.toId)?.name,
      label: relationship.label,
      tone: relationship.tone,
      description: relationship.description,
    })),
    outline: workspace.outline,
    currentChapter: currentChapter ? {
      number: currentChapter.number,
      title: currentChapter.title,
      summary: currentChapter.summary,
      pov: currentChapter.pov,
      targetWords: currentChapter.targetWords,
      chapterOutline: currentChapter.chapterOutline,
    } : undefined,
    currentForeshadowTasks: targetNumber ? foreshadowTasksForChapter(workspace, targetNumber) : [],
    canon: targetNumber ? canonBeforeChapter(workspace, targetNumber) : workspace.canon,
    nearbyChapters,
    unresolvedIssues: workspace.issues.filter((issue) => !issue.resolved && (!targetNumber || !issue.chapterNumber || issue.chapterNumber <= targetNumber)),
  };
}

export function buildUserPrompt(
  task: string,
  instruction: string,
  workspace: WorkspaceData,
  chapterId?: string,
) {
  const context = buildNovelContext(workspace, chapterId);
  const taskInstruction = taskInstructions[task] ?? taskInstructions["自由对话"];

  return `你是长篇小说作者的专业创作搭档。请严格尊重已给出的事实，不擅自改名，不把建议当成既定设定。涉及指定章节时，只能使用该章之前已经发生的事实，不能把未来章节内容倒灌进当前上下文。\n\n【任务】\n${task}\n${taskInstruction}\n\n【作者补充要求】\n${instruction || "无额外要求，请依据已有上下文完成。"}\n\n【小说上下文】\n${JSON.stringify(context, null, 2)}\n\n请使用简体中文输出。`;
}
