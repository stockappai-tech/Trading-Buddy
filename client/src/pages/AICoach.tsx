import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown, Crown, Mic, MicOff, Square, Volume2, VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CoachMode = "sergeant" | "friend" | "expert";

// ─── Coach mode defines the TONE of the TTS voice ────────────────────────────
// Forge TTS (OpenAI-compatible) — no monthly quota, consistent voices
// Speed is adjusted per mode: Sergeant=1.05 (clipped), Friend=1.0 (natural), Expert=0.95 (measured)
const COACH_INFO: Record<CoachMode, {
  name: string; emoji: string; desc: string;
  accentColor: string; ringColor: string;
}> = {
  sergeant: {
    name: "Tough Sergeant", emoji: "🎖️", desc: "Blunt, direct, holds you accountable",
    accentColor: "#ef4444", ringColor: "rgba(239,68,68,0.35)",
  },
  friend: {
    name: "Supportive Friend", emoji: "🤝", desc: "Warm, encouraging, empathetic",
    accentColor: "#3b82f6", ringColor: "rgba(59,130,246,0.35)",
  },
  expert: {
    name: "Expert Companion", emoji: "📊", desc: "Data-driven, sophisticated analysis",
    accentColor: "#a855f7", ringColor: "rgba(168,85,247,0.35)",
  },
};

export type VoicePersona = "male1" | "male2" | "female1" | "female2";

// CDN URLs for real AI avatar portraits
const AVATAR_URLS: Record<VoicePersona, string> = {
  male1:   "https://d2xsxph8kpxj0f.cloudfront.net/310519663496028460/ABPfAgYoAEjhmeNLtca7tc/avatar-adam-ACVdrEQe4Fj9er94VrLdMP.webp",
  male2:   "https://d2xsxph8kpxj0f.cloudfront.net/310519663496028460/ABPfAgYoAEjhmeNLtca7tc/avatar-george-faEJt7Y4EkdQ6nMrJbUCCK.webp",
  female1: "https://d2xsxph8kpxj0f.cloudfront.net/310519663496028460/ABPfAgYoAEjhmeNLtca7tc/avatar-sarah-kimYRHoUdxY4nASJ2QXpxn.webp",
  female2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663496028460/ABPfAgYoAEjhmeNLtca7tc/avatar-laura-DQiHhFNBdpf5WkERrCHUwf.webp",
};

const VOICE_PERSONAS: Record<VoicePersona, {
  label: string; gender: "M" | "F"; genderLabel: string; desc: string;
  // Fallback browser voice priority list (first match wins)
  voicePriority: string[];
  pitch: number; rate: number;
}> = {
  male1:   { label: "Adam",   gender: "M", genderLabel: "Male",   desc: "Deep, authoritative",  voicePriority: ["Google US English Male", "Microsoft Guy", "Microsoft David", "Alex", "Daniel"], pitch: 0.85, rate: 1.0 },
  male2:   { label: "George", gender: "M", genderLabel: "Male",   desc: "Warm, captivating",    voicePriority: ["Google UK English Male", "Microsoft George", "Microsoft Mark", "Fred", "Ralph"], pitch: 1.0,  rate: 1.0 },
  female1: { label: "Sarah",  gender: "F", genderLabel: "Female", desc: "Mature, reassuring",   voicePriority: ["Google US English Female", "Microsoft Zira", "Microsoft Jenny", "Samantha", "Victoria"], pitch: 1.05, rate: 0.95 },
  female2: { label: "Laura",  gender: "F", genderLabel: "Female", desc: "Enthusiastic, bright", voicePriority: ["Google UK English Female", "Microsoft Hazel", "Microsoft Susan", "Karen", "Moira"], pitch: 1.15, rate: 1.0 },
};

// Maps each persona to the correct Forge TTS (OpenAI neural) voice — gendered.
const PERSONA_TO_FORGE_VOICE: Record<VoicePersona, "onyx" | "fable" | "nova" | "shimmer"> = {
  male1:   "onyx",    // deep, authoritative American male
  male2:   "fable",   // warm, expressive British male
  female1: "nova",    // warm, friendly female
  female2: "shimmer", // clear, bright female
};

/** Fallback: pick the best available browser voice for a persona. */
function pickVoice(persona: VoicePersona): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const cfg = VOICE_PERSONAS[persona];
  for (const priority of cfg.voicePriority) {
    const match = voices.find((v) => v.name.toLowerCase().includes(priority.toLowerCase()));
    if (match) return match;
  }
  const enVoices = voices.filter((v) => v.lang.startsWith("en"));
  if (cfg.gender === "M") {
    const male = enVoices.find((v) => /male|man|guy|david|mark|george|alex|daniel|fred/i.test(v.name));
    if (male) return male;
  } else {
    const female = enVoices.find((v) => /female|woman|zira|samantha|victoria|karen|moira|jenny/i.test(v.name));
    if (female) return female;
  }
  return enVoices[0] ?? voices[0] ?? null;
}

const LS_VOICE_KEY = "tba_coach_voice";

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

// ─── Real Avatar Component ────────────────────────────────────────────────────
function CoachAvatar({
  isSpeaking, isListening, isThinking, coachMode, voicePersona,
}: {
  isSpeaking: boolean; isListening: boolean; isThinking: boolean;
  coachMode: CoachMode; voicePersona: VoicePersona;
}) {
  const info = COACH_INFO[coachMode];
  const voice = VOICE_PERSONAS[voicePersona];
  const avatarUrl = AVATAR_URLS[voicePersona];

  const status = isListening ? "Listening…" : isThinking ? "Thinking…" : isSpeaking ? "Speaking…" : "Ready";
  const statusColor = isListening ? "#ef4444" : (isSpeaking || isThinking) ? info.accentColor : "var(--muted-foreground)";

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      {/* Avatar with animated rings */}
      <div className="relative flex items-center justify-center">
        {/* Outer ping ring — only when active */}
        {(isSpeaking || isListening) && (
          <div
            className="absolute rounded-full"
            style={{
              width: 210, height: 210,
              background: `radial-gradient(circle, ${isListening ? "rgba(239,68,68,0.2)" : info.ringColor} 0%, transparent 70%)`,
              animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
            }}
          />
        )}

        {/* Middle ring */}
        <div
          className="absolute rounded-full transition-all duration-500"
          style={{
            width: 178, height: 178,
            border: `2px solid ${isListening ? "#ef4444" : info.accentColor}`,
            opacity: isSpeaking || isListening ? 0.7 : 0.2,
            animation: isSpeaking ? "pulse 1s ease-in-out infinite" : isListening ? "pulse 0.65s ease-in-out infinite" : "none",
          }}
        />

        {/* Inner ring */}
        <div
          className="absolute rounded-full transition-all duration-500"
          style={{
            width: 148, height: 148,
            border: `2px solid ${isListening ? "#ef4444" : info.accentColor}`,
            opacity: isSpeaking || isListening ? 0.45 : 0.12,
          }}
        />

        {/* Portrait image */}
        <div
          className="relative rounded-full overflow-hidden transition-all duration-300"
          style={{
            width: 128, height: 128,
            boxShadow: isSpeaking
              ? `0 0 50px ${info.accentColor}88, 0 0 100px ${info.accentColor}33`
              : isListening
              ? "0 0 40px rgba(239,68,68,0.6)"
              : `0 0 25px ${info.accentColor}33`,
            border: `3px solid ${isListening ? "#ef4444" : info.accentColor}`,
          }}
        >
          <img
            src={avatarUrl}
            alt={voice.label}
            className="w-full h-full object-cover"
            style={{
              // Subtle scale-up when speaking to simulate "talking"
              transform: isSpeaking ? "scale(1.04)" : "scale(1)",
              transition: "transform 0.3s ease",
              filter: isThinking ? "brightness(0.75) saturate(0.7)" : "brightness(1) saturate(1)",
            }}
          />

          {/* Thinking overlay */}
          {isThinking && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full animate-bounce"
                    style={{ background: info.accentColor, animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Speaking sound bars overlay at bottom */}
          {isSpeaking && (
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-0.5 pb-2 bg-gradient-to-t from-black/60 to-transparent h-12">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 3,
                    background: info.accentColor,
                    animation: `soundBar 0.55s ease-in-out infinite`,
                    animationDelay: `${i * 0.08}s`,
                    height: [8, 14, 20, 24, 20, 14, 8][i],
                  }}
                />
              ))}
            </div>
          )}

          {/* Listening mic indicator */}
          {isListening && (
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-0.5 pb-2 bg-gradient-to-t from-black/60 to-transparent h-12">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="rounded-full bg-red-500"
                  style={{
                    width: 3,
                    animation: `soundBar 0.4s ease-in-out infinite`,
                    animationDelay: `${i * 0.09}s`,
                    height: [10, 16, 22, 16, 10][i],
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Name + status */}
      <div className="text-center">
        <p className="text-base font-semibold text-foreground">
          {voice.label} <span className="text-xs text-muted-foreground font-normal">({voice.genderLabel})</span>
        </p>
        <p className="text-sm mt-0.5 transition-colors duration-300" style={{ color: statusColor }}>
          {status}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AICoach() {
  const [selectedMode, setSelectedMode] = useState<CoachMode>("friend");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [voicePersona, setVoicePersona] = useState<VoicePersona>(() => {
    return (localStorage.getItem(LS_VOICE_KEY) as VoicePersona) ?? "female1";
  });
  const [newsArticles, setNewsArticles] = useState<Array<{
    headline: string; summary: string; url: string; source: string; datetime: number;
  }>>([]);
  const [newsTickerLabel, setNewsTickerLabel] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaRecorderRef = useRef<any>(null);
  const [, navigate] = useLocation();

  const { data: prefs } = trpc.preferences.get.useQuery();
  const ttsMutation = trpc.sessions.tts.useMutation();
  const transcribeMutation = trpc.sessions.transcribe.useMutation();

  const isPremium = prefs?.isPremium || false;

  // ─── Speak ────────────────────────────────────────────────────────────────
  // 1. Starts browser speech synthesis IMMEDIATELY (synchronous) so voice
  //    always plays without waiting — respects the browser's user-gesture window.
  // 2. Simultaneously fires Forge TTS (neural voices) in the background.
  //    If it comes back successfully, the browser speech is cancelled and the
  //    human-sounding neural audio plays instead.
  const speak = useCallback(async (text: string, overridePersona?: VoicePersona) => {
    if (!ttsEnabled || !text.trim()) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();

    const persona = overridePersona ?? voicePersona;
    const clean = stripMarkdown(text);
    const cfg = VOICE_PERSONAS[persona];
    const forgeVoice = PERSONA_TO_FORGE_VOICE[persona];
    const modeSpeed = selectedMode === "sergeant" ? 1.05 : selectedMode === "expert" ? 0.92 : 1.0;

    // ── Step 1: browser speech starts synchronously (always works) ──
    let neuralTookOver = false;
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = pickVoice(persona);
      if (voice) utterance.voice = voice;
      utterance.lang = "en-US";
      utterance.pitch = cfg.pitch;
      utterance.rate = cfg.rate * modeSpeed;
      utterance.volume = 1.0;
      utterance.onend = () => { if (!neuralTookOver) setIsSpeaking(false); };
      utterance.onerror = () => { if (!neuralTookOver) setIsSpeaking(false); };
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    }

    // ── Step 2: try Forge TTS neural audio in the background ──
    try {
      const result = await ttsMutation.mutateAsync({ text: clean, voice: forgeVoice, speed: modeSpeed });
      neuralTookOver = true;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const binary = atob(result.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; };
      audio.play().catch(() => { neuralTookOver = false; });
    } catch {
      // Forge TTS not available — browser speech continues uninterrupted
    }
  }, [ttsEnabled, voicePersona, selectedMode, ttsMutation]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  // ─── Chat mutations ───────────────────────────────────────────────────────
  const chatMutation = trpc.coach.chat.useMutation({
    onSuccess: (data) => {
      setIsThinking(false);
      speak(data.reply);
      // Show news article cards if the coach fetched news for a ticker
      if (data.newsArticles && data.newsArticles.length > 0) {
        setNewsArticles(data.newsArticles);
        setNewsTickerLabel(data.detectedTicker ?? "");
      } else {
        setNewsArticles([]);
        setNewsTickerLabel("");
      }
    },
    onError: (e) => { setIsThinking(false); toast.error(e.message); },
  });

  const freeChatMutation = trpc.coach.freeChat.useMutation({
    onSuccess: (data) => { setIsThinking(false); speak(data.reply); },
    onError: (e) => { setIsThinking(false); toast.error(e.message); },
  });

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    stopSpeaking();
    setIsThinking(true);
    if (isPremium) {
      chatMutation.mutate({ message: text, coachMode: selectedMode });
    } else {
      freeChatMutation.mutate({ message: text });
    }
  }, [isPremium, selectedMode, chatMutation, freeChatMutation, stopSpeaking]);

  // ─── Push-to-talk ─────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    try {
      stopSpeaking();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
        mediaRecorderRef.current = null;

        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size < 1000) return;

        try {
          setIsThinking(true);
          const formData = new FormData();
          formData.append("audio", blob, "coach-question.webm");
          const uploadRes = await fetch("/api/upload-audio", { method: "POST", body: formData });
          if (!uploadRes.ok) throw new Error("Upload failed");
          const { url } = await uploadRes.json() as { url: string };
          const result = await transcribeMutation.mutateAsync({ audioUrl: url });
          if (result.transcript?.trim()) {
            sendMessage(result.transcript.trim());
          } else {
            setIsThinking(false);
          }
        } catch (err: unknown) {
          setIsThinking(false);
          toast.error("Could not understand audio. Please try again.");
          console.warn("Coach mic transcription failed:", err);
        }
      };

      mediaRecorder.start();
      setIsListening(true);
    } catch {
      toast.error("Microphone access denied. Please allow microphone access.");
    }
  }, [stopSpeaking, transcribeMutation, sendMessage]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current) {
      try { (mediaRecorderRef.current as MediaRecorder).stop(); } catch { /* ignore */ }
    }
    setIsListening(false);
  }, []);

  const toggleMic = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => { if (prev) stopSpeaking(); return !prev; });
  }, [stopSpeaking]);

  const handleVoiceChange = (persona: VoicePersona) => {
    setVoicePersona(persona);
    localStorage.setItem(LS_VOICE_KEY, persona);
    stopSpeaking();
    const cfg = VOICE_PERSONAS[persona];
    speak(`Hi, I'm ${cfg.label}. I'll be your trading coach.`, persona);
  };

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        try { (mediaRecorderRef.current as MediaRecorder).stop(); } catch { /* ignore */ }
      }
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, []);

  const currentVoiceCfg = VOICE_PERSONAS[voicePersona];
  const coachInfo = COACH_INFO[selectedMode];

  return (
    <DashboardLayout>
      <style>{`
        @keyframes soundBar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
        @keyframes ping {
          75%, 100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div className="flex flex-col h-[calc(100vh-3rem)]">
        {/* Header */}
        <div className="p-4 border-b border-border bg-card/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{coachInfo.emoji}</span>
              <h1 className="font-bold text-foreground">AI Trading Coach</h1>
              {isPremium && <Badge className="text-xs bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Pro</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {isSpeaking && (
                <Button size="sm" variant="outline" onClick={stopSpeaking}
                  className="h-8 px-3 text-xs border-destructive text-destructive hover:bg-destructive/10 animate-pulse">
                  <Square className="h-3 w-3 mr-1 fill-current" /> Stop
                </Button>
              )}

              {/* Voice picker */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline"
                    className={`h-8 px-2 gap-1 border-border text-xs ${ttsEnabled ? "text-foreground" : "text-muted-foreground"}`}>
                    {ttsEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{currentVoiceCfg.label} ({currentVoiceCfg.genderLabel})</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 bg-popover border-border">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Coach Voice</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border" />
                  {/* Male voices */}
                  <DropdownMenuLabel className="text-xs text-muted-foreground/60 px-2 py-1">Male</DropdownMenuLabel>
                  {(["male1", "male2"] as VoicePersona[]).map((key) => {
                    const cfg = VOICE_PERSONAS[key];
                    return (
                      <DropdownMenuItem key={key} onClick={() => handleVoiceChange(key)}
                        className={`text-sm cursor-pointer ${voicePersona === key ? "bg-accent text-accent-foreground" : ""}`}>
                        <img src={AVATAR_URLS[key]} alt={cfg.label} className="w-7 h-7 rounded-full object-cover mr-2 flex-shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">{cfg.label}</span>
                          <span className="text-muted-foreground text-xs">{cfg.desc}</span>
                        </div>
                        {voicePersona === key && <span className="ml-auto text-primary text-xs">✓</span>}
                      </DropdownMenuItem>
                    );
                  })}
                  {/* Female voices */}
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuLabel className="text-xs text-muted-foreground/60 px-2 py-1">Female</DropdownMenuLabel>
                  {(["female1", "female2"] as VoicePersona[]).map((key) => {
                    const cfg = VOICE_PERSONAS[key];
                    return (
                      <DropdownMenuItem key={key} onClick={() => handleVoiceChange(key)}
                        className={`text-sm cursor-pointer ${voicePersona === key ? "bg-accent text-accent-foreground" : ""}`}>
                        <img src={AVATAR_URLS[key]} alt={cfg.label} className="w-7 h-7 rounded-full object-cover mr-2 flex-shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">{cfg.label}</span>
                          <span className="text-muted-foreground text-xs">{cfg.desc}</span>
                        </div>
                        {voicePersona === key && <span className="ml-auto text-primary text-xs">✓</span>}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem onClick={toggleTts} className="text-sm cursor-pointer text-muted-foreground">
                    {ttsEnabled ? <VolumeX className="h-3.5 w-3.5 mr-2" /> : <Volume2 className="h-3.5 w-3.5 mr-2" />}
                    {ttsEnabled ? "Mute voice" : "Unmute voice"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {!isPremium && (
                <Button size="sm" onClick={() => navigate("/upgrade")} className="h-7 text-xs bg-yellow-500 text-black hover:bg-yellow-400">
                  <Crown className="h-3 w-3 mr-1" /> Upgrade
                </Button>
              )}
            </div>
          </div>

          {/* Coach Mode Selector — Pro only */}
          {isPremium && (
            <div className="flex gap-2 mt-3">
              {(Object.entries(COACH_INFO) as [CoachMode, typeof COACH_INFO[CoachMode]][]).map(([mode, info]) => (
                <button key={mode} onClick={() => setSelectedMode(mode)}
                  className="flex-1 p-2 rounded-lg border text-left transition-all"
                  style={selectedMode === mode
                    ? { borderColor: info.accentColor, backgroundColor: info.accentColor + "18" }
                    : { borderColor: "var(--border)", backgroundColor: "transparent" }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{info.emoji}</span>
                    <span className="text-xs font-semibold text-foreground">{info.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{info.desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center — Real Avatar + Mic Button */}
        <div className="flex-1 flex flex-col items-center justify-center gap-10 px-4">
          <CoachAvatar
            isSpeaking={isSpeaking}
            isListening={isListening}
            isThinking={isThinking}
            coachMode={selectedMode}
            voicePersona={voicePersona}
          />

          {/* Push-to-talk button + stop button */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-5">
              {/* Stop speaking button — always visible when speaking, ghost otherwise */}
              <div className="w-14 flex justify-center">
                {isSpeaking ? (
                  <button
                    onClick={stopSpeaking}
                    className="rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 animate-pulse"
                    style={{
                      width: 52, height: 52,
                      background: "rgba(239,68,68,0.15)",
                      border: "2px solid #ef4444",
                      boxShadow: "0 0 20px rgba(239,68,68,0.4)",
                    }}
                    title="Stop speaking"
                  >
                    <Square className="h-5 w-5 fill-current text-red-500" />
                  </button>
                ) : (
                  <div style={{ width: 52, height: 52 }} />
                )}
              </div>

              {/* Main mic button */}
              <button
                onClick={toggleMic}
                disabled={isThinking}
                className={`relative rounded-full transition-all duration-200 flex items-center justify-center focus:outline-none ${
                  isThinking ? "opacity-40 cursor-not-allowed" : "cursor-pointer active:scale-95"
                }`}
                style={{
                  width: 80, height: 80,
                  background: isListening
                    ? "radial-gradient(circle, rgba(239,68,68,0.3), rgba(239,68,68,0.1))"
                    : `radial-gradient(circle, ${coachInfo.accentColor}33, ${coachInfo.accentColor}11)`,
                  border: `3px solid ${isListening ? "#ef4444" : coachInfo.accentColor}`,
                  boxShadow: isListening
                    ? "0 0 30px rgba(239,68,68,0.5)"
                    : `0 0 20px ${coachInfo.accentColor}44`,
                }}
              >
                {isListening
                  ? <MicOff className="h-8 w-8 text-red-500" />
                  : <Mic className="h-8 w-8" style={{ color: coachInfo.accentColor }} />}
                {isListening && (
                  <span className="absolute inset-0 rounded-full animate-ping"
                    style={{ background: "rgba(239,68,68,0.2)" }} />
                )}
              </button>

              {/* Spacer to balance the layout */}
              <div style={{ width: 52, height: 52 }} />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {isListening ? "Tap to stop recording" : isThinking ? "Processing…" : isSpeaking ? "Tap ■ to stop coach" : "Tap to speak"}
            </p>
          </div>

          {/* News hint */}
          {isPremium && newsArticles.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center max-w-xs italic">
              Try: &ldquo;What&apos;s the latest news on AAPL?&rdquo;
            </p>
          )}

          {!isPremium && (
            <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
              Free tier: basic tips only.{" "}
              <button onClick={() => navigate("/upgrade")} className="underline text-yellow-500">Upgrade to Pro</button>
              {" "}for personalized coaching with your full trade history.
            </p>
          )}

          {/* News article cards — shown after a news voice command */}
          {newsArticles.length > 0 && (
            <div className="w-full max-w-lg px-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Latest News{newsTickerLabel ? ` — ${newsTickerLabel}` : ""}
                </p>
                <button
                  onClick={() => { setNewsArticles([]); setNewsTickerLabel(""); }}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >✕ Clear</button>
              </div>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                {newsArticles.map((article, i) => {
                  const relTime = (() => {
                    const diff = Math.floor(Date.now() / 1000) - article.datetime;
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                    return new Date(article.datetime * 1000).toLocaleDateString();
                  })();
                  return (
                    <a
                      key={i}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg border border-border bg-card/60 hover:bg-card transition-colors p-3 group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                          {article.headline}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{article.source}</span>
                        <span className="text-xs text-muted-foreground/60">{relTime}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
