"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CredonMark } from "@/components/logo";

/* ── scroll reveal ── */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({
  children,
  className = "",
  delay = "",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: string;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`${shown ? `anim-fade-up ${delay}` : "opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

const NAV_LINKS = [
  { label: "Capabilities", href: "#capabilities" },
  { label: "Agent", href: "#agent" },
  { label: "Models", href: "#models" },
];

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function launch(query: string) {
    if (!query.trim()) return;
    setLaunching(true);
    localStorage.setItem("credon-pending-query", query.trim());
    localStorage.setItem("credon-guest", "1");
    router.push("/app");
  }

  return (
    <div className="min-h-dvh bg-[#FAF9F6] text-stone-900 antialiased selection:bg-[#c9653c]/15">
      {/* ═══ NAV ═══ */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-[#FAF9F6]/85 backdrop-blur-xl border-b border-stone-900/[0.06]" : ""
        }`}
      >
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-75">
            <CredonMark size={28} />
            <span className="text-[17px] font-semibold tracking-tight">
              Credon<span className="font-normal text-stone-400"> AI</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg px-3.5 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-900/[0.04] hover:text-stone-900"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-900/[0.05] sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-px hover:bg-stone-800 hover:shadow-md active:translate-y-0"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden px-5 pb-16 pt-36 md:pt-44">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-320px] h-[640px] w-[900px] -translate-x-1/2 rounded-full opacity-60"
          style={{ background: "radial-gradient(closest-side, rgba(224,129,88,0.14), transparent)" }}
        />
        <div className="relative mx-auto max-w-4xl text-center">
          <div className="anim-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-stone-900/[0.08] bg-white/70 px-3.5 py-1.5 text-[13px] text-stone-600 shadow-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#c9653c] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#c9653c]" />
            </span>
            Agentic AI workspace — free to start
          </div>

          <h1 className="anim-fade-up d-1 text-balance font-display text-[44px] leading-[1.05] tracking-[-0.02em] md:text-[76px]">
            Where questions become{" "}
            <em className="italic text-[#b4552e]">finished work.</em>
          </h1>

          <p className="anim-fade-up d-2 mx-auto mt-6 max-w-2xl text-balance text-[17px] leading-relaxed text-stone-600 md:text-lg">
            Credon researches the live web, reads your documents, writes and runs
            code in a sandbox, and reasons through hard problems — then hands you
            a polished answer with sources.
          </p>

          {/* working hero composer — typing here jumps straight into Credon */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              launch(heroQuery);
            }}
            className="anim-fade-up d-3 mx-auto mt-9 flex w-full max-w-xl items-center gap-2 rounded-2xl border border-stone-900/10 bg-white p-2 shadow-lg shadow-stone-900/[0.06] transition-all focus-within:border-[#c9653c]/40 focus-within:shadow-xl"
          >
            <input
              value={heroQuery}
              onChange={(e) => setHeroQuery(e.target.value)}
              placeholder="Ask Credon anything — research, code, exam prep…"
              className="h-11 min-w-0 flex-1 bg-transparent px-3.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400"
            />
            <button
              type="submit"
              disabled={!heroQuery.trim() || launching}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#c9653c] px-5 text-[14.5px] font-medium text-white transition-all hover:bg-[#b4552e] disabled:opacity-40"
            >
              {launching ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                "Ask →"
              )}
            </button>
          </form>
          <p className="anim-fade-up d-4 mt-4 text-[13px] text-stone-500">
            Free · no signup needed to try ·{" "}
            <Link href="/register" className="font-medium text-[#b4552e] hover:underline">
              create an account
            </Link>{" "}
            to save everything
          </p>
        </div>

        {/* ── Product mock ── */}
        <Reveal className="relative mx-auto mt-16 max-w-5xl md:mt-20" delay="">
          <ProductMock />
        </Reveal>
      </section>

      {/* ═══ PROOF OF WORK — real transcripts, not feature cards ═══ */}
      <section id="capabilities" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 md:py-32">
        <Reveal>
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#b4552e]">
            Proof of work
          </p>
          <h2 className="max-w-xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            Real sessions. Real outputs.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          <Reveal>
            <TranscriptCard
              tag="Research"
              query="What's the current state of solid-state batteries?"
              lines={[
                { p: "$", t: "credon research --deep", c: "text-white/40" },
                { p: "✓", t: "6 sources · 2 from 2026", c: "text-emerald-300/90" },
                { p: "│", t: "Toyota: 745 Wh/kg pilot line (2027 target)", c: "text-white/70" },
                { p: "│", t: "QuantumScape shipping B-samples to VW", c: "text-white/70" },
                { p: "◆", t: "report + citations ready", c: "text-[#f0956c]" },
              ]}
              footer="Every claim linked. Confidence scored. Exportable as PDF."
            />
          </Reveal>
          <Reveal delay="d-1">
            <TranscriptCard
              tag="Agent"
              query="Build an expense tracker in Python and test it"
              lines={[
                { p: "◇", t: "plan · 4 steps", c: "text-[#f0956c]" },
                { p: "2/", t: "code  tracker.py + tests", c: "text-white/75" },
                { p: "✓", t: "exit 0 · 7 tests passed", c: "text-emerald-300/90" },
                { p: "3/", t: "demo: add ₹450 lunch, list all", c: "text-white/75" },
                { p: "◆", t: "files in workspace · PR-ready", c: "text-[#f0956c]" },
              ]}
              footer="Plans, writes, runs in a sandbox, shows every log line."
            />
          </Reveal>
          <Reveal delay="d-2">
            <TranscriptCard
              tag="Exam prep"
              query="/studyplan DBMS unit 3, exam in 6 days"
              lines={[
                { p: "◇", t: "6-day plan · 2h/day", c: "text-[#f0956c]" },
                { p: "D1", t: "ER modeling + normalization drills", c: "text-white/70" },
                { p: "D4", t: "transactions + 20 MCQ quiz", c: "text-white/70" },
                { p: "✓", t: "flashcards: 24 cards generated", c: "text-emerald-300/90" },
                { p: "◆", t: "weak spots tracked via quizzes", c: "text-[#f0956c]" },
              ]}
              footer="Plans, flashcards and quizzes that adapt to what you get wrong."
            />
          </Reveal>
        </div>
      </section>

      {/* ═══ AGENT ═══ */}
      <section id="agent" className="border-y border-stone-900/[0.06] bg-[#F3F1EC] scroll-mt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 md:grid-cols-2 md:py-32">
          <Reveal>
            <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#b4552e]">
              Agent mode
            </p>
            <h2 className="font-display text-4xl leading-tight tracking-tight md:text-5xl">
              Give it a goal. Watch the plan unfold.
            </h2>
            <p className="mt-5 max-w-lg leading-relaxed text-stone-600">
              Flip one switch and Credon stops answering sentence-by-sentence and starts
              working like an engineer: it drafts a plan, searches, computes, self-checks
              in a terminal, and delivers the finished result.
            </p>
            <ul className="mt-7 space-y-3.5">
              {[
                "Plans multi-step workflows before touching anything",
                "Runs Python in a locked-down sandbox with timeouts",
                "Streams every step live — nothing hidden",
                "Synthesizes a final report with sources",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-stone-700">
                  <span className="mt-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#c9653c]/12 text-[10px] text-[#b4552e]">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className="mt-9 inline-flex h-11 items-center gap-2 rounded-xl bg-stone-900 px-6 text-[15px] font-medium text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              Try Agent mode →
            </Link>
          </Reveal>

          <Reveal delay="d-2">
            <AgentCard />
          </Reveal>
        </div>
      </section>

      {/* ═══ HOW CREDON ANSWERS — the mesh ═══ */}
      <section id="models" className="border-y border-stone-900/[0.06] bg-[#F3F1EC] scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-24 md:py-32">
          <Reveal className="text-center">
            <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#b4552e]">
              Under the hood
            </p>
            <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
              One question. Seven lanes. Zero downtime.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-stone-600">
              Credon routes every message across a mesh of free model lanes. If one is busy,
              another answers — you never see a limit, a quota, or an error.
            </p>
          </Reveal>

          <Reveal delay="d-1">
            <MeshFlow />
          </Reveal>

          <Reveal delay="d-2">
            <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { n: "7", l: "model lanes" },
                { n: "<0.4s", l: "cached answers" },
                { n: "0", l: "quota errors shown" },
                { n: "₹0", l: "forever tier" },
              ].map((stat) => (
                <div key={stat.l} className="rounded-2xl border border-stone-900/[0.07] bg-white p-5 text-center shadow-sm">
                  <p className="font-display text-3xl tracking-tight text-[#b4552e]">{stat.n}</p>
                  <p className="mt-1 text-[12.5px] text-stone-500">{stat.l}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="px-5 pb-28">
        <Reveal className="grain relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-stone-900 px-8 py-20 text-center md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-180px] h-[420px] w-[720px] -translate-x-1/2 rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(224,129,88,0.25), transparent)" }}
          />
          <h2 className="relative font-display text-4xl leading-tight text-[#FAF9F6] md:text-5xl">
            Your next big answer is one question away.
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-stone-300">
            Join Credon free and turn hours of tab-hopping into minutes of focused work.
          </p>
          <Link
            href="/register"
            className="relative mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-[#c9653c] px-8 text-[15px] font-medium text-white shadow-lg shadow-black/30 transition-all hover:-translate-y-0.5 hover:bg-[#b4552e]"
          >
            Create your free account →
          </Link>
        </Reveal>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-stone-900/[0.06] px-5 py-12">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <CredonMark size={24} />
              <span className="text-[15px] font-semibold">Credon AI</span>
            </div>
            <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-stone-500">
              An agentic AI workspace that researches, reasons, reads your documents and builds —
              free for students, researchers and builders.
            </p>
          </div>
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Product</p>
            <ul className="space-y-2 text-[13.5px] text-stone-600">
              <li><a href="#capabilities" className="transition-colors hover:text-stone-900">Capabilities</a></li>
              <li><a href="#agent" className="transition-colors hover:text-stone-900">Agent mode</a></li>
              <li><a href="#models" className="transition-colors hover:text-stone-900">Model family</a></li>
              <li><Link href="/changelog" className="transition-colors hover:text-stone-900">Changelog</Link></li>
              <li><Link href="/status" className="transition-colors hover:text-stone-900">Status</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Company & legal</p>
            <ul className="space-y-2 text-[13.5px] text-stone-600">
              <li><Link href="/help" className="transition-colors hover:text-stone-900">Help & FAQ</Link></li>
              <li><Link href="/privacy" className="transition-colors hover:text-stone-900">Privacy policy</Link></li>
              <li><Link href="/terms" className="transition-colors hover:text-stone-900">Terms of use</Link></li>
              <li><Link href="/login" className="transition-colors hover:text-stone-900">Sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-stone-900/[0.06] pt-6 sm:flex-row">
          <p className="text-[12.5px] text-stone-400">© {new Date().getFullYear()} Credon AI. All rights reserved.</p>
          <p className="text-[12.5px] text-stone-400">Research · Reason · Build</p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════ pieces ═══════════ */

function TranscriptCard({
  tag,
  query,
  lines,
  footer,
}: {
  tag: string;
  query: string;
  lines: { p: string; t: string; c: string }[];
  footer: string;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-900/[0.08] bg-[#0d0d10] shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="rounded-md bg-[#e08158]/15 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-[#f0956c]">
          {tag}
        </span>
      </div>
      <div className="flex-1 p-4">
        <p className="mb-3 rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] text-white/85">
          {query}
        </p>
        <div className="space-y-1.5">
          {lines.map((line, i) => (
            <div key={i} className="term-line flex gap-2.5 anim-fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
              <span className="w-4 shrink-0 text-right text-white/25">{line.p}</span>
              <span className={line.c}>{line.t}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-white/[0.06] px-4 py-3 text-[12px] leading-relaxed text-white/40">
        {footer}
      </p>
    </div>
  );
}

function MeshFlow() {
  const lanes = ["Alpha", "Flash", "Reasoning", "Deep", "Scout", "+2 more"];
  return (
    <div className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-2xl border border-stone-900/[0.08] bg-[#0d0d10] p-6 shadow-xl md:p-8">
      <div className="flex flex-col items-center gap-6 md:flex-row md:gap-4">
        {/* question */}
        <div className="w-full max-w-[180px] shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-center">
          <p className="text-[12px] text-white/45">your question</p>
          <p className="mt-0.5 font-mono text-[12.5px] text-white/85">"explain transformers"</p>
        </div>

        {/* arrow */}
        <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0 rotate-90 text-white/25 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M4 12h16m0 0-5-5m5 5-5 5" />
        </svg>

        {/* mesh core */}
        <div className="relative flex-1 rounded-xl border border-[#e08158]/25 bg-[#e08158]/[0.05] p-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {lanes.map((lane, i) => (
              <span
                key={lane}
                className="anim-fade-in rounded-full border border-[#e08158]/30 bg-[#e08158]/10 px-3 py-1 font-mono text-[11px] text-[#f0956c]"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                {lane}
              </span>
            ))}
          </div>
          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-white/40">
            score = headroom · speed · capability · health → best lane answers, rest stay warm
          </p>
        </div>

        {/* arrow */}
        <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0 rotate-90 text-white/25 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M4 12h16m0 0-5-5m5 5-5 5" />
        </svg>

        {/* answer */}
        <div className="w-full max-w-[170px] shrink-0 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-center">
          <p className="text-[11px] text-emerald-300/70">via Credon Alpha · 0.6s</p>
          <p className="mt-0.5 text-[12.5px] text-white/85">answer + sources</p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={`group rounded-2xl border border-stone-900/[0.07] bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#c9653c]/25 hover:shadow-lg hover:shadow-stone-900/[0.06] ${className}`}
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#c9653c]/10 text-[#b4552e] transition-transform duration-300 group-hover:scale-110">
        {icon}
      </div>
      <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-stone-600">{body}</p>
    </div>
  );
}

function ProductMock() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-x-8 -bottom-6 h-24 rounded-full bg-stone-900/10 blur-2xl"
      />
      <div className="overflow-hidden rounded-2xl border border-stone-900/[0.09] bg-[#101013] shadow-2xl shadow-stone-900/20">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-3 rounded-md bg-white/[0.06] px-3 py-1 font-mono text-[11px] text-white/50">
            credon.ai/app
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[210px_1fr]">
          {/* sidebar */}
          <aside className="hidden border-r border-white/[0.06] p-3 md:block">
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.05] px-2.5 py-2">
              <CredonMark size={18} />
              <span className="text-[12px] font-medium text-white/85">New chat</span>
            </div>
            {["Thesis literature review", "DSA assignment solver", "Startup market research"].map(
              (label, i) => (
                <div
                  key={label}
                  className={`truncate rounded-lg px-2.5 py-2 text-[12px] ${
                    i === 0 ? "bg-[#e08158]/10 text-[#f0956c]" : "text-white/45"
                  }`}
                >
                  {label}
                </div>
              )
            )}
            <div className="mt-8 space-y-2">
              {[70, 55, 80].map((w, i) => (
                <div key={i} className="h-2 rounded-full bg-white/[0.05]" style={{ width: `${w}%` }} />
              ))}
            </div>
          </aside>

          {/* chat area */}
          <div className="space-y-4 p-5 md:p-6">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#e08158]/15 px-3.5 py-2.5 text-[13px] text-[#ffd9c4]">
              Compare transformer vs Mamba architectures for my thesis — include benchmarks
            </div>

            {/* plan */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5">
              <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-[#e08158]/20 text-[9px] text-[#f0956c]">
                  ◈
                </span>
                Agent plan · 3 steps
              </div>
              {[
                { t: "Search latest benchmarks", done: true },
                { t: "Run comparison script", done: true },
                { t: "Synthesize thesis summary", done: false },
              ].map((step) => (
                <div key={step.t} className="flex items-center gap-2.5 py-1 text-[12.5px]">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                      step.done
                        ? "bg-emerald-400/15 text-emerald-300"
                        : "border border-white/20 text-transparent pulse-dot"
                    }`}
                  >
                    ✓
                  </span>
                  <span className={step.done ? "text-white/75" : "shimmer-text"}>{step.t}</span>
                </div>
              ))}
            </div>

            {/* terminal */}
            <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 p-3">
              <div className="term-line text-white/35">$ credon run python --sandboxed</div>
              <div className="term-line text-white/70">benchmarking 12 configs …</div>
              <div className="term-line text-emerald-300/90">✓ mamba_370m: 2.1× faster · -38% memory</div>
              <div className="term-line term-caret text-white/40">exit 0</div>
            </div>

            {/* answer skeleton */}
            <div className="space-y-2 pt-1">
              <div className="h-2 w-[92%] rounded-full bg-white/[0.07]" />
              <div className="h-2 w-[78%] rounded-full bg-white/[0.07]" />
              <div className="h-2 w-[84%] rounded-full bg-white/[0.05]" />
            </div>

            {/* composer */}
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3.5 py-3">
              <span className="text-[12.5px] text-white/35">Ask anything…</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[#f0956c]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e08158]" />
                Agent mode
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCard() {
  const lines = [
    { p: "$", t: "credon agent --goal \"audit this dataset\"", c: "text-white/40" },
    { p: "◇", t: "plan drafted · 4 steps", c: "text-[#f0956c]" },
    { p: "1/", t: "research  profiling best practices", c: "text-white/75" },
    { p: "✓", t: "5 sources fetched (arxiv, pandas docs)", c: "text-emerald-300/90" },
    { p: "2/", t: "code  df.describe() + null map", c: "text-white/75" },
    { p: "│", t: "found 3 outliers · 2% missing rows", c: "text-white/60" },
    { p: "3/", t: "code  impute + winsorize", c: "text-white/75" },
    { p: "✓", t: "dataset clean · saved audit.json", c: "text-emerald-300/90" },
    { p: "◆", t: "report ready with sources", c: "text-[#f0956c]" },
  ];
  return (
    <div className="anim-float relative">
      <div
        aria-hidden
        className="absolute inset-x-6 -bottom-5 h-20 rounded-full bg-[#c9653c]/15 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-stone-900/[0.09] bg-[#0d0d10] p-5 shadow-2xl shadow-stone-900/25">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e08158]" />
            credon-agent · session
          </span>
          <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
            sandboxed
          </span>
        </div>
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div
              key={i}
              className="term-line flex gap-2.5 anim-fade-in"
              style={{ animationDelay: `${i * 0.09}s` }}
            >
              <span className="w-4 shrink-0 text-right text-white/25">{line.p}</span>
              <span className={line.c}>{line.t}</span>
            </div>
          ))}
          <div className="term-line term-caret pl-[26px] text-white/30" />
        </div>
      </div>
    </div>
  );
}

/* icons — thin stroke, consistent 20px grid */
function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function GlobeIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </IconBase>
  );
}
function DocIcon() {
  return (
    <IconBase>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </IconBase>
  );
}
function TerminalIcon() {
  return (
    <IconBase>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </IconBase>
  );
}
function RouteIcon() {
  return (
    <IconBase>
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="5.5" r="2.5" />
      <path d="M8 18.5h6.5a4 4 0 0 0 4-4v-1M5.5 16v-6.5a4 4 0 0 1 4-4H16" />
    </IconBase>
  );
}
function BrainIcon() {
  return (
    <IconBase>
      <path d="M12 4.5a3 3 0 0 0-3 3v9a3 3 0 0 0 6 0v-9a3 3 0 0 0-3-3z" />
      <path d="M9 8H7a3 3 0 0 0-1 5.8A3 3 0 0 0 9 19h1M15 8h2a3 3 0 0 1 1 5.8A3 3 0 0 1 15 19h-1" />
    </IconBase>
  );
}
