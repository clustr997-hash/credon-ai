"use client";

/** Voice conversation: speech recognition + spoken replies. All on-device, free. */

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createRecognizer(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onEnd: () => void
): { start: () => void; stop: () => void } | null {
  const w = window as unknown as Record<string, new () => RecognitionLike>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined;
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) onFinal(transcript.trim());
      else interim += transcript;
    }
    if (interim) onInterim(interim);
  };
  recognition.onerror = () => onEnd();
  recognition.onend = () => onEnd();

  return {
    start: () => {
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    },
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* not running */
      }
    },
  };
}

/* ── spoken replies ── */

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stripForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " Code block skipped. ")
    .replace(/\${1,2}[^$]*\${1,2}/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string, opts: { onEnd?: () => void; onStart?: () => void; rate?: number } = {}): void {
  if (!ttsSupported()) return;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(stripForSpeech(text).slice(0, 4500));
  utterance.rate = opts.rate ?? 1.02;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en-IN/i.test(v.lang)) ||
    voices.find((v) => /Google UK English Male|Daniel|Alex/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  utterance.onstart = () => opts.onStart?.();
  utterance.onend = () => opts.onEnd?.();
  utterance.onerror = () => opts.onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return ttsSupported() && window.speechSynthesis.speaking;
}
