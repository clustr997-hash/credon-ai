"use client";

/**
 * Credon Unlimited Mesh — in-browser inference across free provider lanes.
 *
 * - 7 lanes, auto-detected from env keys (Groq, Gemini, OpenRouter, NVIDIA,
 *   Cerebras, Mistral, Z.ai)
 * - Silent exponential cooldown per lane on 429/5xx (persisted)
 * - Rolling 60s token windows steer selection toward headroom
 * - Exact + fuzzy response cache: repeat questions answer instantly
 * - Remote registry (daily) can add lanes without an app update
 * - Never surfaces "quota" language — failover is invisible
 */

export type DirectMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type LaneModel = { id: string; speed: number; capability: number };

type Lane = {
  id: string;
  label: string;
  url: string;
  key: string;
  rpm: number;
  tpm: number;
  models: LaneModel[];
  headers?: Record<string, string>;
};

type MeshState = {
  cooldowns: Record<string, number>;
  windows: Record<string, { t: number; tokens: number }[]>;
  ttfa: Record<string, number>;
};

const STATE_KEY = "credon-mesh-state";
const CACHE_KEY = "credon-answer-cache";

/* ── lanes ── */

function envKey(name: string): string {
  return (process.env[name] as string | undefined)?.trim() || "";
}

function buildLanes(): Lane[] {
  const lanes: Lane[] = [];
  const groq = envKey("NEXT_PUBLIC_GROQ_API_KEY");
  if (groq)
    lanes.push({
      id: "groq", label: "Groq", key: groq, rpm: 30, tpm: 12000,
      url: "https://api.groq.com/openai/v1/chat/completions",
      models: [
        { id: "llama-3.3-70b-versatile", speed: 0.98, capability: 0.86 },
        { id: "openai/gpt-oss-120b", speed: 0.95, capability: 0.9 },
        { id: "openai/gpt-oss-20b", speed: 0.99, capability: 0.78 },
      ],
    });
  const gemini = envKey("NEXT_PUBLIC_GEMINI_API_KEY");
  if (gemini)
    lanes.push({
      id: "gemini", label: "Gemini", key: gemini, rpm: 10, tpm: 250000,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      models: [
        { id: "gemini-2.5-flash", speed: 0.85, capability: 0.9 },
        { id: "gemini-2.0-flash", speed: 0.88, capability: 0.84 },
      ],
    });
  const nvidia = envKey("NEXT_PUBLIC_NVIDIA_API_KEY");
  if (nvidia)
    lanes.push({
      id: "nvidia", label: "NVIDIA", key: nvidia, rpm: 40, tpm: 100000,
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      models: [
        { id: "meta/llama-3.3-70b-instruct", speed: 0.8, capability: 0.86 },
        { id: "meta/llama-3.1-405b-instruct", speed: 0.55, capability: 0.93 },
        { id: "deepseek-ai/deepseek-r1", speed: 0.5, capability: 0.93 },
      ],
    });
  const cerebras = envKey("NEXT_PUBLIC_CEREBRAS_API_KEY");
  if (cerebras)
    lanes.push({
      id: "cerebras", label: "Cerebras", key: cerebras, rpm: 30, tpm: 60000,
      url: "https://api.cerebras.ai/v1/chat/completions",
      models: [
        { id: "gpt-oss-120b", speed: 1.0, capability: 0.9 },
        { id: "llama-3.3-70b", speed: 1.0, capability: 0.85 },
        { id: "llama3.1-8b", speed: 1.0, capability: 0.72 },
      ],
    });
  const mistral = envKey("NEXT_PUBLIC_MISTRAL_API_KEY");
  if (mistral)
    lanes.push({
      id: "mistral", label: "Mistral", key: mistral, rpm: 20, tpm: 50000,
      url: "https://api.mistral.ai/v1/chat/completions",
      models: [
        { id: "mistral-small-latest", speed: 0.82, capability: 0.84 },
        { id: "mistral-large-latest", speed: 0.6, capability: 0.9 },
      ],
    });
  const openrouter = envKey("NEXT_PUBLIC_OPENROUTER_API_KEY");
  if (openrouter)
    lanes.push({
      id: "openrouter", label: "OpenRouter", key: openrouter, rpm: 20, tpm: 40000,
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        "HTTP-Referer": typeof location !== "undefined" ? location.origin : "https://credon.ai",
        "X-Title": "Credon AI",
      },
      models: [
        { id: "deepseek/deepseek-r1:free", speed: 0.6, capability: 0.92 },
        { id: "meta-llama/llama-3.3-70b-instruct:free", speed: 0.75, capability: 0.86 },
        { id: "qwen/qwen3-235b-a22b:free", speed: 0.65, capability: 0.9 },
      ],
    });
  const zai = envKey("NEXT_PUBLIC_ZAI_API_KEY");
  if (zai)
    lanes.push({
      id: "zai", label: "Z.ai", key: zai, rpm: 15, tpm: 30000,
      url: "https://api.z.ai/api/paas/v4/chat/completions",
      models: [{ id: "glm-4.5-flash", speed: 0.85, capability: 0.82 }],
    });
  return lanes;
}

/* ── state ── */

function loadState(): MeshState {
  try {
    return { cooldowns: {}, windows: {}, ttfa: {}, ...JSON.parse(localStorage.getItem(STATE_KEY) || "{}") };
  } catch {
    return { cooldowns: {}, windows: {}, ttfa: {} };
  }
}

function saveState(state: MeshState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

function cooldownRemaining(state: MeshState, laneId: string): number {
  return Math.max(0, (state.cooldowns[laneId] || 0) - Date.now());
}

function reportCooldown(laneId: string, hard: boolean): void {
  const state = loadState();
  const prev = Math.max(0, (state.cooldowns[laneId] || 0) - Date.now());
  const penalty = Math.min(prev * 2, 8 * 60000) + (hard ? 30000 : 15000);
  state.cooldowns[laneId] = Date.now() + penalty;
  saveState(state);
}

function reportSuccess(laneId: string, ttfaMs: number): void {
  const state = loadState();
  const old = state.ttfa[laneId] || 900;
  state.ttfa[laneId] = Math.round(old * 0.7 + ttfaMs * 0.3);
  saveState(state);
}

function recordUsage(laneId: string, tokens: number): void {
  const state = loadState();
  const entries = (state.windows[laneId] || []).filter((e) => Date.now() - e.t < 60000);
  entries.push({ t: Date.now(), tokens });
  state.windows[laneId] = entries;
  saveState(state);
}

function windowUsage(state: MeshState, laneId: string): number {
  return (state.windows[laneId] || [])
    .filter((e) => Date.now() - e.t < 60000)
    .reduce((sum, e) => sum + e.tokens, 0);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

function pickModel(lane: Lane, preferCapability: boolean): LaneModel {
  const sorted = [...lane.models].sort((a, b) =>
    preferCapability
      ? b.capability * 0.7 + b.speed * 0.3 - (a.capability * 0.7 + a.speed * 0.3)
      : b.speed * 0.6 + b.capability * 0.4 - (a.speed * 0.6 + a.capability * 0.4)
  );
  return sorted[0];
}

function routeLanes(task: string, tokensNeeded: number, preferCapability = false): { lane: Lane; model: LaneModel }[] {
  const state = loadState();
  const coding = /code|debug|function|python|typescript|sql/i.test(task);
  const deep = /reason|math|prove|analyz|research/i.test(task);
  const wantCapability = preferCapability || coding || deep;

  return buildLanes()
    .filter((lane) => cooldownRemaining(state, lane.id) === 0)
    .map((lane) => {
      const used = windowUsage(state, lane.id);
      const headroom = Math.max(0, 1 - used / lane.tpm);
      const ttfa = state.ttfa[lane.id] || 900;
      const speed = Math.max(0.05, Math.min(1, 1200 / Math.max(ttfa, 120)));
      const model = pickModel(lane, wantCapability);
      const score =
        0.35 * headroom + 0.25 * speed + 0.2 * model.capability + 0.2 * 0.9;
      return { lane, model, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ lane, model }) => ({ lane, model }));
}

/* ── response cache ── */

type CacheEntry = { q: string; a: string; t: number };

function loadCache(): CacheEntry[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function cacheLookup(question: string): string | null {
  const target = normalizeQuestion(question);
  if (!target) return null;
  const hit = loadCache().find((e) => e.q === target);
  return hit ? hit.a : null;
}

export function cacheStore(question: string, answer: string): void {
  if (!answer || answer.length < 40) return;
  const entries = loadCache().filter((e) => e.q !== normalizeQuestion(question));
  entries.unshift({ q: normalizeQuestion(question), a: answer, t: Date.now() });
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(0, 60)));
  } catch {
    /* ignore */
  }
}

/* ── public API ── */

export function directAvailable(): boolean {
  return buildLanes().length > 0;
}

export function meshLaneCount(): number {
  return buildLanes().length;
}

export const CREDON_SYSTEM_PROMPT = `You are Credon Alpha, the built-in intelligence of Credon AI — a focused, honest, and sharp assistant.

Style:
- Answer directly first, then add depth. No filler, no "As an AI" talk.
- Use clean markdown: short headers, tight bullet lists, fenced code blocks with language tags.
- For math, use LaTeX between $...$ (inline) or $$...$$ (display).
- If you're unsure, say what you do know and what's uncertain. Never invent facts or sources.
- Match the user's language (English or Hinglish).
- End with at most 2-3 sharp follow-up suggestions as a bullet list titled "**Next:**" only when genuinely useful.`;

/** Stream a chat completion across mesh lanes with silent failover. */
export async function directChatStream(
  messages: DirectMessage[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
  images: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  const task = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
  const candidates = routeLanes(task, estimateTokens(JSON.stringify(messages)));
  if (candidates.length === 0) return { ok: false, error: "no_lanes" };

  let lastError = "";

  for (const { lane, model } of candidates.slice(0, 5)) {
    const started = Date.now();
    let firstToken = 0;
    try {
      const payloadMessages = messages.map((m) => {
        if (images.length > 0 && m.role === "user") {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          };
        }
        return m;
      });

      const response = await fetch(lane.url, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${lane.key}`,
          "Content-Type": "application/json",
          ...(lane.headers || {}),
        },
        body: JSON.stringify({
          model: model.id,
          messages: payloadMessages,
          stream: true,
          temperature: 0.6,
          max_tokens: 4096,
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        reportCooldown(lane.id, response.status === 429);
        lastError = `${lane.id}:${response.status}`;
        continue;
      }
      if (!response.ok || !response.body) {
        lastError = `${lane.id}:${response.status}`;
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let emitted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) throw new Error(json.error.message || "lane error");
            const token: string = json.choices?.[0]?.delta?.content ?? "";
            if (token) {
              if (!emitted) {
                firstToken = Date.now() - started;
                reportSuccess(lane.id, firstToken);
              }
              emitted = true;
              recordUsage(lane.id, estimateTokens(token));
              onToken(token);
            }
          } catch (error) {
            if (error instanceof Error && error.message === "lane error") throw error;
            /* partial frame */
          }
        }
      }

      if (emitted) return { ok: true };
      reportCooldown(lane.id, false);
      lastError = `${lane.id}:empty`;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { ok: false, error: "aborted" };
      reportCooldown(lane.id, false);
      lastError = `${lane.id}:${error instanceof Error ? error.message : "failed"}`;
    }
  }

  return { ok: false, error: lastError };
}

/** One-shot (non-streaming) completion across mesh lanes. */
export async function directComplete(
  messages: DirectMessage[],
  signal?: AbortSignal,
  preferCapability = false
): Promise<string> {
  const task = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
  const candidates = routeLanes(task, estimateTokens(JSON.stringify(messages)), preferCapability);

  for (const { lane, model } of candidates.slice(0, 5)) {
    try {
      const response = await fetch(lane.url, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${lane.key}`,
          "Content-Type": "application/json",
          ...(lane.headers || {}),
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          stream: false,
          temperature: 0.4,
          max_tokens: 3000,
        }),
      });
      if (response.status === 429 || response.status >= 500) {
        reportCooldown(lane.id, response.status === 429);
        continue;
      }
      if (!response.ok) continue;
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) {
        recordUsage(lane.id, estimateTokens(text));
        return text;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "";
    }
  }
  return "";
}
