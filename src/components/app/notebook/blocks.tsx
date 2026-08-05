import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Lightbulb,
  Sparkles,
  Target,
  AlertTriangle,
  ShieldAlert,
  Zap,
  Sigma,
  Copy,
  Check,
  Star,
  Eye,
  Compass,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";
import type { NotebookBlock } from "@/lib/study-notes.schema";

/* --------------------------- Primitives --------------------------- */

export function HandwritingText({ text, className, style }: { text?: string, className?: string, style?: React.CSSProperties }) {
  // Smoothly reveal text char by char if it's updating, masking chunkiness of the stream
  const [displayed, setDisplayed] = useState(text || "");
  
  // Note: For true ultra-responsive we can just render the text directly since 
  // Gemini streams very granularly, but we add a small stagger for the handwriting feel.
  
  return (
    <span className={className} style={style}>
      {text || ""}
    </span>
  );
}

export function SectionHeading({ text }: { text: string }) {
  return (
    <h2 className="mt-5 mb-3 font-handwriting-bold text-[26px] leading-tight text-[#7C4DFF] tracking-wide">
      {text}
    </h2>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Paragraph({ text }: { text: string }) {
  // Fix broken tables (LLMs sometimes add blank lines between table rows, or forget a blank line before the table)
  const processedContent = text
    .replace(/^([ \t]*\|[^\n]*\|[ \t]*\r?\n)([ \t]*\r?\n)+(?=[ \t]*\|)/gm, '$1')
    .replace(/(^|\n)(?![ \t]*\|)([^\n]+)\n([ \t]*\|(?=.*\|))/g, '$1$2\n\n$3');

  return (
    <div
      className="my-2 text-[15px] leading-[28px] text-[#1a1a2e]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
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
          td: ({ children }) => (
            <td className="px-4 py-2.5 align-top leading-relaxed">{children}</td>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-indigo-900">{children}</strong>,
          em: ({ children }) => <em className="italic opacity-90">{children}</em>,
          ul: ({ children }) => <ul className="my-2 space-y-1 pl-4 list-disc marker:text-indigo-300">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 pl-4 list-decimal marker:text-indigo-400 marker:font-bold">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

/* --------------------------- Cards ------------------------------- */

function CardShell({
  tone,
  icon: Icon,
  label,
  children,
}: {
  tone: "blue" | "green" | "yellow" | "red" | "purple" | "orange" | "slate";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    blue: "bg-[#eff6ff] border-[#bfdbfe] text-[#1e3a8a]",
    green: "bg-[#f0fdf4] border-[#bbf7d0] text-[#14532d]",
    yellow: "bg-[#fefce8] border-[#fde68a] text-[#713f12]",
    red: "bg-[#fef2f2] border-[#fecaca] text-[#7f1d1d]",
    purple: "bg-[#f5f3ff] border-[#ddd6fe] text-[#4c1d95]",
    orange: "bg-[#fff7ed] border-[#fed7aa] text-[#7c2d12]",
    slate: "bg-[#f8fafc] border-[#e2e8f0] text-[#1e293b]",
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`relative mt-5 mb-4 rounded-xl border ${tones[tone]} px-4 py-3.5 shadow-sm`}
    >
      <div className="absolute -top-3 left-4 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm border border-slate-100 flex items-center gap-1.5 opacity-90">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </motion.div>
  );
}

export function MarkdownText({ text }: { text: string }) {
  const processedContent = text
    .replace(/^([ \t]*\|[^\n]*\|[ \t]*\r?\n)([ \t]*\r?\n)+(?=[ \t]*\|)/gm, '$1')
    .replace(/(^|\n)(?![ \t]*\|)([^\n]+)\n([ \t]*\|(?=.*\|))/g, '$1$2\n\n$3');
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
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
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

export function DefinitionCard({
  term,
  text,
}: {
  term: string | null;
  text: string;
}) {
  return (
    <CardShell tone="blue" icon={BookOpen} label="Definition">
      {term && (
        <div className="mb-0.5 font-handwriting-bold text-[18px] text-[#1e3a8a]">
          {term}
        </div>
      )}
      <div className="text-[14.5px] leading-[24px]"><MarkdownText text={text} /></div>
    </CardShell>
  );
}

export function WhyCard({ text }: { text: string }) {
  return (
    <CardShell tone="purple" icon={Target} label="Why it matters">
      <div className="text-[14.5px] leading-[24px]"><MarkdownText text={text} /></div>
    </CardShell>
  );
}

export function AnalogyCard({ text }: { text: string }) {
  return (
    <CardShell tone="purple" icon={Compass} label="Analogy">
      <div className="font-handwriting text-[17px] leading-[26px] text-[#4c1d95]">
        <MarkdownText text={text} />
      </div>
    </CardShell>
  );
}

export function ExampleCard({ text }: { text: string }) {
  return (
    <CardShell tone="green" icon={Lightbulb} label="Example">
      <div className="text-[14.5px] leading-[24px]"><MarkdownText text={text} /></div>
    </CardShell>
  );
}

export function RealWorldCard({ text }: { text: string }) {
  return (
    <CardShell tone="green" icon={Rocket} label="Real-world">
      <div className="text-[14.5px] leading-[24px]"><MarkdownText text={text} /></div>
    </CardShell>
  );
}

export function ChecklistBlock({ items }: { items: string[] }) {
  // Styled like the "Key Points" block in the mockup
  return (
    <div className="my-4 rounded-[12px] bg-[#FFF9D2] px-5 py-4 shadow-sm border border-[#FDE68A]">
      <div className="mb-3 flex items-center gap-2 font-bold text-black text-[15px]">
        <Star className="h-4 w-4 text-[#EAB308]" fill="#EAB308" />
        Key Points
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 text-[14px] leading-[22px]">
            <span className="mt-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-black/60" />
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
}: {
  label: string | null;
  expr: string;
  note?: string | null;
}) {
  return (
    <CardShell tone="purple" icon={Sigma} label={label ?? "Formula"}>
      <div className="rounded-lg bg-white/60 border border-purple-200/50 px-4 py-3 text-center font-mono text-[17px] tracking-wide text-[#4c1d95] shadow-inner">
        {expr}
      </div>
      {note && <p className="mt-2 text-[14px] italic opacity-90">{note}</p>}
    </CardShell>
  );
}

export function WarningCard({ text }: { text: string }) {
  return (
    <CardShell tone="red" icon={AlertTriangle} label="Warning">
      <p className="text-[14.5px] leading-[24px]">{text}</p>
    </CardShell>
  );
}

export function MistakeBlock({ items }: { items: string[] }) {
  return (
    <CardShell tone="red" icon={ShieldAlert} label="Common Mistakes">
      <ul className="space-y-1">
        {items.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-[14px] leading-[22px]">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#dc2626]" />
            <span>{m}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function MemoryStickyNote({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, rotate: -1.5, y: 8 }}
      animate={{ opacity: 1, rotate: -1.2, y: 0 }}
      transition={{ duration: 0.3 }}
      className="my-5 mx-auto max-w-[90%] rounded-sm bg-[#fef3a3] px-5 py-4 shadow-[2px_4px_10px_rgba(0,0,0,0.1),_inset_0_0_20px_rgba(255,255,255,0.4)]"
      style={{ transformOrigin: "top center" }}
    >
      {/* Tape effect */}
      <div className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 bg-white/40 shadow-sm border border-white/60 rotate-1 rounded-[2px]" />
      
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#854d0e]">
        <Sparkles className="h-3.5 w-3.5" />
        Memory Trick
      </div>
      <p className="font-handwriting text-[22px] leading-[30px] text-[#713f12]">
        {text}
      </p>
    </motion.div>
  );
}

export function RevisionBlock({ items }: { items: string[] }) {
  // Styled like Key Points
  return (
    <div className="my-4 rounded-[12px] bg-[#FFF9D2] px-5 py-4 shadow-sm border border-[#FDE68A]">
      <div className="mb-3 flex items-center gap-2 font-bold text-black text-[15px]">
        <Star className="h-4 w-4 text-[#EAB308]" fill="#EAB308" />
        Key Points
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 text-[14px] leading-[22px]">
            <span className="mt-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-black/60" />
            <span className="text-black">{it}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SummaryCard({ text }: { text: string }) {
  return (
    <CardShell tone="slate" icon={BookOpen} label="Summary">
      <p className="text-[14.5px] leading-[24px] italic">{text}</p>
    </CardShell>
  );
}

/* --------------------------- Code -------------------------------- */

export function CodeCard({
  language,
  code,
  output,
  explanation,
}: {
  language?: string | null;
  code: string;
  output?: string | null;
  explanation?: string | null;
}) {
  return (
    <div className="relative my-4">
      {/* Code box */}
      <div className="rounded-[8px] border border-gray-400/80 bg-[#FEFEF6] px-4 py-3 shadow-sm">
        <pre className="overflow-x-auto font-mono text-[14px] leading-[24px] text-black">
          <code>{code}</code>
        </pre>
      </div>
      
      {/* Output below in purple handwriting */}
      {output && (
        <div className="mt-3 px-2">
          <div className="font-handwriting font-bold text-[18px] text-[#7C4DFF]">
            Output:
          </div>
          <pre className="font-handwriting font-bold text-[17px] text-[#7C4DFF] mt-1 whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      )}
      
      {explanation && (
        <div className="mt-2 px-2 font-handwriting text-[16px] text-slate-700">
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
}: {
  question: string;
  options: string[];
  answer_index: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <CardShell tone="slate" icon={Eye} label="Practice · Multiple Choice">
      <div className="mb-2 font-medium text-[14px] leading-[22px]">{question}</div>
      <div className="space-y-1.5">
        {options.map((opt, i) => {
          const show = picked !== null;
          const isRight = i === answer_index;
          const isPicked = picked === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(i)}
              className={
                "block w-full rounded-lg border px-3 py-1.5 text-left text-[13px] transition " +
                (show && isRight
                  ? "border-green-500/60 bg-green-50 text-green-900"
                  : show && isPicked
                    ? "border-red-500/60 bg-red-50 text-red-900"
                    : "border-slate-200 bg-white hover:border-purple-400")
              }
            >
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
}: {
  statement: string;
  answer: boolean;
}) {
  return <RevealQuiz label="True / False" question={statement} answer={answer ? "True" : "False"} />;
}

export function QuizFillCard({
  sentence,
  answer,
}: {
  sentence: string;
  answer: string;
}) {
  return <RevealQuiz label="Fill in the blank" question={sentence} answer={answer} />;
}

function RevealQuiz({
  label,
  question,
  answer,
}: {
  label: string;
  question: string;
  answer: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <CardShell tone="slate" icon={Eye} label={`Practice · ${label}`}>
      <div className="mb-1.5 font-medium text-[14px] leading-[22px]">{question}</div>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="rounded-full border border-purple-300 bg-purple-50 px-3 py-1 text-[11px] font-bold text-purple-800"
      >
        {show ? `Answer: ${answer}` : "Reveal answer"}
      </button>
    </CardShell>
  );
}

/* --------------------------- Renderer ---------------------------- */

export function BlockRenderer({ block }: { block: NotebookBlock }) {
  if (!block) return null;
  
  // Placeholders for complex blocks that haven't finished generating
  const isGenerating = (block as any)._isStreamingPartial; 

  switch (block.kind) {
    case "section":
      return <SectionHeading text={block.text || "..."} />;
    case "paragraph":
      return <Paragraph text={block.text} />;
    case "definition":
      return <DefinitionCard term={block.term} text={block.text} />;
    case "why":
      return <WhyCard text={block.text} />;
    case "analogy":
      return <AnalogyCard text={block.text} />;
    case "example":
      return <ExampleCard text={block.text} />;
    case "real_world":
      return <RealWorldCard text={block.text} />;
    case "warning":
      return <WarningCard text={block.text} />;
    case "summary":
      return <SummaryCard text={block.text} />;
    case "memory":
      return <MemoryStickyNote text={block.text} />;
    case "checklist":
      return <ChecklistBlock items={block.items || []} />;
    case "revision":
      return <RevisionBlock items={block.items || []} />;
    case "mistake":
      return <MistakeBlock items={block.items || []} />;
    case "formula":
      if (!block.expr) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting Formula...</div>;
      return <FormulaCard expr={block.expr} label={block.label} />;
    case "code":
      if (!block.code) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Writing Code...</div>;
      return (
        <CodeCard
          language={block.language}
          code={block.code}
          output={block.output}
          explanation={block.explanation}
        />
      );
    case "quiz_mcq":
      if (!block.options || block.options.length === 0) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting MCQ...</div>;
      return (
        <QuizMCQCard
          question={block.question}
          options={block.options}
          answer_index={block.answer_index}
        />
      );
    case "quiz_tf":
      if (!block.statement) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting True/False...</div>;
      return (
        <QuizTFCard
          statement={block.statement}
          answer={block.answer}
        />
      );
    case "quiz_fill":
      if (!block.sentence) return <div className="animate-pulse p-4 text-[#6d28d9] font-handwriting">Drafting Quiz...</div>;
      return (
        <QuizFillCard
          sentence={block.sentence}
          answer={block.answer}
        />
      );
    default:
      return null;
  }
}
