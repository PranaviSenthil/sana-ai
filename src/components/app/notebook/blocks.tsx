import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Lightbulb,
  Sparkles,
  Target,
  AlertTriangle,
  ShieldAlert,
  Sigma,
  Copy,
  Star,
  Eye,
  Compass,
  Rocket,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { NotebookBlock, StudyStyleT } from "@/lib/study-notes.schema";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


/* --------------------------- Primitives --------------------------- */

export function HandwritingText({ text, className, style }: { text?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={style}>
      {text || ""}
    </span>
  );
}

export function SectionHeading({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  if (style === "book") {
    return (
      <h2 className="mt-8 mb-4 font-serif text-[22px] font-bold text-slate-900 border-b-2 border-double border-slate-300 pb-2 tracking-tight">
        {text}
      </h2>
    );
  }
  if (style === "unruled" || style === "mindmap" || style === "cornell") {
    return (
      <h2 className="mt-6 mb-3 font-sans text-[18px] font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-indigo-600" />
        {text}
      </h2>
    );
  }
  // Default: ruled handwriting style
  return (
    <h2 className="mt-5 mb-3 font-handwriting-bold text-[24px] leading-tight text-[#7C4DFF] tracking-wide underline underline-offset-4 decoration-dashed decoration-indigo-300">
      {text}
    </h2>
  );
}

export function Paragraph({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return <MarkdownText text={text} style={style} />;
}

/* --------------------------- Cards Shell ------------------------------- */

function CardShell({
  tone,
  icon: Icon,
  label,
  children,
  style = "ruled",
}: {
  tone: "blue" | "green" | "yellow" | "red" | "purple" | "orange" | "slate";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  style?: StudyStyleT;
}) {
  // 1. Book Style Callout Box
  if (style === "book") {
    return (
      <div className="relative my-6 border-l-4 border-slate-700 bg-slate-50/80 pl-5 pr-4 py-4 font-serif rounded-r-lg">
        <div className="mb-2.5 text-[10px] font-sans font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          {label}
        </div>
        <div className="text-[14.5px] leading-[24px] text-slate-800">{children}</div>
      </div>
    );
  }

  // 2. Ruled (Handwritten) Callout Box
  if (style === "ruled") {
    const emojiMap: Record<string, string> = {
      "definition": "🔑",
      "why it matters": "🎯",
      "analogy": "🧭",
      "example": "📝",
      "real-world": "🚀",
      "warning": "⚠️",
      "common mistakes": "❌",
      "memory trick": "💡",
      "key points": "⭐",
      "summary": "📋",
      "practice · multiple choice": "✍️",
      "practice · true / false": "✍️",
      "practice · fill in the blank": "✍️",
    };
    const emoji = emojiMap[label.toLowerCase()] || "📌";

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative my-6 rounded-2xl border-2 border-dashed border-indigo-400/40 bg-indigo-50/10 px-5 py-4 font-handwriting"
      >
        <div className="absolute -top-3.5 left-4 rounded-xl bg-[#FEFEF6] border-2 border-indigo-400/30 px-3 py-0.5 text-xs font-handwriting-bold text-indigo-700 flex items-center gap-1.5 shadow-2xs">
          <span>{emoji}</span>
          <span>{label}</span>
        </div>
        <div className="text-[17px] leading-[28px] text-slate-900 mt-1">{children}</div>
      </motion.div>
    );
  }

  // 3. Unruled (Modern Workspace) Callout Box
  const tones: Record<string, string> = {
    blue: "bg-blue-50/40 border-blue-100 text-blue-950",
    green: "bg-emerald-50/40 border-emerald-100 text-emerald-950",
    yellow: "bg-amber-50/40 border-amber-100 text-amber-950",
    red: "bg-red-50/40 border-red-100 text-red-950",
    purple: "bg-purple-50/40 border-purple-100 text-purple-950",
    orange: "bg-orange-50/40 border-orange-100 text-orange-950",
    slate: "bg-slate-50 border-slate-200 text-slate-800",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative my-6 rounded-2xl border ${tones[tone]} p-5 shadow-xs`}
    >
      <div className="absolute -top-3 left-5 rounded-full bg-white border border-slate-200 px-3 py-0.5 text-[10px] font-sans font-extrabold uppercase tracking-widest text-slate-500 shadow-3xs flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-[13.5px] leading-[22px] mt-1">{children}</div>
    </motion.div>
  );
}

}

/* --------------------------- Markdown Renderer ------------------------------- */

export function MarkdownText({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  const processedContent = text
    .replace(/^([ \t]*\|[^\n]*\|[ \t]*\r?\n)([ \t]*\r?\n)+(?=[ \t]*\|)/gm, '$1')
    .replace(/(^|\n)(?![ \t]*\|)([^\n]+)\n([ \t]*\|(?=.*\|))/g, '$1$2\n\n$3');

  const pClass = style === "book" 
    ? "my-3 font-serif text-[15px] leading-[26px] text-slate-800 text-justify"
    : style === "unruled" || style === "mindmap" || style === "cornell"
      ? "my-3 font-sans text-[13.5px] leading-[22px] text-slate-600"
      : "my-2 font-handwriting text-[17px] leading-[28px] text-slate-800";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
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
        td: ({ children }) => <td className="px-4 py-2.5 align-top leading-relaxed">{children}</td>,
        p: ({ children }) => <p className={cn(pClass, "last:mb-0")}>{children}</p>,
        strong: ({ children }) => <strong className="font-bold opacity-90">{children}</strong>,
        em: ({ children }) => <em className="italic opacity-80">{children}</em>,
        ul: ({ children }) => <ul className="my-2 space-y-1 pl-4 list-disc opacity-90">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 space-y-1 pl-4 list-decimal opacity-90">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}

/* --------------------------- Cards ------------------------------- */

export function DefinitionCard({ term, text, style = "ruled" }: { term: string | null; text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="blue" icon={BookOpen} label="Definition" style={style}>
      {term && (
        <div className={
          style === "book"
            ? "mb-1 font-serif font-bold text-[15.5px] text-slate-900 underline underline-offset-2"
            : style === "ruled"
              ? "mb-0.5 font-handwriting-bold text-[18px] text-indigo-700"
              : "mb-1 font-sans font-bold text-[14px] text-slate-800"
        }>
          {term}
        </div>
      )}
      <MarkdownText text={text} style={style} />
    </CardShell>
  );
}

export function WhyCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="purple" icon={Target} label="Why it matters" style={style}>
      <MarkdownText text={text} style={style} />
    </CardShell>
  );
}

export function AnalogyCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="purple" icon={Compass} label="Analogy" style={style}>
      <div className={style === "ruled" ? "text-purple-800" : "italic text-slate-700"}>
        <MarkdownText text={text} style={style} />
      </div>
    </CardShell>
  );
}

export function ExampleCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="green" icon={Lightbulb} label="Example" style={style}>
      <MarkdownText text={text} style={style} />
    </CardShell>
  );
}

export function RealWorldCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="green" icon={Rocket} label="Real-world" style={style}>
      <MarkdownText text={text} style={style} />
    </CardShell>
  );
}

export function ChecklistBlock({ items, style = "ruled" }: { items: string[]; style?: StudyStyleT }) {
  if (style === "book") {
    return (
      <div className="my-5 font-serif">
        <div className="mb-2.5 font-sans font-extrabold text-slate-600 text-[10px] uppercase tracking-widest flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-slate-500" />
          Key Points
        </div>
        <ul className="list-disc pl-5 space-y-1.5 text-[14.5px] leading-[24px] text-slate-800">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (style === "unruled" || style === "mindmap" || style === "cornell") {
    return (
      <div className="my-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
        <div className="mb-3.5 flex items-center gap-2 font-sans font-bold text-slate-800 text-[14px]">
          <Star className="h-4 w-4 text-indigo-500" fill="currentColor" />
          Key Points
        </div>
        <div className="space-y-2.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[13.5px] leading-[22px] text-slate-600">
              <span className="mt-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              <span>{it}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: Ruled notebook style
  return (
    <div className="my-4 rounded-[12px] bg-[#FFF9D2] px-5 py-4 shadow-sm border border-[#FDE68A] font-handwriting">
      <div className="mb-2 flex items-center gap-2 font-handwriting-bold text-black text-[18px]">
        <span>⭐</span>
        <span>Key Points</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 text-[17px] leading-[26px]">
            <span className="mt-2.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-black/60" />
            <span className="text-black">{it}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormulaCard({
  label,
  expr,
  note,
  style = "ruled",
}: {
  label: string | null;
  expr: string;
  note?: string | null;
  style?: StudyStyleT;
}) {
  if (style === "book") {
    return (
      <div className="my-6 text-center font-serif py-2">
        <div className="rounded-lg bg-slate-55/40 border border-slate-200 py-3.5 text-center font-mono text-[16px] tracking-wide text-slate-900 shadow-2xs max-w-lg mx-auto italic">
          {expr}
        </div>
        {label && <div className="mt-2 text-xs font-sans font-bold text-slate-500">{label}</div>}
        {note && <p className="mt-1 text-[13.5px] italic text-slate-500 px-4">{note}</p>}
      </div>
    );
  }

  return (
    <CardShell tone="purple" icon={Sigma} label={label ?? "Formula"} style={style}>
      <div className={cn(
        "rounded-xl px-4 py-3 text-center font-mono text-[16px] tracking-wide shadow-inner border",
        style === "ruled"
          ? "bg-white border-indigo-200 text-indigo-700"
          : "bg-slate-50 border-slate-200 text-indigo-950"
      )}>
        {expr}
      </div>
      {note && <p className="mt-2 text-[13px] italic opacity-95">{note}</p>}
    </CardShell>
  );
}

export function WarningCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="red" icon={AlertTriangle} label="Warning" style={style}>
      <p>{text}</p>
    </CardShell>
  );
}

export function MistakeBlock({ items, style = "ruled" }: { items: string[]; style?: StudyStyleT }) {
  return (
    <CardShell tone="red" icon={ShieldAlert} label="Common Mistakes" style={style}>
      <ul className="space-y-1.5">
        {items.map((m, i) => (
          <li key={i} className="flex items-start gap-2.5 leading-[22px]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
            <span>{m}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function MemoryStickyNote({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  if (style === "book") {
    return (
      <div className="my-6 border-y-2 border-double border-slate-350 py-4 text-center font-serif">
        <div className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-slate-500 mb-1">Mnemonic / Memory Trick</div>
        <p className="text-[15.5px] italic leading-[26px] text-slate-900 font-medium px-4">"{text}"</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, rotate: -1.5, y: 8 }}
      animate={{ opacity: 1, rotate: -1.2, y: 0 }}
      transition={{ duration: 0.3 }}
      className="my-5 mx-auto max-w-[92%] rounded-xs bg-[#fef3a3] px-5 py-4 shadow-[2px_4px_10px_rgba(0,0,0,0.08),_inset_0_0_20px_rgba(255,255,255,0.4)] relative"
      style={{ transformOrigin: "top center" }}
    >
      {/* Tape effect */}
      <div className="absolute -top-2.5 left-1/2 h-4 w-14 -translate-x-1/2 bg-white/40 shadow-sm border border-white/50 rotate-1 rounded-[2px]" />
      
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-sans font-extrabold uppercase tracking-widest text-amber-800/80">
        <Sparkles className="h-3.5 w-3.5" />
        Memory Trick
      </div>
      <p className={cn(
        "leading-[28px] text-[#713f12]",
        style === "ruled" ? "font-handwriting text-[20px]" : "font-sans text-[13.5px] italic"
      )}>
        {text}
      </p>
    </motion.div>
  );
}

export function RevisionBlock({ items, style = "ruled" }: { items: string[]; style?: StudyStyleT }) {
  // Delegate to ChecklistBlock with matching layout rules
  return <ChecklistBlock items={items} style={style} />;
}

export function SummaryCard({ text, style = "ruled" }: { text: string; style?: StudyStyleT }) {
  return (
    <CardShell tone="slate" icon={BookOpen} label="Summary" style={style}>
      <p className="italic leading-[22px]">{text}</p>
    </CardShell>
  );
}

/* --------------------------- Code -------------------------------- */

export function CodeCard({
  language,
  code,
  output,
  explanation,
  style = "ruled",
}: {
  language?: string | null;
  code: string;
  output?: string | null;
  explanation?: string | null;
  style?: StudyStyleT;
}) {
  if (style === "book") {
    return (
      <div className="my-5 font-serif text-slate-800">
        <div className="flex items-center justify-between bg-slate-100 border border-slate-200 border-b-0 px-4 py-2 text-[10px] font-sans font-extrabold uppercase tracking-widest text-slate-500 rounded-t-lg">
          <span>{language || "code"}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              toast.success("Code copied!");
            }}
            className="hover:text-slate-900 transition flex items-center gap-1 cursor-pointer font-sans"
          >
            Copy
          </button>
        </div>
        <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-b-lg shadow-2xs">
          <pre className="overflow-x-auto font-mono text-[13px] leading-[22px] text-slate-800">
            <code>{code}</code>
          </pre>
        </div>
        {output && (
          <div className="mt-3 bg-slate-50 border border-slate-200/80 p-3.5 rounded-lg">
            <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-slate-500">Output:</span>
            <pre className="font-mono text-[12.5px] text-slate-700 mt-1 whitespace-pre-wrap">{output}</pre>
          </div>
        )}
        {explanation && (
          <p className="mt-2 text-[13.5px] leading-[22px] text-slate-500 italic">
            {explanation}
          </p>
        )}
      </div>
    );
  }

  if (style === "unruled" || style === "mindmap" || style === "cornell") {
    return (
      <div className="my-5 overflow-hidden rounded-2xl border border-slate-100 bg-[#0f172a] text-slate-200 shadow-sm font-sans">
        <div className="flex items-center justify-between bg-slate-900/60 px-4 py-2.5 text-[10px] font-mono font-bold text-slate-400 border-b border-slate-800">
          <span>{language || "CODE"}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              toast.success("Code copied!");
            }}
            className="hover:text-white transition flex items-center gap-1 cursor-pointer"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <div className="p-4">
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-[22px] text-slate-350">
            <code>{code}</code>
          </pre>
        </div>
        {output && (
          <div className="border-t border-slate-800 bg-slate-900/40 p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Output:</span>
            <pre className="font-mono text-[12.5px] text-emerald-400 mt-1.5 whitespace-pre-wrap">{output}</pre>
          </div>
        )}
        {explanation && (
          <div className="border-t border-slate-800 bg-slate-900/20 px-4 py-3.5 text-[13px] leading-[20px] text-slate-400">
            {explanation}
          </div>
        )}
      </div>
    );
  }

  // Default: Ruled handwritten style
  return (
    <div className="relative my-5 font-handwriting">
      <div className="rounded-xl border-2 border-slate-300 bg-white px-4 py-3 shadow-inner">
        <pre className="overflow-x-auto font-mono text-[13.5px] leading-[22px] text-slate-800">
          <code>{code}</code>
        </pre>
      </div>
      {output && (
        <div className="mt-2.5 px-2">
          <div className="font-handwriting-bold text-[18px] text-[#7C4DFF]">Output:</div>
          <pre className="font-handwriting-bold text-[17px] text-[#7C4DFF] mt-0.5 whitespace-pre-wrap">{output}</pre>
        </div>
      )}
      {explanation && (
        <div className="mt-1.5 px-2 text-[15.5px] text-slate-650">
          {explanation}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Quiz -------------------------------- */

export function QuizMCQCard({
  question,
  options,
  answer_index,
  style = "ruled",
}: {
  question: string;
  options: string[];
  answer_index: number;
  style?: StudyStyleT;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  
  return (
    <CardShell tone="slate" icon={Eye} label="Practice · Multiple Choice" style={style}>
      <div className={cn(
        "mb-3 font-semibold leading-[22px]",
        style === "book" ? "text-[15px]" : style === "ruled" ? "text-[18px]" : "text-[13.5px]"
      )}>{question}</div>
      
      <div className="space-y-2">
        {options.map((opt, i) => {
          const show = picked !== null;
          const isRight = i === answer_index;
          const isPicked = picked === i;
          
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(i)}
              className={cn(
                "block w-full rounded-xl border px-4 py-2.5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 cursor-pointer",
                style === "book" ? "text-[14px]" : style === "ruled" ? "text-[17px]" : "text-[13px]",
                show && isRight
                  ? "border-emerald-500/60 bg-emerald-50 text-emerald-900"
                  : show && isPicked
                    ? "border-red-500/60 bg-red-50 text-red-900"
                    : "border-slate-200 bg-white hover:border-indigo-400 hover:bg-slate-50/50"
              )}
            >
              <span className="font-bold mr-2">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          );
        })}
      </div>
    </CardShell>
  );
}

export function QuizTFCard({
  statement,
  answer,
  style = "ruled",
}: {
  statement: string;
  answer: boolean;
  style?: StudyStyleT;
}) {
  return <RevealQuiz label="True / False" question={statement} answer={answer ? "True" : "False"} style={style} />;
}

export function QuizFillCard({
  sentence,
  answer,
  style = "ruled",
}: {
  sentence: string;
  answer: string;
  style?: StudyStyleT;
}) {
  return <RevealQuiz label="Fill in the blank" question={sentence} answer={answer} style={style} />;
}

function RevealQuiz({
  label,
  question,
  answer,
  style = "ruled",
}: {
  label: string;
  question: string;
  answer: string;
  style?: StudyStyleT;
}) {
  const [show, setShow] = useState(false);
  return (
    <CardShell tone="slate" icon={Eye} label={`Practice · ${label}`} style={style}>
      <div className={cn(
        "mb-2.5 font-semibold leading-[22px]",
        style === "book" ? "text-[15px]" : style === "ruled" ? "text-[18px]" : "text-[13.5px]"
      )}>{question}</div>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className={cn(
          "px-4 py-1.5 rounded-full border transition cursor-pointer font-bold active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          style === "book"
            ? "border-slate-800 bg-slate-900 text-white hover:opacity-90 text-xs"
            : style === "ruled"
              ? "border-indigo-300 bg-indigo-50 text-indigo-800 text-[15px]"
              : "border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-50 text-[11px]"
        )}
      >
        {show ? `Answer: ${answer}` : "Reveal Answer"}
      </button>
    </CardShell>
  );
}

/* --------------------------- Renderer ---------------------------- */

export function BlockRenderer({ block, style = "ruled" }: { block: NotebookBlock; style?: StudyStyleT }) {
  if (!block) return null;

  switch (block.kind) {
    case "section":
      return <SectionHeading text={block.text || "..."} style={style} />;
    case "paragraph":
      return <Paragraph text={block.text} style={style} />;
    case "definition":
      return <DefinitionCard term={block.term} text={block.text} style={style} />;
    case "why":
      return <WhyCard text={block.text} style={style} />;
    case "analogy":
      return <AnalogyCard text={block.text} style={style} />;
    case "example":
      return <ExampleCard text={block.text} style={style} />;
    case "real_world":
      return <RealWorldCard text={block.text} style={style} />;
    case "warning":
      return <WarningCard text={block.text} style={style} />;
    case "summary":
      return <SummaryCard text={block.text} style={style} />;
    case "memory":
      return <MemoryStickyNote text={block.text} style={style} />;
    case "checklist":
      return <ChecklistBlock items={block.items || []} style={style} />;
    case "revision":
      return <RevisionBlock items={block.items || []} style={style} />;
    case "mistake":
      return <MistakeBlock items={block.items || []} style={style} />;
    case "formula":
      if (!block.expr) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting Formula...</div>;
      return <FormulaCard expr={block.expr} label={block.label} style={style} />;
    case "code":
      if (!block.code) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Writing Code...</div>;
      return (
        <CodeCard
          language={block.language}
          code={block.code}
          output={block.output}
          explanation={block.explanation}
          style={style}
        />
      );
    case "quiz_mcq":
      if (!block.options || block.options.length === 0) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting MCQ...</div>;
      return (
        <QuizMCQCard
          question={block.question}
          options={block.options}
          answer_index={block.answer_index}
          style={style}
        />
      );
    case "quiz_tf":
      if (!block.statement) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting True/False...</div>;
      return (
        <QuizTFCard
          statement={block.statement}
          answer={block.answer}
          style={style}
        />
      );
    case "quiz_fill":
      if (!block.sentence) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting Quiz...</div>;
      return (
        <QuizFillCard
          sentence={block.sentence}
          answer={block.answer}
          style={style}
        />
      );
    default:
      return null;
  }
}
