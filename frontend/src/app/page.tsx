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
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { enableFcmAndGetToken, firebaseAuth, getFcmReadiness } from "@/lib/firebase-client";

/* ─────────────────────────── Types ─────────────────────────── */

type Source = { title: string; url: string; summary?: string; trust_score?: number | string };

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function faviconUrl(url: string): string {
  const domain = getDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function sourceConfidenceLabel(source: Source): string {
  const raw = source.trust_score;
  if (typeof raw === "number") return raw >= 0.75 ? "High confidence" : raw >= 0.5 ? "Medium confidence" : "Check source";
  if (typeof raw === "string" && raw.trim()) return raw;
  return "High confidence";
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function splitSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, "Code block.")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/[#*_`>]/g, "").trim())
    .filter(Boolean);
}

type ImageResult = {
  image_url: string;
  thumbnail: string;
  title: string;
  source_url: string;
};

type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  description: string;
  default?: boolean;
};

type ThinkingStage = "searching" | "evaluating" | "composing" | null;

type Message = {
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

function isPinnedMessage(message: Message): boolean {
  return message.pinned === true || message.metadata?.pinned === true || Boolean(message.metadata?.pin_id);
}

function preservePinnedMessagesOnEdit(messages: Message[], editingIndex: number): Message[] {
  const keptHistory = messages.slice(0, editingIndex);
  const pinnedFromRemovedBranch = messages
    .slice(editingIndex)
    .filter(isPinnedMessage)
    .map((message) => ({ ...message, streaming: false, thinkingStreaming: false }));

  return [...keptHistory, ...pinnedFromRemovedBranch];
}

type FeedbackCategory = "irrelevant" | "incorrect" | "too_slow" | "too_long" | "other";

type PendingAttachment = {
  file: File;
  kind: "image" | "pdf";
  preview?: string;
};

type SessionSummary = {
  session_id: string;
  last_updated: string;
  message_count: number;
  preview: string;
};

type AuthTab = "signin" | "signup" | "forgot";

/* ─────────────────────────── Constants ─────────────────────────── */

function resolveApiBase(): string {
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

const API = resolveApiBase();
const GREET =
  "Hi! I\u2019m **Credon AI** \u2014 your intelligent assistant. Ask me anything \u2014 I can search the web, solve math, analyze images, and think through complex topics. Try me!";

const LOCAL_TRENDING_PROMPTS = [
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

const ANSWER_STYLES = ["Simple", "Balanced", "Expert", "Research Paper"] as const;
type ProductMode = "Student" | "Developer" | "Founder" | "Researcher" | "Business";
type AnswerStyle = typeof ANSWER_STYLES[number];


function inferIntentLabel(text: string, message?: Message): string {
  const q = text.toLowerCase();
  if (message?.images?.length || /\b(show|image|photo|picture|visual)\b/.test(q)) return "Vision / image mode selected";
  if (message?.sources?.length || /\b(latest|today|current|news|source|research|web)\b/.test(q)) return "Research mode selected";
  if (/```|\b(code|debug|function|typescript|python|react|api|error)\b/.test(q)) return "Coding mode selected";
  if (/\b(compare|versus| vs |difference|table)\b/.test(q)) return "Comparison mode selected";
  if (/\b(step|plan|how to|checklist|guide)\b/.test(q)) return "Step-by-step mode selected";
  if (/\b(create|write|draft|idea|story|caption)\b/.test(q)) return "Creative mode selected";
  return "Balanced answer mode selected";
}

function contextBadges(message: Message): string[] {
  const badges: string[] = [];
  if (message.replyTo || message.metadata?.agent_plan?.mode?.memory) badges.push("Previous conversation");
  if (message.attachments?.length || message.metadata?.agent_plan?.mode?.file_extraction) badges.push("Uploaded files");
  if (message.metadata?.agent_plan?.mode?.web || (message.sources?.length ?? 0) > 0) badges.push("Web sources");
  if (message.metadata?.agent_plan?.intent) badges.push("Current topic");
  return badges.slice(0, 3);
}

function randomLocalPrompts(count = 4): string[] {
  const pool = [...LOCAL_TRENDING_PROMPTS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Auto-detect the user's intent persona from their message (replaces the manual chips). */
function detectProductMode(text: string): ProductMode {
  const q = text.toLowerCase();
  if (/```|\b(code|coding|debug|function|bug|api|typescript|javascript|python|react|node|java|sql|programming|algorithm|compile|runtime|stack ?trace|syntax|exception|error)\b/.test(q)) return "Developer";
  if (/\b(startup|founder|fundrais\w*|investors?|pitch|mvp|revenue|customers?|go[- ]to[- ]market|product[- ]market|monetiz\w*|valuation)\b/.test(q)) return "Founder";
  if (/\b(research|paper|thesis|dissertation|citations?|literature review|methodology|hypothesis|peer[- ]review\w*|journal|dataset|experiment)\b/.test(q)) return "Researcher";
  if (/\b(market\w*|company|industry|profit|sales|finance|financial|strategy|competitors?|b2b|enterprise|roi)\b/.test(q)) return "Business";
  return "Student";
}


function userFriendlyFcmStatus(reason?: string): string {
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

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function dateLabel(iso: string): string {
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

function cleanFirebaseError(msg: string): string {
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

function createGuestId(): string {
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

function newSessionId(): string {
  return `session-${Date.now()}`;
}

/** Extract follow-up suggestions from the assistant message */
function extractFollowUps(text: string): string[] {
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

function isCodeLike(text: string): boolean {
  if (!text.trim()) return false;
  if (text.includes("```")) return true;
  return /(\b#include\b|\bdef\s+\w+\(|\bfunction\s+\w+\(|\bclass\s+\w+|\bint\s+main\s*\(|\bconsole\.log\b|\bSELECT\b|\bpublic\s+static\s+void\s+main\b)/i.test(text);
}

function extractMainPoints(text: string): string[] {
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

function isObjectiveQuestionPrompt(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\b(true\s*\/\s*false|true or false|t\/f)\b/.test(q) ||
    /\b(mcq|multiple choice|choose (the )?(correct|best) option|options?:\s*[a-d1-4])\b/.test(q)
  );
}

/** Strip the "You might also want to know" suggestion section from answer text
 *  so it doesn't appear duplicated when structured suggestion chips are shown. */
function stripSuggestionSection(text: string): string {
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

function extractCodeFromPre(children: ReactNode): string {
  if (!isValidElement(children)) return "";
  const childProps = children.props as { children?: ReactNode };
  const codeChild = childProps.children;
  if (Array.isArray(codeChild)) return codeChild.join("").trim();
  return String(codeChild ?? "").trim();
}

/* ─────────────────────────── Chart blocks ─────────────────────────── */

type ChartDataset = { label: string; data: number[]; color?: string };
type ParsedChart = {
  type?: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  datasets: ChartDataset[];
};

const CHART_COLORS = ["#00d2ff", "#7b61ff", "#ff6b6b", "#ffd93d", "#6bcb77"];

/** Parse a fenced ```chart JSON block emitted by the model. */
function parseChartBlock(text: string): ParsedChart | null {
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
function stripSpecialBlocks(text: string): string {
  return text
    .replace(/```chart\s*\n[\s\S]*?```/g, "")
    .replace(/```image_search\s*\n[\s\S]*?```/g, "")
    // drop a trailing unterminated block while still streaming
    .replace(/```(?:chart|image_search)[\s\S]*$/g, "")
    .trimEnd();
}

function ChartBlock({ chart }: { chart: ParsedChart }) {
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
    <div className="mt-4 w-full rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-4">
      {chart.title && <p className="mb-2 text-sm text-cyan-300">{chart.title}</p>}
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

function CredonLogo({ size = 32, animate = false, className = "" }: { size?: number; animate?: boolean; className?: string }) {
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


function CredonLoadingLogo({ label = "Credon is thinking" }: { label?: string }) {
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

function ProgressDots({ stage }: { stage: ThinkingStage }) {
  const labels: Record<string, string> = {
    searching: "Searching web… reading sources",
    evaluating: "Evaluating evidence and route",
    composing: "Writing structured answer",
  };

  return (
    <div className="flex gap-3 items-start">
      <CredonLoadingLogo label="Credon is preparing an answer" />
      <div className="bg-zinc-800/80 border border-zinc-700/40 rounded-2xl rounded-tl-md px-5 py-4 max-w-sm">
        <div className="flex items-center gap-3">
          {/* Animated dots that cycle 1→2→3→1 */}
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite]" />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.2s]" />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.4s]" />
          </div>
          <span className="text-sm text-zinc-300">
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
                    : "w-6 bg-zinc-700"
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

function ThinkingBlock({ thinking, durationSec, streaming }: { thinking: string; durationSec?: number; streaming?: boolean }) {
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
        <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
        <span className="text-zinc-400">
          {streaming
            ? <>Thinking<span className="animate-dot-1 inline-block">.</span><span className="animate-dot-2 inline-block">.</span><span className="animate-dot-3 inline-block">.</span> <span className="text-zinc-500">{liveSeconds}s</span></>
            : <>Thought for <span className="text-zinc-300">{displaySeconds} seconds</span></>}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* Thinking content — collapsed by default for finished, open for streaming */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="mt-2 text-[13px] text-zinc-400/80 border-l-2 border-zinc-700/50 pl-4 ml-2 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto"
        >
          {thinking}
          {streaming && <span className="animate-cursor" />}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Flow Timeline ─────────────────────────── */

function FlowTimeline({ message }: { message: Message }) {
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
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition group">
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
                {i < steps.length - 1 && <div className="w-px h-4 bg-zinc-700/50" />}
              </div>
              <div className="pb-1">
                <span className="text-[11px] text-zinc-300">{step.label}</span>
                {step.detail && <span className="text-[10px] text-zinc-500 ml-1.5">{step.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function AgentInsightCard({ message }: { message: Message }) {
  const plan = message.metadata?.agent_plan;
  const chart = message.metadata?.chart;
  const tools = message.metadata?.tools;
  if (!plan && !chart && !tools?.length) return null;

  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-500/5 p-3 text-xs text-zinc-300">
      {plan && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-cyan-200">Credon Manager</p>
            {plan.intent && <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{plan.intent}</span>}
          </div>
          {plan.agents && plan.agents.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.agents.map((agent) => (
                <span key={agent} className="rounded-full border border-cyan-400/20 bg-zinc-950/50 px-2 py-1 text-[11px] text-zinc-200">{agent}</span>
              ))}
            </div>
          )}
          {plan.reason && <p className="mt-2 text-[11px] text-zinc-500">{plan.reason}</p>}
        </div>
      )}
      {tools && tools.length > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">Free tools used: {tools.join(", ")}</p>
      )}
      {chart?.values && chart.values.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-medium text-zinc-400">{chart.title || "Chart"}</p>
          <div className="flex h-24 items-end gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-2 py-2">
            {chart.values.slice(0, 12).map((value, idx) => (
              <div key={`${chart.labels?.[idx] || idx}-${idx}`} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-linear-to-t from-cyan-500 to-blue-400" style={{ height: `${Math.max(4, Math.min(100, value))}%` }} title={`${chart.labels?.[idx] || idx}: ${value}${chart.unit || ""}`} />
                <span className="text-[9px] text-zinc-600">{chart.labels?.[idx] || idx + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Image Grid ─────────────────────────── */

function ImageGrid({ images }: { images: ImageResult[] }) {
  const [selected, setSelected] = useState<ImageResult | null>(null);
  if (!images || images.length === 0) return null;

  return (
    <>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <button
            key={i} type="button" onClick={() => setSelected(img)}
            className="group relative aspect-square rounded-xl overflow-hidden border border-zinc-700/30 hover:border-cyan-500/40 transition"
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
              <p className="text-[10px] text-white truncate">{img.title}</p>
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
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="mt-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-3 text-center">
              {selected.title && <p className="text-sm text-zinc-200">{selected.title}</p>}
              <p className="mt-1 text-xs text-zinc-500">Source: {getDomain(selected.source_url)}</p>
              <div className="mt-3 flex justify-center gap-2">
                <a href={selected.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-700/70 px-3 py-2 text-xs text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200">Open source</a>
                <a href={selected.image_url} target="_blank" rel="noreferrer" download className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-black hover:bg-cyan-300">Save image</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const visible = open ? sources : sources.slice(0, 3);
  if (!sources.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-zinc-800/70 bg-zinc-950/35 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-900/70 transition"
        aria-expanded={open}
      >
        <div>
          <p className="text-xs font-semibold text-zinc-200">Sources ({sources.length})</p>
          <p className="text-[11px] text-zinc-500">Collapsed for faster reading</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200">
          {open ? "Hide" : "Expand"}
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-zinc-800/60 p-2">
          {visible.map((source, idx) => (
            <a key={`${source.url}-${idx}`} href={source.url} target="_blank" rel="noreferrer" className="group rounded-xl border border-zinc-800/80 bg-zinc-900/55 p-3 transition hover:border-cyan-500/35 hover:bg-zinc-900/80">
              <div className="flex items-start gap-3">
                <Image src={faviconUrl(source.url)} alt="" width={22} height={22} unoptimized className="mt-0.5 h-5.5 w-5.5 rounded" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-100 group-hover:text-cyan-100">{source.title || getDomain(source.url)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span>{getDomain(source.url)}</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">{sourceConfidenceLabel(source)}</span>
                  </div>
                  {source.summary && <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{source.summary}</p>}
                </div>
                <span className="rounded-lg border border-zinc-700/70 px-2 py-1 text-[11px] text-zinc-300">Open</span>
              </div>
            </a>
          ))}
          {!open && sources.length > 3 && null}
          {sources.length > 3 && <p className="px-1 pb-1 text-[11px] text-zinc-500">{open ? "Showing all sources" : `${sources.length - 3} more sources available`}</p>}
        </div>
      )}
    </div>
  );
}


function TtsPanel({
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
          <p className="text-[10px] text-zinc-500">Voice follows selected language and remembers sound preference.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200" title="Collapse read aloud">Collapse ▲</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={voiceLang} onChange={(e) => onVoiceLang(e.target.value)} className="min-h-10 rounded-xl border border-zinc-700/60 bg-zinc-950/70 px-2 text-xs text-zinc-200" title="Voice language">
          {voiceOptions.map((option) => <option key={`${option.label}-${option.value}`} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" onClick={() => onMuted(!muted)} className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${muted ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-zinc-700/60 text-zinc-200"}`}>{muted ? "Sound OFF" : "Sound ON"}</button>
        <button type="button" onClick={onPlay} disabled={muted} className="min-h-10 rounded-xl bg-cyan-500 px-3 text-xs font-semibold text-black disabled:opacity-40">Play</button>
        <button type="button" onClick={paused ? onResume : onPause} className="min-h-10 rounded-xl border border-zinc-700/60 px-3 text-xs text-zinc-200">{paused ? "Resume" : "Pause"}</button>
        <button type="button" onClick={onStop} className="min-h-10 rounded-xl border border-zinc-700/60 px-3 text-xs text-zinc-200">Stop</button>
        <select value={rate} onChange={(e) => onRate(Number(e.target.value))} className="ml-auto min-h-10 rounded-xl border border-zinc-700/60 bg-zinc-950/70 px-2 text-xs text-zinc-200" title="Speech speed">
          {[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}x</option>)}
        </select>
      </div>
      <label className="mt-3 block text-[11px] text-zinc-500">Reading progress: {progress}%</label>
      <input type="range" min={0} max={Math.max(sentences.length - 1, 0)} value={Math.min(activeSentence, Math.max(sentences.length - 1, 0))} onChange={(e) => onSeek(Number(e.target.value))} className="mt-1 w-full accent-cyan-400" aria-label="Seek read aloud sentence" />
      <div className="mt-2 max-h-28 overflow-y-auto space-y-1 text-xs leading-relaxed">
        {sentences.slice(Math.max(0, activeSentence - 1), activeSentence + 3).map((sentence, offset) => {
          const sentenceIndex = Math.max(0, activeSentence - 1) + offset;
          const isActive = sentenceIndex === activeSentence;
          return (
            <button key={`${sentenceIndex}-${sentence.slice(0, 16)}`} type="button" onClick={() => onSeek(sentenceIndex)} className={`block w-full rounded-xl px-2 py-1.5 text-left transition ${isActive ? "bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.22)]" : sentenceIndex < activeSentence ? "text-zinc-300" : "text-zinc-500"}`}>
              {sentence}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Settings Modal ─────────────────────────── */

function SettingsModal({ open, onClose, webSearch, setWebSearch, deepThink, setDeepThink, codeMode, setCodeMode, appearance, setAppearance, fontScale, setFontScale, isGuest, onRequireLogin, onDownloadCurrentChat, onDownloadAllChats, onPreviewCurrentChat, onPreviewAllChats, onPreviewSessionPdf, onDownloadSessionPdf, recentSessions, fcmStatus, onEnableNotifications }: {
  open: boolean;
  onClose: () => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
  deepThink: boolean;
  setDeepThink: (v: boolean) => void;
  codeMode: boolean;
  setCodeMode: (v: boolean) => void;
  appearance: "dark" | "midnight" | "contrast";
  setAppearance: (v: "dark" | "midnight" | "contrast") => void;
  fontScale: "compact" | "comfortable" | "large";
  setFontScale: (v: "compact" | "comfortable" | "large") => void;
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
  const [downloadTarget, setDownloadTarget] = useState<"current" | "all">("current");
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50">
          <h2 className="text-lg font-semibold text-white tracking-tight">Settings</h2>
          <button type="button" onClick={onClose} title="Close" className="text-zinc-400 hover:text-white transition p-1 rounded-lg hover:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-6 overflow-y-auto">
          {/* Model Info — no selection, internal routing */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">AI Model</label>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
                <div>
                  <p className="text-sm font-semibold text-white">Credon Alpha 1</p>
                  <p className="text-xs text-zinc-400">Multi-model AI with automatic routing &middot; Always picks the best model for your query</p>
                </div>
              </div>
            </div>
          </div>

          {/* Web Search Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-200"><span className="text-base" role="img" aria-label="globe">🌐</span> Web Search
                {!isGuest && webSearch && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />Active</span>
                )}
              </p>
              <p className="text-xs text-zinc-500">Search the internet for up-to-date answers</p>
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
              className={`w-11 h-6 rounded-full transition-colors relative ${webSearch ? "bg-cyan-500" : "bg-zinc-700"}`}>
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${webSearch ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Deep Think Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-200"><span className="text-base" role="img" aria-label="brain">🧠</span> Deep Think
                {!isGuest && deepThink && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-300"><span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />Active — slower</span>
                )}
              </p>
              <p className="text-xs text-zinc-500">More thorough analysis (may take longer)</p>
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
              className={`w-11 h-6 rounded-full transition-colors relative ${deepThink ? "bg-purple-500" : "bg-zinc-700"}`}>
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${deepThink ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Code Mode Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-200"><span className="text-base font-bold" aria-hidden> &lt;/&gt; </span> Code Mode
                {!isGuest && codeMode && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-300"><span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />Active</span>
                )}
              </p>
              <p className="text-xs text-zinc-500">Prefer runnable code-first answers</p>
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
              className={`w-11 h-6 rounded-full transition-colors relative ${codeMode ? "bg-cyan-500" : "bg-zinc-700"}`}
            >
              <span className={`block w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${codeMode ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>


          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">Appearance</p>
              <p className="text-xs text-zinc-500">Personalize CredonAI without changing the answer engine.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={appearance}
                onChange={(e) => setAppearance(e.target.value as "dark" | "midnight" | "contrast")}
                className="rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-xs text-zinc-100 outline-none"
                title="Theme"
              >
                <option value="dark">Dark cyan</option>
                <option value="midnight">Midnight blue</option>
                <option value="contrast">High contrast</option>
              </select>
              <select
                value={fontScale}
                onChange={(e) => setFontScale(e.target.value as "compact" | "comfortable" | "large")}
                className="rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-xs text-zinc-100 outline-none"
                title="Answer font size"
              >
                <option value="compact">Compact font</option>
                <option value="comfortable">Comfortable font</option>
                <option value="large">Large font</option>
              </select>
            </div>
          </div>

          <div className={`rounded-xl border px-3 py-2 ${masterMode ? "border-cyan-500/35 bg-cyan-500/10" : "border-zinc-700/50 bg-zinc-900/40"}`}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-zinc-200">Master Mode</p>
              {masterMode && (
                <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-cyan-500 to-purple-500 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-sm shadow-cyan-500/30">Master Mode Unlocked ⚡</span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {masterMode
                ? "Active: Web Search + DeepThink + Code Mode. Best for deep coding answers with reasoning and sources."
                : "Turn on Web Search, DeepThink, and Code Mode together to unlock Master Mode."}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-300 mb-1">About</h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Credon AI is your intelligent assistant. It combines web search, multi-model reasoning, math solving, and image analysis to give you accurate, well-structured answers.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">Push Notifications</p>
                <p className="text-xs text-zinc-500 mt-1">{fcmStatus}</p>
              </div>
              <button
                type="button"
                onClick={onEnableNotifications}
                className="rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 transition"
              >
                Enable
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-300 mb-2">Download Center</h3>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDownloadTarget("current")}
                  className={`rounded-lg px-3 py-2 text-xs transition border ${downloadTarget === "current" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600"}`}
                >
                  Current Chat
                </button>
                <button
                  type="button"
                  onClick={() => setDownloadTarget("all")}
                  className={`rounded-lg px-3 py-2 text-xs transition border ${downloadTarget === "all" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600"}`}
                >
                  All Chats
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">Select what to export, then view in browser or download.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void (downloadTarget === "current" ? onPreviewCurrentChat() : onPreviewAllChats());
                    onClose();
                  }}
                  className="rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-xs text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 transition"
                >
                  View PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (downloadTarget === "current" ? onDownloadCurrentChat() : onDownloadAllChats());
                    onClose();
                  }}
                  className="rounded-lg border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-xs text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 transition"
                >
                  Download PDF
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  void onDownloadCurrentChat();
                  onClose();
                }}
                className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-left text-xs text-zinc-200 hover:border-cyan-500/40 hover:bg-zinc-800/80 transition"
              >
                Quick Download: Current Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  void onDownloadAllChats();
                  onClose();
                }}
                className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-left text-xs text-zinc-200 hover:border-cyan-500/40 hover:bg-zinc-800/80 transition"
              >
                Quick Download: All Chats
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-700/50 bg-zinc-950/45 p-3">
              <p className="text-xs text-zinc-400 mb-2">Recent Chat PDFs (view/download specific session)</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {recentSessions.slice(0, 8).map((session) => (
                  <div key={session.session_id} className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-2">
                    <p className="text-[11px] text-zinc-300 truncate">{session.preview || session.session_id}</p>
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onPreviewSessionPdf(session.session_id);
                          onClose();
                        }}
                        className="rounded-md border border-zinc-700/60 bg-zinc-800/70 px-2 py-1 text-[11px] text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 transition"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onDownloadSessionPdf(session.session_id);
                          onClose();
                        }}
                        className="rounded-md border border-zinc-700/60 bg-zinc-800/70 px-2 py-1 text-[11px] text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 transition"
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
                {recentSessions.length === 0 && (
                  <p className="text-[11px] text-zinc-500">No recent sessions found yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-800/50 flex justify-end">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110 transition shadow-md shadow-cyan-500/15">Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Privacy Modal ─────────────────────────── */

function PrivacyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="modal-content w-full max-w-lg mx-4 rounded-2xl border border-zinc-700/50 bg-[#111113] shadow-2xl shadow-black/50 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 shrink-0">
          <h2 className="text-lg font-semibold text-white">Privacy Policy</h2>
          <button type="button" onClick={onClose} title="Close" className="text-zinc-400 hover:text-white transition p-1 rounded-lg hover:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4 text-sm text-zinc-300 leading-relaxed">
          <p><strong className="text-white">Last updated:</strong> June 2026</p>
          <div><h3 className="text-white font-semibold mb-1">What is stored</h3><p className="text-zinc-400">Credon stores your account email, chat messages, uploaded knowledge (PDFs and text), your memory profile (topics and preferences), download history, and your profile avatar so your assistant can continue a useful, personalized conversation.</p></div>
          <div><h3 className="text-white font-semibold mb-1">Memory policy</h3><p className="text-zinc-400">Credon builds a preference profile from your messages to personalize responses. Current chat context is temporary, recent session topics help continuity, and long-term memory keeps explicit preferences. You can delete your memory profile in Settings.</p></div>
          <div><h3 className="text-white font-semibold mb-1">File retention</h3><p className="text-zinc-400">Uploaded PDFs and images are extracted into searchable chunks and stored linked to your account. Deleting a chat or your account removes related messages and uploaded files where supported by the backend.</p></div>
          <div><h3 className="text-white font-semibold mb-1">Security</h3><p className="text-zinc-400">We use Firebase Auth, Firestore security rules, and Firebase Storage rules that restrict access to authenticated users only. Your data is protected by industry-standard security.</p></div>
          <div><h3 className="text-white font-semibold mb-1">AI limitations</h3><p className="text-zinc-400">AI answers can be wrong or incomplete. Verify medical, legal, financial, and current-event information with trusted sources.</p></div>
          <div><h3 className="text-white font-semibold mb-1">Your Rights</h3><p className="text-zinc-400">Delete your account and data anytime. Guest sessions are cleaned up periodically.</p></div>
          <div><h3 className="text-white font-semibold mb-1">Contact</h3><p className="text-zinc-400">privacy@credon.ai</p></div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-800 shrink-0 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 transition">Close</button>
        </div>
      </div>
    </div>
  );
}

function UpdatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="modal-content neo-glass w-full max-w-lg rounded-2xl border border-zinc-700/50 shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 shrink-0">
          <h2 className="text-lg font-semibold text-white">Updates</h2>
          <button type="button" onClick={onClose} title="Close" className="text-zinc-400 hover:text-white transition p-1 rounded-lg hover:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-3 text-sm">
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3">
            <div className="flex items-center gap-2">
              <p className="text-cyan-200 font-medium">Version 1.2.0</p>
              <span className="rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] text-zinc-400">June 2026</span>
            </div>
            <p className="text-xs text-zinc-300 mt-1">Charts, Streaming &amp; Personalization — Credon Alpha 1.</p>
          </div>
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-3">
            <p className="text-white font-medium">What is new</p>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-300">
              <li>AI now renders charts and tables automatically.</li>
              <li>Real-time streaming responses, word by word.</li>
              <li>Friendlier, tone-aware conversational style with emoji support.</li>
              <li>AI remembers your topics and personalizes answers.</li>
              <li>Master Mode badge and live status indicators in Settings.</li>
              <li>Improved PDF export and session-level view/download.</li>
            </ul>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-800/50 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 transition">Close</button>
        </div>
      </div>
    </div>
  );
}

function DislikeFeedbackModal({
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
      <div className="w-full max-w-md rounded-2xl border border-zinc-700/60 bg-zinc-900/90 shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Help us improve this answer</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" title="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">What was wrong?</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              title="Feedback category"
              className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50"
            >
              <option value="irrelevant">Irrelevant to my question</option>
              <option value="incorrect">Factually incorrect</option>
              <option value="too_slow">Too slow</option>
              <option value="too_long">Too long / verbose</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Short note (optional)</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us what should be better"
              className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-800/60 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-zinc-300 hover:bg-zinc-800/70">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit(category, reason.trim())}
            className="px-4 py-2 rounded-xl text-sm bg-linear-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-50"
          >
            {busy ? "Sending..." : "Submit feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Auth Page ─────────────────────────── */

const SUBJECTS = [
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

const SOURCE_TYPES = [
  { value: "note", label: "Notes" },
  { value: "question_paper", label: "Question Paper" },
  { value: "cheat_sheet", label: "Cheat Sheet" },
  { value: "lecture", label: "Lecture" },
];

function KnowledgeUploadModal({ open, onClose, uid }: { open: boolean; onClose: () => void; uid: string }) {
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
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-lg font-semibold text-white">Upload Knowledge</h2>
          <button type="button" onClick={() => { reset(); onClose(); }} title="Close" className="text-zinc-400 hover:text-white transition p-1 rounded-lg hover:bg-zinc-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setTab("text")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === "text" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 hover:text-zinc-300"}`}>
              Paste Text
            </button>
            <button type="button" onClick={() => setTab("pdf")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === "pdf" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 hover:text-zinc-300"}`}>
              Upload PDF
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Physics Ch-5 Notes"
              className="w-full px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-cyan-500/50" />
          </div>

          {/* Subject + Source Type row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-400 mb-1">Subject</label>
              <select value={subject} onChange={e => setSubject(e.target.value)} title="Subject"
                className="w-full px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-sm text-white outline-none focus:border-cyan-500/50">
                {SUBJECTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-400 mb-1">Type</label>
              <select value={sourceType} onChange={e => setSourceType(e.target.value)} title="Source type"
                className="w-full px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-sm text-white outline-none focus:border-cyan-500/50">
                {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Tags (comma-separated)</label>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. chapter-5, thermodynamics, exam-prep"
              className="w-full px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-cyan-500/50" />
          </div>

          {/* Text input or PDF upload */}
          {tab === "text" ? (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Content</label>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
                placeholder="Paste your notes, question paper, cheat sheet, or lecture content here..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-cyan-500/50 resize-none" />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">PDF File</label>
              <input ref={pdfRef} type="file" accept=".pdf" className="hidden" title="Upload PDF" aria-label="Upload PDF"
                onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); e.target.value = ""; }} />
              <button type="button" onClick={() => pdfRef.current?.click()}
                className="w-full px-4 py-6 rounded-xl border-2 border-dashed border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/50 transition text-sm text-zinc-400 hover:text-zinc-300">
                {pdfFile ? (
                  <span className="text-cyan-400">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</span>
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

        <div className="px-6 py-4 border-t border-zinc-800 shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-zinc-500">Subject is auto-detected if not selected</p>
          <button type="button" disabled={busy || (tab === "text" ? !text.trim() : !pdfFile)} onClick={tab === "text" ? submitText : submitPdf}
            className="px-5 py-2 text-sm rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110 transition disabled:opacity-40">
            {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Auth Page (original) ─────────────────────────── */

function AuthPage({ onGuest }: { onGuest: () => void }) {
  const [tab, setTab] = useState<AuthTab>("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const noFirebase = !firebaseAuth;

  const switchTab = (t: AuthTab) => { setTab(t); setErr(""); setOk(""); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firebaseAuth) { onGuest(); return; }
    setBusy(true); setErr(""); setOk("");
    try {
      if (tab === "forgot") { await sendPasswordResetEmail(firebaseAuth, email.trim()); setOk("Reset link sent! Check your inbox."); }
      else if (tab === "signup") {
        if (pw.length < 6) { setErr("Password must be at least 6 characters"); setBusy(false); return; }
        await createUserWithEmailAndPassword(firebaseAuth, email.trim(), pw);
      }
      else { await signInWithEmailAndPassword(firebaseAuth, email.trim(), pw); }
    } catch (x: unknown) {
      const msg = x instanceof Error ? x.message : "Something went wrong";
      setErr(cleanFirebaseError(msg));
    }
    finally { setBusy(false); }
  };

  const google = async () => {
    if (!firebaseAuth) { onGuest(); return; }
    setBusy(true); setErr("");
    try { await signInWithPopup(firebaseAuth, new GoogleAuthProvider()); }
    catch (x: unknown) { setErr(cleanFirebaseError(x instanceof Error ? x.message : "Google sign-in failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#09090b] px-4">
      <div className="w-full max-w-105">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/20 overflow-hidden">
            <CredonLogo size={40} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Credon AI</h1>
          <p className="text-zinc-400 mt-1 text-sm">Search smart. Think deeper.</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 backdrop-blur-xl p-6 shadow-2xl">
          {noFirebase && (
            <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
              <p className="text-sm text-amber-300 font-medium">Guest mode is ready</p>
              <p className="text-xs text-amber-400/70 mt-0.5">Sign-in is unavailable in this local run, so Credon AI will continue as guest.</p>
            </div>
          )}
          {tab !== "forgot" ? (
            <div className="flex mb-6 bg-zinc-800/60 rounded-xl p-1">
              {(["signin", "signup"] as AuthTab[]).map((t) => (
                <button key={t} type="button" onClick={() => switchTab(t)}
                  className={`flex-1 py-2.5 text-sm rounded-lg font-medium transition-all ${tab === t ? "bg-zinc-700 text-white shadow" : "text-zinc-400 hover:text-zinc-200"}`}>
                  {t === "signin" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-6"><h2 className="text-lg font-semibold text-white">Reset Password</h2><p className="text-sm text-zinc-400 mt-1">We&apos;ll email you a reset link</p></div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Email address</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder:text-zinc-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition" />
            </div>
            {tab !== "forgot" && (
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 pr-11 text-white placeholder:text-zinc-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition" tabIndex={-1} title={showPw ? "Hide password" : "Show password"} aria-label={showPw ? "Hide password" : "Show password"}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      {showPw ? <path d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        : <><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></>}
                    </svg>
                  </button>
                </div>
              </div>
            )}
            {tab === "signin" && <button type="button" onClick={() => switchTab("forgot")} className="text-sm text-cyan-400 hover:text-cyan-300 transition">Forgot password?</button>}
            {err && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{err}</p>}
            {ok && <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{ok}</p>}
            <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:brightness-110 disabled:opacity-50 transition shadow-lg shadow-cyan-500/20">
              {busy ? "Please wait\u2026" : tab === "signin" ? "Sign In" : tab === "signup" ? "Create Account" : "Send Reset Link"}
            </button>
          </form>
          {tab === "forgot" ? (
            <button type="button" onClick={() => switchTab("signin")} className="mt-4 w-full text-center text-sm text-zinc-400 hover:text-white transition">&larr; Back to Sign In</button>
          ) : (
            <>
              <div className="flex items-center gap-3 my-5"><span className="flex-1 h-px bg-zinc-800" /><span className="text-xs text-zinc-500 uppercase tracking-wide">or</span><span className="flex-1 h-px bg-zinc-800" /></div>
              <button type="button" onClick={google} disabled={busy} className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-zinc-700 bg-zinc-800/40 text-white hover:bg-zinc-800 transition disabled:opacity-50">
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                Continue with Google
              </button>
            </>
          )}
        </div>
        <button type="button" onClick={onGuest} className="mt-5 w-full text-center py-3.5 text-sm rounded-xl border border-zinc-700/50 bg-zinc-800/40 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-600 transition-all">
          Continue without an account &rarr;
        </button>
      </div>
    </div>
  );
}

function LandingPage({ onStart, onTryFree }: { onStart: () => void; onTryFree: () => void }) {
  return (
    <div className="min-h-dvh bg-[#07080a] text-white overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute top-1/3 -left-16 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-6xl px-5 py-8 md:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-cyan-400/30 backdrop-blur-xl flex items-center justify-center overflow-hidden shadow-[0_8px_28px_rgba(34,211,238,0.18)]">
              <CredonLogo size={28} />
            </div>
            <span className="text-sm md:text-base font-semibold tracking-[0.12em]">CREDON-AI</span>
          </div>
          <button
            type="button"
            onClick={onStart}
            className="rounded-xl bg-white/10 border border-zinc-700/60 px-4 py-2 text-sm hover:bg-white/15 transition"
          >
            Sign in
          </button>
        </header>

        <section className="grid md:grid-cols-2 gap-7 md:gap-10 mt-10 md:mt-16 items-center">
          <div>
            <p className="text-cyan-300/90 text-xs tracking-[0.14em] uppercase">Research. Build. Learn faster.</p>
            <h1 className="mt-3 text-4xl md:text-6xl font-black leading-tight tracking-tight">
              Modern AI Workspace for
              <span className="block text-transparent bg-clip-text bg-linear-to-r from-cyan-200 via-cyan-400 to-blue-400">Students & Builders</span>
            </h1>
            <p className="mt-4 text-zinc-300 text-sm md:text-base max-w-xl">
              Ask better questions, upload notes/PDFs, generate polished answers and exports,
              and keep every conversation organized in one premium, fast interface.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onStart}
                className="rounded-2xl bg-linear-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-semibold shadow-[0_10px_30px_rgba(6,182,212,0.28)] hover:brightness-110 transition"
              >
                Get Started
              </button>
              <button
                type="button"
                onClick={onTryFree}
                className="rounded-2xl bg-zinc-900/70 border border-zinc-700/60 px-6 py-3 text-sm font-semibold hover:border-cyan-500/40 hover:bg-zinc-800/80 transition"
              >
                Try Free (Guest)
              </button>
            </div>
          </div>
          <div className="rounded-3xl border border-zinc-700/50 bg-white/4 backdrop-blur-2xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(0,0,0,0.35)]">
            <div className="grid grid-cols-2 gap-3">
              {[
                "Instant answers with context",
                "DeepThink when needed",
                "PDF/image knowledge ingest",
                "One-tap chat PDF exports",
              ].map((feature) => (
                <div key={feature} className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-3 text-xs text-zinc-200">
                  {feature}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10 md:mt-14 grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-zinc-700/50 bg-zinc-900/55 p-4">
            <h3 className="text-sm font-semibold text-cyan-200">Why CSE Students Prefer It</h3>
            <p className="mt-2 text-xs text-zinc-300 leading-relaxed">
              Code Mode pushes structured, runnable answers with practical steps. It is tuned for DSA,
              debugging, DBMS, OS, and project workflows instead of generic textbook summaries.
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-700/50 bg-zinc-900/55 p-4">
            <h3 className="text-sm font-semibold text-cyan-200">Smarter Than One-Model Chat</h3>
            <p className="mt-2 text-xs text-zinc-300 leading-relaxed">
              CREDON-AI routes each query through the best internal path: instant response, context follow-up,
              grounded retrieval, or deep analysis. That means better speed on simple asks and better depth when needed.
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-700/50 bg-zinc-900/55 p-4">
            <h3 className="text-sm font-semibold text-cyan-200">Built for Real Assignments</h3>
            <p className="mt-2 text-xs text-zinc-300 leading-relaxed">
              Upload class notes, PDFs, and visuals, then export polished responses as PDFs. Keep your sessions organized
              so revision and report generation are faster before exams and project deadlines.
            </p>
          </article>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/55 p-5">
            <h3 className="text-base font-semibold text-white">Why CREDON-AI feels faster in real work</h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-300 leading-relaxed">
              <li>Adaptive routing for simple vs complex queries keeps average response time low.</li>
              <li>Context-follow-up flow avoids irrelevant search for &quot;this/that&quot; style questions.</li>
              <li>Code Mode + Master Mode prioritize practical, runnable outputs instead of generic essays.</li>
              <li>Structured response metadata improves confidence, sources, and answer quality tracking.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/55 p-5">
            <h3 className="text-base font-semibold text-white">Built for reliability after deployment</h3>
            <ul className="mt-3 space-y-2 text-xs text-zinc-300 leading-relaxed">
              <li>Guest-safe controls with premium mode gating and clean upgrade prompts.</li>
              <li>PDF/Image ingest pipeline with OCR fallback for low-text documents.</li>
              <li>Download center for answer and chat PDFs with preview and export flows.</li>
              <li>Feedback-driven learning loop to improve future answers from real usage.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function InstallPromptBanner({ active, onInstall, onDismiss }: { active: boolean; onInstall: () => void; onDismiss: () => void }) {
  if (!active) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,640px)] rounded-2xl border border-cyan-500/30 bg-zinc-950/85 backdrop-blur-xl px-4 py-3 flex items-center gap-3 shadow-2xl">
      <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center shrink-0 overflow-hidden"><CredonLogo size={22} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100 font-medium">Install CREDON-AI on your home screen</p>
        <p className="text-xs text-zinc-400">Faster launch and app-like experience. We’ll remind rarely.</p>
      </div>
      <button type="button" onClick={onDismiss} className="text-xs text-zinc-500 hover:text-zinc-300">Later</button>
      <button type="button" onClick={onInstall} className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-3 py-1.5 text-xs font-semibold">Install</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CHAT PAGE
   ══════════════════════════════════════════════════════════════════ */

function ChatPage({ user, onSignOut, isGuest }: { user: User | null; onSignOut: () => void; isGuest: boolean }) {
  /* ── Core state ── */
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: GREET, timestamp: Date.now() },
  ]);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [homeSuggestions, setHomeSuggestions] = useState<string[]>(() => randomLocalPrompts());
  const [hasUserSentMessage, setHasUserSentMessage] = useState(false);
  const [currentSession, setCurrentSession] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [shared, setShared] = useState<number | null>(null);
  const [shareMenuTarget, setShareMenuTarget] = useState<number | null>(null);
  const [mobileModesOpen, setMobileModesOpen] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState<"deep-think" | "knowledge" | "web-search" | "code-mode" | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<number | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [fcmStatus, setFcmStatus] = useState("Checking FCM readiness...");
  const [geoPoint, setGeoPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [ttsPanelIndex, setTtsPanelIndex] = useState<number | null>(null);
  const [ttsSentenceIndex, setTtsSentenceIndex] = useState(0);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsVoiceLang, setTtsVoiceLang] = useState("en-US");
  const [ttsMuted, setTtsMuted] = useState(() => typeof window !== "undefined" && localStorage.getItem("credon-tts-muted") === "1");
  const [inputMenuOpen, setInputMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [productMode, setProductMode] = useState<ProductMode>("Student");
  const [answerStyle, setAnswerStyle] = useState<AnswerStyle>("Balanced");
  const [chatSearch, setChatSearch] = useState("");
  const [listening, setListening] = useState(false);

  /* ── Model & settings ── */
  const [, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [useWeb, setUseWeb] = useState(() => !isGuest);
  const [deepThink, setDeepThink] = useState(() => {
    if (isGuest) return false;
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("credon-deep-think");
    return stored == null ? true : stored === "1";
  });
  const [codeMode, setCodeMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("credon-code-mode") === "1";
  });
  const [appearance, setAppearanceState] = useState<"dark" | "midnight" | "contrast">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("credon-appearance") as "dark" | "midnight" | "contrast" | null) ?? "dark";
  });
  const [fontScale, setFontScaleState] = useState<"compact" | "comfortable" | "large">(() => {
    if (typeof window === "undefined") return "comfortable";
    return (localStorage.getItem("credon-font-scale") as "compact" | "comfortable" | "large" | null) ?? "comfortable";
  });
  const [replyTo, setReplyTo] = useState<{ text: string; index: number } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  /* ── Thinking state ── */
  const [thinkingStage, setThinkingStage] = useState<ThinkingStage>(null);
  const [thinkingStart, setThinkingStart] = useState<number>(0);
  const [liveThinking, setLiveThinking] = useState("");

  /* ── Follow-up dismiss ── */
  const [followUpsDismissed, setFollowUpsDismissed] = useState(false);

  /* ── File upload ── */
  const [attachedFiles, setAttachedFiles] = useState<PendingAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const assistantAnswerStreaming = messages.some((m) => m.role === "assistant" && m.streaming);
  const showPreTokenLoader = loading && !assistantAnswerStreaming;
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  /* ── Abort controller for stop button ── */
  const abortRef = useRef<AbortController | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Backend warmup: the free-tier backend sleeps after idle and a cold boot
     can take 30–60s, which otherwise surfaces as a connection error on the first
     message. Ping /health (throttled) on load and when the user shows intent so
     the boot happens before they wait on a real query. ── */
  const lastWarmRef = useRef<number>(0);
  const warmBackend = useCallback(() => {
    const now = Date.now();
    if (now - lastWarmRef.current < 60_000) return;
    lastWarmRef.current = now;
    void fetch(`${API}/health`, { method: "GET", cache: "no-store" }).catch(() => {
      lastWarmRef.current = 0; // allow a retry if the wake-up ping itself failed
    });
  }, []);

  const [localUserId] = useState(() => {
    if (typeof window === "undefined") return "guest";
    const stored = localStorage.getItem("credon-local-uid");
    if (stored) return stored;
    const id = createGuestId();
    localStorage.setItem("credon-local-uid", id);
    return id;
  });

  const uid = user?.uid ?? localUserId;
  const sessionStorageKey = `credon-active-session:${uid}`;
  const pinnedSessionsStorageKey = `credon-pinned-sessions:${uid}`;
  const pinnedSessionsStorageKeyRef = useRef(pinnedSessionsStorageKey);
  const skipPinnedSessionsWriteRef = useRef(false);
  const [pinnedSessions, setPinnedSessions] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(pinnedSessionsStorageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (pinnedSessionsStorageKeyRef.current === pinnedSessionsStorageKey) return;
    pinnedSessionsStorageKeyRef.current = pinnedSessionsStorageKey;
    skipPinnedSessionsWriteRef.current = true;
    if (typeof window === "undefined") {
      setPinnedSessions([]);
      return;
    }
    try {
      const stored = localStorage.getItem(pinnedSessionsStorageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      setPinnedSessions(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
    } catch {
      setPinnedSessions([]);
    }
  }, [pinnedSessionsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipPinnedSessionsWriteRef.current) {
      skipPinnedSessionsWriteRef.current = false;
      return;
    }
    localStorage.setItem(pinnedSessionsStorageKey, JSON.stringify(pinnedSessions));
  }, [pinnedSessions, pinnedSessionsStorageKey]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoPoint({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => setGeoPoint(null),
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 30 * 60 * 1000 }
    );
  }, []);
  const displayName = user?.displayName ?? user?.email?.split("@")[0] ?? "Guest";
  const isEmptyChat = messages.length === 1 && messages[0].text === GREET;
  const allModesActive = !isGuest && useWeb && deepThink && codeMode && hasUserSentMessage;
  const browserSupportsNativeShare = typeof window !== "undefined" && typeof navigator !== "undefined" && "share" in navigator;
  const setAppearance = (value: "dark" | "midnight" | "contrast") => {
    setAppearanceState(value);
    if (typeof window !== "undefined") localStorage.setItem("credon-appearance", value);
  };
  const setFontScale = (value: "compact" | "comfortable" | "large") => {
    setFontScaleState(value);
    if (typeof window !== "undefined") localStorage.setItem("credon-font-scale", value);
  };
  const shellClass = appearance === "contrast" ? "bg-black text-white" : appearance === "midnight" ? "bg-[#050816] text-white" : "bg-[#07080a] text-white";
  const answerFontClass = fontScale === "large" ? "[--answer-size:16px]" : fontScale === "compact" ? "[--answer-size:13px]" : "[--answer-size:15px]";

  useEffect(() => {
    // Guests should still get the resilient answer pipeline: Credon Brain → local model → DuckDuckGo web fallback.
    // Keep expensive reasoning/code features signed-in only, but do not disable web search for guests.
    if (isGuest) {
      setDeepThink(false);
      setCodeMode(false);
      if (typeof window !== "undefined") {
        localStorage.setItem("credon-deep-think", "0");
        localStorage.setItem("credon-code-mode", "0");
      }
    }
  }, [isGuest]);

  useEffect(() => {
    const readiness = getFcmReadiness();
    setFcmStatus(readiness.ready ? "Ready. Enable to receive notifications on this device." : userFriendlyFcmStatus(readiness.reason));
  }, []);

  /* Follow-up suggestions — prefer structured suggestions from backend */
  const followUps = useMemo(() => {
    if (followUpsDismissed) return [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && !lastMsg.streaming && lastMsg.text !== GREET) {
      // Use structured suggestions from backend if available
      if (lastMsg.suggestions && lastMsg.suggestions.length > 0) {
        return lastMsg.suggestions.slice(0, 3);
      }
      // Fallback: extract from text
      return extractFollowUps(lastMsg.text);
    }
    return [];
  }, [messages, followUpsDismissed]);

  /* Auto-scroll only when the user is already near the bottom. This prevents unwanted
     automatic jumping while someone is reading an earlier answer. */
  const transcriptRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const updateAutoScrollIntent = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    shouldAutoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current && !loading) return;
    bottomRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth", block: "end" });
  }, [messages, loading, thinkingStage]);

  /* Auto-resize textarea */
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + "px";
    }
  }, [query]);

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOnline(navigator.onLine);
      setConnectionNotice(navigator.onLine ? "Connection restored — draft preserved." : "Offline — saved draft locally.");
      window.setTimeout(() => setConnectionNotice(null), 3500);
    };
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("credon-tts-muted", ttsMuted ? "1" : "0");
    if (ttsMuted) stopTts();
  }, [ttsMuted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `credon-draft:${uid}`;
    const stored = localStorage.getItem(key);
    if (stored && !query) setQuery(stored);
  // Load once per user to avoid overwriting active typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(`credon-draft:${uid}`, query);
  }, [query, uid]);

  /* Paste image from clipboard */
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const preview = URL.createObjectURL(file);
            setAttachedFiles((prev) => [...prev, { file, kind: "image", preview }]);
          }
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  /* Fetch models */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/v1/models`);
        if (!r.ok) return;
        const data = await r.json();
        const allModels: ModelInfo[] = data.models ?? [];
        setModels(allModels);
        const saved = typeof window !== "undefined" ? localStorage.getItem("credon-model") : null;
        if (saved && allModels.some((m) => m.id === saved)) setSelectedModel(saved);
        else setSelectedModel(data.default ?? allModels[0]?.id ?? "");
      } catch { /* offline */ }
    })();
  }, []);

  /* Load sessions */
  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/chats/${uid}`);
      if (!r.ok) return;
      const data: SessionSummary[] = await r.json();
      setSessions(data);
      setCurrentSession((prev) => {
        const hasPrev = prev ? data.some((s) => s.session_id === prev) : false;
        if (hasPrev) return prev;
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem(sessionStorageKey);
          if (stored && data.some((s) => s.session_id === stored)) return stored;
        }
        return data.length > 0 ? data[0].session_id : (prev || newSessionId());
      });
    } catch { /* ignore */ }
  }, [uid, sessionStorageKey]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => { warmBackend(); }, [warmBackend]);

  useEffect(() => {
    if (!currentSession) {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem(sessionStorageKey);
        if (stored) { setCurrentSession(stored); return; }
      }
      setCurrentSession(newSessionId());
      return;
    }
    if (typeof window !== "undefined") localStorage.setItem(sessionStorageKey, currentSession);
  }, [currentSession, sessionStorageKey]);

  /* Load transcript */
  useEffect(() => {
    if (!currentSession) return;
    const load = async () => {
      setTranscriptLoading(true);
      try {
        const r = await fetch(`${API}/api/v1/chats/${uid}/${currentSession}`);
        if (!r.ok) { setMessages([{ role: "assistant", text: GREET, timestamp: Date.now() }]); return; }
        const data = await r.json();
        if (!data.messages?.length) { setMessages([{ role: "assistant", text: GREET, timestamp: Date.now() }]); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setMessages(data.messages.map((m: any) => ({
          role: m.role, text: m.text,
          timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
          thinking: m.thinking || undefined,
          confidence: m.confidence || undefined,
          sources: m.sources?.length ? m.sources : undefined,
          images: m.images?.length ? m.images : undefined,
          metadata: m.metadata || undefined,
          pinned: m.pinned === true || m.metadata?.pinned === true || Boolean(m.metadata?.pin_id),
        })));
      } catch { setMessages([{ role: "assistant", text: GREET, timestamp: Date.now() }]); }
      finally { setTranscriptLoading(false); }
    };
    void load();
  }, [uid, currentSession]);

  const handleEnableNotifications = async () => {
    const result = await enableFcmAndGetToken();
    if (result.token) {
      const shortToken = `${result.token.slice(0, 14)}...${result.token.slice(-8)}`;
      if (typeof window !== "undefined") {
        localStorage.setItem("credon-fcm-token", result.token);
      }
      try {
        const reg = await fetch(`${API}/api/v1/notifications/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: uid, token: result.token, platform: "web" }),
        });
        if (!reg.ok) {
          setFcmStatus(`Enabled (${shortToken}), but registration is pending. We will keep retrying automatically.`);
          return;
        }
      } catch {
        setFcmStatus(`Enabled (${shortToken}), but registration is pending due to a temporary network issue.`);
        return;
      }
      setFcmStatus(`Enabled and connected (${shortToken}). Notifications are ready.`);
      return;
    }
    setFcmStatus(userFriendlyFcmStatus(result.error));
  };

  const fetchHomeSuggestions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/suggestions?user_id=${encodeURIComponent(uid)}&t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.suggestions)) setHomeSuggestions(data.suggestions.slice(0, 4));
    } catch {
      setHomeSuggestions(randomLocalPrompts());
    }
  }, [uid]);

  useEffect(() => { void fetchHomeSuggestions(); }, [fetchHomeSuggestions, currentSession]);

  const newChat = () => {
    setCurrentSession(newSessionId());
    stopGeneration();
    setMobileModesOpen(false);
    setHomeSuggestions(randomLocalPrompts());
    setMessages([{ role: "assistant", text: GREET, timestamp: Date.now() }]);
    setHasUserSentMessage(false);
    setSidebarOpen(false);
    void fetchHomeSuggestions();
    inputRef.current?.focus();
  };

  /* ── Stop generation ── */
  const stopGeneration = () => {
    abortRef.current?.abort();
    setLoading(false);
    setThinkingStage(null);
    setMessages((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((m) => m.streaming);
      if (idx >= 0) updated[idx] = { ...updated[idx], streaming: false };
      return updated;
    });
  };

  const ingestAttachments = useCallback(async (files: PendingAttachment[]) => {
    const failures: string[] = [];
    await Promise.all(
      files.map(async (item) => {
        const form = new FormData();
        form.append("user_id", uid);
        form.append("file", item.file);
        const endpoint = item.kind === "pdf" ? "/api/v1/ingest/pdf" : "/api/v1/ingest/image";
        try {
          const response = await fetch(`${API}${endpoint}`, {
            method: "POST",
            body: form,
          });
          const data: { ok?: boolean; error?: string } = await response.json();
          if (!response.ok || data.ok === false) {
            failures.push(`${item.file.name}${data.error ? `: ${data.error}` : ""}`);
          }
        } catch {
          failures.push(item.file.name);
        }
      })
    );
    return failures;
  }, [uid]);

  /* ── Handle file selection ── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        const preview = URL.createObjectURL(file);
        setAttachedFiles((prev) => [...prev, { file, kind: "image", preview }]);
      } else if (file.type === "application/pdf") {
        setAttachedFiles((prev) => [...prev, { file, kind: "pdf" }]);
      }
    }
    e.target.value = "";
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => {
      const attachment = prev[idx];
      if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /* ── Send message ── */
  const send = async (
    text: string,
    options?: { regenerate?: boolean; replyContext?: string | null }
  ) => {
    const q = text.trim();
    if (attachedFiles.length === 0 && !q) return;
    if (loading || uploadingFiles) return;

    setMobileModesOpen(false);

    const isRegenerate = options?.regenerate === true;
    let replyContext = options?.replyContext ?? replyTo?.text ?? null;
    const wantsPdfExport = /\b(create|generate|make|export|download)\b.*\bpdf\b|\bpdf\b.*\b(create|generate|export|download)\b/i.test(q);

    const queuedFiles = [...attachedFiles];
    if (queuedFiles.length > 0) {
      setUploadingFiles(true);
      setUploadError(null);
      const hasPdf = queuedFiles.some((item) => item.kind === "pdf");
      const hasImage = queuedFiles.some((item) => item.kind === "image");
      setUploadStatus(
        hasPdf
          ? "Extracting text from PDF and indexing context..."
          : hasImage
            ? "Reading image text and indexing context..."
            : "Indexing attachments..."
      );
      const failedFiles = await ingestAttachments(queuedFiles);
      if (failedFiles.length > 0) {
        setUploadError(`Could not fully process: ${failedFiles.slice(0, 2).map(f => f.split(':')[0]).join(", ")}${failedFiles.length > 2 ? "..." : ""}. Files were saved — text may be limited.`);
      }
      setUploadingFiles(false);
      setUploadStatus(null);
    }

    if (!q) {
      queuedFiles.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview);
      });
      setAttachedFiles([]);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "Your files were indexed. Ask a question and I’ll use them as context.",
        timestamp: Date.now(),
      }]);
      return;
    }

    if (!replyContext && /\b(this|that|it)\s+(pdf|file|image|doc)\b|\bthis\s+(pdf|image)\b/i.test(q)) {
      const lastUserWithAttachment = [...messages]
        .reverse()
        .find((m) => m.role === "user" && (m.attachments?.length ?? 0) > 0);
      if (lastUserWithAttachment?.attachments?.length) {
        const attachmentNames = lastUserWithAttachment.attachments.map((a) => `${a.type.toUpperCase()}: ${a.name}`).join(", ");
        replyContext = `User referenced attachment(s): ${attachmentNames}`;
      }
    }

    if (wantsPdfExport && !isRegenerate) {
      const contextualAnswer =
        replyContext
        || [...messages].reverse().find((m) => m.role === "assistant" && m.text !== GREET && !m.streaming)?.text
        || "";
      if (contextualAnswer.trim()) {
        setHasUserSentMessage(true);
      const userMsg: Message = {
          role: "user",
          text: q,
          timestamp: Date.now(),
          replyTo: replyContext || undefined,
        };
        setMessages((prev) => [...prev, userMsg]);
        setQuery("");
        try {
          const titleSource = [...messages].reverse().find((m) => m.role === "user")?.text || "Credon Answer";
          const pdfResponse = await fetch(`${API}/api/v1/generate/export/answer-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: titleSource.slice(0, 80),
              content: contextualAnswer,
              user_id: uid,
            }),
          });
          if (!pdfResponse.ok) {
            const errText = await pdfResponse.text();
            throw new Error(errText || "pdf_export_failed");
          }
          const blob = await pdfResponse.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `credon-answer-${Date.now()}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          setMessages((prev) => [...prev, {
            role: "assistant",
            text: "PDF generated and downloaded. You can ask for a shorter or more detailed version too.",
            timestamp: Date.now(),
          }]);
        } catch {
          setMessages((prev) => [...prev, {
            role: "assistant",
            text: "I could not generate the PDF right now. Please try again in a moment. If this continues, restart backend so the latest export endpoint is active.",
            timestamp: Date.now(),
            confidence: "low",
          }]);
        }
        setReplyTo(null);
        return;
      }
    }

    if (!isRegenerate) {
      // If editing a previous message, trim the regenerated branch without dropping pins.
      // Pinned messages may represent saved references that should survive edits/regenerations.
      if (editingIndex !== null) {
        setMessages((prev) => preservePinnedMessagesOnEdit(prev, editingIndex));
        setEditingIndex(null);
      }
      setHasUserSentMessage(true);
      const userMsg: Message = {
        role: "user", text: q, timestamp: Date.now(),
        replyTo: replyContext || undefined,
        attachments: queuedFiles.map((item) => ({
          type: item.kind,
          url: item.preview,
          name: item.file.name,
        })),
      };
      setMessages((prev) => [...prev, userMsg]);
    }

    setQuery("");
    if (typeof window !== "undefined") localStorage.removeItem(`credon-draft:${uid}`);
    queuedFiles.forEach((item) => {
      if (item.preview) URL.revokeObjectURL(item.preview);
    });
    setAttachedFiles([]);
    setLoading(true);
    setThinkingStage(null);
    setThinkingStart(Date.now());
    setLiveThinking("");
    setFollowUpsDismissed(false);

    const backendQuery = replyContext
      ? `${q}\n\n[Replying to previous answer]: ${replyContext.slice(0, 700)}`
      : q;

    const detectedMode = detectProductMode(q);
    if (detectedMode !== productMode) setProductMode(detectedMode);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const r = await fetch(`${API}/api/v1/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid,
          session_id: currentSession,
          query: backendQuery,
          metadata: {
            product_mode: detectedMode,
            answer_style: answerStyle,
            layout_preference: "auto",
          },
          language: "auto",
          model: selectedModel || undefined,
          use_web: useWeb,
          deep_think: deepThink,
          code_mode: isGuest ? false : codeMode,
          reply_to: replyContext || undefined,
          latitude: geoPoint?.latitude,
          longitude: geoPoint?.longitude,
        }),
        signal: controller.signal,
      });

      if (!r.ok || !r.body) throw new Error("Stream failed");

      const assistantIdx = { current: -1 };
      // Don't add placeholder yet - show thinking animation first

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accSources: Source[] = [];
      let accImages: ImageResult[] = [];
      let accConfidence: string | undefined;
      let accThinking = "";
      let accSuggestions: string[] = [];
      let accEvaluator: { input_sources?: number; selected_sources?: number; avg_score?: number } | undefined;
      let firstTokenReceived = false;
      let thinkingActive = false;
      let thinkStartedAt = 0;
      let accMetadata: Message["metadata"] | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));

            if (evt.type === "status") {
              const stage = evt.stage === "thinking" ? "evaluating" : evt.stage === "generating" ? "composing" : evt.stage;
              setThinkingStage(stage as ThinkingStage);
            } else if (evt.type === "thinking") {
              // Full thinking text (legacy / fallback)
              accThinking = evt.content ?? "";
              setLiveThinking(accThinking);
            } else if (evt.type === "thinking_token") {
              // Word-by-word thinking stream from backend
              if (!thinkStartedAt) thinkStartedAt = Date.now();
              thinkingActive = true;
              setThinkingStage(null); // Hide progress dots, show live thinking
              accThinking += evt.content ?? "";
              setLiveThinking(accThinking);
            } else if (evt.type === "thinking_done") {
              thinkingActive = false;
              accThinking = evt.content || accThinking;
              setLiveThinking(accThinking);
            } else if (evt.type === "sources") {
              accSources = (evt.sources ?? []).filter((s: Source) => s.url && !s.url.startsWith("about:"));
              accConfidence = evt.confidence;
              accImages = evt.images ?? [];
            } else if (evt.type === "token") {
              // First token → hide thinking, show message bubble
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                thinkingActive = false;
                setThinkingStage(null);

                // Now add the streaming message placeholder
                setMessages((prev) => {
                  if (isRegenerate) {
                    const idx = [...prev].map((m, i) => ({ m, i })).reverse()
                      .find((x) => x.m.role === "assistant" && !x.m.streaming)?.i;
                    if (idx !== undefined) {
                      assistantIdx.current = idx;
                      const updated = [...prev];
                      const existing = updated[idx];
                      const existingVariants = existing.variants && existing.variants.length > 0
                        ? [...existing.variants]
                        : (existing.text ? [existing.text] : []);
                      updated[idx] = {
                        ...existing,
                        text: "",
                        sources: undefined,
                        images: undefined,
                        thinking: undefined,
                        suggestions: undefined,
                        streaming: true,
                        thinkingStreaming: false,
                        variants: existingVariants,
                        activeVariant: existingVariants.length,
                      };
                      return updated;
                    }
                  }
                  assistantIdx.current = prev.length;
                  return [...prev, { role: "assistant", text: "", timestamp: Date.now(), streaming: true, thinking: accThinking || undefined, thinkingStreaming: false }];
                });
                window.setTimeout(() => {
                  document.querySelector(`[data-answer-index="${assistantIdx.current}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 80);
              }

              setMessages((prev) => {
                const idx = assistantIdx.current;
                if (idx < 0 || idx >= prev.length) return prev;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], text: updated[idx].text + evt.content };
                return updated;
              });
            } else if (evt.type === "done") {
              const thinkDurationSec = thinkStartedAt
                ? Math.round((Date.now() - thinkStartedAt) / 1000)
                : Math.round((Date.now() - thinkingStart) / 1000);
              setThinkingStage(null);
              setLiveThinking("");

              // Capture routing + agent metadata for FlowTimeline and structured cards
              if (evt?.metadata && typeof evt.metadata === "object") {
                accMetadata = { ...accMetadata, ...evt.metadata };
              }

              const maybeEvaluator = evt?.metadata?.evaluator;
              if (maybeEvaluator && typeof maybeEvaluator === "object") {
                accEvaluator = {
                  input_sources: Number(maybeEvaluator.input_sources ?? 0),
                  selected_sources: Number(maybeEvaluator.selected_sources ?? 0),
                  avg_score: Number(maybeEvaluator.avg_score ?? 0),
                };
              }

              // Grab suggestions from done event
              if (evt.suggestions && Array.isArray(evt.suggestions)) {
                accSuggestions = evt.suggestions;
              }

              if (!firstTokenReceived) {
                // Memory answer or direct response - no tokens were streamed
                firstTokenReceived = true;
                thinkingActive = false;

                // If done event has answer text, add it
                if (evt.answer) {
                  setMessages((prev) => {
                    assistantIdx.current = prev.length;
                    return [...prev, {
                      role: "assistant",
                      text: stripSuggestionSection(evt.answer),
                      timestamp: Date.now(),
                      streaming: false,
                      thinking: accThinking || undefined,
                      thinkDurationSec,
                      suggestions: accSuggestions.length ? accSuggestions : undefined,
                      sources: accSources.length ? accSources : undefined,
                      confidence: accConfidence,
                      images: accImages.length ? accImages : undefined,
                      evaluator: accEvaluator,
                      metadata: accMetadata,
                    }];
                  });
                }
              }

              setMessages((prev) => {
                const idx = assistantIdx.current;
                if (idx < 0 || idx >= prev.length) return prev;
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  text: stripSuggestionSection(updated[idx].text),
                  streaming: false, thinkingStreaming: false,
                  sources: accSources.length ? accSources : undefined,
                  confidence: accConfidence,
                  images: accImages.length ? accImages : undefined,
                  thinking: accThinking || undefined,
                  thinkDurationSec,
                  suggestions: accSuggestions.length ? accSuggestions : undefined,
                  evaluator: accEvaluator,
                  metadata: accMetadata ? { ...updated[idx].metadata, ...accMetadata } : updated[idx].metadata,
                };
                if (isRegenerate) {
                  const history = updated[idx].variants && updated[idx].variants.length > 0
                    ? [...updated[idx].variants]
                    : [];
                  const candidate = updated[idx].text;
                  if (candidate && history[history.length - 1] !== candidate) {
                    history.push(candidate);
                  }
                  updated[idx].variants = history;
                  updated[idx].activeVariant = Math.max(history.length - 1, 0);
                }
                return updated;
              });
              void thinkingActive;
            }
          } catch { /* skip bad JSON */ }
        }
      }

      // Finalize
      setThinkingStage(null);
      setLiveThinking("");
      setMessages((prev) => {
        const idx = assistantIdx.current;
        if (idx < 0 || idx >= prev.length) return prev;
        if (prev[idx].streaming) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx], streaming: false, thinkingStreaming: false,
            sources: accSources.length ? accSources : undefined,
            confidence: accConfidence,
            images: accImages.length ? accImages : undefined,
            thinking: accThinking || undefined,
            suggestions: accSuggestions.length ? accSuggestions : undefined,
            evaluator: accEvaluator,
            metadata: accMetadata ? { ...updated[idx].metadata, ...accMetadata } : updated[idx].metadata,
          };
          if (isRegenerate) {
            const history = updated[idx].variants && updated[idx].variants.length > 0
              ? [...updated[idx].variants]
              : [];
            const candidate = stripSuggestionSection(updated[idx].text);
            if (candidate && history[history.length - 1] !== candidate) {
              history.push(candidate);
            }
            updated[idx].variants = history;
            updated[idx].activeVariant = Math.max(history.length - 1, 0);
            updated[idx].text = candidate;
          }
          return updated;
        }
        return prev;
      });

      void loadSessions();
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // User stopped
      setThinkingStage(null);
      setLiveThinking("");

      // Auto-retry the sync (non-streaming) endpoint with exponential backoff.
      // A failed stream is usually a Render cold start (the free-tier backend
      // sleeps after idle and can take 30–60s to wake), so the backoff must be
      // patient enough to outlast a cold boot before we surface a hard error.
      if (!isRegenerate) {
        warmBackend();
        const backoffsMs = [2000, 5000, 10000, 20000];
        for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
          if (controller.signal.aborted) return; // user stopped during backoff
          if (attempt > 0) setThinkingStage("composing");
          try {
            const retryRes = await fetch(`${API}/api/v1/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: uid,
                session_id: currentSession,
                query: backendQuery,
                metadata: {
                  product_mode: detectedMode,
                  answer_style: answerStyle,
                  layout_preference: "auto",
                },
                language: "auto",
                model: selectedModel || undefined,
                use_web: true,
                deep_think: false,
              }),
              signal: controller.signal,
            });
            if (retryRes.ok) {
              const data = await retryRes.json();
              if (data.answer && data.answer.length > 20) {
                setThinkingStage(null);
                setMessages((prev) => [...prev, {
                  role: "assistant" as const,
                  text: stripSuggestionSection(data.answer),
                  sources: data.sources || [],
                  images: data.images || [],
                  suggestions: data.suggestions || [],
                  thinking: data.thinking || "",
                  confidence: data.confidence || "medium",
                  timestamp: Date.now(),
                }]);
                void loadSessions();
                return;
              }
            }
          } catch (retryErr) {
            if ((retryErr as Error).name === "AbortError") return; // user stopped
            // Otherwise this attempt failed — fall through to backoff/next attempt.
          }
          // Wait before the next attempt only — no pointless sleep after the last
          // one. The wait is abortable so "Stop" cancels it instead of hanging.
          if (attempt < backoffsMs.length - 1) {
            try {
              await new Promise<void>((resolve, reject) => {
                const timer = window.setTimeout(resolve, backoffsMs[attempt]);
                controller.signal.addEventListener(
                  "abort",
                  () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); },
                  { once: true },
                );
              });
            } catch {
              return; // aborted during backoff
            }
          }
        }
        setThinkingStage(null);

        // Final fallback: show a helpful message
        setMessages((prev) => [...prev, {
          role: "assistant" as const,
          text: "Something went wrong while connecting to Credon Brain. I saved your question as a draft and tried the fallback route. You can retry, switch model in settings, or copy your question safely.",
          confidence: "low",
          timestamp: Date.now(),
          suggestions: ["Try my question again", "Rephrase this request", "Start a fresh chat"],
        }]);
      }
    } finally {
      setLoading(false);
      setReplyTo(null);
      setLiveThinking("");
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await send(query);
  };

  const quickRewrite = async (assistantIndex: number, style: "summarize" | "simple" | "tldr") => {
    const assistant = messages[assistantIndex];
    if (!assistant || assistant.role !== "assistant") return;
    const prompts: Record<string, string> = {
      summarize: `Summarize the following in 5 concise bullet points:\n\n${assistant.text.slice(0, 1500)}`,
      simple: `Explain the following in very simple words, like I'm a beginner. Use short sentences:\n\n${assistant.text.slice(0, 1500)}`,
      tldr: `Give me a TL;DR (one paragraph, max 3 sentences) of the following:\n\n${assistant.text.slice(0, 1500)}`,
    };
    await send(prompts[style] || prompts.simple);
  };

  /* Handle Enter key (Shift+Enter for newline) */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (query.trim() && !loading) void send(query);
    }
  };

  const speakSentence = (messageIndex: number, sentenceIndex: number, options?: { restart?: boolean }) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return;
    const sentences = splitSentences(message.text);
    const sentence = sentences[sentenceIndex];
    if (!sentence) return;
    if (options?.restart) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = ttsVoiceLang;
    utterance.rate = ttsRate;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (sentenceIndex < sentences.length - 1) {
        setTtsSentenceIndex(sentenceIndex + 1);
        speakSentence(messageIndex, sentenceIndex + 1, { restart: false });
        return;
      }
      setSpeakingIndex(null);
      setTtsPaused(false);
    };
    utterance.onerror = () => {
      setSpeakingIndex(null);
      setTtsPaused(false);
    };
    ttsUtteranceRef.current = utterance;
    setSpeakingIndex(messageIndex);
    setTtsPanelIndex(messageIndex);
    setTtsSentenceIndex(sentenceIndex);
    setTtsPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const speakAnswer = (idx: number, text: string) => {
    if (ttsMuted) {
      setTtsPanelIndex((prev) => prev === idx ? null : idx);
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const sentences = splitSentences(text);
    if (!sentences.length) return;
    if (speakingIndex === idx) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      setTtsPaused(false);
      return;
    }
    speakSentence(idx, 0, { restart: true });
  };

  const pauseTts = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.pause();
    setTtsPaused(true);
  };

  const resumeTts = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.resume();
    setTtsPaused(false);
  };

  const stopTts = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
    setSpeakingIndex(null);
    setTtsPaused(false);
  };

  const seekTts = (messageIndex: number, sentenceIndex: number) => {
    speakSentence(messageIndex, sentenceIndex, { restart: true });
  };

  const startVoiceInput = () => {
    if (typeof window === "undefined") return;
    const recognitionWindow = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = recognitionWindow.SpeechRecognition ?? recognitionWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setUploadError("Voice input is not supported in this browser.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = ttsVoiceLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setQuery((prev) => `${prev}${prev ? " " : ""}${transcript}`);
    };
    recognition.onerror = () => setUploadError("Voice input stopped. Please try again.");
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
    setInputMenuOpen(false);
  };

  const renameChat = async (sessionId: string, currentPreview: string) => {
    const next = window.prompt("Rename chat", currentPreview || "New conversation");
    if (!next?.trim()) return;
    setSessions((prev) => prev.map((s) => s.session_id === sessionId ? { ...s, preview: next.trim() } : s));
    await fetch(`${API}/api/v1/chats/${uid}/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview: next.trim() }),
    });
  };

  const deleteChat = async (sessionId: string) => {
    if (!window.confirm("Delete this chat history?")) return;
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    setPinnedSessions((prev) => prev.filter((id) => id !== sessionId));
    if (currentSession === sessionId) newChat();
    await fetch(`${API}/api/v1/chats/${uid}/${sessionId}`, { method: "DELETE" });
  };

  const copyText = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(index);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyCodeText = (code: string) => {
    if (!code.trim()) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1800);
  };

  const shareAssistantMessage = async (index: number, message: Message) => {
    const answerText = stripSuggestionSection(message.text).trim();
    const payloadText = `Credon AI\n\nAnswer preview:\n${answerText}\n\nGenerated by Credon AI`;
    if (!answerText) return;

    try {
      if (browserSupportsNativeShare) {
        await navigator.share({
          title: "Credon AI Answer",
          text: payloadText,
          url: typeof window !== "undefined" ? window.location.href : undefined,
        });
        setShared(index);
        setTimeout(() => setShared(null), 1800);
        return;
      }
      await navigator.clipboard.writeText(payloadText);
      setShared(index);
      setTimeout(() => setShared(null), 1800);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setUploadError("Could not share this answer right now.");
    }
  };

  const shareAssistantToChannel = async (channel: "native" | "copy" | "whatsapp" | "email" | "sms", index: number, message: Message) => {
    const answerText = stripSuggestionSection(message.text).trim();
    const payloadText = `Credon AI\n\nAnswer preview:\n${answerText}\n\nGenerated by Credon AI`;
    if (!answerText) return;
    const encoded = encodeURIComponent(payloadText);

    if (channel === "native") {
      await shareAssistantMessage(index, message);
      setShareMenuTarget(null);
      return;
    }

    if (channel === "copy") {
      await navigator.clipboard.writeText(payloadText);
      setShared(index);
      setTimeout(() => setShared(null), 1800);
      setShareMenuTarget(null);
      return;
    }

    const href =
      channel === "whatsapp"
        ? `https://wa.me/?text=${encoded}`
        : channel === "email"
          ? `mailto:?subject=${encodeURIComponent("Credon AI Answer")}&body=${encoded}`
          : `sms:?&body=${encoded}`;

    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
    setShared(index);
    setTimeout(() => setShared(null), 1800);
    setShareMenuTarget(null);
  };

  const showVariant = (index: number, direction: "prev" | "next") => {
    setMessages((prev) => {
      const next = [...prev];
      const message = next[index];
      if (!message || message.role !== "assistant" || !message.variants || message.variants.length < 2) {
        return prev;
      }
      const active = message.activeVariant ?? (message.variants.length - 1);
      const delta = direction === "prev" ? -1 : 1;
      const target = active + delta;
      if (target < 0 || target >= message.variants.length) return prev;
      next[index] = {
        ...message,
        activeVariant: target,
        text: message.variants[target],
      };
      return next;
    });
  };

  const exportAnswerPdf = async (assistantIndex: number) => {
    const assistant = messages[assistantIndex];
    if (!assistant || assistant.role !== "assistant") return;
    const prevUser = [...messages].slice(0, assistantIndex).reverse().find((m) => m.role === "user");
    const title = prevUser?.text?.slice(0, 80) || "Credon Answer";
    try {
      const r = await fetch(`${API}/api/v1/generate/export/answer-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: assistant.text, user_id: uid }),
      });
      if (!r.ok) throw new Error("export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `credon-answer-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setUploadError("Export failed. Retry, try text export, or copy the answer.");
    }
  };

  const openChatPdfBlob = (blob: Blob, filename: string, action: "download" | "view") => {
    const url = URL.createObjectURL(blob);
    if (action === "view") {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setUploadError("Preview was blocked by the browser, so the PDF was downloaded instead.");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCurrentChatPdf = async (action: "download" | "view") => {
    try {
      const r = await fetch(`${API}/api/v1/generate/export/chat-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, session_id: currentSession }),
      });
      if (!r.ok) throw new Error("download_failed");
      const blob = await r.blob();
      openChatPdfBlob(blob, `credon-chat-${currentSession}.pdf`, action);
    } catch {
      setUploadError(`Export failed. Retry, try text export, or copy the chat.`);
    }
  };

  const exportAllChatsPdf = async (action: "download" | "view") => {
    try {
      const r = await fetch(`${API}/api/v1/generate/export/all-chats-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid }),
      });
      if (!r.ok) throw new Error("download_failed");
      const blob = await r.blob();
      openChatPdfBlob(blob, "credon-all-chats.pdf", action);
    } catch {
      setUploadError(`Export failed. Retry, try text export, or copy the chats.`);
    }
  };

  const downloadCurrentChatPdf = async () => exportCurrentChatPdf("download");
  const downloadAllChatsPdf = async () => exportAllChatsPdf("download");
  const previewCurrentChatPdf = async () => exportCurrentChatPdf("view");
  const previewAllChatsPdf = async () => exportAllChatsPdf("view");

  const exportSessionChatPdf = async (sessionId: string, action: "download" | "view") => {
    try {
      const r = await fetch(`${API}/api/v1/generate/export/chat-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, session_id: sessionId }),
      });
      if (!r.ok) throw new Error("download_failed");
      const blob = await r.blob();
      openChatPdfBlob(blob, `credon-chat-${sessionId}.pdf`, action);
    } catch {
      setUploadError(`Export failed. Retry, try text export, or copy this session.`);
    }
  };

  const previewSessionPdf = (sessionId: string) => { void exportSessionChatPdf(sessionId, "view"); };
  const downloadSessionPdf = (sessionId: string) => { void exportSessionChatPdf(sessionId, "download"); };

  const regenerateAt = async (assistantIndex: number) => {
    const prevUser = [...messages].slice(0, assistantIndex).reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    await send(prevUser.text, { regenerate: true });
  };

  const editUserMessage = (index: number, text: string) => {
    setEditingIndex(index);
    setQuery(text);
    inputRef.current?.focus();
  };

  const quickFixCodeFromMessage = async (index: number) => {
    const msg = messages[index];
    if (!msg || msg.role !== "user") return;
    if (!isCodeLike(msg.text)) return;
    const fixPrompt = `Please review and fix this code. Explain what was wrong, then provide a corrected version and quick test/run steps. Keep explanation Hinglish if I asked in Hinglish.\n\n${msg.text}`;
    if (!isGuest) {
      setCodeMode(true);
      if (typeof window !== "undefined") localStorage.setItem("credon-code-mode", "1");
    }
    await send(fixPrompt, { replyContext: msg.text.slice(0, 700) });
  };

  const submitFeedback = async (
    messageIndex: number,
    vote: "up" | "down",
    category?: FeedbackCategory,
    reason?: string,
  ) => {
    const msg = messages[messageIndex];
    if (!msg || msg.role !== "assistant") return;

    if (vote === "down" && !category && feedbackTarget === null) {
      setFeedbackTarget(messageIndex);
      return;
    }

    if (vote === "down") {
      setFeedbackBusy(true);
    }

    setMessages((prev) => {
      const updated = [...prev];
      updated[messageIndex] = { ...updated[messageIndex], feedback: vote };
      return updated;
    });
    try {
      await fetch(`${API}/api/v1/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid,
          session_id: currentSession,
          message_text: msg.text,
          vote,
          category: vote === "down" ? category : undefined,
          reason: vote === "down" ? reason : undefined,
        }),
      });
    } catch { /* non-blocking */ }
    finally {
      if (vote === "down") {
        setFeedbackBusy(false);
        setFeedbackTarget(null);
      }
    }
  };

  /* Session groups */
  const grouped = useMemo(() => {
    const g: Record<string, SessionSummary[]> = {};
    const filtered = sessions.filter((session) =>
      session.preview.toLowerCase().includes(chatSearch.toLowerCase()) ||
      session.session_id.toLowerCase().includes(chatSearch.toLowerCase())
    );
    const ordered = [...filtered].sort((a, b) => Number(pinnedSessions.includes(b.session_id)) - Number(pinnedSessions.includes(a.session_id)));
    for (const s of ordered) {
      const label = pinnedSessions.includes(s.session_id) ? "Pinned" : dateLabel(s.last_updated);
      (g[label] ??= []).push(s);
    }
    return g;
  }, [sessions, chatSearch, pinnedSessions]);

  return (
    <div className={`h-dvh flex overflow-hidden ambient-grid ${shellClass} ${answerFontClass}`}>
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        webSearch={useWeb}
        setWebSearch={setUseWeb}
        deepThink={deepThink}
        setDeepThink={(v) => {
          setDeepThink(v);
          if (typeof window !== "undefined") localStorage.setItem("credon-deep-think", v ? "1" : "0");
        }}
        codeMode={codeMode}
        setCodeMode={(v) => {
          if (isGuest) {
            setLoginPrompt("code-mode");
            return;
          }
          setCodeMode(v);
          if (typeof window !== "undefined") localStorage.setItem("credon-code-mode", v ? "1" : "0");
        }}
        appearance={appearance}
        setAppearance={setAppearance}
        fontScale={fontScale}
        setFontScale={setFontScale}
        isGuest={isGuest}
        onRequireLogin={(feature) => setLoginPrompt(feature)}
        onDownloadCurrentChat={downloadCurrentChatPdf}
        onDownloadAllChats={downloadAllChatsPdf}
        onPreviewCurrentChat={previewCurrentChatPdf}
        onPreviewAllChats={previewAllChatsPdf}
        onPreviewSessionPdf={previewSessionPdf}
        onDownloadSessionPdf={downloadSessionPdf}
        recentSessions={sessions}
        fcmStatus={fcmStatus}
        onEnableNotifications={handleEnableNotifications}
      />
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <UpdatesModal open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
      <KnowledgeUploadModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} uid={uid} />
      <DislikeFeedbackModal
        key={feedbackTarget ?? -1}
        open={feedbackTarget !== null}
        busy={feedbackBusy}
        onClose={() => { if (!feedbackBusy) setFeedbackTarget(null); }}
        onSubmit={(category, reason) => { if (feedbackTarget !== null) void submitFeedback(feedbackTarget, "down", category, reason); }}
      />

      {/* Hidden file input */}
        <label htmlFor="chat-image-upload" className="sr-only">Attach image or PDF files</label>
        <input id="chat-image-upload" ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleFileSelect} aria-label="Attach image or PDF files" />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} aria-label="Take a photo" />

      {/* ─── Sidebar (DeepSeek-style) ─── */}
      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-70 bg-zinc-950/75 backdrop-blur-2xl border-r border-cyan-400/10 flex flex-col transition-transform duration-200 ease-out md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Sidebar header — clean, just new chat */}
        <div className="h-14 flex items-center justify-between px-3 shrink-0 border-b border-zinc-800/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center overflow-hidden">
              <CredonLogo size={22} />
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">CREDON-AI</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={newChat} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition" title="New chat">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" />
              </svg>
            </button>
            <button type="button" onClick={() => setSidebarOpen(false)} className="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition" title="Close sidebar">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="px-3 pt-3 space-y-2">
          <input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search chats" className="w-full rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-500/40" />
          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-400">
            {["Personal", "Study", "Coding", "Startup", "Research"].map((folder) => <span key={folder} className="rounded-lg border border-zinc-800/70 bg-zinc-900/45 px-2 py-1">{folder}</span>)}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-3 mt-2">
          {Object.entries(grouped).map(([label, items]) => items.length === 0 ? null : (
            <div key={label}>
              <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-2 mb-1.5">{label}</p>
              <div className="space-y-0.5">
                {items.map((s) => (
                  <div key={s.session_id} className={`sidebar-item group rounded-xl border transition ${currentSession === s.session_id ? "bg-cyan-500/10 text-white border-cyan-500/20" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 border-transparent"}`}>
                    <button type="button" onClick={() => { stopGeneration(); setCurrentSession(s.session_id); setSidebarOpen(false); }} className="w-full text-left px-3 pt-2.5 pb-1.5 text-sm truncate flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
                      <span className="truncate">{s.preview || "New conversation"}</span>
                    </button>
                    <div className="flex gap-1 px-3 pb-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                      <button type="button" onClick={() => setPinnedSessions((prev) => prev.includes(s.session_id) ? prev.filter((id) => id !== s.session_id) : [...prev, s.session_id])} className="text-[10px] text-zinc-500 hover:text-cyan-300">{pinnedSessions.includes(s.session_id) ? "Unpin" : "Pin"}</button>
                      <button type="button" onClick={() => { void renameChat(s.session_id, s.preview); }} className="text-[10px] text-zinc-500 hover:text-cyan-300">Rename</button>
                      <span className="text-[10px] text-zinc-700">•</span>
                      <button type="button" onClick={() => { void deleteChat(s.session_id); }} className="text-[10px] text-zinc-500 hover:text-rose-300">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-center mt-12 px-4">
              <svg className="w-10 h-10 text-zinc-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
              <p className="text-xs text-zinc-600">No conversations yet</p>
              <p className="text-[10px] text-zinc-700 mt-1">Start a new chat to begin</p>
            </div>
          )}
        </nav>
        <div className="border-t border-zinc-800/60">
          <div className="px-3 pt-3 pb-1 flex gap-3">
            <button type="button" onClick={() => setPrivacyOpen(true)} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition">Privacy</button>
            <span className="text-zinc-700 text-[11px]">&middot;</span>
            <button type="button" onClick={() => setUpdatesOpen(true)} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition">Updates</button>
            <span className="text-zinc-700 text-[11px]">&middot;</span>
            <button type="button" onClick={() => setSettingsOpen(true)} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition">Settings</button>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0 shadow-lg shadow-cyan-500/10">{displayName[0]?.toUpperCase() ?? "G"}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{displayName}</p>
                <p className="text-[11px] text-zinc-500">{isGuest ? "Guest mode" : "Signed in"}</p>
              </div>
              <button type="button" onClick={onSignOut} title={isGuest ? "Back to login" : "Sign out"} className="text-zinc-500 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main ─── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-cyan-400/10 flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0 bg-zinc-950/55 backdrop-blur-2xl">
          {/* Sidebar toggle — panel icon */}
          <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition" title="Toggle sidebar">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <span className="font-semibold tracking-tight text-sm sm:text-base bg-linear-to-r from-white to-zinc-300 bg-clip-text text-transparent">CREDON-AI</span>
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 px-2 sm:px-3 py-1.5 rounded-lg border border-zinc-700/40 transition" title="Settings">
            <span className="hidden sm:inline">Credon Alpha 1</span>
            <span className="sm:hidden">Settings</span>
          </button>
        </header>

        {/* Messages / Welcome */}
        <div ref={transcriptRef} onScroll={updateAutoScrollIntent} className="flex-1 overflow-y-auto">
          {isEmptyChat ? (
            <div className="h-full flex flex-col items-center justify-center px-4 sm:px-6 -mt-10">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-5 sm:mb-6 shadow-xl shadow-cyan-500/20 overflow-hidden">
                <CredonLogo size={40} />
              </div>
              <h2 className="welcome-title text-3xl sm:text-4xl md:text-5xl font-extrabold text-center tracking-tight mb-3 bg-linear-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent leading-tight">How can I help you?</h2>
              <p className="welcome-subtitle text-zinc-500 text-sm sm:text-base mb-8 text-center max-w-md leading-relaxed font-medium">
                Search, reason, create, and solve — powered by multi-model AI.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full max-w-lg">
                {homeSuggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}
                    className="suggestion-chip text-left rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-4 py-3.5 text-sm text-zinc-300 hover:bg-zinc-800/70 hover:text-white hover:border-cyan-500/30 transition-all group">
                    <span className="group-hover:text-cyan-300 transition">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : transcriptLoading ? (
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-4">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex gap-3 items-start animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-zinc-800" />
                  <div className="flex-1">
                    <div className="h-3 w-32 bg-zinc-800 rounded mb-2" />
                    <div className="h-4 w-full bg-zinc-800 rounded mb-1.5" />
                    <div className="h-4 w-11/12 bg-zinc-800 rounded mb-1.5" />
                    <div className="h-4 w-10/12 bg-zinc-800 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-w-[95%] sm:max-w-4xl mx-auto px-2 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">
              {messages.map((m, i) => (
                <div key={i} data-answer-index={m.role === "assistant" ? i : undefined} className={`message-bubble flex gap-2.5 sm:gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  {/* Avatar */}
                  <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 overflow-hidden ${
                    m.role === "assistant" ? "bg-linear-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/10" : "bg-zinc-700"
                  }`}>
                    {m.role === "assistant" ? <CredonLogo size={22} /> : <span className="text-[10px] sm:text-[11px] font-bold">{displayName[0]?.toUpperCase() ?? "U"}</span>}
                  </div>

                  {/* Content */}
                  <div className={`flex flex-col max-w-[95%] sm:max-w-[88%] min-w-0 ${m.role === "user" ? "items-end" : "items-start"}`}>
                    {/* Reply context (WhatsApp-style) */}
                    {m.replyTo && (
                      <div className="mb-1 rounded-lg bg-zinc-800/50 border-l-2 border-cyan-500/60 px-3 py-1.5 max-w-full">
                        <p className="text-[11px] text-zinc-500 truncate">{m.replyTo.slice(0, 100)}</p>
                      </div>
                    )}

                    {/* Attached files preview */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {m.attachments.map((att, ai) => (
                          att.type === "image" && att.url ? (
                            <Image
                              key={ai}
                              src={att.url}
                              alt={att.name}
                              width={80}
                              height={80}
                              unoptimized
                              className="w-20 h-20 rounded-lg object-cover border border-zinc-700/40"
                            />
                          ) : (
                            <div key={ai} className="h-20 px-3 rounded-lg border border-zinc-700/40 bg-zinc-900/70 flex items-center text-xs text-zinc-300">
                              PDF: {att.name}
                            </div>
                          )
                        ))}
                      </div>
                    )}

                    {/* Thinking block — shown BEFORE answer like DeepSeek */}
                    {m.role === "assistant" && m.thinking && !m.streaming && (
                      <div className="mb-1">
                        <ThinkingBlock thinking={m.thinking} durationSec={m.thinkDurationSec} />
                      </div>
                    )}

                    {m.role === "assistant" && m.text !== GREET && (
                      <details className="group mb-1.5 text-[10px] text-zinc-500">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-zinc-800/70 bg-zinc-950/45 px-2 py-0.5 hover:border-cyan-500/25 hover:text-zinc-300">
                          <span>{inferIntentLabel([...messages.slice(0, i)].reverse().find((item) => item.role === "user")?.text ?? m.text, m).replace(" selected", "")}</span>
                          <span className="text-zinc-700">Details</span>
                        </summary>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {contextBadges(m).map((badge) => (
                            <span key={badge} className="rounded-full border border-zinc-800/70 bg-zinc-900/70 px-2 py-0.5">Using: ✓ {badge}</span>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Bubble */}
                    <div className={`rounded-2xl px-4 py-3 ${
                      m.role === "user"
                        ? "bg-white/8 border border-cyan-400/30 text-white rounded-tr-md shadow-lg shadow-cyan-500/10 backdrop-blur-lg"
                        : "bg-zinc-900/60 border border-zinc-700/40 rounded-tl-md backdrop-blur-md"
                    }`}>
                      {(() => {
                        if (!(m.role === "assistant" && !m.streaming && m.text.length > 280)) return null;
                        const previousUserQuery = [...messages.slice(0, i)].reverse().find((item) => item.role === "user")?.text ?? "";
                        if (!isObjectiveQuestionPrompt(previousUserQuery)) return null;
                        const points = extractMainPoints(m.text);
                        if (!points.length) return null;
                        return (
                        <div className="mb-2.5 rounded-xl border border-cyan-500/25 bg-cyan-500/6 p-2.5">
                          <p className="text-[11px] font-medium text-cyan-200 mb-2 tracking-wide uppercase">Main Points</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {points.map((point, idx) => (
                              <div key={idx} className="rounded-lg border border-cyan-500/20 bg-zinc-900/65 px-2.5 py-2 text-[11px] text-zinc-200 leading-relaxed">
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-200 text-[10px] mr-1.5 align-middle">{idx + 1}</span>
                                <span className="align-middle">{point}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      })()}
                      {m.role === "assistant" && m.text !== GREET ? (
                        <>
                        <div className="prose prose-invert prose-sm max-w-none text-[var(--answer-size)] leading-relaxed [&_pre]:bg-zinc-900/80 [&_pre]:border [&_pre]:border-zinc-700/30 [&_pre]:rounded-xl [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:text-cyan-300 [&_code]:text-[13px] [&_a]:text-cyan-400 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-cyan-500/30 hover:[&_a]:decoration-cyan-500 [&_h1]:text-xl [&_h1]:tracking-tight [&_h2]:text-lg [&_h2]:tracking-tight [&_h3]:text-base [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-medium [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-500/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-300 [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-700 [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-zinc-800 [&_td]:border [&_td]:border-zinc-700 [&_td]:px-3 [&_td]:py-1.5 [&_hr]:border-zinc-700/50 [&_strong]:text-zinc-100 [&_strong]:font-semibold [&_strong]:bg-cyan-400/10 [&_strong]:px-1.5 [&_strong]:py-0.5 [&_strong]:rounded-md [&_li]:marker:text-cyan-300 [&_p:first-of-type]:text-zinc-100 [&_p:first-of-type]:font-medium">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              pre: ({ children }) => {
                                const codeText = extractCodeFromPre(children);
                                return (
                                  <div className="relative group my-3">
                                    <button
                                      type="button"
                                      onClick={() => copyCodeText(codeText)}
                                      className="absolute top-2 right-2 z-10 rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-200 opacity-90 hover:opacity-100"
                                      title="Copy code"
                                    >
                                      {copiedCode === codeText ? "Copied" : "Copy"}
                                    </button>
                                    <pre>{children}</pre>
                                  </div>
                                );
                              },
                            }}
                          >
                            {stripSpecialBlocks(m.text) || (m.streaming ? "\u200B" : "")}
                          </ReactMarkdown>
                          {m.streaming && <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse rounded-sm ml-0.5 align-text-bottom" />}
                        </div>
                        {(() => { const chart = parseChartBlock(m.text); return chart ? <ChartBlock chart={chart} /> : null; })()}
                        </>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none text-[15px] leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* Images */}
                    {m.role === "assistant" && m.images && <ImageGrid images={m.images} />}

                    {/* Sources */}
                    {m.role === "assistant" && m.sources && m.sources.length > 0 && <SourcesPanel sources={m.sources} />}

                    {/* Power-user routing details: hidden by default so normal users see answer first. */}
                    {m.role === "assistant" && !m.streaming && m.text !== GREET && (
                      <details className="mt-2 w-full max-w-xl text-xs text-zinc-500">
                        <summary className="cursor-pointer list-none rounded-xl border border-zinc-800/60 bg-zinc-950/30 px-3 py-2 hover:border-cyan-500/25 hover:text-zinc-300">
                          Details: sources, confidence, and manager route
                        </summary>
                        <FlowTimeline message={m} />
                        <AgentInsightCard message={m} />
                      </details>
                    )}

                    {/* Confidence */}
                    {m.role === "assistant" && m.confidence === "low" && m.text !== GREET && (
                      <p className="mt-1.5 text-[11px] text-zinc-500 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        This information may not be fully accurate
                      </p>
                    )}

                    {m.role === "assistant" && m.metadata?.mode?.master_mode && !m.streaming && (
                      <p className="mt-1 text-[11px] text-cyan-300/90">Master Mode response: deep reasoning + sources + code optimization</p>
                    )}

                    {m.role === "assistant" && !m.streaming && m.text !== GREET && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800/60 bg-zinc-950/35 px-2 py-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Answer style</span>
                        {ANSWER_STYLES.map((style) => (
                          <button key={style} type="button" onClick={() => { setAnswerStyle(style); void send(`Rewrite the previous answer in ${style} style without changing the facts.`, { replyContext: m.text }); }} className={`rounded-lg px-2 py-1 text-[10px] transition ${answerStyle === style ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200"}`}>{style}</button>
                        ))}
                      </div>
                    )}

                    {/* Actions row */}
                    <div className={`flex flex-wrap items-center gap-1.5 mt-1.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                      <span className="text-[11px] text-zinc-600 mr-1">{fmtTime(m.timestamp)}</span>
                      {m.role === "assistant" && (m.variants?.length ?? 0) > 1 && (
                        <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/50 bg-zinc-900/70 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={() => showVariant(i, "prev")}
                            disabled={(m.activeVariant ?? (m.variants!.length - 1)) <= 0}
                            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                            title="Show previous version"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-[10px] text-zinc-500 px-1">
                            {(m.activeVariant ?? (m.variants!.length - 1)) + 1}/{m.variants!.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => showVariant(i, "next")}
                            disabled={(m.activeVariant ?? (m.variants!.length - 1)) >= (m.variants!.length - 1)}
                            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                            title="Show next version"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>
                      )}

                      {m.role === "assistant" && m.text !== GREET && !m.streaming && (
                        <>
                          {/* Reply */}
                          <button type="button" onClick={() => setReplyTo({ text: m.text, index: i })} className="text-zinc-600 hover:text-cyan-400 transition p-1.5 rounded-lg hover:bg-zinc-800/60" title="Reply to this">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                            </svg>
                          </button>
                          <button type="button" onClick={() => quickRewrite(i, "tldr")} className="hidden sm:inline-flex text-zinc-600 hover:text-zinc-200 transition p-1.5 rounded-lg hover:bg-zinc-800/60 text-[11px] font-medium" title="Summarize this answer">
                            TL;DR
                          </button>
                          <button type="button" onClick={() => quickRewrite(i, "simple")} className="hidden sm:inline-flex text-zinc-600 hover:text-zinc-200 transition p-1.5 rounded-lg hover:bg-zinc-800/60 text-[11px] font-medium" title="Make this simpler">
                            Simplify
                          </button>
                          {/* Regenerate */}
                          <button type="button" onClick={() => regenerateAt(i)} className="text-zinc-600 hover:text-zinc-300 transition p-1.5 rounded-lg hover:bg-zinc-800/60" title="Regenerate">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.94 9.349a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                            </svg>
                          </button>
                          {/* Thumbs up */}
                          <button type="button" onClick={() => submitFeedback(i, "up")}
                            className={`transition p-1.5 rounded-lg hover:bg-zinc-800/60 ${m.feedback === "up" ? "text-emerald-400" : "text-zinc-600 hover:text-emerald-400"}`} title="Good answer">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={m.feedback === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={m.feedback === "up" ? 0 : 2}>
                              <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                            </svg>
                          </button>
                          {/* Thumbs down */}
                          <button type="button" onClick={() => submitFeedback(i, "down")}
                            className={`transition p-1.5 rounded-lg hover:bg-zinc-800/60 ${m.feedback === "down" ? "text-rose-400" : "text-zinc-600 hover:text-rose-400"}`} title="Bad answer">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={m.feedback === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={m.feedback === "down" ? 0 : 2}>
                              <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10zM17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
                            </svg>
                          </button>
                          <button type="button" onClick={() => speakAnswer(i, m.text)} className={`text-zinc-600 hover:text-cyan-300 transition p-1.5 rounded-lg hover:bg-zinc-800/60 ${speakingIndex === i ? "text-cyan-300" : ""}`} title="Read aloud with browser text-to-speech">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" /><path strokeLinecap="round" d="M15.54 8.46a5 5 0 010 7.07M18.36 5.64a9 9 0 010 12.72" /></svg>
                          </button>
                          {/* Copy */}
                          <button type="button" onClick={() => copyText(i, m.text)} className="text-zinc-600 hover:text-zinc-300 transition p-1.5 rounded-lg hover:bg-zinc-800/60" title="Copy">
                            {copied === i ? (
                              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            )}
                          </button>
                          <div className="relative">
                            <button type="button" onClick={() => setShareMenuTarget((prev) => prev === i ? null : i)} className={`transition p-1.5 rounded-lg hover:bg-zinc-800/60 ${shared === i ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-200"}`} title="Share options">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 6l6 6-6 6" />
                              </svg>
                            </button>
                            {shareMenuTarget === i && (
                              <div className="fixed inset-x-3 bottom-24 z-40 rounded-2xl border border-zinc-700/60 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl sm:absolute sm:right-0 sm:bottom-full sm:inset-x-auto sm:mb-2 sm:w-44 sm:rounded-xl sm:p-2">
                                <div className="mb-2 flex items-center justify-between sm:hidden">
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">Share answer</p>
                                  <button
                                    type="button"
                                    onClick={() => setShareMenuTarget(null)}
                                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
                                    title="Close share options"
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[12px] sm:gap-1.5 sm:text-[11px]">
                                  {browserSupportsNativeShare && (
                                    <button type="button" onClick={() => { void shareAssistantToChannel("native", i, m); }} className="rounded-xl border border-zinc-700/50 px-3 py-2.5 text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Share</button>
                                  )}
                                  <button type="button" onClick={() => { void shareAssistantToChannel("copy", i, m); }} className="rounded-xl border border-zinc-700/50 px-3 py-2.5 text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Copy</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("whatsapp", i, m); }} className="rounded-xl border border-zinc-700/50 px-3 py-2.5 text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">WhatsApp</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("email", i, m); }} className="rounded-xl border border-zinc-700/50 px-3 py-2.5 text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Email</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("sms", i, m); }} className="col-span-2 rounded-xl border border-zinc-700/50 px-3 py-2.5 text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">SMS</button>
                                </div>
                              </div>
                            )}
                          </div>
                          <button type="button" onClick={() => exportAnswerPdf(i)} className="text-zinc-600 hover:text-zinc-200 transition p-1.5 rounded-lg hover:bg-zinc-800/60" title="Download as PDF">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
                            </svg>
                          </button>
                        </>
                      )}

                      {m.role === "user" && (
                        <>
                          {isCodeLike(m.text) && (
                            <button type="button" onClick={() => quickFixCodeFromMessage(i)} className="text-zinc-600 hover:text-cyan-300 transition p-1 rounded hover:bg-zinc-800/60 text-[10px] font-medium" title="Fix this code with Code Mode">
                              Fix Code
                            </button>
                          )}
                          <button type="button" onClick={() => copyText(i, m.text)} className="text-zinc-600 hover:text-zinc-300 transition p-1 rounded hover:bg-zinc-800/60" title="Copy">
                            {copied === i ? (
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            )}
                          </button>
                          <button type="button" onClick={() => editUserMessage(i, m.text)} className="text-zinc-600 hover:text-zinc-300 transition p-1 rounded hover:bg-zinc-800/60" title="Edit">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" /></svg>
                          </button>
                        </>
                      )}
                    </div>

                    {m.role === "assistant" && ttsPanelIndex === i && m.text !== GREET && (
                      <TtsPanel
                        sentences={splitSentences(m.text)}
                        activeSentence={ttsSentenceIndex}
                        paused={ttsPaused}
                        rate={ttsRate}
                        voiceLang={ttsVoiceLang}
                        onPlay={() => seekTts(i, ttsSentenceIndex)}
                        onPause={pauseTts}
                        onResume={resumeTts}
                        onStop={stopTts}
                        onSeek={(sentenceIndex) => seekTts(i, sentenceIndex)}
                        onRate={(rate) => { setTtsRate(rate); if (speakingIndex === i) seekTts(i, ttsSentenceIndex); }}
                        onVoiceLang={(lang) => { setTtsVoiceLang(lang); if (speakingIndex === i && !ttsMuted) seekTts(i, ttsSentenceIndex); }}
                        muted={ttsMuted}
                        onMuted={setTtsMuted}
                        onClose={() => setTtsPanelIndex(null)}
                      />
                    )}
                  </div>
                </div>
              ))}

              {/* Thinking indicator - shows BEFORE answer starts */}
              {showPreTokenLoader && thinkingStage && <ProgressDots stage={thinkingStage} />}

              {/* Live chain-of-thought while generating — word by word */}
              {showPreTokenLoader && !!liveThinking && (
                <div className="flex gap-3 items-start">
                  <CredonLoadingLogo label="Credon is thinking through your request" />
                  <div className="max-w-2xl w-full">
                    <ThinkingBlock thinking={liveThinking} streaming />
                  </div>
                </div>
              )}

              {/* Connecting dots (very brief, before first SSE event) */}
              {showPreTokenLoader && !thinkingStage && !liveThinking && (
                <div className="flex gap-3">
                  <CredonLoadingLogo label="Credon is connecting" />
                  <div className="bg-zinc-800/80 border border-zinc-700/40 rounded-2xl rounded-tl-md px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite]" />
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.2s]" />
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.4s]" />
                      </div>
                      <span className="text-xs text-zinc-500">Thinking</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Follow-ups */}
        {followUps.length > 0 && !loading && (
          <div className="border-t border-zinc-800/30 bg-[#09090b]/60 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-2 sm:py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] text-zinc-500 font-medium">Related questions</p>
                <button type="button" onClick={() => setFollowUpsDismissed(true)} className="text-zinc-600 hover:text-zinc-300 transition" title="Dismiss suggestions">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {followUps.map((s, i) => (
                  <button key={i} type="button" onClick={() => send(s)}
                    className="suggestion-chip flex min-w-[220px] items-center gap-2 text-xs text-zinc-300 bg-zinc-800/60 hover:bg-cyan-500/10 border border-zinc-700/40 hover:border-cyan-500/30 rounded-xl px-3 py-2.5 transition hover:text-cyan-300 text-left">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-700/60 text-[10px] font-bold text-cyan-400 shrink-0">{i + 1}</span>
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Login prompt banner ─── */}
        {loginPrompt && (
          <div className="border-t border-cyan-500/20 bg-cyan-500/5 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">
              {loginPrompt === "deep-think"
                ? "Sign in to use DeepThink mode"
                : loginPrompt === "web-search"
                  ? "Sign in to use Web Search"
                  : loginPrompt === "code-mode"
                    ? "Sign in to use Code Mode"
                  : "Sign in to upload knowledge"}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setLoginPrompt(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition px-2 py-1 rounded-lg hover:bg-zinc-800/60">Dismiss</button>
              <button type="button" onClick={onSignOut} className="text-xs font-medium text-black bg-cyan-400 hover:bg-cyan-300 px-3 py-1.5 rounded-lg transition">Sign In</button>
            </div>
          </div>
        )}

        {/* ─── Input Area ─── */}
        <div className="border-t border-zinc-800/40 p-2 sm:p-4 bg-zinc-950/70 backdrop-blur-xl">
          {connectionNotice && <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-cyan-400/20 bg-cyan-500/8 px-3 py-2 text-xs text-cyan-100">{connectionNotice}</div>}
          <form onSubmit={onSubmit} className="max-w-3xl mx-auto">
            {/* Editing indicator */}
            {editingIndex !== null && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" /></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-amber-400 font-medium">Editing message</p>
                  <p className="text-xs text-zinc-400 truncate">Messages after this point will be replaced</p>
                </div>
                <button type="button" onClick={() => { setEditingIndex(null); setQuery(""); }} className="text-zinc-500 hover:text-white transition shrink-0" title="Cancel edit">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Reply context chip */}
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-cyan-400 font-medium mb-0.5">Replying to:</p>
                  <p className="text-xs text-zinc-400 truncate">{replyTo.text.slice(0, 120)}</p>
                </div>
                <button type="button" onClick={() => setReplyTo(null)} className="text-zinc-500 hover:text-white transition shrink-0" title="Cancel reply">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Attached files preview */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex gap-2 flex-wrap">
                {attachedFiles.map((item, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-700/40 bg-zinc-900/70">
                    {item.kind === "image" && item.preview ? (
                      <Image src={item.preview} alt="attachment" fill sizes="64px" unoptimized className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-zinc-400 px-1 text-center">
                        <span className="text-xs">PDF</span>
                        <span className="truncate w-full">{item.file.name}</span>
                      </div>
                    )}
                    <button type="button" onClick={() => removeAttachedFile(i)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center text-[10px]">
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadError && (
              <p className="mb-2 text-[11px] text-amber-300">{uploadError}</p>
            )}

            {!isOnline && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <span>Offline — draft saved on this device.</span>
                <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-amber-300/30 px-2 py-1">Retry</button>
              </div>
            )}
            {isOnline && query && <p className="mb-1 text-[10px] text-zinc-600">Saved draft</p>}

            {allModesActive && (
              <div className="mb-1.5 rounded-xl border border-cyan-400/35 bg-linear-to-r from-cyan-500/12 via-blue-500/8 to-cyan-500/12 px-2.5 py-1 text-[10px] sm:text-[11px] text-cyan-100 trinity-glow">
                <span className="sm:hidden">Master Mode active</span>
                <span className="hidden sm:inline">Master Mode active: Web Search + DeepThink + Code Mode</span>
              </div>
            )}
            <div className="sm:hidden mb-2">
              {mobileModesOpen && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl p-2 shadow-2xl">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isGuest) {
                          setLoginPrompt("code-mode");
                          return;
                        }
                        setCodeMode((prev) => {
                          const next = !prev;
                          if (typeof window !== "undefined") {
                            localStorage.setItem("credon-code-mode", next ? "1" : "0");
                          }
                          return next;
                        });
                      }}
                      className={`h-9 rounded-lg border text-[11px] font-medium transition ${codeMode ? "border-cyan-500/45 bg-cyan-500/12 text-cyan-200" : "border-zinc-700/50 bg-zinc-900/80 text-zinc-400"}`}
                    >
                      Code Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isGuest) {
                          setLoginPrompt("knowledge");
                          return;
                        }
                        setKnowledgeOpen(true);
                        setMobileModesOpen(false);
                      }}
                      className="h-9 rounded-lg border border-zinc-700/50 bg-zinc-900/80 text-[11px] font-medium text-zinc-300 transition hover:border-emerald-500/50 hover:text-emerald-300"
                    >
                      Knowledge
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`flex flex-col gap-2 bg-zinc-900/80 border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 focus-within:border-cyan-500/40 focus-within:shadow-cyan-500/5 transition-all shadow-lg shadow-black/20 ${allModesActive ? "border-cyan-500/45 trinity-glow" : "border-zinc-700/50"}`}>
              <textarea
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={warmBackend}
                onKeyDown={handleKeyDown}
                placeholder="Message Credon AI&#8230;"
                rows={1}
                className="w-full min-h-[2.75rem] bg-transparent px-1 py-1.5 outline-none text-[15px] placeholder:text-zinc-500 resize-none max-h-48 leading-relaxed"
              />
              <div className="flex items-end justify-between gap-2">
              <div className="flex items-center gap-0.5 sm:gap-1.5">
              {/* Attach file button */}
              <div className="relative shrink-0">
              <button type="button" onClick={() => setInputMenuOpen((prev) => !prev)}
                className={`min-h-10 min-w-10 p-2 sm:p-2.5 transition rounded-xl shrink-0 flex items-center justify-center ${inputMenuOpen ? "text-cyan-200 bg-cyan-500/10" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"}`} title="Add image, document, or camera">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </button>
              {inputMenuOpen && (
                <div className="absolute bottom-11 left-0 z-30 w-44 rounded-2xl border border-zinc-700/60 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
                  <button type="button" onClick={() => { fileInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-zinc-200 hover:bg-zinc-800/70">Image upload</button>
                  <button type="button" onClick={() => { fileInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-zinc-200 hover:bg-zinc-800/70">PDF document</button>
                  <button type="button" onClick={() => { cameraInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-zinc-200 hover:bg-zinc-800/70">Camera</button>
                </div>
              )}
              </div>

              <button
                type="button"
                onClick={() => setMobileModesOpen((prev) => !prev)}
                className={`sm:hidden min-h-10 min-w-10 p-2 rounded-xl transition shrink-0 flex items-center justify-center ${mobileModesOpen ? "text-cyan-300 bg-cyan-500/10" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"}`}
                title="Modes"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M7 12h10M10 18h4" />
                </svg>
              </button>

              {/* Web search toggle */}
              <button type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("web-search");
                    return;
                  }
                  setUseWeb((prev) => !prev);
                }}
                className={`flex min-h-10 min-w-10 p-2 sm:p-2.5 rounded-xl transition shrink-0 items-center justify-center ${useWeb ? "text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use Web Search" : useWeb ? "Web search ON" : "Web search OFF"}>
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </button>

              {/* Deep think toggle — guests see sign-in prompt */}
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("deep-think");
                    return;
                  }
                  setDeepThink((prev) => {
                    const next = !prev;
                    if (typeof window !== "undefined") {
                      localStorage.setItem("credon-deep-think", next ? "1" : "0");
                    }
                    return next;
                  });
                }}
                className={`flex min-h-10 min-w-10 p-2 sm:p-2.5 rounded-xl transition shrink-0 items-center justify-center ${deepThink ? "text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use DeepThink" : deepThink ? "DeepThink ON" : "DeepThink OFF"}
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </button>

              {/* Code mode toggle */}
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("code-mode");
                    return;
                  }
                  setCodeMode((prev) => {
                    const next = !prev;
                    if (typeof window !== "undefined") {
                      localStorage.setItem("credon-code-mode", next ? "1" : "0");
                    }
                    return next;
                  });
                }}
                className={`hidden sm:flex min-h-10 min-w-10 p-2.5 rounded-xl transition shrink-0 items-center justify-center ${codeMode ? "text-cyan-300 bg-cyan-500/10 border border-cyan-500/30" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use Code Mode" : codeMode ? "Code Mode ON" : "Code Mode OFF"}
              >
                <span className="text-xs font-bold">&lt;/&gt;</span>
              </button>

              {/* Upload knowledge button — guests see sign-in prompt */}
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("knowledge");
                    return;
                  }
                  setKnowledgeOpen(true);
                }}
                className="hidden sm:flex min-h-10 min-w-10 p-2.5 rounded-xl transition shrink-0 items-center justify-center text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                title={isGuest ? "Sign in to upload knowledge" : "Upload notes, papers, cheat sheets"}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </button>

              </div>
              <div className="flex items-center gap-1.5">
              {/* Voice input button */}
              <button
                type="button"
                onClick={startVoiceInput}
                className={`relative flex min-h-10 min-w-10 items-center justify-center rounded-xl p-2.5 transition shrink-0 mb-0.5 ${listening ? "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/50 shadow-lg shadow-cyan-500/10" : "text-zinc-500 hover:text-cyan-300 hover:bg-cyan-500/10"}`}
                title={listening ? "Listening..." : "Voice input"}
                aria-pressed={listening}
              >
                {listening && <span className="absolute inset-0 rounded-xl bg-cyan-400/10 animate-pulse" aria-hidden="true" />}
                <svg className="relative w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-12 0v1.5a6 6 0 006 6zm0 0v3m-3 0h6M12 15.75a3 3 0 003-3V5.25a3 3 0 10-6 0v7.5a3 3 0 003 3z" />
                </svg>
              </button>

              {/* Send / Stop button */}
              {loading ? (
                <button type="button" onClick={stopGeneration}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-zinc-700 flex items-center justify-center hover:bg-zinc-600 transition shrink-0 mb-0.5" title="Stop">
                  <div className="w-3.5 h-3.5 rounded-sm bg-white" />
                </button>
              ) : (
                <button type="submit" disabled={(!query.trim() && attachedFiles.length === 0) || uploadingFiles}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 flex items-center justify-center disabled:opacity-30 transition hover:brightness-110 shrink-0 mb-0.5" title="Send">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              )}
              </div>
              </div>
            </div>
            {uploadingFiles && uploadStatus && (
              <p className="text-center text-[11px] text-cyan-300 mt-1.5 sm:mt-2 flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-3" />
                <span>{uploadStatus}</span>
              </p>
            )}
            <p className="text-center text-[10px] sm:text-[11px] text-zinc-600 mt-1.5 sm:mt-2 select-none">Credon AI can make mistakes. Verify important information.</p>
          </form>
        </div>
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ROOT
   ══════════════════════════════════════════════════════════════════ */

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [guest, setGuest] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [installPromptEvent, setInstallPromptEvent] = useState<Event | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) {
      const t = setTimeout(() => setChecked(true), 0);
      return () => clearTimeout(t);
    }
    return onAuthStateChanged(firebaseAuth, (u) => { setUser(u); setChecked(true); });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let didRefreshForNewWorker = false;
    const onControllerChange = () => {
      if (didRefreshForNewWorker) return;
      didRefreshForNewWorker = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // Non-fatal in local/dev environments.
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    const dismissedUntil = Number(localStorage.getItem("credon-install-dismiss-until") || "0");
    const iosStandalone = typeof navigator !== "undefined" && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const alreadyInstalled = window.matchMedia("(display-mode: standalone)").matches || iosStandalone;
    if (alreadyInstalled || Date.now() < dismissedUntil) return;

    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
      setShowInstallPrompt(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!checked) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="flex items-center gap-3 text-zinc-400">
        <div className="w-8 h-8 rounded-xl overflow-hidden"><CredonLogo size={32} animate /></div>
        Loading&hellip;
      </div>
    </div>
  );

  if (!user && !guest && showLanding) {
    return (
      <>
        <LandingPage onStart={() => setShowLanding(false)} onTryFree={() => setGuest(true)} />
        <InstallPromptBanner
          active={showInstallPrompt}
          onInstall={async () => {
            const promptEvent = installPromptEvent as ({ prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> } | null);
            if (!promptEvent) return;
            await promptEvent.prompt();
            setShowInstallPrompt(false);
            setInstallPromptEvent(null);
          }}
          onDismiss={() => {
            localStorage.setItem("credon-install-dismiss-until", String(Date.now() + (7 * 24 * 60 * 60 * 1000)));
            setShowInstallPrompt(false);
          }}
        />
      </>
    );
  }

  if (!user && !guest && !firebaseAuth) {
    return (
      <ChatPage
        user={null}
        isGuest
        onSignOut={async () => {
          setGuest(false);
          setShowLanding(true);
        }}
      />
    );
  }

  if (!user && !guest) return <AuthPage onGuest={() => setGuest(true)} />;

  return (
    <>
      <ChatPage user={user} isGuest={!user} onSignOut={async () => { if (firebaseAuth) await signOut(firebaseAuth); setGuest(false); setShowLanding(true); }} />
      <InstallPromptBanner
        active={showInstallPrompt}
        onInstall={async () => {
          const promptEvent = installPromptEvent as ({ prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> } | null);
          if (!promptEvent) return;
          await promptEvent.prompt();
          setShowInstallPrompt(false);
          setInstallPromptEvent(null);
        }}
        onDismiss={() => {
          localStorage.setItem("credon-install-dismiss-until", String(Date.now() + (7 * 24 * 60 * 60 * 1000)));
          setShowInstallPrompt(false);
        }}
      />
    </>
  );
}
