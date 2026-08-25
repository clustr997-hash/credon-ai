export type Source = {
  title: string;
  url: string;
  snippet?: string;
  trust_score?: number | string;
};

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
  available?: boolean;
};

export type ThinkingStage = "planning" | "searching" | "thinking" | "generating" | "composing" | null;

export type AgentStep = {
  id: number;
  kind: "research" | "reason" | "code";
  title: string;
  detail?: string;
  status?: "pending" | "running" | "done";
  terminal?: string[];
};

export type AgentState = {
  goal: string;
  steps: AgentStep[];
  activeTerminal: string[];
} | null;

export type Message = {
  role: "user" | "assistant";
  text: string;
  confidence?: string;
  sources?: Source[];
  images?: ImageResult[];
  thinking?: string;
  thinkDurationSec?: number;
  suggestions?: string[];
  timestamp: number;
  streaming?: boolean;
  thinkingStreaming?: boolean;
  replyTo?: string;
  attachments?: { type: "image" | "pdf"; name: string; url?: string }[];
  agent?: AgentState;
  metadata?: Record<string, unknown>;
  error?: boolean;
};

export type SessionSummary = {
  session_id: string;
  last_updated: string;
  message_count: number;
  preview: string;
};

export type MemoryItem = { id: string; question: string; answer: string; ts?: string };
export type ScheduledJob = {
  id: string;
  goal: string;
  run_at: string;
  repeat: "once" | "daily" | "weekly";
  status: string;
  last_run?: string;
  result_preview?: string;
};
export type WorkspaceFile = { path: string; size: number; preview: string; modified?: string };

export function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const runningLocally = hostname === "localhost" || hostname === "127.0.0.1";
    if (!runningLocally && (!configured || /localhost|127\.0\.0\.1/i.test(configured))) {
      return "https://credon-ai-backend.onrender.com";
    }
  }
  return configured || "http://localhost:8000";
}

export const API = resolveApiBase();
const RENDER_API = "https://credon-ai-backend.onrender.com";

/**
 * Probe candidate backends once and remember the live one.
 * Order: configured/local → Render. Cached for the session.
 */
let liveApiBase: string | null = null;
let probePromise: Promise<string> | null = null;

async function probe(base: string, timeoutMs = 1600): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function getLiveApiBase(): Promise<string> {
  if (liveApiBase) return Promise.resolve(liveApiBase);
  if (!probePromise) {
    probePromise = (async () => {
      const candidates = [API];
      if (API !== RENDER_API) candidates.push(RENDER_API);
      for (const candidate of candidates) {
        if (await probe(candidate)) {
          liveApiBase = candidate;
          return candidate;
        }
      }
      liveApiBase = API; // fall through; direct engine takes over
      return liveApiBase;
    })();
  }
  return probePromise;
}

export function markBackendUnreachable(): void {
  liveApiBase = "__direct__";
}

export function backendReachable(): boolean {
  return liveApiBase !== "__direct__";
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type StreamEvent = Record<string, any> & { type: string };

/** POST an endpoint and consume its `data:` SSE stream. */
export async function streamSSE(
  endpoint: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
  base?: string
): Promise<void> {
  const origin = base || (await getLiveApiBase());
  const response = await fetch(`${origin}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(trimmed.slice(5).trim()));
        } catch {
          /* ignore malformed frames */
        }
      }
    }
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(url))}&sz=64`;
}
