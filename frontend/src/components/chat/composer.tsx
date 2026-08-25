"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@/lib/api";
import {
  applyCommand,
  deletePrompt,
  loadPrompts,
  savePrompt,
  SLASH_COMMANDS,
  type SavedPrompt,
} from "@/lib/slash";
import {
  IconAgent,
  IconBook,
  IconBrain,
  IconChevronDown,
  IconFile,
  IconGlobe,
  IconImage,
  IconMic,
  IconPlus,
  IconSend,
  IconSparkle,
  IconStop,
  IconTrash,
  IconX,
} from "./icons";

export type ChatMode = "chat" | "think" | "agent";

const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: "chat", label: "Chat", hint: "Fast, everyday answers" },
  { id: "think", label: "Think", hint: "Deeper step-by-step reasoning" },
  { id: "agent", label: "Agent", hint: "Plans, researches, writes & runs code" },
];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  mode,
  onModeChange,
  web,
  onWebChange,
  models,
  selectedModel,
  onSelectModel,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  onPreviewAttachment,
  uploading,
  uploadStatus,
  listening,
  onVoiceTap,
  voiceEnabled,
  onVoiceToggle,
  onNotify,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  web: boolean;
  onWebChange: (v: boolean) => void;
  models: ModelInfo[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  attachments: { file: File; kind: "image" | "pdf"; text?: string }[];
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
  onPreviewAttachment: (index: number) => void;
  uploading: boolean;
  uploadStatus: string | null;
  listening: boolean;
  onVoiceTap: () => void;
  voiceEnabled: boolean;
  onVoiceToggle: () => void;
  onNotify: (msg: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    setPrompts(loadPrompts());
  }, [promptLibOpen]);

  // slash menu state: typing "/word" at position 0
  useEffect(() => {
    const match = value.match(/^\/([a-z]*)$/i);
    setSlashQuery(match ? match[1].toLowerCase() : null);
  }, [value]);

  useEffect(() => {
    if (!streaming) return;
    setModelMenuOpen(false);
    setPlusOpen(false);
  }, [streaming]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) onSend();
    }
    if (e.key === "Escape") {
      setPlusOpen(false);
      setModelMenuOpen(false);
      setPromptLibOpen(false);
    }
  }

  function pickCommand(index: number) {
    const matches = SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(slashQuery || ""));
    const cmd = matches[index];
    if (!cmd) return;
    const rest = value.replace(/^\/[a-z]*/i, "").trim();
    onChange(applyCommand(cmd, rest));
    textareaRef.current?.focus();
  }

  const slashMatches = slashQuery !== null
    ? SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(slashQuery))
    : [];
  const activeModel = models.find((m) => m.id === selectedModel);

  return (
    <div
      className="mx-auto w-full max-w-3xl px-4"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      {uploadStatus && (
        <p className="anim-fade-in mb-2 text-center text-[12px]" style={{ color: "var(--accent-text)" }}>
          {uploadStatus}
        </p>
      )}

      <div
        className="rounded-2xl border shadow-lg transition-colors focus-within:border-[var(--border-strong)]"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {/* attachment chips */}
        {(attachments.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
            {attachments.map((att, i) => (
              <button
                key={`${att.file.name}-${i}`}
                onClick={() => onPreviewAttachment(i)}
                className="anim-scale-in group/chip inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors hover:border-[var(--border-strong)]"
                style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-dim)" }}
                title="Click to preview"
              >
                {att.kind === "image" ? <IconImage size={13} /> : <IconFile size={13} />}
                <span className="truncate">{att.file.name}</span>
                {att.text && <span style={{ color: "var(--ok)", fontSize: 10 }}>read</span>}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAttachment(i);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && onRemoveAttachment(i)}
                  className="ml-0.5 rounded p-0.5 hover:bg-white/10"
                  style={{ color: "var(--text-faint)" }}
                >
                  <IconX size={11} />
                </span>
              </button>
            ))}
            {uploading && (
              <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px]" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                Reading…
              </span>
            )}
          </div>
        )}

        {/* slash command menu */}
        {slashMatches.length > 0 && (
          <div
            className="anim-scale-in mx-3 mt-3 overflow-hidden rounded-xl border"
            style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)" }}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-faint)" }}>
              Commands
            </p>
            {slashMatches.slice(0, 5).map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => pickCommand(i)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span style={{ color: "var(--accent-text)", width: 16 }}>{cmd.icon}</span>
                <span className="font-mono text-[12.5px]" style={{ color: "var(--text)" }}>{cmd.name}</span>
                <span className="truncate text-[12px]" style={{ color: "var(--text-faint)" }}>{cmd.hint}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={
            mode === "agent"
              ? "Give Credon a goal — it will plan and execute…"
              : value.startsWith("/")
                ? ""
                : "Ask anything — or type / for commands"
          }
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-[var(--text-faint)]"
          style={{ color: "var(--text)" }}
        />

        {/* bottom bar */}
        <div className="flex items-center gap-1 px-2 pb-2.5">
          {/* + menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPlusOpen((v) => !v)}
              aria-label="Add files and more"
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-white/[0.05]"
              style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
            >
              <IconPlus size={16} />
            </button>
            {plusOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setPlusOpen(false)} />
                <div
                  className="anim-scale-in absolute bottom-full left-0 z-40 mb-2 w-64 origin-bottom-left overflow-hidden rounded-xl border shadow-xl"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)", boxShadow: "var(--shadow-pop)" }}
                >
                  {[
                    { icon: <IconFile size={15} />, label: "Upload PDF", action: () => fileInputRef.current?.click() },
                    { icon: <IconImage size={15} />, label: "Upload image", action: () => imageInputRef.current?.click() },
                    { icon: <IconBook size={15} />, label: "Prompt library", action: () => { setPlusOpen(false); setPromptLibOpen(true); } },
                    { icon: <IconSparkle size={15} />, label: "Save current as prompt", action: () => {
                      if (value.trim()) {
                        savePrompt("", value.trim());
                        onNotify("Prompt saved to library");
                      }
                      setPlusOpen(false);
                    } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.action(); }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.04]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept="application/pdf,.pdf"
            onChange={(e) => { onAttachFiles(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={imageInputRef}
            type="file"
            hidden
            multiple
            accept="image/*,.png,.jpg,.jpeg,.webp"
            onChange={(e) => { onAttachFiles(e.target.files); e.target.value = ""; }}
          />

          {/* mode segmented control */}
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full border p-0.5"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          >
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onModeChange(m.id)}
                  title={m.hint}
                  aria-label={m.label}
                  className={`flex items-center justify-center rounded-full transition-all sm:gap-1.5 sm:px-2.5 ${
                    active ? "px-2.5" : "px-2"
                  } ${active ? "py-1" : "py-1"}`}
                  style={
                    active
                      ? { background: "var(--accent)", color: "#fff", minWidth: 28, height: 24 }
                      : { color: "var(--text-dim)", minWidth: 28, height: 24 }
                  }
                >
                  {m.id === "agent" && <IconAgent size={12} />}
                  {m.id === "think" && <IconBrain size={12} />}
                  {m.id === "chat" && <IconSparkle size={12} />}
                  <span className="hidden text-[12px] font-medium sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* web toggle */}
          <button
            onClick={() => onWebChange(!web)}
            title="Live web search"
            aria-pressed={web}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all"
            style={{
              borderColor: web ? "rgba(224,129,88,0.45)" : "var(--border)",
              background: web ? "var(--accent-soft)" : "transparent",
              color: web ? "var(--accent-text)" : "var(--text-faint)",
            }}
          >
            <IconGlobe size={15} />
          </button>

          <div className="min-w-0 flex-1" />

          {/* voice toggle (talk-back) */}
          <button
            onClick={onVoiceToggle}
            title={voiceEnabled ? "Voice replies on" : "Voice replies off"}
            aria-pressed={voiceEnabled}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all sm:flex"
            style={{
              borderColor: voiceEnabled ? "rgba(224,129,88,0.45)" : "var(--border)",
              background: voiceEnabled ? "var(--accent-soft)" : "transparent",
              color: voiceEnabled ? "var(--accent-text)" : "var(--text-faint)",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          </button>

          {/* model picker */}
          <div className="relative shrink-0">
            <button
              onClick={() => setModelMenuOpen((v) => !v)}
              disabled={streaming}
              className="flex max-w-[86px] items-center gap-1 rounded-full border px-2 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[var(--border-strong)] disabled:opacity-50 sm:max-w-none sm:px-2.5 sm:text-[12px]"
              style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
            >
              <span className="truncate">{activeModel?.label?.replace("Credon ", "") || "Alpha"}</span>
              <IconChevronDown size={12} />
            </button>
            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setModelMenuOpen(false)} />
                <div
                  className="anim-scale-in absolute bottom-full right-0 z-40 mb-2 w-72 origin-bottom-right overflow-hidden rounded-xl border shadow-xl"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)", boxShadow: "var(--shadow-pop)" }}
                >
                  <p className="border-b px-3.5 pb-2 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                    Credon model family
                  </p>
                  <ul className="max-h-72 overflow-y-auto p-1.5">
                    {models.map((model) => (
                      <li key={model.id}>
                        <button
                          onClick={() => { onSelectModel(model.id); setModelMenuOpen(false); }}
                          className="w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04]"
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-[13px]" style={{ color: model.id === selectedModel ? "var(--accent-text)" : "var(--text)" }}>
                              {model.label}
                            </span>
                            {model.id === selectedModel && <span className="ml-auto" style={{ color: "var(--accent-text)" }}>✓</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                            {model.description}
                          </span>
                        </button>
                      </li>
                    ))}
                    {models.length === 0 && (
                      <li className="px-3 py-2 text-[12.5px]" style={{ color: "var(--text-faint)" }}>
                        Credon Alpha picks the best route automatically.
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>

          {/* mic */}
          <button
            onClick={onVoiceTap}
            title="Voice input"
            aria-label="Voice input"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
            style={{ color: listening ? "var(--accent-text)" : "var(--text-dim)" }}
          >
            <IconMic size={16} />
          </button>

          {/* send / stop */}
          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-105"
              style={{ background: "var(--surface-3)", color: "var(--text)" }}
            >
              <IconStop size={16} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim() || uploading}
              aria-label="Send message"
              className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:scale-105 disabled:opacity-30"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <IconSend size={16} />
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-[11px]" style={{ color: "var(--text-faint)" }}>
        Credon Alpha · can make mistakes
      </p>

      {/* prompt library */}
      {promptLibOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
          <div className="anim-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPromptLibOpen(false)} />
          <div
            className="modal-content anim-scale-in relative flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-2xl sm:max-w-lg sm:rounded-2xl"
            style={{ borderColor: "var(--border-strong)", background: "var(--surface)", boxShadow: "var(--shadow-pop)" }}
          >
            <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="text-[15.5px] font-semibold tracking-tight">Prompt library</h2>
                <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
                  Your saved prompts — tap to use, long-press list to manage
                </p>
              </div>
              <button
                onClick={() => setPromptLibOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05]"
                style={{ color: "var(--text-dim)" }}
              >
                <IconX size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {prompts.length === 0 && (
                <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border-strong)", color: "var(--text-faint)" }}>
                  <p className="text-[13.5px]">No saved prompts yet.</p>
                  <p className="mt-1 text-[12.5px]">Write something great, then + → “Save current as prompt”.</p>
                </div>
              )}
              <ul className="space-y-2">
                {prompts.map((prompt) => (
                  <li key={prompt.id} className="flex items-start gap-2 rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        onChange(prompt.text);
                        setPromptLibOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="block truncate text-[13.5px] font-medium" style={{ color: "var(--text)" }}>
                        {prompt.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px]" style={{ color: "var(--text-faint)" }}>
                        {prompt.text}
                      </span>
                    </button>
                    <button
                      onClick={() => { deletePrompt(prompt.id); setPrompts(loadPrompts()); }}
                      aria-label="Delete prompt"
                      className="mt-0.5 shrink-0 rounded-md p-1.5 hover:bg-white/[0.06]"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {listening && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
          <div className="anim-scale-in flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] shadow-xl" style={{ borderColor: "var(--border-strong)", background: "var(--surface-3)", color: "var(--text)" }}>
            <span className="flex gap-0.5">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              <span className="pulse-dot pulse-dot-2 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              <span className="pulse-dot pulse-dot-3 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            </span>
            Listening…
          </div>
        </div>
      )}
    </div>
  );
}
