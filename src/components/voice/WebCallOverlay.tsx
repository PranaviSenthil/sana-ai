import React, { useEffect, useState, useRef } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Clock,
  MessageSquare,
  Sparkles,
  X,
  Send,
  Bell,
  CheckCircle2,
  Globe,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import sanaAvatar from "@/assets/sana-avatar.png";
import replyAvatar from "@/assets/reply-avatar.png";
import {
  startWebCall,
  processUserResponseIntent,
  executeRescheduleReminder,
  setAudioSpeakerMuted,
  type CallStatus,
  type WebCallConfig,
  type VoiceConversationState,
} from "@/lib/vapi-client";
import { toast } from "sonner";

export interface WebCallOverlayProps {
  isOpen: boolean;
  config: WebCallConfig | null;
  onClose: () => void;
  onRescheduled?: (newTime: string, mins: number) => void;
}

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ta", label: "தமிழ்", flag: "🇮🇳" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "auto", label: "Auto", flag: "🌐" },
];

export function WebCallOverlay({
  isOpen,
  config,
  onClose,
  onRescheduled,
}: WebCallOverlayProps) {
  const [callStatus, setCallStatus] = useState<"incoming" | "active" | "ended">("incoming");
  const [voiceState, setVoiceState] = useState<VoiceConversationState>("idle");
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(config?.language || "en");
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMessageBox, setShowMessageBox] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [transcripts, setTranscripts] = useState<Array<{ role: "assistant" | "user"; text: string }>>([]);

  const stopCallRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Default reminder info fallback
  const userName = config?.userName || "";
  const title = config?.reminderTitle || "DBMS Study Session";
  const topic = config?.topic || "Functions & Modules Revision";

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setCallStatus("incoming");
      setVoiceState("idle");
      setCallSeconds(0);
      setTranscripts([]);
      setShowSnoozeMenu(false);
      setShowMessageBox(false);
      setShowLangMenu(false);
      setSelectedLanguage(config?.language || "en");
      startRingtone();
    } else {
      stopRingtone();
      setVoiceState("idle");
      if (stopCallRef.current) {
        stopCallRef.current();
        stopCallRef.current = null;
      }
    }
    return () => {
      stopRingtone();
    };
  }, [isOpen]);

  // Call timer effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (callStatus === "active") {
      interval = setInterval(() => {
        setCallSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  // Web Audio Ringtone Generator (440Hz + 480Hz US Standard Phone Ring Cadence)
  const startRingtone = () => {
    stopRingtone();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      audioCtxRef.current = new AudioCtx();

      const playRingBurst = () => {
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") return;
        const ctx = audioCtxRef.current;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(480, ctx.currentTime);

        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 1.8);
        osc2.stop(ctx.currentTime + 1.8);
      };

      playRingBurst();
      ringtoneTimerRef.current = setInterval(playRingBurst, 3000);
    } catch (e) {
      console.warn("Could not play ringtone audio:", e);
    }
  };

  const stopRingtone = () => {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
  };

  const handleToggleSpeaker = () => {
    const next = !isSpeakerOn;
    setIsSpeakerOn(next);
    setAudioSpeakerMuted(!next);
  };

  // Accept Call Handler
  const handleAccept = async () => {
    stopRingtone();
    setCallStatus("active");

    const activeConfig: WebCallConfig = {
      ...(config || { reminderTitle: title }),
      language: selectedLanguage,
    };

    const stopFn = await startWebCall(activeConfig, {
      onStatusChange: (status: CallStatus) => {
        if (status === "ended") {
          setCallStatus("ended");
          setVoiceState("idle");
          setTimeout(() => onClose(), 1500);
        }
      },
      onVoiceStateChange: (state) => {
        setVoiceState(state);
      },
      onVolumeChange: (vol) => setVolumeLevel(vol),
      onTranscript: (role, text) => {
        setTranscripts((prev) => [...prev.slice(-6), { role, text }]);
      },
      onRescheduled: (newTime, mins) => {
        toast.success(`Reminder rescheduled for ${newTime} (${mins}m delay)`);
        onRescheduled?.(newTime, mins);
      },
      onError: (err) => {
        console.error("Web Call Error:", err);
      },
    });

    stopCallRef.current = stopFn;
  };

  // Decline Call Handler
  const handleDecline = () => {
    stopRingtone();
    if (stopCallRef.current) {
      stopCallRef.current();
      stopCallRef.current = null;
    }
    setCallStatus("ended");
    setTimeout(() => onClose(), 300);
  };

  // Quick Snooze / Remind Me Handler
  const handleSnooze = async (minutes: number) => {
    stopRingtone();
    try {
      const activeConfig: WebCallConfig = {
        ...(config || { reminderTitle: title }),
        language: selectedLanguage,
      };
      const formatted = await executeRescheduleReminder(config?.reminderId, minutes, activeConfig);
      toast.success(`Call snoozed. Sana will call you back at ${formatted}`);
      onRescheduled?.(formatted, minutes);
    } catch (err) {
      console.error("Failed to snooze reminder:", err);
      toast.error("Failed to reschedule reminder");
    }
    onClose();
  };

  // Custom Quick Message Handler
  const handleSendMessage = () => {
    if (!customMessage.trim()) return;
    stopRingtone();
    const msg = customMessage.trim();
    setCustomMessage("");
    setShowMessageBox(false);

    const activeConfig: WebCallConfig = {
      ...(config || { reminderTitle: title }),
      language: selectedLanguage,
    };

    // Process user text message as intent
    processUserResponseIntent(msg, activeConfig, {
      onTranscript: (role, text) => {
        setTranscripts((prev) => [...prev, { role, text }]);
      },
      onRescheduled: (newTime, mins) => {
        toast.success(`Reminder rescheduled for ${newTime}`);
        onRescheduled?.(newTime, mins);
      },
    });

    toast.success("Message sent to Sana");
    setTimeout(() => onClose(), 2000);
  };

  if (!isOpen) return null;

  const formattedCallTimer = `${Math.floor(callSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(callSeconds % 60).toString().padStart(2, "0")}`;

  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-between overflow-hidden bg-[#090714] text-white select-none animate-in fade-in duration-300">
      {/* Background radial atmosphere & glows */}
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(109, 74, 255, 0.25), transparent 60%), radial-gradient(circle at 50% 80%, rgba(236, 72, 153, 0.15), transparent 50%)",
        }}
      />

      {/* Top Mobile Status Header with Multilingual Language Selector */}
      <div className="relative z-20 flex w-full max-w-md items-center justify-between px-6 pt-5">
        <span className="text-xs font-bold tracking-widest text-slate-300">
          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>

        {/* Multilingual Selector Pill */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur-md border border-white/15 hover:bg-white/20 transition active:scale-95"
            title="Change voice language"
          >
            <Globe className="h-3 w-3 text-purple-400" />
            <span>{currentLangObj.flag} {currentLangObj.label}</span>
            <ChevronDown className="h-2.5 w-2.5 text-slate-400" />
          </button>

          {showLangMenu && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 w-36 rounded-xl border border-white/15 bg-slate-900/95 py-1 backdrop-blur-2xl shadow-2xl animate-in fade-in zoom-in-95">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setSelectedLanguage(lang.code);
                    setShowLangMenu(false);
                    toast.success(`Language set to ${lang.label}`);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-xs text-left transition hover:bg-purple-600/30",
                    selectedLanguage === lang.code ? "font-bold text-purple-300" : "text-slate-300"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{lang.flag}</span>
                    <span>{lang.label}</span>
                  </span>
                  {selectedLanguage === lang.code && <CheckCircle2 className="h-3 w-3 text-purple-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur-md">
          <Sparkles className="h-3 w-3 text-purple-400 animate-pulse" />
          <span>Sana AI</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center w-full max-w-md">
        {/* Status Indicator */}
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-sm font-semibold tracking-wider uppercase text-purple-300/80 animate-pulse">
            {callStatus === "incoming"
              ? "Incoming call..."
              : callStatus === "active"
              ? `Connected · ${formattedCallTimer}`
              : "Call ended"}
          </p>
          {callStatus === "active" && (
            <div className="animate-in fade-in zoom-in-95 duration-200">
              {voiceState === "speaking" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-200 border border-purple-400/30 text-[11px] font-semibold">
                  <Volume2 className="h-3.5 w-3.5 text-purple-300 animate-pulse" />
                  Sana is speaking...
                </span>
              )}
              {voiceState === "listening" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[11px] font-semibold animate-pulse">
                  <Mic className="h-3.5 w-3.5 text-emerald-400 animate-bounce" />
                  Listening to you... (Speak now)
                </span>
              )}
              {voiceState === "thinking" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/20 text-pink-300 border border-pink-400/30 text-[11px] font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-pink-400 animate-spin" />
                  Sana is thinking...
                </span>
              )}
              {voiceState === "idle" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 text-[11px] font-medium">
                  Live AI Voice Call
                </span>
              )}
            </div>
          )}
        </div>

        {/* Caller Name & Subtitle */}
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white flex items-center justify-center gap-2">
          Sana AI <span className="text-pink-500 text-2xl">💕</span>
        </h1>
        <p className="mt-1 text-xs font-medium text-purple-200/70">
          Your AI Study Companion
        </p>

        {/* Avatar Container with Sound Wave & Concentric Glowing Rings */}
        <div className="relative my-8 flex items-center justify-center">
          {/* Flanking Audio Equalizer Waves */}
          <div className="absolute inset-x-0 flex items-center justify-between px-2 pointer-events-none opacity-40">
            <div className="flex items-end gap-1 h-12">
              {[40, 70, 30, 90, 60, 100, 50, 80].map((h, i) => (
                <span
                  key={i}
                  className="w-1 bg-purple-400/80 rounded-full transition-all duration-300"
                  style={{
                    height: `${callStatus === "incoming" ? h * 0.6 : Math.max(15, volumeLevel * h * 1.5)}%`,
                    animation: callStatus === "incoming" ? `pulse 1.2s infinite ${i * 0.15}s` : "none",
                  }}
                />
              ))}
            </div>
            <div className="flex items-end gap-1 h-12">
              {[80, 50, 100, 60, 90, 30, 70, 40].map((h, i) => (
                <span
                  key={i}
                  className="w-1 bg-pink-400/80 rounded-full transition-all duration-300"
                  style={{
                    height: `${callStatus === "incoming" ? h * 0.6 : Math.max(15, volumeLevel * h * 1.5)}%`,
                    animation: callStatus === "incoming" ? `pulse 1.2s infinite ${i * 0.15}s` : "none",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Concentric Glowing Pulse Rings */}
          <div
            className={cn(
              "absolute h-48 w-48 rounded-full bg-purple-600/20 blur-xl transition-all duration-500",
              callStatus === "incoming" && "animate-ping opacity-75"
            )}
          />
          <div className="absolute h-44 w-44 rounded-full border border-purple-500/30 bg-purple-500/10 animate-pulse" />
          <div className="absolute h-38 w-38 rounded-full border border-pink-500/40" />

          {/* Central Avatar Image */}
          <div className="relative h-32 w-32 overflow-hidden rounded-full border-4 border-purple-400/30 shadow-[0_0_50px_rgba(168,85,247,0.4)]">
            <img
              src={sanaAvatar || replyAvatar}
              alt="Sana AI Avatar"
              className="h-full w-full object-cover scale-105"
            />
          </div>
        </div>

        {/* Dynamic Prompt Speech Card (Matching Design Reference) */}
        {callStatus === "incoming" && (
          <div className="w-full rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl shadow-2xl transition-all animate-in slide-in-from-bottom-3 duration-300">
            <div className="flex items-start gap-3 text-left">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-purple-500/20 text-purple-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-purple-200">
                  {selectedLanguage === "ta" ? "வணக்கம்! 👋" : selectedLanguage === "hi" ? "नमस्ते! 👋" : "Hey there! 👋"}
                </div>
                <div className="mt-0.5 text-xs text-slate-300 leading-snug">
                  {selectedLanguage === "ta" ? (
                    <>உங்கள் <span className="font-semibold text-white">{title}</span> படிப்பு நேரம் வந்துவிட்டது. தயாரா?</>
                  ) : selectedLanguage === "hi" ? (
                    <>आपकी <span className="font-semibold text-white">{title}</span> पढ़ाई का समय हो गया है। क्या आप तैयार हैं?</>
                  ) : (
                    <>Time to continue your <span className="font-semibold text-white">{title}</span> session. Ready?</>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Call Live Transcripts Display */}
        {callStatus === "active" && (
          <div className="w-full max-h-36 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-md space-y-2 text-left text-xs">
            {transcripts.length === 0 ? (
              <p className="text-center text-slate-400 italic py-2">
                Listening to Sana AI voice...
              </p>
            ) : (
              transcripts.map((t, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "p-2 rounded-xl text-xs max-w-[85%]",
                    t.role === "assistant"
                      ? "bg-purple-600/30 text-purple-100 self-start border border-purple-500/20"
                      : "bg-pink-600/30 text-pink-100 ml-auto border border-pink-500/20"
                  )}
                >
                  <span className="font-bold block text-[10px] text-purple-300 uppercase mb-0.5">
                    {t.role === "assistant" ? "Sana AI" : "You"}
                  </span>
                  {t.text}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Controls Area */}
      <div className="relative z-10 w-full max-w-md px-8 pb-10">
        {callStatus === "incoming" ? (
          <div className="space-y-6">
            {/* Upper Action Bar: Remind Me & Message */}
            <div className="flex items-center justify-around px-4">
              <button
                onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                className="flex flex-col items-center gap-1.5 text-slate-300 transition-transform active:scale-90"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                <span className="text-[11px] font-medium">Remind Me</span>
              </button>

              <button
                onClick={() => setShowMessageBox(!showMessageBox)}
                className="flex flex-col items-center gap-1.5 text-slate-300 transition-transform active:scale-90"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20">
                  <MessageSquare className="h-5 w-5 text-white" />
                </div>
                <span className="text-[11px] font-medium">Message</span>
              </button>
            </div>

            {/* Main Phone Call Buttons: Decline (Red) & Accept (Green) */}
            <div className="flex items-center justify-between px-6">
              {/* Decline Button */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleDecline}
                  className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-[0_0_30px_rgba(220,38,38,0.5)] transition-transform active:scale-90 hover:bg-red-500"
                  aria-label="Decline Call"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
                <span className="text-xs font-semibold text-slate-300">
                  Decline
                </span>
              </div>

              {/* Accept Button */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleAccept}
                  className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.6)] transition-transform active:scale-90 hover:bg-emerald-400 animate-bounce"
                  aria-label="Accept Call"
                >
                  <Phone className="h-7 w-7" />
                </button>
                <span className="text-xs font-semibold text-slate-300">
                  Accept
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Active Call Controls */
          <div className="flex items-center justify-around px-4">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={cn(
                "grid h-14 w-14 place-items-center rounded-full backdrop-blur-md transition-all active:scale-90",
                isMuted ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-white/10 text-white hover:bg-white/20"
              )}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>

            <button
              onClick={handleDecline}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-[0_0_30px_rgba(220,38,38,0.5)] transition-transform active:scale-90 hover:bg-red-500"
            >
              <PhoneOff className="h-7 w-7" />
            </button>

            <button
              onClick={handleToggleSpeaker}
              className={cn(
                "grid h-14 w-14 place-items-center rounded-full backdrop-blur-md transition-all active:scale-90",
                !isSpeakerOn ? "bg-slate-700 text-slate-400" : "bg-white/10 text-white hover:bg-white/20"
              )}
            >
              {isSpeakerOn ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
            </button>
          </div>
        )}
      </div>

      {/* Quick Snooze Popover Modal */}
      {showSnoozeMenu && (
        <div className="absolute inset-x-6 bottom-32 z-20 rounded-2xl border border-white/15 bg-slate-900/90 p-4 backdrop-blur-2xl animate-in slide-in-from-bottom-4 shadow-2xl">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
            <span className="text-xs font-bold text-purple-300">Remind Me Later</span>
            <button onClick={() => setShowSnoozeMenu(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[15, 30, 60].map((mins) => (
              <button
                key={mins}
                onClick={() => handleSnooze(mins)}
                className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 py-2.5 hover:bg-purple-600/30 hover:border-purple-400 transition"
              >
                <Bell className="h-4 w-4 text-purple-400 mb-1" />
                <span className="text-xs font-bold text-white">{mins} mins</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Message Reply Modal */}
      {showMessageBox && (
        <div className="absolute inset-x-6 bottom-32 z-20 rounded-2xl border border-white/15 bg-slate-900/90 p-4 backdrop-blur-2xl animate-in slide-in-from-bottom-4 shadow-2xl">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
            <span className="text-xs font-bold text-pink-300">Quick Text Reply</span>
            <button onClick={() => setShowMessageBox(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="e.g. Call me in 15 mins, I'm busy"
                className="flex-1 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-pink-500 placeholder:text-slate-400"
              />
              <button
                onClick={handleSendMessage}
                className="grid h-9 w-9 place-items-center rounded-xl bg-pink-600 text-white hover:bg-pink-500"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Call me in 15m", "I'm busy now", "I'm outside", "I'll study now"].map((txt) => (
                <button
                  key={txt}
                  onClick={() => {
                    setCustomMessage(txt);
                  }}
                  className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/15"
                >
                  {txt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
