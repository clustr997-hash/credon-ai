import Link from "next/link";
import { CredonMark } from "@/components/logo";

export function MetaPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[#FAF9F6] text-stone-900">
      <header className="border-b border-stone-900/[0.06]">
        <nav className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-75">
            <CredonMark size={26} />
            <span className="text-[16px] font-semibold tracking-tight">
              Credon<span className="font-normal text-stone-400"> AI</span>
            </span>
          </Link>
          <Link
            href="/app"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-all hover:-translate-y-px hover:bg-stone-800"
          >
            Open Credon
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">{title}</h1>
        {updated && <p className="mt-3 text-[13px] text-stone-500">Last updated: {updated}</p>}
        <div className="legal-body mt-10 space-y-8 text-[15px] leading-[1.8] text-stone-700 [&_a]:font-medium [&_a]:text-[#b4552e] [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:text-stone-900 [&_li]:mb-2 [&_strong]:font-semibold [&_strong]:text-stone-900 [&_ul.list]:list-disc [&_ul.list]:space-y-1 [&_ul.list]:pl-6">
          {children}
        </div>
      </main>
      <footer className="border-t border-stone-900/[0.06] px-5 py-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 text-[12.5px] text-stone-400">
          <span>© {new Date().getFullYear()} Credon AI</span>
          <span className="flex gap-5">
            <Link href="/privacy" className="hover:text-stone-700">Privacy</Link>
            <Link href="/terms" className="hover:text-stone-700">Terms</Link>
            <Link href="/help" className="hover:text-stone-700">Help</Link>
            <Link href="/changelog" className="hover:text-stone-700">Changelog</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
