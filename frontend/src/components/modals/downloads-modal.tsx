"use client";

import { useState } from "react";
import { API } from "@/lib/api";
import type { Message, SessionSummary } from "@/lib/api";
import { ModalShell, SectionLabel } from "./shell";
import { IconCheck, IconDownload } from "@/components/chat/icons";

type ExportKind = "current" | "all" | "answer";

export function DownloadsModal({
  open,
  onClose,
  userId,
  currentSessionId,
  sessions,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  currentSessionId: string;
  sessions: SessionSummary[];
  messages: Message[];
}) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [done, setDone] = useState<string>("");

  async function downloadPdf(kind: ExportKind) {
    setDone("");
    setBusy(kind);
    try {
      const endpoint =
        kind === "all"
          ? "/api/v1/generate/export/all-chats-pdf"
          : kind === "current"
            ? "/api/v1/generate/export/chat-pdf"
            : "/api/v1/generate/export/answer-pdf";

      const body =
        kind === "all"
          ? { user_id: userId }
          : kind === "current"
            ? { user_id: userId, session_id: currentSessionId }
            : (() => {
                const last = [...messages].reverse().find((m) => m.role === "assistant" && m.text);
                const question = [...messages].reverse().find((m) => m.role === "user")?.text || "Answer";
                return {
                  title: question.slice(0, 80),
                  content: last?.text || "",
                  user_id: userId,
                };
              })();

      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        kind === "all"
          ? "credon-all-chats.pdf"
          : kind === "current"
            ? `credon-chat-${currentSessionId.slice(0, 8)}.pdf`
            : "credon-answer.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDone(
        kind === "all"
          ? "All chats exported."
          : kind === "current"
            ? "Chat exported."
            : "Answer exported."
      );
    } catch (error) {
      setDone(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  function downloadJson() {
    const payload = JSON.stringify({ user_id: userId, exported_at: new Date().toISOString(), messages }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `credon-session-${currentSessionId.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Export center" subtitle="Take your work anywhere — clean PDFs and raw data." width={540}>
      <div className="space-y-3">
        <SectionLabel>Documents</SectionLabel>

        <ExportRow
          icon={<IconDownload size={16} />}
          title="Current chat as PDF"
          description={
            sessions.find((s) => s.session_id === currentSessionId)?.preview?.slice(0, 60) ||
            `${messages.length} messages in this conversation`
          }
          actionLabel={busy === "current" ? "Exporting…" : "Export"}
          disabled={busy !== null || messages.length === 0}
          onClick={() => downloadPdf("current")}
        />

        <ExportRow
          icon={<IconDownload size={16} />}
          title="Last answer as PDF"
          description="One-click hand-in sheet for assignments and reports"
          actionLabel={busy === "answer" ? "Exporting…" : "Export"}
          disabled={busy !== null || !messages.some((m) => m.role === "assistant")}
          onClick={() => downloadPdf("answer")}
        />

        <ExportRow
          icon={<IconDownload size={16} />}
          title={`All chats as PDF (${sessions.length})`}
          description="Full archive across every session on this account"
          actionLabel={busy === "all" ? "Exporting…" : "Export"}
          disabled={busy !== null || sessions.length === 0}
          onClick={() => downloadPdf("all")}
        />

        <SectionLabel>Data</SectionLabel>
        <ExportRow
          icon={<span className="font-mono text-[11px]">{"{ }"}</span>}
          title="Session as JSON"
          description="Raw transcript for backups or pipelines"
          actionLabel="Download"
          disabled={messages.length === 0}
          onClick={downloadJson}
        />

        {done && (
          <p className="anim-scale-in flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
            <IconCheck size={14} /> {done}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

function ExportRow({
  icon,
  title,
  description,
  actionLabel,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-3)", color: "var(--text-dim)" }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{title}</span>
        <span className="block truncate text-[12px]" style={{ color: "var(--text-faint)" }}>
          {description}
        </span>
      </span>
      <button
        onClick={onClick}
        disabled={disabled}
        className="shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px hover:border-[var(--border-strong)] disabled:opacity-40"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
