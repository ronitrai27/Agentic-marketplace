"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders the chef's reply: bold, lists, tables, code and links, styled to match the chat. Raw HTML is not allowed. */
export function ChefMarkdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          h1: ({ children }) => <h3 className="text-lg font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="text-[15px] font-semibold">{children}</h4>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="border-border" />,
          code: ({ className, children }) =>
            className ? (
              <code className={`${className} font-mono text-[13px]`}>{children}</code>
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="border-b border-border px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-3 py-2 last:border-b-0">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
