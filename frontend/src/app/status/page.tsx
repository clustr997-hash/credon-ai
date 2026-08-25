"use client";

import { useEffect, useState } from "react";
import { MetaPage } from "@/components/meta-page";

type Check = { label: string; ok: boolean | null; note?: string };

export default function StatusPage() {
  const [checks, setChecks] = useState<Check[]>([
    { label: "Credon engine (backend)", ok: null },
    { label: "Model network (direct)", ok: null },
    { label: "Web search", ok: null },
  ]);
  const [checkedAt, setCheckedAt] = useState<string>("");

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    const next: Check[] = [...checks];

    (async () => {
      // engine
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${base}/health`, { signal: controller.signal });
        clearTimeout(timer);
        next[0].ok = res.ok;
        next[0].note = res.ok ? base : undefined;
      } catch {
        next[0].ok = false;
        next[0].note = "not running — Credon answers via the model network instead";
      }

      // model network: any key configured client-side
      const direct =
        Boolean(process.env.NEXT_PUBLIC_GROQ_API_KEY) ||
        Boolean(process.env.NEXT_PUBLIC_OPENROUTER_API_KEY) ||
        Boolean(process.env.NEXT_PUBLIC_GEMINI_API_KEY);
      next[1].ok = direct;
      next[1].note = direct ? "browser fallback ready" : "no keys configured";

      setChecks([...next]);
      setCheckedAt(new Date().toLocaleTimeString());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MetaPage title="Status">
      <div className="space-y-3">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-4 rounded-2xl border border-stone-900/[0.07] bg-white px-5 py-4 shadow-sm">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${
                check.ok === null ? "animate-pulse bg-stone-300" : check.ok ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{check.label}</p>
              <p className="truncate text-[13px] text-stone-500">
                {check.ok === null ? "checking…" : check.ok ? "Operational" : check.note || "Degraded — fallbacks active"}
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-medium uppercase tracking-wider" style={{ color: check.ok ? "#059669" : "#b45309" }}>
              {check.ok === null ? "…" : check.ok ? "up" : "fallback"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[13px] text-stone-500">
        Credon is designed so that even when a component is down, chat keeps working through
        automatic failover. {checkedAt && `Checked at ${checkedAt}.`}
      </p>
    </MetaPage>
  );
}
