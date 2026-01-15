#!/usr/bin/env bun
/**
 * PAI Voice Sync v2 - Optimized Voice Cloning
 *
 * Clone ElevenLabs voice to Fish Audio with best practices:
 * - WAV format (lossless quality)
 * - 60-90s of varied PT-BR speech
 * - Multiple prosodic variations (questions, statements, emotions)
 *
 * Based on Fish Audio community best practices:
 * - https://docs.fish.audio/developer-guide/best-practices/voice-cloning
 * - https://github.com/fishaudio/fish-speech/discussions/794
 *
 * Usage:
 *   bun run scripts/voice-sync.ts
 *   bun run scripts/voice-sync.ts --force  # Overwrite existing reference
 *
 * Environment Variables:
 *   ELEVENLABS_API_KEY - Your ElevenLabs API key
 *   ELEVENLABS_VOICE_ID - Voice ID to clone
 *   FISH_AUDIO_URL - Fish Audio API URL (default: http://localhost:8080)
 */

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { pack } from "msgpackr";

// Configuration
const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || "http://localhost:8080";
const REFERENCE_ID = "jessica-voice";

/**
 * Reference text for voice cloning - PT-BR ONLY
 *
 * Best practices applied:
 * - 60-90 seconds of speech (~700-900 characters)
 * - 100% Portuguese Brazilian (preserves accent)
 * - Varied prosody: declaratives, questions, exclamations
 * - Different emotional tones: calm, energetic, thoughtful
 * - Numbers, technical terms, natural conversation
 * - Small pauses between sentences (~0.5s natural)
 */
const REFERENCE_TEXT_PTBR = `Olá Romano! Aqui é a MAI, sua assistente de inteligência artificial.

Hoje é um ótimo dia para programar, não acha? Vamos começar revisando as tarefas pendentes.

Primeira tarefa: precisamos atualizar o módulo de autenticação. São aproximadamente duzentas linhas de código para revisar.

Segunda tarefa: os testes unitários estão falhando no pipeline. Vou investigar o problema agora mesmo!

Terceira tarefa: a documentação do projeto precisa de atenção. Que tal trabalharmos nisso depois do almoço?

Ah, uma observação importante: encontrei três bugs críticos no sistema de notificações. Dois deles já foram corrigidos, mas o terceiro ainda precisa de análise.

Você sabia que o servidor processou mais de quinhentas requisições na última hora? O desempenho está excelente!

Se precisar de ajuda com qualquer coisa, é só me chamar. Estou sempre aqui para ajudar.

Aliás, lembrei de uma coisa: não esqueça de fazer o commit das alterações antes de sair. O repositório precisa estar atualizado.

Pronto para começar? Vamos nessa!`;

/**
 * English reference text (for bilingual support)
 * Used when --bilingual flag is passed
 */
const REFERENCE_TEXT_EN = `Hello Romano! This is MAI, your personal AI assistant.

Today is a great day for coding, don't you think? Let's start by reviewing the pending tasks.

First task: we need to update the authentication module. That's approximately two hundred lines of code to review.

Second task: the unit tests are failing in the pipeline. I'll investigate the issue right now!

Third task: the project documentation needs attention. How about we work on that after lunch?

By the way, I found three critical bugs in the notification system. Two of them have been fixed, but the third one still needs analysis.

Ready to start? Let's go!`;

// Voice settings optimized for cloning (higher similarity)
const VOICE_SETTINGS = {
  stability: 0.65,           // Slightly higher for consistency
  similarity_boost: 0.85,    // Higher to preserve voice characteristics
  style: 0.0,                // Neutral style
  use_speaker_boost: true    // Enhanced speaker clarity
};

interface SyncResult {
  success: boolean;
  message: string;
  audioPath?: string;
  referenceId?: string;
  duration?: number;
}

// Load environment from ~/.env
async function loadEnv(): Promise<void> {
  const envPath = join(homedir(), ".env");
  if (existsSync(envPath)) {
    const content = await Bun.file(envPath).text();
    content.split("\n").forEach(line => {
      const [key, value] = line.split("=");
      if (key && value && !key.startsWith("#")) {
        process.env[key.trim()] = value.trim();
      }
    });
  }
}

// Check if Fish Audio is available
async function checkFishAudio(): Promise<boolean> {
  try {
    const response = await fetch(`${FISH_AUDIO_URL}/v1/health`, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Check if reference already exists
async function referenceExists(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${FISH_AUDIO_URL}/v1/references/list`);
    if (!response.ok) return false;

    const data = await response.arrayBuffer();
    const { unpack } = await import("msgpackr");
    const result = unpack(Buffer.from(data));
    return result.reference_ids?.includes(id) || false;
  } catch {
    return false;
  }
}

// Generate audio sample from ElevenLabs in PCM format
async function generateElevenLabsSample(
  text: string,
  format: "mp3_44100_128" | "pcm_44100" = "pcm_44100"
): Promise<{ audio: ArrayBuffer; format: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }
  if (!voiceId) {
    throw new Error("ELEVENLABS_VOICE_ID not configured");
  }

  console.log(`   Voice ID: ${voiceId}`);
  console.log(`   Format: ${format}`);
  console.log(`   Text length: ${text.length} characters`);

  // ElevenLabs output format
  const outputFormat = format;
  const acceptHeader = format === "pcm_44100" ? "audio/pcm" : "audio/mpeg";

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        "Accept": acceptHeader,
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  return {
    audio: await response.arrayBuffer(),
    format: format === "pcm_44100" ? "pcm" : "mp3"
  };
}

// Convert PCM to WAV (add header)
function pcmToWav(pcmData: ArrayBuffer, sampleRate: number = 44100, channels: number = 1, bitsPerSample: number = 16): ArrayBuffer {
  const pcmLength = pcmData.byteLength;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmLength, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Chunk size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, channels, true); // Channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * channels * bitsPerSample / 8, true); // Byte rate
  view.setUint16(32, channels * bitsPerSample / 8, true); // Block align
  view.setUint16(34, bitsPerSample, true); // Bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmLength, true); // Data size

  // Combine header and PCM data
  const wavBuffer = new Uint8Array(44 + pcmLength);
  wavBuffer.set(new Uint8Array(wavHeader), 0);
  wavBuffer.set(new Uint8Array(pcmData), 44);

  return wavBuffer.buffer;
}

// Save audio to local backup
async function saveLocalBackup(audio: ArrayBuffer, format: string): Promise<string> {
  const voicesDir = join(homedir(), ".config", "pai", "voices");

  if (!existsSync(voicesDir)) {
    mkdirSync(voicesDir, { recursive: true });
  }

  const extension = format === "pcm" ? "wav" : format;
  const audioPath = join(voicesDir, `mai-reference.${extension}`);
  await Bun.write(audioPath, audio);

  return audioPath;
}

// Register voice with Fish Audio
async function registerFishAudioReference(
  id: string,
  audio: ArrayBuffer,
  text: string,
  mimeType: string = "audio/wav"
): Promise<void> {
  console.log(`   Reference ID: "${id}"`);
  console.log(`   Audio size: ${(audio.byteLength / 1024).toFixed(1)} KB`);
  console.log(`   MIME type: ${mimeType}`);

  const extension = mimeType === "audio/wav" ? "wav" : "mp3";
  const formData = new FormData();
  formData.append("id", id);
  formData.append("text", text);
  formData.append("audio", new Blob([audio], { type: mimeType }), `reference.${extension}`);

  const response = await fetch(`${FISH_AUDIO_URL}/v1/references/add`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fish Audio registration failed: ${response.status} - ${error}`);
  }

  const data = await response.arrayBuffer();
  const { unpack } = await import("msgpackr");
  const result = unpack(Buffer.from(data));

  if (!result.success) {
    throw new Error(`Fish Audio registration failed: ${result.message}`);
  }
}

// Delete existing reference
async function deleteReference(id: string): Promise<void> {
  console.log(`   Deleting existing reference "${id}"...`);

  const response = await fetch(`${FISH_AUDIO_URL}/v1/references/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/msgpack" },
    body: pack({ reference_id: id }),
  });

  if (!response.ok && response.status !== 404) {
    console.warn(`   Warning: Could not delete reference: ${response.status}`);
  }
}

// Estimate audio duration from text (rough: ~150 words/minute for PT-BR)
function estimateDuration(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.round((words / 150) * 60); // seconds
}

// Main sync function
async function syncVoice(options: { force: boolean; bilingual: boolean }): Promise<SyncResult> {
  console.log("\n🎙️  PAI Voice Sync v2 - Optimized Cloning");
  console.log("═".repeat(55));

  // Step 1: Load environment
  await loadEnv();

  // Step 2: Check Fish Audio availability
  console.log("\n📡 Checking Fish Audio...");
  const fishAvailable = await checkFishAudio();
  if (!fishAvailable) {
    return {
      success: false,
      message: "Fish Audio is not available. Start it first: ~/.local/share/pai/fish-audio/start-api.sh"
    };
  }
  console.log("   ✅ Fish Audio is online");

  // Step 3: Check if reference already exists
  console.log("\n🔍 Checking existing references...");
  const exists = await referenceExists(REFERENCE_ID);
  if (exists && !options.force) {
    return {
      success: true,
      message: `Reference "${REFERENCE_ID}" already exists. Use --force to overwrite.`,
      referenceId: REFERENCE_ID
    };
  }
  if (exists && options.force) {
    await deleteReference(REFERENCE_ID);
  }

  // Step 4: Prepare text
  const referenceText = options.bilingual
    ? `${REFERENCE_TEXT_PTBR}\n\n${REFERENCE_TEXT_EN}`
    : REFERENCE_TEXT_PTBR;

  const estimatedDuration = estimateDuration(referenceText);

  console.log("\n📝 Reference text prepared:");
  console.log(`   Language: ${options.bilingual ? "PT-BR + EN (bilingual)" : "PT-BR only"}`);
  console.log(`   Characters: ${referenceText.length}`);
  console.log(`   Estimated duration: ~${estimatedDuration}s`);

  // Step 5: Generate ElevenLabs sample (PCM for quality)
  console.log("\n🎤 Generating voice sample from ElevenLabs...");
  console.log("   Using PCM 44.1kHz for lossless quality...");

  let audioResult: { audio: ArrayBuffer; format: string };
  try {
    audioResult = await generateElevenLabsSample(referenceText, "pcm_44100");
    console.log(`   ✅ Generated ${(audioResult.audio.byteLength / 1024).toFixed(1)} KB PCM audio`);
  } catch (error: any) {
    // Fallback to MP3 if PCM fails
    console.log(`   ⚠️ PCM failed, trying MP3...`);
    try {
      audioResult = await generateElevenLabsSample(referenceText, "mp3_44100_128");
      console.log(`   ✅ Generated ${(audioResult.audio.byteLength / 1024).toFixed(1)} KB MP3 audio`);
    } catch (mp3Error: any) {
      return {
        success: false,
        message: `Failed to generate ElevenLabs sample: ${mp3Error.message}`
      };
    }
  }

  // Step 6: Convert PCM to WAV if needed
  let finalAudio = audioResult.audio;
  let mimeType = "audio/mpeg";

  if (audioResult.format === "pcm") {
    console.log("\n🔄 Converting PCM to WAV...");
    finalAudio = pcmToWav(audioResult.audio, 44100, 1, 16);
    mimeType = "audio/wav";
    console.log(`   ✅ WAV file: ${(finalAudio.byteLength / 1024).toFixed(1)} KB`);
  }

  // Step 7: Save local backup
  console.log("\n💾 Saving local backup...");
  const audioPath = await saveLocalBackup(finalAudio, audioResult.format === "pcm" ? "wav" : "mp3");
  console.log(`   ✅ Saved to: ${audioPath}`);

  // Step 8: Register with Fish Audio
  console.log("\n🐟 Registering with Fish Audio...");
  try {
    await registerFishAudioReference(REFERENCE_ID, finalAudio, referenceText, mimeType);
    console.log(`   ✅ Registered as "${REFERENCE_ID}"`);
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to register with Fish Audio: ${error.message}`,
      audioPath
    };
  }

  // Success
  console.log("\n" + "═".repeat(55));
  console.log("✅ Voice sync complete!");
  console.log(`   Reference ID: ${REFERENCE_ID}`);
  console.log(`   Local backup: ${audioPath}`);
  console.log(`   Audio format: ${audioResult.format === "pcm" ? "WAV (lossless)" : "MP3"}`);
  console.log(`   Estimated duration: ~${estimatedDuration}s`);
  console.log("\n💡 Restart voice server to apply changes");

  return {
    success: true,
    message: "Voice successfully synced to Fish Audio",
    audioPath,
    referenceId: REFERENCE_ID,
    duration: estimatedDuration
  };
}

// CLI entry point
const args = process.argv.slice(2);
const options = {
  force: args.includes("--force") || args.includes("-f"),
  bilingual: args.includes("--bilingual") || args.includes("-b")
};

console.log("Options:", options);

syncVoice(options).then(result => {
  if (!result.success) {
    console.error(`\n❌ ${result.message}`);
    process.exit(1);
  }
}).catch(error => {
  console.error(`\n❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
