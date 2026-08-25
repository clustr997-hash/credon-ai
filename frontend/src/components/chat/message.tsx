"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, Source } from "@/lib/api";
import { domainOf, faviconFor } from "@/lib/api";
import { Markdown } from "./markdown";
import { AgentPanel } from "./agent-panel";
import {
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFile,
  IconGlobe,
  IconPencil,
  IconRefresh,
  IconShare,
  IconSparkle,
  IconThumbDown,
  IconThumbUp,
  IconVolume,
  IconX,
} from "./icons";
import { CredonMark } from "@/components/logo";

const FEEDBACK_REASONS = [
  { id: "incorrect", label: "Incorrect" },
  { id: "irrelevant", label: "Missed the point" },
  { id: "too_long", label: "Too long" },
  { id: "too_slow", label: "Too slow" },
  { id: "other", label: "Something else" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["id"];

function routeChip(message: Message): string | null {
  const meta = message.metadata as Record<string, unknown> | undefined;
  const routing = meta?.routing as { selected_route?: string; reason?: string } | undefined;
  if (!routing?.selected_route) return null;
  const route = routing.selected_route.replace(/_/g, " ");
  const seconds = message.thinkDurationSec;
  const sources = message.sources?.length ?? 0;
  const bits = [route];
  if (seconds) bits.push(`${seconds}s`);
  if (sources) bits.push(`${sources} source${sources > 1 ? "s" : ""}`);
  return bits.join(" · ");
}

function shouldOpenAsArtifact(message: Message): boolean {
  if (!message.text) return false;
  const codeBlocks = (message.text.match(/```/g) || []).length / 2;
  return message.text.length > 2600 || codeBlocks >= 2 || /^##\s+Slide\s/im.test(message.text);
}

/* ── thinking block ── */
function ThinkingBlock({
  thinking,
  durationSec,
  streaming,
}: {
  thinking: string;
  durationSec?: number;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);
  if (!thinking && !streaming) return null;

  return (
    <div className="anim-scale-in mb-3 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left">
        <span className="text-[var(--accent-text)]">
          <IconBrain size={15} />
        </span>
        <span className={`text-[12.5px] font-medium ${streaming ? "shimmer-text" : ""}`} style={streaming ? undefined : { color: "var(--text-dim)" }}>
          {streaming ? "Thinking…" : `Thought for ${durationSec ? `${durationSec}s` : "a moment"}`}
        </span>
        <span className="ml-auto text-[var(--text-faint)]">
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="max-h-52 overflow-y-auto border-t px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
          {thinking || "…"}
          {streaming && <span className="stream-caret" />}
        </div>
      )}
    </div>
  );
}

/* ── sources ── */
function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  const knowledgeSources = sources.filter((source) => source.source_type === "knowledge" || source.url.startsWith("credon://knowledge/"));
  const webSources = sources.filter((source) => !knowledgeSources.includes(source));
  const headerLabel = webSources.length === 0 ? "Knowledge used" : `${sources.length} source${sources.length > 1 ? "s" : ""}`;

  function renderSource(source: Source, i: number, type: "knowledge" | "web") {
    const domain = type === "knowledge" ? "Uploaded knowledge" : domainOf(source.url);
    return (
      <a
        key={`${source.url}-${i}`}
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.03]"
      >
        <span className="mt-0.5 text-[var(--text-dim)]">
          {type === "knowledge" ? <IconFile size={15} /> : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={faviconFor(source.url)} alt="" width={16} height={16} className="rounded-sm" />
            </>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]" style={{ color: "var(--text)" }}>
            {source.title || domain}
          </span>
          <span className="block truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            {domain}
          </span>
        </span>
      </a>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-white/[0.02]">
        <span className="text-[var(--text-dim)]">
          {webSources.length === 0 ? <IconFile size={15} /> : <IconGlobe size={15} />}
        </span>
        <span className="text-[12.5px] font-medium" style={{ color: "var(--text-dim)" }}>
          {headerLabel}
        </span>
        <span className="ml-auto text-[var(--text-faint)]">
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t p-2" style={{ borderColor: "var(--border)" }}>
          {knowledgeSources.length > 0 && (
            <section>
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                Local uploaded knowledge
              </p>
              {knowledgeSources.map((source, i) => renderSource(source, i, "knowledge"))}
            </section>
          )}
          {webSources.length > 0 && (
            <section>
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                Live web results
              </p>
              {webSources.map((source, i) => renderSource(source, i, "web"))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  message,
  index,
  streaming,
  onRegenerate,
  onFeedback,
  onSuggestion,
  onEdit,
  onShare,
  onOpenArtifact,
  onPreviewAttachment,
  onSpeak,
  onSaveTasks,
}: {
  message: Message;
  index: number;
  streaming: boolean;
  onRegenerate?: () => void;
  onFeedback?: (rating: "up" | "down", reason?: string) => void;
  onSuggestion?: (s: string) => void;
  onEdit?: (index: number, newText: string) => void;
  onShare?: (message: Message) => void;
  onOpenArtifact?: (message: Message) => void;
  onPreviewAttachment?: (attachment: { type: "image" | "pdf"; name: string; url?: string }) => void;
  onSpeak?: (message: Message) => void;
  onSaveTasks?: (message: Message) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [showReasons, setShowReasons] = useState(false);
  const [givenFeedback, setGivenFeedback] = useState<"up" | "down" | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setEditText(message.text);
      setTimeout(() => editRef.current?.focus(), 30);
    }
  }, [editing, message.text]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  }

  /* ── user message ── */
  if (message.role === "user") {
    if (editing) {
      return (
        <div className="message-bubble flex justify-end pl-10">
          <div className="w-full max-w-[85%] md:max-w-[75%]">
            <textarea
              ref={editRef}
              value={editText}
              rows={Math.min(8, editText.split("\n").length + 1)}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full resize-none rounded-2xl border px-4 py-3 text-[14.5px] leading-relaxed outline-none"
              style={{ borderColor: "rgba(224,129,88,0.5)", background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium"
                style={{ color: "var(--text-dim)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editText.trim() && editText !== message.text) onEdit?.(index, editText.trim());
                  setEditing(false);
                }}
                className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="message-bubble group flex justify-end pl-10">
        <div className="max-w-[85%] md:max-w-[75%]">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((file, i) => (
                <button
                  key={i}
                  onClick={() => onPreviewAttachment?.(file)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors hover:border-[var(--border-strong)]"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-dim)" }}
                >
                  {file.type === "image" ? <IconImageFallback /> : <IconFile size={12} />}
                  {file.name}
                </button>
              ))}
            </div>
          )}
          {message.replyTo && (
            <p className="mb-1 truncate pr-1 text-right text-[11.5px]" style={{ color: "var(--text-faint)" }}>
              replying to: {message.replyTo}
            </p>
          )}
          <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--accent-soft)", color: "var(--text)" }}>
            {message.text}
          </div>
          {!streaming && onEdit && (
            <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] hover:bg-white/5"
                style={{ color: "var(--text-faint)" }}
              >
                <IconPencil size={12} />
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── assistant message ── */
  const chip = routeChip(message);
  const artifact = shouldOpenAsArtifact(message);

  return (
    <div className="message-bubble group pr-10">
      <div className="mb-2 flex items-center gap-2">
        <CredonMark size={22} />
        <span className="text-[13px] font-semibold tracking-tight">Credon</span>
        {message.confidence && !message.streaming && (
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider"
            style={{
              background: "var(--surface-2)",
              color:
                message.confidence === "high"
                  ? "rgba(74,222,128,0.9)"
                  : message.confidence === "low"
                    ? "rgba(251,191,36,0.9)"
                    : "var(--text-faint)",
            }}
          >
            {message.confidence} confidence
          </span>
        )}
      </div>

      {message.agent && <AgentPanel agent={message.agent} streaming={Boolean(message.streaming)} />}

      <ThinkingBlock
        thinking={message.thinking || ""}
        durationSec={message.thinkDurationSec}
        streaming={Boolean(message.thinkingStreaming)}
      />

      {message.error ? (
        <p className="rounded-xl border px-4 py-3 text-[13.5px]" style={{ borderColor: "rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)", color: "#f87171" }}>
          {message.text}
        </p>
      ) : message.text ? (
        <Markdown content={message.text} />
      ) : null}

      {message.streaming && message.text && <span className="stream-caret" />}

      {artifact && !message.streaming && onOpenArtifact && (
        <button
          onClick={() => onOpenArtifact(message)}
          className="mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[12.5px] font-medium transition-all hover:-translate-y-px"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--accent-text)" }}
        >
          <IconSparkle size={14} />
          Open in workspace
        </button>
      )}

      {!message.streaming && onSaveTasks && /\-\s*\[\s?\]\s/.test(message.text) && (
        <button
          onClick={() => onSaveTasks(message)}
          className="mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[12.5px] font-medium transition-all hover:-translate-y-px"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-dim)" }}
        >
          ☐ Save as tasks
        </button>
      )}

      <SourcesPanel sources={message.sources || []} />

      {message.suggestions && message.suggestions.length > 0 && !message.streaming && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.suggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onSuggestion?.(suggestion)}
              className="rounded-full border px-3 py-1.5 text-[12.5px] transition-all hover:-translate-y-px"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-dim)" }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {!message.streaming && (
        <div className="mt-2 flex items-center gap-1">
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <ActionBtn label={copied ? "Copied" : "Copy"} onClick={copyText}>
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionBtn>
            {onSpeak && (
              <ActionBtn label="Read aloud" onClick={() => onSpeak(message)}>
                <IconVolume size={15} />
              </ActionBtn>
            )}
            {index > 0 && onRegenerate && (
              <ActionBtn label="Regenerate" onClick={onRegenerate}>
                <IconRefresh size={15} />
              </ActionBtn>
            )}
            {onShare && (
              <ActionBtn label="Share" onClick={() => onShare(message)}>
                <IconShare size={15} />
              </ActionBtn>
            )}
            {onFeedback && (
              <>
                <ActionBtn
                  label="Good answer"
                  active={givenFeedback === "up"}
                  onClick={() => {
                    setGivenFeedback("up");
                    onFeedback("up");
                  }}
                >
                  <IconThumbUp size={15} />
                </ActionBtn>
                <ActionBtn
                  label="Needs work"
                  active={givenFeedback === "down"}
                  onClick={() => setShowReasons((v) => !v)}
                >
                  <IconThumbDown size={15} />
                </ActionBtn>
              </>
            )}
          </div>
          {chip && (
            <span
              className="ml-1 hidden font-mono text-[10.5px] tracking-wide opacity-60 transition-opacity group-hover:opacity-100 sm:inline"
              style={{ color: "var(--text-faint)" }}
            >
              {chip}
            </span>
          )}
        </div>
      )}

      {showReasons && onFeedback && (
        <div className="anim-scale-in mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-xl border p-2" style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)" }}>
          <span className="px-1 text-[12px]" style={{ color: "var(--text-faint)" }}>
            What was wrong?
          </span>
          {FEEDBACK_REASONS.map((reason) => (
            <button
              key={reason.id}
              onClick={() => {
                setGivenFeedback("down");
                setShowReasons(false);
                onFeedback("down", reason.id);
              }}
              className="rounded-lg border px-2.5 py-1 text-[12px] transition-all hover:border-[var(--border-strong)]"
              style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
            >
              {reason.label}
            </button>
          ))}
          <button
            onClick={() => setShowReasons(false)}
            aria-label="Cancel"
            className="rounded-lg p-1.5 hover:bg-white/[0.06]"
            style={{ color: "var(--text-faint)" }}
          >
            <IconX size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
      style={{ color: active ? "var(--accent-text)" : "var(--text-faint)" }}
    >
      {children}
    </button>
  );
}

function IconImageFallback() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 3.5 3.5L16 13l4 4" />
    </svg>
  );
}

export function TypingIndicator({ stage }: { stage: string }) {
  return (
    <div className="message-bubble flex items-center gap-2.5 py-1">
      <CredonMark size={22} animate />
      <span className="shimmer-text text-[13.5px]">{stage}</span>
      <span className="flex gap-1">
        <span className="pulse-dot h-1 w-1 rounded-full bg-[var(--accent)]" />
        <span className="pulse-dot pulse-dot-2 h-1 w-1 rounded-full bg-[var(--accent)]" />
        <span className="pulse-dot pulse-dot-3 h-1 w-1 rounded-full bg-[var(--accent)]" />
      </span>
    </div>
  );
}

export function EmptyStateHero({
  name,
  onPick,
  mode,
}: {
  name: string;
  onPick: (q: string) => void;
  mode?: string;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const starters: { icon?: React.ReactNode; label: string; q: string }[] =
    mode === "agent"
      ? [
          { label: "Build a Python expense tracker", q: "Build a simple expense tracker in Python with a CSV storage layer, add/update/list features and a demo run" },
          { label: "Research + write a mini report", q: "Research the current state of solid-state batteries and write a one-page report with sources" },
          { label: "Scrape & analyze a web page", q: "Open https://news.ycombinator.com and summarize the top 5 stories with links" },
          { label: "Make a slide deck", q: "Make a 6-slide deck about the solar system with a '## Slide N:' structure I can export to PPTX" },
        ]
      : [
          { icon: <IconSparkle size={14} />, label: "Explain a concept simply", q: "Explain how transformers work in simple words" },
          { icon: <IconGlobe size={14} />, label: "Research with live sources", q: "What are this week's biggest AI breakthroughs?" },
          { icon: <IconFile size={14} />, label: "Work with my PDFs", q: "Summarize the key points of the document I uploaded" },
          { icon: <IconRefresh size={14} />, label: "Plan something big", q: "Help me plan a 30-day DSA prep schedule for placements" },
        ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-24">
      <CredonMark size={44} animate />
      <h1 className="anim-fade-up mt-6 text-balance text-center font-display text-[32px] leading-tight tracking-tight md:text-[42px]">
        {greeting}{name ? `, ${name}` : ""}.
        <br />
        <em className="italic" style={{ color: "var(--accent-text)" }}>
          {mode === "agent" ? "Give me a goal — I'll handle the rest." : "What should we work on?"}
        </em>
      </h1>
      <div className="anim-fade-up d-2 mt-9 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {starters.map((starter, i) => (
          <button
            key={starter.label}
            onClick={() => onPick(starter.q)}
            className={`suggestion-chip anim-fade-up d-${Math.min(i + 2, 5)} flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-all hover:-translate-y-0.5`}
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-dim)" }}
          >
            <span style={{ color: "var(--accent-text)" }}>{starter.icon ?? "◈"}</span>
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
