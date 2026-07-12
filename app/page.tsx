"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  AtSign,
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cloud,
  Copy,
  Download,
  FileJson,
  FilePenLine,
  FileText,
  Flag,
  Globe2,
  Heart,
  HelpCircle,
  History,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  Lightbulb,
  ListTree,
  Menu,
  Network,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import AutoNovelStudio from "./auto-novel-studio";
import { DEFAULT_AI_CONFIG, DEMO_WORKSPACE } from "@/lib/demo-data";
import { buildUserPrompt } from "@/lib/prompts";
import {
  applyChapterMemory,
  buildChapterMemoryPrompt,
  buildChapterQualityIssues,
  buildChapterPlanDeviationIssues,
  buildMemoryEvidenceIssues,
  buildCharacterContinuityIssues,
  buildNarrativeHealthIssues,
  buildMechanicalStyleIssues,
  buildConsistencyRepairPrompt,
  buildRepairDependencyQueue,
  buildRollingAuditPrompt,
  buildForeshadowLedger,
  detectAIStage,
  evaluateChapterQuality,
  latestCharacterTracking,
  mergeRepairOutlineEvidence,
  MAX_AUTOMATED_REPAIR_ATTEMPTS,
  parseChapterMemory,
  parseConsistencyRepair,
  parseRollingAudit,
  removeChapterFromCanon,
  replaceChapterAuditIssues,
  stabilizeRepairAuditIssues,
  rewindNovelFromChapter,
  validateGeneratedChapterDraft,
} from "@/lib/auto-novel";
import { cloneWorkspace, createBlankWorkspace, mergeAutomationWorkspace, normalizeWorkspaceData, pruneWorkspaceHistory } from "@/lib/workspace";
import { MAX_STAGE_OUTPUT_TOKENS } from "@/lib/ai-limits";
import { GPT55_STAGE_PRESETS, resolveStageRequestOptions } from "@/lib/ai-stage-config";
import { readAIResponse } from "@/lib/ai-stream";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "@/lib/browser-storage";
import { EMPTY_BOOK_CONTRACT, sceneCardLabel } from "@/lib/story-control";
import { reconcileInterruptedTasks } from "@/lib/workspace-recovery";
import { buildStoryControlSnapshot, deriveCharacterInteractions, deriveResourceLedger, detectPropagationDebts, EMPTY_STORY_CONTROL, mergePropagationDebts, propagationDebtIssues, syncStorylinesFromWorkspace } from "@/lib/story-governance";
import { buildNarrativeIntelligenceIssues, compileContextManifest, deriveCharacterVoiceProfiles, derivePacingCurve, learnWritingPreference } from "@/lib/narrative-intelligence";
import type {
  AIConfig,
  BookContract,
  Chapter,
  ChapterOutline,
  ChapterSceneCard,
  ChapterStatus,
  Character,
  ConsistencyIssue,
  Material,
  NavKey,
  WorkspaceData,
  WorldEntry,
  StorylineStatus,
  ResourceLedgerEntry,
} from "@/lib/types";

const WORKSPACE_KEY = "novel-forge-workspace-v2";
function isBackgroundWorkspace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = (value as { project?: unknown }).project;
  return Boolean(project && typeof project === "object" && !Array.isArray(project)
    && (project as { status?: unknown }).status === "AI 后台创作中");
}

const CONFIG_KEY = "novel-forge-ai-config-v1";
const SESSION_KEY = "novel-forge-ai-session-key";
const BACKUP_KEY = "novel-forge-workspace-backups-v1";
const ACTIVE_PROJECT_KEY = "novel-forge-active-cloud-project-v1";
const chapterStatuses: ChapterStatus[] = ["待生成", "草稿", "修订中", "已完成"];
const stageModelOptions = [["ideation", "故事方向"], ["blueprint", "五阶段蓝图"], ["chapter", "章节正文"], ["memory", "事实记忆"], ["audit", "一致性审校"], ["repair", "正文修复"]] as const;

const navItems: Array<{ label: NavKey; icon: typeof PenLine }> = [
  { label: "创作台", icon: LayoutDashboard },
  { label: "章节", icon: FileText },
  { label: "大纲", icon: ListTree },
  { label: "AI 全书", icon: Rocket },
  { label: "整书控制", icon: Target },
  { label: "一致性", icon: ShieldCheck },
  { label: "世界观", icon: Globe2 },
  { label: "人物", icon: UsersRound },
  { label: "关系图", icon: Network },
  { label: "灵感", icon: Lightbulb },
  { label: "素材库", icon: LibraryBig },
];

const creationNavItems = navItems.filter((item) => ["创作台", "章节", "大纲", "AI 全书"].includes(item.label));
const controlNavItems = navItems.filter((item) => ["整书控制", "一致性"].includes(item.label));
const assetNavItems = navItems.filter((item) => ["世界观", "人物", "关系图", "灵感", "素材库"].includes(item.label));

type AIResult = { task: string; text: string; chapterId?: string };
type WorkspaceBackup = { id: string; label: string; createdAt: string; workspace: WorkspaceData };
type CloudProjectSummary = { id: string; title: string; genre: string; status: string; createdAt: string; updatedAt: string; revision: number };
type BackgroundConfiguration = { apiKey: boolean; model: string; baseUrl?: string; provider?: string; webhookSecret: boolean; workerSecret?: boolean };

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function countWords(text: string) {
  return text.replace(/\s+/g, "").length;
}

function number(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function Heading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return (
    <div className="view-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function BookContractEditor({ value, onChange }: { value: BookContract; onChange: (value: BookContract) => void }) {
  const patch = (next: Partial<BookContract>) => onChange({ ...value, ...next });
  return <section className="book-contract-editor">
    <div className="settings-subtitle"><div><span>BOOK CONTRACT</span><h3>整书创作契约</h3></div><p>把卖点和长期兑现节点固定下来，AI 写每一章时都会带入。</p></div>
    <div className="form-grid two-col">
      <label className="full"><span>读者承诺</span><textarea value={value.readingPromise} onChange={(event) => patch({ readingPromise: event.target.value })} placeholder="读者持续追读时，每隔几章能稳定获得什么体验？" /></label>
      <label className="full"><span>主角爽点 / 核心幻想</span><textarea value={value.protagonistFantasy} onChange={(event) => patch({ protagonistFantasy: event.target.value })} placeholder="主角替读者完成什么愿望、胜利或身份跃迁？" /></label>
      <label className="full"><span>不可替代卖点</span><textarea value={value.coreSellingPoint} onChange={(event) => patch({ coreSellingPoint: event.target.value })} placeholder="这本书区别于同题材作品的核心机制与体验。" /></label>
      <label><span>第 3 章前兑现</span><textarea value={value.chapter3Payoff} onChange={(event) => patch({ chapter3Payoff: event.target.value })} /></label>
      <label><span>第 10 章前兑现</span><textarea value={value.chapter10Payoff} onChange={(event) => patch({ chapter10Payoff: event.target.value })} /></label>
      <label className="full"><span>第 30 章前兑现 / 中后段大回报</span><textarea value={value.chapter30Payoff} onChange={(event) => patch({ chapter30Payoff: event.target.value })} /></label>
      <label className="full"><span>冲突升级阶梯</span><textarea value={value.escalationLadder} onChange={(event) => patch({ escalationLadder: event.target.value })} placeholder="个人困境 → 关系破裂 → 阵营对抗 → 世界级代价" /></label>
      <label className="full"><span>核心关系主线</span><textarea value={value.relationshipMainline} onChange={(event) => patch({ relationshipMainline: event.target.value })} /></label>
      <label className="full"><span>绝对红线（每行一条）</span><textarea value={value.absoluteRedLines.join("\n")} onChange={(event) => patch({ absoluteRedLines: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean) })} placeholder={"关键真相不能靠梦境一笔带过\n人物不能知道尚未获得的信息"} /></label>
    </div>
  </section>;
}

function ChapterExecutionContractEditor({ outline, onChange }: { outline: ChapterOutline; onChange: (patch: Partial<ChapterOutline>) => void }) {
  const cards = outline.sceneCards || [];
  const commitCards = (next: ChapterSceneCard[]) => onChange({ sceneCards: next, scenes: next.map(sceneCardLabel) });
  const updateCard = (cardId: string, patch: Partial<ChapterSceneCard>) => commitCards(cards.map((card) => card.id === cardId ? { ...card, ...patch } : card));
  const listText = (items?: string[]) => (items || []).join("\n");
  const parseLines = (value: string) => value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  return <section className="chapter-execution-contract">
    <header><div><span>SCENE EXECUTION</span><h3>场景执行卡</h3></div><small>明确每场戏的目标、阻力、揭示和情绪变化</small></header>
    {cards.length ? <div className="scene-card-list">{cards.map((card, index) => <article className="scene-plan-card" key={card.id}>
      <div className="scene-plan-heading"><b>场景 {index + 1}</b><button type="button" onClick={() => commitCards(cards.filter((item) => item.id !== card.id))}><Trash2 size={14} />删除</button></div>
      <div className="scene-plan-grid"><label><span>场景名</span><input value={card.title} onChange={(event) => updateCard(card.id, { title: event.target.value })} /></label><label><span>行动目标</span><input value={card.objective} onChange={(event) => updateCard(card.id, { objective: event.target.value })} /></label><label><span>冲突 / 阻力</span><textarea value={card.conflict} onChange={(event) => updateCard(card.id, { conflict: event.target.value })} /></label><label><span>新增揭示</span><textarea value={card.reveal} onChange={(event) => updateCard(card.id, { reveal: event.target.value })} /></label><label className="full"><span>情绪变化</span><input value={card.emotionBeat} onChange={(event) => updateCard(card.id, { emotionBeat: event.target.value })} placeholder="例如：戒备 → 动摇 → 被迫相信" /></label></div>
    </article>)}</div> : <div className="scene-card-empty"><p>当前仍是简版场景列表。转换为执行卡后，AI 更容易逐场落实章纲。</p><button type="button" className="secondary-button" onClick={() => commitCards((outline.scenes || []).map((scene, index) => ({ id: id(`scene-${index + 1}`), title: scene, objective: "", conflict: "", reveal: "", emotionBeat: "" })))}><ListTree size={15} />从场景文本生成卡片</button></div>}
    <button type="button" className="scene-add-button" onClick={() => commitCards([...cards, { id: id("scene"), title: `场景 ${cards.length + 1}`, objective: "", conflict: "", reveal: "", emotionBeat: "" }])}><Plus size={15} />添加场景卡</button>
    <div className="execution-constraints"><label><span>必须推进（每行一条）</span><textarea value={listText(outline.mustAdvance)} onChange={(event) => onChange({ mustAdvance: parseLines(event.target.value) })} /></label><label><span>必须保持</span><textarea value={listText(outline.mustPreserve)} onChange={(event) => onChange({ mustPreserve: parseLines(event.target.value) })} /></label><label><span>必须避免</span><textarea value={listText(outline.mustAvoid)} onChange={(event) => onChange({ mustAvoid: parseLines(event.target.value) })} /></label></div>
  </section>;
}

function ChapterAcceptance({ chapter, issues, busy, onRebuild, onDiff }: { chapter: Chapter; issues: ConsistencyIssue[]; busy: boolean; onRebuild: () => void; onDiff: () => void }) {
  const segments = 1;
  const completedSegments = Math.min(1, chapter.generation?.completedSegments || 0);
  const chapterIssues = issues.filter((issue) => !issue.resolved && issue.chapterNumber === chapter.number);
  const errors = chapterIssues.filter((issue) => issue.severity === "错误").length;
  const length = countWords(chapter.content); const lengthPassed = length >= chapter.targetWords; const status = chapter.generation?.status;
  const stages = [
    { label: "正文", done: completedSegments >= segments || lengthPassed, detail: `${length.toLocaleString("zh-CN")} / ${chapter.targetWords.toLocaleString("zh-CN")} 字` },
    { label: "记忆", done: Boolean(chapter.memory), detail: chapter.memory ? "事实已写入账本" : "等待提取事实" },
    { label: "审校", done: ["audited", "accepted", "blocked"].includes(status || ""), detail: chapterIssues.length ? `${chapterIssues.length} 项待确认` : "尚无未解决问题" },
    { label: "修复", done: (chapter.generation?.repairAttempts || 0) > 0 || errors === 0, detail: chapter.generation?.repairAttempts ? `已自动修复 ${chapter.generation.repairAttempts} 次` : errors ? "等待自动修复" : "无需修复" },
    { label: "验收", done: status === "accepted", detail: status === "blocked" ? "复审未通过，已阻塞" : status === "accepted" ? "可以安全进入下一章" : "等待最终验收" },
  ];
  const resumeAt = status === "blocked" ? "人工处理错误" : status === "audited" && errors ? "自动修复" : !chapter.memory ? "事实记忆" : !["audited", "accepted"].includes(status || "") ? "逐章审校" : status === "accepted" ? "已完成" : "正文生成";
  const scores = chapter.quality ? [["总分", chapter.quality.overall], ["字数", chapter.quality.length], ["章纲", chapter.quality.outline], ["一致性", chapter.quality.continuity], ["伏笔", chapter.quality.foreshadow], ["文风", chapter.quality.style]] as const : [];
  return <section className={`chapter-acceptance-card ${status === "blocked" ? "is-blocked" : status === "accepted" ? "is-accepted" : ""}`}>
    <header><div><span>WRITING LOOP</span><h3>章节闭环验收</h3></div><div className="chapter-acceptance-actions"><strong>恢复点：{resumeAt}</strong><button disabled={busy || !chapter.content.trim()} onClick={onRebuild}><RefreshCw size={13} />一键重建本章记忆并复审</button>{chapter.repairReview && <button onClick={onDiff}><History size={13} />修复前后对比</button>}</div></header>
    <div className="chapter-acceptance-steps">{stages.map((stage) => <div key={stage.label} className={stage.done ? "done" : "pending"}><i>{stage.done ? <Check size={13} /> : <span />}</i><b>{stage.label}</b><small>{stage.detail}</small></div>)}</div>
    {scores.length > 0 && <div className="chapter-quality-scores">{scores.map(([label, score]) => <div key={label}><span>{label}</span><b>{score}</b><i><em style={{ width: `${score}%` }} /></i></div>)}</div>}
    {!lengthPassed && <p className="chapter-acceptance-warning"><CircleAlert size={14} />{"\u6b63\u6587\u5c11\u4e8e\u76ee\u6807\u5b57\u6570\uff0c\u4e0d\u80fd\u8ba1\u4e3a\u771f\u6b63\u5b8c\u6210\uff1b\u8d85\u8fc7\u76ee\u6807\u5b57\u6570\u53ef\u4ee5\u6b63\u5e38\u9a8c\u6536\u3002"}</p>}
    {errors > 0 && <p className="chapter-acceptance-warning"><CircleAlert size={14} />仍有 {errors} 项严重错误，闭环会先修复或暂停，不会直接写下一章。</p>}
  </section>;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceData>(DEMO_WORKSPACE);
  const [config, setConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState<NavKey>("创作台");
  const [chapterId, setChapterId] = useState("chapter-12");
  const [characterId, setCharacterId] = useState("char-1");
  const [mobileNav, setMobileNav] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"AI" | "作品" | "数据">("AI");
  const [exportOpen, setExportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [auditProgress, setAuditProgress] = useState("");
  const [repairingIssueId, setRepairingIssueId] = useState("");
  const [rebuildingChapterId, setRebuildingChapterId] = useState("");
  const [repairQueueRunning, setRepairQueueRunning] = useState(false);
  const [diffChapterId, setDiffChapterId] = useState("");
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [ideaPrompt, setIdeaPrompt] = useState("");
  const [worldFilter, setWorldFilter] = useState<WorldEntry["category"] | "全部">("全部");
  const [materialFilter, setMaterialFilter] = useState<Material["type"] | "全部">("全部");
  const [chapterEditorTab, setChapterEditorTab] = useState<"正文" | "章纲" | "场景卡" | "验收" | "版本">("正文");
  const [bookControlTab, setBookControlTab] = useState<"创作契约" | "传播债务" | "故事线" | "人物资源" | "叙事引擎" | "健康闭环">("创作契约");
  const [backups, setBackups] = useState<WorkspaceBackup[]>([]);
  const [projectLibraryOpen, setProjectLibraryOpen] = useState(false);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [activeCloudProjectId, setActiveCloudProjectId] = useState<string | null>(null);
  const [backgroundConfiguration, setBackgroundConfiguration] = useState<BackgroundConfiguration>({ apiKey: false, model: "", webhookSecret: false });
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const activeCloudProjectIdRef = useRef<string | null>(null);
  const activeCloudRevisionRef = useRef<number | null>(null);
  const cloudBootstrappedRef = useRef(false);
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const aiConfigured = Boolean(config.baseUrl.trim() && config.model.trim());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await readPersistentValue<unknown>(WORKSPACE_KEY);
        if (stored && !cancelled) setWorkspace(reconcileInterruptedTasks(normalizeWorkspaceData(stored, DEMO_WORKSPACE)));
      } catch {
        await removePersistentValue(WORKSPACE_KEY).catch(() => undefined);
        if (!cancelled) setToast("检测到损坏的作品数据，已隔离并载入演示作品");
      }
      try {
        const savedConfig = localStorage.getItem(CONFIG_KEY);
        const parsed = savedConfig ? JSON.parse(savedConfig) as Partial<AIConfig> : {};
        if (!cancelled) setConfig({
          ...DEFAULT_AI_CONFIG,
          ...parsed,
          apiKey: parsed.rememberKey ? parsed.apiKey ?? "" : sessionStorage.getItem(SESSION_KEY) ?? "",
        });
      } catch {
        localStorage.removeItem(CONFIG_KEY);
        if (!cancelled) setConfig({ ...DEFAULT_AI_CONFIG, apiKey: sessionStorage.getItem(SESSION_KEY) ?? "" });
      }
      try {
        const savedBackups = await readPersistentValue<unknown>(BACKUP_KEY);
        if (Array.isArray(savedBackups) && !cancelled) {
          setBackups(savedBackups.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const candidate = item as Partial<WorkspaceBackup>;
            try {
              return candidate.workspace ? [{
                id: typeof candidate.id === "string" ? candidate.id : id("backup"),
                label: typeof candidate.label === "string" ? candidate.label : "自动备份",
                createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
                workspace: normalizeWorkspaceData(candidate.workspace, DEMO_WORKSPACE),
              }] : [];
            } catch {
              return [];
            }
          }).slice(0, 5));
        }
      } catch {
        await removePersistentValue(BACKUP_KEY).catch(() => undefined);
      } finally {
        const activeProject = localStorage.getItem(ACTIVE_PROJECT_KEY);
        if (!cancelled && activeProject) {
          activeCloudProjectIdRef.current = activeProject;
          setActiveCloudProjectId(activeProject);
        }
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !activeCloudProjectId || !cloudBootstrappedRef.current || workspace.automation.phase === "writing") return;
    const timer = window.setTimeout(() => {
      cloudSaveQueueRef.current = cloudSaveQueueRef.current.then(async () => {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeCloudProjectId, workspace: pruneWorkspaceHistory(workspace), expectedRevision: activeCloudRevisionRef.current }),
        });
        const payload = await response.json().catch(() => ({})) as { project?: { revision?: number }; error?: string; conflict?: boolean };
        if (!response.ok) {
          setCloudError(payload.error || "云端自动保存失败");
        } else if (payload.project?.revision) {
          activeCloudRevisionRef.current = payload.project.revision;
          setCloudError("");
        }
      }).catch(() => setCloudError("云端自动保存失败，当前内容仍保存在本机"));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [workspace, activeCloudProjectId, hydrated]);

  useEffect(() => {
    if (!hydrated || cloudBootstrappedRef.current) return;
    if (!activeCloudProjectId) {
      cloudBootstrappedRef.current = true;
      return;
    }
    void fetch(`/api/projects?id=${encodeURIComponent(activeCloudProjectId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { project?: { workspace?: unknown; revision?: number }; error?: string };
        if (!response.ok || !payload.project?.workspace) throw new Error(payload.error || "云端恢复失败");
        const restored = normalizeWorkspaceData(payload.project.workspace, DEMO_WORKSPACE, {
          preserveWritingPhase: isBackgroundWorkspace(payload.project.workspace),
        });
        setWorkspace(restored);
        if (payload.project.revision) activeCloudRevisionRef.current = payload.project.revision;
        setBackgroundActive(restored.project.status === "AI 后台创作中" && ["writing", "reviewing"].includes(restored.automation.phase));
        setChapterId(restored.chapters[0]?.id || "");
        setCharacterId(restored.characters[0]?.id || "");
      })
      .catch((error) => setCloudError(error instanceof Error ? `${error.message}，已保留本地版本` : "云端恢复失败，已保留本地版本"))
      .finally(() => { cloudBootstrappedRef.current = true; });
  }, [activeCloudProjectId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void fetch("/api/automation/background")
      .then(async (response) => await response.json() as { configuration?: BackgroundConfiguration })
      .then((payload) => payload.configuration && setBackgroundConfiguration(payload.configuration))
      .catch(() => undefined);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !activeCloudProjectId || !backgroundActive) return;
    const sync = async () => {
      try {
        const encodedProjectId = encodeURIComponent(activeCloudProjectId);
        const summaryResponse = await fetch(`/api/automation/background?projectId=${encodedProjectId}&summary=1`);
        const summary = await summaryResponse.json() as {
          project?: { revision?: number };
          automation?: { phase?: string } | null;
          active?: { status?: string } | null;
          configuration?: BackgroundConfiguration;
          error?: string;
        };
        if (!summaryResponse.ok || !summary.project) throw new Error(summary.error || "读取后台进度失败");
        if (summary.configuration) setBackgroundConfiguration(summary.configuration);
        const responseActive = ["queued", "processing", "in_progress"].includes(summary.active?.status || "");
        const revisionChanged = Boolean(summary.project.revision && summary.project.revision !== activeCloudRevisionRef.current);
        const needsFullSync = revisionChanged || !responseActive || summary.automation?.phase !== "writing";
        if (!needsFullSync) {
          setBackgroundActive(true);
          return;
        }

        const response = await fetch(`/api/automation/background?projectId=${encodedProjectId}`);
        const payload = await response.json() as { project?: { workspace?: unknown; revision?: number }; active?: { status?: string } | null; configuration?: BackgroundConfiguration; error?: string };
        if (!response.ok || !payload.project?.workspace) throw new Error(payload.error || "读取后台进度失败");
        const next = normalizeWorkspaceData(payload.project.workspace, DEMO_WORKSPACE, { preserveWritingPhase: true });
        setWorkspace((current) => mergeAutomationWorkspace(current, next));
        if (payload.project.revision) activeCloudRevisionRef.current = payload.project.revision;
        if (payload.configuration) setBackgroundConfiguration(payload.configuration);
        const stillActive = ["queued", "processing", "in_progress"].includes(payload.active?.status || "") && ["writing", "reviewing"].includes(next.automation.phase);
        setBackgroundActive(stillActive);
        if (!stillActive && ["completed", "paused"].includes(next.automation.phase)) {
          setToast(next.automation.phase === "completed" ? "云端已通过全书终审" : next.automation.finalReview?.status === "blocked" ? "云端全书终审等待确认" : "云端已完成所选章节范围");
          if (toastTimer.current) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setToast(""), 2300);
        }
      } catch (error) {
        setCloudError(error instanceof Error ? error.message : "读取后台进度失败");
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 5000);
    return () => window.clearInterval(timer);
  }, [activeCloudProjectId, backgroundActive, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const saveDelay = ["writing", "reviewing"].includes(workspace.automation.phase) ? 180 : 500;
    const timer = window.setTimeout(() => {
      void writePersistentValue(WORKSPACE_KEY, pruneWorkspaceHistory(workspace)).catch(() => {
        window.setTimeout(() => setToast("浏览器存储空间不足，请立即导出完整备份"), 0);
      });
    }, saveDelay);
    return () => window.clearTimeout(timer);
  }, [workspace, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const flushWorkspace = () => {
      void writePersistentValue(WORKSPACE_KEY, pruneWorkspaceHistory(workspaceRef.current));
    };
    window.addEventListener("pagehide", flushWorkspace);
    return () => window.removeEventListener("pagehide", flushWorkspace);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config.rememberKey ? config : { ...config, apiKey: "" }));
    if (config.rememberKey) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, config.apiKey);
  }, [config, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void writePersistentValue(BACKUP_KEY, backups.map((backup) => ({ ...backup, workspace: pruneWorkspaceHistory(backup.workspace) }))).catch(() => {
      window.setTimeout(() => setToast("自动备份空间不足，请导出 JSON 备份"), 0);
    });
  }, [backups, hydrated]);

  const storyStructureSignature = useMemo(() => JSON.stringify({
    project: { premise: workspace.project.premise, theme: workspace.project.theme, writingStyle: workspace.project.writingStyle, pointOfView: workspace.project.pointOfView, bookContract: workspace.project.bookContract },
    characters: workspace.characters,
    world: workspace.world,
    outline: workspace.outline,
  }), [workspace.project.premise, workspace.project.theme, workspace.project.writingStyle, workspace.project.pointOfView, workspace.project.bookContract, workspace.characters, workspace.world, workspace.outline]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setWorkspace((current) => {
        const currentSnapshot = buildStoryControlSnapshot(current);
        const control = current.storyControl || EMPTY_STORY_CONTROL;
        if (!control.snapshot) return { ...current, storyControl: { ...control, snapshot: currentSnapshot } };
        const incoming = detectPropagationDebts(control.snapshot, currentSnapshot, current);
        return {
          ...current,
          storyControl: {
            ...control,
            snapshot: currentSnapshot,
            propagationDebts: incoming.length ? mergePropagationDebts(control.propagationDebts, incoming) : control.propagationDebts,
          },
        };
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, storyStructureSignature]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setExportOpen(false);
        setSearch("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const chapter = workspace.chapters.find((item) => item.id === chapterId) ?? workspace.chapters[0];
  const character = workspace.characters.find((item) => item.id === characterId) ?? workspace.characters[0];
  const totalWords = workspace.chapters.reduce((sum, item) => sum + countWords(item.content), 0);
  const completed = workspace.chapters.filter((item) => item.status === "\u5df2\u5b8c\u6210" && (item.generation?.status === "accepted" || countWords(item.content) >= item.targetWords)).length;
  const unresolved = workspace.issues.filter((item) => !item.resolved).length;

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2300);
  };

  const createBackup = (source: WorkspaceData, label: string) => {
    const backup: WorkspaceBackup = {
      id: id("backup"),
      label,
      createdAt: new Date().toISOString(),
      workspace: cloneWorkspace(source),
    };
    setBackups((current) => [backup, ...current].slice(0, 5));
  };

  const restoreBackup = (backup: WorkspaceBackup) => {
    if (!window.confirm(`恢复“${backup.label}”吗？当前作品会先自动备份。`)) return;
    createBackup(workspace, "恢复历史备份前自动备份");
    const restored = normalizeWorkspaceData(cloneWorkspace(backup.workspace), DEMO_WORKSPACE);
    setWorkspace(restored);
    setChapterId(restored.chapters[0]?.id || "");
    setCharacterId(restored.characters[0]?.id || "");
    setSettingsOpen(false);
    notify("已恢复所选作品备份");
  };

  const rememberActiveCloudProject = (projectId: string | null, revision?: number) => {
    activeCloudProjectIdRef.current = projectId;
    setActiveCloudProjectId(projectId);
    if (revision !== undefined) {
      activeCloudRevisionRef.current = revision;
    } else if (!projectId) {
      activeCloudRevisionRef.current = null;
    }
    if (projectId) localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  };

  const loadCloudProjects = async () => {
    setCloudBusy(true);
    setCloudError("");
    try {
      const response = await fetch("/api/projects");
      const payload = await response.json().catch(() => ({})) as { projects?: CloudProjectSummary[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "读取云端作品失败");
      setCloudProjects(payload.projects || []);
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "读取云端作品失败");
    } finally {
      setCloudBusy(false);
    }
  };

  const openProjectLibrary = () => {
    setProjectLibraryOpen(true);
    void loadCloudProjects();
  };

  const saveCloudProject = async (source: WorkspaceData, createCopy = false) => {
    setCloudBusy(true);
    setCloudError("");
    try {
      await cloudSaveQueueRef.current;
      const projectId = createCopy ? undefined : activeCloudProjectIdRef.current || undefined;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          workspace: pruneWorkspaceHistory(source),
          expectedRevision: projectId ? activeCloudRevisionRef.current : undefined,
          createSnapshot: Boolean(projectId),
          snapshotLabel: createCopy ? "复制作品" : "手动云端保存前快照",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { projectId?: string; project?: { revision?: number }; error?: string; conflict?: boolean };
      if (!response.ok || !payload.projectId) throw new Error(payload.error || "保存云端作品失败");
      rememberActiveCloudProject(payload.projectId, payload.project?.revision);
      notify(createCopy ? "已复制为新的云端作品" : "作品已保存到云端");
      await loadCloudProjects();
      return payload.projectId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存云端作品失败";
      setCloudError(message);
      notify(message);
      return null;
    } finally {
      setCloudBusy(false);
    }
  };

  const startBackgroundWriting = async (source: WorkspaceData) => {
    setBackgroundBusy(true);
    try {
      const projectId = await saveCloudProject(source);
      if (!projectId) return;
      const response = await fetch("/api/automation/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "start" }),
      });
      const payload = await response.json().catch(() => ({})) as { workspace?: unknown; status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "启动云端后台写作失败");
      if (payload.workspace) setWorkspace(normalizeWorkspaceData(payload.workspace, DEMO_WORKSPACE, { preserveWritingPhase: true }));
      const active = payload.status === "queued";
      setBackgroundActive(active);
      notify(active ? "云端后台写作已启动，现在可以关闭网页" : "所选写作范围已经完成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "启动云端后台写作失败");
    } finally {
      setBackgroundBusy(false);
    }
  };

  const pauseBackgroundWriting = async () => {
    const projectId = activeCloudProjectIdRef.current;
    if (!projectId) return;
    setBackgroundBusy(true);
    try {
      const response = await fetch("/api/automation/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "pause" }),
      });
      const payload = await response.json().catch(() => ({})) as { workspace?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error || "暂停后台写作失败");
      if (payload.workspace) setWorkspace(normalizeWorkspaceData(payload.workspace, DEMO_WORKSPACE));
      setBackgroundActive(false);
      notify("云端后台写作已暂停");
    } catch (error) {
      notify(error instanceof Error ? error.message : "暂停后台写作失败");
    } finally {
      setBackgroundBusy(false);
    }
  };

  const cancelBackgroundWriting = async () => {
    const projectId = activeCloudProjectIdRef.current;
    if (!projectId) return notify("\u8bf7\u5148\u4fdd\u5b58\u4e3a\u4e91\u7aef\u4f5c\u54c1");
    if (!window.confirm("\u786e\u5b9a\u53d6\u6d88\u5f53\u524d\u4e91\u7aef\u540e\u53f0\u4efb\u52a1\u5417\uff1f\u5df2\u5b8c\u6210\u7684\u7ae0\u8282\u548c\u68c0\u67e5\u70b9\u4f1a\u4fdd\u7559\uff0c\u5f53\u524d\u6a21\u578b\u8bf7\u6c42\u4e0e\u540e\u7eed\u6392\u961f\u4f1a\u505c\u6b62\u3002")) return;
    setBackgroundBusy(true);
    try {
      const response = await fetch("/api/automation/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "cancel" }),
      });
      const payload = await response.json().catch(() => ({})) as { workspace?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error || "\u53d6\u6d88\u540e\u53f0\u4efb\u52a1\u5931\u8d25");
      if (payload.workspace) setWorkspace(normalizeWorkspaceData(payload.workspace, DEMO_WORKSPACE));
      setBackgroundActive(false);
      notify("\u4e91\u7aef\u540e\u53f0\u4efb\u52a1\u5df2\u53d6\u6d88\uff0c\u5df2\u5b8c\u6210\u5185\u5bb9\u5df2\u4fdd\u7559");
    } catch (error) {
      notify(error instanceof Error ? error.message : "\u53d6\u6d88\u540e\u53f0\u4efb\u52a1\u5931\u8d25");
    } finally {
      setBackgroundBusy(false);
    }
  };

  const openCloudProject = async (projectId: string) => {
    setCloudBusy(true);
    setCloudError("");
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`);
      const payload = await response.json().catch(() => ({})) as { project?: { workspace?: unknown; revision?: number }; error?: string };
      if (!response.ok || !payload.project?.workspace) throw new Error(payload.error || "读取云端作品失败");
      const next = normalizeWorkspaceData(payload.project.workspace, DEMO_WORKSPACE, {
        preserveWritingPhase: isBackgroundWorkspace(payload.project.workspace),
      });
      createBackup(workspace, "切换云端作品前自动备份");
      setWorkspace(next);
      setBackgroundActive(next.project.status === "AI 后台创作中" && ["writing", "reviewing"].includes(next.automation.phase));
      setChapterId(next.chapters[0]?.id || "");
      setCharacterId(next.characters[0]?.id || "");
      rememberActiveCloudProject(projectId, payload.project.revision);
      setProjectLibraryOpen(false);
      notify(`已打开《${next.project.title}》`);
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "读取云端作品失败");
    } finally {
      setCloudBusy(false);
    }
  };

  const removeCloudProject = async (project: CloudProjectSummary) => {
    if (!window.confirm(`删除云端作品《${project.title}》吗？此操作不会删除当前浏览器中的本地副本。`)) return;
    setCloudBusy(true);
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除云端作品失败");
      if (activeCloudProjectIdRef.current === project.id) rememberActiveCloudProject(null);
      await loadCloudProjects();
      notify("云端作品已删除");
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "删除云端作品失败");
    } finally {
      setCloudBusy(false);
    }
  };

  const createNewProject = () => {
    createBackup(workspace, "新建作品前自动备份");
    const next = createBlankWorkspace(workspace);
    setWorkspace(next);
    setChapterId("");
    setCharacterId("");
    rememberActiveCloudProject(null);
    setProjectLibraryOpen(false);
    setSettingsTab("作品");
    setSettingsOpen(true);
    notify("已创建空白作品，可以填写想法或直接交给 AI");
  };

  const persistDurableCheckpoint = async (source: WorkspaceData, step: {
    stepKey: string;
    kind: string;
    chapterNumber?: number;
    segmentNumber?: number;
    status: "completed" | "failed";
    outputExcerpt?: string;
    error?: string;
    contextHash?: string;
  }) => {
    try {
      const response = await fetch("/api/automation/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeCloudProjectIdRef.current, workspace: pruneWorkspaceHistory(source), expectedRevision: activeCloudRevisionRef.current, step }),
      });
      const payload = await response.json().catch(() => ({})) as { projectId?: string; revision?: number; error?: string };
      if (!response.ok || !payload.projectId) throw new Error(payload.error || "云端检查点保存失败");
      if (activeCloudProjectIdRef.current !== payload.projectId) rememberActiveCloudProject(payload.projectId, payload.revision);
      else if (payload.revision) activeCloudRevisionRef.current = payload.revision;
      setCloudError("");
    } catch (error) {
      setCloudError(error instanceof Error ? `${error.message}；已继续使用本地检查点` : "云端检查点失败；已继续使用本地检查点");
    }
  };

  const updateChapter = (targetId: string, patch: Partial<Chapter>) => {
    setWorkspace((current) => {
      const target = current.chapters.find((item) => item.id === targetId);
      const contentChanged = target && typeof patch.content === "string" && patch.content !== target.content;
      if (!target || !contentChanged) {
        return {
          ...current,
          chapters: current.chapters.map((item) => item.id === targetId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item),
        };
      }

      const affected = current.chapters.filter((item) => item.number >= target.number);
      let updated = current;
      for (const chapter of affected) updated = removeChapterFromCanon(updated, chapter.number);
      const staleIssueId = `local-memory-stale-${target.number}`;
      return {
        ...updated,
        chapters: updated.chapters.map((item) => item.id === targetId ? {
          ...item,
          ...patch,
          memory: undefined,
          status: "修订中",
          revision: (item.revision || 0) + 1,
          generation: item.generation ? { ...item.generation, status: "generated", acceptedAt: undefined } : item.generation,
          updatedAt: new Date().toISOString(),
        } : item.number > target.number ? {
          ...item,
          memory: undefined,
          status: item.content.trim() ? "修订中" : item.status,
          generation: item.generation ? { ...item.generation, status: "generated", acceptedAt: undefined } : item.generation,
        } : item),
        issues: [
          ...updated.issues.filter((issue) => issue.id !== staleIssueId),
          {
            id: staleIssueId,
            severity: "警告" as const,
            category: "情节" as const,
            title: "人工改稿后需要重建事实记忆",
            description: `第 ${target.number} 章正文已修改，本章及后续章节的旧记忆和审校结论已失效。请从本章开始续写或运行逐章检查。`,
            location: `第 ${target.number} 章`,
            resolved: false,
            chapterNumber: target.number,
            source: "local" as const,
          },
        ],
        automation: {
          ...updated.automation,
          generatedChapterIds: updated.automation.generatedChapterIds.filter((id) => {
            const chapter = updated.chapters.find((item) => item.id === id);
            return chapter ? chapter.number < target.number : false;
          }),
          phase: updated.automation.phase === "completed" ? "paused" : updated.automation.phase,
          currentChapterNumber: target.number,
          currentSegment: target.generation?.completedSegments || 0,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const updateChapterOutline = (targetId: string, patch: Partial<NonNullable<Chapter["chapterOutline"]>>) => {
    setWorkspace((current) => ({
      ...current,
      chapters: current.chapters.map((item) => {
        if (item.id !== targetId) return item;
        const currentOutline = item.chapterOutline || {
          objective: item.summary || "明确本章必须完成的剧情变化",
          opening: "从具体场景和人物行动切入",
          scenes: item.summary ? [item.summary] : ["建立场景与冲突", "迫使人物作出选择", "让选择产生后果"],
          turningPoint: "本章中段或后段发生不可逆转折",
          endingHook: "以新问题、代价或决定收束",
          foreshadowActions: [],
        };
        return { ...item, chapterOutline: { ...currentOutline, ...patch }, updatedAt: new Date().toISOString() };
      }),
    }));
  };

  const addChapter = () => {
    const next = Math.max(0, ...workspace.chapters.map((item) => item.number)) + 1;
    const item: Chapter = {
      id: id("chapter"),
      number: next,
      title: "未命名章节",
      summary: "",
      content: "",
      status: "草稿",
      updatedAt: new Date().toISOString(),
      targetWords: 4000,
      pov: workspace.project.pointOfView.split("·").at(-1)?.trim() || workspace.project.pointOfView,
      chapterOutline: {
        objective: "明确本章必须完成的剧情变化",
        opening: "从具体场景和人物行动切入",
        scenes: ["建立场景与冲突", "迫使人物作出选择", "让选择产生后果"],
        turningPoint: "本章中段或后段发生不可逆转折",
        endingHook: "以新问题、代价或决定收束",
        foreshadowActions: [],
      },
    };
    setWorkspace((current) => ({ ...current, chapters: [...current.chapters, item] }));
    setChapterId(item.id);
    setActive("章节");
    notify(`已创建第 ${next} 章`);
  };

  const saveVersion = (target = chapter, note = "手动存档") => {
    if (!target) return;
    setWorkspace((current) => ({
      ...current,
      versions: [{
        id: id("version"),
        chapterId: target.id,
        title: target.title,
        content: target.content,
        createdAt: new Date().toISOString(),
        note,
      }, ...current.versions],
    }));
    notify("已保存章节版本");
  };

  const runAI = async (task: string, instruction = "", targetChapterId?: string) => {
    if (!config.baseUrl.trim() || !config.model.trim()) {
      setSettingsTab("AI");
      setSettingsOpen(true);
      notify("请先配置 AI 接口");
      return;
    }
    if (workspace.automation.usage.requestCount >= workspace.automation.maxRequests) {
      return notify(`模型调用预算已用完（${workspace.automation.usage.requestCount}/${workspace.automation.maxRequests}）`);
    }
    setWorkspace((current) => reserveAIRequestUsage(current));
    setAiBusy(true);
    setAssistantOpen(true);
    try {
      const prompt = buildUserPrompt(task, instruction, workspace, targetChapterId);
      const stage = detectAIStage(prompt);
      const stageConfig = workspace.automation.stageModels?.[stage];
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          ...resolveStageRequestOptions(stageConfig, config.temperature, 16_384),
          model: stageConfig?.model?.trim() || config.model,
          stage,
          stream: true,
          prompt,
        }),
      });
      const payload = await readAIResponse(response, (_chunk, accumulated) => {
        setAiResult({ task, text: accumulated, chapterId: targetChapterId });
        setResultOpen(true);
      });
      setWorkspace((current) => applyAITokenUsage(current, payload.usage));
      setAiResult({ task, text: payload.text, chapterId: targetChapterId });
      setResultOpen(true);
      setAssistantInput("");
      notify("生成完成，请先审阅结果");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI 请求失败");
    } finally {
      setAiBusy(false);
    }
  };

  const callAIText = async (prompt: string, maxOutputTokens = 16_384) => {
    const stage = detectAIStage(prompt);
    const stageConfig = workspace.automation.stageModels?.[stage];
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...config,
        ...resolveStageRequestOptions(stageConfig, config.temperature, maxOutputTokens),
        model: stageConfig?.model?.trim() || config.model,
        stage,
        stream: true,
        prompt,
      }),
    });
    let lastProgressLength = 0;
    return readAIResponse(response, (_chunk, accumulated) => {
      if (accumulated.length - lastProgressLength < 200) return;
      lastProgressLength = accumulated.length;
      setAuditProgress((current) => `${current.replace(/（已接收 .*? 字）$/, "")}（已接收 ${accumulated.length.toLocaleString("zh-CN")} 字）`);
    });
  };

  const reserveAIRequestUsage = (source: WorkspaceData): WorkspaceData => {
    if (source.automation.usage.requestCount >= source.automation.maxRequests) {
      throw new Error(`模型调用预算已用完（${source.automation.usage.requestCount}/${source.automation.maxRequests}）`);
    }
    return {
      ...source,
      automation: {
        ...source.automation,
        usage: { ...source.automation.usage, requestCount: source.automation.usage.requestCount + 1 },
        updatedAt: new Date().toISOString(),
      },
    };
  };

  const applyAITokenUsage = (source: WorkspaceData, usage?: Record<string, unknown>): WorkspaceData => {
    const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
    const outputTokens = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
    const reportedTotal = Number(usage?.total_tokens);
    const totalTokens = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : inputTokens + outputTokens;
    return {
      ...source,
      automation: {
        ...source.automation,
        usage: {
          ...source.automation.usage,
          inputTokens: source.automation.usage.inputTokens + (Number.isFinite(inputTokens) ? inputTokens : 0),
          outputTokens: source.automation.usage.outputTokens + (Number.isFinite(outputTokens) ? outputTokens : 0),
          totalTokens: source.automation.usage.totalTokens + (Number.isFinite(totalTokens) ? totalTokens : 0),
        },
        updatedAt: new Date().toISOString(),
      },
    };
  };

  const runChapterAudits = async (chapterNumbers?: number[]) => {
    if (!config.baseUrl.trim() || !config.model.trim()) {
      setSettingsTab("AI");
      setSettingsOpen(true);
      return notify("请先配置 AI 接口");
    }
    const requestedNumbers = chapterNumbers?.length ? new Set(chapterNumbers) : undefined;
    const chapters = [...workspace.chapters].filter((item) => item.content.trim() && (!requestedNumbers || requestedNumbers.has(item.number))).sort((a, b) => a.number - b.number);
    if (!chapters.length) return notify("还没有可检查的章节正文");
    const remainingRequests = workspace.automation.maxRequests - workspace.automation.usage.requestCount;
    if (remainingRequests < chapters.length) return notify(`逐章检查需要 ${chapters.length} 次调用，当前只剩 ${Math.max(0, remainingRequests)} 次预算`);
    if (!window.confirm(`${requestedNumbers ? "传播债务复审" : "逐章检查"}将调用 AI 检查 ${chapters.length} 章，每章独立对照前文事实、章纲和伏笔任务。是否继续？`)) return;

    setAiBusy(true);
    let working = workspace;
    const checkedNumbers = new Set(chapters.map((item) => item.number));
    working = {
      ...working,
      issues: working.issues.filter((item) => item.resolved || item.source !== "ai" || !item.chapterNumber || !checkedNumbers.has(item.chapterNumber)),
    };
    try {
      for (const [index, chapter] of chapters.entries()) {
        setAuditProgress(`正在检查第 ${chapter.number} 章（${index + 1}/${chapters.length}）`);
        working = reserveAIRequestUsage(working);
        setWorkspace(working);
        const payload = await callAIText(buildRollingAuditPrompt(working, chapter.number), 8192);
        const auditRunId = id(`manual-audit-${chapter.number}`);
        const issues = [...buildChapterPlanDeviationIssues(working, chapter.number, auditRunId), ...buildMemoryEvidenceIssues(working, chapter.number, auditRunId), ...parseRollingAudit(payload.text!, auditRunId, chapter.number, chapter.content), ...buildCharacterContinuityIssues(working, chapter.number)];
        working = applyAITokenUsage({
          ...working,
          issues: [...working.issues, ...issues],
          canon: { ...working.canon, lastAuditedChapter: Math.max(working.canon.lastAuditedChapter, chapter.number) },
        }, payload.usage);
        setWorkspace(working);
      }
      if (requestedNumbers) {
        working = { ...working, storyControl: { ...(working.storyControl || EMPTY_STORY_CONTROL), propagationDebts: (working.storyControl?.propagationDebts || []).map((debt) => debt.status !== "已清偿" && debt.affectedChapters.some((number) => requestedNumbers.has(number)) ? { ...debt, status: "复审中" as const } : debt) } };
        setWorkspace(working);
      }
      notify(`${requestedNumbers ? "传播债务复审" : "逐章检查"}完成，共发现 ${working.issues.filter((item) => !item.resolved).length} 项待处理问题`);
    } catch (error) {
      setWorkspace(working);
      notify(error instanceof Error ? error.message : "逐章一致性检查失败");
    } finally {
      setAuditProgress("");
      setAiBusy(false);
    }
  };

  const resolveIssueChapterNumber = (issue: ConsistencyIssue) => {
    if (issue.chapterNumber && workspace.chapters.some((item) => item.number === issue.chapterNumber)) return issue.chapterNumber;
    const text = [issue.location, issue.title, issue.description].filter(Boolean).join(" ");
    const numbers = [...text.matchAll(/第\s*(\d+)\s*章/g)].map((match) => Number(match[1]));
    const uniqueNumbers = [...new Set(numbers)].filter((number) => workspace.chapters.some((item) => item.number === number));
    return uniqueNumbers.length === 1 ? uniqueNumbers[0] : undefined;
  };

  const repairIssueAgainst = async (source: WorkspaceData, issue: ConsistencyIssue) => {
    const chapterNumber = issue.chapterNumber;
    const chapter = chapterNumber ? source.chapters.find((item) => item.number === chapterNumber) : undefined;
    if (!chapter?.content.trim()) throw new Error("该问题没有可定位的章节正文");
    const repairBaselineIssues = [...new Map([...source.issues.filter((entry) => !entry.resolved && entry.chapterNumber === chapter.number && entry.severity === "\u9519\u8bef"), issue].map((entry) => [entry.fingerprint || entry.id, entry])).values()];
    const repairScopeIssue: ConsistencyIssue = repairBaselineIssues.length > 1 ? {
      ...repairBaselineIssues[0],
      chapterNumber: chapter.number,
      title: `第 ${chapter.number} 章一键修复（${repairBaselineIssues.length} 项）`,
      description: repairBaselineIssues.map((entry, index) => `${index + 1}. ${entry.title}：${entry.description}`).join("\n"),
      suggestedFix: repairBaselineIssues.map((entry) => entry.suggestedFix).filter(Boolean).join("；"),
    } : { ...issue, chapterNumber: chapter.number };
    let working = source;
    const taskId = id("task");
    working = { ...working, automation: { ...working.automation, taskLog: [{ id: taskId, runId: working.automation.runId, kind: "repair", label: `修复第 ${chapter.number} 章`, status: "running" as const, chapterNumber: chapter.number, startedAt: new Date().toISOString() }, ...(working.automation.taskLog || [])].slice(0, 500) } };
    setAuditProgress(`正在修订第 ${chapter.number} 章正文`);
    working = reserveAIRequestUsage(working);
    setWorkspace(working);
    const repairOutputTokens = Math.min(32_768, Math.max(16_384, Math.ceil(chapter.content.replace(/\s+/g, "").length * 2 + 2_048)));
    const repairPrompt = buildConsistencyRepairPrompt(working, repairScopeIssue, chapter);
    const repairUsages = [] as NonNullable<Awaited<ReturnType<typeof callAIText>>["usage"]>[];
    let repairPayload = await callAIText(repairPrompt, repairOutputTokens);
    if (repairPayload.usage) repairUsages.push(repairPayload.usage);
    const parseValidatedRepair = (value: string) => {
      const parsed = parseConsistencyRepair(value, chapter.content);
      const validationIssues = validateGeneratedChapterDraft(chapter, parsed.revisedContent);
      if (validationIssues.length) throw new Error(`\u4fee\u590d\u540e\u7684\u5b8c\u6574\u6b63\u6587\u672a\u901a\u8fc7\u68c0\u67e5\uff1a${validationIssues.join("\uff1b")}`);
      return parsed;
    };
    let repair;
    try {
      repair = parseValidatedRepair(repairPayload.text!);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "\u4fee\u590d\u7ed3\u679c\u683c\u5f0f\u9519\u8bef";
      working = reserveAIRequestUsage(working);
      setWorkspace(working);
      repairPayload = await callAIText(`${repairPrompt}\n\n【上一次输出未通过校验】\n${reason}\n\n请根据原始正文重新生成一份完整、合法的修复 JSON。不要复述上一次输出，不要返回 Markdown 或解释。`, repairOutputTokens);
      if (repairPayload.usage) repairUsages.push(repairPayload.usage);
      repair = parseValidatedRepair(repairPayload.text!);
    }
    const repairAttempts = (chapter.generation?.repairAttempts || 0) + 1;
    const versionId = id("version");
    working = repairUsages.reduce((state, usage) => applyAITokenUsage(state, usage), working);
    working = removeChapterFromCanon(working, chapter.number);
    working = {
      ...working,
      chapters: working.chapters.map((item) => item.id === chapter.id ? { ...item, content: repair.revisedContent, status: "\u4fee\u8ba2\u4e2d", memory: undefined, quality: undefined, revision: (item.revision || 0) + 1, updatedAt: new Date().toISOString(), repairReview: { beforeVersionId: versionId, changeSummary: repair.changeSummary, edits: repair.edits, outlineEvidence: repair.outlineEvidence, createdAt: new Date().toISOString(), status: "pending" } } : item),
      versions: [{ id: versionId, chapterId: chapter.id, title: chapter.title, content: chapter.content, createdAt: new Date().toISOString(), note: `AI \u4fee\u590d\u524d\u5b58\u6863\uff1a${repairScopeIssue.title}` }, ...working.versions],
    };

    setAuditProgress(`正在重建第 ${chapter.number} 章事实记忆`);
    working = reserveAIRequestUsage(working);
    setWorkspace(working);
    const revisedChapter = working.chapters.find((item) => item.id === chapter.id)!;
    const memoryPayload = await callAIText(buildChapterMemoryPrompt(working, revisedChapter), 8192);
    working = applyAITokenUsage(applyChapterMemory(working, chapter.id, mergeRepairOutlineEvidence(parseChapterMemory(memoryPayload.text!), repair.outlineEvidence)), memoryPayload.usage);
    const memoryCheckRunId = id("memory-check");
    const memoryCheckIssues = [
      ...buildMemoryEvidenceIssues(working, chapter.number, memoryCheckRunId),
      ...buildChapterPlanDeviationIssues(working, chapter.number, memoryCheckRunId),
    ];
    const remainingAfterMemory = working.automation.maxRequests - working.automation.usage.requestCount;
    if (memoryCheckIssues.length && remainingAfterMemory >= 2) {
      setAuditProgress(`\u6b63\u5728\u6821\u6b63\u7b2c ${chapter.number} \u7ae0\u8bb0\u5fc6\u8bc1\u636e`);
      working = reserveAIRequestUsage(working);
      setWorkspace(working);
      const retryMemoryPayload = await callAIText(`${buildChapterMemoryPrompt(working, revisedChapter)}\n\n\u4e0a\u4e00\u6b21\u8bb0\u5fc6\u63d0\u53d6\u5b58\u5728\u4ee5\u4e0b\u8bc1\u636e\u6216\u7ae0\u7eb2\u8986\u76d6\u95ee\u9898\uff1a\n${memoryCheckIssues.map((entry) => `- ${entry.title}\uff1a${entry.description}`).join("\n")}\n\n\u8bf7\u91cd\u65b0\u8fd4\u56de\u5b8c\u6574 JSON\u3002quote \u5fc5\u987b\u9010\u5b57\u590d\u5236\u6b63\u6587\u4e2d\u8fde\u7eed\u539f\u53e5\uff1b\u5982\u6b63\u6587\u786e\u5b9e\u6ca1\u6709\u6267\u884c\u67d0\u9879\u7ae0\u7eb2\uff0c\u5c06\u5176 status \u8bbe\u4e3a missing\uff0c\u4e0d\u5f97\u7f16\u9020\u8bc1\u636e\u3002`, 8192);
      const cleanedForMemoryRetry = removeChapterFromCanon(working, chapter.number);
      working = applyAITokenUsage(applyChapterMemory(cleanedForMemoryRetry, chapter.id, mergeRepairOutlineEvidence(parseChapterMemory(retryMemoryPayload.text!), repair.outlineEvidence)), retryMemoryPayload.usage);
    }

    setAuditProgress(`正在复查第 ${chapter.number} 章`);
    working = reserveAIRequestUsage(working);
    setWorkspace(working);
    const auditPayload = await callAIText(buildRollingAuditPrompt(working, chapter.number, repairBaselineIssues), 8192);
    const auditRunId = id("repair-audit");
    const rawIssues = [...buildChapterQualityIssues(working, chapter.number, auditRunId), ...buildChapterPlanDeviationIssues(working, chapter.number, auditRunId), ...buildMemoryEvidenceIssues(working, chapter.number, auditRunId), ...buildCharacterContinuityIssues(working, chapter.number), ...buildNarrativeIntelligenceIssues(working).filter((issue) => issue.chapterNumber === chapter.number), ...parseRollingAudit(auditPayload.text!, auditRunId, chapter.number, working.chapters.find((item) => item.number === chapter.number)?.content || chapter.content), ...buildNarrativeIntelligenceIssues(working).filter((issue) => issue.chapterNumber === chapter.number)];
    const newIssues = stabilizeRepairAuditIssues(repairBaselineIssues, rawIssues);
    working = applyAITokenUsage(replaceChapterAuditIssues(working, chapter.number, newIssues), auditPayload.usage);
    const quality = evaluateChapterQuality(working, chapter.number);
    const accepted = !newIssues.some((entry) => entry.severity === "错误") && quality.length >= 100 && quality.overall >= 70;
    const finishedAt = new Date().toISOString();
    working = {
      ...working,
      chapters: working.chapters.map((item) => item.id === chapter.id ? {
        ...item, quality, status: accepted ? "已完成" : "修订中",
        generation: item.generation ? { ...item.generation, status: accepted ? "accepted" : "audited", repairAttempts, acceptedAt: accepted ? finishedAt : undefined } : { runId: working.automation.runId || `manual-${Date.now()}`, status: accepted ? "accepted" : "audited", completedSegments: 1, baseRevision: item.revision || 0, repairAttempts, acceptedAt: accepted ? finishedAt : undefined },
      } : item),
      canon: { ...working.canon, lastAuditedChapter: Math.max(working.canon.lastAuditedChapter, chapter.number) },
      automation: {
        ...working.automation,
        generatedChapterIds: accepted ? [...new Set([...working.automation.generatedChapterIds, chapter.id])] : working.automation.generatedChapterIds.filter((value) => value !== chapter.id),
        taskLog: (working.automation.taskLog || []).map((task) => task.id === taskId ? { ...task, status: "completed" as const, finishedAt } : task),
      },
    };
    return { working, accepted, newIssues };
  };

  const repairChapterUntilStable = async (source: WorkspaceData, issue: ConsistencyIssue) => {
    let working = source;
    let currentIssue = issue;
    let result: Awaited<ReturnType<typeof repairIssueAgainst>> | undefined;
    let passes = 0;
    while (passes < MAX_AUTOMATED_REPAIR_ATTEMPTS) {
      const remainingRequests = working.automation.maxRequests - working.automation.usage.requestCount;
      if (remainingRequests < 3) break;
      result = await repairIssueAgainst(working, currentIssue);
      working = result.working;
      passes += 1;
      if (result.accepted) return { ...result, passes };
      const remainingErrors = result.newIssues.filter((entry) => entry.severity === "\u9519\u8bef");
      const chapterNumber = currentIssue.chapterNumber;
      const chapter = chapterNumber ? working.chapters.find((item) => item.number === chapterNumber) : undefined;
      const quality = chapter?.quality;
      currentIssue = remainingErrors.length ? {
        ...remainingErrors[0],
        chapterNumber,
        title: `\u7b2c ${chapterNumber} \u7ae0\u7b2c ${passes + 1} \u8f6e\u81ea\u52a8\u4fee\u590d\uff08${remainingErrors.length} \u9879\uff09`,
        description: remainingErrors.map((entry, index) => `${index + 1}. ${entry.title}\uff1a${entry.description}`).join("\n"),
        suggestedFix: remainingErrors.map((entry) => entry.suggestedFix).filter(Boolean).join("\uff1b"),
      } : {
        ...currentIssue,
        chapterNumber,
        title: `\u7b2c ${chapterNumber} \u7ae0\u7efc\u5408\u8d28\u91cf\u7ee7\u7eed\u4fee\u590d`,
        description: `\u5f53\u524d\u8d28\u91cf ${quality?.overall || 0} \u5206\u3002${(quality?.notes || []).join("\uff1b")}`,
        suggestedFix: (quality?.notes || []).join("\uff1b"),
      };
    }
    return { ...(result || { working, accepted: false, newIssues: [] }), working, passes };
  };

  const repairConsistencyIssue = async (issue: ConsistencyIssue) => {
    if (issue.autoRepairable === false || issue.confidence === "low") return notify("该问题置信度较低，已阻止自动改写，请先人工确认或重新审校");
    const chapterNumber = resolveIssueChapterNumber(issue);
    const chapter = chapterNumber ? workspace.chapters.find((item) => item.number === chapterNumber) : undefined;
    if (!chapter?.content.trim()) return notify("该问题没有可定位的章节正文，无法自动修复");
    if (!config.baseUrl.trim() || !config.model.trim()) { setSettingsTab("AI"); setSettingsOpen(true); return notify("请先配置 AI 接口"); }
    if (workspace.automation.maxRequests - workspace.automation.usage.requestCount < 3) return notify("AI 一键修复至少需要 3 次调用预算");
    if (!window.confirm(`AI 将修订第 ${chapter.number} 章，并重建记忆、复审和生成差异记录。是否继续？`)) return;
    setAiBusy(true); setRepairingIssueId(issue.id); createBackup(workspace, `AI 修复第 ${chapter.number} 章前自动备份`);
    try {
      const result = await repairChapterUntilStable(workspace, { ...issue, chapterNumber: chapter.number });
      setWorkspace(result.working); setDiffChapterId(chapter.id);
      notify(result.accepted ? `\u7b2c ${chapter.number} \u7ae0\u7ecf\u8fc7 ${result.passes} \u8f6e\u4fee\u590d\u5e76\u901a\u8fc7\u9a8c\u6536` : `\u7b2c ${chapter.number} \u7ae0\u5df2\u81ea\u52a8\u4fee\u590d ${result.passes} \u8f6e\uff0c\u4ecd\u6709\u8bc1\u636e\u660e\u786e\u7684\u95ee\u9898\u9700\u8981\u786e\u8ba4`);
    } catch (error) { setWorkspace((current) => ({ ...current, automation: { ...current.automation, taskLog: (current.automation.taskLog || []).map((task) => task.status === "running" ? { ...task, status: "failed" as const, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "修复失败" } : task) } })); notify(error instanceof Error ? error.message : "AI 一键修复失败"); }
    finally { setAuditProgress(""); setRepairingIssueId(""); setAiBusy(false); }
  };

  const rebuildChapterMemoryAndAudit = async (chapter: Chapter) => {
    if (!chapter.content.trim()) return notify("本章还没有正文");
    if (!config.baseUrl.trim() || !config.model.trim()) { setSettingsTab("AI"); setSettingsOpen(true); return notify("请先配置 AI 接口"); }
    if (workspace.automation.maxRequests - workspace.automation.usage.requestCount < 2) return notify("重建记忆并复审至少需要 2 次调用预算");
    setAiBusy(true); setRebuildingChapterId(chapter.id); createBackup(workspace, `重建第 ${chapter.number} 章记忆前自动备份`);
    let working = removeChapterFromCanon(workspace, chapter.number);
    const taskId = id("task");
    working = { ...working, automation: { ...working.automation, taskLog: [{ id: taskId, runId: working.automation.runId, kind: "resync", label: `重建第 ${chapter.number} 章记忆并复审`, status: "running" as const, chapterNumber: chapter.number, startedAt: new Date().toISOString() }, ...(working.automation.taskLog || [])].slice(0, 500) } };
    try {
      setAuditProgress(`正在重建第 ${chapter.number} 章事实记忆`); working = reserveAIRequestUsage(working); setWorkspace(working);
      const memoryPayload = await callAIText(buildChapterMemoryPrompt(working, chapter), 8192);
      working = applyAITokenUsage(applyChapterMemory(working, chapter.id, parseChapterMemory(memoryPayload.text!)), memoryPayload.usage);
      setAuditProgress(`正在复审第 ${chapter.number} 章`); working = reserveAIRequestUsage(working); setWorkspace(working);
      const auditPayload = await callAIText(buildRollingAuditPrompt(working, chapter.number), 8192);
      const auditRunId = id("resync-audit"); const newIssues = [...buildChapterQualityIssues(working, chapter.number, auditRunId), ...buildChapterPlanDeviationIssues(working, chapter.number, auditRunId), ...buildMemoryEvidenceIssues(working, chapter.number, auditRunId), ...buildCharacterContinuityIssues(working, chapter.number), ...buildNarrativeIntelligenceIssues(working).filter((issue) => issue.chapterNumber === chapter.number), ...parseRollingAudit(auditPayload.text!, auditRunId, chapter.number, working.chapters.find((item) => item.number === chapter.number)?.content || chapter.content), ...buildNarrativeIntelligenceIssues(working).filter((issue) => issue.chapterNumber === chapter.number)];
      working = applyAITokenUsage(replaceChapterAuditIssues(working, chapter.number, newIssues), auditPayload.usage);
      const quality = evaluateChapterQuality(working, chapter.number); const accepted = !newIssues.some((item) => item.severity === "错误") && quality.length >= 100 && quality.overall >= 70; const finishedAt = new Date().toISOString();
      working = { ...working, chapters: working.chapters.map((item) => item.id === chapter.id ? { ...item, quality, status: accepted ? "已完成" : "修订中", generation: item.generation ? { ...item.generation, status: accepted ? "accepted" : "blocked", acceptedAt: accepted ? finishedAt : undefined } : { runId: working.automation.runId || `manual-${Date.now()}`, status: accepted ? "accepted" : "blocked", completedSegments: 1, baseRevision: item.revision || 0, acceptedAt: accepted ? finishedAt : undefined } } : item), automation: { ...working.automation, generatedChapterIds: accepted ? [...new Set([...working.automation.generatedChapterIds, chapter.id])] : working.automation.generatedChapterIds.filter((value) => value !== chapter.id), taskLog: (working.automation.taskLog || []).map((task) => task.id === taskId ? { ...task, status: "completed" as const, finishedAt } : task) } };
      setWorkspace(working); notify(accepted ? "本章记忆已重建并通过复审" : "记忆已重建，复审仍有问题需要处理");
    } catch (error) { setWorkspace({ ...working, automation: { ...working.automation, taskLog: (working.automation.taskLog || []).map((task) => task.id === taskId ? { ...task, status: "failed" as const, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "重建失败" } : task) } }); notify(error instanceof Error ? error.message : "重建失败"); }
    finally { setAuditProgress(""); setRebuildingChapterId(""); setAiBusy(false); }
  };

  const repairAllConsistencyIssues = async () => {
    const queue = buildRepairDependencyQueue(workspace);
    if (!queue.length) return notify("当前没有可自动修复的章节错误");
    if (workspace.automation.maxRequests - workspace.automation.usage.requestCount < queue.length * 3) return notify(`修复队列至少需要 ${queue.length * 3} 次调用预算`);
    if (!window.confirm(`将按章节顺序修复 ${queue.length} 章，每章都会保存原稿、重建记忆并复审。是否继续？`)) return;
    setAiBusy(true); setRepairQueueRunning(true); createBackup(workspace, "全书修复队列前自动备份"); let working = workspace; let haltedAt: number | undefined;
    try {
      for (const { chapterNumber, issues, dependsOn, affectedChapters } of queue) {
        const combined: ConsistencyIssue = { ...issues[0], chapterNumber, title: `\u7b2c ${chapterNumber} \u7ae0\u9519\u8bef\u4fee\u590d\u961f\u5217\uff08${issues.length} \u9879\uff09`, description: [...issues.map((item, index) => `${index + 1}. ${item.title}\uff1a${item.description}`), ...(dependsOn.length ? [`\u4f9d\u8d56\u5148\u4fee\u7ae0\u8282\uff1a${dependsOn.join("\u3001")}`] : []), ...(affectedChapters.length ? [`\u4fee\u590d\u540e\u9700\u91cd\u65b0\u68c0\u67e5\uff1a${affectedChapters.join("\u3001")}`] : [])].join("\n"), suggestedFix: issues.map((item) => item.suggestedFix).filter(Boolean).join("\uff1b") };
        const result = await repairChapterUntilStable(working, combined); working = result.working; setWorkspace(working);
        if (!result.accepted) { haltedAt = chapterNumber; break; }
      }
      setWorkspace(working); notify(haltedAt ? `修复队列停在第 ${haltedAt} 章，复审仍未通过` : "全书错误修复队列已完成");
    } catch (error) { setWorkspace({ ...working, automation: { ...working.automation, taskLog: (working.automation.taskLog || []).map((task) => task.status === "running" ? { ...task, status: "failed" as const, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "修复队列失败" } : task) } }); notify(error instanceof Error ? error.message : "修复队列失败"); }
    finally { setAuditProgress(""); setRepairQueueRunning(false); setAiBusy(false); }
  };

  const applyResult = (mode: "insert" | "replace") => {
    if (!aiResult?.chapterId) return;
    const target = workspace.chapters.find((item) => item.id === aiResult.chapterId);
    if (!target) return;
    if (mode === "replace") saveVersion(target, `AI ${aiResult.task}前自动存档`);
    const separator = target.content.trim() ? "\n\n" : "";
    updateChapter(target.id, {
      content: mode === "insert" ? target.content.trim() + separator + aiResult.text : aiResult.text,
      status: target.status === "待生成" ? "草稿" : target.status,
    });
    setChapterId(target.id);
    setActive("章节");
    setResultOpen(false);
    notify(mode === "insert" ? "已插入正文末尾" : "已替换正文，原稿已存档");
  };

  const saveResultAsMaterial = () => {
    if (!aiResult) return;
    setWorkspace((current) => ({
      ...current,
      materials: [{
        id: id("material"),
        type: "摘录",
        title: `AI · ${aiResult.task}`,
        content: aiResult.text,
        tags: ["AI生成", aiResult.task],
        createdAt: new Date().toISOString(),
      }, ...current.materials],
    }));
    notify("已保存到素材库");
  };

  const runLocalCheck = () => {
    const issues: ConsistencyIssue[] = [];
    const chapterNumbers = new Set<number>();
    workspace.chapters.forEach((item) => {
      if (chapterNumbers.has(item.number)) {
        issues.push({ id: id("local"), severity: "错误", category: "情节", title: `第 ${item.number} 章编号重复`, description: "重复编号会影响大纲关联与导出顺序。", location: "章节目录", resolved: false, chapterNumber: item.number, source: "local", suggestedFix: "重新编排章节编号" });
      }
      chapterNumbers.add(item.number);
      if (item.status === "已完成" && !item.content.trim()) {
        issues.push({ id: id("local"), severity: "错误", category: "情节", title: "已完成章节没有正文", description: "请补充正文或更改章节状态。", location: `第 ${item.number} 章`, resolved: false, chapterNumber: item.number, source: "local" });
      }
      else if (item.status === "\u5df2\u5b8c\u6210" && countWords(item.content) < item.targetWords) {
        issues.push({ id: id("local"), severity: "\u9519\u8bef", category: "\u60c5\u8282", title: `\u7b2c ${item.number} \u7ae0\u6b63\u6587\u5b57\u6570\u4e0d\u8db3`, description: `\u672c\u7ae0\u76ee\u6807 ${item.targetWords} \u5b57\uff0c\u5f53\u524d\u7ea6 ${countWords(item.content)} \u5b57\uff0c\u5c1a\u672a\u8fbe\u5230\u76ee\u6807\u5b57\u6570\u3002`, location: `\u7b2c ${item.number} \u7ae0`, resolved: false, chapterNumber: item.number, source: "local", suggestedFix: "\u8865\u8db3\u573a\u666f\u3001\u8f6c\u6298\u4e0e\u7ae0\u672b\u94a9\u5b50\u540e\u91cd\u65b0\u5ba1\u6821" });
      }
      if (item.pov && !workspace.characters.some((person) => person.name === item.pov)) {
        issues.push({ id: id("local"), severity: "警告", category: "人物", title: `视角人物“${item.pov}”没有人物卡`, description: "请建立人物卡或更正视角字段。", location: `第 ${item.number} 章`, resolved: false, chapterNumber: item.number, source: "local", suggestedFix: "统一视角姓名与人物档案" });
      }
      if (!item.chapterOutline?.scenes.length) {
        issues.push({ id: id("local"), severity: "警告", category: "情节", title: `第 ${item.number} 章缺少可执行章纲`, description: "章纲应包含目标、开场、场景链、转折和章末钩子。", location: `第 ${item.number} 章`, resolved: false, chapterNumber: item.number, source: "local" });
      }
    });

    const completedNumbers = new Set(workspace.chapters.filter((item) => item.content.trim()).map((item) => item.number));
    workspace.materials.filter((item) => item.type === "伏笔").forEach((material) => {
      for (const step of material.foreshadowPlan || []) {
        if (!completedNumbers.has(step.chapterNumber)) continue;
        const chapter = workspace.chapters.find((item) => item.number === step.chapterNumber);
        const update = chapter?.memory?.foreshadowUpdates?.find((item) => item.title === material.title);
        const expectedStatus = step.action === "plant" ? "planted" : step.action === "resolve" ? "resolved" : "advanced";
        if (!update || update.status !== expectedStatus) {
          const actionLabel = step.action === "plant" ? "埋设" : step.action === "resolve" ? "回收" : "推进";
          issues.push({
            id: id("local"),
            severity: step.action === "resolve" ? "错误" : "警告",
            category: "情节",
            title: `伏笔任务未验证：${material.title}`,
            description: `第 ${step.chapterNumber} 章应完成“${actionLabel}”：${step.instruction}`,
            location: `第 ${step.chapterNumber} 章`,
            resolved: false,
            chapterNumber: step.chapterNumber,
            source: "local",
            suggestedFix: `在不改变主线的前提下${actionLabel}伏笔“${material.title}”`,
          });
        }
      }
    });
    issues.push(...buildNarrativeHealthIssues(workspace));
    issues.push(...buildMechanicalStyleIssues(workspace));
    issues.push(...propagationDebtIssues(workspace));
    const retained = workspace.issues.filter((item) => !item.id.startsWith("local-") && !item.resolved);
    const normalized = issues.map((item) => ({ ...item, id: `local-${item.id}` }));
    setWorkspace((current) => ({ ...current, issues: [...retained, ...normalized] }));
    notify(`扫描完成，共 ${retained.length + normalized.length} 项待确认`);
  };

  const exportFile = (format: "md" | "txt" | "json") => {
    const chapters = [...workspace.chapters].sort((a, b) => a.number - b.number);
    let content = "";
    let mime = "text/plain";
    if (format === "json") {
      content = JSON.stringify({
        schemaVersion: 3,
        exportedAt: new Date().toISOString(),
        workspace,
      }, null, 2);
      mime = "application/json";
    } else if (format === "txt") {
      content = `${workspace.project.title}\n\n${chapters.map((item) => `第${item.number}章 ${item.title}\n\n${item.content}`).join("\n\n\n")}`;
    } else {
      content = `# ${workspace.project.title}\n\n> ${workspace.project.premise}\n\n${chapters.map((item) => `## 第${item.number}章 ${item.title}\n\n${item.content}`).join("\n\n---\n\n")}`;
      mime = "text/markdown";
    }
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workspace.project.title}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    notify(`已导出 ${format.toUpperCase()} 文件`);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("备份文件超过 20MB，无法安全导入");
      const payload = JSON.parse(await file.text()) as unknown;
      const envelope = payload && typeof payload === "object" && "workspace" in payload
        ? (payload as { workspace: unknown }).workspace
        : payload;
      const data = normalizeWorkspaceData(envelope, DEMO_WORKSPACE);
      createBackup(workspace, "导入作品前自动备份");
      setWorkspace(data);
      setChapterId(data.chapters[0]?.id || "");
      setCharacterId(data.characters[0]?.id || "");
      setSettingsOpen(false);
      notify("作品数据已导入");
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败");
    }
    event.target.value = "";
  };

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return [
      ...workspace.chapters.filter((item) => `${item.number}${item.title}${item.content}`.toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: "章节" as NavKey, id: item.id, title: `第${item.number}章 · ${item.title}`, detail: item.summary })),
      ...workspace.characters.filter((item) => `${item.name}${item.identity}${item.goal}`.toLowerCase().includes(query)).slice(0, 3).map((item) => ({ type: "人物" as NavKey, id: item.id, title: item.name, detail: item.identity })),
      ...workspace.world.filter((item) => `${item.title}${item.summary}${item.details}`.toLowerCase().includes(query)).slice(0, 3).map((item) => ({ type: "世界观" as NavKey, id: item.id, title: item.title, detail: item.summary })),
    ].slice(0, 8);
  }, [search, workspace]);

  const openSearchResult = (result: (typeof searchResults)[number]) => {
    setActive(result.type);
    if (result.type === "章节") setChapterId(result.id);
    if (result.type === "人物") setCharacterId(result.id);
    setSearch("");
  };

  const renderDashboard = () => {
    const chapterProgress = Math.min(100, Math.round(completed / Math.max(1, workspace.project.targetChapters) * 100));
    const wordProgress = Math.min(100, Math.round(totalWords / Math.max(1, workspace.project.targetWords) * 100));
    const recent = [...workspace.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    const nextChapter = [...workspace.chapters].sort((a, b) => a.number - b.number).find((item) => item.status !== "已完成") ?? recent[0];
    return (
      <div className="view">
        <Heading eyebrow="NOVEL WORKSPACE" title="创作台" description="从全局掌握作品进度，把灵感稳定推进成章节。">
          <button className="secondary-button" onClick={() => setActive("AI 全书")}><Rocket size={16} />AI 写全书</button>
          <button className="primary-button" onClick={() => { if (recent[0]) setChapterId(recent[0].id); setActive("章节"); }}><PenLine size={17} />继续写作</button>
        </Heading>
        <section className="project-hero card">
          <div className="project-copy"><span>{workspace.project.genre}</span><h2>《{workspace.project.title}》</h2><p>{workspace.project.premise}</p><div><b>{workspace.project.pointOfView}</b><b>{workspace.project.writingStyle.split("，")[0]}</b></div></div>
          <div className="hero-progress">
            <div className="progress-ring" style={{ "--progress": `${chapterProgress * 3.6}deg` } as CSSProperties}><span><strong>{chapterProgress}%</strong><small>章节进度</small></span></div>
            <div><span>目标 {number(workspace.project.targetWords)} 字</span><div className="mini-track"><i style={{ width: `${wordProgress}%` }} /></div><b>{number(totalWords)} 字</b></div>
          </div>
        </section>
        <section className="book-control-card book-control-compact card">
          <div className="book-control-copy"><span>BOOK CONTRACT</span><h2>整书兑现进度</h2><p><b>{workspace.project.bookContract?.coreSellingPoint || "尚未设置核心卖点"}</b><small>{workspace.project.bookContract?.readingPromise || "补全读者承诺，让每一章有稳定的长期方向。"}</small></p></div>
          <div className="payoff-timeline compact">
            {[{ chapter: 3, payoff: workspace.project.bookContract?.chapter3Payoff }, { chapter: 10, payoff: workspace.project.bookContract?.chapter10Payoff }, { chapter: Math.min(30, workspace.project.targetChapters), payoff: workspace.project.bookContract?.chapter30Payoff }].map((item) => { const reached = workspace.chapters.some((chapter) => chapter.number >= item.chapter && chapter.status === "已完成"); const approaching = !reached && workspace.chapters.some((chapter) => chapter.number >= Math.max(1, item.chapter - 2) && chapter.content.trim()); return <article key={`${item.chapter}-${item.payoff || "empty"}`} className={reached ? "reached" : approaching ? "approaching" : "pending"}><i>{reached ? <Check size={13} /> : item.chapter}</i><div><span>第 {item.chapter} 章</span><b>{reached ? "已到达节点" : approaching ? "推进中" : "未开始"}</b><small>{item.payoff || "待设置兑现内容"}</small></div></article>; })}
          </div>
          <button className="secondary-button compact" onClick={() => setActive("整书控制")}><Target size={15} />打开整书控制</button>
        </section>
        <div className="metric-grid">
          <button className="metric-card" onClick={() => setActive("章节")}><span className="metric-icon indigo"><FileText size={18} /></span><div><small>已完成章节</small><strong>{completed}<em> / {workspace.project.targetChapters}</em></strong></div><TrendingUp size={16} /></button>
          <button className="metric-card" onClick={() => setActive("人物")}><span className="metric-icon cyan"><UsersRound size={18} /></span><div><small>核心人物</small><strong>{workspace.characters.length}<em> 人</em></strong></div><ChevronRight size={16} /></button>
          <button className="metric-card" onClick={() => setActive("素材库")}><span className="metric-icon amber"><Flag size={18} /></span><div><small>创作素材</small><strong>{workspace.materials.length}<em> 条</em></strong></div><ChevronRight size={16} /></button>
          <button className="metric-card" onClick={() => setActive("一致性")}><span className={`metric-icon ${unresolved ? "rose" : "green"}`}><ShieldCheck size={18} /></span><div><small>待确认问题</small><strong>{unresolved}<em> 项</em></strong></div><ChevronRight size={16} /></button>
        </div>
        <div className="dashboard-columns">
          <section className="card recent-card">
            <div className="card-heading"><div><span>最近创作</span><h2>章节</h2></div><button className="secondary-button compact" onClick={addChapter}><Plus size={15} />新建</button></div>
            <div className="chapter-table">
              <div className="chapter-row table-head"><span>章节</span><span>字数</span><span>状态</span><span>更新时间</span></div>
              {recent.map((item) => <button className="chapter-row" key={item.id} onClick={() => { setChapterId(item.id); setActive("章节"); }}><span className="chapter-name"><FileText size={17} /><span><b>第{item.number}章 · {item.title}</b><small>{item.summary || "尚未填写章节梗概"}</small></span></span><span>{number(countWords(item.content))}</span><span><i className={`status-chip status-${item.status}`}>{item.status}</i></span><span>{dateLabel(item.updatedAt)}</span></button>)}
            </div>
            <button className="card-footer-link" onClick={() => setActive("章节")}>查看全部 {workspace.chapters.length} 章<ChevronRight size={15} /></button>
          </section>
          <section className="card next-step-card">
            <div className="card-heading"><div><span>创作建议</span><h2>下一步</h2></div><Zap size={18} /></div>
            <div className="next-step-main"><span><Target size={19} /></span><div><b>{nextChapter ? `推进“${nextChapter.title}”` : "创建第一章"}</b><p>{nextChapter?.summary || "先建立故事方向和章节计划，再开始连续写作。"}</p></div></div>
            <button onClick={() => nextChapter ? runAI("情节推进", `围绕第 ${nextChapter.number} 章“${nextChapter.title}”提供三个推进方案。`, nextChapter.id) : setActive("AI 全书")}><Sparkles size={16} />让 AI 设计推进方案</button>
            <button onClick={() => setActive("一致性")}><ShieldCheck size={16} />处理 {unresolved} 项一致性内容</button>
            <button onClick={() => setActive("大纲")}><ListTree size={16} />查看全书故事结构</button>
          </section>
        </div>
      </div>
    );
  };

  const renderBookControl = () => {
    const contract = workspace.project.bookContract || EMPTY_BOOK_CONTRACT;
    const control = workspace.storyControl || EMPTY_STORY_CONTROL;
    const healthIssues = buildNarrativeHealthIssues(workspace);
    const styleIssues = buildMechanicalStyleIssues(workspace);
    const intelligenceIssues = buildNarrativeIntelligenceIssues(workspace);
    const pacingCurve = derivePacingCurve(workspace);
    const voiceProfiles = deriveCharacterVoiceProfiles(workspace);
    const traceChapter = [...workspace.chapters].filter((item) => item.content.trim()).sort((a, b) => b.number - a.number)[0] || workspace.chapters[0];
    const contextTrace = traceChapter ? traceChapter.contextManifest || compileContextManifest(workspace, traceChapter) : undefined;
    const interactions = deriveCharacterInteractions(workspace);
    const resources = deriveResourceLedger(workspace);
    const storylines = control.storylines.length ? control.storylines : syncStorylinesFromWorkspace(workspace);
    const openDebts = control.propagationDebts.filter((item) => item.status !== "已清偿");
    const completedNumbers = workspace.chapters.filter((item) => item.status === "已完成").map((item) => item.number);
    const highestCompleted = completedNumbers.length ? Math.max(...completedNumbers) : 0;
    const milestones = [{ chapter: 3, title: "早期承诺", payoff: contract.chapter3Payoff }, { chapter: Math.min(10, workspace.project.targetChapters), title: "首轮大回报", payoff: contract.chapter10Payoff }, { chapter: Math.min(30, workspace.project.targetChapters), title: "中后段大回报", payoff: contract.chapter30Payoff }];
    const updateControl = (patch: Partial<NonNullable<WorkspaceData["storyControl"]>>) => setWorkspace((current) => ({ ...current, storyControl: { ...(current.storyControl || EMPTY_STORY_CONTROL), ...patch } }));
    const updateStoryline = (lineId: string, patch: Partial<(typeof storylines)[number]>) => updateControl({ storylines: storylines.map((line) => line.id === lineId ? { ...line, ...patch } : line) });
    const updateManualResource = (entryId: string, patch: Partial<ResourceLedgerEntry>) => updateControl({ resourceLedger: control.resourceLedger.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry) });
    const tabs = ["创作契约", "传播债务", "故事线", "人物资源", "叙事引擎", "健康闭环"] as const;
    return <div className="view book-control-view">
      <Heading eyebrow="BOOK CONTROL" title="整书控制" description="固定全书卖点，追踪设定传播、故事线、人物资源和修复闭环。"><button className="secondary-button" onClick={() => setActive("大纲")}><ListTree size={16} />查看大纲</button><button className="primary-button" onClick={() => setActive("AI 全书")}><Rocket size={16} />进入 AI 全书</button></Heading>
      <section className="book-control-overview card"><div><span>CORE SELLING POINT</span><h2>{contract.coreSellingPoint || "尚未设置不可替代卖点"}</h2><p>{contract.readingPromise || "填写读者承诺后，系统会把它带入章节生成、审校和修复。"}</p></div><aside><small>当前进度</small><strong>第 {highestCompleted || 0} 章</strong><span>{number(totalWords)} / {number(workspace.project.targetWords)} 字</span>{openDebts.length > 0 && <em>{openDebts.length} 项传播债务</em>}</aside></section>
      <nav className="book-control-tabs" aria-label="整书控制区域">{tabs.map((tab) => <button key={tab} className={bookControlTab === tab ? "active" : ""} onClick={() => setBookControlTab(tab)}>{tab}{tab === "传播债务" && openDebts.length > 0 && <i>{openDebts.length}</i>}{tab === "健康闭环" && styleIssues.length + healthIssues.length > 0 && <i>{styleIssues.length + healthIssues.length}</i>}</button>)}</nav>

      {bookControlTab === "创作契约" && <><section className="payoff-control card"><div className="card-heading"><div><span>PAYOFF ROADMAP</span><h2>兑现路线</h2></div><small>到达节点不等于自动通过，需结合正文证据核对</small></div><div className="payoff-timeline detailed">{milestones.map((item, index) => { const reached = highestCompleted >= item.chapter; const approaching = !reached && highestCompleted >= Math.max(0, item.chapter - 2); return <article key={`${item.chapter}-${index}`} className={reached ? "reached" : approaching ? "approaching" : "pending"}><i>{reached ? <Check size={15} /> : item.chapter}</i><div><span>第 {item.chapter} 章 · {item.title}</span><b>{reached ? "已到达，等待证据核对" : approaching ? "正在接近兑现节点" : "尚未进入兑现区间"}</b><p>{item.payoff || "尚未设置该节点必须兑现的内容。"}</p></div></article>; })}</div></section><section className="book-contract-page card"><BookContractEditor value={contract} onChange={(bookContract) => setWorkspace((current) => ({ ...current, project: { ...current.project, bookContract } }))} /></section></>}

      {bookControlTab === "传播债务" && <section className="propagation-debt-board card"><div className="card-heading"><div><span>PROPAGATION DEBT</span><h2>设定变更传播债务</h2></div><small>人物、世界规则、整书契约和大纲修改后自动生成</small></div><div className="debt-summary"><article><strong>{openDebts.length}</strong><span>待处理变更</span></article><article><strong>{[...new Set(openDebts.flatMap((item) => item.affectedChapters))].length}</strong><span>受影响章节</span></article><article><strong>{control.propagationDebts.filter((item) => item.status === "复审中").length}</strong><span>复审中</span></article><article><strong>{control.propagationDebts.filter((item) => item.status === "已清偿").length}</strong><span>已清偿</span></article></div>{openDebts.length ? <div className="propagation-debt-list">{openDebts.map((debt) => <article key={debt.id} className={debt.status === "复审中" ? "reviewing" : ""}><header><div><span>{debt.sourceType} · {debt.changeType}</span><h3>{debt.sourceTitle}</h3></div><b>{debt.status}</b></header><p>{debt.reason}</p><div className="debt-chapters"><small>依赖顺序</small>{debt.affectedChapters.map((chapter) => <i key={chapter}>第 {chapter} 章</i>)}</div><footer><button className="secondary-button compact" disabled={aiBusy} onClick={() => void runChapterAudits(debt.affectedChapters)}><ShieldCheck size={14} />按顺序重新审校</button><button className="secondary-button compact" onClick={() => updateControl({ propagationDebts: control.propagationDebts.map((item) => item.id === debt.id ? { ...item, status: "已清偿" as const } : item) })}><Check size={14} />标记已清偿</button></footer></article>)}</div> : <Empty icon={<CheckCircle2 />} title="没有未清偿的传播债务" text="修改人物、世界规则、整书契约或大纲后，受影响章节会自动出现在这里。" />}</section>}

      {bookControlTab === "故事线" && <section className="storyline-board card"><div className="card-heading"><div><span>STORYLINE BOARD</span><h2>故事线看板</h2></div><div className="card-heading-actions"><button className="secondary-button compact" onClick={() => updateControl({ storylines: syncStorylinesFromWorkspace(workspace) })}><RefreshCw size={14} />同步事实账本</button><button className="primary-button compact" onClick={() => updateControl({ storylines: [...storylines, { id: id("storyline"), title: "新故事线", type: "人物线", status: "活跃", summary: "说明这条故事线要推进什么变化。", characterIds: [], openedChapter: Math.max(1, highestCompleted), lastAdvancedChapter: highestCompleted }] })}><Plus size={14} />新建故事线</button></div></div><div className="storyline-columns">{(["活跃", "停滞", "待回收", "已完成"] as StorylineStatus[]).map((status) => <section key={status}><header><span>{status}</span><b>{storylines.filter((line) => line.status === status).length}</b></header><div>{storylines.filter((line) => line.status === status).map((line) => <article key={line.id}><div><i>{line.type}</i><select value={line.status} onChange={(event) => updateStoryline(line.id, { status: event.target.value as StorylineStatus })}>{["活跃", "停滞", "待回收", "已完成"].map((item) => <option key={item}>{item}</option>)}</select></div><input value={line.title} onChange={(event) => updateStoryline(line.id, { title: event.target.value })} /><textarea value={line.summary} onChange={(event) => updateStoryline(line.id, { summary: event.target.value })} /><footer><span>始于第 {line.openedChapter} 章</span><span>最近推进 {line.lastAdvancedChapter || 0}</span>{line.targetChapter && <span>目标 {line.targetChapter}</span>}</footer></article>)}</div></section>)}</div></section>}

      {bookControlTab === "人物资源" && <div className="character-resource-layout"><section className="interaction-ledger card"><div className="card-heading"><div><span>CHARACTER INTERACTIONS</span><h2>人物互动轨迹</h2></div><small>根据关系图与章节记忆统计</small></div><div className="interaction-list">{interactions.length ? interactions.map((edge) => <article key={edge.id}><span>{edge.from}</span><i className={`tone-${edge.tone}`}>{edge.label}</i><span>{edge.to}</span><small>{edge.count ? "共同进入记忆 " + edge.count + " 次 · 最近第 " + edge.lastChapter + " 章" : "尚无共同章节记忆"}</small></article>) : <Empty icon={<Network />} title="还没有人物互动" text="建立人物关系并完成章节记忆后，这里会形成动态互动轨迹。" />}</div></section><section className="resource-ledger card"><div className="card-heading"><div><span>RESOURCE LEDGER</span><h2>人物资源账本</h2></div><button className="primary-button compact" onClick={() => { const entry: ResourceLedgerEntry = { id: id("resource"), ownerName: workspace.characters[0]?.name || "全局", type: "道具", name: "新资源", state: "说明当前状态与限制", lastChapter: highestCompleted, source: "manual", status: "持有" }; updateControl({ resourceLedger: [entry, ...control.resourceLedger] }); }}><Plus size={14} />添加资源</button></div><div className="resource-table"><div className="resource-row head"><span>归属</span><span>类型</span><span>资源 / 状态</span><span>章节</span><span>状态</span><span /></div>{resources.map((entry) => <div className="resource-row" key={entry.id}>{entry.source === "manual" ? <input value={entry.ownerName} onChange={(event) => updateManualResource(entry.id, { ownerName: event.target.value })} /> : <span>{entry.ownerName}</span>}{entry.source === "manual" ? <select value={entry.type} onChange={(event) => updateManualResource(entry.id, { type: event.target.value as ResourceLedgerEntry["type"] })}>{["金钱", "伤势", "道具", "秘密", "能力"].map((item) => <option key={item}>{item}</option>)}</select> : <i>{entry.type}</i>}<div>{entry.source === "manual" ? <><input value={entry.name} onChange={(event) => updateManualResource(entry.id, { name: event.target.value })} /><input value={entry.state} onChange={(event) => updateManualResource(entry.id, { state: event.target.value })} /></> : <><b>{entry.name}</b><small>{entry.state}</small></>}</div><span>第 {entry.lastChapter || 0} 章</span>{entry.source === "manual" ? <select value={entry.status} onChange={(event) => updateManualResource(entry.id, { status: event.target.value as ResourceLedgerEntry["status"] })}>{["持有", "消耗", "丢失", "解决"].map((item) => <option key={item}>{item}</option>)}</select> : <em>{entry.status}</em>}{entry.source === "manual" ? <button onClick={() => updateControl({ resourceLedger: control.resourceLedger.filter((item) => item.id !== entry.id) })}><Trash2 size={14} /></button> : <small>记忆</small>}</div>)}</div></section></div>}

      {bookControlTab === "叙事引擎" && <div className="narrative-engine-grid">
        <section className="narrative-engine-summary card"><div className="card-heading"><div><span>NARRATIVE WORLD MODEL</span><h2>叙事世界模型</h2></div><small>区分真实发生、读者揭示与人物知情</small></div><div className="engine-metrics"><article><strong>{workspace.canon.narrativeEvents?.length || 0}</strong><span>因果事件</span></article><article><strong>{workspace.canon.knowledgeStates?.length || 0}</strong><span>知识状态</span></article><article><strong>{workspace.canon.narrativeEvents?.filter((item) => item.verified).length || 0}</strong><span>正文已验证</span></article><article><strong>{intelligenceIssues.length}</strong><span>引擎风险</span></article></div>{(workspace.canon.narrativeEvents?.length || 0) > 0 ? <div className="event-stream">{(workspace.canon.narrativeEvents || []).slice(-8).map((event) => <article key={event.id}><span>第 {event.chapterNumber} 章</span><b>{event.event}</b><small>{event.participants.join("、") || "全局事件"}{event.location ? ` · ${event.location}` : ""}</small></article>)}</div> : <Empty icon={<Network />} title="等待建立事件网" text="新生成或重建章节记忆后，会自动提取真实顺序、揭示顺序和人物知识变化。" />}</section>
        <section className="pacing-engine-card card"><div className="card-heading"><div><span>PACING CURVE</span><h2>全书节奏曲线</h2></div><small>行动、揭示、情绪与状态变化的确定性估算</small></div>{pacingCurve.length ? <div className="pacing-chart">{pacingCurve.map((point) => <article key={point.chapterNumber} title={`行动 ${point.action} · 揭示 ${point.revelation} · 情绪 ${point.emotion} · 变化 ${point.change}`}><div><i style={{ height: `${Math.max(6, point.tension)}%` }} /></div><b>{point.chapterNumber}</b><small>{point.label}</small></article>)}</div> : <Empty icon={<TrendingUp />} title="还没有节奏数据" text="章节生成后自动形成节奏曲线。" />}</section>
        <section className="context-trace-card card"><div className="card-heading"><div><span>CONTEXT COMPILER TRACE</span><h2>上下文编译追踪</h2></div><small>{traceChapter ? `第 ${traceChapter.number} 章` : "暂无章节"}</small></div>{contextTrace ? <><div className="context-budget"><strong>{contextTrace.estimatedTokens.toLocaleString("zh-CN")}</strong><span>/ {contextTrace.budgetTokens.toLocaleString("zh-CN")} Token</span><i style={{ width: `${Math.min(100, contextTrace.estimatedTokens / Math.max(1, contextTrace.budgetTokens) * 100)}%` }} /></div><div className="context-trace-list">{contextTrace.items.map((item) => <article key={item.id} className={item.included ? "included" : "excluded"}><span>{item.included ? "已带入" : "已排除"}</span><div><b>{item.section}</b><small>{item.reason}</small></div><em>{item.estimatedTokens} T</em></article>)}</div>{contextTrace.warnings.map((warning) => <p className="context-warning" key={warning}><CircleAlert size={14} />{warning}</p>)}</> : <Empty icon={<BrainCircuit />} title="没有可追踪上下文" text="开始生成章节后显示每项上下文为何进入或被排除。" />}</section>
        <section className="voice-engine-card card"><div className="card-heading"><div><span>CHARACTER VOICE</span><h2>人物声纹</h2></div><small>从已写对白中持续学习，不强行统一文风</small></div><div className="voice-profile-list">{voiceProfiles.map((profile) => <article key={profile.characterName}><header><b>{profile.characterName}</b><span>{profile.sampleCount} 条对白</span></header><div><span>均长 {profile.averageLength}</span><span>问句 {profile.questionRate}%</span><span>感叹 {profile.exclamationRate}%</span></div><p>{profile.modalWords.length ? `语气：${profile.modalWords.join("、")}` : "对白样本不足，继续写作后自动形成声纹。"}</p></article>)}</div><footer className="preference-profile"><b>已学习的写作偏好</b><span>节奏：{control.writingPreferences?.preferredPacing || "balanced"}</span><span>对白：{control.writingPreferences?.preferredDialogueRatio || "balanced"}</span>{control.writingPreferences && <button className="secondary-button compact" onClick={() => updateControl({ writingPreferences: undefined })}><RotateCcw size={14} />重置偏好</button>}</footer></section>
      </div>}
      {bookControlTab === "健康闭环" && <><section className="narrative-health-card card"><div className="card-heading"><div><span>NARRATIVE HEALTH LOOP</span><h2>全书健康闭环</h2></div><small>规则发现根因，修复后重建记忆并再次审校</small></div><div className="health-loop-metrics"><article><strong>{healthIssues.filter((issue) => /故事线/.test(issue.title)).length}</strong><span>停滞故事线</span></article><article><strong>{healthIssues.filter((issue) => /核心人物/.test(issue.title)).length}</strong><span>人物离场风险</span></article><article><strong>{healthIssues.filter((issue) => /场景执行卡/.test(issue.title)).length}</strong><span>场景计划缺口</span></article><article className={healthIssues.some((issue) => /平台期/.test(issue.title)) ? "has-risk" : ""}><strong>{healthIssues.filter((issue) => /平台期/.test(issue.title)).length}</strong><span>修复平台期</span></article></div><div className="health-loop-flow"><span><i>1</i>健康扫描</span><ChevronRight size={15} /><span><i>2</i>生成任务</span><ChevronRight size={15} /><span><i>3</i>最小修复</span><ChevronRight size={15} /><span><i>4</i>重建记忆</span><ChevronRight size={15} /><span><i>5</i>复审验收</span></div></section><section className="style-immune-card card"><div className="card-heading"><div><span>STYLE IMMUNE SYSTEM</span><h2>机械文风免疫系统</h2></div><small>完全由确定性规则扫描，不消耗模型调用</small></div><div className="style-immune-metrics"><article><strong>{styleIssues.filter((issue) => /句式|模板句式/.test(issue.title)).length}</strong><span>重复句式</span></article><article><strong>{styleIssues.filter((issue) => /情绪/.test(issue.title)).length}</strong><span>空泛情绪</span></article><article><strong>{styleIssues.filter((issue) => /连接词/.test(issue.title)).length}</strong><span>转折词过密</span></article><article><strong>{styleIssues.filter((issue) => /结尾/.test(issue.title)).length}</strong><span>模板结尾</span></article><article><strong>{styleIssues.filter((issue) => /重复段落/.test(issue.title)).length}</strong><span>重复段落</span></article></div>{styleIssues.length ? <div className="style-findings">{styleIssues.slice(0, 8).map((issue) => <article key={issue.id}><CircleAlert size={15} /><div><b>{issue.title}</b><small>{issue.description}</small></div><span>第 {issue.chapterNumber} 章</span></article>)}</div> : <Empty icon={<ShieldCheck />} title="没有发现明显机械文风" text="扫描未发现高频模板句、空泛情绪、过密连接词、总结式结尾或重复段落。" />}<div className="health-loop-actions"><p>扫描结果会进入一致性修复中心，并要求 AI 只改写命中的具体句段。</p><button className="primary-button" onClick={() => { runLocalCheck(); setActive("一致性"); }}><RefreshCw size={15} />扫描并进入修复中心</button></div></section></>}
    </div>;
  };

  const renderIdeas = () => (
    <div className="view">
      <Heading eyebrow="IDEA LAB" title="灵感实验室" description="收集火花、发展冲突，让零散想法回到当前作品。">
        <button className="primary-button" onClick={() => { setWorkspace((current) => ({ ...current, ideas: [{ id: id("idea"), title: "新灵感", content: "记录这个想法将如何影响人物或情节。", tags: ["待整理"], favorite: false, createdAt: new Date().toISOString() }, ...current.ideas] })); notify("已创建灵感卡"); }}><Plus size={17} />记录灵感</button>
      </Heading>
      <section className="ai-generator-card"><span className="generator-icon"><Sparkles size={22} /></span><div><h2>用作品上下文发散灵感</h2><p>AI 会读取主题、人物与伏笔，不会生成无关的随机点子。</p><div className="generator-input"><input value={ideaPrompt} onChange={(event) => setIdeaPrompt(event.target.value)} placeholder="例如：设计一个发生在暴雨停电夜的关键选择…" /><button disabled={!ideaPrompt.trim()} onClick={() => runAI("灵感发散", ideaPrompt)}>生成方向</button></div></div></section>
      <div className="section-bar"><div><h2>灵感卡</h2><span>{workspace.ideas.length} 条</span></div><small>自动保存</small></div>
      <div className="idea-grid">{workspace.ideas.map((idea) => <article className="idea-card card" key={idea.id}><div className="idea-card-top"><span><Lightbulb size={17} /></span><button className={idea.favorite ? "favorite" : ""} onClick={() => setWorkspace((current) => ({ ...current, ideas: current.ideas.map((item) => item.id === idea.id ? { ...item, favorite: !item.favorite } : item) }))}><Heart size={17} fill={idea.favorite ? "currentColor" : "none"} /></button></div><input value={idea.title} onChange={(event) => setWorkspace((current) => ({ ...current, ideas: current.ideas.map((item) => item.id === idea.id ? { ...item, title: event.target.value } : item) }))} /><textarea value={idea.content} onChange={(event) => setWorkspace((current) => ({ ...current, ideas: current.ideas.map((item) => item.id === idea.id ? { ...item, content: event.target.value } : item) }))} /><div className="tag-row">{idea.tags.map((tag) => <i key={tag}>{tag}</i>)}</div><footer><span>{dateLabel(idea.createdAt)}</span><button onClick={() => setWorkspace((current) => ({ ...current, ideas: current.ideas.filter((item) => item.id !== idea.id) }))}><Trash2 size={15} /></button></footer></article>)}</div>
    </div>
  );

  const renderWorld = () => {
    const categories: Array<WorldEntry["category"] | "全部"> = ["全部", "地点", "势力", "规则", "历史", "物件"];
    const entries = worldFilter === "全部" ? workspace.world : workspace.world.filter((item) => item.category === worldFilter);
    return (
      <div className="view">
        <Heading eyebrow="STORY WORLD" title="世界观圣经" description="让地点、势力、规则与历史彼此咬合，成为情节发生的原因。">
          <button className="secondary-button" onClick={() => runAI("世界构建", "检查现有设定，提出三个最值得扩写的空白。")}><Sparkles size={16} />AI 补全</button>
          <button className="primary-button" onClick={() => { const item: WorldEntry = { id: id("world"), category: worldFilter === "全部" ? "地点" : worldFilter, title: "新设定", summary: "一句话概括这个设定。", details: "补充来源、限制、日常影响和剧情冲突。" }; setWorkspace((current) => ({ ...current, world: [item, ...current.world] })); }}><Plus size={17} />新建设定</button>
        </Heading>
        <div className="filter-tabs">{categories.map((item) => <button key={item} className={worldFilter === item ? "active" : ""} onClick={() => setWorldFilter(item)}>{item}<span>{item === "全部" ? workspace.world.length : workspace.world.filter((entry) => entry.category === item).length}</span></button>)}</div>
        <div className="world-grid">{entries.map((entry) => <article className="world-card card" key={entry.id}><div className="world-card-head"><select value={entry.category} onChange={(event) => setWorkspace((current) => ({ ...current, world: current.world.map((item) => item.id === entry.id ? { ...item, category: event.target.value as WorldEntry["category"] } : item) }))}>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select><Globe2 size={18} /><button onClick={() => setWorkspace((current) => ({ ...current, world: current.world.filter((item) => item.id !== entry.id) }))}><Trash2 size={15} /></button></div><input className="title-input" value={entry.title} onChange={(event) => setWorkspace((current) => ({ ...current, world: current.world.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item) }))} /><textarea className="summary-input" value={entry.summary} onChange={(event) => setWorkspace((current) => ({ ...current, world: current.world.map((item) => item.id === entry.id ? { ...item, summary: event.target.value } : item) }))} /><textarea className="details-input" value={entry.details} onChange={(event) => setWorkspace((current) => ({ ...current, world: current.world.map((item) => item.id === entry.id ? { ...item, details: event.target.value } : item) }))} /><button className="text-action" onClick={() => runAI("世界构建", `深化“${entry.title}”：${entry.summary}`)}><WandSparkles size={15} />用 AI 深化</button></article>)}</div>
      </div>
    );
  };

  const updateCharacter = (patch: Partial<Character>) => {
    if (!character) return;
    setWorkspace((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, ...patch } : item) }));
  };

  const renderCharacters = () => (
    <div className="view">
      <Heading eyebrow="CHARACTER BIBLE" title="人物档案" description="记录欲望、矛盾与弧光，让每一次选择都有来源。">
        <button className="primary-button" onClick={() => { const item: Character = { id: id("char"), name: "新人物", role: "配角", age: "", identity: "", goal: "", conflict: "", arc: "", traits: ["待完善"], color: "#6366f1" }; setWorkspace((current) => ({ ...current, characters: [...current.characters, item] })); setCharacterId(item.id); }}><Plus size={17} />创建人物</button>
      </Heading>
      <div className="character-layout">
        <div className="character-list">{workspace.characters.map((item) => <button key={item.id} className={character?.id === item.id ? "active" : ""} onClick={() => setCharacterId(item.id)}><span className="character-avatar" style={{ background: item.color }}>{item.name.slice(0, 1)}</span><span><b>{item.name}</b><small>{item.role} · {item.identity || "身份待完善"}</small></span><ChevronRight size={16} /></button>)}</div>
        {character ? <section className="character-editor card"><div className="character-profile-head"><span className="large-avatar" style={{ background: character.color }}>{character.name.slice(0, 1)}</span><div><input value={character.name} onChange={(event) => updateCharacter({ name: event.target.value })} /><p>{character.identity || "完善人物身份"}</p></div><button className="secondary-button compact" onClick={() => runAI("人物深化", `深化人物“${character.name}”，重点解决目标与内在冲突。`)}><Sparkles size={15} />AI 深化</button></div><div className="form-grid two-col"><label><span>角色定位</span><input value={character.role} onChange={(event) => updateCharacter({ role: event.target.value })} /></label><label><span>年龄</span><input value={character.age} onChange={(event) => updateCharacter({ age: event.target.value })} /></label><label className="full"><span>身份</span><input value={character.identity} onChange={(event) => updateCharacter({ identity: event.target.value })} /></label><label className="full"><span>外在目标</span><textarea value={character.goal} onChange={(event) => updateCharacter({ goal: event.target.value })} /></label><label className="full"><span>核心冲突</span><textarea value={character.conflict} onChange={(event) => updateCharacter({ conflict: event.target.value })} /></label><label className="full"><span>人物弧光</span><textarea value={character.arc} onChange={(event) => updateCharacter({ arc: event.target.value })} /></label><label className="full"><span>性格标签（逗号分隔）</span><input value={character.traits.join("，")} onChange={(event) => updateCharacter({ traits: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} /></label></div><footer><span><Cloud size={14} />修改已自动保存</span><button onClick={() => { setWorkspace((current) => ({ ...current, characters: current.characters.filter((item) => item.id !== character.id), relationships: current.relationships.filter((item) => item.fromId !== character.id && item.toId !== character.id) })); setCharacterId(workspace.characters.find((item) => item.id !== character.id)?.id || ""); }}><Trash2 size={15} />删除人物</button></footer></section> : <Empty icon={<UsersRound />} title="还没有人物" text="创建第一个人物卡。" />}
      </div>
      <section className="tracking-ledger card"><div className="card-heading"><div><span>CHARACTER TRACKING</span><h2>人物最新状态</h2></div><small>来自章节事实记忆</small></div><div className="tracking-grid">{latestCharacterTracking(workspace).map(({ character: person, latest, history }) => <article key={person.id}><header><span className="character-avatar" style={{ background: person.color }}>{person.name.slice(0, 1)}</span><div><b>{person.name}</b><small>{latest ? `更新至第 ${latest.chapterNumber} 章` : "尚无章节状态"}</small></div></header><p>{latest?.state || "完成章节记忆提取后，将在这里记录位置、身体、情绪、知情范围、目标与关系变化。"}</p><footer>状态记录 {history.length} 条</footer></article>)}</div></section>
    </div>
  );

  const renderRelationships = () => (
    <div className="view">
      <Heading eyebrow="RELATIONSHIP MAP" title="人物关系图" description="追踪联盟、秘密与对立，观察冲突如何在人物之间流动。">
        <button className="primary-button" onClick={() => { if (workspace.characters.length < 2) return notify("至少需要两个人物"); setWorkspace((current) => ({ ...current, relationships: [...current.relationships, { id: id("rel"), fromId: current.characters[0].id, toId: current.characters[1].id, label: "新关系", tone: "复杂", description: "描述关系来源、张力与变化方向。" }] })); }}><Plus size={17} />添加关系</button>
      </Heading>
      <section className="relationship-map card"><div className="map-legend"><span><i className="positive" />正向</span><span><i className="complex" />复杂</span><span><i className="hostile" />对立</span><span><i className="unknown" />未知</span></div><div className="network-stage">{workspace.characters.slice(0, 5).map((item, index) => <button key={item.id} className={`network-node node-${index + 1}`} onClick={() => { setCharacterId(item.id); setActive("人物"); }}><span style={{ background: item.color }}>{item.name.slice(0, 1)}</span><b>{item.name}</b><small>{item.role}</small></button>)}<Network size={80} className="network-watermark" /></div></section>
      <div className="section-bar"><div><h2>关系清单</h2><span>{workspace.relationships.length} 条</span></div></div>
      <div className="relationship-list">{workspace.relationships.map((relation) => <article className="relationship-row card" key={relation.id}><div className="relationship-people"><select value={relation.fromId} onChange={(event) => setWorkspace((current) => ({ ...current, relationships: current.relationships.map((item) => item.id === relation.id ? { ...item, fromId: event.target.value } : item) }))}>{workspace.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className={`relation-line tone-${relation.tone}`}><i /><Network size={15} /><i /></span><select value={relation.toId} onChange={(event) => setWorkspace((current) => ({ ...current, relationships: current.relationships.map((item) => item.id === relation.id ? { ...item, toId: event.target.value } : item) }))}>{workspace.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="relationship-detail"><input value={relation.label} onChange={(event) => setWorkspace((current) => ({ ...current, relationships: current.relationships.map((item) => item.id === relation.id ? { ...item, label: event.target.value } : item) }))} /><textarea value={relation.description} onChange={(event) => setWorkspace((current) => ({ ...current, relationships: current.relationships.map((item) => item.id === relation.id ? { ...item, description: event.target.value } : item) }))} /></div><select className={`tone-select tone-${relation.tone}`} value={relation.tone} onChange={(event) => setWorkspace((current) => ({ ...current, relationships: current.relationships.map((item) => item.id === relation.id ? { ...item, tone: event.target.value as typeof relation.tone } : item) }))}><option>正向</option><option>复杂</option><option>对立</option><option>未知</option></select><button className="icon-button" onClick={() => setWorkspace((current) => ({ ...current, relationships: current.relationships.filter((item) => item.id !== relation.id) }))}><Trash2 size={15} /></button></article>)}</div>
    </div>
  );

  const renderOutline = () => {
    const progress = Math.round(workspace.outline.filter((item) => item.status !== "待规划").length / Math.max(1, workspace.outline.length) * 100);
    return (
      <div className="view">
        <Heading eyebrow="STORY ARCHITECTURE" title="故事大纲" description="用关键节点控制节奏、转折与代价，始终看见全书结构。">
          <button className="secondary-button" onClick={() => runAI("生成大纲", "审阅现有结构，补充关键选择和伏笔回收。")}><Sparkles size={16} />AI 规划</button>
          <button className="primary-button" onClick={() => setWorkspace((current) => ({ ...current, outline: [...current.outline, { id: id("beat"), act: "新幕", title: "新的故事节点", summary: "描述事件、人物选择与不可逆变化。", chapterRange: "待分配", status: "待规划" }] }))}><Plus size={17} />添加节点</button>
        </Heading>
        <section className="outline-summary card"><div><span>结构完成度</span><strong>{progress}%</strong></div><div className="outline-track"><i style={{ width: `${progress}%` }} /></div><p><b>{workspace.outline.length}</b> 个关键节点 · <b>{workspace.outline.filter((item) => item.status === "已完成").length}</b> 个已完成</p></section>
        <div className="outline-list">{workspace.outline.map((beat, index) => <article className="outline-beat card" key={beat.id}><div className="beat-index"><span>{String(index + 1).padStart(2, "0")}</span><i /></div><div className="beat-content"><div className="beat-meta"><input value={beat.act} onChange={(event) => setWorkspace((current) => ({ ...current, outline: current.outline.map((item) => item.id === beat.id ? { ...item, act: event.target.value } : item) }))} /><input value={beat.chapterRange} onChange={(event) => setWorkspace((current) => ({ ...current, outline: current.outline.map((item) => item.id === beat.id ? { ...item, chapterRange: event.target.value } : item) }))} /></div><input className="beat-title" value={beat.title} onChange={(event) => setWorkspace((current) => ({ ...current, outline: current.outline.map((item) => item.id === beat.id ? { ...item, title: event.target.value } : item) }))} /><textarea value={beat.summary} onChange={(event) => setWorkspace((current) => ({ ...current, outline: current.outline.map((item) => item.id === beat.id ? { ...item, summary: event.target.value } : item) }))} /></div><div className="beat-actions"><select value={beat.status} onChange={(event) => setWorkspace((current) => ({ ...current, outline: current.outline.map((item) => item.id === beat.id ? { ...item, status: event.target.value as typeof beat.status } : item) }))}><option>待规划</option><option>进行中</option><option>已完成</option></select><button className="icon-button" onClick={() => setWorkspace((current) => ({ ...current, outline: current.outline.filter((item) => item.id !== beat.id) }))}><Trash2 size={15} /></button></div></article>)}</div>
      </div>
    );
  };

  const restoreVersion = (versionId: string) => {
    if (!chapter) return;
    const version = workspace.versions.find((item) => item.id === versionId);
    if (!version) return;
    saveVersion(chapter, "恢复旧版本前自动存档");
    updateChapter(chapter.id, { title: version.title, content: version.content });
    setChapterEditorTab("正文");
    notify("已恢复所选版本");
  };

  const selectChapterCandidate = (candidateId: string) => {
    if (!chapter?.candidates?.length) return;
    const selected = chapter.candidates.find((item) => item.id === candidateId);
    if (!selected || selected.content === chapter.content) return;
    setWorkspace((current) => {
      const target = current.chapters.find((item) => item.id === chapter.id);
      const candidate = target?.candidates?.find((item) => item.id === candidateId);
      if (!target || !candidate || candidate.content === target.content) return current;
      const previousCandidates = target.candidates || [];
      const switchRunId = id("candidate-switch");
      const rewound = rewindNovelFromChapter(current, target.number, switchRunId);
      const preference = learnWritingPreference(current.storyControl?.writingPreferences, candidate, previousCandidates.filter((item) => item.id !== candidate.id));
      return {
        ...rewound,
        chapters: rewound.chapters.map((item) => item.id === target.id ? {
          ...item, content: candidate.content, status: "修订中", candidates: previousCandidates.map((entry) => ({ ...entry, selected: entry.id === candidate.id })),
          generation: { runId: switchRunId, status: "generating", completedSegments: 1, baseRevision: item.revision || 0, repairAttempts: 0, draftAttempts: 0 }, updatedAt: new Date().toISOString(),
        } : item),
        storyControl: { ...(rewound.storyControl || EMPTY_STORY_CONTROL), writingPreferences: preference },
      };
    });
    notify("已切换候选稿；本章及后续章节已建立安全恢复点，将按顺序重建记忆并复审");
  };
  const renderChapters = () => {
    const versions = workspace.versions.filter((item) => item.chapterId === chapter?.id);
    const tabs = [
      { key: "正文", icon: FileText },
      { key: "章纲", icon: ListTree },
      { key: "场景卡", icon: Network },
      { key: "验收", icon: ShieldCheck },
      { key: "版本", icon: History },
    ] as const;
    return (
      <div className="chapter-workbench">
        <aside className="chapter-sidebar">
          <div className="chapter-side-head"><div><span>章节目录</span><b>{workspace.chapters.length} 章</b></div><button onClick={addChapter}><Plus size={17} /></button></div>
          <div className="chapter-side-list">{[...workspace.chapters].sort((a, b) => a.number - b.number).map((item) => <button key={item.id} className={chapter?.id === item.id ? "active" : ""} onClick={() => { setChapterId(item.id); setChapterEditorTab("正文"); }}><span>{item.number}</span><div><b>{item.title}</b><small>{number(countWords(item.content))} 字 · {item.status}</small></div><i /></button>)}</div>
        </aside>
        {chapter ? <section className="chapter-editor">
          <header className="editor-topbar"><div><span>第 {chapter.number} 章</span><select value={chapter.status} onChange={(event) => updateChapter(chapter.id, { status: event.target.value as ChapterStatus })}>{chapterStatuses.map((item) => <option key={item}>{item}</option>)}</select></div><div><button className="secondary-button compact" onClick={() => setChapterEditorTab("版本")}><History size={15} />版本 {versions.length}</button><button className="secondary-button compact" onClick={() => saveVersion(chapter)}><Save size={15} />存档</button><button className="icon-button" onClick={() => { if (!window.confirm(`删除第 ${chapter.number} 章吗？`)) return; setWorkspace((current) => ({ ...current, chapters: current.chapters.filter((item) => item.id !== chapter.id) })); setChapterId(workspace.chapters.find((item) => item.id !== chapter.id)?.id || ""); }}><Trash2 size={16} /></button></div></header>
          <div className="editor-document">
            <input className="chapter-title-input" value={chapter.title} onChange={(event) => updateChapter(chapter.id, { title: event.target.value })} />
            <textarea className="chapter-summary-input" value={chapter.summary} onChange={(event) => updateChapter(chapter.id, { summary: event.target.value })} placeholder="用一两句话概括本章发生的关键变化…" />
            <div className="editor-meta"><label>视角 <input value={chapter.pov || ""} onChange={(event) => updateChapter(chapter.id, { pov: event.target.value })} /></label><label>目标字数 <input type="number" value={chapter.targetWords} onChange={(event) => updateChapter(chapter.id, { targetWords: Number(event.target.value) })} /></label><span>{number(countWords(chapter.content))} 字</span></div>
            <nav className="chapter-editor-tabs" aria-label="章节编辑区域">{tabs.map(({ key, icon: Icon }) => <button key={key} className={chapterEditorTab === key ? "active" : ""} onClick={() => setChapterEditorTab(key)}><Icon size={15} />{key}{key === "验收" && workspace.issues.some((item) => !item.resolved && item.chapterNumber === chapter.number) && <i />}</button>)}</nav>

            {chapterEditorTab === "正文" && <section className="chapter-tab-panel prose-panel">
              <div className="ai-writing-bar"><span><Sparkles size={16} />AI 写作</span><button disabled={!chapter.content} onClick={() => runAI("续写本章", "从当前结尾自然续写。", chapter.id)}>续写</button><button disabled={!chapter.content} onClick={() => runAI("润色改写", "保持事件不变，增强画面与节奏。", chapter.id)}>润色</button><button onClick={() => runAI("情节推进", "给出接下来的三个行动方案。", chapter.id)}>推进建议</button><button onClick={() => runAI("生成章节", chapter.summary || "依据大纲生成本章。", chapter.id)}>生成草稿</button></div>
              {chapter.candidates && chapter.candidates.length > 1 && <div className="chapter-candidate-strip"><header><div><Sparkles size={15} /><b>候选写法</b><span>系统已按章纲覆盖、篇幅和你的历史选择排序</span></div><small>切换后会自动存档当前稿</small></header><div>{chapter.candidates.map((candidate, index) => <button key={candidate.id} disabled={candidate.selected} className={candidate.selected ? "selected" : ""} onClick={() => selectChapterCandidate(candidate.id)}><span>方案 {index + 1}</span><strong>{candidate.score} 分</strong><small>{candidate.reasons.slice(0, 2).join(" · ")}</small>{candidate.selected && <i><Check size={12} />当前稿</i>}</button>)}</div></div>}
              <textarea className="manuscript" value={chapter.content} onChange={(event) => updateChapter(chapter.id, { content: event.target.value })} placeholder="从这里开始写作…" />
            </section>}

            {chapterEditorTab === "章纲" && <section className="chapter-tab-panel">
              <section className="chapter-outline-card"><header><div><span>CHAPTER BLUEPRINT</span><h3>本章章纲</h3></div><small>AI 生成与一致性检查都会严格执行</small></header><div className="chapter-outline-grid"><label><span>本章目标</span><textarea value={chapter.chapterOutline?.objective || ""} onChange={(event) => updateChapterOutline(chapter.id, { objective: event.target.value })} placeholder="本章结束时，剧情必须发生什么变化？" /></label><label><span>开场切入</span><textarea value={chapter.chapterOutline?.opening || ""} onChange={(event) => updateChapterOutline(chapter.id, { opening: event.target.value })} placeholder="用什么场景、动作或冲突开场？" /></label><label><span>关键转折</span><textarea value={chapter.chapterOutline?.turningPoint || ""} onChange={(event) => updateChapterOutline(chapter.id, { turningPoint: event.target.value })} placeholder="本章不可逆的转折是什么？" /></label><label><span>结尾钩子</span><textarea value={chapter.chapterOutline?.endingHook || ""} onChange={(event) => updateChapterOutline(chapter.id, { endingHook: event.target.value })} placeholder="用新问题、代价或决定收束" /></label></div>
                <details className="quick-scene-editor"><summary>快速编辑简版场景列表</summary><label><span>每行一个场景；保存后会退出结构化场景卡模式</span><textarea value={(chapter.chapterOutline?.scenes || []).join("\n")} onChange={(event) => updateChapterOutline(chapter.id, { scenes: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean), sceneCards: undefined })} placeholder={"场景一：建立冲突\n场景二：人物作出选择\n场景三：选择产生后果"} /></label></details>
                {Boolean(chapter.chapterOutline?.foreshadowActions.length) && <div className="chapter-foreshadow-actions"><b>本章伏笔任务</b>{chapter.chapterOutline?.foreshadowActions.map((task, index) => <p key={task.title + "-" + index}><i>{task.action === "plant" ? "埋设" : task.action === "resolve" ? "回收" : "推进"}</i><strong>{task.title}</strong><span>{task.instruction}</span></p>)}</div>}
              </section>
            </section>}

            {chapterEditorTab === "场景卡" && <section className="chapter-tab-panel">{chapter.chapterOutline && <ChapterExecutionContractEditor outline={chapter.chapterOutline} onChange={(patch) => updateChapterOutline(chapter.id, patch)} />}</section>}

            {chapterEditorTab === "验收" && <section className="chapter-tab-panel"><ChapterAcceptance chapter={chapter} issues={workspace.issues} busy={aiBusy || rebuildingChapterId === chapter.id} onRebuild={() => void rebuildChapterMemoryAndAudit(chapter)} onDiff={() => setDiffChapterId(chapter.id)} /></section>}

            {chapterEditorTab === "版本" && <section className="chapter-tab-panel version-panel"><div className="version-panel-heading"><div><span>VERSION HISTORY</span><h3>章节版本</h3><p>在重要修改前手动存档，可以随时恢复正文。</p></div><button className="primary-button" onClick={() => saveVersion(chapter)}><Save size={15} />保存当前版本</button></div><div className="version-panel-list">{versions.length ? versions.map((item) => <article key={item.id}><History size={16} /><div><b>{item.note}</b><small>{dateLabel(item.createdAt)} · {number(countWords(item.content))} 字</small></div><button className="secondary-button compact" onClick={() => restoreVersion(item.id)}><RotateCcw size={14} />恢复</button></article>) : <Empty icon={<History />} title="还没有章节版本" text="点击保存当前版本，记录一个可恢复的正文快照。" />}</div></section>}
          </div>
          <footer className="editor-footer"><span><Cloud size={14} />已自动保存到此浏览器</span><span>{chapter.pov || "未指定视角"} · 目标 {number(chapter.targetWords)} 字 · 完成 {Math.min(100, Math.round(countWords(chapter.content) / Math.max(1, chapter.targetWords) * 100))}%</span></footer>
        </section> : <Empty icon={<FileText />} title="还没有章节" text="创建第一章，开始写下你的故事。" action={<button className="primary-button" onClick={addChapter}>创建章节</button>} />}
      </div>
    );
  };

  const renderConsistency = () => {
    const openIssues = workspace.issues.filter((item) => !item.resolved);
    const severity = (value: ConsistencyIssue["severity"]) => openIssues.filter((item) => item.severity === value).length;
    const openThreads = workspace.canon.threads.filter((item) => item.status === "open");
    const latestCharacterStates = [...workspace.canon.characterStates].sort((a, b) => b.chapterNumber - a.chapterNumber).slice(0, 4);
    const memoryChapters = [...workspace.chapters].filter((item) => item.content.trim()).sort((a, b) => a.number - b.number);
    return (
      <div className="view">
        <Heading eyebrow="CONTINUITY AUDIT" title="一致性检查" description="把疑点变成可处理的清单，区分真正冲突与有意伏笔。">
          <button className="secondary-button" disabled={aiBusy} onClick={runLocalCheck}><RefreshCw size={16} />规则扫描</button>
          <button className="secondary-button" disabled={aiBusy || !openIssues.some((item) => item.severity === "错误" && item.chapterNumber)} onClick={() => void repairAllConsistencyIssues()}>{repairQueueRunning ? <RefreshCw className="spin" size={16} /> : <WandSparkles size={16} />}{repairQueueRunning ? "修复队列运行中" : "修复全书错误"}</button>
          <button className="primary-button" disabled={aiBusy} onClick={() => void runChapterAudits()}>{aiBusy && auditProgress ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}{auditProgress || "逐章 AI 检查"}</button>
        </Heading>
        <div className="audit-metrics"><article><span className="error"><CircleAlert size={19} /></span><div><small>错误</small><strong>{severity("错误")}</strong></div></article><article><span className="warning"><CircleAlert size={19} /></span><div><small>警告</small><strong>{severity("警告")}</strong></div></article><article><span className="hint"><Lightbulb size={19} /></span><div><small>提示</small><strong>{severity("提示")}</strong></div></article><article><span className="resolved"><CheckCircle2 size={19} /></span><div><small>已处理</small><strong>{workspace.issues.filter((item) => item.resolved).length}</strong></div></article></div>
        <section className="canon-ledger card">
          <div className="card-heading"><div><span>STORY MEMORY</span><h2>全书事实账本</h2></div><small>版本 {workspace.canon.revision} · 已审校至第 {workspace.canon.lastAuditedChapter || 0} 章</small></div>
          <div className="canon-summary">
            <article><strong>{workspace.canon.chapterSummaries.length}</strong><small>章节记忆</small></article>
            <article><strong>{workspace.canon.timeline.length}</strong><small>时间线事件</small></article>
            <article><strong>{workspace.canon.facts.length}</strong><small>确定事实</small></article>
            <article><strong>{openThreads.length}</strong><small>未收束线索</small></article>
          </div>
          <div className="canon-columns">
            <div><h3>人物最新状态</h3>{latestCharacterStates.length ? latestCharacterStates.map((item, index) => <p key={`${item.name}-${item.chapterNumber}-${index}`}><b>{item.name}</b><span>{item.state}</span><small>第 {item.chapterNumber} 章</small></p>) : <em>完成章节后，AI 会在这里沉淀人物状态。</em>}</div>
            <div><h3>待回收线索</h3>{openThreads.length ? openThreads.slice(0, 4).map((item) => <p key={item.id}><b>{item.title}</b><span>尚未解决</span><small>始于第 {item.openedChapter} 章</small></p>) : <em>当前没有未收束线索。</em>}</div>
          </div>
        </section>
        <section className="memory-maintenance card">
          <div className="card-heading"><div><span>MEMORY MAINTENANCE</span><h2>章节记忆维护</h2></div><small>旧记忆重建后才会进入可信事实账本</small></div>
          <div className="memory-maintenance-list">{memoryChapters.length ? memoryChapters.map((item) => {
            const evidenceBacked = item.memory?.evidenceVersion === 1;
            const pendingIssues = openIssues.filter((issue) => issue.chapterNumber === item.number).length;
            return <article key={item.id} className={item.id === chapterId ? "is-current" : ""}><button className="memory-chapter-link" onClick={() => { setChapterId(item.id); setActive("章节"); }}><b>第 {item.number} 章 · {item.title}</b><small>{evidenceBacked ? "已有正文证据记忆" : item.memory ? "旧版记忆，建议重建" : "尚未建立记忆"}{pendingIssues ? ` · ${pendingIssues} 项待处理` : ""}</small></button><span className={evidenceBacked ? "memory-trust trusted" : "memory-trust pending"}>{evidenceBacked ? "已验证" : "待重建"}</span><button className="primary-button compact" disabled={aiBusy || rebuildingChapterId === item.id} onClick={() => void rebuildChapterMemoryAndAudit(item)}>{rebuildingChapterId === item.id ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}{rebuildingChapterId === item.id ? "正在重建并复审" : "一键重建本章记忆并复审"}</button></article>;
          }) : <Empty icon={<BrainCircuit />} title="还没有可重建的章节" text="章节有正文后，会在这里显示记忆重建入口。" />}</div>
        </section>
        <section className="audit-list card"><div className="card-heading"><div><span>审校结果</span><h2>待确认内容</h2></div><small>{openIssues.length} 项</small></div>{openIssues.length ? openIssues.map((item) => <article className="issue-row" key={item.id}><span className={`issue-icon severity-${item.severity}`}><CircleAlert size={17} /></span><div className="issue-content"><div><i className={`severity-label severity-${item.severity}`}>{item.severity}</i><i>{item.category}</i><small>{item.location}</small>{item.source && <i>{item.source === "ai" ? "AI 逐章检查" : "规则扫描"}</i>}{item.confidence && <i className={`confidence-${item.confidence}`}>{item.confidence === "high" ? "高置信" : item.confidence === "medium" ? "中置信" : "低置信·需人工"}</i>}</div><h3>{item.title}</h3><p>{item.description}</p>{item.evidence && <p className="issue-evidence"><b>正文证据：</b>{item.evidence}</p>}{item.suggestedFix && <p className="issue-suggestion"><b>修复建议：</b>{item.suggestedFix}</p>}</div><div className="issue-actions"><button className="primary-button compact" disabled={aiBusy || item.autoRepairable === false || item.confidence === "low" || !resolveIssueChapterNumber(item) || !workspace.chapters.some((entry) => entry.number === resolveIssueChapterNumber(item) && entry.content.trim())} title={!resolveIssueChapterNumber(item) ? "该问题涉及全书或多个章节，需要先定位到单章" : "自动保存旧稿、修订正文、重建记忆并再次检查"} onClick={() => repairConsistencyIssue(item)}>{repairingIssueId === item.id ? <RefreshCw className="spin" size={15} /> : <WandSparkles size={15} />}{repairingIssueId === item.id ? "正在修复" : resolveIssueChapterNumber(item) ? "AI 一键修复" : "需先定位章节"}</button><button className="secondary-button compact" disabled={aiBusy} onClick={() => setWorkspace((current) => ({ ...current, issues: current.issues.map((issue) => issue.id === item.id ? { ...issue, resolved: true } : issue) }))}><Check size={15} />标记已处理</button></div></article>) : <Empty icon={<ShieldCheck />} title="当前没有待处理问题" text="运行逐章 AI 检查后，会按章节给出正文证据和一键修复入口。" />}</section>
      </div>
    );
  };

  const renderMaterials = () => {
    const types: Array<Material["type"] | "全部"> = ["全部", "伏笔", "摘录", "研究", "场景", "对白"];
    const materials = materialFilter === "全部" ? workspace.materials : workspace.materials.filter((item) => item.type === materialFilter);
    return (
      <div className="view">
        <Heading eyebrow="REFERENCE LIBRARY" title="创作素材库" description="集中管理伏笔、研究、场景与对白，随时带入章节上下文。">
          <button className="primary-button" onClick={() => { const type = materialFilter === "全部" ? "摘录" : materialFilter; setWorkspace((current) => ({ ...current, materials: [{ id: id("material"), type, title: "新素材", content: "记录来源、用途或准备使用的章节。", tags: ["待整理"], createdAt: new Date().toISOString() }, ...current.materials] })); }}><Plus size={17} />添加素材</button>
        </Heading>
        <div className="filter-tabs">{types.map((item) => <button key={item} className={materialFilter === item ? "active" : ""} onClick={() => setMaterialFilter(item)}>{item}<span>{item === "全部" ? workspace.materials.length : workspace.materials.filter((entry) => entry.type === item).length}</span></button>)}</div>
        <div className="material-grid">{materials.map((material) => <article className="material-card card" key={material.id}><header><select value={material.type} onChange={(event) => setWorkspace((current) => ({ ...current, materials: current.materials.map((item) => item.id === material.id ? { ...item, type: event.target.value as Material["type"] } : item) }))}>{types.slice(1).map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => setWorkspace((current) => ({ ...current, materials: current.materials.filter((item) => item.id !== material.id) }))}><Trash2 size={15} /></button></header><input value={material.title} onChange={(event) => setWorkspace((current) => ({ ...current, materials: current.materials.map((item) => item.id === material.id ? { ...item, title: event.target.value } : item) }))} /><textarea value={material.content} onChange={(event) => setWorkspace((current) => ({ ...current, materials: current.materials.map((item) => item.id === material.id ? { ...item, content: event.target.value } : item) }))} />{material.type === "伏笔" && Boolean(material.foreshadowPlan?.length) && <div className="material-foreshadow-plan"><b>运用计划</b>{material.foreshadowPlan?.map((step, index) => { const update = workspace.chapters.find((entry) => entry.number === step.chapterNumber)?.memory?.foreshadowUpdates?.find((entry) => entry.title === material.title); return <p key={step.chapterNumber + "-" + index} className={update ? "done" : ""}><i>{step.action === "plant" ? "埋设" : step.action === "resolve" ? "回收" : "推进"}</i><span>第 {step.chapterNumber} 章 · {step.instruction}</span><small>{update ? "已在正文验证" : "待执行"}</small></p>; })}</div>}<div className="tag-row">{material.tags.map((tag) => <i key={tag}>{tag}</i>)}</div><footer>{dateLabel(material.createdAt)}</footer></article>)}</div>
        <section className="foreshadow-ledger card"><div className="card-heading"><div><span>FORESHADOW LEDGER</span><h2>独立伏笔账本</h2></div><small>计划、正文证据与延期状态</small></div><div className="foreshadow-ledger-list">{buildForeshadowLedger(workspace).map((entry) => <article key={entry.material.id} className={entry.status === "已延期" ? "is-late" : entry.status === "已回收" ? "is-resolved" : ""}><header><div><b>{entry.material.title}</b><small>{entry.material.content}</small></div><strong>{entry.status}</strong></header><div>{entry.plan.map((step, index) => { const evidence = entry.evidence.find((item) => item.chapterNumber === step.chapterNumber); return <p key={step.chapterNumber + "-" + index} className={evidence ? "done" : ""}><i>{step.action === "plant" ? "埋设" : step.action === "resolve" ? "回收" : "推进"}</i><span>第 {step.chapterNumber} 章 · {step.instruction}</span><small>{evidence?.evidence || "尚无正文证据"}</small></p>; })}</div></article>)}</div></section>
      </div>
    );
  };

  const renderView = () => {
    if (active === "创作台") return renderDashboard();
    if (active === "整书控制") return renderBookControl();
    if (active === "AI 全书") return <AutoNovelStudio workspace={workspace} config={config} setWorkspace={setWorkspace} aiBusy={aiBusy} setAiBusy={setAiBusy} notify={notify} onNeedConfig={() => { setSettingsTab("AI"); setSettingsOpen(true); }} onBackup={createBackup} onOpenChapter={(targetId) => { setChapterId(targetId); setActive("章节"); }} onDurableCheckpoint={persistDurableCheckpoint} durableProjectId={activeCloudProjectId || undefined} backgroundConfigured={backgroundConfiguration.apiKey && Boolean(backgroundConfiguration.model)} backgroundActive={backgroundActive} backgroundBusy={backgroundBusy} backgroundModel={backgroundConfiguration.model} onStartBackground={startBackgroundWriting} onPauseBackground={pauseBackgroundWriting} onCancelBackground={cancelBackgroundWriting} />;
    if (active === "灵感") return renderIdeas();
    if (active === "世界观") return renderWorld();
    if (active === "人物") return renderCharacters();
    if (active === "关系图") return renderRelationships();
    if (active === "大纲") return renderOutline();
    if (active === "章节") return renderChapters();
    if (active === "一致性") return renderConsistency();
    return renderMaterials();
  };

  const sidebarProgress = Math.min(100, Math.round(completed / Math.max(1, workspace.project.targetChapters) * 100));

  const renderNavItem = ({ label, icon: Icon }: (typeof navItems)[number]) => <button key={label} aria-current={active === label ? "page" : undefined} className={active === label ? "active" : ""} onClick={() => { setActive(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span>{label === "一致性" && <em className={unresolved ? "has-count" : ""}>{unresolved}</em>}{label === "章节" && <em>{workspace.chapters.length}</em>}</button>;

  return (
    <main className="app-shell midnight-theme">
      <aside className="command-rail" aria-label="快捷导航">
        <div className="command-logo"><Zap size={19} /></div>
        <button aria-label="创作台" className={active === "创作台" ? "active" : ""} onClick={() => setActive("创作台")}><LayoutDashboard size={18} /></button>
        <button aria-label="章节写作" className={active === "章节" ? "active" : ""} onClick={() => setActive("章节")}><PenLine size={18} /></button>
        <button aria-label="故事大纲" className={active === "大纲" ? "active" : ""} onClick={() => setActive("大纲")}><ListTree size={18} /></button>
        <button aria-label="人物设定" className={active === "人物" ? "active" : ""} onClick={() => setActive("人物")}><UsersRound size={18} /></button>
        <button aria-label="整书控制" className={active === "整书控制" ? "active" : ""} onClick={() => setActive("整书控制")}><Target size={18} /></button>
        <button aria-label="一致性检查" className={active === "一致性" ? "active" : ""} onClick={() => setActive("一致性")}><ShieldCheck size={18} /></button>
        <span />
        <button aria-label="设置" onClick={() => { setSettingsTab("AI"); setSettingsOpen(true); }}><Settings2 size={18} /></button>
      </aside>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><span><small>ACTIVE PROJECT</small><b>{workspace.project.title}</b><em><i />{workspace.project.status}</em></span><button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
        <button className="project-switcher" onClick={openProjectLibrary}><span className="sidebar-progress-ring" style={{ "--sidebar-progress": `${sidebarProgress * 3.6}deg` } as CSSProperties}><b>{sidebarProgress}</b><small>%</small></span><span><strong>全书进度</strong><small>{number(totalWords)} / {number(workspace.project.targetWords)} 字</small></span><ChevronDown size={15} /></button>
        <nav className="main-nav" aria-label="工作台导航"><span className="nav-group-label">创作</span>{creationNavItems.map(renderNavItem)}<span className="nav-group-label">全书管理</span>{controlNavItems.map(renderNavItem)}<span className="nav-group-label">故事资产</span>{assetNavItems.map(renderNavItem)}</nav>
        <button className="sidebar-tip" onClick={() => { setSettingsTab("AI"); setSettingsOpen(true); }}><BrainCircuit size={16} /><span><b>{aiConfigured ? "AI ENGINE ONLINE" : "连接 AI ENGINE"}</b><small>{aiConfigured ? config.model : "配置兼容接口与模型"}</small></span><ChevronRight size={14} /></button>
        <div className="sidebar-footer"><button onClick={() => { setSettingsTab("AI"); setSettingsOpen(true); }}><Settings2 size={18} />系统设置</button><button onClick={() => notify("先完善人物、世界与大纲，再让 AI 生成章节，效果更稳定。")}><HelpCircle size={18} />写作提示</button></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} />}

      <section className="workspace-shell">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="crumb"><span>{workspace.project.title}</span><ChevronRight size={14} /><b>{active}</b></div><span className="autosave"><i />本地自动保存</span></div>
          <div className="topbar-actions">
            <div className="search-wrap"><label className="search-box"><Search size={17} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索章节、人物或设定…" /><kbd>Ctrl K</kbd></label>{search && <div className="search-results">{searchResults.length ? searchResults.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => openSearchResult(item)}><span>{item.type}</span><div><strong>{item.title}</strong><small>{item.detail || "无摘要"}</small></div><ChevronRight size={15} /></button>) : <p>没有找到“{search}”</p>}</div>}</div>
            <div className="export-wrap"><button className="secondary-button export-button" onClick={() => setExportOpen((value) => !value)}><Download size={16} />导出<ChevronDown size={14} /></button>{exportOpen && <div className="export-menu"><button onClick={() => exportFile("md")}><FilePenLine size={16} /><span><b>Markdown</b><small>适合继续编辑</small></span></button><button onClick={() => exportFile("txt")}><FileText size={16} /><span><b>纯文本</b><small>仅章节正文</small></span></button><button onClick={() => exportFile("json")}><FileJson size={16} /><span><b>完整备份</b><small>可再次导入</small></span></button></div>}</div>
            <button className="icon-button notification" aria-label="查看一致性提醒" onClick={() => notify(unresolved ? `有 ${unresolved} 项内容待确认` : "暂无待处理问题")}><Bell size={18} />{unresolved > 0 && <span>{unresolved}</span>}</button><button className="avatar" aria-label="打开作品设置" onClick={() => { setSettingsTab("作品"); setSettingsOpen(true); }}>写</button>
          </div>
        </header>
        <div className="content-grid">
          <section className="main-content">{renderView()}</section>
          <aside className={`assistant-panel ${assistantOpen ? "assistant-open" : ""}`}>
            <div className="assistant-heading"><div><span className="assistant-icon"><Bot size={17} /></span><h2>创作助手</h2></div><span className={`connection-dot ${aiConfigured ? "connected" : ""}`}><i />{aiConfigured ? "已连接" : "未配置"}</span><button className="icon-button assistant-close" aria-label="关闭创作助手" onClick={() => setAssistantOpen(false)}><X size={17} /></button></div>
            <div className="assistant-body"><div className="assistant-context"><span>当前写作上下文</span><strong>第 {chapter?.number || "—"} 章 · {chapter?.title || "未选择章节"}</strong><p>{chapter?.summary || "选择章节后，助手会带入相关人物、设定和大纲。"}</p></div><div className="quick-task-grid"><button disabled={aiBusy || !chapter?.content} onClick={() => runAI("续写本章", "自然承接正文结尾。", chapter?.id)}><PenLine size={17} /><span>续写本章</span></button><button disabled={aiBusy || !chapter?.content} onClick={() => runAI("润色改写", "保持情节不变，优化表达。", chapter?.id)}><WandSparkles size={17} /><span>润色改写</span></button><button disabled={aiBusy} onClick={() => runAI("情节推进", "设计三个不同代价的推进方案。", chapter?.id)}><ListTree size={17} /><span>情节推进</span></button></div>{aiResult && <button className="latest-result" onClick={() => setResultOpen(true)}><span><Sparkles size={16} /></span><div><b>最近结果 · {aiResult.task}</b><p>{aiResult.text.slice(0, 88)}{aiResult.text.length > 88 ? "…" : ""}</p></div><ChevronRight size={16} /></button>}<div className="assistant-composer"><textarea aria-label={"\u521b\u4f5c\u52a9\u624b\u8f93\u5165"} value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="询问剧情、人物，或描述你想写的内容…" /><div><span><button aria-label={"\u6dfb\u52a0\u5199\u4f5c\u7d20\u6750"} onClick={() => notify("可将资料保存到素材库后带入上下文")}><Paperclip size={16} /></button><button aria-label={"\u67e5\u770b\u5df2\u5e26\u5165\u4e0a\u4e0b\u6587"} onClick={() => notify("助手已读取人物、世界、大纲和伏笔")}><AtSign size={16} /></button></span><button className="send-button" aria-label={"\u53d1\u9001\u7ed9\u521b\u4f5c\u52a9\u624b"} disabled={aiBusy} onClick={() => assistantInput.trim() ? runAI("自由对话", assistantInput, chapter?.id) : notify("请先输入问题")}>{aiBusy ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}</button></div></div><button className="model-selector" onClick={() => { setSettingsTab("AI"); setSettingsOpen(true); }}><BrainCircuit size={16} /><span>模型</span><strong>{aiConfigured ? config.model : "尚未配置"}</strong><ChevronRight size={14} /></button><div className="context-section"><div className="context-title"><span>已带入上下文</span><Cloud size={14} /></div><div className="context-list"><div><i /><span>世界观</span><em>{workspace.world.length} 条</em></div><div><i /><span>人物卡</span><em>{workspace.characters.length} 人</em></div><div><i /><span>故事大纲</span><em>{workspace.outline.length} 节点</em></div><div><i /><span>伏笔与问题</span><em>{workspace.materials.filter((item) => item.type === "伏笔").length + unresolved} 条</em></div></div></div><div className="privacy-note"><KeyRound size={14} /><span>API Key 默认只保留到当前浏览器会话结束。</span></div></div>
          </aside>
        </div>
      </section>

      <button className="assistant-fab" aria-label="打开创作助手" onClick={() => setAssistantOpen(true)}><Bot size={21} /></button>
      <nav className="mobile-bottom-nav" aria-label="手机快捷导航"><button className={active === "创作台" ? "active" : ""} onClick={() => setActive("创作台")}><LayoutDashboard size={19} /><span>创作台</span></button><button className={active === "章节" ? "active" : ""} onClick={() => setActive("章节")}><FileText size={19} /><span>章节</span></button><button className="mobile-write" aria-label="AI 全书创作" onClick={() => setActive("AI 全书")}><Sparkles size={21} /></button><button onClick={() => setAssistantOpen(true)}><Bot size={19} /><span>助手</span></button><button onClick={() => setMobileNav(true)}><Menu size={19} /><span>更多</span></button></nav>

      {projectLibraryOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setProjectLibraryOpen(false); }}><section className="project-library-modal" role="dialog" aria-modal="true" aria-label="作品库"><header><div><LibraryBig size={19} /><span><b>我的作品库</b><small>本地编辑、云端保存与任务恢复</small></span></div><button className="icon-button" aria-label="关闭作品库" onClick={() => setProjectLibraryOpen(false)}><X size={18} /></button></header><div className="project-library-actions"><button className="primary-button" onClick={createNewProject}><Plus size={16} />新建作品</button><button className="secondary-button" disabled={cloudBusy} onClick={() => void saveCloudProject(workspace)}><Cloud size={16} />保存当前作品</button><button className="secondary-button" disabled={cloudBusy} onClick={() => void saveCloudProject(workspace, true)}><Copy size={16} />复制为新作品</button><button className="icon-button" aria-label="刷新云端作品" disabled={cloudBusy} onClick={() => void loadCloudProjects()}><RefreshCw className={cloudBusy ? "spin" : ""} size={16} /></button></div>{cloudError && <div className="project-cloud-error"><CircleAlert size={16} />{cloudError}</div>}<div className="project-library-current"><span><BookOpen size={18} /></span><div><small>当前浏览器作品</small><b>《{workspace.project.title}》</b><p>{workspace.project.genre} · {workspace.chapters.length} 章 · {activeCloudProjectId ? "已关联云端" : "仅保存在本机"}</p></div></div><div className="project-library-list"><div className="section-bar"><div><h2>云端作品</h2><span>{cloudProjects.length} 部</span></div><small>{cloudBusy ? "正在同步…" : "按最近更新排序"}</small></div>{cloudProjects.length ? cloudProjects.map((project) => <article key={project.id} className={activeCloudProjectId === project.id ? "active" : ""}><button className="project-open-button" onClick={() => void openCloudProject(project.id)}><span><BookOpen size={17} /></span><div><b>《{project.title}》</b><small>{project.genre || "题材待定"} · {project.status} · {dateLabel(project.updatedAt)}</small></div>{activeCloudProjectId === project.id ? <i>当前</i> : <ChevronRight size={16} />}</button><button className="icon-button project-delete-button" aria-label={`删除《${project.title}》`} onClick={() => void removeCloudProject(project)}><Trash2 size={15} /></button></article>) : <Empty icon={<Cloud />} title="还没有云端作品" text="保存当前作品后，可跨设备恢复并持久保存自动写作检查点。" />}</div></section></div>}

      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-label="工作台设置"><header><div><Settings2 size={19} /><span><b>工作台设置</b><small>AI、作品与本地数据</small></span></div><button className="icon-button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={18} /></button></header><div className="settings-layout"><nav><button className={settingsTab === "AI" ? "active" : ""} onClick={() => setSettingsTab("AI")}><BrainCircuit size={17} />AI 模型</button><button className={settingsTab === "作品" ? "active" : ""} onClick={() => setSettingsTab("作品")}><BookOpen size={17} />作品信息</button><button className={settingsTab === "数据" ? "active" : ""} onClick={() => setSettingsTab("数据")}><Archive size={17} />数据管理</button></nav><div className="settings-content">
        {settingsTab === "AI" && <><div className="settings-title"><h2>连接 OpenAI 兼容模型</h2><p>支持 HTTP/HTTPS、Chat Completions 与 Responses；密钥不会写入项目源码。</p></div><div className="form-grid"><label><span>接口地址</span><input value={config.baseUrl} onChange={(event) => setConfig((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="http://127.0.0.1:11434/v1" /><small>可填写 /v1、/chat/completions 或 /responses；本地地址需本地运行本站</small></label><label><span>接口模式</span><select value={config.apiMode} onChange={(event) => setConfig((current) => ({ ...current, apiMode: event.target.value as AIConfig["apiMode"] }))}><option value="auto">自动识别（推荐）</option><option value="chat">Chat Completions</option><option value="responses">Responses API</option></select><small>自动模式遇到 Chat 404 时会改用 Responses</small></label><label><span>API Key（可选）</span><input type="password" value={config.apiKey} onChange={(event) => setConfig((current) => ({ ...current, apiKey: event.target.value }))} autoComplete="off" /><small>Ollama 等无鉴权接口可以留空</small></label><label><span>模型名称</span><input value={config.model} onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))} /></label><section className="stage-model-settings"><div className="stage-model-heading"><span><b>分阶段模型与生成参数</b><small>模型和 Token 留空时继承默认值；温度、推理强度、详细度可以按任务分别控制。</small></span><button type="button" className="secondary-button" onClick={() => setWorkspace((current) => ({ ...current, automation: { ...current.automation, stageModels: Object.fromEntries(stageModelOptions.map(([stage]) => [stage, { ...current.automation.stageModels?.[stage], ...GPT55_STAGE_PRESETS[stage] }])) } }))}>应用 GPT-5.5 推荐值</button></div><div className="stage-model-grid">{stageModelOptions.map(([stage, label]) => { const stageConfig = workspace.automation.stageModels?.[stage]; const updateStage = (patch: Partial<NonNullable<typeof stageConfig>>) => setWorkspace((current) => ({ ...current, automation: { ...current.automation, stageModels: { ...current.automation.stageModels, [stage]: { ...current.automation.stageModels?.[stage], ...patch } } } })); return <article className="stage-model-row" key={stage}><strong>{label}</strong><label><small>模型</small><input value={stageConfig?.model || ""} placeholder={config.model || "使用默认模型"} onChange={(event) => updateStage({ model: event.target.value })} /></label><label><small>输出 Token</small><input type="number" min={256} max={MAX_STAGE_OUTPUT_TOKENS} value={stageConfig?.maxOutputTokens || ""} placeholder="继承默认" onChange={(event) => updateStage({ maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })} /></label><label><small>温度</small><input type="number" min={0} max={2} step={0.1} value={stageConfig?.temperature ?? ""} placeholder={config.temperature.toFixed(1)} onChange={(event) => updateStage({ temperature: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label><small>推理强度</small><select value={stageConfig?.reasoningEffort || ""} onChange={(event) => updateStage({ reasoningEffort: event.target.value ? event.target.value as NonNullable<typeof stageConfig>["reasoningEffort"] : undefined })}><option value="">模型默认</option><option value="none">不推理</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">超高</option></select></label><label><small>输出详细度</small><select value={stageConfig?.verbosity || ""} onChange={(event) => updateStage({ verbosity: event.target.value ? event.target.value as NonNullable<typeof stageConfig>["verbosity"] : undefined })}><option value="">模型默认</option><option value="low">简洁</option><option value="medium">适中</option><option value="high">详细</option></select></label></article>; })}</div></section><label><span>默认温度（阶段未单独设置时） · {config.temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => setConfig((current) => ({ ...current, temperature: Number(event.target.value) }))} /></label><label className="check-label"><input type="checkbox" checked={config.rememberKey} onChange={(event) => setConfig((current) => ({ ...current, rememberKey: event.target.checked }))} /><span><b>在此浏览器中记住密钥</b><small>关闭时，仅保留到本次会话结束。</small></span></label></div><div className="settings-callout"><ShieldCheck size={17} /><span>Responses 请求只发送合法的文本输入，不会把 output_text 作为输入类型；公网 HTTP 建议改用 HTTPS。</span></div><button className="secondary-button" disabled={aiBusy || !config.baseUrl || !config.model} onClick={() => runAI("自由对话", "只回复：连接成功。")}><Zap size={16} />测试连接</button></>}
        {settingsTab === "作品" && <>
          <div className="settings-title"><h2>作品信息</h2><p>基础信息与整书契约会作为全局约束带入每一次 AI 创作。</p></div>
          <div className="form-grid two-col">
            <label><span>书名</span><input value={workspace.project.title} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, title: event.target.value } }))} /></label>
            <label><span>题材</span><input value={workspace.project.genre} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, genre: event.target.value } }))} /></label>
            <label className="full"><span>一句话梗概</span><textarea value={workspace.project.premise} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, premise: event.target.value } }))} /></label>
            <label className="full"><span>主题表达</span><textarea value={workspace.project.theme} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, theme: event.target.value } }))} /></label>
            <label><span>目标字数</span><input type="number" value={workspace.project.targetWords} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, targetWords: Number(event.target.value) } }))} /></label>
            <label><span>目标章节</span><input type="number" value={workspace.project.targetChapters} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, targetChapters: Number(event.target.value) } }))} /></label>
            <label className="full"><span>叙事视角</span><input value={workspace.project.pointOfView} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, pointOfView: event.target.value } }))} /></label>
            <label className="full"><span>文风约束</span><textarea value={workspace.project.writingStyle} onChange={(event) => setWorkspace((current) => ({ ...current, project: { ...current.project, writingStyle: event.target.value } }))} /></label>
          </div>
          <div className="settings-book-link"><Target size={20} /><div><b>整书创作契约已移至独立工作区</b><small>核心卖点、读者承诺、兑现节点与创作红线请在“整书控制”中维护。</small></div><button type="button" className="secondary-button" onClick={() => { setSettingsOpen(false); setActive("整书控制"); }}>打开整书控制</button></div>
        </>}
        {settingsTab === "数据" && <>
          <div className="settings-title"><h2>本地数据管理</h2><p>导出完整备份后，可以在另一台设备恢复。</p></div>
          <div className="data-actions">
            <button onClick={() => exportFile("json")}><span><ArrowDownToLine size={20} /></span><div><b>导出完整备份</b><small>包含自动创作进度、章节、素材与版本，不包含 API Key</small></div><ChevronRight size={16} /></button>
            <button onClick={() => importRef.current?.click()}><span><ArrowUpFromLine size={20} /></span><div><b>导入 JSON 备份</b><small>导入前会自动备份当前作品</small></div><ChevronRight size={16} /></button>
            <button className="danger" onClick={() => { if (!window.confirm("确定恢复演示作品吗？当前作品会先自动备份。")) return; createBackup(workspace, "恢复演示作品前自动备份"); const demo = cloneWorkspace(DEMO_WORKSPACE); setWorkspace(demo); setChapterId("chapter-12"); setCharacterId("char-1"); setSettingsOpen(false); }}><span><RotateCcw size={20} /></span><div><b>恢复演示作品</b><small>重新载入《雾港来信》，当前作品可从自动备份恢复</small></div><ChevronRight size={16} /></button>
          </div>
          {backups.length > 0 && <div className="backup-section"><div><b>最近自动备份</b><small>最多保留 5 份</small></div>{backups.map((backup) => <button key={backup.id} onClick={() => restoreBackup(backup)}><span><History size={16} /></span><div><b>{backup.label}</b><small>{backup.workspace.project.title} · {dateLabel(backup.createdAt)}</small></div><RotateCcw size={15} /></button>)}</div>}
        </>}
        </div></div><footer><span><Cloud size={14} />设置已自动保存</span><button className="primary-button" onClick={() => setSettingsOpen(false)}>完成</button></footer></section></div>}

      {diffChapterId && (() => { const target = workspace.chapters.find((item) => item.id === diffChapterId); const before = target?.repairReview ? workspace.versions.find((item) => item.id === target.repairReview?.beforeVersionId) : undefined; if (!target || !before) return null; return <div className="modal-backdrop"><section className="repair-diff-modal" role="dialog" aria-modal="true" aria-label="修复前后差异"><header><div><b>第 {target.number} 章修复前后对比</b><small>{target.repairReview?.changeSummary}</small></div><button className="icon-button" onClick={() => setDiffChapterId("")}><X size={18} /></button></header>{target.repairReview?.edits?.length ? <section className="repair-edit-list"><h3>本次实际修改（{target.repairReview.edits.length} 处）</h3>{target.repairReview.edits.map((edit, index) => <article key={`${index}-${edit.oldText.slice(0, 20)}`}><b>{index + 1}. {edit.reason || "本次实际修改"}</b><div><p><span>修改前</span>{edit.oldText}</p><p><span>修改后</span>{edit.newText}</p></div></article>)}</section> : <p className="repair-edit-legacy">该记录来自旧版修复，没有保存逐条补丁详情。</p>}<div className="repair-diff-columns"><article><h3>修复前</h3><pre>{before.content}</pre></article><article><h3>修复后</h3><pre>{target.content}</pre></article></div><footer><button className="secondary-button" onClick={() => { setWorkspace((current) => ({ ...current, chapters: current.chapters.map((item) => item.id === target.id ? { ...item, content: before.content, status: "修订中", repairReview: item.repairReview ? { ...item.repairReview, status: "reverted" } : item.repairReview } : item) })); setDiffChapterId(""); notify("已恢复修复前正文"); }}><RotateCcw size={15} />恢复原稿</button><button className="primary-button" onClick={() => { setWorkspace((current) => ({ ...current, chapters: current.chapters.map((item) => item.id === target.id && item.repairReview ? { ...item, repairReview: { ...item.repairReview, status: "accepted" } } : item) })); setDiffChapterId(""); notify("已接受本次修复"); }}><Check size={15} />接受修复</button></footer></section></div>; })()}

      <input ref={importRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={importFile} />
      {aiResult && resultOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setResultOpen(false); }}><section className="ai-result-modal" role="dialog" aria-modal="true" aria-label="AI 生成结果"><header><div><span><Sparkles size={18} /></span><div><b>AI 生成结果</b><small>{aiResult.task} · 应用前请先审阅</small></div></div><button className="icon-button" aria-label="关闭 AI 结果" onClick={() => setResultOpen(false)}><X size={18} /></button></header><article>{aiResult.text}</article><footer><button className="secondary-button" onClick={async () => { await navigator.clipboard.writeText(aiResult.text); notify("已复制结果"); }}><Copy size={16} />复制</button><button className="secondary-button" onClick={saveResultAsMaterial}><LibraryBig size={16} />存入素材库</button><span />{aiResult.chapterId && <><button className="secondary-button" onClick={() => applyResult("replace")}><RefreshCw size={16} />替换正文</button><button className="primary-button" onClick={() => applyResult("insert")}><ArrowDownToLine size={16} />插入正文末尾</button></>}</footer></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={16} />{toast}</div>}
    </main>
  );
}
