"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/api";
import { exportPdf, exportPptx } from "@/lib/artifacts";
import { Markdown } from "./markdown";
import { IconCheck, IconDownload, IconFile, IconPencil, IconX } from "./icons";

/**
 * Credon Canvas — a side workspace for long answers, code and slide decks.
 * Editable: your edits are kept and can be re-sent to Credon as context.
 */
export function ArtifactPanel({
  message,
  onClose,
  onRefine,
  onNotify,
}: {
  message: Message | null;
  onClose: () => void;
  onRefine: (instruction: string, currentText: string) => void;
  onNotify: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (message) {
      setText(message.text);
      setTitle(firstHeading(message.text) || "Untitled document");
      setEditing(false);
      dirtyRef.current = false;
    }
  }, [message]);

  if (!message) return null;

  const hasSlides = /^##\s+Slide\s/im.test(text);

  async function doExport(kind: "pdf" | "pptx") {
    setExporting(kind);
    try {
      if (kind === "pdf") await exportPdf(title, text);
      else await exportPptx(title, text);
      onNotify(kind === "pdf" ? "PDF downloaded" : "PPTX downloaded");
    } catch {
      onNotify("Export failed — try again");
    }
    setExporting(null);
  }

  return (
    <aside
      className="fixed inset-0 z-[60] flex flex-col border-l lg:static lg:z-auto lg:w-[440px] lg:shrink-0 xl:w-[500px]"
      style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
    >
      {/* header */}
      <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
          <IconFile size={14} />
        </span>
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1 text-[14px] font-semibold outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight">{title}</h2>
        )}
        <button
          onClick={() => {
            if (editing) setEditing(false);
            else setEditing(true);
          }}
          title={editing ? "Done editing" : "Edit in canvas"}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
          style={{ color: editing ? "var(--accent-text)" : "var(--text-dim)" }}
        >
          {editing ? <IconCheck size={15} /> : <IconPencil size={15} />}
        </button>
        <button
          onClick={onClose}
          aria-label="Close workspace"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
          style={{ color: "var(--text-dim)" }}
        >
          <IconX size={16} />
        </button>
      </header>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              dirtyRef.current = true;
            }}
            className="h-full min-h-[400px] w-full resize-none rounded-xl border p-4 font-mono text-[13px] leading-relaxed outline-none"
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
          />
        ) : (
          <div className="mx-auto max-w-2xl rounded-xl border px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <Markdown content={text} />
          </div>
        )}
      </div>

      {/* refine bar */}
      <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <input
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && refineInput.trim()) {
                onRefine(refineInput.trim(), text);
                setRefineInput("");
              }
            }}
            placeholder="Tell Credon what to change in this document…"
            className="h-10 min-w-0 flex-1 rounded-xl border px-3.5 text-[13.5px] outline-none placeholder:text-[var(--text-faint)]"
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
          />
          <button
            onClick={() => {
              if (refineInput.trim()) {
                onRefine(refineInput.trim(), text);
                setRefineInput("");
              }
            }}
            disabled={!refineInput.trim()}
            className="h-10 shrink-0 rounded-xl px-4 text-[13px] font-medium text-white transition-transform hover:-translate-y-px disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Refine
          </button>
        </div>

        {/* exports */}
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => doExport("pdf")}
            disabled={exporting !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-[13px] font-medium transition-all hover:-translate-y-px disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <IconDownload size={14} />
            {exporting === "pdf" ? "Building…" : "Export PDF"}
          </button>
          <button
            onClick={() => doExport("pptx")}
            disabled={exporting !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-medium text-white transition-all hover:-translate-y-px disabled:opacity-50"
            style={{ background: hasSlides ? "var(--accent)" : "var(--surface-3)", color: hasSlides ? "#fff" : "var(--text-dim)" }}
            title={hasSlides ? "Export as PowerPoint" : "Add '## Slide N:' sections for a structured deck"}
          >
            <IconDownload size={14} />
            {exporting === "pptx" ? "Building…" : "Export PPTX"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function firstHeading(md: string): string {
  const match = md.match(/^#\s+(.+)$/m) || md.match(/^##\s+(.+)$/m);
  return match ? match[1].replace(/[*_`]/g, "").slice(0, 60) : "";
}
