/**
 * Google Cloud Text-to-Speech helper
 *
 * Uses the Google Cloud TTS REST API (v1) to synthesize speech.
 * Returns base64-encoded MP3 audio that the client can play directly.
 *
 * Free tier: 1 million characters/month for Neural2 voices.
 * Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 */

import { ENV } from "./env";

export type GoogleTtsVoice =
  | "en-US-Neural2-D"   // Male 1 — deep, authoritative (Sergeant / Expert)
  | "en-US-Neural2-J"   // Male 2 — warm, friendly (Friend)
  | "en-US-Neural2-F"   // Female 1 — clear, professional (Expert female)
  | "en-US-Neural2-H";  // Female 2 — warm, natural (Friend female)

export interface GoogleTtsOptions {
  text: string;
  voice: GoogleTtsVoice;
  speakingRate?: number; // 0.25 – 4.0, default 1.0
  pitch?: number;        // -20.0 – 20.0 semitones, default 0
  volumeGainDb?: number; // -96 – 16 dB, default 0
}

export interface GoogleTtsResult {
  audioBase64: string; // base64-encoded MP3
  error?: never;
}

export interface GoogleTtsError {
  audioBase64?: never;
  error: string;
}

export async function synthesizeSpeech(
  opts: GoogleTtsOptions
): Promise<GoogleTtsResult | GoogleTtsError> {
  const apiKey = ENV.googleTtsApiKey;
  if (!apiKey) {
    return { error: "GOOGLE_TTS_API_KEY is not configured" };
  }

  const { text, voice, speakingRate = 1.0, pitch = 0, volumeGainDb = 0 } = opts;

  // Strip markdown before sending to TTS
  const cleanText = text
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

  // Truncate to 5000 chars (Google TTS limit per request)
  const truncated = cleanText.length > 5000 ? cleanText.slice(0, 4997) + "..." : cleanText;

  const payload = {
    input: { text: truncated },
    voice: {
      languageCode: "en-US",
      name: voice,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate,
      pitch,
      volumeGainDb,
      effectsProfileId: ["headphone-class-device"],
    },
  };

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Google TTS error ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await response.json()) as { audioContent: string };
    return { audioBase64: data.audioContent };
  } catch (err) {
    return { error: `Google TTS fetch failed: ${String(err)}` };
  }
}
