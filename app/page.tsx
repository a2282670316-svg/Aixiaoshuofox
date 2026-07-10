"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Cloud,
  FileText,
  Globe2,
  HelpCircle,
  LibraryBig,
  ListTree,
  Menu,
  MoreHorizontal,
  Network,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";

const navItems = [
  { label: "创作台", icon: PenLine },
  { label: "灵感", icon: Sparkles },
  { label: "世界观", icon: Globe2 },
  { label: "人物", icon: UsersRound },
  { label: "关系图", icon: Network },
  { label: "大纲", icon: ListTree },
  { label: "章节", icon: FileText },
  { label: "一致性", icon: ShieldCheck },
  { label: "素材库", icon: LibraryBig },
];

const chapters = [
  { number: 11, title: "暗潮依旧", words: "10,532", status: "已完成", time: "今天 10:18" },
  { number: 12, title: "雾中的灯塔", words: "12,846", status: "草稿", time: "今天 10:24", current: true },
  { number: 13, title: "无名来信", words: "8,214", status: "草稿", time: "昨天 22:47" },
  { number: 14, title: "旧码头", words: "0", status: "待生成", time: "—" },
  { number: 15, title: "消失的船票", words: "0", status: "待生成", time: "—" },
  { number: 16, title: "风声鹤唳", words: "0", status: "待生成", time: "—" },
];

const contextItems = [
  ["世界观", "已加载"],
  ["人物卡", "12 个角色"],
  ["章节记忆", "12 章"],
  ["伏笔追踪", "8 条"],
  ["一致性检查", "无冲突"],
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <BookOpen size={19} strokeWidth={2.3} />
    </span>
  );
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("创作台");
  const [assistantInput, setAssistantInput] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");

  const wordPercent = useMemo(() => 36, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <BrandMark />
          <span>万象小说工坊</span>
          <button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="关闭导航">
            <X size={19} />
          </button>
        </div>

        <button className="project-switcher" onClick={() => notify("项目管理将在完整工作台中展开")}> 
          <span>
            <strong>雾港来信</strong>
            <small>悬疑 · 都市 · 连载中</small>
          </span>
          <ChevronDown size={16} />
        </button>

        <nav className="main-nav" aria-label="主要功能">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={activeNav === label ? "active" : ""}
              onClick={() => {
                setActiveNav(label);
                setMobileNavOpen(false);
                if (label !== "创作台") notify(`${label}模块将在下一阶段完成`);
              }}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "一致性" && <em>0</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={() => notify("打开 AI 与写作偏好设置")}><Settings2 size={19} />设置</button>
          <button onClick={() => notify("帮助中心即将开放")}><HelpCircle size={19} />帮助</button>
        </div>
      </aside>

      {mobileNavOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="打开导航">
              <Menu size={21} />
            </button>
            <div className="crumb">
              <span>雾港来信</span>
              <ChevronRight size={15} />
            </div>
            <span className="autosave"><i />自动保存</span>
            <span className="save-time">刚刚</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={18} />
              <input placeholder="搜索内容或输入命令…" aria-label="全局搜索" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button notification" aria-label="通知" onClick={() => notify("暂无新通知")}>
              <Bell size={19} />
              <span>3</span>
            </button>
            <button className="avatar" aria-label="个人账户">写</button>
          </div>
        </header>

        <div className="content-grid">
          <section className="dashboard">
            <div className="page-heading">
              <div>
                <span className="eyebrow">NOVEL WORKSPACE</span>
                <h1>创作台</h1>
                <p>在这里规划、创作并完善你的小说世界。</p>
              </div>
              <button className="primary-button" onClick={() => notify("已定位到《雾中的灯塔》编辑器")}> 
                <PenLine size={18} />开始写作
              </button>
            </div>

            <section className="card progress-card">
              <div className="section-title-row">
                <div>
                  <span className="section-kicker">本书进度</span>
                  <h2>小说进度</h2>
                </div>
                <button className="select-button">本周<ChevronDown size={15} /></button>
              </div>
              <div className="progress-track"><span style={{ width: "25%" }} /></div>
              <div className="metrics">
                <div><strong>12 / 48</strong><span>已完成章节</span></div>
                <div><strong>8.6 万字</strong><span>当前总字数</span></div>
                <div><strong className="positive">+12,480</strong><span>本周新增字数</span></div>
                <div className="spark-chart" aria-label="近七日写作趋势">
                  <svg viewBox="0 0 160 54" role="img">
                    <path className="spark-fill" d="M4 48 L28 27 L50 30 L78 8 L96 24 L121 20 L156 5 L156 52 L4 52 Z" />
                    <path className="spark-line" d="M4 48 L28 27 L50 30 L78 8 L96 24 L121 20 L156 5" />
                    <circle cx="156" cy="5" r="4" />
                  </svg>
                  <span><TrendingUp size={13} />较上周 18%</span>
                </div>
              </div>
            </section>

            <section className="card chapters-card">
              <div className="section-title-row chapter-heading-row">
                <div>
                  <span className="section-kicker">最近创作</span>
                  <h2>章节列表</h2>
                </div>
                <div className="row-actions">
                  <button className="secondary-button" onClick={() => notify("已创建空白章节")}> <Plus size={16} />新建章节</button>
                  <button className="icon-button border-button" aria-label="更多章节操作"><MoreHorizontal size={19} /></button>
                </div>
              </div>
              <div className="chapter-table" role="table" aria-label="章节列表">
                <div className="chapter-row chapter-table-head" role="row">
                  <span>章节</span><span>字数</span><span>状态</span><span>最后更新</span><span />
                </div>
                {chapters.map((chapter) => (
                  <button
                    className={`chapter-row ${chapter.current ? "current" : ""}`}
                    key={chapter.number}
                    onClick={() => notify(`已选择第${chapter.number}章《${chapter.title}》`)}
                  >
                    <span className="chapter-title"><FileText size={18} /><b>第{chapter.number}章</b>{chapter.title}</span>
                    <span className="chapter-words">{chapter.words}</span>
                    <span><i className={`status status-${chapter.status}`}>{chapter.status}</i></span>
                    <span className="chapter-time">{chapter.time}</span>
                    <span><MoreHorizontal size={17} /></span>
                  </button>
                ))}
              </div>
              <button className="view-all" onClick={() => notify("打开全部章节")}>查看全部 48 章<ChevronRight size={15} /></button>
            </section>
          </section>

          <aside className="assistant-panel">
            <div className="assistant-heading">
              <div><span className="assistant-icon"><Bot size={18} /></span><h2>创作助手</h2></div>
              <button className="icon-button" aria-label="助手设置"><Settings2 size={18} /></button>
            </div>

            <div className="assistant-body">
              <div className="assistant-message">
                <span>你正在创作</span>
                <strong>《第十二章 · 雾中的灯塔》</strong>
                <p>我已读取当前章节、人物与世界观。需要我帮你做什么？</p>
              </div>

              <button className="suggestion-card" onClick={() => notify("建议已加入创作对话")}> 
                <span className="suggestion-icon"><Sparkles size={17} /></span>
                <span><strong>情节推进建议</strong><small>强化灯塔的象征意义，并引入新的线索来源。</small></span>
                <ChevronRight size={17} />
              </button>

              <div className="quick-actions">
                <button onClick={() => notify("续写指令已准备")}><PenLine size={18} /><span>续写本章</span></button>
                <button onClick={() => notify("大纲指令已准备")}><ListTree size={18} /><span>生成大纲</span></button>
                <button onClick={() => notify("润色指令已准备")}><WandSparkles size={18} /><span>润色改写</span></button>
              </div>

              <button className="model-selector" onClick={() => notify("可在设置中连接任意 OpenAI 兼容模型")}> 
                <Bot size={16} /><span>模型</span><strong>尚未配置</strong><ChevronDown size={15} />
              </button>

              <div className="assistant-composer">
                <textarea
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  placeholder="输入你的想法或问题…"
                  aria-label="向创作助手提问"
                />
                <div>
                  <span><button aria-label="添加附件"><Paperclip size={17} /></button><button aria-label="提及素材"><AtSign size={17} /></button></span>
                  <button
                    className="send-button"
                    aria-label="发送"
                    onClick={() => {
                      if (!assistantInput.trim()) return notify("请先输入想法或问题");
                      setAssistantInput("");
                      notify("请先在设置中配置 AI 接口");
                    }}
                  ><Send size={17} /></button>
                </div>
              </div>

              <div className="context-section">
                <div className="context-title"><span>上下文状态</span><button onClick={() => notify("上下文已刷新")}><Cloud size={14} />刷新</button></div>
                <div className="context-list">
                  {contextItems.map(([name, value]) => (
                    <button key={name} onClick={() => notify(`查看${name}详情`)}>
                      <i /><span>{name}</span><em>{value}</em><ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="usage-card">
                <div><strong>上下文使用量</strong><span>{wordPercent}%</span></div>
                <div className="usage-track"><span style={{ width: `${wordPercent}%` }} /></div>
                <p>5,760 / 16,000 tokens</p>
              </div>

              <div className="assistant-note"><CircleCheck size={15} />本地草稿已自动保存</div>
            </div>
          </aside>
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label="移动端快捷导航">
        <button className="active"><PenLine size={19} /><span>创作台</span></button>
        <button onClick={() => notify("打开章节")}><FileText size={19} /><span>章节</span></button>
        <button className="mobile-write" onClick={() => notify("开始写作")}><Plus size={21} /></button>
        <button onClick={() => notify("打开助手")}><Bot size={19} /><span>助手</span></button>
        <button onClick={() => setMobileNavOpen(true)}><Menu size={19} /><span>更多</span></button>
      </nav>

      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </main>
  );
}
