"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useTranslations } from "@opennest/localization";

const components: Components = {
  h1: ({ children }) => <h1 className="mt-6 mb-2 text-2xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 mb-2 text-xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted my-3 border-l-4 pl-4">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={`bg-border/40 rounded px-1 py-0.5 font-mono text-[0.9em] ${className ?? ""}`}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-background my-4 overflow-auto rounded-xl p-4 text-sm leading-6">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border my-6" />,
  table: ({ children }) => (
    <div className="my-4 overflow-auto">
      <table className="border-border w-full border-collapse border text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border bg-border/30 border px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-border border px-3 py-2">{children}</td>,
  a: ({ children, href }) => {
    const external = href !== undefined && /^https?:\/\//i.test(href);

    return (
      <a
        href={href}
        className="text-primary font-medium underline underline-offset-4"
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </a>
    );
  },
  img: () => <BlockedImage />,
};

function BlockedImage() {
  const t = useTranslations();

  return (
    <span className="border-border text-muted my-2 inline-flex rounded-lg border border-dashed px-3 py-1 text-sm">
      {t("notes.imageBlocked")}
    </span>
  );
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview max-w-none text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
