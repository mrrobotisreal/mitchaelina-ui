'use client';

import { memo, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
// One highlight.js theme for the whole chat lab; hljs classes only appear on
// chat-lab code blocks, so the sheet is effectively scoped here.
import 'highlight.js/styles/github-dark.css';

// Assistant markdown renderer: GFM + syntax highlighting. NO raw HTML — we keep
// react-markdown's default HTML-skipping (no rehype-raw) since this is model
// output. Styling is Tailwind classes scoped under the chatlab-md wrapper.

// A URL "is a video" when its path ends in a common video extension (query
// strings — e.g. presigned-URL signatures — are ignored).
function isVideoUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const path = new URL(href, 'https://placeholder.invalid').pathname.toLowerCase();
    return /\.(mp4|webm|mov|m4v)$/.test(path);
  } catch {
    return false;
  }
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// A fenced code block with a header bar (language + copy button). Inline code
// renders through the `code` component below instead.
function Pre({ children, ...props }: ComponentProps<'pre'>) {
  const text = extractText(children).replace(/\n$/, '');
  // rehype-highlight puts `language-x` (and `hljs`) on the inner <code>.
  let language = '';
  if (children && typeof children === 'object' && 'props' in children) {
    const cls = (children as { props: { className?: string } }).props.className ?? '';
    language = /language-([\w-]+)/.exec(cls)?.[1] ?? '';
  }
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {language || 'code'}
        </span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre {...props} className="overflow-x-auto bg-muted/30 p-3 text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

function ChatLabMarkdownInner({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'chatlab-md min-w-0 text-sm leading-relaxed',
        // Typography without @tailwindcss/typography: element-level classes.
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold',
        '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_hr]:my-4 [&_hr]:border-border',
        '[&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono [&_code:not(pre_code)]:text-[13px]',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          // Tables scroll horizontally inside their own container.
          table: ({ children, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table {...props} className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th {...props} className="border-b border-border bg-muted/60 px-3 py-1.5 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props} className="border-b border-border/60 px-3 py-1.5 align-top">
              {children}
            </td>
          ),
          // Links to video files render as an inline player (video-generation
          // models return their output as a plain URL in the text). Everything
          // else stays a normal new-tab link.
          a: ({ children, ...props }) => {
            if (isVideoUrl(props.href)) {
              return (
                <span className="my-3 block">
                  <video
                    src={props.href}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[420px] w-full max-w-xl rounded-lg border border-border bg-black"
                  />
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-muted-foreground no-underline hover:underline"
                  >
                    {children}
                  </a>
                </span>
              );
            }
            return (
              <a {...props} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          // Generated/linked images stay constrained to the bubble.
          img: ({ alt, ...props }) => (
            <img {...props} alt={alt ?? ''} className="my-3 max-h-[420px] w-auto max-w-full rounded-lg border border-border" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoized: during streaming the parent re-renders on every delta; completed
// messages' markdown trees stay stable.
const ChatLabMarkdown = memo(ChatLabMarkdownInner);
export default ChatLabMarkdown;
export { CopyButton };
