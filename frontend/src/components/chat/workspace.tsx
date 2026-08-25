"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import {
  backendReachable,
  getLiveApiBase,
  markBackendUnreachable,
  newSessionId,
  streamSSE,
  type AgentStep,
  type Message,
  type ModelInfo,
  type SessionSummary,
  type Source,
  type WorkspaceFile,
} from "@/lib/api";
import {
  CREDON_SYSTEM_PROMPT,
  cacheLookup,
  cacheStore,
  directAvailable,
  directChatStream,
  directComplete,
  type DirectMessage,
} from "@/lib/direct";
import { extractPdfText } from "@/lib/pdf";
import {
  createRecognizer,
  isSpeaking,
  speak,
  speechSupported,
  stopSpeaking,
} from "@/lib/speech";
import { extractChecklist, loadTasks, saveTasks } from "@/lib/slash";
import { Sidebar } from "./sidebar";
import { Composer, type ChatMode } from "./composer";
import { ChatMessage, EmptyStateHero, TypingIndicator } from "./message";
import { AgentPanel, ScheduleDialog } from "./agent-panel";
import { ArtifactPanel } from "./artifact-panel";
import { PreviewModal, type PreviewTarget } from "./preview-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { DownloadsModal } from "@/components/modals/downloads-modal";
import { ProfileModal, type MemoryProfile } from "@/components/modals/profile-modal";
import { KnowledgeModal } from "@/components/modals/knowledge-modal";
import { TasksModal } from "@/components/modals/tasks-modal";

const STAGE_LABELS: Record<string, string> = {
  planning: "Planning…",
  searching: "Searching sources…",
  evaluating: "Evaluating sources…",
  thinking: "Thinking…",
  generating: "Composing answer…",
  composing: "Polishing response…",
};

type Attachment = { file: File; kind: "image" | "pdf"; text?: string; objectUrl?: string };

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function Workspace() {
  const router = useRouter();

  /* ── auth ── */
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [userId, setUserId] = useState("");

  /* ── chat ── */
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSession, setCurrentSession] = useState("");
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ── composer ── */
  const [mode, setMode] = useState<ChatMode>("chat");
  const [web, setWeb] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const recognizerRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* ── ui ── */
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [artifact, setArtifact] = useState<Message | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [memory, setMemory] = useState<MemoryProfile>({ name: "", role: "", subjects: "", language: "", notes: "" });
  const [agentFiles, setAgentFiles] = useState<WorkspaceFile[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  /* ── boot ── */
  useEffect(() => {
    setCollapsed(localStorage.getItem("credon-sidebar") === "1");
    setVoiceReplies(localStorage.getItem("credon-voice") === "1");
    setMemory(loadJson("credon-memory", memory));

    const guest = localStorage.getItem("credon-guest") === "1";
    setIsGuest(guest);

    if (!firebaseAuth) {
      const localId = localStorage.getItem("credon-uid") || `local-${newSessionId()}`;
      localStorage.setItem("credon-uid", localId);
      setUserId(localId);
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      if (firebaseUser) {
        localStorage.removeItem("credon-guest");
        setIsGuest(false);
        setUser(firebaseUser);
        setUserId(firebaseUser.uid);
      } else if (!guest) {
        router.replace("/login");
        return;
      } else {
        const localId = localStorage.getItem("credon-uid") || `guest-${newSessionId()}`;
        localStorage.setItem("credon-uid", localId);
        setUserId(localId);
      }
      setAuthReady(true);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* probe backends + load models/sessions */
  useEffect(() => {
    if (!userId) return;
    setCurrentSession((prev) => prev || newSessionId());

    void getLiveApiBase().then(async (base) => {
      const reachable = backendReachable();
      if (reachable) {
        try {
          const r = await fetch(`${base}/api/v1/models`);
          const data = await r.json();
          const list: ModelInfo[] = Array.isArray(data.models) ? data.models : [];
          setModels(list.filter((m) => m.available !== false));
          const preferred = list.find((m) => m.default) || list[0];
          if (preferred) setSelectedModel(preferred.id);
        } catch {
          /* direct mode */
        }
        fetch(`${base}/api/v1/chats/${encodeURIComponent(userId)}`)
          .then((r) => r.json())
          .then((list) => setSessions(Array.isArray(list) ? list : []))
          .catch(() => {});
      }
      if (directAvailable()) {
        setModels((prev) =>
          prev.length
            ? prev
            : [
                { id: "credon-alpha", label: "Credon Alpha", provider: "credon", description: "Fast, capable — the everyday default", default: true },
                { id: "credon-alpha-reasoning", label: "Credon Alpha Reasoning", provider: "credon", description: "Thinks step by step for hard problems" },
                { id: "credon-deep", label: "Credon Deep", provider: "credon", description: "Extended reasoning for hard research" },
                { id: "credon-scout", label: "Credon Scout", provider: "credon", description: "Reads images and dense documents" },
              ]
        );
        setSelectedModel((prev) => prev || "credon-alpha");
      }
    });

    const pending = localStorage.getItem("credon-pending-query");
    if (pending) {
      localStorage.removeItem("credon-pending-query");
      setTimeout(() => void send(pending), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* autoscroll */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /* shortcuts */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        startNewChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── actions ── */
  function toggleSidebar() {
    setCollapsed((prev) => {
      localStorage.setItem("credon-sidebar", prev ? "0" : "1");
      return !prev;
    });
  }

  function toggleVoice() {
    setVoiceReplies((prev) => {
      localStorage.setItem("credon-voice", prev ? "0" : "1");
      if (prev) stopSpeaking();
      else notify("Voice replies on — Credon will speak answers");
      return !prev;
    });
  }

  function startNewChat() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages([]);
    setAgentFiles([]);
    setCurrentSession(newSessionId());
    setQuery("");
    setMobileOpen(false);
  }

  async function openSession(id: string) {
    setMobileOpen(false);
    if (!backendReachable()) {
      notify("Chat history needs the Credon engine running");
      return;
    }
    abortRef.current?.abort();
    try {
      const base = await getLiveApiBase();
      const r = await fetch(`${base}/api/v1/chats/${encodeURIComponent(userId)}/${id}`);
      const data = await r.json();
      const restored: Message[] = (data.messages || []).map((m: Record<string, unknown>) => ({
        role: m.role as Message["role"],
        text: String(m.text ?? ""),
        confidence: (m.confidence as string) || undefined,
        sources: (m.sources as Source[]) || [],
        thinking: (m.thinking as string) || "",
        timestamp: Date.parse(String(m.created_at ?? "")) || Date.now(),
      }));
      setMessages(restored);
      setCurrentSession(id);
    } catch {
      notify("Could not load that chat");
    }
  }

  async function deleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.session_id !== id));
    if (!backendReachable()) return;
    try {
      const base = await getLiveApiBase();
      await fetch(`${base}/api/v1/chats/${encodeURIComponent(userId)}/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    if (id === currentSession) startNewChat();
  }

  async function handleAttachFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || f.type === "application/pdf")
      .slice(0, 5);
    for (const file of valid) {
      const kind: "image" | "pdf" = file.type.startsWith("image/") ? "image" : "pdf";
      const att: Attachment = { file, kind };
      if (kind === "image") att.objectUrl = URL.createObjectURL(file);
      if (kind === "pdf") {
        setUploading(true);
        setUploadStatus(`Reading ${file.name}…`);
        try {
          const { text } = await extractPdfText(file);
          att.text = text;
          setUploadStatus(`${file.name} ready — ${text.length.toLocaleString()} characters read`);
        } catch {
          setUploadStatus(`Couldn't read ${file.name} in-browser`);
        }
        setTimeout(() => setUploadStatus(null), 2600);
        setUploading(false);
      }
      setAttachments((prev) => [...prev, att]);
    }
  }

  function previewAttachment(index: number) {
    const att = attachments[index];
    if (!att) return;
    setPreviewTarget({ kind: att.kind, name: att.file.name, url: att.objectUrl, text: att.text });
  }

  /* ── voice ── */
  function handleVoiceTap() {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    if (!speechSupported()) {
      notify("Voice input isn't supported in this browser");
      return;
    }
    const recognizer = createRecognizer(
      (finalText) => {
        const next = query ? `${query} ${finalText}` : finalText;
        setQuery(next);
        if (voiceReplies && next.trim()) {
          setTimeout(() => void send(next), 150);
        }
      },
      (interim) => setQuery((prev) => (prev.includes(interim) ? prev : `${prev ? `${prev} ` : ""}${interim}`)),
      () => setListening(false)
    );
    if (recognizer) {
      recognizerRef.current = recognizer;
      recognizer.start();
      setListening(true);
    }
  }

  /* ── image generation (free, keyless) ── */
  function tryImageGen(text: string): string | null {
    const m = text.match(/^(?:\/image|\/genimage)\s+(.+)/i) ||
      text.match(/^generate an image of\s+(.+)/i) ||
      text.match(/^draw\s+(?:me\s+)?(.+)/i);
    if (!m) return null;
    const prompt = m[1].trim();
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=768&nologo=true&seed=${Date.now() % 100000}`;
    return `![${prompt.slice(0, 60)}](${url})\n\n*Generated with Credon image — prompt: “${prompt}”*`;
  }

  /* ── send ── */
  async function send(rawText?: string, opts: { feedbackNote?: string } = {}) {
    const text = (rawText ?? query).trim();
    if (!text || streaming || !authReady) return;
    stopSpeaking();

    /* link awareness: pasted URL → Credon reads the page first */
    const urlMatch = text.match(/https?:\/\/[^\s)]+/);
    let linkContext = "";
    if (urlMatch && backendReachable() && mode !== "agent") {
      try {
        const base = await getLiveApiBase();
        setUploadStatus(`Reading ${new URL(urlMatch[0]).hostname}…`);
        const res = await fetch(`${base}/api/v1/read?url=${encodeURIComponent(urlMatch[0])}`);
        const data = await res.json();
        setUploadStatus(null);
        if (data.ok && data.text) {
          linkContext = `The user shared this page (${urlMatch[0]}). Content:\n${String(data.text).slice(0, 5000)}`;
          notify("Page read — answering with it in context");
        }
      } catch {
        setUploadStatus(null);
      }
    }

    /* image generation shortcut */
    const imageUrlMd = tryImageGen(text);
    if (imageUrlMd) {
      setMessages((prev) => [
        ...prev,
        { role: "user", text, timestamp: Date.now() },
        { role: "assistant", text: imageUrlMd, timestamp: Date.now() + 1 },
      ]);
      setQuery("");
      return;
    }

    /* attachments: try backend ingest (persistence) — browser text already extracted */
    const attached = [...attachments];
    if (attached.length > 0 && backendReachable()) {
      setUploading(true);
      const base = await getLiveApiBase();
      for (const att of attached) {
        try {
          const form = new FormData();
          form.append("user_id", userId);
          form.append("file", att.file);
          form.append("source_type", "pdf");
          await fetch(`${base}${att.kind === "image" ? "/api/v1/ingest/image" : "/api/v1/ingest/pdf"}`, {
            method: "POST",
            body: form,
          });
        } catch {
          /* non-fatal */
        }
      }
      setUploading(false);
    }
    setAttachments([]);

    const userMessage: Message = {
      role: "user",
      text,
      timestamp: Date.now(),
      attachments: attached.map((a) => ({ type: a.kind, name: a.file.name })),
    };
    const assistantMessage: Message = { role: "assistant", text: "", timestamp: Date.now() + 1, streaming: true };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setQuery("");
    setStreaming(true);
    setStage(mode === "agent" ? "planning" : "searching");

    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: Partial<Message>) =>
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.streaming);
        if (idx >= 0) next[idx] = { ...next[idx], ...patch };
        return next;
      });

    const pdfContext = [
      attached
        .filter((a) => a.text)
        .map((a) => `Document: ${a.file.name}\n${a.text!.slice(0, 9000)}`)
        .join("\n\n"),
      linkContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      if (mode === "agent") {
        await runAgent(text, pdfContext, controller.signal, patchAssistant);
      } else {
        await runChat(text, pdfContext, attached, controller.signal, patchAssistant, opts.feedbackNote);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        recordSignal("error", `chat failure: ${error instanceof Error ? error.message : "unknown"}`);
        patchAssistant({ streaming: false, error: true, text: "Something interrupted this answer. Tap regenerate to try again." });
      }
    } finally {
      setStreaming(false);
      setStage(null);
      abortRef.current = null;
      if (backendReachable()) {
        const base = await getLiveApiBase();
        fetch(`${base}/api/v1/chats/${encodeURIComponent(userId)}`)
          .then((r) => r.json())
          .then((list) => setSessions(Array.isArray(list) ? list : []))
          .catch(() => {});
      }
    }
  }

  /* ── chat pipeline: engine → direct fallback ── */
  async function runChat(
    text: string,
    pdfContext: string,
    attached: Attachment[],
    signal: AbortSignal,
    patch: (p: Partial<Message>) => void,
    feedbackNote?: string
  ) {
    const finalText = feedbackNote ? `${text}\n\n(Improve the previous answer — criticism: ${feedbackNote})` : text;

    if (backendReachable()) {
      try {
        await engineChat(finalText, pdfContext, signal, patch);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        markBackendUnreachable();
      }
    }
    await directChat(finalText, pdfContext, attached, signal, patch);
  }

  async function engineChat(text: string, pdfContext: string, signal: AbortSignal, patch: (p: Partial<Message>) => void) {
    const base = await getLiveApiBase();
    let thinkStart = 0;
    let got = false;
    await streamSSE(
      "/api/v1/chat/stream",
      {
        user_id: userId,
        session_id: currentSession,
        query: text,
        language: "auto",
        model: selectedModel || null,
        use_web: web,
        deep_think: mode === "think",
        code_mode: false,
        metadata: {
          master_mode: mode === "think",
          user_profile: memory,
          document_context: pdfContext.slice(0, 4000) || undefined,
        },
      },
      (event) => {
        got = true;
        switch (event.type) {
          case "status":
            setStage(event.stage in STAGE_LABELS ? event.stage : "thinking");
            break;
          case "thinking":
          case "thinking_token":
            if (!thinkStart) thinkStart = Date.now();
            patch({ thinkingStreaming: event.type === "thinking_token", thinking: String(event.content ?? "") });
            break;
          case "thinking_done":
            patch({ thinkingStreaming: false, thinking: event.content ?? undefined, thinkDurationSec: thinkStart ? Math.round((Date.now() - thinkStart) / 1000) : undefined });
            break;
          case "sources":
            patch({ sources: event.sources ?? [], confidence: event.confidence });
            break;
          case "token":
            setStage(null);
            patch({ text: String(event.content ?? "") });
            break;
          case "done":
            patch({ streaming: false, thinkingStreaming: false, confidence: event.confidence, suggestions: event.suggestions ?? [], metadata: event.metadata });
            break;
        }
      },
      signal,
      base
    );
    if (!got) throw new Error("engine silent");
    patch({ streaming: false });
  }

  async function directChat(
    text: string,
    pdfContext: string,
    attached: Attachment[],
    signal: AbortSignal,
    patch: (p: Partial<Message>) => void
  ) {
    if (!directAvailable()) {
      patch({ streaming: false, error: true, text: "Credon can't reach any model right now. Check your connection or start the Credon engine." });
      return;
    }

    /* cache-first: repeat questions answer instantly */
    const cached = cacheLookup(text);
    if (cached && !pdfContext) {
      setStage(null);
      let shown = "";
      for (const word of cached.split(" ")) {
        shown += (shown ? " " : "") + word;
        patch({ text: shown });
        await new Promise((r) => setTimeout(r, 8));
      }
      patch({ streaming: false, metadata: { routing: { selected_route: "memory_cache" } } });
      return;
    }

    setStage("thinking");

    const history: DirectMessage[] = [{ role: "system", content: CREDON_SYSTEM_PROMPT }];
    if (memory.name || memory.role || memory.subjects || memory.notes) {
      history.push({
        role: "system",
        content: `About the user — name: ${memory.name || "unknown"}; role: ${memory.role || "unknown"}; subjects: ${memory.subjects || "unspecified"}; notes: ${memory.notes || "none"}. Personalize when relevant.`,
      });
    }
    if (pdfContext) {
      history.push({ role: "system", content: `The user attached documents. Use them when relevant:\n\n${pdfContext}` });
    }
    const recent = messages.slice(-8).filter((m) => !m.error && m.text);
    for (const m of recent) history.push({ role: m.role, content: m.text.slice(0, 2500) });
    history.push({ role: "user", content: text });

    const images = attached.filter((a) => a.kind === "image").slice(0, 2);
    const imageDataUrls: string[] = [];
    for (const img of images) {
      imageDataUrls.push(
        await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(img.file);
        })
      );
    }

    setStage(null);
    const result = await directChatStream(
      history,
      (token) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.streaming);
          if (idx >= 0) next[idx] = { ...next[idx], text: next[idx].text + token };
          return next;
        });
      },
      signal,
      imageDataUrls
    );

    if (!result.ok) {
      patch({ streaming: false, error: true, text: "The model network didn't respond. Please try again in a moment." });
      return;
    }

    /* remember for instant repeat answers */
    setMessages((prev) => {
      const last = [...prev].reverse().find((m) => m.streaming);
      if (last?.text) cacheStore(text, last.text);
      return prev;
    });

    patch({ streaming: false, thinkingStreaming: false });
    if (voiceReplies) {
      setMessages((prev) => {
        const last = [...prev].reverse().find((m) => m.role === "assistant" && m.text);
        if (last) speak(last.text);
        return prev;
      });
    }
  }

  /* ── agent pipeline ── */
  async function runAgent(goal: string, pdfContext: string, signal: AbortSignal, patch: (p: Partial<Message>) => void) {
    const contextBits = [memory.notes, memory.subjects && `subjects: ${memory.subjects}`, pdfContext && `documents: ${pdfContext.slice(0, 1500)}`]
      .filter(Boolean)
      .join(" | ");

    if (backendReachable()) {
      try {
        await engineAgent(goal, contextBits, signal, patch);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        markBackendUnreachable();
      }
    }
    patch({ streaming: false, error: true, text: "Agent mode requires the authenticated server-side capability runtime. The backend is unreachable, so no reasoning-only fallback was used." });
  }

  async function engineAgent(goal: string, context: string, signal: AbortSignal, patch: (p: Partial<Message>) => void) {
    const base = await getLiveApiBase();
    await streamSSE(
      "/api/v1/agent/run",
      {
        user_id: userId,
        session_id: currentSession,
        goal,
        use_web: web,
        max_steps: 4,
        context,
        is_follow_up: messages.some((m) => m.agent),
        auth_email: user?.email || "",
        unsafe_tools_enabled: isOwner && localStorage.getItem("credon.agent.unsafeTools") === "true",
      },
      (event) => {
        switch (event.type) {
          case "capabilities":
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.streaming);
              if (idx >= 0) {
                const existing = next[idx].agent || { goal, steps: [], activeTerminal: [] };
                next[idx] = {
                  ...next[idx],
                  agent: { ...existing, capabilities: event.capabilities || {}, unsafeEnabled: Boolean(event.unsafe_enabled) },
                };
              }
              return next;
            });
            break;
          case "tool":
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.streaming);
              if (idx >= 0 && next[idx].agent) {
                const agent = next[idx].agent!;
                const changed = Array.isArray(event.files_changed) ? event.files_changed.map(String) : [];
                next[idx] = {
                  ...next[idx],
                  agent: {
                    ...agent,
                    toolEvents: [...(agent.toolEvents || []), { name: String(event.name), status: String(event.status), output: String(event.output || ""), files_changed: changed }],
                    filesChanged: Array.from(new Set([...(agent.filesChanged || []), ...changed])),
                    activeTerminal: [...agent.activeTerminal, `tool:${String(event.name)} ${String(event.status)}`, ...(event.output ? String(event.output).split("\n").slice(0, 10) : [])].slice(-100),
                  },
                };
              }
              return next;
            });
            break;
          case "plan": {
            const steps: AgentStep[] = (event.steps || []).map((s: Record<string, unknown>) => ({
              id: Number(s.id),
              kind: (s.kind as AgentStep["kind"]) || "reason",
              title: String(s.title),
              detail: String(s.detail ?? ""),
              status: "pending",
            }));
            patch({
              agent: { goal: event.goal || goal, steps, activeTerminal: [`$ credon agent --goal "${goal}"`, "◇ plan drafted"], toolEvents: [], filesChanged: [] },
            });
            break;
          }
          case "step_start":
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.streaming);
              if (idx >= 0 && next[idx].agent) {
                const agent = next[idx].agent!;
                next[idx] = {
                  ...next[idx],
                  agent: {
                    ...agent,
                    steps: agent.steps.map((s) =>
                      s.id === event.step_id ? { ...s, status: "running" as const } : s.status === "running" ? { ...s, status: "done" as const } : s
                    ),
                    activeTerminal: [...agent.activeTerminal, `$ ${String(event.kind)} step: ${String(event.title)}`].slice(-80),
                  },
                };
              }
              return next;
            });
            break;
          case "step_done":
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.streaming);
              if (idx >= 0 && next[idx].agent) {
                const agent = next[idx].agent!;
                next[idx] = {
                  ...next[idx],
                  agent: {
                    ...agent,
                    steps: agent.steps.map((s) => (s.id === event.step_id ? { ...s, status: "done" as const } : s)),
                    activeTerminal: [...agent.activeTerminal, ...(Array.isArray(event.terminal) ? (event.terminal as string[]) : []), "──────────"].slice(-90),
                  },
                };
              }
              return next;
            });
            break;
          case "file":
            setAgentFiles((prev) => {
              const exists = prev.find((f) => f.path === event.file.path);
              if (exists) return prev.map((f) => (f.path === event.file.path ? event.file : f));
              return [...prev, event.file];
            });
            break;
          case "done":
            patch({ streaming: false, text: event.answer ?? "", sources: event.sources ?? [], metadata: event.metadata });
            if (voiceReplies && event.answer) speak(String(event.answer));
            break;
        }
      },
      signal,
      base
    );
    patch({ streaming: false });
  }

  /* graceful agent when engine is off: plan + reason via direct models */
  async function directAgent(goal: string, signal: AbortSignal, patch: (p: Partial<Message>) => void) {
    if (!directAvailable()) {
      patch({ streaming: false, error: true, text: "Agent mode needs either the Credon engine running or a configured model network." });
      return;
    }
    const terminal = [`$ credon agent --goal "${goal}"`, "◇ planning (on-device routing)…"];
    patch({ agent: { goal, steps: [{ id: 0, kind: "reason", title: "Planning", status: "running" }], activeTerminal: [...terminal] } });

    const planRaw = await directComplete(
      [
        { role: "system", content: "You are Credon Agent's planner. Return ONLY a JSON object: {\"steps\":[{\"id\":1,\"kind\":\"reason\",\"title\":\"...\",\"detail\":\"...\"}]} with 3 concise steps (kinds: research|reason|code). No code execution or web access is available right now, so prefer reason steps that produce the full deliverable." },
        { role: "user", content: goal },
      ],
      signal
    );
    let steps: AgentStep[] = [];
    try {
      const parsed = JSON.parse((planRaw.match(/\{[\s\S]*\}/) || [])[0] || "{}");
      steps = (parsed.steps || []).slice(0, 4).map((s: Record<string, unknown>, i: number) => ({
        id: Number(s.id) || i + 1,
        kind: (["research", "browse", "code"].includes(String(s.kind)) ? "reason" : String(s.kind)) as AgentStep["kind"],
        title: String(s.title || `Step ${i + 1}`),
        detail: String(s.detail || ""),
        status: "pending" as const,
      }));
    } catch {
      steps = [];
    }
    if (!steps.length) {
      steps = [
        { id: 1, kind: "reason", title: "Analyze the goal", status: "pending" },
        { id: 2, kind: "reason", title: "Produce the deliverable", status: "pending" },
      ];
    }
    patch({
      agent: {
        goal,
        steps,
        activeTerminal: [...terminal, "◇ plan drafted", "⚠ engine offline — research & code execution unavailable, reasoning only"],
      },
    });

    const collected: string[] = [];
    for (const step of steps) {
      patchAgentStep(step.id, "running");
      const analysis = await directComplete(
        [
          { role: "system", content: `${CREDON_SYSTEM_PROMPT}\nYou are executing one step of a plan. Be specific and complete (max 300 words).` },
          { role: "user", content: `Goal: ${goal}\nStep: ${step.title} — ${step.detail}\n\nPrevious findings:\n${collected.join("\n\n").slice(-3000)}` },
        ],
        signal
      );
      collected.push(`### ${step.title}\n${analysis}`);
      patchAgentStep(step.id, "done");
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.streaming);
        if (idx >= 0 && next[idx].agent) {
          const agent = next[idx].agent!;
          next[idx] = { ...next[idx], agent: { ...agent, activeTerminal: [...agent.activeTerminal, `✓ ${step.title}`] } };
        }
        return next;
      });
    }

    setStage("composing");
    const final = await directComplete(
      [
        { role: "system", content: CREDON_SYSTEM_PROMPT },
        { role: "user", content: `Goal: ${goal}\n\nWork:\n${collected.join("\n\n").slice(-8000)}\n\nSynthesize the complete final answer as polished markdown.` },
      ],
      signal
    );
    setStage(null);
    patch({ streaming: false, text: final || "The agent couldn't complete this run. Try again." });
    if (voiceReplies && final) speak(final);
  }

  function patchAgentStep(stepId: number, status: "running" | "done") {
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.streaming);
      if (idx >= 0 && next[idx].agent) {
        const agent = next[idx].agent!;
        next[idx] = { ...next[idx], agent: { ...agent, steps: agent.steps.map((s) => (s.id === stepId ? { ...s, status } : s)) } };
      }
      return next;
    });
  }

  /* ── split answer ── */
  async function sendSplit(text: string) {
    if (streaming) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text, timestamp: Date.now() },
      { role: "assistant", text: "", timestamp: Date.now() + 1, streaming: true },
    ]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let a = "";
    let b = "";
    const render = () => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.streaming);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            text:
              `### Route A · Credon Alpha\n\n${a || "…"}\n\n---\n\n### Route B · Credon Deep\n\n${b || "…"}`,
          };
        }
        return next;
      });
    };

    const baseMessages = (persona: string): DirectMessage[] => [
      { role: "system", content: `${CREDON_SYSTEM_PROMPT}\n${persona}` },
      { role: "user", content: text },
    ];

    await Promise.all([
      directChatStream(baseMessages("Answer directly and concisely."), (t) => { a += t; render(); }, controller.signal).catch(() => {}),
      directChatStream(baseMessages("Think through the problem step by step before answering."), (t) => { b += t; render(); }, controller.signal).catch(() => {}),
    ]);

    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.streaming);
      if (idx >= 0) next[idx] = { ...next[idx], streaming: false };
      return next;
    });
    setStreaming(false);
    abortRef.current = null;
  }

  /* ── message actions ── */
  function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
    setMessages((prev) => (lastAssistantIdx >= 0 ? prev.slice(0, lastAssistantIdx) : prev));
    void send(lastUser.text);
  }

  function editMessage(index: number, newText: string) {
    setMessages((prev) => prev.slice(0, index));
    void send(newText);
  }

  async function giveFeedback(rating: "up" | "down", reason?: string) {
    const target = [...messages].reverse().find((m) => m.role === "assistant" && m.text);
    if (rating === "down") {
      recordSignal("thumbs_down", `${reason || "unspecified"}: ${target?.text.slice(0, 200) || "no answer"}`);
      if (reason) {
        notify("Regenerating with your feedback…");
        regenerate();
      }
    } else if (rating === "up") {
      notify("Thanks — that helps Credon learn");
    }
    if (!backendReachable() || !target) return;
    try {
      const base = await getLiveApiBase();
      await fetch(`${base}/api/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, session_id: currentSession, message_text: target.text, rating, reason }),
      });
    } catch {
      /* silent */
    }
  }

  async function shareMessage(message: Message) {
    const shareData = { title: "Credon AI", text: message.text.slice(0, 4000) };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* cancelled — fall through */
      }
    }
    let link = "";
    if (backendReachable()) {
      try {
        const base = await getLiveApiBase();
        const res = await fetch(`${base}/api/v1/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            title: messages.find((m) => m.role === "user")?.text.slice(0, 80) || "Credon answer",
            messages: [{ role: "user", text: messages.find((m) => m.role === "user")?.text ?? "" }, { role: "assistant", text: message.text }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          link = `${window.location.origin}/share/${data.id}`;
        }
      } catch {
        /* ignore */
      }
    }
    try {
      await navigator.clipboard.writeText(link || message.text);
      notify(link ? "Share link copied" : "Answer copied to clipboard");
    } catch {
      notify("Couldn't access the clipboard");
    }
  }

  function speakMessage(message: Message) {
    if (isSpeaking()) {
      stopSpeaking();
      return;
    }
    speak(message.text);
  }

  function openArtifact(message: Message) {
    setArtifact(message);
  }

  function refineArtifact(instruction: string, currentText: string) {
    const docMessage: Message = {
      role: "user",
      text: `Refine this document — ${instruction}:\n\n${currentText.slice(0, 6000)}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, docMessage]);
    void (async () => {
      setStreaming(true);
      const controller = new AbortController();
      const result = await directComplete(
        [
          { role: "system", content: `${CREDON_SYSTEM_PROMPT}\nYou are refining an existing document. Return the FULL updated document in markdown — no commentary.` },
          { role: "user", content: docMessage.text },
        ],
        controller.signal
      );
      if (result) {
        setArtifact((prev) => (prev ? { ...prev, text: result } : prev));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `Updated the document in your workspace — *${instruction}*`, timestamp: Date.now() },
        ]);
        notify("Document refined");
      } else {
        notify("Refinement failed — try again");
      }
      setStreaming(false);
    })();
  }

  function saveMessageTasks(message: Message) {
    const items = extractChecklist(message.text);
    if (!items.length) return;
    const existing = loadTasks();
    const fresh = items.map((text, i) => ({
      id: `t-${Date.now().toString(36)}-${i}`,
      text,
      done: false,
      created: Date.now(),
    }));
    saveTasks([...fresh, ...existing]);
    notify(`${fresh.length} tasks saved — find them in the sidebar`);
  }

  const displayName = isGuest ? "" : user?.displayName || memory.name || "";
  const OWNER_EMAIL = process.env.NEXT_PUBLIC_OWNER_EMAIL || "";
  const isOwner = !isGuest && Boolean(user?.email) && user!.email!.toLowerCase() === OWNER_EMAIL.toLowerCase();

  function recordSignal(kind: string, detail: string) {
    if (!backendReachable()) return;
    void getLiveApiBase().then((base) => {
      fetch(`${base}/api/v1/system/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, detail, user_id: userId }),
      }).catch(() => {});
    });
  }

  if (!authReady) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="flex flex-col items-center gap-4">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>Loading your workspace…</p>
        </div>
      </div>
    );
  }

  const lastMessage = messages[messages.length - 1];

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar
        variant="desktop"
        collapsed={collapsed}
        onToggleCollapse={toggleSidebar}
        sessions={sessions}
        currentSessionId={currentSession}
        isGuest={isGuest}
        userName={displayName}
        userEmail={user?.email || ""}
        onNewChat={startNewChat}
        onSelectSession={openSession}
        onDeleteSession={deleteSession}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
        onOpenTasks={() => setTasksOpen(true)}
        onOpenDownloads={() => setDownloadsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        onSignOut={async () => {
          if (firebaseAuth) await signOut(firebaseAuth);
          localStorage.removeItem("credon-guest");
          router.push("/login");
        }}
        onGoHome={() => router.push("/")}
      />
      <Sidebar
        variant="mobile"
        collapsed={false}
        onToggleCollapse={() => {}}
        open={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        sessions={sessions}
        currentSessionId={currentSession}
        isGuest={isGuest}
        userName={displayName}
        userEmail={user?.email || ""}
        onNewChat={startNewChat}
        onSelectSession={openSession}
        onDeleteSession={deleteSession}
        onOpenKnowledge={() => { setMobileOpen(false); setKnowledgeOpen(true); }}
        onOpenTasks={() => { setMobileOpen(false); setTasksOpen(true); }}
        onOpenDownloads={() => { setMobileOpen(false); setDownloadsOpen(true); }}
        onOpenProfile={() => { setMobileOpen(false); setProfileOpen(true); }}
        onSignOut={async () => {
          if (firebaseAuth) await signOut(firebaseAuth);
          localStorage.removeItem("credon-guest");
          router.push("/login");
        }}
        onGoHome={() => router.push("/")}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="glass sticky top-0 z-30 flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05] lg:hidden"
            style={{ color: "var(--text-dim)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="truncate text-[13.5px] font-medium" style={{ color: "var(--text-dim)" }}>
            {sessions.find((s) => s.session_id === currentSession)?.preview?.slice(0, 48) || (messages.length ? "Current chat" : "New chat")}
          </span>
          {!backendReachable() && (
            <span className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] sm:flex" style={{ background: "var(--surface-2)", color: "var(--text-faint)" }} title="Credon engine offline — answering via the model network">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              on-device routing
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {streaming && (
              <span className="mr-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] sm:flex" style={{ background: "var(--accent-softer)", color: "var(--accent-text)" }}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                working…
              </span>
            )}
            <HeaderBtn label="Knowledge library" onClick={() => setKnowledgeOpen(true)}><IconBookSvg /></HeaderBtn>
            <HeaderBtn label="Export center" onClick={() => setDownloadsOpen(true)}><IconDownloadSvg /></HeaderBtn>
            <HeaderBtn label="Settings" onClick={() => setSettingsOpen(true)}><IconGearSvg /></HeaderBtn>
          </div>
        </header>

        {/* messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <EmptyStateHero name={displayName} onPick={(q) => (mode === "agent" ? setQuery(q) : void send(q))} mode={mode} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-7 px-4 pb-10 pt-6">
              {messages.map((message, index) => (
                <div key={`${message.timestamp}-${index}`}>
                  <ChatMessage
                    message={message}
                    index={index}
                    streaming={streaming}
                    onRegenerate={!message.streaming && index === messages.length - 1 && message.role === "assistant" ? regenerate : undefined}
                    onFeedback={!message.streaming ? giveFeedback : undefined}
                    onSuggestion={(s) => void send(s)}
                    onEdit={editMessage}
                    onShare={shareMessage}
                    onOpenArtifact={openArtifact}
                    onPreviewAttachment={(att) => setPreviewTarget({ kind: att.type, name: att.name })}
                    onSpeak={speakMessage}
                    onSaveTasks={saveMessageTasks}
                  />
                  {message.streaming && !message.text && !message.agent && stage && (
                    <div className="mt-2 pl-9">
                      <TypingIndicator stage={STAGE_LABELS[stage] || STAGE_LABELS.thinking} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Composer
          value={query}
          onChange={setQuery}
          onSend={() => {
            if (query.trim().startsWith("/split ")) {
              const q = query.replace("/split", "").trim();
              setQuery("");
              void sendSplit(q);
              return;
            }
            void send();
          }}
          onStop={() => abortRef.current?.abort()}
          streaming={streaming}
          mode={mode}
          onModeChange={setMode}
          web={web}
          onWebChange={setWeb}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          attachments={attachments}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
          onPreviewAttachment={previewAttachment}
          uploading={uploading}
          uploadStatus={uploadStatus}
          listening={listening}
          onVoiceTap={handleVoiceTap}
          voiceEnabled={voiceReplies}
          onVoiceToggle={toggleVoice}
          onNotify={notify}
        />
      </main>

      {/* canvas */}
      {artifact && (
        <ArtifactPanel
          message={artifact}
          onClose={() => setArtifact(null)}
          onRefine={refineArtifact}
          onNotify={notify}
        />
      )}

      {/* modals */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        webSearch={web}
        onWebSearchChange={setWeb}
        voiceReplies={voiceReplies}
        onVoiceRepliesChange={toggleVoice}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        memoryProfile={memory}
        userId={userId}
        onNotify={notify}
        ownerEmail={OWNER_EMAIL}
        isOwner={isOwner}
      />
      <DownloadsModal
        open={downloadsOpen}
        onClose={() => setDownloadsOpen(false)}
        userId={userId}
        currentSessionId={currentSession}
        sessions={sessions}
        messages={messages}
      />
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        isGuest={isGuest}
        userName={displayName}
        userEmail={user?.email || ""}
        photoUrl={user?.photoURL}
        memory={memory}
        onSaveMemory={(m) => {
          setMemory(m);
          localStorage.setItem("credon-memory", JSON.stringify(m));
          notify("Memory updated");
        }}
      />
      <KnowledgeModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} userId={userId} />
      <TasksModal open={tasksOpen} onClose={() => setTasksOpen(false)} onNotify={notify} />
      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        goal={lastMessage?.agent?.goal || query}
        userId={userId}
        onNotify={notify}
      />
      <PreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />

      {/* toast */}
      {toast && (
        <div className="anim-scale-in pointer-events-none fixed bottom-24 left-1/2 z-[80] -translate-x-1/2">
          <div className="rounded-full border px-4 py-2 text-[13px] shadow-xl" style={{ borderColor: "var(--border-strong)", background: "var(--surface-3)", color: "var(--text)" }}>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
      style={{ color: "var(--text-dim)" }}
    >
      {children}
    </button>
  );
}

function IconBookSvg() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2.5H6.5A2.5 2.5 0 0 0 4 5v14.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  );
}
function IconDownloadSvg() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconGearSvg() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.22.44.66.76 1.51 1H21a2 2 0 1 1 0 4h-.09c-.85.24-1.29.56-1.51 1z" />
    </svg>
  );
}
