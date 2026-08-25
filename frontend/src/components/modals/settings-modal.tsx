"use client";

import { useEffect, useState } from "react";
import type { MemoryItem, ModelInfo } from "@/lib/api";
import { getLiveApiBase } from "@/lib/api";
import { ModalShell, SectionLabel, ToggleRow } from "./shell";

type EvolveEntry = {
  id: string;
  ts: string;
  issue: string;
  evidence?: string;
  plan?: string;
  files?: string[];
  pr_url?: string;
  merged?: boolean;
};

export function SettingsModal({
  open,
  onClose,
  webSearch,
  onWebSearchChange,
  voiceReplies,
  onVoiceRepliesChange,
  models,
  selectedModel,
  onSelectModel,
  memoryProfile,
  userId,
  onNotify,
  ownerEmail,
  isOwner,
}: {
  open: boolean;
  onClose: () => void;
  webSearch: boolean;
  onWebSearchChange: (v: boolean) => void;
  voiceReplies: boolean;
  onVoiceRepliesChange: (v: boolean) => void;
  models: ModelInfo[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  memoryProfile: { name: string; role: string; subjects: string; language: string; notes: string };
  userId: string;
  onNotify: (msg: string) => void;
  ownerEmail?: string;
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<"general" | "models" | "memory" | "self">("general");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [system, setSystem] = useState<{
    github?: { connected: boolean; note: string; repo: string };
    autopilot?: boolean;
    signals?: { total: number; by_kind: Record<string, number>; recent: { kind: string; detail: string; ts: string }[] };
    log?: EvolveEntry[];
    prs_today?: number;
  } | null>(null);
  const [evolving, setEvolving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTab("general");
      return;
    }
    if (tab === "memory" && userId && memories.length === 0) {
      void getLiveApiBase().then((base) => {
        if (base === "__direct__") return;
        fetch(`${base}/api/v1/memory/${userId}`)
          .then((r) => r.json())
          .then((d) => setMemories(d.items || []))
          .catch(() => {});
      });
    }
    if (tab === "self" && isOwner && system === null) {
      void getLiveApiBase().then((base) => {
        if (base === "__direct__") return;
        fetch(`${base}/api/v1/system/status?email=${encodeURIComponent(ownerEmail || "")}`)
          .then((r) => (r.ok ? r.json() : null))
          .then(setSystem)
          .catch(() => setSystem({}));
      });
    }
  }, [open, tab, userId, memories.length, isOwner, ownerEmail, system]);

  async function runEvolve() {
    setEvolving(true);
    try {
      const base = await getLiveApiBase();
      const res = await fetch(`${base}/api/v1/system/evolve?email=${encodeURIComponent(ownerEmail || "")}`, { method: "POST" });
      const data = await res.json();
      if (data.ok && data.pr_url) {
        onNotify(data.merged ? "Fix merged automatically" : "PR opened — approve it on GitHub");
        window.open(data.pr_url, "_blank");
      } else {
        onNotify(data.reason || "Cycle finished without changes");
      }
      const fresh = await fetch(`${base}/api/v1/system/status?email=${encodeURIComponent(ownerEmail || "")}`);
      if (fresh.ok) setSystem(await fresh.json());
    } catch {
      onNotify("Engine unreachable — start it to run the loop");
    }
    setEvolving(false);
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Settings" subtitle="Tune how Credon works for you." width={600}>
      <div className="mb-5 flex gap-1 rounded-xl border p-1" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        {(
          [
            ["general", "General"],
            ["models", "Models"],
            ["memory", "Memory"],
            ...(isOwner ? ([["self", "Self-improve"]] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-all"
            style={tab === key ? { background: "var(--surface-3)", color: "var(--text)" } : { color: "var(--text-dim)" }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div className="space-y-3">
          <SectionLabel>Answering</SectionLabel>
          <ToggleRow
            title="Live web search"
            description="Ground answers in fresh sources with citations."
            checked={webSearch}
            onChange={onWebSearchChange}
          />
          <ToggleRow
            title="Spoken replies"
            description="Credon reads answers aloud — hands-free Jarvis mode."
            checked={voiceReplies}
            onChange={onVoiceRepliesChange}
          />
          <SectionLabel>Your profile</SectionLabel>
          <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
            <dl className="space-y-1 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
              <div className="flex gap-2"><dt className="w-16 shrink-0" style={{ color: "var(--text-faint)" }}>Name</dt><dd>{memoryProfile.name || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-16 shrink-0" style={{ color: "var(--text-faint)" }}>Role</dt><dd>{memoryProfile.role || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-16 shrink-0" style={{ color: "var(--text-faint)" }}>Subjects</dt><dd>{memoryProfile.subjects || "—"}</dd></div>
            </dl>
            <p className="mt-2.5 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
              Edit from Profile → Personal memory.
            </p>
          </div>
        </div>
      )}

      {tab === "models" && (
        <div className="space-y-2">
          <p className="!mt-0 mb-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Credon picks the best route for every message automatically. Pick a family member to bias the choice.
          </p>
          {models.map((model) => {
            const active = model.id === selectedModel;
            return (
              <button
                key={model.id}
                onClick={() => onSelectModel(model.id)}
                className="flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-white/[0.02]"
                style={{
                  borderColor: active ? "rgba(224,129,88,0.55)" : "var(--border)",
                  background: active ? "var(--accent-softer)" : "transparent",
                }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-bold"
                  style={{ background: "var(--surface-3)", color: active ? "var(--accent-text)" : "var(--text-dim)" }}
                >
                  {model.label.split(" ").slice(-1)[0]?.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{model.label}</span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--text-faint)" }}>
                    {model.description}
                  </span>
                </span>
                {active && <span style={{ color: "var(--accent-text)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {tab === "memory" && (
        <div className="space-y-2">
          <p className="!mt-0 mb-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Everything Credon has learned from your conversations. Full transparency — forget anything.
          </p>
          {memories.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border-strong)", color: "var(--text-faint)" }}>
              <p className="text-[13.5px]">Nothing learned yet.</p>
              <p className="mt-1 text-[12.5px]">Credon saves useful Q&A pairs as you chat (requires the Credon engine running).</p>
            </div>
          )}
          {memories.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>{item.question}</p>
                <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--text-faint)" }}>{item.answer}</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const base = await getLiveApiBase();
                    await fetch(`${base}/api/v1/memory/${userId}/${item.id}`, { method: "DELETE" });
                    setMemories((prev) => prev.filter((m) => m.id !== item.id));
                    onNotify("Forgotten");
                  } catch {
                    onNotify("Could not reach the engine");
                  }
                }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium"
                style={{ background: "var(--surface-3)", color: "var(--text-dim)" }}
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "self" && isOwner && (
        <div className="space-y-3">
          <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${system?.github?.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <p className="text-[13.5px] font-medium">
                {system === null ? "Checking…" : system?.github?.connected ? "GitHub connected" : "GitHub not ready"}
              </p>
            </div>
            {system?.github && !system.github.connected && (
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
                {system.github.note}. Create the repo <code className="font-mono">{system.github.repo}</code> on GitHub and ensure the token covers it.
              </p>
            )}
            {system?.github?.connected && (
              <p className="mt-1 font-mono text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                {system.github.repo} · {system.prs_today ?? 0} PR(s) today
              </p>
            )}
          </div>

          <button
            onClick={runEvolve}
            disabled={evolving}
            className="h-11 w-full rounded-xl text-[13.5px] font-medium text-white transition-transform hover:-translate-y-px disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {evolving ? "Analyzing signals & writing patch…" : "Run improvement cycle now"}
          </button>

          {system?.signals && (
            <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Signal ledger · {system.signals.total} total
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(system.signals.by_kind).map(([kind, count]) => (
                  <span key={kind} className="rounded-full px-2.5 py-1 text-[11.5px]" style={{ background: "var(--surface-3)", color: "var(--text-dim)" }}>
                    {kind.replace(/_/g, " ")} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(system?.log?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <SectionLabel>Recent self-changes</SectionLabel>
              {system!.log!.map((entry) => (
                <a
                  key={entry.id}
                  href={entry.pr_url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border px-3.5 py-3 transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${entry.merged ? "bg-emerald-400/15 text-emerald-400" : "text-[var(--accent-text)]"}`} style={!entry.merged ? { background: "var(--accent-softer)" } : undefined}>
                      {entry.merged ? "merged" : "PR open"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                      {entry.issue}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px]" style={{ color: "var(--text-faint)" }}>
                    {entry.plan}
                  </p>
                </a>
              ))}
            </div>
          )}

          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
            Credon studies problems from real usage, patches its own code, and opens a pull
            request — you approve on GitHub. Autopilot is {system?.autopilot ? "ON" : "OFF"}.
          </p>
        </div>
      )}
    </ModalShell>
  );
}
