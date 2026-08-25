"use client";

import { useEffect, useState } from "react";
import { IconX } from "./icons";

export type PreviewTarget = {
  kind: "image" | "pdf";
  name: string;
  url?: string; // object URL for images
  text?: string; // extracted PDF text
};

export function PreviewModal({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"file" | "text">("file");

  useEffect(() => {
    if (target) setTab(target.kind === "image" ? "file" : target.url ? "file" : "text");
  }, [target]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8">
      <div className="anim-fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-scale-in relative flex h-full max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl" style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}>
        <header className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{target.name}</span>
          {target.kind === "pdf" && target.text && (
            <button
              onClick={() => setTab((t) => (t === "file" ? "text" : "file"))}
              className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
            >
              {tab === "file" ? "Read extracted text" : "View original"}
            </button>
          )}
          <button onClick={onClose} aria-label="Close preview" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05]" style={{ color: "var(--text-dim)" }}>
            <IconX size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-black/20">
          {tab === "file" ? (
            target.kind === "image" && target.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={target.url} alt={target.name} className="mx-auto max-h-full max-w-full object-contain" />
            ) : target.url ? (
              <iframe src={target.url} title={target.name} className="h-full min-h-[400px] w-full" />
            ) : (
              <p className="p-8 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
                Preview unavailable — the extracted text is what Credon reads.
              </p>
            )
          ) : (
            <pre className="p-5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-dim)" }}>
              {target.text?.slice(0, 12000) || "No text extracted yet."}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
