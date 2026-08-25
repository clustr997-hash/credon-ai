import type { Metadata } from "next";
import { MetaPage } from "@/components/meta-page";

export const metadata: Metadata = { title: "Help & FAQ" };

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Does Credon need the backend (the “Credon engine”) running?",
    a: (
      <>
        <p>
          Chat works even without it — Credon falls back to answering directly from its model
          network in your browser. But starting the engine unlocks the full powers: saved chat
          history, the PDF knowledge library, agent code execution, learning from feedback, and
          scheduled jobs.
        </p>
        <p>
          On your own machine: double-click <code>run_backend.cmd</code> (Windows) or run{" "}
          <code>uvicorn app.main:app --app-dir backend --port 8000</code>.
        </p>
      </>
    ),
  },
  {
    q: "How do I read PDFs and images?",
    a: (
      <p>
        Click the <strong>+</strong> button in the chat box, or open <strong>Knowledge &amp; PDFs</strong> from
        the sidebar to build a permanent library. PDFs are read in your browser; with the engine
        running they are also indexed for future questions. Images are understood by Credon Scout.
      </p>
    ),
  },
  {
    q: "What can Agent mode do?",
    a: (
      <p>
        Flip to <strong>Agent</strong> and give a goal. Credon drafts a plan, searches the web, opens
        pages, writes files, runs Python in a sandbox, and delivers a report — all streamed live in
        the Plan / Terminal / Files / Report panel. You can reply with follow-ups like{" "}
        <em>“now change the chart to a bar chart”</em> and it iterates.
      </p>
    ),
  },
  {
    q: "How do I get the browser superpower (Camoufox)?",
    a: (
      <p>
        Optional, one-time, free. In a terminal:{" "}
        <code>pip install &quot;camoufox[geoip]&quot; playwright</code> then{" "}
        <code>camoufox fetch</code>, and set <code>USE_CAMOUFOX=true</code> in your backend{" "}
        <code>.env</code>. Agent research steps can then open JavaScript-heavy or bot-protected
        pages. Without it, Credon still reads most pages.
      </p>
    ),
  },
  {
    q: "How do exports work?",
    a: (
      <p>
        Long answers get an <strong>Open in workspace</strong> button — from there export clean PDFs
        or PowerPoint decks instantly (built on your device). The Export center in the sidebar can
        export whole chats via the engine.
      </p>
    ),
  },
  {
    q: "Is my data private?",
    a: (
      <p>
        Your profile, prompts and local chats stay on your device. Messages you send are processed
        by the model providers to generate answers. We never sell data. See the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>
    ),
  },
  {
    q: "Keyboard shortcuts?",
    a: (
      <p>
        <strong>⌘K / Ctrl+K</strong> new chat · <strong>/</strong> commands in the composer ·{" "}
        <strong>Enter</strong> send · <strong>Shift+Enter</strong> newline · <strong>Esc</strong>{" "}
        close menus.
      </p>
    ),
  },
];

export default function HelpPage() {
  return (
    <MetaPage title="Help & FAQ">
      <div className="space-y-4">
        {FAQS.map((faq) => (
          <details key={faq.q} className="group rounded-2xl border border-stone-900/[0.07] bg-white p-5 shadow-sm [&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]">
            <summary className="cursor-pointer list-none text-[15.5px] font-semibold marker:hidden">
              <span className="mr-2 text-[#b4552e] transition-transform group-open:rotate-90 inline-block">›</span>
              {faq.q}
            </summary>
            <div className="mt-3 space-y-3 border-t border-stone-900/[0.06] pt-3 text-[14.5px] leading-relaxed text-stone-600">
              {faq.a}
            </div>
          </details>
        ))}
      </div>
    </MetaPage>
  );
}
