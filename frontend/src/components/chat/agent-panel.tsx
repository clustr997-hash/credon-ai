"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentState, ScheduledJob, WorkspaceFile } from "@/lib/api";
import { IconCheck, IconChevronDown, IconChevronRight, IconClock, IconFolder, IconList, IconTerminalSquare, IconX } from "./icons";

const KIND_LABEL: Record<string, string> = {
  research: "Research",
  browse: "Browse",
  reason: "Reasoning",
  code: "Code",
};

type Tab = "plan" | "tools" | "terminal" | "files" | "report";

export function AgentPanel({
  agent,
  streaming,
  files = [],
  reportText = "",
  onSchedule,
}: {
  agent: AgentState;
  streaming: boolean;
  files?: WorkspaceFile[];
  reportText?: string;
  onSchedule?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("plan");
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "terminal") termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [agent?.activeTerminal?.length, tab]);

  useEffect(() => {
    if (files.length > 0 && tab === "plan" && !streaming) setTab("files");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length]);

  useEffect(() => {
    if (reportText && !streaming) setTab("report");
  }, [reportText, streaming]);

  if (!agent) return null;

  const doneCount = agent.steps.filter((s) => s.status === "done").length;
  const running = agent.steps.some((s) => s.status === "running");
  const terminal = agent.activeTerminal ?? [];

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "plan", label: "Plan", icon: <IconList size={13} />, badge: agent.steps.length },
    { id: "tools", label: "Tools", icon: <IconTerminalSquare size={13} />, badge: agent.toolEvents?.length },
    { id: "terminal", label: "Terminal", icon: <IconTerminalSquare size={13} /> },
    { id: "files", label: "Files", icon: <IconFolder size={13} />, badge: files.length },
    { id: "report", label: "Report", icon: <IconCheck size={13} /> },
  ];

  return (
    <div className="anim-scale-in mb-3 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[12px]" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
            ◈
          </span>
          <span className="truncate text-[13px] font-medium">Credon Agent</span>
          <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}>
            {doneCount}/{agent.steps.length}
          </span>
          {running && (
            <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              working
            </span>
          )}
          <span className="ml-auto text-[var(--text-faint)]">
            {open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
          </span>
        </button>
        {onSchedule && (
          <button
            onClick={onSchedule}
            title="Schedule this goal to run later"
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
            style={{ color: "var(--text-faint)" }}
          >
            <IconClock size={14} />
          </button>
        )}
      </div>

      {open && (
        <>
          {/* tab bar */}
          <div className="flex gap-1 border-t px-3 pt-2" style={{ borderColor: "var(--border)" }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: tab === t.id ? "var(--accent)" : "transparent",
                  color: tab === t.id ? "var(--text)" : "var(--text-faint)",
                }}
              >
                {t.icon}
                {t.label}
                {t.badge ? (
                  <span className="rounded-full px-1.5 text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-dim)" }}>
                    {t.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            {tab === "plan" && (
              <div className="space-y-0.5">
                {agent.steps.map((step, i) => (
                  <div key={step.id} className="anim-fade-up flex items-start gap-3 rounded-lg px-2 py-1.5" style={{ animationDelay: `${i * 0.05}s` }}>
                    <span
                      className={`mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] ${
                        step.status === "done"
                          ? "text-emerald-400"
                          : step.status === "running"
                            ? "pulse-dot text-[var(--accent-text)]"
                            : ""
                      }`}
                      style={{
                        background: step.status === "done" ? "rgba(74,222,128,0.15)" : step.status === "running" ? "var(--accent-soft)" : "transparent",
                        border: step.status === "pending" ? "1px solid var(--border-strong)" : "none",
                      }}
                    >
                      {step.status === "done" ? "✓" : step.status === "running" ? "•" : ""}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] leading-snug" style={{ color: step.status === "pending" ? "var(--text-faint)" : "var(--text)" }}>
                        {step.title}
                      </p>
                      {step.status !== "pending" && (
                        <p className="font-mono text-[10.5px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                          {KIND_LABEL[step.kind] ?? step.kind}
                          {step.status === "running" && <span className="shimmer-text"> · in progress…</span>}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "tools" && (
              <div className="space-y-3">
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <p className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>Server-authorized capabilities</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(agent.capabilities || {}).map(([name, enabled]) => (
                      <span key={name} className="rounded-full px-2 py-0.5 font-mono text-[10.5px]" style={{ background: enabled ? "rgba(74,222,128,0.14)" : "rgba(248,113,113,0.10)", color: enabled ? "rgba(74,222,128,0.9)" : "rgba(248,113,113,0.8)" }}>
                        {enabled ? "✓" : "×"} {name}
                      </span>
                    ))}
                  </div>
                  {!agent.unsafeEnabled && <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-faint)" }}>Unsafe operations remain disabled until the authenticated owner enables them server-side.</p>}
                </div>
                {(agent.toolEvents || []).length === 0 ? (
                  <p className="py-6 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>Tool calls will appear here as the agent runs.</p>
                ) : (agent.toolEvents || []).map((evt, i) => (
                  <div key={`${evt.name}-${i}`} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[12px]" style={{ color: "var(--text)" }}>{evt.name}</span>
                      <span className="rounded-full px-2 py-0.5 font-mono text-[10px]" style={{ background: "var(--surface-2)", color: evt.status === "ok" ? "rgba(74,222,128,0.9)" : "rgba(248,113,113,0.85)" }}>{evt.status}</span>
                    </div>
                    {evt.output && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]" style={{ color: "var(--text-dim)" }}>{evt.output}</pre>}
                    {!!evt.files_changed?.length && <p className="mt-2 font-mono text-[10.5px]" style={{ color: "var(--text-faint)" }}>changed: {evt.files_changed.join(", ")}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === "terminal" && (
              <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "#0a0a0c" }}>
                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <span className="font-mono text-[10.5px] tracking-wide text-white/35">credon-agent · sandbox</span>
                  <span className="font-mono text-[10px]" style={{ color: streaming ? "rgba(74,222,128,0.8)" : "rgba(255,255,255,0.25)" }}>
                    {streaming ? "● live" : "idle"}
                  </span>
                </div>
                <div ref={termRef} className="max-h-64 min-h-[120px] overflow-y-auto p-3">
                  {terminal.length === 0 && <div className="term-line" style={{ color: "rgba(255,255,255,0.25)" }}>waiting for steps…</div>}
                  {terminal.map((line, i) => (
                    <div
                      key={i}
                      className="term-line"
                      style={{
                        color: line.startsWith("✓") || line.startsWith("→")
                          ? "rgba(74,222,128,0.9)"
                          : line.startsWith("$") || line.startsWith("◇") || line.startsWith("[")
                            ? "rgba(240,149,108,0.85)"
                            : line.startsWith("stderr") || line.toLowerCase().includes("error") || line.startsWith("✕")
                              ? "rgba(248,113,113,0.85)"
                              : "rgba(255,255,255,0.62)",
                      }}
                    >
                      {line}
                    </div>
                  ))}
                  {streaming && <div className="term-line term-caret" style={{ color: "rgba(255,255,255,0.3)" }} />}
                </div>
              </div>
            )}

            {tab === "files" && (
              <div className="space-y-1.5">
                {agent.filesChanged?.length ? (
                  <div className="rounded-xl border p-3 font-mono text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
                    Changed in this run: {agent.filesChanged.join(", ")}
                  </div>
                ) : null}
                {files.length === 0 && (
                  <p className="py-6 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>
                    Files the agent writes will appear here — scripts, outputs, reports.
                  </p>
                )}
                {files.map((file) => (
                  <details key={file.path} className="group rounded-xl border" style={{ borderColor: "var(--border)" }}>
                    <summary className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
                      <IconFolder size={14} style={{ color: "var(--text-faint)" }} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" style={{ color: "var(--text)" }}>
                        {file.path}
                      </span>
                      <span className="font-mono text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                        {file.size > 1024 ? `${(file.size / 1024).toFixed(1)}kb` : `${file.size}b`}
                      </span>
                    </summary>
                    <pre className="max-h-48 overflow-auto border-t px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
                      {file.preview}
                    </pre>
                  </details>
                ))}
              </div>
            )}

            {tab === "report" && (
              <div className="max-h-64 overflow-y-auto rounded-xl border p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
                {reportText ? `${reportText.slice(0, 2400)}${reportText.length > 2400 ? "\n…" : ""}` : "The final report will appear here when the run completes."}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── schedule dialog ── */
export function ScheduleDialog({
  open,
  onClose,
  goal,
  userId,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  goal: string;
  userId: string;
  onNotify: (msg: string) => void;
}) {
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<"once" | "daily">("once");
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    fetch(`${base}/api/v1/schedule/${userId}`)
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => {});
  }, [open, userId]);

  if (!open) return null;

  async function schedule() {
    if (!when || !goal.trim()) return;
    setBusy(true);
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    try {
      const res = await fetch(`${base}/api/v1/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, goal, run_at: new Date(when).toISOString(), repeat }),
      });
      if (res.ok) {
        onNotify("Scheduled — Credon will run it and notify you");
        setWhen("");
        const d = await fetch(`${base}/api/v1/schedule/${userId}`).then((r) => r.json());
        setJobs(d.jobs || []);
      }
    } catch {
      onNotify("Could not reach the Credon engine to schedule");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="modal-content anim-scale-in relative w-full overflow-hidden rounded-t-2xl border shadow-2xl sm:max-w-md sm:rounded-2xl"
        style={{ borderColor: "var(--border-strong)", background: "var(--surface)", boxShadow: "var(--shadow-pop)" }}
      >
        <header className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[15.5px] font-semibold tracking-tight">Schedule this goal</h2>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
              Credon runs it in the background and notifies you
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05]" style={{ color: "var(--text-dim)" }}>
            <IconX size={16} />
          </button>
        </header>
        <div className="space-y-3.5 p-5">
          <div className="rounded-xl border px-3.5 py-2.5 text-[13px]" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
            {goal.slice(0, 140)}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-dim)" }}>
              Run at
            </span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="h-11 w-full rounded-xl border px-3.5 text-[14px] outline-none"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
            />
          </label>
          <div className="flex gap-2">
            {(["once", "daily"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRepeat(r)}
                className="flex-1 rounded-xl border px-3 py-2 text-[13px] capitalize transition-all"
                style={{
                  borderColor: repeat === r ? "rgba(224,129,88,0.55)" : "var(--border)",
                  background: repeat === r ? "var(--accent-softer)" : "transparent",
                  color: repeat === r ? "var(--accent-text)" : "var(--text-dim)",
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={schedule}
            disabled={busy || !when}
            className="h-11 w-full rounded-xl text-[14px] font-medium text-white transition-transform hover:-translate-y-px disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "Scheduling…" : "Schedule"}
          </button>

          {jobs.length > 0 && (
            <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-faint)" }}>
                Upcoming
              </p>
              <ul className="space-y-1.5">
                {jobs.filter((j) => j.status === "pending").slice(-4).map((job) => (
                  <li key={job.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: "var(--border)" }}>
                    <IconClock size={13} style={{ color: "var(--accent-text)" }} />
                    <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-dim)" }}>{job.goal}</span>
                    <span className="font-mono text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                      {new Date(job.run_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button
                      onClick={async () => {
                        const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
                        await fetch(`${base}/api/v1/schedule/${job.id}`, { method: "DELETE" });
                        setJobs((prev) => prev.filter((j) => j.id !== job.id));
                      }}
                      aria-label="Cancel job"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <IconX size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            Needs the Credon engine (backend) running — it executes due jobs on health checks.
          </p>
        </div>
      </div>
    </div>
  );
}
