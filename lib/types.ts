export type NavKey =
  | "创作台"
  | "AI 全书"
  | "灵感"
  | "世界观"
  | "人物"
  | "关系图"
  | "大纲"
  | "章节"
  | "一致性"
  | "素材库";

export type ChapterStatus = "待生成" | "草稿" | "修订中" | "已完成";

export interface ProjectInfo {
  title: string;
  genre: string;
  status: string;
  premise: string;
  theme: string;
  targetWords: number;
  targetChapters: number;
  writingStyle: string;
  pointOfView: string;
}

export interface Idea {
  id: string;
  title: string;
  content: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
}

export interface WorldEntry {
  id: string;
  category: "地点" | "势力" | "规则" | "历史" | "物件";
  title: string;
  summary: string;
  details: string;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  age: string;
  identity: string;
  goal: string;
  conflict: string;
  arc: string;
  traits: string[];
  color: string;
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  tone: "正向" | "复杂" | "对立" | "未知";
  description: string;
}

export interface OutlineBeat {
  id: string;
  act: string;
  title: string;
  summary: string;
  chapterRange: string;
  status: "待规划" | "进行中" | "已完成";
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  summary: string;
  content: string;
  status: ChapterStatus;
  updatedAt: string;
  outlineBeatId?: string;
  pov?: string;
  targetWords: number;
  revision?: number;
  memory?: ChapterMemory;
  generation?: {
    runId: string;
    status: "planned" | "generating" | "generated" | "audited";
    completedSegments: number;
    baseRevision: number;
  };
}

export interface ChapterMemory {
  summary: string;
  timelineEvents: string[];
  characterUpdates: Array<{ name: string; state: string }>;
  openedThreads: string[];
  resolvedThreads: string[];
  establishedFacts: string[];
}

export interface CanonLedger {
  revision: number;
  chapterSummaries: Array<{ chapterId: string; chapterNumber: number; summary: string }>;
  timeline: Array<{ id: string; chapterNumber: number; event: string }>;
  characterStates: Array<{ characterId?: string; name: string; state: string; chapterNumber: number }>;
  threads: Array<{ id: string; title: string; status: "open" | "resolved"; openedChapter: number; resolvedChapter?: number }>;
  facts: Array<{ id: string; chapterNumber: number; fact: string }>;
  lastAuditedChapter: number;
}

export interface ConsistencyIssue {
  id: string;
  severity: "错误" | "警告" | "提示";
  category: "时间线" | "人物" | "世界规则" | "情节" | "文风";
  title: string;
  description: string;
  location: string;
  resolved: boolean;
}

export interface Material {
  id: string;
  type: "伏笔" | "摘录" | "研究" | "场景" | "对白";
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  createdAt: string;
  note: string;
}

export type AutomationPhase =
  | "idle"
  | "ideating"
  | "choosing"
  | "planning"
  | "ready"
  | "writing"
  | "paused"
  | "completed"
  | "error";

export interface StorySeed {
  id: string;
  title: string;
  genre: string;
  hook: string;
  premise: string;
  theme: string;
  protagonist: string;
  centralConflict: string;
  endingTone: string;
  reason: string;
  recommended: boolean;
}

export interface BlueprintDraft {
  seedId: string;
  completedStage: 0 | 1 | 2 | 3 | 4 | 5;
  foundation?: Record<string, unknown>;
  world?: Record<string, unknown>;
  outline?: Record<string, unknown>;
  foreshadows?: Record<string, unknown>;
  chapters?: Record<string, unknown>;
}

export interface NovelAutomation {
  runId?: string;
  phase: AutomationPhase;
  brief: string;
  seeds: StorySeed[];
  selectedSeedId?: string;
  targetChapters: number;
  targetWords: number;
  chapterWords: number;
  currentChapterNumber: number;
  currentSegment: number;
  generatedChapterIds: string[];
  usage: {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  maxRequests: number;
  maxTokens: number;
  lastError?: string;
  blueprintDraft?: BlueprintDraft;
  updatedAt?: string;
}

export interface WorkspaceData {
  project: ProjectInfo;
  ideas: Idea[];
  world: WorldEntry[];
  characters: Character[];
  relationships: Relationship[];
  outline: OutlineBeat[];
  chapters: Chapter[];
  issues: ConsistencyIssue[];
  materials: Material[];
  versions: ChapterVersion[];
  canon: CanonLedger;
  automation: NovelAutomation;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode: "auto" | "chat" | "responses";
  temperature: number;
  rememberKey: boolean;
}
