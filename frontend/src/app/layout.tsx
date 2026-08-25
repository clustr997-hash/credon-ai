import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0d",
};

export const metadata: Metadata = {
  title: {
    default: "Credon AI — Think deeper. Build faster.",
    template: "%s · Credon AI",
  },
  description:
    "Credon is an AI workspace that researches the web, reads your documents, writes and runs code, and reasons through hard problems — built for students, researchers and builders.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/credon-logo.svg",
    shortcut: "/credon-logo.svg",
    apple: "/credon-logo.svg",
  },
  openGraph: {
    title: "Credon AI",
    description: "Research. Reason. Build. An agentic AI workspace.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
