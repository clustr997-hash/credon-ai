"use client";

import { useEffect, type ReactNode } from "react";
import { IconX } from "@/components/chat/icons";

export function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="modal-content anim-scale-in relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-2xl sm:rounded-2xl"
        style={{ maxWidth: width, borderColor: "var(--border-strong)", background: "var(--surface)", boxShadow: "var(--shadow-pop)" }}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[15.5px] font-semibold tracking-tight">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
            style={{ color: "var(--text-dim)" }}
          >
            <IconX size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 mt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-faint)" }}>
      {children}
    </p>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border px-3.5 py-3 transition-colors hover:bg-white/[0.02]" style={{ borderColor: "var(--border)" }}>
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className="relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? "var(--accent)" : "var(--surface-3)" }}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
    </label>
  );
}
