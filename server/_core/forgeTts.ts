/**
 * Forge TTS Helper — uses the built-in Forge API (OpenAI-compatible /v1/audio/speech)
 *
 * No monthly quota, no external API key needed.
 * Voices: alloy, echo, fable, onyx, nova, shimmer
 * - alloy:   neutral, balanced (good all-purpose)
 * - echo:    warm male
 * - fable:   expressive British male
 * - onyx:    deep authoritative male
 * - nova:    warm, friendly female
 * - shimmer: clear, bright female
 *
 * Docs: https://platform.openai.com/docs/api-reference/audio/createSpeech
 */

import { ENV } from "./env";

export const FORGE_TTS_VOICES = {
  // Male voices
  onyx:   "onyx",    // deep, authoritative — maps to "Adam"
  fable:  "fable",   // warm, expressive British — maps to "George"
  // Female voices
  nova:   "nova",    // warm, friendly — maps to "Sarah"
  shimmer: "shimmer", // clear, bright — maps to "Laura"
  // Extra
  alloy:  "alloy",
  echo:   "echo",
} as const;

export type ForgeTtsVoice = keyof typeof FORGE_TTS_VOICES;

export interface ForgeTtsOptions {
  text: string;
  voice?: ForgeTtsVoice;
  speed?: number; // 0.25–4.0, default 1.0
}

/** Strip markdown so TTS reads clean text */
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

export async function synthesizeSpeechForge(
  opts: ForgeTtsOptions
): Promise<{ audioBase64: string } | { error: string }> {
  const apiKey = ENV.forgeApiKey;
  const baseUrl = ENV.forgeApiUrl
    ? ENV.forgeApiUrl.replace(/\/$/, "")
    : "https://forge.manus.im";

  if (!apiKey) {
    return { error: "Forge API key not configured" };
  }

  const clean = cleanText(opts.text);
  if (!clean) return { error: "Empty text after cleaning" };

  // Truncate to 4096 chars (OpenAI TTS limit)
  const truncated = clean.length > 4096 ? clean.slice(0, 4093) + "..." : clean;

  const payload = {
    model: "tts-1",
    input: truncated,
    voice: opts.voice ?? "nova",
    speed: opts.speed ?? 1.0,
    response_format: "mp3",
  };

  try {
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Forge TTS error ${response.status}: ${errText.slice(0, 300)}` };
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
    return { error: `Forge TTS fetch failed: ${String(err)}` };
  }
}
