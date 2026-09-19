"use client";

import Image from "next/image";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { User } from "firebase/auth";
import { enableFcmAndGetToken, getFcmReadiness } from "@/lib/firebase-client";
import * as Core from "@/components/core";

function InstallPromptBanner({ active, onInstall, onDismiss }: { active: boolean; onInstall: () => void; onDismiss: () => void }) {
  if (!active) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,640px)] rounded-2xl border border-cyan-500/30 bg-zinc-950/85 backdrop-blur-xl px-4 py-3 flex items-center gap-3 shadow-2xl">
      <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center shrink-0 overflow-hidden"><Core.CredonLogo size={22} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-stone-900 dark:text-zinc-100 font-medium">Install CREDON-AI on your home screen</p>
        <p className="text-xs text-stone-500 dark:text-zinc-400">Faster launch and app-like experience. Weâ€™ll remind rarely.</p>
      </div>
      <button type="button" onClick={onDismiss} className="text-xs text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300">Later</button>
      <button type="button" onClick={onInstall} className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-3 py-1.5 text-xs font-semibold">Install</button>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CHAT PAGE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function ChatPage({ user, onSignOut, isGuest }: { user: User | null; onSignOut: () => void; isGuest: boolean }) {
  /* â”€â”€ Core state â”€â”€ */
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Core.Message[]>([
    { role: "assistant", text: Core.GREET, timestamp: Date.now() },
  ]);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Core.SessionSummary[]>([]);
  const [homeSuggestions, setHomeSuggestions] = useState<string[]>(() => Core.randomLocalPrompts());
  const [hasUserSentMessage, setHasUserSentMessage] = useState(false);
  const [currentSession, setCurrentSession] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [agentMode, setAgentMode] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentPlan, setAgentPlan] = useState<string[]>([]);
  const [agentSteps, setAgentSteps] = useState<{ tool: string; status: "running" | "done" | "failed"; output?: string }[]>([]);
  const [agentFiles, setAgentFiles] = useState<string[]>([]);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [agentSummary, setAgentSummary] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState("");
  const [customName, setCustomName] = useState<string | null>(null);
  const [learnStats, setLearnStats] = useState<{ insights_learned: number; last_topic?: string; enabled?: boolean } | null>(null);
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
  const [productMode, setProductMode] = useState<Core.ProductMode>("Student");
  const [answerStyle, setAnswerStyle] = useState<Core.AnswerStyle>("Balanced");
  const [chatSearch, setChatSearch] = useState("");
  const [listening, setListening] = useState(false);

  /* â”€â”€ Model & settings â”€â”€ */
  const [, setModels] = useState<Core.ModelInfo[]>([]);
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
  const [appearance, setAppearanceState] = useState<"light" | "dark" | "midnight" | "contrast">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("credon-appearance") as "light" | "dark" | "midnight" | "contrast" | null) ?? "dark";
  });
  const [fontScale, setFontScaleState] = useState<"compact" | "comfortable" | "large">(() => {
    if (typeof window === "undefined") return "comfortable";
    return (localStorage.getItem("credon-font-scale") as "compact" | "comfortable" | "large" | null) ?? "comfortable";
  });
  const [memoryProfile, setMemoryProfileState] = useState<Core.EditableMemoryProfile>(() => {
    if (typeof window === "undefined") return Core.EMPTY_MEMORY_PROFILE;
    try {
      return { ...Core.EMPTY_MEMORY_PROFILE, ...JSON.parse(localStorage.getItem("credon-memory-profile") || "{}") };
    } catch {
      return Core.EMPTY_MEMORY_PROFILE;
    }
  });
  const setMemoryProfile = (profile: Core.EditableMemoryProfile) => {
    setMemoryProfileState(profile);
    if (typeof window !== "undefined") localStorage.setItem("credon-memory-profile", JSON.stringify(profile));
  };
  const clearMemoryProfile = () => setMemoryProfile(Core.EMPTY_MEMORY_PROFILE);
  const [replyTo, setReplyTo] = useState<{ text: string; index: number } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  /* â”€â”€ Thinking state â”€â”€ */
  const [thinkingStage, setThinkingStage] = useState<Core.ThinkingStage>(null);
  const [thinkingStart, setThinkingStart] = useState<number>(0);
  const [liveThinking, setLiveThinking] = useState("");

  /* â”€â”€ Follow-up dismiss â”€â”€ */
  const [followUpsDismissed, setFollowUpsDismissed] = useState(false);

  /* â”€â”€ File upload â”€â”€ */
  const [attachedFiles, setAttachedFiles] = useState<Core.PendingAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const assistantAnswerStreaming = messages.some((m) => m.role === "assistant" && m.streaming);
  const showPreTokenLoader = loading && !assistantAnswerStreaming;
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  /* â”€â”€ Abort controller for stop button â”€â”€ */
  const abortRef = useRef<AbortController | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* â”€â”€ Backend warmup: the free-tier backend sleeps after idle and a cold boot
     can take 30â€“60s, which otherwise surfaces as a connection error on the first
     message. Ping /health (throttled) on load and when the user shows intent so
     the boot happens before they wait on a real query. â”€â”€ */
  const lastWarmRef = useRef<number>(0);
  const warmBackend = useCallback(() => {
    const now = Date.now();
    if (now - lastWarmRef.current < 60_000) return;
    lastWarmRef.current = now;
    void fetch(`${Core.API}/health`, { method: "GET", cache: "no-store" }).catch(() => {
      lastWarmRef.current = 0; // allow a retry if the wake-up ping itself failed
    });
  }, []);

  const [localUserId] = useState(() => {
    if (typeof window === "undefined") return "guest";
    const stored = localStorage.getItem("credon-local-uid");
    if (stored) return stored;
    const id = Core.createGuestId();
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
  const baseName = user?.displayName ?? user?.email?.split("@")[0] ?? "Guest";
  const displayName = customName?.trim() || baseName;
  const isEmptyChat = messages.length === 1 && messages[0].text === Core.GREET;
  const allModesActive = !isGuest && useWeb && deepThink && codeMode && hasUserSentMessage;
  const browserSupportsNativeShare = typeof window !== "undefined" && typeof navigator !== "undefined" && "share" in navigator;
  const setAppearance = (value: "light" | "dark" | "midnight" | "contrast") => {
    setAppearanceState(value);
    if (typeof window !== "undefined") localStorage.setItem("credon-appearance", value);
  };
  const setFontScale = (value: "compact" | "comfortable" | "large") => {
    setFontScaleState(value);
    if (typeof window !== "undefined") localStorage.setItem("credon-font-scale", value);
  };
  const themeClass = appearance === "light" ? "theme-light" : "theme-dark";
  const shellClass = appearance === "contrast"
    ? "bg-black text-stone-900 dark:text-white"
    : appearance === "midnight"
      ? "bg-[#050816] text-stone-900 dark:text-white"
      : appearance === "light"
        ? "bg-[#FAF9F5] text-stone-800"
        : "bg-[#141311] text-stone-900 dark:text-white";
  const answerFontClass = fontScale === "large" ? "[--answer-size:16px]" : fontScale === "compact" ? "[--answer-size:13px]" : "[--answer-size:15px]";

  useEffect(() => {
    try {
      const saved = localStorage.getItem("credon-display-name");
      if (saved) setCustomName(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${Core.API}/api/v1/learning/stats`, { signal: AbortSignal.timeout(8000) });
        if (r.ok && alive) setLearnStats(await r.json());
      } catch { /* backend offline — widget simply stays hidden */ }
    };
    void poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    // Guests should still get the resilient answer pipeline: Credon Brain �+' local model �+' DuckDuckGo web fallback.
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
    setFcmStatus(readiness.ready ? "Ready. Enable to receive notifications on this device." : Core.userFriendlyFcmStatus(readiness.reason));
  }, []);

  /* Follow-up suggestions â€” prefer structured suggestions from backend */
  const followUps = useMemo(() => {
    if (followUpsDismissed) return [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && !lastMsg.streaming && lastMsg.text !== Core.GREET) {
      // Use structured suggestions from backend if available
      if (lastMsg.suggestions && lastMsg.suggestions.length > 0) {
        return lastMsg.suggestions.slice(0, 3);
      }
      // Fallback: extract from text
      return Core.extractFollowUps(lastMsg.text);
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
      setConnectionNotice(navigator.onLine ? "Connection restored â€” draft preserved." : "Offline â€” saved draft locally.");
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
        const r = await fetch(`${Core.API}/api/v1/models`);
        if (!r.ok) return;
        const data = await r.json();
        const allModels: Core.ModelInfo[] = data.models ?? [];
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
      const r = await fetch(`${Core.API}/api/v1/chats/${uid}`);
      if (!r.ok) return;
      const data: Core.SessionSummary[] = await r.json();
      setSessions(data);
      setCurrentSession((prev) => {
        const hasPrev = prev ? data.some((s) => s.session_id === prev) : false;
        if (hasPrev) return prev;
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem(sessionStorageKey);
          if (stored && data.some((s) => s.session_id === stored)) return stored;
        }
        return data.length > 0 ? data[0].session_id : (prev || Core.newSessionId());
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
      setCurrentSession(Core.newSessionId());
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
        const r = await fetch(`${Core.API}/api/v1/chats/${uid}/${currentSession}`);
        if (!r.ok) { setMessages([{ role: "assistant", text: Core.GREET, timestamp: Date.now() }]); return; }
        const data = await r.json();
        if (!data.messages?.length) { setMessages([{ role: "assistant", text: Core.GREET, timestamp: Date.now() }]); return; }
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
      } catch { setMessages([{ role: "assistant", text: Core.GREET, timestamp: Date.now() }]); }
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
        const reg = await fetch(`${Core.API}/api/v1/notifications/token`, {
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
    setFcmStatus(Core.userFriendlyFcmStatus(result.error));
  };

  const fetchHomeSuggestions = useCallback(async () => {
    try {
      const r = await fetch(`${Core.API}/api/suggestions?user_id=${encodeURIComponent(uid)}&t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.suggestions)) setHomeSuggestions(data.suggestions.slice(0, 4));
    } catch {
      setHomeSuggestions(Core.randomLocalPrompts());
    }
  }, [uid]);

  useEffect(() => { void fetchHomeSuggestions(); }, [fetchHomeSuggestions, currentSession]);

  const newChat = () => {
    setCurrentSession(Core.newSessionId());
    stopGeneration();
    setMobileModesOpen(false);
    setHomeSuggestions(Core.randomLocalPrompts());
    setMessages([{ role: "assistant", text: Core.GREET, timestamp: Date.now() }]);
    setHasUserSentMessage(false);
    setSidebarOpen(false);
    void fetchHomeSuggestions();
    inputRef.current?.focus();
  };

  /* â”€â”€ Stop generation â”€â”€ */
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

  const ingestAttachments = useCallback(async (files: Core.PendingAttachment[]) => {
    const failures: string[] = [];
    const imageContexts: string[] = [];
    await Promise.all(
      files.map(async (item) => {
        const form = new FormData();
        form.append("user_id", uid);
        form.append("file", item.file);
        const endpoint = item.kind === "pdf" ? "/api/v1/ingest/pdf" : "/api/v1/ingest/image";
        try {
          const response = await fetch(`${Core.API}${endpoint}`, {
            method: "POST",
            body: form,
          });
          const data: { ok?: boolean; error?: string; image_context?: string; ocr_text?: string; vision_method?: string; vision_warning?: string } = await response.json();
          if (!response.ok || data.ok === false) {
            failures.push(`${item.file.name}${data.error ? `: ${data.error}` : ""}`);
          } else if (item.kind === "image") {
            const visual = (data.image_context || "").trim();
            const ocr = (data.ocr_text || "").trim();
            const method = data.vision_method ? ` (${data.vision_method})` : "";
            if (visual || ocr) {
              imageContexts.push([
                `[Uploaded image: ${item.file.name}${method}]`,
                visual ? `Visual analysis: ${visual}` : "",
                ocr ? `Readable text/OCR: ${ocr}` : "",
              ].filter(Boolean).join("\n"));
            }
          }
        } catch {
          failures.push(item.file.name);
        }
      })
    );
    return { failures, imageContexts };
  }, [uid]);

  /* â”€â”€ Handle file selection â”€â”€ */
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

  /* â”€â”€ Send message â”€â”€ */
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
    let uploadedImageContexts: string[] = [];
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
      const { failures: failedFiles, imageContexts } = await ingestAttachments(queuedFiles);
      if (imageContexts.length > 0) {
        uploadedImageContexts = imageContexts;
        replyContext = [replyContext, ...imageContexts].filter(Boolean).join("\n\n");
      }
      if (failedFiles.length > 0) {
        setUploadError(`Could not fully process: ${failedFiles.slice(0, 2).map(f => f.split(':')[0]).join(", ")}${failedFiles.length > 2 ? "..." : ""}. Files were saved â€” text may be limited.`);
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
        text: uploadedImageContexts.length > 0
          ? `I read the uploaded image directly.\n\n${uploadedImageContexts.join("\n\n")}\n\nAsk me what to do next â€” for example, continue the comic, improve the panel text, or generate Chapter 2.`
          : "Your files were indexed. Ask a question and Iâ€™ll use them as context.",
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
        || [...messages].reverse().find((m) => m.role === "assistant" && m.text !== Core.GREET && !m.streaming)?.text
        || "";
      if (contextualAnswer.trim()) {
        setHasUserSentMessage(true);
      const userMsg: Core.Message = {
          role: "user",
          text: q,
          timestamp: Date.now(),
          replyTo: replyContext || undefined,
        };
        setMessages((prev) => [...prev, userMsg]);
        setQuery("");
        try {
          const titleSource = [...messages].reverse().find((m) => m.role === "user")?.text || "Credon Answer";
          const pdfResponse = await fetch(`${Core.API}/api/v1/generate/export/answer-pdf`, {
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
        setMessages((prev) => Core.preservePinnedMessagesOnEdit(prev, editingIndex));
        setEditingIndex(null);
      }
      setHasUserSentMessage(true);
      const userMsg: Core.Message = {
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

    const detectedMode = Core.detectProductMode(q);
    if (detectedMode !== productMode) setProductMode(detectedMode);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const r = await fetch(`${Core.API}/api/v1/chat/stream`, {
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
            user_profile: memoryProfile,
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
      let accSources: Core.Source[] = [];
      let accImages: Core.ImageResult[] = [];
      let accConfidence: string | undefined;
      let accThinking = "";
      let accSuggestions: string[] = [];
      let accEvaluator: { input_sources?: number; selected_sources?: number; avg_score?: number } | undefined;
      let firstTokenReceived = false;
      let thinkingActive = false;
      let thinkStartedAt = 0;
      let accMetadata: Core.Message["metadata"] | undefined;

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
              setThinkingStage(stage as Core.ThinkingStage);
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
              accSources = (evt.sources ?? []).filter((s: Core.Source) => s.url && !s.url.startsWith("about:"));
              accConfidence = evt.confidence;
              accImages = evt.images ?? [];
            } else if (evt.type === "token") {
              // First token â†’ hide thinking, show message bubble
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

              // Capture routing + agent metadata for Core.FlowTimeline and structured cards
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
                      text: Core.stripSuggestionSection(evt.answer),
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
                  text: Core.stripSuggestionSection(updated[idx].text),
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
            const candidate = Core.stripSuggestionSection(updated[idx].text);
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
      // sleeps after idle and can take 30â€“60s to wake), so the backoff must be
      // patient enough to outlast a cold boot before we surface a hard error.
      if (!isRegenerate) {
        warmBackend();
        const backoffsMs = [2000, 5000, 10000, 20000];
        for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
          if (controller.signal.aborted) return; // user stopped during backoff
          if (attempt > 0) setThinkingStage("composing");
          try {
            const retryRes = await fetch(`${Core.API}/api/v1/chat`, {
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
                  user_profile: memoryProfile,
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
                  text: Core.stripSuggestionSection(data.answer),
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
            // Otherwise this attempt failed â€” fall through to backoff/next attempt.
          }
          // Wait before the next attempt only â€” no pointless sleep after the last
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

  const runAgent = async (task: string) => {
    const t = task.trim();
    if (!t || agentRunning || loading) return;
    setHasUserSentMessage(true);
    setMessages((prev) => [...prev, { role: "user", text: t, timestamp: Date.now() }]);
    setQuery("");
    setAgentRunning(true);
    setAgentPanelOpen(true);
    setAgentPlan([]);
    setAgentSteps([]);
    setAgentFiles([]);
    setAgentLog([]);
    setAgentSummary("");
    setLoading(true);
    try {
      const r = await fetch(`${Core.API}/api/v1/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, session_id: currentSession, task: t }),
      });
      if (!r.ok || !r.body) throw new Error("agent_unavailable");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          const type = evt.type as string;
          if (type === "plan") {
            setAgentPlan((evt.steps as string[]) ?? []);
          } else if (type === "workspace") {
            setAgentFiles((evt.files as string[]) ?? []);
          } else if (type === "step_start") {
            setAgentSteps((p) => [...p, { tool: String(evt.tool), status: "running" }]);
          } else if (type === "terminal") {
            setAgentLog((p) => [...p, String(evt.output ?? "")]);
          } else if (type === "step_end") {
            setAgentSteps((p) => p.map((s, i) => i === p.length - 1 ? { ...s, status: evt.ok ? "done" : "failed", output: String(evt.output_preview ?? "") } : s));
          } else if (type === "file") {
            setAgentLog((p) => [...p, `[file] ${evt.action}: ${evt.path}`]);
            setAgentFiles((p) => (p.includes(String(evt.path)) ? p : [...p, String(evt.path)]));
          } else if (type === "thought") {
            setAgentLog((p) => [...p, `[think] ${evt.text}`]);
          } else if (type === "error") {
            setAgentLog((p) => [...p, `[error] ${evt.message}`]);
          } else if (type === "done") {
            const summary = String(evt.summary ?? "");
            setAgentSummary(summary);
            const files = (evt.files as string[]) ?? [];
            if (files.length) setAgentFiles(files);
            setMessages((prev) => [...prev, {
              role: "assistant",
              text: `**Agent task complete**${evt.elapsed ? ` in ${evt.elapsed}s` : ""}.\n\n${summary}`,
              timestamp: Date.now(),
            }]);
          }
        }
      }
    } catch {
      setAgentLog((p) => [...p, "[error] Could not reach the agent service. Is the backend running?"]);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "I could not start the agent workspace right now. Please make sure the backend is running and try again.",
        timestamp: Date.now(),
        confidence: "low",
      }]);
    } finally {
      setAgentRunning(false);
      setLoading(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (agentMode) {
      await runAgent(query);
      return;
    }
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
      if (query.trim() && !loading) {
        if (agentMode) void runAgent(query);
        else void send(query);
      }
    }
  };

  const speakSentence = (messageIndex: number, sentenceIndex: number, options?: { restart?: boolean }) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return;
    const sentences = Core.splitSentences(message.text);
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
    const sentences = Core.splitSentences(text);
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
    const recognitionWindow = window as unknown as { SpeechRecognition?: new () => Core.SpeechRecognitionLike; webkitSpeechRecognition?: new () => Core.SpeechRecognitionLike };
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
    await fetch(`${Core.API}/api/v1/chats/${uid}/${sessionId}`, {
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
    await fetch(`${Core.API}/api/v1/chats/${uid}/${sessionId}`, { method: "DELETE" });
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

  const shareAssistantMessage = async (index: number, message: Core.Message) => {
    const answerText = Core.stripSuggestionSection(message.text).trim();
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

  const shareAssistantToChannel = async (channel: "native" | "copy" | "whatsapp" | "email" | "sms", index: number, message: Core.Message) => {
    const answerText = Core.stripSuggestionSection(message.text).trim();
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
      const r = await fetch(`${Core.API}/api/v1/generate/export/answer-pdf`, {
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
      const r = await fetch(`${Core.API}/api/v1/generate/export/chat-pdf`, {
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
      const r = await fetch(`${Core.API}/api/v1/generate/export/all-chats-pdf`, {
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
      const r = await fetch(`${Core.API}/api/v1/generate/export/chat-pdf`, {
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
    if (!Core.isCodeLike(msg.text)) return;
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
    category?: Core.FeedbackCategory,
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
      await fetch(`${Core.API}/api/v1/feedback`, {
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
    const g: Record<string, Core.SessionSummary[]> = {};
    const filtered = sessions.filter((session) =>
      session.preview.toLowerCase().includes(chatSearch.toLowerCase()) ||
      session.session_id.toLowerCase().includes(chatSearch.toLowerCase())
    );
    const ordered = [...filtered].sort((a, b) => Number(pinnedSessions.includes(b.session_id)) - Number(pinnedSessions.includes(a.session_id)));
    for (const s of ordered) {
      const label = pinnedSessions.includes(s.session_id) ? "Pinned" : Core.dateLabel(s.last_updated);
      (g[label] ??= []).push(s);
    }
    return g;
  }, [sessions, chatSearch, pinnedSessions]);

  return (
    <div className={`h-dvh flex overflow-hidden ambient-grid ${themeClass} ${shellClass} ${answerFontClass}`}>
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <Core.SettingsModal
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
        memoryProfile={memoryProfile}
        setMemoryProfile={setMemoryProfile}
        clearMemoryProfile={clearMemoryProfile}
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
      <Core.PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <Core.UpdatesModal open={updatesOpen} onClose={() => setUpdatesOpen(false)} />

      {/* Profile edit modal */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={() => setProfileOpen(false)}>
          <div className="modal-content w-full max-w-sm rounded-2xl border border-stone-200 dark:border-zinc-800 bg-zinc-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-full bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-sm font-bold text-stone-900 dark:text-white">{(profileDraft || "G")[0]?.toUpperCase()}</div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 dark:text-white">Your profile</h3>
                <p className="text-[11px] text-stone-500 dark:text-zinc-500">{isGuest ? "Guest session" : user?.email ?? "Signed in"}</p>
              </div>
            </div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-zinc-500 mb-1.5">Display name</label>
            <input
              value={profileDraft}
              onChange={(e) => setProfileDraft(e.target.value)}
              maxLength={32}
              placeholder="What should Credon call you?"
              className="w-full rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-100 dark:bg-zinc-900/70 px-4 py-3 text-sm text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-zinc-600 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/15 transition"
            />
            <div className="flex gap-2.5 mt-5">
              <button type="button" onClick={() => setProfileOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white hover:border-stone-300 dark:border-zinc-700 text-sm transition">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const v = profileDraft.trim();
                  setCustomName(v || null);
                  try {
                    if (v) localStorage.setItem("credon-display-name", v);
                    else localStorage.removeItem("credon-display-name");
                  } catch { /* ignore */ }
                  setProfileOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-stone-900 dark:text-white text-sm font-medium hover:brightness-110 transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <Core.KnowledgeUploadModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} uid={uid} />
      <Core.DislikeFeedbackModal
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

      {/* â”€â”€â”€ Sidebar (DeepSeek-style) â”€â”€â”€ */}
      <aside className={`sidebar-shell fixed md:static inset-y-0 left-0 z-40 w-70 bg-stone-50/85 dark:bg-zinc-950/75 backdrop-blur-2xl border-r border-cyan-400/10 flex flex-col transition-transform duration-200 ease-out md:translate-x-0 ${railOpen ? "md:w-70" : "md:w-0 md:opacity-0 md:overflow-hidden md:border-r-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Sidebar header â€” clean, just new chat */}
        <div className="h-14 flex items-center justify-between px-3 shrink-0 border-b border-stone-200 dark:border-zinc-800/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center overflow-hidden">
              <Core.CredonLogo size={22} />
            </div>
            <span className="text-sm font-semibold text-stone-900 dark:text-white tracking-tight">CREDON-AI</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={newChat} className="p-2 text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800 transition" title="New chat">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" />
              </svg>
            </button>
            <button type="button" onClick={() => setSidebarOpen(false)} className="md:hidden p-2 text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800 transition" title="Close sidebar">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="px-3 pt-3 space-y-2">
          <input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search chats" className="w-full rounded-xl border border-stone-200 dark:border-zinc-800/80 bg-stone-100/80 dark:bg-zinc-900/60 px-3 py-2 text-xs text-stone-800 dark:text-zinc-200 outline-none focus:border-cyan-500/40" />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-3 mt-2">
          {Object.entries(grouped).map(([label, items]) => items.length === 0 ? null : (
            <div key={label}>
              <p className="text-[11px] font-medium text-stone-500 dark:text-zinc-500 uppercase tracking-wider px-2 mb-1.5">{label}</p>
              <div className="space-y-0.5">
                {items.map((s) => (
                  <div key={s.session_id} className={`sidebar-item group rounded-xl border transition ${currentSession === s.session_id ? "bg-cyan-500/10 text-stone-900 dark:text-white border-cyan-500/20" : "text-stone-500 dark:text-zinc-400 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 border-transparent"}`}>
                    <button type="button" onClick={() => { stopGeneration(); setCurrentSession(s.session_id); setSidebarOpen(false); }} className="w-full text-left px-3 pt-2.5 pb-1.5 text-sm truncate flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
                      <span className="truncate">{s.preview || "New conversation"}</span>
                    </button>
                    <div className="flex gap-1 px-3 pb-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                      <button type="button" onClick={() => setPinnedSessions((prev) => prev.includes(s.session_id) ? prev.filter((id) => id !== s.session_id) : [...prev, s.session_id])} className="text-[10px] text-stone-500 dark:text-zinc-500 hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300">{pinnedSessions.includes(s.session_id) ? "Unpin" : "Pin"}</button>
                      <button type="button" onClick={() => { void renameChat(s.session_id, s.preview); }} className="text-[10px] text-stone-500 dark:text-zinc-500 hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300">Rename</button>
                      <span className="text-[10px] text-stone-400 dark:text-zinc-700">â€¢</span>
                      <button type="button" onClick={() => { void deleteChat(s.session_id); }} className="text-[10px] text-stone-500 dark:text-zinc-500 hover:text-rose-700 dark:hover:text-rose-300">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-center mt-12 px-4">
              <svg className="w-10 h-10 text-stone-400 dark:text-zinc-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
              <p className="text-xs text-stone-500 dark:text-zinc-600">No conversations yet</p>
              <p className="text-[10px] text-stone-400 dark:text-zinc-700 mt-1">Start a new chat to begin</p>
            </div>
          )}
        </nav>
        <div className="border-t border-stone-200 dark:border-zinc-800/60">
          {learnStats && (
            <div className="mx-3 mb-1 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="learn-dot w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">Alpha learned <span className="text-cyan-700 dark:text-cyan-300 font-semibold">{learnStats.insights_learned}</span> insights</p>
              </div>
              {learnStats.last_topic ? (
                <p className="text-[10px] text-stone-500 dark:text-zinc-600 mt-0.5 truncate">latest: {learnStats.last_topic}</p>
              ) : null}
            </div>
          )}
          <div className="px-3 pt-3 pb-1 flex gap-3">
            <button type="button" onClick={() => setPrivacyOpen(true)} className="text-[11px] text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition">Privacy</button>
            <span className="text-stone-400 dark:text-zinc-700 text-[11px]">&middot;</span>
            <button type="button" onClick={() => setUpdatesOpen(true)} className="text-[11px] text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition">Updates</button>
            <span className="text-stone-400 dark:text-zinc-700 text-[11px]">&middot;</span>
            <button type="button" onClick={() => setSettingsOpen(true)} className="text-[11px] text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition">Settings</button>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setProfileDraft(displayName); setProfileOpen(true); }}
                className="w-9 h-9 rounded-full bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0 shadow-lg shadow-cyan-500/10 hover:brightness-110 transition"
                title="Edit profile"
              >
                {displayName[0]?.toUpperCase() ?? "G"}
              </button>
              <button type="button" onClick={() => { setProfileDraft(displayName); setProfileOpen(true); }} className="flex-1 min-w-0 text-left group">
                <p className="text-sm text-stone-900 dark:text-white font-medium truncate group-hover:text-cyan-700 dark:group-hover:text-cyan-700 dark:text-cyan-200 transition">{displayName}</p>
                <p className="text-[11px] text-stone-500 dark:text-zinc-500">{isGuest ? "Guest mode · tap to edit" : "Signed in · tap to edit"}</p>
              </button>
              <button type="button" onClick={onSignOut} title={isGuest ? "Back to login" : "Sign out"} className="text-stone-500 dark:text-zinc-500 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* â”€â”€â”€ Main â”€â”€â”€ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-cyan-400/10 flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0 bg-stone-50/75 dark:bg-zinc-950/55 backdrop-blur-2xl">
          {/* Sidebar toggle — panel icon (desktop collapses the rail, mobile opens the drawer) */}
          <button type="button" onClick={() => { if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) setRailOpen((v) => !v); else setSidebarOpen((v) => !v); }} className="p-2 text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800 transition" title="Toggle sidebar">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <span className="font-semibold tracking-tight text-sm sm:text-base bg-linear-to-r from-stone-900 to-stone-600 dark:from-white dark:to-zinc-300 bg-clip-text text-transparent">CREDON-AI</span>
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="ml-auto flex items-center gap-1.5 text-xs text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 bg-stone-200/70 dark:bg-zinc-800/60 hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800 px-2 sm:px-3 py-1.5 rounded-lg border border-stone-300/70 dark:border-zinc-700/40 transition" title="Settings">
            <span className="hidden sm:inline">Credon Alpha Max</span>
            <span className="sm:hidden">Settings</span>
          </button>
        </header>

        {/* Messages / Welcome */}
        <div ref={transcriptRef} onScroll={updateAutoScrollIntent} className="flex-1 overflow-y-auto">
          {isEmptyChat ? (
            <div className="min-h-full flex flex-col items-center justify-end px-4 sm:px-6 pb-5">
              <h2 className="welcome-title text-2xl sm:text-3xl md:text-4xl font-medium text-center tracking-tight mb-2 text-stone-900 dark:text-zinc-100">What can I help with?</h2>
              <p className="welcome-subtitle text-stone-500 dark:text-zinc-500 text-xs sm:text-sm mb-6 text-center">Search, reason, create, and solve â€” powered by multi-model AI.</p>
            </div>
          ) : transcriptLoading ? (
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-4">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex gap-3 items-start animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-stone-200 dark:bg-zinc-800" />
                  <div className="flex-1">
                    <div className="h-3 w-32 bg-stone-200 dark:bg-zinc-800 rounded mb-2" />
                    <div className="h-4 w-full bg-stone-200 dark:bg-zinc-800 rounded mb-1.5" />
                    <div className="h-4 w-11/12 bg-stone-200 dark:bg-zinc-800 rounded mb-1.5" />
                    <div className="h-4 w-10/12 bg-stone-200 dark:bg-zinc-800 rounded" />
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
                    m.role === "assistant" ? "bg-linear-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/10" : "bg-stone-400 dark:bg-zinc-700"
                  }`}>
                    {m.role === "assistant" ? <Core.CredonLogo size={22} /> : <span className="text-[10px] sm:text-[11px] font-bold">{displayName[0]?.toUpperCase() ?? "U"}</span>}
                  </div>

                  {/* Content */}
                  <div className={`flex flex-col max-w-[95%] sm:max-w-[88%] min-w-0 ${m.role === "user" ? "items-end" : "items-start"}`}>
                    {/* Reply context (WhatsApp-style) */}
                    {m.replyTo && (
                      <div className="mb-1 rounded-lg bg-stone-200/60 dark:bg-zinc-800/50 border-l-2 border-cyan-500/60 px-3 py-1.5 max-w-full">
                        <p className="text-[11px] text-stone-500 dark:text-zinc-500 truncate">{m.replyTo.slice(0, 100)}</p>
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
                              className="w-20 h-20 rounded-lg object-cover border border-stone-300/70 dark:border-zinc-700/40"
                            />
                          ) : (
                            <div key={ai} className="h-20 px-3 rounded-lg border border-stone-300/70 dark:border-zinc-700/40 bg-stone-100 dark:bg-zinc-900/70 flex items-center text-xs text-stone-700 dark:text-zinc-300">
                              PDF: {att.name}
                            </div>
                          )
                        ))}
                      </div>
                    )}

                    {/* Thinking block â€” shown BEFORE answer like DeepSeek */}
                    {m.role === "assistant" && m.thinking && !m.streaming && (
                      <div className="mb-1">
                        <Core.ThinkingBlock thinking={m.thinking} durationSec={m.thinkDurationSec} />
                      </div>
                    )}

                    {/* Bubble */}
                    <div className={`rounded-2xl px-4 py-3 ${
                      m.role === "user"
                        ? "bg-linear-to-br from-cyan-600/18 to-blue-600/12 border border-cyan-400/25 text-stone-900 dark:text-white rounded-tr-md shadow-md shadow-black/25 backdrop-blur-lg"
                        : "bg-stone-100/70 dark:bg-zinc-900/50 border border-stone-200 dark:border-zinc-800/60 rounded-tl-md backdrop-blur-md"
                    }`}>
                      {(() => {
                        if (!(m.role === "assistant" && !m.streaming && m.text.length > 280)) return null;
                        const previousUserQuery = [...messages.slice(0, i)].reverse().find((item) => item.role === "user")?.text ?? "";
                        if (!Core.isObjectiveQuestionPrompt(previousUserQuery)) return null;
                        const points = Core.extractMainPoints(m.text);
                        if (!points.length) return null;
                        return (
                        <div className="mb-2.5 rounded-xl border border-cyan-500/25 bg-cyan-500/6 p-2.5">
                          <p className="text-[11px] font-medium text-cyan-700 dark:text-cyan-200 mb-2 tracking-wide uppercase">Main Points</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {points.map((point, idx) => (
                              <div key={idx} className="rounded-lg border border-cyan-500/20 bg-stone-100 dark:bg-zinc-900/65 px-2.5 py-2 text-[11px] text-stone-800 dark:text-zinc-200 leading-relaxed">
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 text-[10px] mr-1.5 align-middle">{idx + 1}</span>
                                <span className="align-middle">{point}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      })()}
                      {m.role === "assistant" && m.text !== Core.GREET ? (
                        <>
                        <div className="prose prose-invert prose-sm max-w-none text-[var(--answer-size)] leading-relaxed [&_pre]:bg-stone-100/90 dark:bg-zinc-900/80 [&_pre]:border [&_pre]:border-stone-300/60 dark:border-zinc-700/30 [&_pre]:rounded-xl [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:text-cyan-700 dark:text-cyan-300 [&_code]:text-[13px] [&_a]:text-cyan-600 dark:text-cyan-400 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-cyan-500/30 hover:[&_a]:decoration-cyan-500 [&_h1]:text-xl [&_h1]:tracking-tight [&_h2]:text-lg [&_h2]:tracking-tight [&_h3]:text-base [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-medium [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-500/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-stone-700 dark:text-zinc-300 [&_table]:border-collapse [&_th]:border [&_th]:border-stone-300 dark:border-zinc-700 [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-stone-200 dark:bg-zinc-800 [&_td]:border [&_td]:border-stone-300 dark:border-zinc-700 [&_td]:px-3 [&_td]:py-1.5 [&_hr]:border-stone-300/80 dark:border-zinc-700/50 [&_strong]:text-stone-900 dark:text-zinc-100 [&_strong]:font-semibold [&_strong]:bg-cyan-400/10 [&_strong]:px-1.5 [&_strong]:py-0.5 [&_strong]:rounded-md [&_li]:marker:text-cyan-700 dark:text-cyan-300 [&_p:first-of-type]:text-stone-900 dark:text-zinc-100 [&_p:first-of-type]:font-medium">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              pre: ({ children }) => {
                                const codeText = Core.extractCodeFromPre(children);
                                return (
                                  <div className="relative group my-3">
                                    <button
                                      type="button"
                                      onClick={() => copyCodeText(codeText)}
                                      className="absolute top-2 right-2 z-10 rounded-md border border-zinc-600/70 bg-stone-100 dark:bg-zinc-900/85 px-2 py-1 text-[10px] text-stone-800 dark:text-zinc-200 opacity-90 hover:opacity-100"
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
                            {Core.stripSpecialBlocks(m.text) || (m.streaming ? "\u200B" : "")}
                          </ReactMarkdown>
                          {m.streaming && <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse rounded-sm ml-0.5 align-text-bottom" />}
                        </div>
                        {(() => { const chart = Core.parseChartBlock(m.text); return chart ? <Core.ChartBlock chart={chart} /> : null; })()}
                        </>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none text-[15px] leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* Images */}
                    {m.role === "assistant" && m.images && <Core.ImageGrid images={m.images} />}

                    {/* Sources */}
                    {m.role === "assistant" && m.sources && m.sources.length > 0 && <Core.SourcesPanel sources={m.sources} />}

                    {/* Power-user routing details: hidden by default so normal users see answer first. */}
                    {m.role === "assistant" && !m.streaming && m.text !== Core.GREET && (
                      <details className="mt-2 w-full max-w-xl text-xs text-stone-500 dark:text-zinc-500">
                        <summary className="cursor-pointer list-none rounded-xl border border-stone-200 dark:border-zinc-800/60 bg-zinc-950/30 px-3 py-2 hover:border-cyan-500/25 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300">
                          Details: sources, confidence, and manager route
                        </summary>
                        <Core.FlowTimeline message={m} />
                        <Core.AgentInsightCard message={m} />
                      </details>
                    )}

                    {/* Confidence */}
                    {m.role === "assistant" && m.confidence === "low" && m.text !== Core.GREET && (
                      <p className="mt-1.5 text-[11px] text-stone-500 dark:text-zinc-500 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        This information may not be fully accurate
                      </p>
                    )}

                    {m.role === "assistant" && m.metadata?.mode?.master_mode && !m.streaming && (
                      <p className="mt-1 text-[11px] text-cyan-700 dark:text-cyan-300/90">Master Mode response: deep reasoning + sources + code optimization</p>
                    )}

                    {/* Actions row */}
                    <div className={`flex flex-wrap items-center gap-1.5 mt-1.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                      <span className="text-[11px] text-stone-500 dark:text-zinc-600 mr-1">{Core.fmtTime(m.timestamp)}</span>
                      {m.role === "assistant" && (m.variants?.length ?? 0) > 1 && (
                        <div className="inline-flex items-center gap-1 rounded-lg border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100 dark:bg-zinc-900/70 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={() => showVariant(i, "prev")}
                            disabled={(m.activeVariant ?? (m.variants!.length - 1)) <= 0}
                            className="p-1 text-stone-500 dark:text-zinc-500 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 disabled:opacity-30"
                            title="Show previous version"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-[10px] text-stone-500 dark:text-zinc-500 px-1">
                            {(m.activeVariant ?? (m.variants!.length - 1)) + 1}/{m.variants!.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => showVariant(i, "next")}
                            disabled={(m.activeVariant ?? (m.variants!.length - 1)) >= (m.variants!.length - 1)}
                            className="p-1 text-stone-500 dark:text-zinc-500 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 disabled:opacity-30"
                            title="Show next version"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>
                      )}

                      {m.role === "assistant" && m.text !== Core.GREET && !m.streaming && (
                        <>
                          {/* Reply */}
                          <button type="button" onClick={() => setReplyTo({ text: m.text, index: i })} className="text-stone-500 dark:text-zinc-600 hover:text-cyan-600 dark:text-cyan-400 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Reply to this">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                            </svg>
                          </button>
                          <button type="button" onClick={() => quickRewrite(i, "tldr")} className="hidden sm:inline-flex text-stone-500 dark:text-zinc-600 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 text-[11px] font-medium" title="Summarize this answer">
                            TL;DR
                          </button>
                          <button type="button" onClick={() => quickRewrite(i, "simple")} className="hidden sm:inline-flex text-stone-500 dark:text-zinc-600 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 text-[11px] font-medium" title="Make this simpler">
                            Simplify
                          </button>
                          {/* Regenerate */}
                          <button type="button" onClick={() => regenerateAt(i)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Regenerate">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.94 9.349a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                            </svg>
                          </button>
                          {/* Thumbs up */}
                          <button type="button" onClick={() => submitFeedback(i, "up")}
                            className={`transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 ${m.feedback === "up" ? "text-emerald-400" : "text-stone-500 dark:text-zinc-600 hover:text-emerald-700 dark:hover:text-emerald-400"}`} title="Good answer">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={m.feedback === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={m.feedback === "up" ? 0 : 2}>
                              <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                            </svg>
                          </button>
                          {/* Thumbs down */}
                          <button type="button" onClick={() => submitFeedback(i, "down")}
                            className={`transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 ${m.feedback === "down" ? "text-rose-400" : "text-stone-500 dark:text-zinc-600 hover:text-rose-400"}`} title="Bad answer">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={m.feedback === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={m.feedback === "down" ? 0 : 2}>
                              <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10zM17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
                            </svg>
                          </button>
                          <button type="button" onClick={() => speakAnswer(i, m.text)} className={`text-stone-500 dark:text-zinc-600 hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 ${speakingIndex === i ? "text-cyan-700 dark:text-cyan-300" : ""}`} title="Read aloud with browser text-to-speech">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" /><path strokeLinecap="round" d="M15.54 8.46a5 5 0 010 7.07M18.36 5.64a9 9 0 010 12.72" /></svg>
                          </button>
                          {/* Copy */}
                          <button type="button" onClick={() => copyText(i, m.text)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Copy">
                            {copied === i ? (
                              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            )}
                          </button>
                          <div className="relative">
                            <button type="button" onClick={() => setShareMenuTarget((prev) => prev === i ? null : i)} className={`transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 ${shared === i ? "text-emerald-400" : "text-stone-500 dark:text-zinc-600 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200"}`} title="Share options">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 6l6 6-6 6" />
                              </svg>
                            </button>
                            {shareMenuTarget === i && (
                              <div className="fixed inset-x-3 bottom-24 z-40 rounded-2xl border border-stone-300 dark:border-zinc-700/60 bg-stone-50/95 dark:bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl sm:absolute sm:right-0 sm:bottom-full sm:inset-x-auto sm:mb-2 sm:w-44 sm:rounded-xl sm:p-2">
                                <div className="mb-2 flex items-center justify-between sm:hidden">
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500 dark:text-zinc-400">Share answer</p>
                                  <button
                                    type="button"
                                    onClick={() => setShareMenuTarget(null)}
                                    className="rounded-lg p-1.5 text-stone-500 dark:text-zinc-400 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70 hover:text-stone-900 dark:text-zinc-100"
                                    title="Close share options"
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[12px] sm:gap-1.5 sm:text-[11px]">
                                  {browserSupportsNativeShare && (
                                    <button type="button" onClick={() => { void shareAssistantToChannel("native", i, m); }} className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 px-3 py-2.5 text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Share</button>
                                  )}
                                  <button type="button" onClick={() => { void shareAssistantToChannel("copy", i, m); }} className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 px-3 py-2.5 text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Copy</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("whatsapp", i, m); }} className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 px-3 py-2.5 text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">WhatsApp</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("email", i, m); }} className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 px-3 py-2.5 text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">Email</button>
                                  <button type="button" onClick={() => { void shareAssistantToChannel("sms", i, m); }} className="col-span-2 rounded-xl border border-stone-300/80 dark:border-zinc-700/50 px-3 py-2.5 text-stone-800 dark:text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-700 dark:text-cyan-200 sm:rounded-lg sm:px-2 sm:py-2">SMS</button>
                                </div>
                              </div>
                            )}
                          </div>
                          <button type="button" onClick={() => exportAnswerPdf(i)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-800 dark:hover:text-stone-800 dark:text-zinc-200 transition p-1.5 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Download as PDF">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
                            </svg>
                          </button>
                        </>
                      )}

                      {m.role === "user" && (
                        <>
                          {Core.isCodeLike(m.text) && (
                            <button type="button" onClick={() => quickFixCodeFromMessage(i)} className="text-stone-500 dark:text-zinc-600 hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300 transition p-1 rounded hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 text-[10px] font-medium" title="Fix this code with Code Mode">
                              Fix Code
                            </button>
                          )}
                          <button type="button" onClick={() => copyText(i, m.text)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition p-1 rounded hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Copy">
                            {copied === i ? (
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            )}
                          </button>
                          <button type="button" onClick={() => editUserMessage(i, m.text)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition p-1 rounded hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60" title="Edit">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" /></svg>
                          </button>
                        </>
                      )}
                    </div>

                    {m.role === "assistant" && ttsPanelIndex === i && m.text !== Core.GREET && (
                      <Core.TtsPanel
                        sentences={Core.splitSentences(m.text)}
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
              {showPreTokenLoader && thinkingStage && <Core.ProgressDots stage={thinkingStage} />}

              {/* Live chain-of-thought while generating â€” word by word */}
              {showPreTokenLoader && !!liveThinking && (
                <div className="flex gap-3 items-start">
                  <Core.CredonLoadingLogo label="Credon is thinking through your request" />
                  <div className="max-w-2xl w-full">
                    <Core.ThinkingBlock thinking={liveThinking} streaming />
                  </div>
                </div>
              )}

              {/* Connecting dots (very brief, before first SSE event) */}
              {showPreTokenLoader && !thinkingStage && !liveThinking && (
                <div className="flex gap-3">
                  <Core.CredonLoadingLogo label="Credon is connecting" />
                  <div className="bg-stone-200 dark:bg-zinc-800/80 border border-stone-300/70 dark:border-zinc-700/40 rounded-2xl rounded-tl-md px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite]" />
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.2s]" />
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-[bounce_1s_infinite_0.4s]" />
                      </div>
                      <span className="text-xs text-stone-500 dark:text-zinc-500">Thinking</span>
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
          <div className="border-t border-stone-200 dark:border-zinc-800/30 bg-[#09090b]/60 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-2 sm:py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] text-stone-500 dark:text-zinc-500 font-medium">Related questions</p>
                <button type="button" onClick={() => setFollowUpsDismissed(true)} className="text-stone-500 dark:text-zinc-600 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition" title="Dismiss suggestions">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {followUps.map((s, i) => (
                  <button key={i} type="button" onClick={() => send(s)}
                    className="suggestion-chip flex min-w-[220px] items-center gap-2 text-xs text-stone-700 dark:text-zinc-300 bg-stone-200/70 dark:bg-zinc-800/60 hover:bg-cyan-500/10 border border-stone-300/70 dark:border-zinc-700/40 hover:border-cyan-500/30 rounded-xl px-3 py-2.5 transition hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300 text-left">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-stone-400 dark:bg-zinc-700/60 text-[10px] font-bold text-cyan-600 dark:text-cyan-400 shrink-0">{i + 1}</span>
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* â”€â”€â”€ Login prompt banner â”€â”€â”€ */}
        {loginPrompt && (
          <div className="border-t border-cyan-500/20 bg-cyan-500/5 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-stone-700 dark:text-zinc-300">
              {loginPrompt === "deep-think"
                ? "Sign in to use DeepThink mode"
                : loginPrompt === "web-search"
                  ? "Sign in to use Web Search"
                  : loginPrompt === "code-mode"
                    ? "Sign in to use Code Mode"
                  : "Sign in to upload knowledge"}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setLoginPrompt(null)} className="text-xs text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 transition px-2 py-1 rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60">Dismiss</button>
              <button type="button" onClick={onSignOut} className="text-xs font-medium text-black bg-cyan-400 hover:bg-cyan-300 px-3 py-1.5 rounded-lg transition">Sign In</button>
            </div>
          </div>
        )}

        {/* â”€â”€â”€ Input Area â”€â”€â”€ */}
        <div className={isEmptyChat ? "px-4 pb-8 sm:pb-10" : "border-t border-stone-200 dark:border-zinc-800/40 p-2 sm:p-4 bg-zinc-950/70 backdrop-blur-xl"}>
          {isEmptyChat && (
            <div className="max-w-3xl mx-auto mb-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {homeSuggestions.slice(0, 4).map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}
                    className="suggestion-chip text-left rounded-xl border border-stone-200 dark:border-zinc-800/70 bg-stone-100/60 dark:bg-zinc-900/35 px-3.5 py-3 text-[13px] text-stone-500 dark:text-zinc-400 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60 hover:text-stone-900 dark:text-zinc-100 hover:border-stone-300 dark:border-zinc-700 transition-all truncate">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {connectionNotice && <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-cyan-400/20 bg-cyan-500/8 px-3 py-2 text-xs text-cyan-100">{connectionNotice}</div>}
          <form onSubmit={onSubmit} className="max-w-3xl mx-auto">
            {/* Editing indicator */}
            {editingIndex !== null && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M16.862 4.487l1.687-1.688a2.121 2.121 0 113 3L10.582 16.767a4.5 4.5 0 01-1.897 1.13L6 18l.103-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" /></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-amber-400 font-medium">Editing message</p>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">Messages after this point will be replaced</p>
                </div>
                <button type="button" onClick={() => { setEditingIndex(null); setQuery(""); }} className="text-stone-500 dark:text-zinc-500 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition shrink-0" title="Cancel edit">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Reply context chip */}
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-cyan-600 dark:text-cyan-400 font-medium mb-0.5">Replying to:</p>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">{replyTo.text.slice(0, 120)}</p>
                </div>
                <button type="button" onClick={() => setReplyTo(null)} className="text-stone-500 dark:text-zinc-500 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white transition shrink-0" title="Cancel reply">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Attached files preview */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex gap-2 flex-wrap">
                {attachedFiles.map((item, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stone-300/70 dark:border-zinc-700/40 bg-stone-100 dark:bg-zinc-900/70">
                    {item.kind === "image" && item.preview ? (
                      <Image src={item.preview} alt="attachment" fill sizes="64px" unoptimized className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-stone-500 dark:text-zinc-400 px-1 text-center">
                        <span className="text-xs">PDF</span>
                        <span className="truncate w-full">{item.file.name}</span>
                      </div>
                    )}
                    <button type="button" onClick={() => removeAttachedFile(i)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-stone-900 dark:text-white flex items-center justify-center text-[10px]">
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
                <span>Offline â€” draft saved on this device.</span>
                <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-amber-300/30 px-2 py-1">Retry</button>
              </div>
            )}
            {isOnline && query && <p className="mb-1 text-[10px] text-stone-500 dark:text-zinc-600">Saved draft</p>}

            {allModesActive && (
              <div className="mb-1.5 rounded-xl border border-cyan-400/35 bg-linear-to-r from-cyan-500/12 via-blue-500/8 to-cyan-500/12 px-2.5 py-1 text-[10px] sm:text-[11px] text-cyan-100 trinity-glow">
                <span className="sm:hidden">Master Mode active</span>
                <span className="hidden sm:inline">Master Mode active: Web Search + DeepThink + Code Mode</span>
              </div>
            )}
            <div className="sm:hidden mb-2">
              {mobileModesOpen && (
                <div className="rounded-xl border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100 dark:bg-zinc-900/95 backdrop-blur-xl p-2 shadow-2xl">
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
                      className={`h-9 rounded-lg border text-[11px] font-medium transition ${codeMode ? "border-cyan-500/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200" : "border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/90 dark:bg-zinc-900/80 text-stone-500 dark:text-zinc-400"}`}
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
                      className="h-9 rounded-lg border border-stone-300/80 dark:border-zinc-700/50 bg-stone-100/90 dark:bg-zinc-900/80 text-[11px] font-medium text-stone-700 dark:text-zinc-300 transition hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300"
                    >
                      Knowledge
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`flex flex-col gap-2 bg-stone-100 dark:bg-zinc-900/70 border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 focus-within:border-cyan-400/45 focus-within:shadow-[0_0_32px_rgba(34,211,238,0.09)] transition-all shadow-lg shadow-black/25 backdrop-blur-xl ${allModesActive ? "border-cyan-500/45 trinity-glow" : "border-stone-300/80 dark:border-zinc-700/50"}`}>
              <textarea
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={warmBackend}
                onKeyDown={handleKeyDown}
                placeholder="Message Credon AI&#8230;"
                rows={1}
                className="w-full min-h-[2.75rem] bg-transparent px-1 py-1.5 outline-none text-[15px] placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-zinc-500 resize-none max-h-48 leading-relaxed"
              />
              <div className="flex items-end justify-between gap-2">
              <div className="flex items-center gap-0.5 sm:gap-1.5">
              {/* Attach file button */}
              <div className="relative shrink-0">
              <button type="button" onClick={() => setInputMenuOpen((prev) => !prev)}
                className={`min-h-10 min-w-10 p-2 sm:p-2.5 transition rounded-xl shrink-0 flex items-center justify-center ${inputMenuOpen ? "text-cyan-700 dark:text-cyan-200 bg-cyan-500/10" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`} title="Add image, document, or camera">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </button>
              {inputMenuOpen && (
                <div className="absolute bottom-11 left-0 z-30 w-44 rounded-2xl border border-stone-300 dark:border-zinc-700/60 bg-stone-50/95 dark:bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
                  <button type="button" onClick={() => { fileInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-stone-800 dark:text-zinc-200 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70">Image upload</button>
                  <button type="button" onClick={() => { fileInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-stone-800 dark:text-zinc-200 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70">PDF document</button>
                  <button type="button" onClick={() => { cameraInputRef.current?.click(); setInputMenuOpen(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs text-stone-800 dark:text-zinc-200 hover:bg-stone-200/80 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/80 dark:bg-zinc-800/70">Camera</button>
                </div>
              )}
              </div>

              <button
                type="button"
                onClick={() => setMobileModesOpen((prev) => !prev)}
                className={`sm:hidden min-h-10 min-w-10 p-2 rounded-xl transition shrink-0 flex items-center justify-center ${mobileModesOpen ? "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`}
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
                className={`flex min-h-10 min-w-10 p-2 sm:p-2.5 rounded-xl transition shrink-0 items-center justify-center ${useWeb ? "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use Web Search" : useWeb ? "Web search ON" : "Web search OFF"}>
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </button>

              {/* Deep think toggle â€” guests see sign-in prompt */}
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
                className={`flex min-h-10 min-w-10 p-2 sm:p-2.5 rounded-xl transition shrink-0 items-center justify-center ${deepThink ? "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`}
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
                className={`hidden sm:flex min-h-10 min-w-10 p-2.5 rounded-xl transition shrink-0 items-center justify-center ${codeMode ? "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use Code Mode" : codeMode ? "Code Mode ON" : "Code Mode OFF"}
              >
                <span className="text-xs font-bold">&lt;/&gt;</span>
              </button>

              {/* Agent mode toggle — Devin-style autonomous workspace */}
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("code-mode");
                    return;
                  }
                  setAgentMode((prev) => !prev);
                }}
                className={`flex min-h-10 min-w-10 p-2.5 rounded-xl transition shrink-0 items-center justify-center ${agentMode ? "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30" : "text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-stone-700 dark:text-zinc-300 hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:hover:bg-stone-200/70 dark:bg-zinc-800/60"}`}
                title={isGuest ? "Sign in to use Agent mode" : agentMode ? "Agent mode ON — Credon plans, searches, codes & runs" : "Agent mode — autonomous task workspace"}
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </button>

              {/* Upload knowledge button â€” guests see sign-in prompt */}
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setLoginPrompt("knowledge");
                    return;
                  }
                  setKnowledgeOpen(true);
                }}
                className="hidden sm:flex min-h-10 min-w-10 p-2.5 rounded-xl transition shrink-0 items-center justify-center text-stone-500 dark:text-zinc-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-500/10"
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
                className={`relative flex min-h-10 min-w-10 items-center justify-center rounded-xl p-2.5 transition shrink-0 mb-0.5 ${listening ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-200 ring-1 ring-cyan-400/50 shadow-lg shadow-cyan-500/10" : "text-stone-500 dark:text-zinc-500 hover:text-cyan-700 dark:hover:text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"}`}
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
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-stone-400 dark:bg-zinc-700 flex items-center justify-center hover:bg-stone-500 dark:hover:bg-zinc-600 transition shrink-0 mb-0.5" title="Stop">
                  <div className="w-3.5 h-3.5 rounded-sm bg-white" />
                </button>
              ) : (
                <button type="submit" disabled={(!query.trim() && attachedFiles.length === 0) || uploadingFiles}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 flex items-center justify-center disabled:opacity-30 transition hover:brightness-110 shrink-0 mb-0.5" title="Send">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-stone-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              )}
              </div>
              </div>
            </div>
            {uploadingFiles && uploadStatus && (
              <p className="text-center text-[11px] text-cyan-700 dark:text-cyan-300 mt-1.5 sm:mt-2 flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-dot-3" />
                <span>{uploadStatus}</span>
              </p>
            )}
            <p className="text-center text-[10px] sm:text-[11px] text-stone-500 dark:text-zinc-600 mt-1.5 sm:mt-2 select-none">Credon AI can make mistakes. Verify important information.</p>
          </form>
        </div>
      </main>

      {/* ─── Agent Workspace panel (Devin-style) ─── */}
      {agentPanelOpen && (
        <section className="agent-panel fixed md:relative inset-y-0 right-0 z-40 w-full sm:w-[420px] md:w-96 bg-stone-50/95 dark:bg-zinc-950/95 backdrop-blur-2xl border-l border-stone-200 dark:border-zinc-800/60 flex flex-col">
          <div className="h-14 flex items-center justify-between px-4 border-b border-stone-200 dark:border-zinc-800/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${agentRunning ? "bg-cyan-400 learn-dot" : "bg-emerald-400"}`} />
              <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">Agent Workspace</h3>
              <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-zinc-500">{agentRunning ? "working…" : "idle"}</span>
            </div>
            <button type="button" onClick={() => setAgentPanelOpen(false)} className="p-2 text-stone-500 dark:text-zinc-500 hover:text-stone-900 dark:hover:text-stone-900 dark:text-white rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-200 dark:bg-zinc-800 transition" title="Close workspace">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {agentPlan.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-500 mb-2">Plan</p>
                <ol className="space-y-1.5">
                  {agentPlan.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] text-stone-700 dark:text-zinc-300 leading-snug">
                      <span className="mt-0.5 w-4 h-4 rounded-full bg-stone-200 dark:bg-zinc-800 text-[9px] flex items-center justify-center text-stone-500 dark:text-zinc-400 shrink-0">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {agentSteps.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-500 mb-2">Actions</p>
                <div className="space-y-1.5">
                  {agentSteps.map((s, i) => (
                    <div key={i} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px] ${s.status === "running" ? "border-cyan-500/30 bg-cyan-500/5 agent-step-active text-cyan-700 dark:text-cyan-200" : s.status === "failed" ? "border-rose-500/25 bg-rose-500/5 text-rose-300" : "border-stone-200 dark:border-zinc-800/70 bg-stone-100/70 dark:bg-zinc-900/50 text-stone-700 dark:text-zinc-300"}`}>
                      {s.status === "done" ? (
                        <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      ) : s.status === "failed" ? (
                        <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-cyan-400/30 border-t-cyan-300 animate-spin shrink-0" />
                      )}
                      <span className="font-mono text-[11.5px]">{s.tool}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agentLog.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-500 mb-2">Terminal</p>
                <div className="rounded-xl border border-stone-200 dark:border-zinc-800/80 bg-black/50 p-3 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-stone-500 dark:text-zinc-400 whitespace-pre-wrap break-words">
                  {agentLog.map((line, i) => (
                    <p key={i} className={line.startsWith("[error]") ? "text-rose-400" : line.startsWith("[think]") ? "text-stone-500 dark:text-zinc-500 italic" : line.startsWith("[file]") ? "text-cyan-700 dark:text-cyan-300" : ""}>{line}</p>
                  ))}
                  {agentRunning && <p className="text-cyan-600 dark:text-cyan-400 animate-pulse">▋</p>}
                </div>
              </div>
            )}

            {agentFiles.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-zinc-500 mb-2">Files</p>
                <div className="flex flex-wrap gap-1.5">
                  {agentFiles.map((f) => (
                    <span key={f} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-zinc-800/80 bg-stone-100/80 dark:bg-zinc-900/60 px-2.5 py-1 font-mono text-[11px] text-stone-700 dark:text-zinc-300">
                      <svg className="w-3 h-3 text-stone-500 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!agentRunning && agentPlan.length === 0 && agentLog.length === 0 && (
              <div className="text-center pt-10 px-4">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-cyan-700 dark:text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
                </div>
                <p className="text-sm text-stone-700 dark:text-zinc-300 font-medium">Agent workspace</p>
                <p className="text-xs text-stone-500 dark:text-zinc-500 mt-1.5 leading-relaxed">Turn on Agent mode in the composer, describe a task, and watch Credon plan, search, write code, and run it — right here.</p>
              </div>
            )}
          </div>

          {(agentSummary || agentRunning) && (
            <div className="border-t border-stone-200 dark:border-zinc-800/60 px-4 py-3 shrink-0">
              {agentSummary ? (
                <p className="text-[12px] text-stone-500 dark:text-zinc-400 leading-relaxed line-clamp-3"><span className="text-emerald-400 font-medium">Done.</span> {agentSummary}</p>
              ) : (
                <p className="text-[12px] text-cyan-700 dark:text-cyan-300 flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-cyan-400/30 border-t-cyan-300 animate-spin" /> Agent is working…</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ROOT
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */


export { ChatPage, InstallPromptBanner };

