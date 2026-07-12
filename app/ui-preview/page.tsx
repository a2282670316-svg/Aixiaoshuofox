"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity, BookOpen, Bot, CheckCircle2, ChevronRight, Circle,
  Clock3, Command, FileText, Flame, Globe2, LayoutDashboard,
  ListTree, Menu, MoreHorizontal, PenLine, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Target, UsersRound, WandSparkles, Zap,
} from "lucide-react";
import "./ui-preview.css";

type Concept = "editorial" | "midnight" | "aurora";

const concepts: Array<{id: Concept; code: string; name: string; note: string}> = [
  { id: "editorial", code: "A", name: "纸墨编辑部", note: "温暖沉浸 · 内容优先" },
  { id: "midnight", code: "B", name: "夜航控制台", note: "专业高效 · 状态优先" },
  { id: "aurora", code: "C", name: "极光创作舱", note: "现代灵动 · AI 优先" },
];

const chapters = [
  ["01", "雨夜来客", "已完成", "3,286"],
  ["02", "旧城暗线", "已完成", "3,142"],
  ["03", "没有名字的信", "写作中", "1,864"],
  ["04", "塔楼之下", "待生成", "—"],
  ["05", "逆光的人", "待生成", "—"],
];

function Editorial() {
  return <div className="concept concept-editorial">
    <aside className="ed-side">
      <div className="ed-brand"><span>万</span><div><b>万象小说工坊</b><small>STORY ATELIER</small></div></div>
      <button className="ed-project"><i>雾</i><span><b>雾港来信</b><small>悬疑 · 12.6 万字</small></span><ChevronRight size={15}/></button>
      <nav>
        <p>创作空间</p>
        <button><LayoutDashboard/>创作台</button><button><Sparkles/>灵感</button><button><Globe2/>世界观</button>
        <button><UsersRound/>人物</button><button><ListTree/>故事大纲</button>
        <p>作品管理</p>
        <button className="active"><FileText/>章节写作 <em>24</em></button><button><ShieldCheck/>一致性检查</button>
      </nav>
      <div className="ed-progress"><div><span>本周创作</span><b>68%</b></div><i><u/></i><small>已写 18,420 / 27,000 字</small></div>
      <button className="ed-settings"><Settings2/>偏好设置</button>
    </aside>
    <main className="ed-main">
      <header className="ed-top"><div><button><Menu/></button><span>雾港来信</span><ChevronRight/><b>第三章 · 没有名字的信</b></div><div><span className="saved"><i/>已自动保存</span><button className="quiet"><Search/></button><button className="primary"><WandSparkles/>AI 续写</button></div></header>
      <section className="ed-workspace">
        <aside className="ed-chapters"><header><div><small>CHAPTERS</small><b>章节目录</b></div><button><Plus/></button></header>{chapters.map((c, i)=><button className={i===2?"current":""} key={c[0]}><strong>{c[0]}</strong><span><b>{c[1]}</b><small>{c[2]} · {c[3]} 字</small></span></button>)}</aside>
        <article className="ed-paper">
          <div className="paper-meta"><span>第三章</span><i/><span>初稿</span><button><MoreHorizontal/></button></div>
          <h1>没有名字的信</h1><p className="lead">雨停在凌晨三点十七分。</p>
          <p>林雾推开阁楼的窗，潮湿的风裹着港口的咸味涌进来。远处，旧灯塔的光束缓慢扫过沉睡的屋脊，像某种迟到多年的讯号。</p>
          <p>那封信就躺在门缝下面。没有邮票，没有地址，甚至没有收信人的名字。</p>
          <p>她弯腰拾起信封。纸面冰凉，封口处压着一枚已经褪色的火漆印——一只衔着钥匙的渡鸦。</p>
          <blockquote>“如果你读到这封信，说明雾港仍然记得你。”</blockquote>
          <p>楼下忽然传来三声敲门声。缓慢，克制，恰好与她的心跳错开半拍。</p><span className="cursor"/>
          <footer><span>1,864 字</span><span>阅读约 6 分钟</span><span>上次编辑 2 分钟前</span></footer>
        </article>
        <aside className="ed-ai"><header><span><Sparkles/>创作助手</span><button><MoreHorizontal/></button></header><div className="ai-context"><small>当前场景</small><b>林雾收到神秘来信</b><p>目标：制造悬念，引出旧灯塔线索</p></div><div className="suggestion"><span><WandSparkles/>续写建议</span><p>门外的人可能与十年前的沉船案有关。建议让对方留下一个能唤醒林雾童年记忆的物件。</p><button>采用并续写 <ChevronRight/></button></div><div className="quick"><small>快捷操作</small><button>润色本段</button><button>增强氛围</button><button>检查人物语气</button></div><div className="ed-prompt"><input placeholder="告诉 AI 你想怎么写…"/><button><Sparkles/></button></div></aside>
      </section>
    </main>
  </div>;
}

function Midnight() {
  return <div className="concept concept-midnight">
    <aside className="mid-rail"><div className="mid-logo"><Zap/></div><button className="on"><LayoutDashboard/></button><button><PenLine/></button><button><ListTree/></button><button><UsersRound/></button><button><ShieldCheck/></button><span/><button><Settings2/></button></aside>
    <aside className="mid-panel"><div className="mid-title"><small>ACTIVE PROJECT</small><b>雾港来信</b><span><i/>AI 自动创作中</span></div><div className="mid-ring"><div><strong>68</strong><small>%</small></div><span><b>全书进度</b><small>126,840 / 180,000 字</small></span></div><nav><small>WORKSPACE</small><button className="active"><Activity/>实时控制台 <em>⌘1</em></button><button><BookOpen/>章节矩阵 <em>24</em></button><button><Target/>故事蓝图</button><button><Globe2/>世界设定</button><button><UsersRound/>人物网络</button><small>AI SYSTEM</small><button><Bot/>自动创作</button><button><ShieldCheck/>连续性审计 <em className="warn">3</em></button></nav><div className="mid-engine"><div><span><i/>AI ENGINE</span><b>GPT-5.5</b></div><small>上下文 74% · 延迟 1.2s</small></div></aside>
    <main className="mid-main"><header><div><small>CONTROL CENTER /</small><b>实时控制台</b></div><div className="mid-search"><Search/><span>搜索命令或内容</span><kbd>⌘ K</kbd></div><button className="mid-new"><Plus/>新建任务</button><button className="avatar">LW</button></header>
      <section className="mid-content"><div className="mid-head"><div><small>2026年7月12日 · 周日</small><h1>创作控制台</h1><p>全书状态稳定，第三章正在生成，一致性引擎已载入 186 条记忆。</p></div><button><Command/>进入专注写作</button></div>
      <div className="metric-row"><article><span>今日字数 <PenLine/></span><b>6,482</b><small><i>+18.4%</i> 较昨日</small></article><article><span>生成进度 <Activity/></span><b>03 <em>/ 05</em></b><small>当前批次</small></article><article><span>一致性评分 <ShieldCheck/></span><b>96.8</b><small><i>优秀</i> 全书健康</small></article><article><span>伏笔追踪 <Target/></span><b>18 <em>/ 24</em></b><small>6 条待回收</small></article></div>
      <div className="mid-grid"><article className="generation"><header><div><span className="pulse"><i/></span><span><b>第三章正在生成</b><small>没有名字的信 · 场景 4/6</small></span></div><em>68%</em></header><div className="gen-body"><div className="gen-text"><p>她弯腰拾起信封。纸面冰凉，封口处压着一枚已经褪色的火漆印——</p><p className="typing">一只衔着钥匙的渡鸦。<i/></p></div><div className="gen-stats"><span><small>已生成</small><b>1,864 字</b></span><span><small>实时速度</small><b>42 字/秒</b></span><span><small>预计完成</small><b>01:24</b></span></div></div><footer><button>暂停生成</button><button className="accent">查看实时正文 <ChevronRight/></button></footer></article>
      <article className="tasks"><header><div><small>AUTOMATION QUEUE</small><b>自动任务队列</b></div><button><MoreHorizontal/></button></header>{[["生成第三章正文","运行中","68%"],["提取章节记忆","等待中","—"],["连续性滚动审计","等待中","—"],["更新人物状态","等待中","—"]].map((t,i)=><div className={i===0?"running":""} key={t[0]}><span>{i===0?<Activity/>:<Clock3/>}</span><b>{t[0]}</b><small>{t[1]}</small><em>{t[2]}</em></div>)}</article>
      <article className="timeline"><header><div><small>STORY SIGNAL</small><b>故事信号流</b></div><button>查看全部</button></header><div className="signal-bars"><span style={{height:"42%"}}/><span style={{height:"55%"}}/><span style={{height:"48%"}}/><span style={{height:"68%"}}/><span style={{height:"62%"}}/><span className="hot" style={{height:"88%"}}/><span style={{height:"74%"}}/><span style={{height:"66%"}}/><span style={{height:"78%"}}/><span style={{height:"58%"}}/><span style={{height:"71%"}}/><span style={{height:"82%"}}/></div><div className="signal-label"><span>第 1 章</span><span>情绪张力 / 节奏密度</span><span>第 12 章</span></div></article>
      <article className="alerts"><header><div><small>NEEDS ATTENTION</small><b>需要关注</b></div><span>3</span></header><div><i className="amber"/><p><b>人物年龄存在偏差</b><small>林雾 · 第 2 章与设定相差 1 岁</small></p><ChevronRight/></div><div><i className="blue"/><p><b>伏笔接近回收窗口</b><small>渡鸦火漆 · 建议在第 6–8 章回应</small></p><ChevronRight/></div></article></div></section>
    </main>
  </div>;
}

function Aurora() {
  return <div className="concept concept-aurora"><div className="aurora-glow one"/><div className="aurora-glow two"/>
    <aside className="au-side"><div className="au-brand"><Sparkles/><b>万象</b></div><button className="au-create"><Plus/>开始创作</button><nav><small>创作</small><button className="active"><LayoutDashboard/>概览</button><button><PenLine/>写作空间</button><button><Bot/>AI 全书创作 <em>LIVE</em></button><small>设定</small><button><Globe2/>世界观</button><button><UsersRound/>人物</button><button><ListTree/>大纲与章节</button><small>工具</small><button><ShieldCheck/>一致性中心 <i>3</i></button><button><BookOpen/>素材库</button></nav><div className="au-user"><span>林</span><div><b>林未眠</b><small>创作者计划</small></div><MoreHorizontal/></div></aside>
    <main className="au-main"><header><div><button><Menu/></button><span>我的作品</span><ChevronRight/><b>雾港来信</b></div><div className="au-search"><Search/><span>搜索作品内容...</span></div><button className="au-bell"><Circle/></button><button className="au-avatar">林</button></header>
    <section className="au-content"><div className="au-welcome"><div><span className="au-pill"><Sparkles/>AI 创作空间</span><h1>下午好，林未眠</h1><p>故事正在生长。今天，继续为雾港点亮下一盏灯。</p></div><button><PenLine/>继续写作</button></div>
    <div className="au-hero"><div className="au-book"><div className="cover"><span>雾港</span><b>来信</b><small>THE LETTERS<br/>FROM MIST PORT</small><i/></div><div className="book-shadow"/></div><div className="au-story"><span className="status"><i/>创作中</span><h2>雾港来信</h2><p>一封没有署名的来信，将失忆的灯塔守望者带回十年前那场被城市遗忘的沉船事故。</p><div className="tags"><span>悬疑</span><span>都市奇幻</span><span>成长</span></div><div className="au-progress"><div><span>全书进度</span><b>68%</b></div><i><u/></i><small>126,840 字 <em>目标 180,000 字</em></small></div><div className="au-actions"><button><PenLine/>继续第三章</button><button><MoreHorizontal/></button></div></div><div className="au-orbit"><div className="orb"><Sparkles/><span><b>AI 灵感值</b><strong>92</strong><small>状态绝佳</small></span></div><div className="mini-stat"><span><FileText/>章节</span><b>24</b><small>已完成 18</small></div><div className="mini-stat"><span><Flame/>连续创作</span><b>12<em>天</em></b><small>个人新纪录</small></div></div></div>
    <div className="au-bottom"><article className="au-next"><header><div><span><WandSparkles/></span><div><small>AI 建议的下一步</small><b>推进第三章的关键转折</b></div></div><button>换一个建议</button></header><p>让来访者交出一把生锈的灯塔钥匙，同时暗示林雾曾经认识他，但她完全想不起来。</p><div><button><Sparkles/>让 AI 续写这个情节</button><button>加入章节备注</button></div></article><article className="au-activity"><header><div><small>创作动态</small><b>最近进展</b></div><button>全部记录</button></header><div><span className="green"><CheckCircle2/></span><p><b>完成第二章一致性检查</b><small>今天 14:32 · 评分 98</small></p></div><div><span className="purple"><Sparkles/></span><p><b>AI 生成 3 条剧情灵感</b><small>今天 13:18 · 已采用 1 条</small></p></div><div><span className="orange"><PenLine/></span><p><b>第三章新增 1,864 字</b><small>今天 11:46 · 自动保存</small></p></div></article></div>
    </section></main>
  </div>;
}

export default function UIPreviewPage() {
  const [active, setActive] = useState<Concept>("editorial");
  return <div className="ui-lab">
    <div className="lab-switcher"><div><b>UI 方向提案</b><span>请选择一个方向</span></div><nav>{concepts.map(c=><button key={c.id} className={active===c.id?"active":""} onClick={()=>setActive(c.id)}><i>{c.code}</i><span><b>{c.name}</b><small>{c.note}</small></span></button>)}</nav><Link href="/">返回当前界面</Link></div>
    <div className="lab-canvas">{active==="editorial"&&<Editorial/>}{active==="midnight"&&<Midnight/>}{active==="aurora"&&<Aurora/>}</div>
  </div>;
}
