#!/usr/bin/env bun
/**
 * PAI Multi-Voice Sync - Create multiple voices in parallel
 *
 * Creates 3 new voices from ElevenLabs and registers them in Fish Audio:
 * - George (masculine, mature, warm narration)
 * - Brian (masculine, young, educational)
 * - Charlotte (feminine, expressive, playful)
 */

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || "http://localhost:8080";

// Voice definitions
const VOICES = [
  {
    id: "george-voice",
    name: "George",
    elevenLabsId: "JBFqnCBsd6RMkjVDRZzb",
    description: "Masculine, mature, warm British narration",
    textPTBR: `Olá, meu nome é George. Sou uma voz masculina madura, ideal para narrações e audiobooks.

Deixe-me contar uma história. Era uma vez, em um reino distante, um programador que sonhava em criar a inteligência artificial perfeita.

Ele trabalhava dia e noite, escrevendo código, testando algoritmos, refinando cada detalhe. Eram mais de quinhentas horas de dedicação.

O que ele aprendeu? Que a tecnologia é apenas uma ferramenta. O verdadeiro poder está nas pessoas que a utilizam.

Você está pronto para essa jornada? Eu estarei aqui para guiá-lo, com calma e sabedoria.

Lembre-se: grandes conquistas requerem paciência. Não tenha pressa. Cada passo importa.`,
    textEN: `Hello, my name is George. I'm a mature masculine voice, perfect for narrations and audiobooks.

Let me tell you a story. Once upon a time, in a distant kingdom, there was a programmer who dreamed of creating the perfect artificial intelligence.

He worked day and night, writing code, testing algorithms, refining every detail. Over five hundred hours of dedication.

What did he learn? That technology is just a tool. The true power lies in the people who use it.

Are you ready for this journey? I will be here to guide you, with calm and wisdom.`
  },
  {
    id: "brian-voice",
    name: "Brian",
    elevenLabsId: "nPczCjzI2devNBz1zQrb",
    description: "Masculine, young, clear and educational",
    textPTBR: `Ei! Aqui é o Brian. Minha especialidade é explicar coisas de forma clara e objetiva.

Vamos aprender algo novo hoje? Primeiro, deixa eu te explicar como funciona esse sistema.

Passo um: você faz uma pergunta. Passo dois: eu processo a informação. Passo três: você recebe a resposta!

É simples assim. Nada de complicação. Direto ao ponto, como deve ser.

Você sabia que o cérebro humano processa cerca de setenta mil pensamentos por dia? Incrível, não é?

Agora, vamos praticar? Me faça uma pergunta sobre qualquer assunto. Estou pronto para ajudar!

Lembre-se: não existe pergunta boba. Toda curiosidade é válida. Vamos lá!`,
    textEN: `Hey! This is Brian. My specialty is explaining things clearly and objectively.

Shall we learn something new today? First, let me explain how this system works.

Step one: you ask a question. Step two: I process the information. Step three: you get the answer!

It's that simple. No complications. Straight to the point, as it should be.

Did you know that the human brain processes about seventy thousand thoughts per day? Amazing, right?

Now, shall we practice? Ask me a question about any subject. I'm ready to help!`
  },
  {
    id: "charlotte-voice",
    name: "Charlotte",
    elevenLabsId: "XB0fDUnXU5powFXDhCwa",
    description: "Feminine, expressive, playful character voice",
    textPTBR: `Oiii! Eu sou a Charlotte! Que bom te ver por aqui!

Sabe o que eu mais amo? Conversar! Adoro conhecer pessoas novas e trocar ideias.

Ah, você quer saber um segredo? Eu tenho uma energia contagiante! Pelo menos é o que dizem.

Vamos fazer algo divertido? Tipo... hmm... que tal inventar uma história juntos?

Eu começo: Era uma vez uma programadora muito curiosa que descobriu um mundo mágico dentro do computador!

Agora é sua vez! O que acontece depois? Estou super curiosa!

Aliás, você reparou como o dia está lindo hoje? Perfeito para criar coisas incríveis!`,
    textEN: `Hiiii! I'm Charlotte! So nice to see you here!

You know what I love the most? Chatting! I love meeting new people and exchanging ideas.

Oh, you want to know a secret? I have a contagious energy! At least that's what they say.

Shall we do something fun? Like... hmm... how about we make up a story together?

I'll start: Once upon a time, there was a very curious programmer who discovered a magical world inside the computer!

Now it's your turn! What happens next? I'm super curious!`
  }
];

// Voice settings optimized for cloning
const VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.85,
  style: 0.0,
  use_speaker_boost: true
};

// Load environment
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

// Check Fish Audio
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

// Check if reference exists
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

// Generate audio from ElevenLabs (MP3 format for free tier)
async function generateElevenLabsSample(
  voiceId: string,
  text: string
): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  return response.arrayBuffer();
}

// Convert PCM to WAV
function pcmToWav(pcmData: ArrayBuffer): ArrayBuffer {
  const pcmLength = pcmData.byteLength;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmLength, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmLength, true);

  const wavBuffer = new Uint8Array(44 + pcmLength);
  wavBuffer.set(new Uint8Array(wavHeader), 0);
  wavBuffer.set(new Uint8Array(pcmData), 44);

  return wavBuffer.buffer;
}

// Register voice with Fish Audio (WAV)
async function registerVoice(
  id: string,
  audio: ArrayBuffer,
  text: string
): Promise<void> {
  const formData = new FormData();
  formData.append("id", id);
  formData.append("text", text);
  formData.append("audio", new Blob([audio], { type: "audio/wav" }), "reference.wav");

  const response = await fetch(`${FISH_AUDIO_URL}/v1/references/add`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fish Audio registration failed: ${response.status} - ${error}`);
  }
}

// Register voice with Fish Audio (MP3)
async function registerVoiceMp3(
  id: string,
  audio: ArrayBuffer,
  text: string
): Promise<void> {
  const formData = new FormData();
  formData.append("id", id);
  formData.append("text", text);
  formData.append("audio", new Blob([audio], { type: "audio/mpeg" }), "reference.mp3");

  const response = await fetch(`${FISH_AUDIO_URL}/v1/references/add`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fish Audio registration failed: ${response.status} - ${error}`);
  }
}

// Save local backup (WAV)
async function saveBackup(id: string, audio: ArrayBuffer): Promise<string> {
  const voicesDir = join(homedir(), ".config", "pai", "voices");
  if (!existsSync(voicesDir)) {
    mkdirSync(voicesDir, { recursive: true });
  }
  const audioPath = join(voicesDir, `${id}.wav`);
  await Bun.write(audioPath, audio);
  return audioPath;
}

// Save local backup (MP3)
async function saveBackupMp3(id: string, audio: ArrayBuffer): Promise<string> {
  const voicesDir = join(homedir(), ".config", "pai", "voices");
  if (!existsSync(voicesDir)) {
    mkdirSync(voicesDir, { recursive: true });
  }
  const audioPath = join(voicesDir, `${id}.mp3`);
  await Bun.write(audioPath, audio);
  return audioPath;
}

// Create a single voice
async function createVoice(voice: typeof VOICES[0]): Promise<{ success: boolean; message: string }> {
  const startTime = Date.now();
  console.log(`\n🎤 Creating voice: ${voice.name} (${voice.id})`);
  console.log(`   ElevenLabs ID: ${voice.elevenLabsId}`);
  console.log(`   Description: ${voice.description}`);

  try {
    // Check if exists
    const exists = await referenceExists(voice.id);
    if (exists) {
      console.log(`   ⚠️  Voice already exists, skipping...`);
      return { success: true, message: `${voice.name} already exists` };
    }

    // Generate bilingual text
    const fullText = `${voice.textPTBR}\n\n${voice.textEN}`;
    console.log(`   📝 Text: ${fullText.length} characters (bilingual)`);

    // Generate audio from ElevenLabs (MP3)
    console.log(`   🔊 Generating audio from ElevenLabs...`);
    const mp3Audio = await generateElevenLabsSample(voice.elevenLabsId, fullText);
    console.log(`   ✅ Generated ${(mp3Audio.byteLength / 1024).toFixed(1)} KB MP3`);

    // Save backup
    const backupPath = await saveBackupMp3(voice.id, mp3Audio);
    console.log(`   💾 Backup: ${backupPath}`);

    // Register with Fish Audio (MP3 format)
    console.log(`   🐟 Registering with Fish Audio...`);
    await registerVoiceMp3(voice.id, mp3Audio, fullText);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ ${voice.name} created successfully! (${duration}s)`);

    return { success: true, message: `${voice.name} created` };
  } catch (error: any) {
    console.error(`   ❌ Failed: ${error.message}`);
    return { success: false, message: `${voice.name} failed: ${error.message}` };
  }
}

// Main function
async function main() {
  console.log("\n🎙️  PAI Multi-Voice Sync");
  console.log("═".repeat(55));
  console.log("Creating 3 new voices: George, Brian, Charlotte");

  // Load environment
  await loadEnv();

  // Check API key
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("\n❌ ELEVENLABS_API_KEY not found in ~/.env");
    process.exit(1);
  }

  // Check Fish Audio
  console.log("\n📡 Checking Fish Audio...");
  const fishOk = await checkFishAudio();
  if (!fishOk) {
    console.error("❌ Fish Audio is not available");
    process.exit(1);
  }
  console.log("   ✅ Fish Audio online");

  // Create voices in parallel
  console.log("\n🚀 Creating voices in parallel...");
  const results = await Promise.all(VOICES.map(createVoice));

  // Summary
  console.log("\n" + "═".repeat(55));
  console.log("📊 Summary:");
  results.forEach((r, i) => {
    const icon = r.success ? "✅" : "❌";
    console.log(`   ${icon} ${VOICES[i].name}: ${r.message}`);
  });

  const successCount = results.filter(r => r.success).length;
  console.log(`\n🎉 ${successCount}/${VOICES.length} voices created successfully!`);

  // List all voices
  console.log("\n📢 Available voices:");
  try {
    const response = await fetch(`${FISH_AUDIO_URL}/v1/references/list`);
    const data = await response.arrayBuffer();
    const { unpack } = await import("msgpackr");
    const result = unpack(Buffer.from(data));
    result.reference_ids?.forEach((id: string) => {
      console.log(`   • ${id}`);
    });
  } catch {}

  console.log("\n💡 Restart the OpenAI wrapper to use new voices");
}

main().catch(console.error);
