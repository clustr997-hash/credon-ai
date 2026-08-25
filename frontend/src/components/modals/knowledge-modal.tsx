"use client";

import { useRef, useState } from "react";
import { API } from "@/lib/api";
import { ModalShell } from "./shell";
import { IconCheck, IconFile, IconX } from "@/components/chat/icons";

type Ingested = { filename: string; ok: boolean };

export function KnowledgeModal({
  open,
  onClose,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
}) {
  const [mode, setMode] = useState<"upload" | "text">("upload");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [ingested, setIngested] = useState<Ingested[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setResult("");
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("user_id", userId);
      form.append("file", file);
      form.append("source_type", "pdf");
      try {
        const endpoint = file.type.startsWith("image/") ? "/api/v1/ingest/image" : "/api/v1/ingest/pdf";
        const response = await fetch(`${API}${endpoint}`, { method: "POST", body: form });
        const data = await response.json();
        setIngested((prev) => [...prev, { filename: file.name, ok: response.ok && data.ok }]);
        if (!response.ok || !data.ok) {
          setResult(data.warning || `Failed to read ${file.name}`);
        }
      } catch {
        setIngested((prev) => [...prev, { filename: file.name, ok: false }]);
        setResult(`Couldn't reach the reader service for ${file.name}.`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function saveText() {
    if (!text.trim()) return;
    setBusy(true);
    setResult("");
    try {
      const response = await fetch(`${API}/api/v1/ingest/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          document_id: `note-${Date.now().toString(36)}`,
          title: title.trim() || "Untitled note",
          text,
          source_type: "note",
        }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        setIngested((prev) => [...prev, { filename: title.trim() || "Untitled note", ok: true }]);
        setTitle("");
        setText("");
      } else {
        setResult("Could not save the note.");
      }
    } catch {
      setResult("Could not reach the reader service.");
    }
    setBusy(false);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Knowledge library"
      subtitle="Upload PDFs, images or notes — then just ask questions about them in chat."
      width={560}
    >
      {/* mode switch */}
      <div className="mb-4 flex gap-1 rounded-xl border p-1" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        {(
          [
            ["upload", "Files"],
            ["text", "Paste notes"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className="flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-all"
            style={mode === key ? { background: "var(--surface-3)", color: "var(--text)" } : { color: "var(--text-dim)" }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 transition-colors hover:border-[rgba(224,129,88,0.5)] hover:bg-[var(--accent-softer)]"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
              <IconFile size={22} />
            </span>
            <span>
              <span className="block text-[14px] font-medium">{busy ? "Reading documents…" : "Drop or choose PDFs & images"}</span>
              <span className="mt-0.5 block text-[12.5px]" style={{ color: "var(--text-faint)" }}>
                Textbooks, papers, handwritten notes, screenshots
              </span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </>
      ) : (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title (e.g. DBMS unit 3 summary)"
            className="h-11 w-full rounded-xl border px-3.5 text-[14px] outline-none transition-colors focus:border-[rgba(224,129,88,0.5)] placeholder:text-[var(--text-faint)]"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
          />
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste lecture notes, definitions, formulas…"
            className="w-full resize-none rounded-xl border px-3.5 py-3 text-[13.5px] outline-none transition-colors focus:border-[rgba(224,129,88,0.5)] placeholder:text-[var(--text-faint)]"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
          />
          <button
            onClick={saveText}
            disabled={busy || !text.trim()}
            className="h-10 w-full rounded-xl text-[13.5px] font-medium text-white transition-transform hover:-translate-y-px disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "Saving…" : "Save to library"}
          </button>
        </div>
      )}

      {result && (
        <p className="anim-scale-in mt-3 rounded-xl border px-3.5 py-2.5 text-[13px]" style={{ borderColor: "rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.07)", color: "#fbbf24" }}>
          {result}
        </p>
      )}

      {ingested.length > 0 && (
        <ul className="mt-4 space-y-1">
          {ingested.map((item, i) => (
            <li key={`${item.filename}-${i}`} className="anim-fade-up flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: item.ok ? "var(--ok)" : "var(--err)" }}>{item.ok ? <IconCheck size={14} /> : <IconX size={14} />}</span>
              <span className="min-w-0 flex-1 truncate">{item.filename}</span>
              <span className="text-[11.5px]" style={{ color: item.ok ? "var(--ok)" : "var(--text-faint)" }}>
                {item.ok ? "indexed" : "failed"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {ingested.some((i) => i.ok) && (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--accent-text)" }}>
          Ready — go back to chat and ask anything about these documents.
        </p>
      )}
    </ModalShell>
  );
}
