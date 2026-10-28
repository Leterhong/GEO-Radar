"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** 安全 Markdown 渲染：不渲染原始 HTML（未启用 rehype-raw），外部链接带 nofollow。 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h2 className="mt-5 text-[17px] font-semibold text-[color:var(--text-primary)]" {...props} />,
          h2: (props) => <h3 className="mt-4 text-[15px] font-semibold text-[color:var(--text-primary)]" {...props} />,
          h3: (props) => <h4 className="mt-3 text-[14px] font-semibold text-[color:var(--text-primary)]" {...props} />,
          p: (props) => <p className="whitespace-pre-wrap" {...props} />,
          ul: (props) => <ul className="ml-5 list-disc space-y-1" {...props} />,
          ol: (props) => <ol className="ml-5 list-decimal space-y-1" {...props} />,
          li: (props) => <li className="pl-1" {...props} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-border-strong bg-surface-subtle py-1.5 pl-3 pr-2 text-tertiary" {...props} />
          ),
          code: (props) => {
            const isBlock = props.className?.includes("language-");
            if (!isBlock) {
              return <code className="rounded border border-border bg-surface-muted px-1 py-0.5 font-mono text-[12px] text-primary-strong" {...props} />;
            }
            return <code className="block font-mono text-xs" {...props} />;
          },
          pre: (props) => (
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-subtle p-3.5 scrollbar-thin" {...props} />
          ),
          table: (props) => (
            <div className="overflow-x-auto rounded-md border scrollbar-thin">
              <table className="w-full text-xs" {...props} />
            </div>
          ),
          th: (props) => <th className="border-b border-border bg-surface-muted px-2.5 py-1.5 text-left font-medium text-[color:var(--text-primary)]" {...props} />,
          td: (props) => <td className="border-b border-border px-2.5 py-1.5" {...props} />,
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-primary hover:text-primary-strong hover:underline"
            />
          ),
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
