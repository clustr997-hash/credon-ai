export default function AppLoading() {
  return (
    <div className="flex h-dvh items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="flex flex-col items-center gap-5">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-15" />
          <svg width="40" height="40" viewBox="0 0 32 32" className="animate-spin" style={{ animationDuration: "1.6s" }}>
            <circle cx="16" cy="16" r="13" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
            <path d="M16 3 a13 13 0 0 1 13 13" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
        <p className="shimmer-text text-[13.5px]">Preparing your workspace…</p>
      </div>
    </div>
  );
}
