import type { Metadata } from "next";
import { MetaPage } from "@/components/meta-page";

export const metadata: Metadata = { title: "Changelog" };

const RELEASES = [
  {
    version: "2.0",
    date: "August 2026",
    tag: "The workspace release",
    items: [
      "Credon Alpha model family — automatic routing with failover, always answers",
      "Agent mode: plans, researches, browses pages, writes files, runs sandboxed Python, and iterates on follow-ups",
      "Agent workspace panel: live Plan · Terminal · Files · Report",
      "Canvas workspace for long answers with Export PDF & Export PPTX (client-side)",
      "Reads PDFs and images — even without the backend engine",
      "Voice conversation: talk to Credon, it talks back",
      "Split Answer: compare two Credon models side-by-side",
      "Exam prep: /studyplan, /flashcards, /quiz commands",
      "Scheduled jobs with push notifications",
      "Memory page — see, edit and forget what Credon learned",
      "Prompt library + slash commands",
      "arXiv paper search and YouTube transcript research",
      "Free image generation in chat",
      "Share snapshots, offline-friendly PWA, new aperture logo",
      "New landing page — ask Credon directly from the hero",
    ],
  },
  {
    version: "1.0",
    date: "Earlier 2026",
    tag: "First public build",
    items: [
      "Streaming chat with web research, thinking traces and sources",
      "PDF/image ingestion with OCR and knowledge retrieval",
      "Firebase auth, sessions and feedback learning loop",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <MetaPage title="Changelog">
      {RELEASES.map((release) => (
        <section key={release.version} className="rounded-2xl border border-stone-900/[0.07] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="rounded-lg bg-[#c9653c]/10 px-2.5 py-1 font-mono text-[13px] font-bold text-[#b4552e]">
              v{release.version}
            </span>
            <h2 className="!mt-0 text-xl font-semibold">{release.tag}</h2>
            <span className="text-[13px] text-stone-400">{release.date}</span>
          </div>
          <ul className="list mt-4">
            {release.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </MetaPage>
  );
}
