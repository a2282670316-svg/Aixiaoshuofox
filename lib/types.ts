export type NavKey =
  | "创作台"
  | "AI 全书"
  | "整书控制"
  | "灵感"
  | "世界观"
  | "人物"
  | "关系图"
  | "大纲"
  | "章节"
  | "一致性"
  | "素材库";

export type ChapterStatus = "待生成" | "草稿" | "修订中" | "已完成";

export interface BookContract {
  readingPromise: string;
  protagonistFantasy: string;
  coreSellingPoint: string;
  chapter3Payoff: string;
  chapter10Payoff: string;
  chapter30Payoff: string;
  escalationLadder: string;
  relationshipMainline: string;
  absoluteRedLines: string[];
}

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
  bookContract?: BookContract;
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

export type ForeshadowAction = "plant" | "advance" | "resolve";

export interface ChapterSceneCard {
  id: string;
  title: string;
  objective: string;
  conflict: string;
  reveal: string;
  emotionBeat: string;
}

export interface ChapterOutline {
  objective: string;
  opening: string;
  scenes: string[];
  sceneCards?: ChapterSceneCard[];
  mustAdvance?: string[];
  mustPreserve?: string[];
  mustAvoid?: string[];
  turningPoint: string;
  endingHook: string;
  foreshadowActions: Array<{
    title: string;
    action: ForeshadowAction;
    instruction: string;
  }>;
}

export interface OutlineExecutionEvidence {
  key: "objective" | "opening" | "scene" | "turningPoint" | "endingHook";
  label: string;
  status: "executed" | "partial" | "missing";
  score: number;
  evidence?: string;
  quote?: string;
  verified: boolean;
}

export interface ChapterQualityReport {
  overall: number;
  length: number;
  outline: number;
  continuity: number;
  foreshadow: number;
  style: number;
  evaluatedAt: string;
  notes: string[];
  outlineEvidence?: OutlineExecutionEvidence[];
}

export interface ChapterRepairReview {
  beforeVersionId: string;
  changeSummary: string;
  edits?: Array<{ oldText: string; newText: string; reason: string }>;
  outlineEvidence?: OutlineExecutionEvidence[];
  createdAt: string;
  status: "pending" | "accepted" | "reverted";
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
  chapterOutline?: ChapterOutline;
  revision?: number;
  memory?: ChapterMemory;
  quality?: ChapterQualityReport;
  repairReview?: ChapterRepairReview;
  contextManifest?: ContextManifest;
  candidates?: ChapterCandidate[];
  generation?: {
    runId: string;
    status: "planned" | "generating" | "generated" | "audited" | "repairing" | "accepted" | "blocked";
    completedSegments: number;
    baseRevision: number;
    repairAttempts?: number;
    draftAttempts?: number;
    acceptedAt?: string;
  };
}

export type EvidenceClass = "deterministic" | "quoted" | "inferred" | "subjective";
export type AuditConfidence = "high" | "medium" | "low";

export interface NarrativeEvent {
  id: string;
  chapterNumber: number;
  event: string;
  actualOrder: number;
  revealOrder: number;
  participants: string[];
  location?: string;
  causeIds: string[];
  effectIds: string[];
  quote?: string;
  verified: boolean;
}

export interface KnowledgeState {
  id: string;
  chapterNumber: number;
  characterName: string;
  fact: string;
  status: "knows" | "believes" | "suspects" | "conceals";
  sourceEventId?: string;
  quote?: string;
  verified: boolean;
}

export interface ContextManifestItem {
  id: string;
  section: string;
  source: string;
  reason: string;
  priority: number;
  included: boolean;
  estimatedTokens: number;
  contentPreview: string;
}

export interface ContextManifest {
  chapterNumber: number;
  generatedAt: string;
  budgetTokens: number;
  estimatedTokens: number;
  items: ContextManifestItem[];
  warnings: string[];
}

export interface PacingPoint {
  chapterNumber: number;
  tension: number;
  action: number;
  revelation: number;
  emotion: number;
  change: number;
  label: string;
}

export interface CharacterVoiceProfile {
  characterName: string;
  sampleCount: number;
  averageLength: number;
  questionRate: number;
  exclamationRate: number;
  modalWords: string[];
  signaturePhrases: string[];
  updatedThroughChapter: number;
}

export interface ChapterCandidate {
  id: string;
  content: string;
  createdAt: string;
  score: number;
  reasons: string[];
  selected?: boolean;
}

export interface ChapterMemory {
  evidenceVersion?: 1;
  summary: string;
  timelineEvents: string[];
  characterUpdates: Array<{
    name: string;
    state: string;
    location?: string;
    physical?: string;
    emotion?: string;
    knowledge?: string[];
    inventory?: string[];
    goal?: string;
    quote?: string;
    verified?: boolean;
  }>;
  timelineEvidence?: Array<{ event: string; quote?: string; verified?: boolean }>;
  threadEvidence?: Array<{ title: string; status: "opened" | "resolved"; quote?: string; verified?: boolean }>;
  factEvidence?: Array<{ fact: string; quote?: string; verified?: boolean }>;
  openedThreads: string[];
  resolvedThreads: string[];
  establishedFacts: string[];
  outlineEvidence?: OutlineExecutionEvidence[];
  narrativeEvents?: NarrativeEvent[];
  knowledgeChanges?: KnowledgeState[];
  foreshadowUpdates?: Array<{
    title: string;
    status: "planted" | "advanced" | "resolved";
    evidence: string;
    quote?: string;
    verified?: boolean;
  }>;
}

export type CanonFactLevel = "author" | "text" | "ai_verified" | "inferred";

export interface CanonLedger {
  revision: number;
  chapterSummaries: Array<{ chapterId: string; chapterNumber: number; summary: string }>;
  timeline: Array<{ id: string; chapterNumber: number; event: string }>;
  characterStates: Array<{
    characterId?: string;
    name: string;
    state: string;
    chapterNumber: number;
    location?: string;
    physical?: string;
    emotion?: string;
    knowledge?: string[];
    inventory?: string[];
    goal?: string;
  }>;
  threads: Array<{ id: string; title: string; status: "open" | "resolved"; openedChapter: number; resolvedChapter?: number }>;
  facts: Array<{ id: string; chapterNumber: number; fact: string; level?: CanonFactLevel; evidence?: string }>;
  narrativeEvents?: NarrativeEvent[];
  knowledgeStates?: KnowledgeState[];
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
  chapterNumber?: number;
  evidence?: string;
  suggestedFix?: string;
  source?: "local" | "ai";
  fingerprint?: string;
  confidence?: AuditConfidence;
  evidenceClass?: EvidenceClass;
  autoRepairable?: boolean;
  verificationNote?: string;
}

export interface Material {
  id: string;
  type: "伏笔" | "摘录" | "研究" | "场景" | "对白";
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  foreshadowPlan?: Array<{
    chapterNumber: number;
    action: ForeshadowAction;
    instruction: string;
  }>;
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
  | "reviewing"
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

export interface WritingRange {
  fromChapter: number;
  toChapter: number;
}

export type AIStage = "ideation" | "blueprint" | "chapter" | "memory" | "audit" | "repair";

export type AIReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type AIVerbosity = "low" | "medium" | "high";

export interface StageModelConfig {
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: AIReasoningEffort;
  verbosity?: AIVerbosity;
}

export interface AutomationTaskLog {
  id: string;
  runId?: string;
  kind: string;
  label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  chapterNumber?: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface GenerationRecoveryStep {
  id: string;
  runId: string;
  stepKey: string;
  kind: string;
  chapterNumber?: number;
  segmentNumber?: number;
  status: "completed" | "failed";
  attempts: number;
  contextHash?: string;
  outputExcerpt?: string;
  error?: string;
  usage?: NovelAutomation["usage"];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRecoveryRun {
  id: string;
  status: string;
  phase: AutomationPhase;
  currentChapterNumber: number;
  currentSegment: number;
  usage: NovelAutomation["usage"];
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  steps: GenerationRecoveryStep[];
}

export interface AutomationRecoveryData {
  projectId: string;
  runs: AutomationRecoveryRun[];
}

export interface WholeBookReviewState {
  status: "pending" | "reviewing" | "repairing" | "passed" | "blocked";
  round: number;
  issueIds: string[];
  repairQueue: number[];
  repairAttempts: Record<string, number>;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
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
  writingRange?: WritingRange;
  usage: {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  maxRequests: number;
  maxTokens: number;
  stageModels?: Partial<Record<AIStage, StageModelConfig>>;
  candidateCount?: 1 | 2 | 3;
  taskLog?: AutomationTaskLog[];
  lastError?: string;
  blueprintDraft?: BlueprintDraft;
  finalReview?: WholeBookReviewState;
  updatedAt?: string;
}

export type StoryControlSourceType = "整书契约" | "人物" | "世界规则" | "大纲";
export type PropagationDebtStatus = "待复审" | "复审中" | "已清偿";

export interface StoryControlSnapshot {
  createdAt: string;
  projectSignature: string;
  bookContractSignature: string;
  characters: Array<{ id: string; label: string; signature: string }>;
  world: Array<{ id: string; label: string; signature: string }>;
  outline: Array<{ id: string; label: string; signature: string }>;
}

export interface PropagationDebt {
  id: string;
  sourceType: StoryControlSourceType;
  sourceId: string;
  sourceTitle: string;
  changeType: "新增" | "修改" | "删除";
  reason: string;
  affectedChapters: number[];
  createdAt: string;
  status: PropagationDebtStatus;
}

export type StorylineType = "主线" | "感情线" | "人物线" | "谜题线";
export type StorylineStatus = "活跃" | "停滞" | "待回收" | "已完成";

export interface Storyline {
  id: string;
  title: string;
  type: StorylineType;
  status: StorylineStatus;
  summary: string;
  characterIds: string[];
  openedChapter: number;
  lastAdvancedChapter: number;
  targetChapter?: number;
  linkedThreadId?: string;
}

export type ResourceLedgerType = "金钱" | "伤势" | "道具" | "秘密" | "能力";
export type ResourceLedgerStatus = "持有" | "消耗" | "丢失" | "解决";

export interface ResourceLedgerEntry {
  id: string;
  ownerId?: string;
  ownerName: string;
  type: ResourceLedgerType;
  name: string;
  state: string;
  quantity?: number;
  unit?: string;
  lastChapter: number;
  source: "manual" | "canon";
  status: ResourceLedgerStatus;
}

export interface WritingPreferenceProfile {
  version: 1;
  updatedAt: string;
  acceptedCandidateSignals: string[];
  rejectedCandidateSignals: string[];
  preferredPacing: "fast" | "balanced" | "slow";
  preferredDialogueRatio: "low" | "balanced" | "high";
  notes: string[];
}

export interface StoryControlState {
  snapshot?: StoryControlSnapshot;
  propagationDebts: PropagationDebt[];
  storylines: Storyline[];
  resourceLedger: ResourceLedgerEntry[];
  writingPreferences?: WritingPreferenceProfile;
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
  storyControl?: StoryControlState;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode: "auto" | "chat" | "responses";
  temperature: number;
  rememberKey: boolean;
}
