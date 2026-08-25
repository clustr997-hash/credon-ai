"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { IconCheck, IconCopy } from "./icons";

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  if (Array.isArray(node)) return node.map(extractText).join("");
  return "";
}

function CodeBlock({ children, language }: { children: ReactNode; language: string }) {
  const [copied, setCopied] = useState(false);
  const raw = extractText(children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-white/[0.07] bg-[#0d0d10]" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between border-b px-3.5 py-1.5" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}>
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          {language || "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--text)]"
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="font-mono !text-[13px] !leading-[1.6]">{children}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-credon">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre({ children }) {
            let language = "";
            const child = Array.isArray(children) ? children[0] : children;
            if (isValidElement(child)) {
              const cls = (child.props as { className?: string }).className || "";
              language = cls.replace("language-", "").split(" ")[0];
            }
            return <CodeBlock language={language}>{child}</CodeBlock>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
