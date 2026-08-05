import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Menu, X, Search, Plus, Send, Mic, Bell, Sparkles, MessageCircle,
  MoreVertical, FileText, Image as ImageIcon, Youtube, Link2, PenSquare,
  Phone, Timer, HelpCircle, CheckCheck, GraduationCap, BookOpen, Map,
  Paperclip, Loader2, Square, Trash2, Share, Pin, Maximize, Minimize,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SanaMarkdown } from "@/components/sana-markdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { generateSetFromThread } from "@/lib/revision.functions";
import { searchYouTubeChunks, type MatchedChunk } from "@/lib/youtube-processing.functions";
import { searchClassroomChunks, type ClassroomMatch, type ClassroomSearchResult } from "@/lib/classroom-search.functions";
import sanaHero from "@/assets/sana-hero.png";
import { useResolvedAvatar } from "@/hooks/use-resolved-avatar";
import { AnimatePresence, motion } from "framer-motion";
import {
  YouTubeConnectorSheet, YouTubeRichCard, YouTubeTimelineSheet, fmtDuration,
  type PinnedSection,
} from "@/components/app/YouTubeConnector";
import { ClassroomConnectorSheet } from "@/components/app/ClassroomConnector";
import type { YouTubeVideoMeta } from "@/lib/youtube.functions";
import { StudyNoteRenderer } from "@/components/app/StudyNoteRenderer";
import { StyleBottomSheet } from "@/components/app/StyleBottomSheet";
import { getStudyPrefs, setStudyPrefs } from "@/lib/study-notes.functions";
import { STYLE_META, type StudyStyleT } from "@/lib/study-notes.schema";
import { BookOpenCheck, ChevronDown } from "lucide-react";

const YT_CARD_PREFIX = "[[YT_CARD]]";
function parseYtCard(text: string): YouTubeVideoMeta | null {
  if (!text.startsWith(YT_CARD_PREFIX)) return null;
  const end = text.indexOf("[[/YT_CARD]]");
  if (end < 0) return null;
  try { return JSON.parse(text.slice(YT_CARD_PREFIX.length, end)) as YouTubeVideoMeta; }
  catch { return null; }
}

const DOC_CARD_PREFIX = "[[DOCUMENT_CARD]]";
function parseDocCard(text: string): { name: string; url: string; kind: string; size?: number } | null {
  if (!text.startsWith(DOC_CARD_PREFIX)) return null;
  const end = text.indexOf("[[/DOCUMENT_CARD]]");
  if (end < 0) return null;
  try { return JSON.parse(text.slice(DOC_CARD_PREFIX.length, end)); }
  catch { return null; }
}

/** Convert plain-text timestamps like "1:30:42" or "02:14" into clickable
 *  markdown links pointing at the given YouTube video. Skips timestamps
 *  already inside a markdown link or image. */
function linkifyTimestamps(text: string, videoId: string | null): string {
  if (!videoId || !text) return text;
  const toSec = (t: string) => {
    const parts = t.split(":").map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  };
  const parts = text.split(/(\!?\[[^\]]*\]\([^)]*\))/g);
  const TS = /(?<![\w:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\w:])/g;
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(TS, (raw, t: string) => {
        const s = toSec(t);
        return s == null ? raw : `[${t}](https://youtu.be/${videoId}?t=${s})`;
      });
    })
    .join("");
}

export const Route = createFileRoute("/_authenticated/chat")({
  ssr: false,
  component: ChatPage,
});

type Attachment = { id: string; name: string; url: string; kind: "pdf" | "image" | "youtube" | "docx" | "pptx" | "txt" };

type ClassroomDebug = {
  query: string;
  matchCount: number;
  embedMs: number;
  queryMs: number;
  totalMs: number;
  courseIds: string[] | null;
  matches: ClassroomMatch[];
};

function ChatPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ytSheetOpen, setYtSheetOpen] = useState(false);
  const [classroomSheetOpen, setClassroomSheetOpen] = useState(false);
  const [heroDismissed, setHeroDismissed] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [timelineFor, setTimelineFor] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedSection | null>(null);
  const [pinnedChats, setPinnedChats] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("sana_pinned_chats") || "[]"); }
    catch { return []; }
  });
  const [isFullScreen, setIsFullScreen] = useState(false);

  const togglePin = (id: string) => {
    setPinnedChats(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem("sana_pinned_chats", JSON.stringify(next));
      return next;
    });
  };

  const deleteChat = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("chat_threads").delete().eq("id", id).eq("user_id", u.user.id);
    if (threadId === id) {
      setThreadId(null);
      setMessages([]);
      setHeroDismissed(false);
    }
    qc.invalidateQueries({ queryKey: ["threads"] });
    toast.success("Chat deleted");
  };

  const shareChat = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/chat/${id}`);
    toast.success("Chat link copied to clipboard!");
  };

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(80);
  const [genBusy, setGenBusy] = useState<null | "notes" | "quiz">(null);
  const generate = useServerFn(generateSetFromThread);

  // ===== Study View =====
  const getPrefs = useServerFn(getStudyPrefs);
  const setPrefs = useServerFn(setStudyPrefs);
  const { data: studyPrefs } = useQuery({
    queryKey: ["study-prefs"],
    queryFn: () => getPrefs(),
  });
  const studyEnabled = studyPrefs?.enabled ?? false;
  const studyStyle = ((studyPrefs?.style ?? "ruled") as StudyStyleT);
  const [styleSheetOpen, setStyleSheetOpen] = useState(false);
  const [styleFirstTime, setStyleFirstTime] = useState(false);

  async function toggleStudyView() {
    if (!studyEnabled) {
      // first time — open picker
      setStyleFirstTime(true);
      setStyleSheetOpen(true);
      await setPrefs({ data: { enabled: true } });
      qc.invalidateQueries({ queryKey: ["study-prefs"] });
    } else {
      await setPrefs({ data: { enabled: false } });
      qc.invalidateQueries({ queryKey: ["study-prefs"] });
    }
  }
  async function pickStyle(s: StudyStyleT) {
    await setPrefs({ data: { style: s, enabled: true } });
    qc.invalidateQueries({ queryKey: ["study-prefs"] });
    setStyleFirstTime(false);
  }

  async function handleGenerate(mode: "notes" | "quiz") {
    if (genBusy) return;
    if (!threadId) {
      toast.error("Start a chat first", { description: "Send a message to Sana, then try again." });
      return;
    }
    if (messages.length === 0) {
      toast.error("Nothing to summarise yet", { description: "Ask Sana something first so we have content to turn into a set." });
      return;
    }
    if (busy) {
      toast.message("Hold on — Sana is still replying");
      return;
    }
    setGenBusy(mode);
    const loadingId = toast.loading(mode === "quiz" ? "Preparing your quiz…" : "Generating notes…");
    try {
      const { data: existing, error: existErr } = await supabase
        .from("revision_sets").select("id").eq("thread_id", threadId).maybeSingle();
      if (existErr) throw existErr;
      let setId = existing?.id as string | undefined;
      if (!setId) {
        const res = await generate({ data: { threadId } });
        setId = res?.setId ?? undefined;
        if (!setId) throw new Error("Generation returned no set");
        qc.invalidateQueries({ queryKey: ["sets"] });
        toast.success("Revision set ready", { id: loadingId });
      } else {
        toast.success("Opening your set", { id: loadingId });
      }
      nav({
        to: mode === "quiz" ? "/revision/$setId/session" : "/revision/$setId",
        params: { setId },
      });
    } catch (e: any) {
      console.error("generate failed", e);
      toast.error("Couldn't generate set", {
        id: loadingId,
        description: e?.message ?? "Please try again in a moment.",
      });
    } finally {
      setGenBusy(null);
    }
  }

  const { data: threads = [] } = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_threads").select("*").order("last_message_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: classroomCourses = [] } = useQuery({
    queryKey: ["classroom-courses-chat"],
    queryFn: async () => {
      const { data } = await supabase
        .from("classroom_courses")
        .select("google_course_id, name")
        .order("name");
      return (data ?? []) as { google_course_id: string; name: string }[];
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["chat-profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { personality: "friendly_coach" as const, displayName: null };
      const [{ data: prefs }, { data: prof }] = await Promise.all([
        supabase.from("onboarding_preferences").select("ai_personality").eq("user_id", u.user.id).maybeSingle(),
        supabase.from("profiles").select("display_name, avatar_url").eq("user_id", u.user.id).maybeSingle(),
      ]);
      return {
        personality: (prefs?.ai_personality ?? "friendly_coach") as any,
        displayName: prof?.display_name ?? null,
        avatarUrl: prof?.avatar_url ?? null,
      };
    },
  });

  const resolvedAvatarUrl = useResolvedAvatar(profile?.avatarUrl ?? null);

  useEffect(() => {
    (async () => {
      if (threadId) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: existing } = await supabase.from("chat_threads")
        .select("id").eq("user_id", u.user.id)
        .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) setThreadId(existing.id);
      else {
        const { data: created } = await supabase.from("chat_threads")
          .insert({ user_id: u.user.id, title: "New Chat" }).select("id").single();
        if (created) { setThreadId(created.id); qc.invalidateQueries({ queryKey: ["threads"] }); }
      }
    })();
  }, [threadId, qc]);

  const { data: initialMessages } = useQuery({
    queryKey: ["messages", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      if (!threadId) return [] as UIMessage[];
      const { data } = await supabase.from("chat_messages").select("*").eq("thread_id", threadId).order("created_at");
      return (data ?? []).map((m): UIMessage => ({
        id: m.id,
        role: m.role as UIMessage["role"],
        parts: [{ type: "text", text: m.content }],
        // @ts-expect-error carry createdAt for rendering
        createdAt: m.created_at,
      }));
    },
  });

  const pendingContextRef = useRef<string | null>(null);
  const pendingClassroomContextRef = useRef<string | null>(null);
  const pendingClassroomSourcesRef = useRef<ClassroomMatch[] | null>(null);
  const pendingClassroomDebugRef = useRef<ClassroomDebug | null>(null);
  const [classroomSources, setClassroomSources] = useState<Record<string, ClassroomMatch[]>>({});
  const [classroomDebug, setClassroomDebug] = useState<Record<string, ClassroomDebug>>({});
  const [classroomCourseFilter, setClassroomCourseFilter] = useState<string[]>([]);
  const transport = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({
        personality: profile?.personality,
        displayName: profile?.displayName,
        videoContext: pendingContextRef.current,
        classroomContext: pendingClassroomContextRef.current,
      }),
    }),
  ).current;

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    id: threadId ?? "new",
    transport,
    onError: (e) => {
      console.error("useChat err", e);
      toast.error("Sana had trouble replying. Please try again.");
    },
    onFinish: async ({ message }) => {
      if (!threadId) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const text = message.parts.map(p => (p.type === "text" ? p.text : "")).join("");
      await supabase.from("chat_messages").insert({ thread_id: threadId, user_id: u.user.id, role: "assistant", content: text });
      await supabase.from("chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);
      qc.invalidateQueries({ queryKey: ["threads"] });
      // Attach any classroom sources gathered for this reply.
      const srcs = pendingClassroomSourcesRef.current;
      if (srcs && srcs.length) {
        setClassroomSources((m) => ({ ...m, [message.id]: srcs }));
      }
      const dbg = pendingClassroomDebugRef.current;
      if (dbg) {
        setClassroomDebug((m) => ({ ...m, [message.id]: dbg }));
      }
      pendingClassroomSourcesRef.current = null;
      pendingClassroomDebugRef.current = null;
      pendingClassroomContextRef.current = null;
    },
  });

  const loadedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || !initialMessages) return;
    if (loadedThreadRef.current === threadId) return;
    loadedThreadRef.current = threadId;
    setMessages(initialMessages);
  }, [threadId, initialMessages, setMessages]);

  // Only auto-scroll when the user is already near the bottom, so scrolling
  // up to read earlier messages isn't yanked back down while Sana streams.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    // Use instant scroll during streaming to avoid the janky "sliding" fight
    // between smooth-scroll animations and incoming tokens.
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);
  useEffect(() => {
    stickToBottomRef.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    inputRef.current?.focus();
  }, [threadId]);

  // Measure composer height so the message scroller can pad its bottom,
  // guaranteeing the last message is never hidden behind the sticky bar.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setComposerH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const busy = status === "submitted" || status === "streaming";

  async function uploadFile(file: File, overrideKind?: "image") {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { nav({ to: "/auth" }); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("File is too large (max 20MB)"); return; }
    
    let kind: Attachment["kind"] = "txt";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (overrideKind === "image" || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) kind = "image";
    else if (ext === "pdf") kind = "pdf";
    else if (ext === "docx") kind = "docx";
    else if (ext === "pptx") kind = "pptx";
    else if (ext === "txt") kind = "txt";

    setUploading(true);
    try {
      const path = `${u.user.id}/chat/${crypto.randomUUID()}.${ext || "bin"}`;
      const { error: upErr } = await supabase.storage.from("user-uploads").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) throw upErr;
      const { data: signed, error: sErr } = await supabase.storage.from("user-uploads")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (sErr || !signed) throw sErr ?? new Error("sign failed");
      
      await supabase.from("uploads").insert({
        user_id: u.user.id, kind, storage_path: path, source_url: null,
      });
      
      const newAtt = { id: crypto.randomUUID(), name: file.name, url: signed.signedUrl, kind };
      setAttachments((a) => [...a, newAtt]);
      
      // Inject document card immediately if it's a document
      if (kind !== "image") {
        const followup = [
          `**Document uploaded successfully** ✨`,
          ``,
          `Ask me anything about this document, or choose an action below.`,
          ``,
          `[chip: Summarize document] [chip: Key takeaways] [chip: Create quiz] [chip: Generate notes]`
        ].join("\n");
        const payload = `[[DOCUMENT_CARD]]${JSON.stringify({ name: file.name, url: signed.signedUrl, kind, size: file.size })}[[/DOCUMENT_CARD]]\n\n${followup}`;
        
        if (threadId) {
          await supabase.from("chat_messages").insert({
            thread_id: threadId, user_id: u.user.id, role: "assistant", content: payload,
          });
          await supabase.from("chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: payload }] } as any,
          ]);
          setHeroDismissed(true);
          qc.invalidateQueries({ queryKey: ["threads"] });
        }
      }
      
      toast.success(`${kind.toUpperCase()} attached`);
    } catch (e) {
      console.error(e);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleYouTubeReady(video: YouTubeVideoMeta) {
    // Add to attachments so the user's next question carries context
    setAttachments((a) => [
      ...a.filter((x) => !(x.kind === "youtube" && x.name === video.video_id)),
      { id: crypto.randomUUID(), name: video.video_id, url: `https://youtu.be/${video.video_id}`, kind: "youtube" },
    ]);

    if (!threadId) { toast.success("Video ready — start a chat to ask about it"); return; }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    // Inject a rich assistant card message
    const duration = video.duration_seconds ? fmtDuration(video.duration_seconds) : "";
    const followup = [
      `**Video successfully learned** ✨`,
      ``,
      `**${video.title}**  `,
      `${video.channel_title}${duration ? ` · ${duration}` : ""}${video.language ? ` · ${video.language.toUpperCase()}` : ""}`,
      ``,
      `Ask me anything about this video — I'll answer with references to the exact moments in the lecture.`,
      ``,
      `[chip: Summarize this video] [chip: Key takeaways] [chip: Create quiz] [chip: Generate notes]`,
    ].join("\n");
    const payload = `${YT_CARD_PREFIX}${JSON.stringify(video)}[[/YT_CARD]]\n\n${followup}`;

    await supabase.from("chat_messages").insert({
      thread_id: threadId, user_id: u.user.id, role: "assistant", content: payload,
    });
    await supabase.from("chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: payload }] } as any,
    ]);
    setHeroDismissed(true);
    qc.invalidateQueries({ queryKey: ["threads"] });
    toast.success(video.cached ? "Loaded from memory" : "Video learned!");
  }


  const searchChunks = useServerFn(searchYouTubeChunks);
  const searchClassroom = useServerFn(searchClassroomChunks);

  async function send(text: string) {
    if ((!text.trim() && attachments.length === 0) || busy || !threadId) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { nav({ to: "/auth" }); return; }

    const attachLines = attachments.map((a) => {
      if (a.kind === "youtube") return `[YouTube: ${a.url}]`;
      if (a.kind === "image") return `[Image attached: ${a.name} — ${a.url}]`;
      return `[PDF attached: ${a.name} — ${a.url}]`;
    });
    const fullText = [text.trim(), ...attachLines].filter(Boolean).join("\n\n");

    // RAG: pull relevant transcript chunks for any attached YouTube videos
    pendingContextRef.current = null;
    const ytIds = attachments.filter((a) => a.kind === "youtube").map((a) => a.name);
    const useFocus = pinned && ytIds.includes(pinned.videoId);
    if (ytIds.length && text.trim()) {
      try {
        const chunks: MatchedChunk[] = await searchChunks({
          data: {
            query: text.trim(),
            videoIds: useFocus ? [pinned.videoId] : ytIds,
            matchCount: useFocus ? 8 : 6,
            ...(useFocus
              ? { minStartSeconds: pinned.start_seconds, maxEndSeconds: pinned.end_seconds }
              : {}),
          },
        });
        if (chunks.length) {
          const header = useFocus
            ? `The user is currently focused on the section "${pinned.title}" (${fmtDuration(pinned.start_seconds)}–${fmtDuration(pinned.end_seconds)}). Prioritize answers grounded in this window.\n\n`
            : "";
          pendingContextRef.current = header + chunks
            .map((c) => {
              const mm = String(Math.floor(c.start_seconds / 60)).padStart(2, "0");
              const ss = String(c.start_seconds % 60).padStart(2, "0");
              const link = `https://youtu.be/${c.video_id}?t=${c.start_seconds}`;
              return `[${mm}:${ss}](${link}) ${c.content}`;
            })
            .join("\n\n");
        }
      } catch (e) {
        console.warn("[yt] search failed", e);
      }
    }

    // RAG: pull relevant Google Classroom chunks (assignments, materials, docs).
    pendingClassroomContextRef.current = null;
    pendingClassroomSourcesRef.current = null;
    pendingClassroomDebugRef.current = null;
    if (text.trim()) {
      try {
        const result: ClassroomSearchResult = await searchClassroom({
          data: {
            query: text.trim(),
            matchCount: 8,
            courseIds: classroomCourseFilter.length ? classroomCourseFilter : undefined,
          },
        });
        const matches = result.matches;
        pendingClassroomDebugRef.current = {
          query: result.requested.query,
          matchCount: result.requested.matchCount,
          embedMs: result.timings.embedMs,
          queryMs: result.timings.queryMs,
          totalMs: result.timings.totalMs,
          courseIds: result.requested.courseIds,
          matches,
        };
        if (matches.length) {
          pendingClassroomSourcesRef.current = matches;
          pendingClassroomContextRef.current = matches
            .map((m, i) => {
              const label = m.documentTitle || `Source ${i + 1}`;
              const link = m.alternateLink ?? "";
              const course = m.courseName ? ` (${m.courseName})` : "";
              const cite = link ? `[${label}](${link})${course}` : `${label}${course}`;
              return `Source: ${cite}\n${m.content}`;
            })
            .join("\n\n---\n\n");
        } else {
          // Signal to the API that retrieval ran and found nothing — the prompt
          // will tell the model to be transparent instead of hallucinating.
          pendingClassroomContextRef.current = "__NO_MATCHES__";
        }
      } catch (e) {
        console.warn("[classroom] search failed", e);
      }
    }

    await supabase.from("chat_messages").insert({ thread_id: threadId, user_id: u.user.id, role: "user", content: fullText });
    const t = threads.find(x => x.id === threadId);
    if (t && (t.title === "New Chat" || !t.title)) {
      const title = (text.trim() || attachments[0]?.name || "New Chat").slice(0, 40);
      await supabase.from("chat_threads").update({ title }).eq("id", threadId);
      qc.invalidateQueries({ queryKey: ["threads"] });
    }
    await sendMessage({ text: fullText });
    setInput("");
    // Keep YouTube attachments sticky so follow-ups stay grounded in the video
    setAttachments((a) => a.filter((x) => x.kind === "youtube"));
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function newChat() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: created } = await supabase.from("chat_threads")
      .insert({ user_id: u.user.id, title: "New Chat" }).select("id").single();
    if (created) {
      setThreadId(created.id);
      setMessages([]);
      setAttachments([]);
      setHeroDismissed(false);
      qc.invalidateQueries({ queryKey: ["threads"] });
      setDrawerOpen(false);
    }
  }

  const empty = messages.length === 0;
  const showHero = empty && !heroDismissed;
  const lastMsg = messages[messages.length - 1];
  const streamingAssistant = status === "streaming" && lastMsg?.role === "assistant";

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", isFullScreen && "fixed inset-0 z-[60] bg-background")}>
      {/* hidden file inputs */}
      <input ref={pdfInputRef} type="file" accept=".pdf,.docx,.pptx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.currentTarget.value = ""; }} />
      <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f, "image"); e.currentTarget.value = ""; }} />

      {/* Header */}
      {!isFullScreen && (
        <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-5 pb-3 pt-6">
          <button onClick={() => setDrawerOpen(true)} className="grid h-11 w-11 place-items-center rounded-2xl bg-card shadow-card">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1 truncate text-lg font-black">
              Chat with Sana <Sparkles className="h-4 w-4 text-warning" />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-success" />
              {busy ? "Sana is typing…" : "Sana is online and ready to help!"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/notifications" className="relative grid h-11 w-11 place-items-center rounded-2xl bg-card shadow-card">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">3</span>
            </Link>
            <Link to="/profile" className="relative shrink-0">
              <img src={resolvedAvatarUrl} alt="Profile" className="h-11 w-11 rounded-full border-2 border-card object-cover shadow-card" />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-success" />
            </Link>
          </div>
        </header>
      )}

      {/* Study View toggle pill */}
      <div className="shrink-0 border-b border-border/50 bg-background/60 px-4 py-2 backdrop-blur-xl flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleStudyView}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold shadow-card transition",
              studyEnabled
                ? "gradient-primary border-transparent text-white"
                : "border-border bg-card text-foreground hover:border-primary/40",
            )}
            aria-pressed={studyEnabled}
          >
            <BookOpenCheck className="h-3.5 w-3.5" />
            {studyEnabled ? `Notes On · ${STYLE_META[studyStyle].label}` : "Notes Off"}
            {studyEnabled && <ChevronDown className="h-3 w-3" />}
          </button>
          {studyEnabled && (
            <button
              type="button"
              onClick={() => { setStyleFirstTime(false); setStyleSheetOpen(true); }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-muted-foreground shadow-card hover:text-foreground"
            >
              Change Style
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsFullScreen(!isFullScreen)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-bold shadow-card text-foreground hover:border-primary/40 transition"
          aria-label={isFullScreen ? "Exit Full View" : "Full View"}
        >
          {isFullScreen ? (
            <><Minimize className="h-3.5 w-3.5" /> Exit Full View</>
          ) : (
            <><Maximize className="h-3.5 w-3.5" /> Full View</>
          )}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollerRef}
           style={{ scrollPaddingBottom: composerH + 16, paddingBottom: composerH + 16 }}
           className="no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-4 [scroll-behavior:auto]">
        {showHero && <IntroCard onClose={() => setHeroDismissed(true)} name={profile?.displayName ?? "there"} />}

        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const fullText = m.parts?.map(p => p.type === "text" ? p.text : "").join("") ?? (m as any).content ?? "";
          const ytCard = parseYtCard(fullText);
          const docCard = parseDocCard(fullText);
          
          let afterCard = fullText;
          if (ytCard) afterCard = fullText.slice(fullText.indexOf("[[/YT_CARD]]") + "[[/YT_CARD]]".length).trimStart();
          else if (docCard) afterCard = fullText.slice(fullText.indexOf("[[/DOCUMENT_CARD]]") + "[[/DOCUMENT_CARD]]".length).trimStart();

          const ytAttachIds = attachments.filter((a) => a.kind === "youtube").map((a) => a.name);
          const linkVideoId =
            ytCard?.video_id ?? pinned?.videoId ?? (ytAttachIds.length === 1 ? ytAttachIds[0] : null);
          let rendered = m.role === "assistant" ? linkifyTimestamps(afterCard, linkVideoId) : afterCard;
          
          // Clean up attachment strings from user messages for UI
          if (m.role === "user") {
            // Convert images to markdown
            rendered = rendered.replace(/\[Image attached: (.*?) — (https?:\/\/[^\]]+)\]/g, "![Attached Image: $1]($2)");
            // Strip out document attachments (they have their own DocumentCard)
            rendered = rendered.replace(/\[[A-Z]+ attached: (.*?) — (https?:\/\/[^\]]+)\]/g, "");
            rendered = rendered.trim();
          }

          const useNotebook =
            studyEnabled &&
            m.role === "assistant" &&
            !ytCard &&
            !docCard &&
            !(isLast && streamingAssistant) &&
            !!rendered.trim();

          if (useNotebook) {
            // find preceding user question
            const prev = messages[i - 1];
            const userQ =
              prev?.role === "user"
                ? (prev.parts?.map((p) => (p.type === "text" ? p.text : "")).join("") ?? (prev as any).content ?? "")
                : "";
            return (
              <div key={m.id} className="px-1">
                <StudyNoteRenderer
                  messageId={m.id}
                  threadId={threadId}
                  userQuestion={userQ}
                  assistantMarkdown={rendered}
                  style={studyStyle}
                  pageNumber={Math.floor(i / 2) + 1}
                />
                {classroomSources[m.id]?.length ? (
                  <div className="mt-2"><ClassroomCitations sources={classroomSources[m.id]} /></div>
                ) : null}
              </div>
            );
          }

          return (
            <Bubble key={m.id} role={m.role}
                    time={(m as any).createdAt ? new Date((m as any).createdAt) : (isLast ? new Date() : undefined)}>
              {m.role === "assistant" && (ytCard || docCard) ? (
                <div className="flex gap-4">
                  <div className="shrink-0 mt-1 h-8 w-8 rounded-full border border-primary/20 bg-gradient-to-tr from-primary to-lavender flex items-center justify-center text-white overflow-hidden shadow-sm">
                    {profile?.avatarUrl ? <img src={resolvedAvatarUrl} alt="" className="h-full w-full object-cover" /> : <Sparkles className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1 pt-1.5 pb-2">
                    {ytCard && <YouTubeRichCard video={ytCard} onOpenTimeline={(id) => setTimelineFor(id)} />}
                    {docCard && (
                      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card w-full max-w-sm">
                        <div className="flex items-center gap-3 border-b border-border/50 bg-muted/30 px-4 py-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold">{docCard.name}</div>
                            <div className="mt-0.5 flex gap-2 text-xs text-muted-foreground font-medium">
                              <span className="uppercase tracking-wider">{docCard.kind}</span>
                              {docCard.size && <span>•</span>}
                              {docCard.size && <span>{(docCard.size / 1024 / 1024).toFixed(1)} MB</span>}
                            </div>
                          </div>
                          <a href={docCard.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-primary/10 p-2 text-primary hover:bg-primary hover:text-white transition">
                            <Maximize className="h-4 w-4" />
                          </a>
                        </div>
                      </div>
                    )}
                    {rendered && (
                      <SanaMarkdown
                        content={rendered + (isLast && streamingAssistant ? "~~▋~~" : "")}
                        onChip={m.role === "assistant" ? (c) => send(c) : undefined}
                        busy={busy}
                        isLastAssistant={m.role === "assistant" && isLast}
                        streaming={m.role === "assistant" && isLast && streamingAssistant}
                      />
                    )}
                  </div>
                </div>
              ) : (
                rendered && (
                  <SanaMarkdown
                    content={rendered + (isLast && streamingAssistant ? "~~▋~~" : "")}
                    onChip={m.role === "assistant" ? (c) => send(c) : undefined}
                    busy={busy}
                    isLastAssistant={m.role === "assistant" && isLast}
                    streaming={m.role === "assistant" && isLast && streamingAssistant}
                  />
                )
              )}
              {m.role === "assistant" && classroomSources[m.id]?.length ? (
                <ClassroomCitations sources={classroomSources[m.id]} />
              ) : null}
              {m.role === "assistant" && classroomDebug[m.id] ? (
                <ClassroomDebugPanel debug={classroomDebug[m.id]} />
              ) : null}
            </Bubble>
          );
        })}

        {status === "submitted" && lastMsg?.role === "user" && (
          <Bubble role="assistant">
            <div className="flex items-center gap-2 text-[#5f5ce6] font-medium text-[14px] animate-pulse py-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sana is thinking...
            </div>
          </Bubble>
        )}

        {empty && <SuggestedPrompts onPick={send} />}
      </div>

      {/* Sticky composer bar */}
      <div ref={composerRef} className="sticky bottom-0 z-20 shrink-0">

        {/* Classroom retrieval filter */}
        {classroomCourses.length > 0 && (
          <ClassroomFilterBar
            courses={classroomCourses}
            selected={classroomCourseFilter}
            onChange={setClassroomCourseFilter}
          />
        )}

        {/* Focused-section pill */}
        {pinned && attachments.some((a) => a.kind === "youtube" && a.name === pinned.videoId) && (
          <div className="shrink-0 border-t border-primary/20 bg-primary/5 px-4 py-2 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-primary/20">🎯</span>
                <span className="truncate">
                  {fmtDuration(pinned.start_seconds)}–{fmtDuration(pinned.end_seconds)} · {pinned.title}
                </span>
              </span>
              <button
                onClick={() => setTimelineFor(pinned.videoId)}
                className="rounded-full border border-primary/30 bg-card px-2.5 py-1 text-[10px] font-bold text-primary hover:bg-primary/10"
              >
                Change
              </button>
              <button
                onClick={() => setPinned(null)}
                aria-label="Clear focus"
                className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Attachment chips */}
        {(attachments.length > 0 || uploading) && (
          <div className="no-scrollbar shrink-0 overflow-x-auto border-t border-border/60 bg-background/95 px-4 py-2 backdrop-blur-xl">
            <div className="flex min-w-max items-center gap-2">
              {uploading && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground shadow-card">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
                </span>
              )}
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary shadow-card">
                  {a.kind === "pdf" && <FileText className="h-3 w-3" />}
                  {a.kind === "image" && <ImageIcon className="h-3 w-3" />}
                  {a.kind === "youtube" && <Youtube className="h-3 w-3" />}
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                          className="ml-1 grid h-4 w-4 place-items-center rounded-full bg-primary/10 hover:bg-primary/20">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur-xl">
          <form onSubmit={(e) => { e.preventDefault(); send(input); }}
                className="flex items-center gap-2 rounded-full border border-primary/25 bg-card px-1.5 py-1.5 shadow-card">
            <button type="button" onClick={() => setSheetOpen(true)} aria-label="Attachments and tools"
                    className="gradient-primary grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-soft active:scale-95 transition">
              <Plus className="h-5 w-5" />
            </button>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                   placeholder={busy ? "Sana is replying…" : "Ask anything, add files or use tools..."}
                   className="min-w-0 flex-1 bg-transparent px-1 text-sm placeholder:text-muted-foreground focus:outline-none" />
            {busy ? (
              <button type="button" onClick={() => stop()} aria-label="Stop generating"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-soft active:scale-95 transition">
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : input.trim() || attachments.length ? (
              <button type="submit"
                      className="gradient-primary grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-soft active:scale-95 transition">
                <Send className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" className="grid h-11 w-11 shrink-0 place-items-center text-muted-foreground" aria-label="Voice">
                <Mic className="h-5 w-5" />
              </button>
            )}
          </form>
        </div>
      </div>

      <ChatHistoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
                         threads={threads} activeId={threadId}
                         onSelect={(id) => { setThreadId(id); setDrawerOpen(false); setHeroDismissed(true); }}
                         onNew={newChat} avatarUrl={resolvedAvatarUrl}
                         pinnedChats={pinnedChats}
                         onTogglePin={togglePin}
                         onDelete={deleteChat}
                         onShare={shareChat} />

      <ConnectorSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
                      onAction={(prompt) => { setSheetOpen(false); send(prompt); }}
                      onPickPdf={() => { setSheetOpen(false); pdfInputRef.current?.click(); }}
                      onPickImage={() => { setSheetOpen(false); imgInputRef.current?.click(); }}
                      onPickYouTube={() => { setSheetOpen(false); setYtSheetOpen(true); }}
                      onPickClassroom={() => { setSheetOpen(false); setClassroomSheetOpen(true); }} />

      <YouTubeConnectorSheet open={ytSheetOpen} onClose={() => setYtSheetOpen(false)} onReady={handleYouTubeReady} />
      <ClassroomConnectorSheet open={classroomSheetOpen} onClose={() => setClassroomSheetOpen(false)} />

      <StyleBottomSheet
        open={styleSheetOpen}
        onClose={() => { setStyleSheetOpen(false); setStyleFirstTime(false); }}
        currentStyle={studyStyle}
        onPick={pickStyle}
        firstTime={styleFirstTime}
      />

      <YouTubeTimelineSheet
        videoId={timelineFor}
        open={!!timelineFor}
        onClose={() => setTimelineFor(null)}
        pinned={pinned}
        onPick={(section) => {
          setPinned(section);
          if (section) {
            setAttachments((a) => {
              if (a.some((x) => x.kind === "youtube" && x.name === section.videoId)) return a;
              return [
                ...a,
                { id: crypto.randomUUID(), name: section.videoId, url: `https://youtu.be/${section.videoId}`, kind: "youtube" },
              ];
            });
            toast.success(`Focused: ${section.title}`, {
              description: `${fmtDuration(section.start_seconds)}–${fmtDuration(section.end_seconds)}`,
            });
          } else {
            toast.message("Cleared focus — using the full video");
          }
        }}
      />
    </div>
  );
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Bubble({ role, children, time }: { role: string; children: React.ReactNode; time?: Date }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex items-end gap-2", isUser && "justify-end")}>
      {!isUser && (
        <div className="gradient-primary grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black text-white shadow-soft">
          M
        </div>
      )}
      <div className={cn(
        "max-w-[86%] text-sm leading-relaxed",
        isUser
          ? "rounded-2xl rounded-br-md bg-lavender px-4 py-3 text-foreground shadow-card"
          : "min-w-0 flex-1 text-foreground",
      )}>
        <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
        {time && (
          <div className={cn(
            "mt-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground",
            isUser ? "justify-end" : "justify-start",
          )}>
            <span>{fmtTime(time)}</span>
            {isUser && <CheckCheck className="h-3 w-3 text-primary" />}
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay }} className="inline-block h-2 w-2 rounded-full bg-primary" />;
}

function BlinkCaret() {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 0.2, 1] }}
      transition={{ duration: 0.9, repeat: Infinity }}
      className="ml-0.5 inline-block h-3.5 w-[3px] translate-y-0.5 rounded-sm bg-primary align-baseline"
    />
  );
}

function IntroCard({ onClose, name }: { onClose: () => void; name: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[28px] bg-lavender p-5 shadow-card"
    >
      <button onClick={onClose}
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-xl bg-card/80 shadow-card backdrop-blur">
        <X className="h-4 w-4" />
      </button>
      <div className="relative grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <div className="pt-1">
          <div className="text-sm">👋 Hey {name}!</div>
          <h2 className="mt-1 text-2xl font-black leading-none">
            I'm <span className="font-script text-4xl text-primary">Sana</span>
          </h2>
          <p className="mt-3 text-[13px] italic leading-snug text-muted-foreground">
            "The best way to predict your future is to create it." 💜
          </p>
        </div>
        <div className="relative">
          <img src={sanaHero} alt="Sana"
               className="absolute -right-6 -top-4 h-[168px] w-auto object-contain drop-shadow-xl" />
        </div>
      </div>
    </motion.div>
  );
}

function SuggestedPrompts({ onPick }: { onPick: (t: string) => void }) {
  const prompts = [
    "Tomorrow is my Python exam. Help me prepare a plan.",
    "Explain functions in Python with examples",
    "Give me a DBMS revision summary",
    "Create 5 MCQs on Operating Systems",
  ];
  return (
    <div className="pt-2">
      <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Suggested for you
      </div>
      <div className="space-y-2">
        {prompts.map(p => (
          <button key={p} onClick={() => onPick(p)}
                  className="block w-full rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm shadow-card transition hover:border-primary/40">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickTile({ icon, label, sub, to, onClick, disabled, busy }: { icon: React.ReactNode; label: string; sub: string; to?: string; onClick?: () => void; disabled?: boolean; busy?: boolean }) {
  const inner = (
    <div className={cn("flex min-w-[160px] items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2 shadow-card transition", disabled && "opacity-60", busy && "border-primary/40 bg-primary/5")}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-lavender">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-bold">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
  if (to) return <Link to={to}>{inner}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} aria-busy={busy || undefined} aria-label={label}>{inner}</button>;
}

function ChatHistoryDrawer({ open, onClose, threads, activeId, onSelect, onNew, avatarUrl, pinnedChats, onTogglePin, onDelete, onShare }: {
  open: boolean; onClose: () => void;
  threads: { id: string; title: string; last_message_at: string }[];
  activeId: string | null; onSelect: (id: string) => void; onNew: () => void;
  avatarUrl: string;
  pinnedChats: string[];
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (id: string) => void;
}) {
  const grouped = groupThreads(threads);
  if (pinnedChats.length > 0) {
    const pinned = threads.filter(t => pinnedChats.includes(t.id));
    if (pinned.length > 0) {
      grouped.unshift({ label: "Pinned", items: pinned });
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 z-40 bg-black/30 backdrop-blur-md">
          <motion.aside
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="no-scrollbar flex h-full w-[86%] max-w-[340px] flex-col overflow-y-auto bg-background p-4 shadow-glow"
          >
            <div className="flex items-center justify-between">
              <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl bg-card shadow-card"><X className="h-5 w-5" /></button>
              <button onClick={onNew} className="grid h-11 w-11 place-items-center rounded-2xl bg-card shadow-card"><PenSquare className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-card">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
            </div>
            <button onClick={onNew}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-card text-sm font-bold text-primary shadow-card">
              <Plus className="h-4 w-4" /> New Chat
            </button>
            <div className="mt-4 flex-1">
              {grouped.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No conversations yet. Say hi to Sana!
                </div>
              ) : grouped.map((g) => (
                <div key={g.label} className="mb-4">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                  <ul className="space-y-1.5">
                    {g.items.map((t) => (
                      <li key={t.id}>
                        <div role="button" tabIndex={0} onClick={() => onSelect(t.id)}
                                className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl p-2.5 text-left transition cursor-pointer",
                                  activeId === t.id ? "border border-primary/30 bg-primary/5" : "hover:bg-muted")}>
                          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                            activeId === t.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                            <MessageCircle className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{t.title || "New Chat"}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {new Date(t.last_message_at).toLocaleDateString()}
                            </span>
                          </span>
                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-muted/80 text-muted-foreground transition">
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40 rounded-xl shadow-card">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onTogglePin(t.id); }} className="gap-2 text-[12px] font-semibold cursor-pointer">
                                  <Pin className="h-3.5 w-3.5" />
                                  {pinnedChats.includes(t.id) ? "Unpin Chat" : "Pin Chat"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShare(t.id); }} className="gap-2 text-[12px] font-semibold cursor-pointer">
                                  <Share className="h-3.5 w-3.5" />
                                  Share Chat
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(t.id); }} className="gap-2 text-[12px] font-semibold text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer">
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete Chat
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
              <img src={avatarUrl} className="h-10 w-10 rounded-full object-cover" alt="me" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">You</div>
                <div className="text-[11px] text-muted-foreground">🔥 12 Day Streak</div>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function groupThreads(threads: { id: string; title: string; last_message_at: string }[]) {
  const today = new Date(); today.setHours(0,0,0,0);
  const y = new Date(today); y.setDate(y.getDate() - 1);
  const w = new Date(today); w.setDate(w.getDate() - 7);
  const groups: Record<string, typeof threads> = { Today: [], Yesterday: [], "Last Week": [], Older: [] };
  for (const t of threads) {
    const d = new Date(t.last_message_at);
    if (d >= today) groups.Today.push(t);
    else if (d >= y) groups.Yesterday.push(t);
    else if (d >= w) groups["Last Week"].push(t);
    else groups.Older.push(t);
  }
  return Object.entries(groups).filter(([, arr]) => arr.length > 0).map(([label, items]) => ({ label, items }));
}

function ConnectorSheet({ open, onClose, onAction, onPickPdf, onPickImage, onPickYouTube, onPickClassroom }: {
  open: boolean; onClose: () => void; onAction: (prompt: string) => void;
  onPickPdf: () => void; onPickImage: () => void; onPickYouTube: () => void; onPickClassroom: () => void;
}) {
  const attach = [
    { label: "Upload PDF", tint: "bg-primary/10", icon: <FileText className="h-5 w-5 text-primary" />, onClick: onPickPdf },
    { label: "Upload Image", tint: "bg-success/10", icon: <ImageIcon className="h-5 w-5 text-success" />, onClick: onPickImage },
    { label: "YouTube Link", tint: "bg-destructive/10", icon: <Youtube className="h-5 w-5 text-destructive" />, onClick: onPickYouTube },
    { label: "Google Classroom", tint: "bg-warning/10", icon: <GraduationCap className="h-5 w-5 text-warning" />, onClick: onPickClassroom },
    { label: "More Connectors", tint: "bg-blue/10", icon: <Link2 className="h-5 w-5 text-blue" />, onClick: () => toast("More connectors coming soon") },
  ];
  const tools = [
    { label: "Study Roadmap", tint: "bg-primary/10", icon: <Map className="h-5 w-5 text-primary" />,
      prompt: "Create a detailed, week-by-week study roadmap for me. Ask what subject, exam date, and current level if you need to, then produce a checklist I can follow." },
    { label: "Schedule AI Call", tint: "bg-blue/10", icon: <Phone className="h-5 w-5 text-blue" />,
      prompt: "Help me schedule a daily accountability call. Suggest 3 time slots, then a short script of what we'll cover on the call." },
    { label: "Pomodoro Plan", tint: "bg-destructive/10", icon: <Timer className="h-5 w-5 text-destructive" />,
      prompt: "Design a 2-hour Pomodoro study plan (25/5 cycles) for my most important topic today. Include the topic per cycle and a mini review at the end." },
    { label: "Revision Notes", tint: "bg-warning/10", icon: <BookOpen className="h-5 w-5 text-warning" />,
      prompt: "Generate concise, exam-ready revision notes on my current topic. Use bullets, bold key terms, and end with a 5-line summary." },
    { label: "Flashcards", tint: "bg-pink/10", icon: <FileText className="h-5 w-5 text-pink" />,
      prompt: "Create 10 flashcards on my current topic in a Q → A markdown format. Keep answers under 2 lines each." },
    { label: "Quick Quiz", tint: "bg-primary/10", icon: <HelpCircle className="h-5 w-5 text-primary" />,
      prompt: "Give me a 5-question multiple-choice quiz on my current topic. Show only the questions first; wait for my answers before revealing the correct ones." },
  ];
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
                    className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="no-scrollbar absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-[32px] bg-card p-5 pb-6 shadow-glow"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" />
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">What would you like to do?</h3>
              <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-border">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              <div className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                <Paperclip className="h-4 w-4" /> Attach & Connect
              </div>
              <p className="text-xs text-muted-foreground">Add or connect your study resources</p>
              <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                {attach.map(a => (
                  <SheetTile key={a.label} icon={a.icon} tint={a.tint} label={a.label} onClick={a.onClick} />
                ))}
              </div>
            </div>

            <div className="mt-5">
              <div className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                <Sparkles className="h-4 w-4" /> AI Tools
              </div>
              <p className="text-xs text-muted-foreground">Powerful AI tools to boost your learning</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {tools.map(t => (
                  <SheetTile key={t.label} icon={t.icon} tint={t.tint} label={t.label}
                             onClick={() => onAction(t.prompt)} />
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SheetTile({ icon, tint, label, onClick }: { icon: React.ReactNode; tint: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick}
            className="flex min-w-[92px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-3 shadow-card transition active:scale-95">
      <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", tint)}>{icon}</span>
      <span className="text-center text-[10px] font-semibold leading-tight">{label}</span>
    </button>
  );
}

function ClassroomCitations({ sources }: { sources: ClassroomMatch[] }) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Dedupe by document, keep the top-scoring chunk per doc as the preview.
  const uniq: ClassroomMatch[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.documentId)) continue;
    seen.add(s.documentId);
    uniq.push(s);
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="mt-3 overflow-hidden rounded-2xl border border-warning/30 bg-warning/5"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-warning/20 text-warning">
          <GraduationCap className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 text-[11px] font-bold text-warning">
          {uniq.length} classroom source{uniq.length === 1 ? "" : "s"}
        </span>
        <span className="text-[10px] font-semibold text-warning/80">
          {open ? "Hide" : "View"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-warning/20 bg-card/60"
          >
            {uniq.map((s, i) => {
              const isOpen = previewId === s.chunkId;
              const snippet = s.content.trim().replace(/\s+/g, " ").slice(0, 320);
              return (
                <li key={s.chunkId} className="border-t border-border/60 first:border-t-0">
                  <div
                    className="group px-3 py-2.5 transition hover:bg-warning/10"
                    onMouseEnter={() => setPreviewId(s.chunkId)}
                    onMouseLeave={() => setPreviewId((cur) => (cur === s.chunkId ? null : cur))}
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewId((cur) => (cur === s.chunkId ? null : s.chunkId))}
                      className="flex w-full items-start gap-2 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-warning/15 text-[10px] font-black text-warning">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-bold text-foreground">
                          {s.documentTitle || "Untitled"}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {s.courseName ? `${s.courseName} · ` : ""}
                          {Math.round(s.similarity * 100)}% match · chunk #{s.chunkIndex + 1}
                        </span>
                      </span>
                      {s.alternateLink && (
                        <a
                          href={s.alternateLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Open source"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-warning hover:bg-warning/15"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 rounded-xl border border-warning/20 bg-background/80 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                            <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-warning/70">
                              Snippet
                            </span>
                            "{snippet}{s.content.length > snippet.length ? "…" : ""}"
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ClassroomDebugPanel({ debug }: { debug: ClassroomDebug }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="mt-2 overflow-hidden rounded-2xl border border-border bg-muted/40"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Timer className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 truncate text-[11px] font-bold text-muted-foreground">
          Sources & retrieval · {debug.matches.length}/{debug.matchCount} · {debug.totalMs}ms
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground/80">
          {open ? "Hide" : "Debug"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/60"
          >
            <div className="space-y-1 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <div>
                <span className="font-bold text-foreground">Query:</span>{" "}
                <span className="italic">"{debug.query}"</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Stat label="embed" value={`${debug.embedMs}ms`} />
                <Stat label="vector search" value={`${debug.queryMs}ms`} />
                <Stat label="total" value={`${debug.totalMs}ms`} />
                <Stat label="top-k" value={String(debug.matchCount)} />
                <Stat
                  label="filter"
                  value={debug.courseIds?.length ? `${debug.courseIds.length} course${debug.courseIds.length === 1 ? "" : "s"}` : "all"}
                />
              </div>
            </div>
            {debug.matches.length > 0 && (
              <ol className="border-t border-border/60 bg-card/40">
                {debug.matches.map((m, i) => (
                  <li key={m.chunkId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/40 px-3 py-1.5 first:border-t-0 text-[10px]">
                    <span className="grid h-4 w-4 place-items-center rounded bg-muted text-[9px] font-black text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 truncate text-foreground">
                      {m.documentTitle || "Untitled"}
                      {m.courseName ? <span className="text-muted-foreground"> · {m.courseName}</span> : null}
                    </span>
                    <span className="font-mono text-muted-foreground">{m.similarity.toFixed(3)}</span>
                  </li>
                ))}
              </ol>
            )}
            {debug.matches.length === 0 && (
              <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                No matches — the assistant was told to be transparent about this.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-bold text-foreground">{value}</span>
    </span>
  );
}

function ClassroomFilterBar({
  courses,
  selected,
  onChange,
}: {
  courses: { google_course_id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const isAll = selected.length === 0;
  return (
    <div className="shrink-0 flex items-center border-t border-border/60 bg-background/95 pr-2 backdrop-blur-xl">
      <div className="no-scrollbar flex-1 overflow-x-auto px-4 py-2">
        <div className="flex min-w-max items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
            <GraduationCap className="h-3 w-3" /> Ask about
          </span>
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-bold transition",
              isAll
                ? "border-warning/40 bg-warning/15 text-warning"
                : "border-border bg-card text-muted-foreground hover:border-warning/30",
            )}
          >
            All courses
          </button>
          {courses.map((c) => {
            const active = selected.includes(c.google_course_id);
            return (
              <button
                key={c.google_course_id}
                type="button"
                onClick={() => toggle(c.google_course_id)}
                className={cn(
                  "max-w-[160px] truncate rounded-full border px-2.5 py-1 text-[10px] font-bold transition",
                  active
                    ? "border-warning/40 bg-warning/15 text-warning"
                    : "border-border bg-card text-muted-foreground hover:border-warning/30",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
      <button
        onClick={() => setIsVisible(false)}
        className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors mr-1"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}


