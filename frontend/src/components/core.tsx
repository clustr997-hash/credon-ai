"use client";

import {
  FormEvent,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { enableFcmAndGetToken, firebaseAuth, getFcmReadiness } from "@/lib/firebase-client";


/* ─────────────────────────── Types ─────────────────────────── */

export type Source = { title: string; url: string; summary?: string; trust_score?: number | string };

export function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function faviconUrl(url: string): string {
  const domain = getDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function sourceConfidenceLabel(source: Source): string {
  const raw = source.trust_score;
  if (typeof raw === "number") return raw >= 0.75 ? "High confidence" : raw >= 0.5 ? "Medium confidence" : "Check source";
  if (typeof raw === "string" && raw.trim()) return raw;
  return "High confidence";
}

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function splitSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, "Code block.")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/[#*_`>]/g, "").trim())
    .filter(Boolean);
}

export type ImageResult = {
  image_url: string;
  thumbnail: string;
  title: string;
  source_url: string;
};

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  description: string;
  default?: boolean;
};

export type ThinkingStage = "searching" | "evaluating" | "composing" | null;

export type Message = {
  role: "user" | "assistant";
  text: string;
  confidence?: string;
  sources?: Source[];
  images?: ImageResult[];
  thinking?: string;
  thinkDurationSec?: number;
  suggestions?: string[];
  feedback?: "up" | "down";
  timestamp: number;
  streaming?: boolean;
  thinkingStreaming?: boolean;
  replyTo?: string; // WhatsApp-style reply context
  attachments?: { type: "image" | "pdf"; url?: string; name: string }[];
  evaluator?: {
    input_sources?: number;
    selected_sources?: number;
    avg_score?: number;
  };
  metadata?: {
    pinned?: boolean;
    pin_id?: string;
    routing?: { selected_route?: string; reason?: string; score?: number };
    mode?: { code_mode?: boolean; master_mode?: boolean };
    evaluator?: Record<string, unknown>;
    agent_plan?: { intent?: string; agents?: string[]; reason?: string; mode?: Record<string, boolean> };
    agent?: string;
    tools?: string[];
    freshness?: string;
    chart?: { type?: string; title?: string; labels?: string[]; values?: number[]; unit?: string };
  };
  variants?: string[];
  activeVariant?: number;
  pinned?: boolean;
};

export function isPinnedMessage(message: Message): boolean {
  return message.pinned === true || message.metadata?.pinned === true || Boolean(message.metadata?.pin_id);
}

export function preservePinnedMessagesOnEdit(messages: Message[], editingIndex: number): Message[] {
  const keptHistory = messages.slice(0, editingIndex);
  const pinnedFromRemovedBranch = messages
    .slice(editingIndex)
    .filter(isPinnedMessage)
    .map((message) => ({ ...message, streaming: false, thinkingStreaming: false }));

  return [...keptHistory, ...pinnedFromRemovedBranch];
}

export type FeedbackCategory = "irrelevant" | "incorrect" | "too_slow" | "too_long" | "other";

export type PendingAttachment = {
  file: File;
  kind: "image" | "pdf";
  preview?: string;
};

export type SessionSummary = {
  session_id: string;
  last_updated: string;
  message_count: number;
  preview: string;
};

export type AuthTab = "signin" | "signup" | "forgot";

export type EditableMemoryProfile = {
  name: string;
  role: string;
  subjects: string;
  language: string;
  style: string;
  notes: string;
};

export const EMPTY_MEMORY_PROFILE: EditableMemoryProfile = {
  name: "",
  role: "",
  subjects: "",
  language: "",
  style: "",
  notes: "",
};

/* ─────────────────────────── Constants ─────────────────────────── */

export function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE?.trim();
  const productionApi = "https://credon-ai-backend.onrender.com";

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const runningLocally = hostname === "localhost" || hostname === "127.0.0.1";

    if (!runningLocally && (!configured || /localhost|127\.0\.0\.1/i.test(configured))) {
      return productionApi;
    }
  }

  return configured || "http://localhost:8000";
}

export const API = resolveApiBase();
export const GREET =
  "Hi! I\u2019m **Credon AI** \u2014 your intelligent assistant. Ask me anything \u2014 I can search the web, solve math, analyze images, and think through complex topics. Try me!";

export const LOCAL_TRENDING_PROMPTS = [
  "What are the biggest AI trends to watch this week?",
  "Explain AI agents in simple words",
  "How is generative AI changing jobs in 2026?",
  "What should students learn for future tech careers?",
  "What is quantum computing and why does it matter?",
  "How does machine learning power recommendation apps?",
  "What are the latest cybersecurity risks with AI?",
  "Explain climate tech trends simply",
  "How can I use AI tools for studying ethically?",
  "What is multimodal AI?",
  "What are the most useful coding skills right now?",
  "Explain space technology breakthroughs in simple words",
];

export const ANSWER_STYLES = ["Simple", "Balanced", "Expert", "Research Paper"] as const;
export type ProductMode = "Student" | "Developer" | "Founder" | "Researcher" | "Business";
export type AnswerStyle = typeof ANSWER_STYLES[number];


export function inferIntentLabel(text: string, message?: Message): string {
  const q = text.toLowerCase();
  if (message?.images?.length || /\b(show|image|photo|picture|visual)\b/.test(q)) return "Vision / image mode selected";
  if (message?.sources?.length || /\b(latest|today|current|news|source|research|web)\b/.test(q)) return "Research mode selected";
  if (/```|\b(code|debug|function|typescript|python|react|api|error)\b/.test(q)) return "Coding mode selected";
  if (/\b(compare|versus| vs |difference|table)\b/.test(q)) return "Comparison mode selected";
  if (/\b(step|plan|how to|checklist|guide)\b/.test(q)) return "Step-by-step mode selected";
  if (/\b(create|write|draft|idea|story|caption)\b/.test(q)) return "Creative mode selected";
  return "Balanced answer mode selected";
}

export function contextBadges(message: Message): string[] {
  const badges: string[] = [];
  if (message.replyTo || message.metadata?.agent_plan?.mode?.memory) badges.push("Previous conversation");
  if (message.attachments?.length || message.metadata?.agent_plan?.mode?.file_extraction) badges.push("Uploaded files");
  if (message.metadata?.agent_plan?.mode?.web || (message.sources?.length ?? 0) > 0) badges.push("Web sources");
  if (message.metadata?.agent_plan?.intent) badges.push("Current topic");
  return badges.slice(0, 3);
}

export function randomLocalPrompts(count = 4): string[] {
  const pool = [...LOCAL_TRENDING_PROMPTS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Auto-detect the user's intent persona from their message (replaces the manual chips). */
export function detectProductMode(text: string): ProductMode {
  const q = text.toLowerCase();
  if (/```|\b(code|coding|debug|function|bug|api|typescript|javascript|python|react|node|java|sql|programming|algorithm|compile|runtime|stack ?trace|syntax|exception|error)\b/.test(q)) return "Developer";
  if (/\b(startup|founder|fundrais\w*|investors?|pitch|mvp|revenue|customers?|go[- ]to[- ]market|product[- ]market|monetiz\w*|valuation)\b/.test(q)) return "Founder";
  if (/\b(research|paper|thesis|dissertation|citations?|literature review|methodology|hypothesis|peer[- ]review\w*|journal|dataset|experiment)\b/.test(q)) return "Researcher";
  if (/\b(market\w*|company|industry|profit|sales|finance|financial|strategy|competitors?|b2b|enterprise|roi)\b/.test(q)) return "Business";
  return "Student";
}


export function userFriendlyFcmStatus(reason?: string): string {
  const normalized = (reason || "").toLowerCase();
  if (!reason) return "Notifications are currently unavailable.";
  if (normalized.includes("not configured") || normalized.includes("vapid") || normalized.includes("firebase")) {
    return "Notifications are not available right now. Setup is still being completed.";
  }
  if (normalized.includes("browser runtime")) {
    return "Notifications are available in browser mode only.";
  }
  if (normalized.includes("does not support") || normalized.includes("service worker")) {
    return "This browser currently does not support notifications for this app.";
  }
  if (normalized.includes("permission") && normalized.includes("denied")) {
    return "Notification permission is blocked. Enable it in browser settings to continue.";
  }
  return "Notifications are temporarily unavailable. Please try again shortly.";
}

/* ─────────────────────────── Helpers ─────────────────────────── */

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff =
    today.getTime() -
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (diff <= 0) return "Today";
  if (diff <= 86_400_000) return "Yesterday";
  if (diff <= 7 * 86_400_000) return "Previous 7 days";
  return "Older";
}

export function cleanFirebaseError(msg: string): string {
  const raw = msg.replace("Firebase: ", "").trim();
  const codeMatch = raw.match(/\(auth\/([^)]+)\)/);
  const code = codeMatch?.[1] ?? "";

  const mapped: Record<string, string> = {
    "invalid-credential": "Invalid email or password.",
    "invalid-email": "Please enter a valid email address.",
    "email-already-in-use": "This email is already registered. Please sign in.",
    "weak-password": "Password is too weak. Use at least 6 characters.",
    "user-not-found": "No account found with this email.",
    "wrong-password": "Invalid email or password.",
    "popup-closed-by-user": "Google sign-in popup was closed before completion.",
    "unauthorized-domain": "This domain is not authorized in Firebase Auth.",
    "network-request-failed": "Network error. Please check your internet connection.",
    "too-many-requests": "Too many attempts. Please wait and try again.",
  };

  if (code && mapped[code]) return mapped[code];

  const cleaned = raw.replace(/\(auth\/.*?\)/g, "").trim();
  if (!cleaned || cleaned === ".") {
    return "Authentication failed. Please verify Firebase setup and credentials.";
  }
  return cleaned;
}

export function createGuestId(): string {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return `guest-${webCrypto.randomUUID().slice(0, 8)}`;
  }

  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const arr = new Uint32Array(2);
    webCrypto.getRandomValues(arr);
    const token = `${arr[0].toString(16)}${arr[1].toString(16)}`.slice(0, 8);
    return `guest-${token}`;
  }

  return `guest-${Math.random().toString(16).slice(2, 10)}`;
}

export function newSessionId(): string {
  return `session-${Date.now()}`;
}

/** Extract follow-up suggestions from the assistant message */
export function extractFollowUps(text: string): string[] {
  const lines = text.split("\n");
  const suggestions: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/want to explore|follow.?up|dig deeper|learn more|also want to know|might also/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      const match = line.match(/^(?:\d+\.|[-*])\s*\**(.+?)\**\s*$/);
      if (match) {
        suggestions.push(match[1].replace(/\*\*/g, "").trim());
      } else if (line.trim() === "") {
        if (suggestions.length > 0) break;
      }
    }
  }
  return suggestions.slice(0, 3);
}

export function isCodeLike(text: string): boolean {
  if (!text.trim()) return false;
  if (text.includes("```")) return true;
  return /(\b#include\b|\bdef\s+\w+\(|\bfunction\s+\w+\(|\bclass\s+\w+|\bint\s+main\s*\(|\bconsole\.log\b|\bSELECT\b|\bpublic\s+static\s+void\s+main\b)/i.test(text);
}

export function extractMainPoints(text: string): string[] {
  const clean = stripSuggestionSection(text).replace(/\r/g, "").trim();
  if (!clean) return [];

  const bulletMatches = clean
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line.length > 25);
  if (bulletMatches.length >= 2) {
    return bulletMatches.slice(0, 3);
  }

  const sentencePoints = clean
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.replace(/\*\*/g, "").trim())
    .filter((line) => line.length >= 35 && line.length <= 220)
    .slice(0, 3);
  return sentencePoints;
}

export function isObjectiveQuestionPrompt(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\b(true\s*\/\s*false|true or false|t\/f)\b/.test(q) ||
    /\b(mcq|multiple choice|choose (the )?(correct|best) option|options?:\s*[a-d1-4])\b/.test(q)
  );
}

/** Strip the "You might also want to know" suggestion section from answer text
 *  so it doesn't appear duplicated when structured suggestion chips are shown. */
export function stripSuggestionSection(text: string): string {
  // Remove "You might also want to know" section in all formatting variants
  // Handles: plain, **bold**, with/without colon, dashes/numbers before items
  const patterns = [
    /\n*\*{0,2}You might also want to know:?\*{0,2}\s*\n[\s\S]*$/i,
    /\n*#{1,3}\s*You might also want to know:?\s*\n[\s\S]*$/i,
    /\n*You might also want to know:?\s*\n[\s\S]*$/i,
    /\n*\*{0,2}Related questions:?\*{0,2}\s*\n[\s\S]*$/i,
    /\n*#{1,3}\s*Related questions:?\s*\n[\s\S]*$/i,
    /\n*Related questions:?\s*\n[\s\S]*$/i,
  ];
  let result = text;
  for (const p of patterns) {
    result = result.replace(p, "");
  }
  return result.trimEnd();
}

export function extractCodeFromPre(children: ReactNode): string {
  if (!isValidElement(children)) return "";
  const childProps = children.props as { children?: ReactNode };
  const codeChild = childProps.children;
  if (Array.isArray(codeChild)) return codeChild.join("").trim();
  return String(codeChild ?? "").trim();
}

/* ─────────────────────────── Chart blocks ─────────────────────────── */

export type ChartDataset = { label: string; data: number[]; color?: string };
export type ParsedChart = {
  type?: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  datasets: ChartDataset[];
};

export const CHART_COLORS = ["#00d2ff", "#7b61ff", "#ff6b6b", "#ffd93d", "#6bcb77"];

/** Parse a fenced ```chart JSON block emitted by the model. */
export function parseChartBlock(text: string): ParsedChart | null {
  const match = text.match(/```chart\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as ParsedChart;
    if (!Array.isArray(parsed.labels) || !Array.isArray(parsed.datasets) || parsed.datasets.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Remove model-emitted ```chart / ```image_search blocks from displayed markdown. */
export function stripSpecialBlocks(text: string): string {
  return text
    .replace(/```chart\s*\n[\s\S]*?```/g, "")
    .replace(/```image_search\s*\n[\s\S]*?```/g, "")
    // drop a trailing unterminated block while still streaming
    .replace(/```(?:chart|image_search)[\s\S]*$/g, "")
    .trimEnd();
}

export function ChartBlock({ chart }: { chart: ParsedChart }) {
  const type: "bar" | "line" | "pie" = chart.type === "line" || chart.type === "pie" ? chart.type : "bar";
  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    chart.datasets.forEach((ds) => {
      row[ds.label] = Number(ds.data[i] ?? 0);
    });
    return row;
  });
  const tooltipStyle = { background: "#1a1a2e", border: "none", borderRadius: 8, fontSize: 12, color: "#fff" };
  const pieKey = chart.datasets[0]?.label ?? "value";

  return (
    <div className="mt-4 w-full rounded-xl border border-stone-200 dark:border-zinc-800/70 bg-zinc-950/50 p-4">
      {chart.title && <p className="mb-2 text-sm text-cyan-700 dark:text-cyan-300">{chart.title}</p>}
      <ResponsiveContainer width="100%" height={240}>
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="name" stroke="#888" fontSize={11} />
            <YAxis stroke="#888" fontSize={11} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chart.datasets.map((ds, i) => (
              <Line key={ds.label} type="monotone" dataKey={ds.label} stroke={ds.color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey={pieKey} nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="name" stroke="#888" fontSize={11} />
            <YAxis stroke="#888" fontSize={11} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chart.datasets.map((ds, i) => (
              <Bar key={ds.label} dataKey={ds.label} fill={ds.color || CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────────────── Credon Logo Component ─────────────────────────── */

export function CredonLogo({ size = 32, animate = false, className = "" }: { size?: number; animate?: boolean; className?: string }) {
  const sizeClass =
    size === 22 ? "w-[22px] h-[22px]" :
    size === 28 ? "w-7 h-7" :
    size === 40 ? "w-10 h-10" :
    "w-8 h-8";

  return (
    <div className={`relative ${sizeClass} ${className}`}>
      <Image
        src="/credon-logo.svg"
        alt="Credon AI"
        width={size}
        height={size}
        unoptimized
        className={animate ? "animate-logo-pulse" : ""}
      />
      {animate && (
        <div className="absolute inset-0 rounded-full bg-cyan-400/20 animate-ping animate-ping-slow" />
      )}
    </div>
  );
}

/* ─────────────────────────── Progress Dots (like Claude) ─────────────────────────── */


export function CredonLoadingLogo({ label = "Credon is thinking" }: { label?: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center shrink-0 overflow-hidden shadow-md shadow-cyan-500/15"
      aria-label={label}
      role="status"
    >
      <CredonLogo size={22} className="animate-[spin_1.5s_linear_infinite,pulse_1s_ease-in-out_infinite] [animation-timing-function:linear]" />
    </div>
  );
}

export function ProgressDots({ stage }: { stage: ThinkingStage }) {
  const labels: Record<string, string> = {
    searching: "Searching web… reading sources",
    evaluating: "Evaluating evidence and route",
    composing: "Writing structured answer",
  };

  return (
    <div className="flex gap-3 items-start">
      <CredonLoadingLogo label="Credon is preparing an answer" />
      <div className="bg-stone-200 dark:bg-zinc-800/80 border border-stone-300/70 dark:border-zinc-700/40 rounded-2xl rounded-tl-md px-5 py-4 max-w-sm">
        <div className="flex items-center gap-3">
          {/* Animated dots that cycle 1→2→3→1 */}
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite]" />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.2s]" />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.4s]" />
          </div>
          <span className="text-sm text-stone-700 dark:text-zinc-300">
            {stage ? labels[stage] || "Thinking" : "Thinking"}
          </span>
        </div>
        {/* Stage progress bar */}
        <div className="flex items-center gap-1.5 mt-2">
          {(["searching", "evaluating", "composing"] as const).map((s) => {
            const stages = ["searching", "evaluating", "composing"];
            const current = stage ? stages.indexOf(stage) : -1;
            const idx = stages.indexOf(s);
            return (
              <div
                key={s}
                className={`h-1 rounded-full transition-all duration-500 ${
                  idx <= current
                    ? "w-8 bg-linear-to-r from-cyan-400 to-blue-500"
                    : "w-6 bg-stone-400 dark:bg-zinc-700"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Thinking Block (DeepSeek-style) ─────────────────────────── */

export function ThinkingBlock({ thinking, durationSec, streaming }: { thinking: string; durationSec?: number; streaming?: boolean }) {
  const [collapsed, setCollapsed] = useState(!streaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live seconds counter while streaming — reset + start/stop in one effect
  useEffect(() => {
    if (streaming) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setLiveSeconds(Math.round((Date.now() - start) / 1000));
      }, 500);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [streaming]);

  // Auto-scroll thinking content when streaming
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinking, streaming]);

  if (!thinking) return null;

  const displaySeconds = streaming ? liveSeconds : (durationSec ?? 0);

  return (
    <div className="mb-2">
      {/* DeepSeek-style header: "Thought for X seconds" */}
      <button type="button" onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-xs group"
      >
        {/* Sparkle icon */}
        <svg className="w-4 h-4 text-stone-500 dark:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
        <span className="text-stone-500 dark:text-zinc-400">
          {streaming
            ? <>Thinking<span className="animate-dot-1 inline-block">.</span><span className="animate-dot-2 inline-block">.</span><span className="animate-dot-3 inline-block">.</span> <span className="text-stone-500 dark:text-zinc-500">{liveSeconds}s</span></>
            : <>Thought for <span className="text-stone-700 dark:text-zinc-300">{displaySeconds} seconds</span></>}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-stone-500 dark:text-zinc-500 group-hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* Thinking content — collapsed by default for finished, open for streaming */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="mt-2 text-[13px] text-stone-500 dark:text-zinc-400/80 border-l-2 border-stone-300/80 dark:border-zinc-700/50 pl-4 ml-2 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto"
        >
          {thinking}
          {streaming && <span className="animate-cursor" />}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Flow Timeline ─────────────────────────── */

export function FlowTimeline({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const route = message.metadata?.routing;
  if (!route?.selected_route && !message.sources?.length && !message.confidence) return null;

  const routeLabel: Record<string, string> = {
    greeting_shortcut: "Greeting",
    memory_shortcut: "Memory",
    personal_fallback: "Personal",
    realtime_shortcut: "Real-time",
    weather_agent: "Weather Agent",
    weather_agent_stream: "Weather Agent",
    news_agent: "News Agent",
    news_agent_stream: "News Agent",
    instant_mode: "Instant",
    credon_answer: "Brain",
    credon_answer_stream: "Brain",
    credon_answer_fallback: "Brain Fallback",
    model_generation: "AI Model",
    model_generation_stream: "AI Model",
    followup_generation: "Follow-up",
    error_recovery_stream: "Recovery",
  };

  const steps: { label: string; detail?: string; icon: string }[] = [];

  // Step 1: Route
  if (route?.selected_route) {
    steps.push({ label: routeLabel[route.selected_route] || route.selected_route, detail: route.reason, icon: "route" });
  }

  // Step 2: Sources
  if (message.sources && message.sources.length > 0) {
    steps.push({ label: `${message.sources.length} source${message.sources.length > 1 ? "s" : ""}`, icon: "source" });
  }

  // Step 3: Evaluator
  if (message.evaluator && (message.evaluator.input_sources ?? 0) > 0) {
    steps.push({ label: `Evaluated ${message.evaluator.selected_sources}/${message.evaluator.input_sources}`, detail: "Quality checked", icon: "eval" });
  }

  // Step 4: Thinking
  if (message.thinking) {
    steps.push({ label: `Thought${message.thinkDurationSec ? ` ${message.thinkDurationSec}s` : ""}`, icon: "think" });
  }

  // Step 5: Confidence
  if (message.confidence) {
    const confColor = message.confidence === "high" ? "text-emerald-400" : message.confidence === "medium" ? "text-amber-400" : "text-rose-400";
    steps.push({ label: message.confidence, detail: "confidence", icon: confColor });
  }

  if (steps.length === 0) return null;

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition group">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
        <span>Reasoning / Flow</span>
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="mt-1.5 ml-1 flex flex-col gap-0">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 relative">
              <div className="flex flex-col items-center">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  step.icon === "route" ? "bg-cyan-500" :
                  step.icon === "source" ? "bg-blue-500" :
                  step.icon === "eval" ? "bg-amber-500" :
                  step.icon === "think" ? "bg-purple-500" :
                  step.icon.startsWith("text-") ? step.icon.replace("text-", "bg-") :
                  "bg-zinc-600"
                }`} />
                {i < steps.length - 1 && <div className="w-px h-4 bg-stone-400 dark:bg-zinc-700/50" />}
              </div>
              <div className="pb-1">
                <span className="text-[11px] text-stone-700 dark:text-zinc-300">{step.label}</span>
                {step.detail && <span className="text-[10px] text-stone-500 dark:text-zinc-500 ml-1.5">{step.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


export function AgentInsightCard({ message }: { message: Message }) {
  const plan = message.metadata?.agent_plan;
  const chart = message.metadata?.chart;
  const tools = message.metadata?.tools;
  if (!plan && !chart && !tools?.length) return null;

  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-500/5 p-3 text-xs text-stone-700 dark:text-zinc-300">
      {plan && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-cyan-700 dark:text-cyan-200">Credon Manager</p>
            {plan.intent && <span className="rounded-full bg-stone-100/90 dark:bg-zinc-900/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-500 dark:text-zinc-400">{plan.intent}</span>}
          </div>
          {plan.agents && plan.agents.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.agents.map((agent) => (
                <span key={agent} className="rounded-full border border-cyan-400/20 bg-zinc-950/50 px-2 py-1 text-[11px] text-stone-800 dark:text-zinc-200">{agent}</span>
              ))}
            </div>
          )}
          {plan.reason && <p className="mt-2 text-[11px] text-stone-500 dark:text-zinc-500">{plan.reason}</p>}
        </div>
      )}
      {tools && tools.length > 0 && (
        <p className="mt-2 text-[11px] text-stone-500 dark:text-zinc-500">Free tools used: {tools.join(", ")}</p>
      )}
      {chart?.values && chart.values.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-medium text-stone-500 dark:text-zinc-400">{chart.title || "Chart"}</p>
          <div className="flex h-24 items-end gap-1.5 rounded-xl border border-stone-200 dark:border-zinc-800/80 bg-zinc-950/45 px-2 py-2">
            {chart.values.slice(0, 12).map((value, idx) => (
              <div key={`${chart.labels?.[idx] || idx}-${idx}`} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-linear-to-t from-cyan-500 to-blue-400" style={{ height: `${Math.max(4, Math.min(100, value))}%` }} title={`${chart.labels?.[idx] || idx}: ${value}${chart.unit || ""}`} />
                <span className="text-[9px] text-stone-500 dark:text-zinc-600">{chart.labels?.[idx] || idx + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Image Grid ─────────────────────────── */

export function ImageGrid({ images }: { images: ImageResult[] }) {
  const [selected, setSelected] = useState<ImageResult | null>(null);
  if (!images || images.length === 0) return null;

  return (
    <>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <button
            key={i} type="button" onClick={() => setSelected(img)}
            className="group relative aspect-square rounded-xl overflow-hidden border border-stone-300/60 dark:border-zinc-700/30 hover:border-cyan-500/40 transition"
          >
            <Image
              src={img.thumbnail || img.image_url}
              alt={img.title || "Image result"}
              fill
              sizes="(max-width: 640px) 50vw, 25vw"
              unoptimized
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent p-2">
              <p className="text-[10px] text-stone-900 dark:text-white truncate">{img.title}</p>
              <p className="text-[9px] text-cyan-100/80 truncate">{getDomain(img.source_url)}</p>
            </div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="relative max-w-3xl max-h-[85vh] mx-4" onClick={(e) => e.stopPropagation()}>
            <Image
              src={selected.image_url}
              alt={selected.title || "Selected image"}
              width={1200}
              height={900}
              unoptimized
              className="rounded-xl max-h-[80vh] object-contain w-auto h-auto"
            />
            <button type="button" onClick={() => setSelected(null)} title="Close"
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-stone-900 dark:text-white flex items-center justify-center hover:bg-black/80 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="mt-2 rounded-2xl border border-stone-200 dark:border-zinc-800/80 bg-zinc-950/80 p-3 text-center">
              {selected.title && <p className="text-sm text-stone-800 dark:text-zinc-200">{selected.title}</p>}
              <p className="mt-1 text-xs text-stone-500 dark:text-zinc-500">Source: {getDomain(selected.source_url)}</p>
              <div className="mt-3 flex justify-center gap-2">
                <a href={selected.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-stone-300 dark:border-zinc-700/70 px-3 py-2 text-xs text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200">Open source</a>
                <a href={selected.image_url} target="_blank" rel="noreferrer" download className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-black hover:bg-cyan-300">Save image</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


export function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const visible = open ? sources : sources.slice(0, 3);
  if (!sources.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-stone-200 dark:border-zinc-800/70 bg-zinc-950/35 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-stone-200 dark:hover:bg-stone-100 dark:bg-zinc-900/70 transition"
        aria-expanded={open}
      >
        <div>
          <p className="text-xs font-semibold text-stone-800 dark:text-zinc-200">Sources ({sources.length})</p>
          <p className="text-[11px] text-stone-500 dark:text-zinc-500">Collapsed for faster reading</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-700 dark:text-cyan-200">
          {open ? "Hide" : "Expand"}
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-stone-200 dark:border-zinc-800/60 p-2">
          {visible.map((source, idx) => (
            <a key={`${source.url}-${idx}`} href={source.url} target="_blank" rel="noreferrer" className="group rounded-xl border border-stone-200 dark:border-zinc-800/80 bg-stone-100 dark:bg-zinc-900/55 p-3 transition hover:border-cyan-500/35 hover:bg-stone-200 dark:hover:bg-stone-100/90 dark:bg-zinc-900/80">
              <div className="flex items-start gap-3">
                <Image src={faviconUrl(source.url)} alt="" width={22} height={22} unoptimized className="mt-0.5 h-5.5 w-5.5 rounded" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-stone-900 dark:text-zinc-100 group-hover:text-cyan-100">{source.title || getDomain(source.url)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-zinc-500">
                    <span>{getDomain(source.url)}</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">{sourceConfidenceLabel(source)}</span>
                  </div>
                  {source.summary && <p className="mt-1.5 text-xs leading-relaxed text-stone-500 dark:text-zinc-400">{source.summary}</p>}
                </div>
                <span className="rounded-lg border border-stone-300 dark:border-zinc-700/70 px-2 py-1 text-[11px] text-stone-700 dark:text-zinc-300">Open</span>
              </div>
            </a>
          ))}
          {!open && sources.length > 3 && null}
          {sources.length > 3 && <p className="px-1 pb-1 text-[11px] text-stone-500 dark:text-zinc-500">{open ? "Showing all sources" : `${sources.length - 3} more sources available`}</p>}
        </div>
      )}
    </div>
  );
}


export function TtsPanel({
  sentences,
  activeSentence,
  paused,
  rate,
  voiceLang,
  onPlay,
  onPause,
  onResume,
  onStop,
  onSeek,
  onRate,
  onVoiceLang,
  muted,
  onMuted,
  onClose,
}: {
  sentences: string[];
  activeSentence: number;
  paused: boolean;
  rate: number;
  voiceLang: string;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSeek: (index: number) => void;
  onRate: (rate: number) => void;
  onVoiceLang: (lang: string) => void;
  muted: boolean;
  onMuted: (muted: boolean) => void;
  onClose: () => void;
}) {
  const progress = sentences.length ? Math.round(((activeSentence + 1) / sentences.length) * 100) : 0;
  const voiceOptions = [
    { label: "English US", value: "en-US" },
    { label: "English UK", value: "en-GB" },
    { label: "English India", value: "en-IN" },
    { label: "Hindi", value: "hi-IN" },
    { label: "Hinglish", value: "en-IN" },
  ];
  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/7 p-3 shadow-lg shadow-cyan-950/15">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-cyan-100">Read aloud</p>
          <p className="text-[10px] text-stone-500 dark:text-zinc-500">Voice follows selected language and remembers sound preference.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-stone-500 dark:text-zinc-500 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200" title="Collapse read aloud">Collapse ▲</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={voiceLang} onChange={(e) => onVoiceLang(e.target.value)} className="min-h-10 rounded-xl border border-stone-300 dark:border-zinc-700/60 bg-zinc-950/70 px-2 text-xs text-stone-800 dark:text-zinc-200" title="Voice language">
          {voiceOptions.map((option) => <option key={`${option.label}-${option.value}`} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" onClick={() => onMuted(!muted)} className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${muted ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-stone-300 dark:border-zinc-700/60 text-stone-800 dark:text-zinc-200"}`}>{muted ? "Sound OFF" : "Sound ON"}</button>
        <button type="button" onClick={onPlay} disabled={muted} className="min-h-10 rounded-xl bg-cyan-500 px-3 text-xs font-semibold text-black disabled:opacity-40">Play</button>
        <button type="button" onClick={paused ? onResume : onPause} className="min-h-10 rounded-xl border border-stone-300 dark:border-zinc-700/60 px-3 text-xs text-stone-800 dark:text-zinc-200">{paused ? "Resume" : "Pause"}</button>
        <button type="button" onClick={onStop} className="min-h-10 rounded-xl border border-stone-300 dark:border-zinc-700/60 px-3 text-xs text-stone-800 dark:text-zinc-200">Stop</button>
        <select value={rate} onChange={(e) => onRate(Number(e.target.value))} className="ml-auto min-h-10 rounded-xl border border-stone-300 dark:border-zinc-700/60 bg-zinc-950/70 px-2 text-xs text-stone-800 dark:text-zinc-200" title="Speech speed">
          {[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}x</option>)}
        </select>
      </div>
      <label className="mt-3 block text-[11px] text-stone-500 dark:text-zinc-500">Reading progress: {progress}%</label>
      <input type="range" min={0} max={Math.max(sentences.length - 1, 0)} value={Math.min(activeSentence, Math.max(sentences.length - 1, 0))} onChange={(e) => onSeek(Number(e.target.value))} className="mt-1 w-full accent-cyan-400" aria-label="Seek read aloud sentence" />
      <div className="mt-2 max-h-28 overflow-y-auto space-y-1 text-xs leading-relaxed">
        {sentences.slice(Math.max(0, activeSentence - 1), activeSentence + 3).map((sentence, offset) => {
          const sentenceIndex = Math.max(0, activeSentence - 1) + offset;
          const isActive = sentenceIndex === activeSentence;
          return (
            <button key={`${sentenceIndex}-${sentence.slice(0, 16)}`} type="button" onClick={() => onSeek(sentenceIndex)} className={`block w-full rounded-xl px-2 py-1.5 text-left transition ${isActive ? "bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.22)]" : sentenceIndex < activeSentence ? "text-stone-700 dark:text-zinc-300" : "text-stone-500 dark:text-zinc-500"}`}>
              {sentence}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Settings Modal ─────────────────────────── */

export function SettingsModal({ open, onClose, webSearch, setWebSearch, deepThink, setDeepThink, codeMode, setCodeMode, appearance, setAppearance, fontScale, setFontScale, memoryProfile, setMemoryProfile, clearMemoryProfile, isGuest, onRequireLogin, onDownloadCurrentChat, onDownloadAllChats, onPreviewCurrentChat, onPreviewAllChats, onPreviewSessionPdf, onDownloadSessionPdf, recentSessions, fcmStatus, onEnableNotifications }: {
  open: boolean;
  onClose: () => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
  deepThink: boolean;
  setDeepThink: (v: boolean) => void;
  codeMode: boolean;
  setCodeMode: (v: boolean) => void;
  appearance: "light" | "dark" | "midnight" | "contrast";
  setAppearance: (v: "light" | "dark" | "midnight" | "contrast") => void;
  fontScale: "compact" | "comfortable" | "large";
  setFontScale: (v: "compact" | "comfortable" | "large") => void;
  memoryProfile: EditableMemoryProfile;
  setMemoryProfile: (profile: EditableMemoryProfile) => void;
  clearMemoryProfile: () => void;
  isGuest: boolean;
  onRequireLogin: (feature: "web-search" | "deep-think" | "code-mode") => void;
  onDownloadCurrentChat: () => void;
  onDownloadAllChats: () => void;
  onPreviewCurrentChat: () => void;
  onPreviewAllChats: () => void;
  onPreviewSessionPdf: (sessionId: string) => void;
  onDownloadSessionPdf: (sessionId: string) => void;
  recentSessions: SessionSummary[];
  fcmStatus: string;
  onEnableNotifications: () => void;
}) {
  const [downloadTarget] = useState<"current" | "all">("current");
    void downloadTarget;
  const masterMode = !isGuest && webSearch && deepThink && codeMode;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md px-3 sm:px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="modal-content neo-glass w-full max-w-lg rounded-2xl border border-cyan-400/15 shadow-2xl shadow-black/50 max-h-[92dvh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800/50">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white tracking-tight">Settings</h2>
          <button type="button" onClick={onClose} title="Close" className="text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition p-1 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-6 overflow-y-auto">
          {/* Model Info — no selection, internal routing */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">AI Model</label>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-stone-900 dark:text-white font-bold text-sm shrink-0">C</div>
                <div>
                  <p className="text-sm font-semibold text-stone-900 dark:text-white">Credon Alpha 1</p>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">Multi-model AI with automatic routing &middot; Always picks the best model for your query</p>
                </div>
              </div>
            </div>
          </div>

          {/* Web Search Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-stone-800 dark:text-zinc-200"><span className="text-base" role="img" aria-label="globe">🌐</span> Web Search
                {!isGuest && webSearch && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />Active</span>
                )}
              </p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">Search the internet for up-to-date answers</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isGuest) {
                  onRequireLogin("web-search");
                  return;
                }
                setWebSearch(!webSearch);
              }}
              title={isGuest ? "Sign in to use Web Search" : "Toggle web search"}
              className={`w-11 h-6 rounded-full transition-colors relative ${webSearch ? "bg-cyan-500" : "bg-stone-400 dark:bg-zinc-700"}`}>
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${webSearch ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Deep Think Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-stone-800 dark:text-zinc-200"><span className="text-base" role="img" aria-label="brain">🧠</span> Deep Think
                {!isGuest && deepThink && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-300"><span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />Active — slower</span>
                )}
              </p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">More thorough analysis (may take longer)</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isGuest) {
                  onRequireLogin("deep-think");
                  return;
                }
                setDeepThink(!deepThink);
              }}
              title={isGuest ? "Sign in to use DeepThink" : "Toggle deep think"}
              className={`w-11 h-6 rounded-full transition-colors relative ${deepThink ? "bg-purple-500" : "bg-stone-400 dark:bg-zinc-700"}`}>
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${deepThink ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Code Mode Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-stone-800 dark:text-zinc-200"><span className="text-base font-bold" aria-hidden> &lt;/&gt; </span> Code Mode
                {!isGuest && codeMode && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-300"><span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />Active</span>
                )}
              </p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">Prefer runnable code-first answers</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isGuest) {
                  onRequireLogin("code-mode");
                  return;
                }
                setCodeMode(!codeMode);
              }}
              title={isGuest ? "Sign in to use Code Mode" : "Toggle code mode"}
              className={`w-11 h-6 rounded-full transition-colors relative ${codeMode ? "bg-cyan-500" : "bg-stone-400 dark:bg-zinc-700"}`}
            >
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${codeMode ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>


          <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/60 dark:bg-zinc-900/40 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-stone-800 dark:text-zinc-200">Appearance</p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">Personalize CredonAI without changing the answer engine.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={appearance}
                onChange={(e) => setAppearance(e.target.value as "dark" | "midnight" | "contrast")}
                className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none"
                title="Theme"
              >
                <option value="dark">Dark cyan</option>
                <option value="midnight">Midnight blue</option>
                <option value="contrast">High contrast</option>
              </select>
              <select
                value={fontScale}
                onChange={(e) => setFontScale(e.target.value as "compact" | "comfortable" | "large")}
                className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none"
                title="Answer font size"
              >
                <option value="compact">Compact font</option>
                <option value="comfortable">Comfortable font</option>
                <option value="large">Large font</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-stone-800 dark:text-zinc-200">Editable Memory & Profile</p>
              <p className="text-xs text-stone-500 dark:text-zinc-500">Keep this simple: Credon uses it quietly to personalize answers without adding mode buttons to chat.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={memoryProfile.name} onChange={(e) => setMemoryProfile({ ...memoryProfile, name: e.target.value })} placeholder="Name" className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none" />
              <input value={memoryProfile.role} onChange={(e) => setMemoryProfile({ ...memoryProfile, role: e.target.value })} placeholder="Goal/role, e.g. CSE student" className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none" />
              <input value={memoryProfile.subjects} onChange={(e) => setMemoryProfile({ ...memoryProfile, subjects: e.target.value })} placeholder="Subjects/topics" className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none" />
              <input value={memoryProfile.language} onChange={(e) => setMemoryProfile({ ...memoryProfile, language: e.target.value })} placeholder="Language, e.g. Hinglish" className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none" />
            </div>
            <textarea value={memoryProfile.style} onChange={(e) => setMemoryProfile({ ...memoryProfile, style: e.target.value })} placeholder="How should Credon answer? e.g. direct, creative, exam-focused, with examples" rows={2} className="w-full rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none resize-none" />
            <textarea value={memoryProfile.notes} onChange={(e) => setMemoryProfile({ ...memoryProfile, notes: e.target.value })} placeholder="Extra preferences or things to remember" rows={2} className="w-full rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/70 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 outline-none resize-none" />
            <button type="button" onClick={clearMemoryProfile} className="rounded-lg border border-stone-300 dark:border-zinc-700/60 px-3 py-1.5 text-[11px] text-stone-700 dark:text-zinc-300 hover:border-red-500/40 hover:text-red-200 transition">Clear editable memory</button>
          </div>

          <div className={`rounded-xl border px-3 py-2 ${masterMode ? "border-cyan-500/35 bg-cyan-500/10" : "border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/60 dark:bg-zinc-900/40"}`}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-stone-800 dark:text-zinc-200">Master Mode</p>
              {masterMode && (
                <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-cyan-500 to-purple-500 px-2.5 py-0.5 text-[10px] font-semibold text-stone-900 dark:text-white shadow-sm shadow-cyan-500/30">Master Mode Unlocked ⚡</span>
              )}
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-500 mt-0.5">
              {masterMode
                ? "Active: Web Search + DeepThink + Code Mode. Best for deep coding answers with reasoning and sources."
                : "Turn on Web Search, DeepThink, and Code Mode together to unlock Master Mode."}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-stone-700 dark:text-zinc-300 mb-1">About</h3>
            <p className="text-xs text-stone-500 dark:text-zinc-500 leading-relaxed">
              Credon AI is your intelligent assistant. It combines web search, multi-model reasoning, math solving, and image analysis to give you accurate, well-structured answers.
            </p>
          </div>

          <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/60 dark:bg-zinc-900/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-stone-800 dark:text-zinc-200">Push Notifications</p>
                <p className="text-xs text-stone-500 dark:text-zinc-500 mt-1">{fcmStatus}</p>
              </div>
              <button
                type="button"
                onClick={onEnableNotifications}
                className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-3 py-1.5 text-xs text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 transition"
              >
                Enable
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">Export center</h3>
            <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/60 dark:bg-zinc-900/40 divide-y divide-zinc-800/60">
              {([
                { key: "current" as const, label: "Current chat", hint: "This conversation as a clean PDF" },
                { key: "all" as const, label: "All chats", hint: "Your full history in one PDF" },
              ]).map((row) => (
                <div key={row.key} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-stone-800 dark:text-zinc-200 font-medium">{row.label}</p>
                    <p className="text-[11px] text-stone-500 dark:text-zinc-500 truncate">{row.hint}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void (row.key === "current" ? onPreviewCurrentChat() : onPreviewAllChats()); onClose(); }}
                    className="rounded-lg border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-2.5 py-1.5 text-[11px] text-stone-700 dark:text-zinc-300 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 transition"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => { void (row.key === "current" ? onDownloadCurrentChat() : onDownloadAllChats()); onClose(); }}
                    className="rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-1.5 text-[11px] text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 transition"
                  >
                    PDF
                  </button>
                </div>
              ))}
            </div>

            {recentSessions.length > 0 && (
              <div className="mt-3 rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-zinc-950/45 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500 dark:text-zinc-500 mb-2">Older sessions</p>
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {recentSessions.slice(0, 8).map((session) => (
                    <div key={session.session_id} className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-zinc-800/80 bg-stone-100/80 dark:bg-zinc-900/60 px-2.5 py-1.5">
                      <p className="text-[11px] text-stone-700 dark:text-zinc-300 truncate flex-1 min-w-0">{session.preview || session.session_id}</p>
                      <button
                        type="button"
                        onClick={() => { onPreviewSessionPdf(session.session_id); onClose(); }}
                        className="rounded-md border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-2 py-0.5 text-[10px] text-stone-700 dark:text-zinc-300 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 transition shrink-0"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => { onDownloadSessionPdf(session.session_id); onClose(); }}
                        className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/20 transition shrink-0"
                      >
                        PDF
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 dark:border-zinc-800/50 flex justify-end">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-stone-900 dark:text-white hover:brightness-110 transition shadow-md shadow-cyan-500/15">Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Privacy Modal ─────────────────────────── */

export function PrivacyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="modal-content w-full max-w-lg mx-4 rounded-2xl border border-stone-300/80 dark:border-zinc-700/50 bg-[#111113] shadow-2xl shadow-black/50 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800/50 shrink-0">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Privacy Policy</h2>
          <button type="button" onClick={onClose} title="Close" className="text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition p-1 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4 text-sm text-stone-700 dark:text-zinc-300 leading-relaxed">
          <p><strong className="text-stone-900 dark:text-white">Last updated:</strong> June 2026</p>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">What is stored</h3><p className="text-stone-500 dark:text-zinc-400">Credon stores your account email, chat messages, uploaded knowledge (PDFs and text), your memory profile (topics and preferences), download history, and your profile avatar so your assistant can continue a useful, personalized conversation.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">Memory policy</h3><p className="text-stone-500 dark:text-zinc-400">Credon builds a preference profile from your messages to personalize responses. Current chat context is temporary, recent session topics help continuity, and long-term memory keeps explicit preferences. You can delete your memory profile in Settings.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">File retention</h3><p className="text-stone-500 dark:text-zinc-400">Uploaded PDFs and images are extracted into searchable chunks and stored linked to your account. Deleting a chat or your account removes related messages and uploaded files where supported by the backend.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">Security</h3><p className="text-stone-500 dark:text-zinc-400">We use Firebase Auth, Firestore security rules, and Firebase Storage rules that restrict access to authenticated users only. Your data is protected by industry-standard security.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">AI limitations</h3><p className="text-stone-500 dark:text-zinc-400">AI answers can be wrong or incomplete. Verify medical, legal, financial, and current-event information with trusted sources.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">Your Rights</h3><p className="text-stone-500 dark:text-zinc-400">Delete your account and data anytime. Guest sessions are cleaned up periodically.</p></div>
          <div><h3 className="text-stone-900 dark:text-white font-semibold mb-1">Contact</h3><p className="text-stone-500 dark:text-zinc-400">privacy@credon.ai</p></div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 dark:border-zinc-800 shrink-0 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-stone-200 dark:bg-zinc-800 text-stone-900 dark:text-white hover:bg-stone-300/70 dark:hover:bg-stone-400 dark:bg-zinc-700 transition">Close</button>
        </div>
      </div>
    </div>
  );
}

export function UpdatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="modal-content neo-glass w-full max-w-lg rounded-2xl border border-stone-300/80 dark:border-zinc-700/50 shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800/50 shrink-0">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Updates</h2>
          <button type="button" onClick={onClose} title="Close" className="text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition p-1 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-3 text-sm">
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3">
            <div className="flex items-center gap-2">
              <p className="text-cyan-700 dark:text-cyan-200 font-medium">Version 3.0.0 — Alpha</p>
              <span className="rounded-full bg-stone-100 dark:bg-zinc-900/70 px-2 py-0.5 text-[10px] text-stone-500 dark:text-zinc-400">August 2026</span>
            </div>
            <p className="text-xs text-stone-700 dark:text-zinc-300 mt-1">Agent workspace, Alpha model tiers &amp; continuous learning.</p>
          </div>
          <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/70 dark:bg-zinc-900/50 p-3">
            <p className="text-stone-900 dark:text-white font-medium">What is new</p>
            <ul className="mt-2 space-y-1.5 text-xs text-stone-700 dark:text-zinc-300">
              <li>Agent Workspace: Credon now plans, searches the web, writes files, runs Python, and verifies results — Devin-style.</li>
              <li>Alpha model family: Max (deep orchestration), Lite (fastest), Coder (code-tuned) with automatic failover.</li>
              <li>Continuous learning: Alpha studies in the background and grows its insight store every day.</li>
              <li>New warm editorial design across the app, landing, auth, privacy, and changelog pages.</li>
              <li>Collapsible sidebar on desktop, profile editing, and a cleaner composer.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/70 dark:bg-zinc-900/50 p-3">
            <p className="text-stone-900 dark:text-white font-medium">2.1.0 — August 2026</p>
            <ul className="mt-2 space-y-1.5 text-xs text-stone-500 dark:text-zinc-400">
              <li>Fixed canned replies to real questions; faster first answer via early-exit orchestration.</li>
              <li>Cleaner suggestion chips; retired model aliases auto-track latest versions.</li>
            </ul>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 dark:border-zinc-800/50 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-stone-200 dark:bg-zinc-800 text-stone-900 dark:text-white hover:bg-stone-300/70 dark:hover:bg-stone-400 dark:bg-zinc-700 transition">Close</button>
        </div>
      </div>
    </div>
  );
}

export function DislikeFeedbackModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (category: FeedbackCategory, reason: string) => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("irrelevant");
  const [reason, setReason] = useState("");

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900/90 shadow-2xl">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-white">Help us improve this answer</h3>
          <button type="button" onClick={onClose} className="text-stone-500 dark:text-zinc-500 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200" title="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-stone-500 dark:text-zinc-400 mb-1">What was wrong?</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              title="Feedback category"
              className="w-full rounded-xl border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-3 py-2 text-sm text-stone-900 dark:text-white outline-none focus:border-cyan-500/50"
            >
              <option value="irrelevant">Irrelevant to my question</option>
              <option value="incorrect">Factually incorrect</option>
              <option value="too_slow">Too slow</option>
              <option value="too_long">Too long / verbose</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-zinc-400 mb-1">Short note (optional)</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us what should be better"
              className="w-full rounded-xl border border-stone-300 dark:border-zinc-700/60 bg-stone-200/80 dark:bg-zinc-800/70 px-3 py-2 text-sm text-stone-900 dark:text-white outline-none focus:border-cyan-500/50 resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-stone-200 dark:border-zinc-800/60 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit(category, reason.trim())}
            className="px-4 py-2 rounded-xl text-sm bg-linear-to-r from-cyan-500 to-blue-600 text-stone-900 dark:text-white disabled:opacity-50"
          >
            {busy ? "Sending..." : "Submit feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Auth Page ─────────────────────────── */

export const SUBJECTS = [
  { value: "", label: "Auto-detect" },
  { value: "physics", label: "Physics" },
  { value: "mathematics", label: "Mathematics" },
  { value: "chemistry", label: "Chemistry" },
  { value: "biology", label: "Biology" },
  { value: "computer_science", label: "Computer Science" },
  { value: "engineering", label: "Engineering" },
  { value: "economics", label: "Economics" },
  { value: "history", label: "History" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "medical_science", label: "Medical Science" },
  { value: "law", label: "Law" },
  { value: "commerce", label: "Commerce" },
  { value: "arts_humanities", label: "Arts & Humanities" },
  { value: "environmental_science", label: "Environmental Science" },
];

export const SOURCE_TYPES = [
  { value: "note", label: "Notes" },
  { value: "question_paper", label: "Question Paper" },
  { value: "cheat_sheet", label: "Cheat Sheet" },
  { value: "lecture", label: "Lecture" },
];

export function KnowledgeUploadModal({ open, onClose, uid }: { open: boolean; onClose: () => void; uid: string }) {
  const [tab, setTab] = useState<"text" | "pdf">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [tags, setTags] = useState("");
  const [sourceType, setSourceType] = useState("note");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const reset = () => { setTitle(""); setText(""); setSubject(""); setTags(""); setSourceType("note"); setPdfFile(null); setResult(null); };

  const submitText = async () => {
    if (!text.trim()) return;
    setBusy(true); setResult(null);
    try {
      const resp = await fetch(`${API}/api/v1/ingest/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid,
          text: text.trim(),
          title: title.trim() || "untitled-note",
          subject,
          tags: tags.split(",").map(t => t.trim()).filter(Boolean),
          source_type: sourceType,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        setResult({ ok: true, message: `Uploaded! ${data.chunks || 0} chunks stored. Subject: ${data.detected_subject || "auto"}` });
        reset();
      } else {
        setResult({ ok: false, message: data.error || "Upload failed" });
      }
    } catch { setResult({ ok: false, message: "Network error" }); }
    finally { setBusy(false); }
  };

  const submitPdf = async () => {
    if (!pdfFile) return;
    setBusy(true); setResult(null);
    try {
      const form = new FormData();
      form.append("user_id", uid);
      form.append("file", pdfFile);
      form.append("subject", subject);
      form.append("tags", tags);
      form.append("source_type", sourceType);
      // Keep PDF upload aligned with backend ingest contract.
      const resp = await fetch(`${API}/api/v1/ingest/pdf`, { method: "POST", body: form });
      const data = await resp.json();
      if (data.ok) {
        setResult({ ok: true, message: `Uploaded! ${data.chunks || 0} chunks stored. Subject: ${data.detected_subject || "auto"}` });
        reset();
      } else {
        setResult({ ok: false, message: data.error || "Upload failed" });
      }
    } catch { setResult({ ok: false, message: "Network error" }); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-stone-300 dark:border-zinc-700/60 bg-stone-100 dark:bg-zinc-900 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Upload Knowledge</h2>
          <button type="button" onClick={() => { reset(); onClose(); }} title="Close" className="text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition p-1 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setTab("text")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === "text" ? "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/40" : "bg-stone-200/70 dark:bg-zinc-800/60 text-stone-500 dark:text-zinc-400 border border-stone-300/70 dark:border-zinc-700/40 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300"}`}>
              Paste Text
            </button>
            <button type="button" onClick={() => setTab("pdf")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === "pdf" ? "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/40" : "bg-stone-200/70 dark:bg-zinc-800/60 text-stone-500 dark:text-zinc-400 border border-stone-300/70 dark:border-zinc-700/40 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300"}`}>
              Upload PDF
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Physics Ch-5 Notes"
              className="w-full px-3 py-2 rounded-xl bg-stone-200/70 dark:bg-zinc-800/60 border border-stone-300/70 dark:border-zinc-700/40 text-sm text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-zinc-500 outline-none focus:border-cyan-500/50" />
          </div>

          {/* Subject + Source Type row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">Subject</label>
              <select value={subject} onChange={e => setSubject(e.target.value)} title="Subject"
                className="w-full px-3 py-2 rounded-xl bg-stone-200/70 dark:bg-zinc-800/60 border border-stone-300/70 dark:border-zinc-700/40 text-sm text-stone-900 dark:text-white outline-none focus:border-cyan-500/50">
                {SUBJECTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">Type</label>
              <select value={sourceType} onChange={e => setSourceType(e.target.value)} title="Source type"
                className="w-full px-3 py-2 rounded-xl bg-stone-200/70 dark:bg-zinc-800/60 border border-stone-300/70 dark:border-zinc-700/40 text-sm text-stone-900 dark:text-white outline-none focus:border-cyan-500/50">
                {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">Tags (comma-separated)</label>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. chapter-5, thermodynamics, exam-prep"
              className="w-full px-3 py-2 rounded-xl bg-stone-200/70 dark:bg-zinc-800/60 border border-stone-300/70 dark:border-zinc-700/40 text-sm text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-zinc-500 outline-none focus:border-cyan-500/50" />
          </div>

          {/* Text input or PDF upload */}
          {tab === "text" ? (
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">Content</label>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
                placeholder="Paste your notes, question paper, cheat sheet, or lecture content here..."
                className="w-full px-3 py-2 rounded-xl bg-stone-200/70 dark:bg-zinc-800/60 border border-stone-300/70 dark:border-zinc-700/40 text-sm text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-zinc-500 outline-none focus:border-cyan-500/50 resize-none" />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-zinc-400 mb-1">PDF File</label>
              <input ref={pdfRef} type="file" accept=".pdf" className="hidden" title="Upload PDF" aria-label="Upload PDF"
                onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); e.target.value = ""; }} />
              <button type="button" onClick={() => pdfRef.current?.click()}
                className="w-full px-4 py-6 rounded-xl border-2 border-dashed border-stone-300 dark:border-zinc-700/60 bg-stone-200 dark:bg-zinc-800/30 hover:bg-stone-200/70 dark:hover:bg-stone-200/60 dark:bg-zinc-800/50 transition text-sm text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300">
                {pdfFile ? (
                  <span className="text-cyan-600 dark:text-cyan-400">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</span>
                ) : (
                  <>Click to select a PDF file</>
                )}
              </button>
            </div>
          )}

          {/* Result message */}
          {result && (
            <div className={`px-4 py-3 rounded-xl text-sm ${result.ok ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
              {result.message}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-stone-200 dark:border-zinc-800 shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-stone-500 dark:text-zinc-500">Subject is auto-detected if not selected</p>
          <button type="button" disabled={busy || (tab === "text" ? !text.trim() : !pdfFile)} onClick={tab === "text" ? submitText : submitPdf}
            className="px-5 py-2 text-sm rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-stone-900 dark:text-white hover:brightness-110 transition disabled:opacity-40">
            {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
