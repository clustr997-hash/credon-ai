"use client";

/**
 * PCL Live — read-only observability for the Persistent Cognitive Loop.
 * Static-export safe (all data loads client-side). Public page, no auth gate.
 * Never touches the main chat path.
 */
import { useCallback, useEffect, useState } from "react";
import { CredonLogo, resolveApiBase } from "@/components/core";
import { cognitiveThink } from "@/lib/cognitive";

type CurveRow = { goal: string; kind: string; plan_steps: number; success: boolean; surprise: number; latency_s: number };

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <p className="text-[12px] font-medium uppercase tracking-wider text-stone-500">{label}</p>
      <p className="mt-1 text-[15px] font-semibold text-stone-100">{value}</p>
    </div>
  );
}

export default function PclLivePage() {
  const [provider, setProvider] = useState("…");
  const [curve, setCurve] = useState<CurveRow[]>([]);
  const [memory, setMemory] = useState("…");
  const [verifier, setVerifier] = useState("…");
  const [cstate, setCstate] = useState("…");
  const [demoQ, setDemoQ] = useState("What is transformer architecture?");
  const [demoOut, setDemoOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const base = resolveApiBase();
    setError("");
    try {
      const r = await fetch(`${base}/api/v1/cognitive/evals`, { cache: "no-store" });
      if (!r.ok) throw new Error(`evals: backend ${r.status}`);
      const j = await r.json();
      setProvider(`${j.embed_provider ?? "?"} (${j.embed_dim ?? "?"}-d)`);
      setCurve(j.long_horizon_curve?.data ?? []);
      const m = j.memory_metrics?.data;
      setMemory(m ? `semantic=${String(m.semantic_found)} episodic=${String(m.episodic_found)}` : "no data yet");
      const v = j.verifier_metrics?.data;
      setVerifier(v ? `good=${v.good_surprise} bad=${v.bad_surprise} sep=${v.separation}` : "no data yet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed — is the backend running?");
    }
    try {
      const r = await fetch(`${base}/api/v1/cognitive/state?user_id=pcl-live-viewer`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        const s = j.state ?? {};
        setCstate(`cycles=${s.self?.total_cycles ?? 0} reliability=${s.self?.reliability_score ?? "?"} surprise=${s.last_surprise ?? "?"}`);
      }
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const runDemo = useCallback(async () => {
    if (!demoQ.trim() || busy) return;
    setBusy(true);
    setDemoOut("");
    try {
      const j = await cognitiveThink("pcl-live-viewer", "live", demoQ.trim(), { use_web: false });
      const cog = (j.metadata as { cognitive?: { plan?: { title: string; tool: string; status: string }[]; surprise?: number } } | undefined)?.cognitive;
      const plan = (cog?.plan ?? []).map((p) => `• [${p.tool}] ${p.title} (${p.status})`).join("\n");
      setDemoOut(
        `answer (${String(j.confidence)}, surprise=${cog?.surprise}):\n${String(j.answer).slice(0, 900)}\n\nplan:\n${plan}\n\nthinking:\n${String(j.thinking).slice(0, 600)}`
      );
    } catch (e) {
      setDemoOut(e instanceof Error ? `error: ${e.message}` : "error");
    } finally {
      setBusy(false);
    }
  }, [demoQ, busy]);

  return (
    <div className="min-h-screen bg-[#141311] px-4 py-8 text-stone-200">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <CredonLogo size={32} />
          <div>
            <h1 className="text-xl font-bold text-white">PCL Live</h1>
            <p className="text-[13px] text-stone-400">Persistent Cognitive Loop — evals, memory, verifier, sandbox demo. Read-only.</p>
          </div>
        </div>

        {error && <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-200">{error}</p>}

        <div className="grid gap-3 md:grid-cols-2">
          <Card label="Embedding provider" value={provider} />
          <Card label="Cognitive state" value={cstate} />
          <Card label="Memory (teach → recall)" value={memory} />
          <Card label="Verifier (good vs bad surprise)" value={verifier} />
        </div>

        <h2 className="mb-2 mt-6 text-[15px] font-semibold text-white">Long-horizon curve</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-[12px] uppercase tracking-wider text-stone-500">
                <th className="px-4 py-2">Task</th>
                <th className="px-4 py-2">Steps</th>
                <th className="px-4 py-2">OK</th>
                <th className="px-4 py-2">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((row) => (
                <tr key={row.goal} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-stone-300">{row.kind} — {row.goal.slice(0, 44)}</td>
                  <td className="px-4 py-2">{row.plan_steps}</td>
                  <td className="px-4 py-2">{row.success ? "✅" : "❌"}</td>
                  <td className="px-4 py-2">{row.surprise}</td>
                </tr>
              ))}
              {curve.length === 0 && (
                <tr><td className="px-4 py-3 text-stone-500" colSpan={4}>No eval data yet — run the backend eval suite.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mb-2 mt-6 text-[15px] font-semibold text-white">Live think demo (sandbox user, web off)</h2>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
          <div className="flex gap-2">
            <input
              value={demoQ}
              onChange={(e) => setDemoQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runDemo(); }}
              placeholder="Ask the cognitive loop…"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-white/25"
            />
            <button
              onClick={runDemo}
              disabled={busy}
              className="shrink-0 rounded-xl bg-white px-4 py-2 text-[14px] font-semibold text-black disabled:opacity-50"
            >
              {busy ? "Thinking…" : "Run"}
            </button>
          </div>
          {demoOut && <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap text-[13px] text-stone-300">{demoOut}</pre>}
        </div>

        <button onClick={load} className="mt-4 text-[13px] font-medium text-stone-500 underline">Refresh now (auto-refreshes every 15s)</button>
      </div>
    </div>
  );
}
