import ReactMarkdown from "react-markdown";
import { memo } from "react";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Code2, Repeat, ListChecks, Puzzle, ClipboardCheck, BookOpen, Coffee,
  Brain, Sparkles, ChevronDown, Check, Copy, Info, Lightbulb, AlertTriangle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const ICONS: Record<string, React.ReactNode> = {
  code: <Code2 className="h-4 w-4" />,
  loop: <Repeat className="h-4 w-4" />,
  list: <ListChecks className="h-4 w-4" />,
  puzzle: <Puzzle className="h-4 w-4" />,
  test: <ClipboardCheck className="h-4 w-4" />,
  notes: <BookOpen className="h-4 w-4" />,
  break: <Coffee className="h-4 w-4" />,
  brain: <Brain className="h-4 w-4" />,
};

type Props = {
  content: string;
  onChip?: (chip: string) => void;
  busy?: boolean;
  isLastAssistant?: boolean;
  streaming?: boolean;
  onAction?: (action: string, payload: any) => void;
};

function SanaMarkdownInner({ content, onChip, busy, isLastAssistant, streaming, onAction }: Props) {
  const chipsInteractive = !!onChip && !!isLastAssistant && !streaming;
  
  // Fix broken tables (LLMs sometimes add blank lines between table rows)
  const processedContent = useMemo(() => {
    if (!content) return "";
    return content
      .replace(/^([ \t]*\|[^\n]*\|[ \t]*\r?\n)([ \t]*\r?\n)+(?=[ \t]*\|)/gm, '$1')
      .replace(/(^|\n)(?![ \t]*\|)([^\n]+)\n([ \t]*\|(?=.*\|))/g, '$1$2\n\n$3');
  }, [content]);

  return (
    <div className={streaming ? "sana-stream" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Skip re-highlighting HTML on every token by disabling raw HTML parsing
        skipHtml
        components={{
          h1: ({ children }) => (
            <h2 className="mb-3 mt-2 text-[20px] font-black leading-tight text-foreground">{children}</h2>
          ),
          h2: ({ children }) => (
            <div className="mb-2 mt-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="text-[17.5px] font-black leading-tight">{children}</h3>
            </div>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-3 text-[16px] font-bold text-foreground">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="mb-2 text-[15.5px] leading-relaxed last:mb-0">{children}</p>
          ),
          ul: ({ children }) => <ul className="my-2 space-y-1.5 pl-0">{children}</ul>,
          li: ({ children }) => (
            <li className="flex gap-2.5 text-[15.5px] leading-snug">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1">{children}</span>
            </li>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1.5 pl-5 text-[15.5px] marker:font-bold marker:text-primary">{children}</ol>
          ),
          blockquote: ({ children }) => <Callout>{children}</Callout>,
          strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground/85">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">{children}</a>
          ),
          del: ({ children }) => {
            if (children === "▋") return <span className="animate-pulse text-primary font-bold ml-0.5">▋</span>;
            return <del className="line-through">{children}</del>;
          },
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="my-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full border-collapse text-[14px]">{children}</table>
              </div>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gradient-to-r from-primary/10 via-lavender/60 to-primary/5 text-foreground">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
          tr: ({ children }) => <tr className="transition even:bg-muted/20 hover:bg-primary/5">{children}</tr>,
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-left text-[12.5px] font-black uppercase tracking-wider text-primary">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 align-top text-[14px] leading-relaxed">{children}</td>
          ),
          img: ({ src, alt }) => (
            <span className="my-4 block overflow-hidden rounded-2xl border border-border bg-muted/20">
              <img src={src} alt={alt} className="max-h-[400px] w-auto max-w-full object-contain" loading="lazy" />
              {alt && <span className="block border-t border-border/50 bg-background/50 px-3 py-1.5 text-center text-[12.5px] font-medium text-muted-foreground">{alt}</span>}
            </span>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...rest }) => {
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            const raw = String(children ?? "").replace(/\n$/, "");
            // While streaming, defer heavy blocks — show a lightweight placeholder that
            // upgrades to the rich card once the stream completes. This eliminates the
            // "stuck" feeling caused by re-rendering SyntaxHighlighter on every token.
            if (lang === "chips") {
              if (streaming) return <StreamingChipsPreview raw={raw} />;
              return <ChipsBlock raw={raw} onChip={chipsInteractive ? onChip : undefined} busy={!!busy} />;
            }
            if (lang === "roadmap") {
              if (streaming) return <StreamingRoadmapPreview raw={raw} />;
              return <RoadmapBlock raw={raw} />;
            }
            if (lang === "assignments") {
              if (streaming) return <div className="text-sm font-bold text-primary flex items-center gap-2"><Sparkles className="h-4 w-4 animate-pulse" /> Generating Assignments...</div>;
              return <AssignmentsBlock raw={raw} onAction={onAction} />;
            }
            const isBlock = !!lang || raw.includes("\n");
            if (!isBlock) {
              return (
                <code
                  className="rounded-md border border-primary/20 bg-lavender/60 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-primary"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            if (streaming) return <StreamingCodeBlock lang={lang ?? "text"} code={raw} />;
            return <CodeBlock lang={lang ?? "text"} code={raw} />;
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

/** Re-render only when the visible props change. */
export const SanaMarkdown = memo(SanaMarkdownInner, (a, b) =>
  a.content === b.content &&
  a.busy === b.busy &&
  a.streaming === b.streaming &&
  a.isLastAssistant === b.isLastAssistant &&
  a.onChip === b.onChip &&
  a.onAction === b.onAction,
);

/* ---------------- Callout ---------------- */

function Callout({ children }: { children: React.ReactNode }) {
  const text = extractText(children).trim();
  const lower = text.toLowerCase();
  let variant: "tip" | "info" | "warn" = "info";
  let Icon = Info;
  let stripe = "border-primary/60";
  let bg = "bg-lavender/50";
  let iconColor = "text-primary";
  if (lower.startsWith("tip") || text.startsWith("💡")) {
    variant = "tip"; Icon = Lightbulb;
    stripe = "border-warning/60"; bg = "bg-warning/10"; iconColor = "text-warning";
  } else if (lower.startsWith("warn") || lower.startsWith("caution") || text.startsWith("⚠")) {
    variant = "warn"; Icon = AlertTriangle;
    stripe = "border-destructive/60"; bg = "bg-destructive/10"; iconColor = "text-destructive";
  }
  return (
    <div className={cn("my-3 flex gap-3 rounded-xl border-l-4 px-4 py-3 text-[14.5px] leading-relaxed", stripe, bg)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} />
      <div className="min-w-0 flex-1 space-y-1 [&>p]:m-0 [&>p]:text-[14.5px]">{children}</div>
      <span className="sr-only">{variant}</span>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in (node as any)) {
    return extractText((node as any).props?.children);
  }
  return "";
}

/* ---------------- Code block ---------------- */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const displayLang = lang === "text" ? "code" : lang;
  async function copy() {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      toast.success("Copied to clipboard", { duration: 1600 });
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Copy failed — long-press to copy manually");
    }
  }
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border bg-[#0e1015] shadow-card">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-red-400/70" />
            <span className="h-2 w-2 rounded-full bg-yellow-400/70" />
            <span className="h-2 w-2 rounded-full bg-green-400/70" />
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-white/60">
            {displayLang}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          aria-label={copied ? "Copied" : "Copy code to clipboard"}
          className={cn(
            "inline-flex min-h-[28px] min-w-[64px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition active:scale-95",
            copied
              ? "border-success/40 bg-success/15 text-success"
              : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "14px 16px",
          background: "transparent",
          fontSize: "13.5px",
          lineHeight: 1.6,
        }}
        codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Cross-platform clipboard write.
 * - Prefers async Clipboard API (iOS 13.4+, Android Chrome, all desktop browsers on HTTPS/localhost).
 * - Falls back to a hidden <textarea> + document.execCommand("copy") for older iOS Safari,
 *   Android WebViews, and any non-secure context where navigator.clipboard is unavailable.
 * Returns true on success.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    // iOS Safari requires a selected editable field before execCommand.
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ---------------- Chips ---------------- */

function ChipsBlock({ raw, onChip, busy }: { raw: string; onChip?: (c: string) => void; busy?: boolean }) {
  const chips = raw.split(/[\n|]/).map((s) => s.trim()).filter(Boolean);
  const [pending, setPending] = useState<string | null>(null);
  if (!chips.length) return null;
  const interactive = !!onChip;
  const anyBusy = !!busy || pending !== null;

  return (
    <div
      className="-mx-1 my-2 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Suggested replies"
      aria-busy={anyBusy || undefined}
    >
      {chips.map((c, i) => {
        const isPending = pending === c;
        const disabled = !interactive || anyBusy;
        return (
          <button
            key={`${c}-${i}`}
            type="button"
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!onChip || anyBusy) return;
              setPending(c);
              try { onChip(c); } finally {
                // Clear our local spinner once the parent enters busy state,
                // or after a short safety timeout if it doesn't.
                setTimeout(() => setPending(null), 1200);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-semibold shadow-card transition",
              interactive && !disabled
                ? "border-primary/30 bg-card text-primary hover:bg-primary hover:text-primary-foreground active:scale-95"
                : "border-border bg-muted/60 text-muted-foreground",
              isPending && "border-primary/60 bg-primary/10 text-primary",
              disabled && !isPending && "opacity-60",
            )}
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {c}
          </button>
        );
      })}
    </div>
  );
}


/* ---------------- Roadmap ---------------- */

type RoadmapItem = { time: string; title: string; subtitle: string; duration?: string; icon?: string };

function RoadmapBlock({ raw }: { raw: string }) {
  const items = useMemo<RoadmapItem[]>(() => (
    raw.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const [time = "", title = "", subtitle = "", duration = "", icon = ""] =
        line.split("|").map((s) => s.trim());
      return { time, title, subtitle, duration, icon: icon.toLowerCase() };
    }).filter((i) => i.title)
  ), [raw]);

  const [allOpen, setAllOpen] = useState(false);

  const totalMin = useMemo(
    () => items.reduce((s, it) => s + (parseInt(it.duration?.match(/(\d+)\s*m/i)?.[1] ?? "0", 10)), 0),
    [items],
  );

  if (!items.length) return null;

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-primary/10 via-lavender/50 to-transparent px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div className="truncate text-[14px] font-black">
            Smart Study Roadmap
            {totalMin > 0 && <span className="ml-1 font-bold text-muted-foreground">({fmtMins(totalMin)})</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAllOpen((v) => !v)}
          className="shrink-0 rounded-full border border-primary/30 bg-card px-2.5 py-1 text-[10px] font-bold text-primary shadow-card transition hover:bg-primary hover:text-primary-foreground"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <ul className="relative px-3 py-2">
        {/* vertical timeline rail */}
        <span className="pointer-events-none absolute bottom-4 left-[26px] top-4 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />
        {items.map((it, i) => (
          <RoadmapRow key={i} item={it} forceOpen={allOpen} isLast={i === items.length - 1} />
        ))}
      </ul>
    </div>
  );
}

function RoadmapRow({ item, forceOpen, isLast }: { item: RoadmapItem; forceOpen: boolean; isLast: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen || localOpen;
  const isBreak = /break|lunch|rest/i.test(item.title);
  const icon = (item.icon && ICONS[item.icon]) || (isBreak ? ICONS.break : ICONS.notes);
  const durationTone = isBreak ? "text-success" : "text-muted-foreground";
  const [start, end] = item.time.split(/[-–]/).map((t) => t.trim());

  return (
    <li className={cn("relative", !isLast && "pb-1.5")}>
      <button
        type="button"
        onClick={() => setLocalOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full grid-cols-[64px_auto_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-xl px-1.5 py-2 text-left transition hover:bg-muted/40"
      >
        <div className="flex flex-col text-[10px] font-bold leading-tight text-muted-foreground">
          {start && <span>{start}</span>}
          {end && <span className="text-muted-foreground/70">{end}</span>}
        </div>
        <span className={cn(
          "relative z-10 grid h-9 w-9 place-items-center rounded-xl border shadow-sm transition",
          isBreak
            ? "border-success/30 bg-success/10 text-success"
            : "border-primary/25 bg-lavender text-primary",
          open && "ring-2 ring-primary/30",
        )}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-bold leading-tight">{item.title}</div>
          {item.subtitle && (
            <div className="truncate text-[12.5px] leading-tight text-muted-foreground">{item.subtitle}</div>
          )}
        </div>
        {item.duration && (
          <span className={cn("shrink-0 text-[12.5px] font-black tabular-nums", durationTone)}>
            {item.duration}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180 text-primary",
          )}
        />
      </button>
      {open && (
        <div className="ml-[74px] mr-2 mt-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[13.5px] leading-relaxed text-foreground/85">
          {item.subtitle ? (
            <>
              <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-primary">
                What you'll cover
              </div>
              <div>{item.subtitle}</div>
            </>
          ) : (
            <span className="italic text-muted-foreground">No extra details.</span>
          )}
        </div>
      )}
    </li>
  );
}

function fmtMins(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/* ---------------- Streaming-lite blocks ----------------
 * Rendered token-by-token while `streaming` is true. They avoid the heavy
 * SyntaxHighlighter render pass and the roadmap grid layout so tokens can
 * flow in smoothly without stutter. Once the stream finishes, the parent
 * re-renders with the full rich versions.
 */

function StreamingCodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border bg-[#0e1015] shadow-card">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="text-[10px] font-black uppercase tracking-wider text-white/60">
          {lang === "text" ? "code" : lang}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> writing…
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-white/90 font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StreamingChipsPreview({ raw }: { raw: string }) {
  const chips = raw.split(/[\n|]/).map((s) => s.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="-mx-1 my-2 flex flex-wrap gap-1.5 opacity-70">
      {chips.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="rounded-full border border-dashed border-primary/30 bg-card px-3 py-1.5 text-[12px] font-semibold text-primary/70 shadow-card"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function StreamingRoadmapPreview({ raw }: { raw: string }) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-dashed border-border bg-card/60 px-3 py-2 shadow-card">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-black text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Building roadmap…
      </div>
      <ul className="space-y-0.5">
        {lines.map((l, i) => {
          const [time = "", title = ""] = l.split("|").map((s) => s.trim());
          return (
            <li key={i} className="truncate text-[11.5px] text-muted-foreground">
              <span className="font-bold text-foreground">{time}</span>
              {title && <span> · {title}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- Assignments block ---------------- */

function AssignmentsBlock({ raw, onAction }: { raw: string, onAction?: (action: string, payload: any) => void }) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  
  if (lines.length === 0) return null;

  const cards = lines.map((line, i) => {
    // Format: Title | Assigned To | Estimated Time | Difficulty
    const parts = line.split("|").map(p => p.trim());
    if (parts.length < 2) return null;
    
    return {
      title: parts[0],
      assignee: parts[1],
      time: parts[2] || "N/A",
      difficulty: parts[3] || "Medium",
    };
  }).filter(Boolean);

  return (
    <div className="my-4 space-y-3">
      {cards.map((c: any, i) => (
        <div key={i} className="rounded-[20px] border border-border bg-card p-4 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 flex gap-2">
            <span className={cn(
              "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
              c.difficulty.toLowerCase().includes("easy") ? "bg-green-100 text-green-700" :
              c.difficulty.toLowerCase().includes("hard") ? "bg-red-100 text-red-700" :
              "bg-orange-100 text-orange-700"
            )}>
              {c.difficulty}
            </span>
          </div>
          <div className="pr-16">
            <h4 className="text-[17px] font-bold text-foreground">{c.title}</h4>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[13.5px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <div className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[10px] text-primary">
                  {c.assignee.substring(0, 1).toUpperCase()}
                </div>
                {c.assignee}
              </span>
              <span className="flex items-center gap-1">
                <Coffee className="h-3.5 w-3.5" />
                {c.time}
              </span>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button 
              onClick={() => onAction?.('start_learning', { title: c.title, assignee: c.assignee })}
              className="flex-1 rounded-xl bg-primary py-2 text-[13px] font-bold text-primary-foreground shadow-sm transition-transform active:scale-95"
            >
              Start Learning
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
