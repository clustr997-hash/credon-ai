"use client";

import Link from "next/link";
import { CredonMark } from "@/components/logo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <CredonMark size={44} animate />
      <h1 className="mt-7 font-display text-4xl tracking-tight">Something glitched.</h1>
      <p className="mt-3 max-w-sm text-[14.5px]" style={{ color: "var(--text-dim)" }}>
        {error.message?.slice(0, 140) || "An unexpected error interrupted Credon."}
      </p>
      <div className="mt-8 flex gap-3">
        <button
          onClick={reset}
          className="rounded-xl px-5 py-2.5 text-[14px] font-medium text-white transition-all hover:-translate-y-px"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl border px-5 py-2.5 text-[14px] font-medium transition-all hover:-translate-y-px"
          style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
