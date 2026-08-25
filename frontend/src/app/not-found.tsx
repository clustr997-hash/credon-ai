import Link from "next/link";
import { CredonMark } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <CredonMark size={48} animate />
      <h1 className="mt-8 font-display text-5xl tracking-tight text-stone-900">Lost in thought.</h1>
      <p className="mt-3 max-w-sm text-[15px] text-stone-500">
        This page doesn&apos;t exist — but your next answer does.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/"
          className="rounded-xl bg-stone-900 px-5 py-2.5 text-[14px] font-medium text-white transition-all hover:-translate-y-px"
        >
          Back home
        </Link>
        <Link
          href="/app"
          className="rounded-xl border border-stone-900/10 bg-white px-5 py-2.5 text-[14px] font-medium text-stone-800 transition-all hover:-translate-y-px"
        >
          Open Credon
        </Link>
      </div>
    </div>
  );
}
