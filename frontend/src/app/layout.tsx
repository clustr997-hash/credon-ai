import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./credon-product.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0d",
};

export const metadata: Metadata = {
  title: "Credon AI — Think, Research, Build",
  description: "A personal AI workspace for research, coding, documents and problem solving.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/credon-logo.svg",
    shortcut: "/credon-logo.svg",
    apple: "/credon-logo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Credon AI",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
