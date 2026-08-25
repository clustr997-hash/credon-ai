"use client";

import { useEffect, useState } from "react";
import { ModalShell, SectionLabel } from "./shell";

export type MemoryProfile = {
  name: string;
  role: string;
  subjects: string;
  language: string;
  notes: string;
};

const EMPTY: MemoryProfile = { name: "", role: "", subjects: "", language: "", notes: "" };

export function ProfileModal({
  open,
  onClose,
  isGuest,
  userName,
  userEmail,
  photoUrl,
  memory,
  onSaveMemory,
}: {
  open: boolean;
  onClose: () => void;
  isGuest: boolean;
  userName: string;
  userEmail: string;
  photoUrl?: string | null;
  memory: MemoryProfile;
  onSaveMemory: (m: MemoryProfile) => void;
}) {
  const [draft, setDraft] = useState<MemoryProfile>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY, ...memory });
      setSaved(false);
    }
  }, [open, memory]);

  const initials = (userName || userEmail || "G").trim().charAt(0).toUpperCase();

  return (
    <ModalShell open={open} onClose={onClose} title="Profile" subtitle={isGuest ? "Guest session — sign in to sync everything." : "Your account and personalization."} width={520}>
      {/* identity */}
      <div className="flex items-center gap-4 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-14 w-14 rounded-full border object-cover" style={{ borderColor: "var(--border)" }} />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full text-[20px] font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{isGuest ? "Guest" : userName || "Credon user"}</p>
          <p className="truncate text-[13px]" style={{ color: "var(--text-dim)" }}>
            {isGuest ? "Local only — nothing synced" : userEmail}
          </p>
          {!isGuest && (
            <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
              Free plan · unlimited chats
            </span>
          )}
        </div>
        {isGuest && (
          <a href="/login" className="ml-auto shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-medium text-white transition-transform hover:-translate-y-px" style={{ background: "var(--accent)" }}>
            Sign in
          </a>
        )}
      </div>

      {/* memory editor */}
      {!isGuest && (
        <>
          <SectionLabel>Personal memory</SectionLabel>
          <p className="!mt-0 mb-3 text-[12.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Credon folds these details into every answer so you never repeat yourself.
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Your name" />
            <Field label="Role" value={draft.role} onChange={(v) => setDraft({ ...draft, role: v })} placeholder="Student, founder…" />
            <Field label="Subjects" value={draft.subjects} onChange={(v) => setDraft({ ...draft, subjects: v })} placeholder="DSA, DBMS, physics…" />
            <Field label="Language" value={draft.language} onChange={(v) => setDraft({ ...draft, language: v })} placeholder="English / Hinglish" />
          </div>
          <div className="mt-2.5">
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-dim)" }}>
              Anything else Credon should know
            </label>
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Preparing for placements at service companies; prefer short answers with code examples…"
              className="w-full resize-none rounded-xl border px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[rgba(224,129,88,0.5)] placeholder:text-[var(--text-faint)]"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
            />
          </div>

          <button
            onClick={() => {
              onSaveMemory(draft);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            }}
            className="mt-4 flex h-10 items-center justify-center gap-2 rounded-xl text-[13.5px] font-medium text-white transition-all hover:-translate-y-px"
            style={{ background: saved ? "var(--ok)" : "var(--accent)" }}
          >
            {saved ? "Saved ✓" : "Save memory"}
          </button>
        </>
      )}
    </ModalShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-dim)" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border px-3.5 text-[13.5px] outline-none transition-colors focus:border-[rgba(224,129,88,0.5)] placeholder:text-[var(--text-faint)]"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
      />
    </div>
  );
}
