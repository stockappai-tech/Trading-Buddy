/**
 * ElevenLabs Text-to-Speech helper
 *
 * Uses the ElevenLabs v1 TTS REST API to synthesize speech.
 * Returns base64-encoded MP3 audio that the client can play directly.
 *
 * Free tier: 10,000 characters/month (enough for personal daily use).
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 */

import { ENV } from "./env";

// Premade ElevenLabs voice IDs (available on all tiers including free)
export const ELEVENLABS_VOICES = {
  // Male voices (confirmed free-tier)
  adam:   "pNInz6obpgDQGcFmaJgB",  // Adam   — deep, dominant American male
  george: "JBFqnCBsd6RMkjVDRZzb",  // George — warm, captivating British male
  // Female voices (confirmed free-tier)
  sarah:  "EXAVITQu4vr4xnSDxMaL",  // Sarah  — mature, reassuring, confident
  laura:  "FGY2WhTYpPnrIDTdsKH5",  // Laura  — enthusiastic, quirky British
} as const;

export type ElevenLabsVoiceId = typeof ELEVENLABS_VOICES[keyof typeof ELEVENLABS_VOICES];

export interface ElevenLabsTtsOptions {
  text: string;
  voiceId: ElevenLabsVoiceId;
  stability?: number;        // 0–1, higher = more consistent (default 0.5)
  similarityBoost?: number;  // 0–1, higher = closer to original voice (default 0.75)
  style?: number;            // 0–1, expressiveness (default 0)
  speakerBoost?: boolean;    // enhance speaker clarity (default true)
}

export interface ElevenLabsTtsResult {
  audioBase64: string;
  error?: never;
}

export interface ElevenLabsTtsError {
  audioBase64?: never;
  error: string;
}

/** Strip markdown symbols so TTS reads clean text */
function cleanText(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

export async function synthesizeSpeech(
  opts: ElevenLabsTtsOptions
): Promise<ElevenLabsTtsResult | ElevenLabsTtsError> {
  const apiKey = ENV.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { error: "ELEVENLABS_API_KEY is not configured" };
  }

  const {
    text,
    voiceId,
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0,
    speakerBoost = true,
  } = opts;

  const clean = cleanText(text);
  if (!clean) return { error: "Empty text after cleaning" };

  // Truncate to 5000 chars (safe limit for a single TTS request)
  const truncated = clean.length > 5000 ? clean.slice(0, 4997) + "..." : clean;

  const payload = {
    text: truncated,
    model_id: "eleven_turbo_v2_5",  // Fast, high-quality, low latency
    voice_settings: {
      stability,
      similarity_boost: similarityBoost,
      style,
      use_speaker_boost: speakerBoost,
    },
  };

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { error: `ElevenLabs TTS error ${response.status}: ${errText.slice(0, 300)}` };
    }

    // Response is raw MP3 bytes — convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const audioBase64 = btoa(binary);

    return { audioBase64 };
  } catch (err) {
    return { error: `ElevenLabs TTS fetch failed: ${String(err)}` };
  }
}
