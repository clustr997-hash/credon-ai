"use client";
/**
 * Credon Cognitive Loop client — self-contained (no dependency on lib/api).
 * Backend: POST /api/v1/cognitive/think (+ /stream, /state, /teach, /feedback)
 *           GET  /api/v1/cognitive/evals
 * Mirrors resolveApiBase() from components/core.tsx so local/prod switching matches.
 */
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

export type CognitivePlanStep = {
  id: number;
  title: string;
  tool: string;
  detail?: string;
  status?: "pending" | "running" | "done";
};

export type StreamEvent = { type: string; [k: string]: unknown };

/** Consume a `data:` SSE stream (same wire format as the chat streamer). */
export async function streamCognitive(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${resolveApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Cognitive request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(t.slice(5).trim()) as StreamEvent);
        } catch {
          /* ignore malformed frames */
        }
      }
    }
  }
}

export async function cognitiveThink(
  userId: string,
  sessionId: string,
  query: string,
  opts?: { use_web?: boolean; signal?: AbortSignal }
): Promise<Record<string, unknown>> {
  const res = await fetch(`${resolveApiBase()}/api/v1/cognitive/think`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, session_id: sessionId, query, use_web: opts?.use_web ?? false }),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Cognitive backend failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}
