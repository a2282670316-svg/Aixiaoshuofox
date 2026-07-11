"use client";

import { AlertTriangle, Check, CircleStop, FileText, LoaderCircle, RotateCcw, Route, Zap } from "lucide-react";
import type { AutomationRecoveryData, GenerationRecoveryStep, NovelAutomation } from "@/lib/types";

type Props = {
  automation: NovelAutomation;
  recovery: AutomationRecoveryData | null;
  recoveryLoading: boolean;
  durableProjectId?: string;
  isRunning: boolean;
  onRefreshRecovery: () => void;
  onRecoverStep: (step: GenerationRecoveryStep) => void;
};

function phaseLabel(phase: NovelAutomation["phase"]) {
  return ({ idle: "\u5c1a\u672a\u5f00\u59cb", ideating: "\u6b63\u5728\u751f\u6210\u6545\u4e8b\u65b9\u5411", choosing: "\u7b49\u5f85\u9009\u62e9\u6545\u4e8b", planning: "\u6b63\u5728\u642d\u5efa\u5168\u4e66\u84dd\u56fe", ready: "\u84dd\u56fe\u5df2\u5c31\u7eea", writing: "\u6b63\u5728\u8fde\u7eed\u5199\u4f5c", paused: "\u5df2\u6682\u505c\uff0c\u53ef\u7ee7\u7eed", completed: "\u5168\u4e66\u521d\u7a3f\u5df2\u5b8c\u6210", error: "\u4efb\u52a1\u9047\u5230\u95ee\u9898" } as const)[phase];
}

function kindLabel(kind: string) {
  return ({
    blueprint_foundation: "\u4eba\u7269\u4e0e\u5173\u7cfb", blueprint_world: "\u4e16\u754c\u8bbe\u5b9a", blueprint_outline: "\u6545\u4e8b\u5927\u7eb2", blueprint_foreshadows: "\u4f0f\u7b14\u56de\u6536", blueprint_chapters: "\u9010\u7ae0\u76ee\u5f55",
    chapter_segment: "\u6b63\u6587\u5206\u6bb5", chapter_memory: "\u7ae0\u8282\u8bb0\u5fc6", rolling_audit: "\u4e00\u81f4\u6027\u5ba1\u6821", consistency_repair: "\u4e00\u81f4\u6027\u4fee\u590d",
  } as Record<string, string>)[kind] || kind.replaceAll("_", " ");
}

export default function AutomationTaskCenter({ automation, recovery, recoveryLoading, durableProjectId, isRunning, onRefreshRecovery, onRecoverStep }: Props) {
  const latestRun = recovery?.runs[0];
  return <>
    <section className="automation-task-center recovery-center">
      <div className="auto-section-title"><div><span>RECOVERY CENTER</span><h3>{"\u9636\u6bb5\u6062\u590d\u4e2d\u5fc3"}</h3></div><button className="secondary-button compact" disabled={!durableProjectId || recoveryLoading} onClick={onRefreshRecovery}><RotateCcw size={14} />{recoveryLoading ? "\u8bfb\u53d6\u4e2d" : "\u5237\u65b0\u8bb0\u5f55"}</button></div>
      {!durableProjectId ? <p className="automation-task-empty">{"\u4fdd\u5b58\u4e3a\u4e91\u7aef\u4f5c\u54c1\u540e\uff0c\u6bcf\u4e2a\u9636\u6bb5\u68c0\u67e5\u70b9\u90fd\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002"}</p> : latestRun ? <>
        <div className="auto-progress-meta"><span><Route size={14} />{"\u6700\u8fd1\u8fd0\u884c\uff1a"}{phaseLabel(latestRun.phase)}</span><span><FileText size={14} />{"\u7b2c "}{latestRun.currentChapterNumber || 0}{" \u7ae0 \u00b7 \u7b2c "}{latestRun.currentSegment || 0}{" \u6bb5"}</span><span><Zap size={14} />{latestRun.usage.totalTokens.toLocaleString("zh-CN")} Token</span></div>
        {latestRun.steps.length ? <div className="automation-task-list">{latestRun.steps.slice(0, 8).map((step) => <article key={step.id} className={`task-${step.status}`}><i>{step.status === "completed" ? <Check size={13} /> : <AlertTriangle size={13} />}</i><div><b>{kindLabel(step.kind)}</b><small>{step.chapterNumber ? `\u7b2c ${step.chapterNumber} \u7ae0${step.segmentNumber ? ` \u00b7 \u7b2c ${step.segmentNumber} \u6bb5` : ""}` : "\u84dd\u56fe\u9636\u6bb5"} \u00b7 {step.status === "completed" ? "\u5df2\u4fdd\u5b58" : step.error || "\u5931\u8d25"}</small></div><button className="secondary-button compact" disabled={isRunning} onClick={() => onRecoverStep(step)}>{"\u4ece\u6b64\u7ee7\u7eed"}</button></article>)}</div> : <p className="automation-task-empty">{"\u5df2\u521b\u5efa\u8fd0\u884c\u8bb0\u5f55\uff0c\u6682\u65e0\u53ef\u6062\u590d\u7684\u9636\u6bb5\u68c0\u67e5\u70b9\u3002"}</p>}
      </> : <p className="automation-task-empty">{recoveryLoading ? "\u6b63\u5728\u8bfb\u53d6\u4e91\u7aef\u68c0\u67e5\u70b9\u2026" : "\u6682\u65e0\u4e91\u7aef\u6062\u590d\u8bb0\u5f55\u3002"}</p>}
    </section>
    <section className="automation-task-center">
      <div className="auto-section-title"><div><span>TASK CENTER</span><h3>{"\u540e\u53f0\u4efb\u52a1\u4e2d\u5fc3"}</h3></div><small>{(automation.taskLog || []).length}{" \u6761\u8bb0\u5f55"}</small></div>
      {(automation.taskLog || []).length ? <div className="automation-task-list">{(automation.taskLog || []).slice(0, 12).map((task) => <article key={task.id} className={`task-${task.status}`}><i>{task.status === "completed" ? <Check size={13} /> : task.status === "failed" ? <AlertTriangle size={13} /> : task.status === "cancelled" ? <CircleStop size={13} /> : <LoaderCircle className={task.status === "running" ? "spin" : ""} size={13} />}</i><div><b>{task.label}</b><small>{task.chapterNumber ? `\u7b2c ${task.chapterNumber} \u7ae0 \u00b7 ` : ""}{task.status === "running" ? "\u8fd0\u884c\u4e2d" : task.status === "completed" ? "\u5df2\u5b8c\u6210" : task.status === "failed" ? task.error || "\u5931\u8d25" : task.status === "cancelled" ? "\u5df2\u53d6\u6d88" : "\u6392\u961f\u4e2d"}</small></div><time>{new Date(task.finishedAt || task.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>)}</div> : <p className="automation-task-empty">{"\u542f\u52a8\u7ae0\u8282\u91cd\u5efa\u3001\u4fee\u590d\u961f\u5217\u6216\u540e\u53f0\u5199\u4f5c\u540e\uff0c\u4efb\u52a1\u8bb0\u5f55\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002"}</p>}
    </section>
  </>;
}
