import { ArrowLeft, Users } from "lucide-react";

interface EmbeddedMeetingProps {
  roomUrl: string;
  onLeave: () => void;
  onEnd?: () => void;
  isCreator?: boolean;
  participantCount: number;
}

export function EmbeddedMeeting({ roomUrl, onLeave, onEnd, isCreator, participantCount }: EmbeddedMeetingProps) {
  // Add config params to skip prejoin page and deep linking
  const iframeUrl = roomUrl.includes("#") 
    ? `${roomUrl}&config.disableDeepLinking=true&config.prejoinPageEnabled=false` 
    : `${roomUrl}#config.disableDeepLinking=true&config.prejoinPageEnabled=false`;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black overflow-hidden animate-in fade-in duration-300">
      <div className="flex items-center justify-between px-5 py-3.5 bg-[#1c1c1e] text-white border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onLeave}
            className="flex items-center gap-2 text-[14px] font-semibold text-gray-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Return to Chat
          </button>
          {isCreator && onEnd && (
            <button 
              onClick={onEnd}
              className="flex items-center gap-2 text-[14px] font-bold text-red-500 hover:text-red-400 transition-colors bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl border border-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              End Session for Everyone
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-[#6366f1]/20 border border-[#6366f1]/30 px-3 py-1.5 rounded-full mr-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[12px] font-bold text-[#a5b4fc]">Live Session</span>
            </div>
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full">
                <Users className="h-4 w-4 text-gray-300" aria-hidden="true" />
                <span className="text-[12px] font-semibold text-gray-200">{participantCount} Joined</span>
            </div>
        </div>
      </div>
      <div className="flex-1 w-full bg-black relative">
        <iframe
          src={iframeUrl}
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          className="w-full h-full border-none absolute inset-0"
        />
      </div>
    </div>
  );
}
