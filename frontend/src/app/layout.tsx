import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#09090b",
};

export const metadata: Metadata = {
  title: "Credon AI",
  description: "Creative retrieval-first AI assistant in English and Hinglish",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/credon-logo.svg",
    shortcut: "/credon-logo.svg",
    apple: "/credon-logo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CREDON-AI",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
