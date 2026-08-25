"use client";

import { useId } from "react";

/**
 * Credon mark — an aperture: nested arcs opening toward a spark node.
 * Focus, insight, always-on intelligence.
 * Gradient IDs are unique per instance (useId) so multiple marks
 * on one page can never break each other's paint.
 */
export function CredonMark({
  size = 32,
  animate = false,
  className = "",
}: {
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const bgId = `cbg${uid}`;
  const coreId = `ccore${uid}`;
  const arc = animate ? "logo-draw" : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={bgId} x1="3" y1="2" x2="29" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5A97F" />
          <stop offset="0.55" stopColor="#E08158" />
          <stop offset="1" stopColor="#BC4E28" />
        </linearGradient>
        <radialGradient id={coreId} cx="0.35" cy="0.3" r="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#FFE3D1" />
        </radialGradient>
      </defs>

      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${bgId})`} />

      {/* outer aperture arc */}
      <path
        d="M22.6 9.2 A 8.1 8.1 0 1 0 24.3 20.6"
        stroke="#FFFFFF"
        strokeWidth="2.7"
        strokeLinecap="round"
        pathLength={100}
        className={arc}
      />
      {/* inner aperture arc */}
      <path
        d="M19.2 12.6 A 4.6 4.6 0 1 0 20.1 19.7"
        stroke="rgba(255,255,255,0.82)"
        strokeWidth="2.3"
        strokeLinecap="round"
        pathLength={100}
        className={arc}
      />
      {/* core */}
      <circle cx="16" cy="16" r="2" fill={`url(#${coreId})`} />
      {/* spark node in the opening */}
      <circle cx="23.6" cy="8.4" r="1.7" fill="#FFFFFF" />
    </svg>
  );
}

export function CredonLogo({
  size = 28,
  theme = "dark",
  animate = false,
  href,
  tagline = true,
}: {
  size?: number;
  theme?: "dark" | "light";
  animate?: boolean;
  href?: string;
  tagline?: boolean;
}) {
  const wordColor = theme === "light" ? "text-stone-900" : "text-[var(--text)]";
  const content = (
    <span className="inline-flex items-center gap-2.5 select-none">
      <CredonMark size={size} animate={animate} />
      <span className={`font-semibold tracking-tight ${wordColor}`} style={{ fontSize: size * 0.62 }}>
        Credon
        {tagline && <span className="text-[var(--text-faint,rgba(150,150,150,0.9))] font-normal"> AI</span>}
      </span>
    </span>
  );
  if (href) {
    return (
      <a href={href} className="transition-opacity hover:opacity-80">
        {content}
      </a>
    );
  }
  return content;
}
