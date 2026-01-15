#!/usr/bin/env bun
/**
 * PAI Voice Server - Linux/WSL2 Adaptation
 *
 * Text-to-Speech notification server with local-first architecture:
 *   - Primary: Fish Audio S1 (local, free, emotional)
 *   - Fallback: ElevenLabs (cloud, premium)
 *
 * Usage:
 *   bun run src/voice/server-linux.ts
 *
 * Environment Variables:
 *   FISH_AUDIO_URL - Fish Audio API URL (default: http://localhost:8080)
 *   ELEVENLABS_API_KEY - Your ElevenLabs API key (fallback)
 *   ELEVENLABS_VOICE_ID - Default voice ID for ElevenLabs
 *   VOICE_SERVER_PORT - Server port (default: 8888)
 *   PAI_DIR - PAI installation directory (default: ~/.config/pai)
 *
 * Endpoints:
 *   POST /notify - Send TTS notification with optional voice/emotion
 *   POST /pai - Simple notification with default voice
 *   GET /health - Health check
 */

import { serve } from "bun";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

// Detect platform
const IS_LINUX = process.platform === 'linux';
const IS_MACOS = process.platform === 'darwin';
const IS_WSL = IS_LINUX && (process.env.WSL_DISTRO_NAME || process.env.WSLENV ||
  require('fs').existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'));

// Load .env from user home directory
const envPath = join(homedir(), '.env');
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text();
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const PORT = parseInt(process.env.VOICE_SERVER_PORT || process.env.PORT || "8888");
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.config', 'pai');

// Fish Audio (Primary - Local)
const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || "http://localhost:8080";
let fishAudioAvailable = false;

// Check Fish Audio availability on startup
async function checkFishAudio(): Promise<boolean> {
  try {
    const response = await fetch(`${FISH_AUDIO_URL}/v1/health`, {
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Default voice ID for ElevenLabs fallback
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

// Voice configuration types
interface VoiceConfig {
  voice_id: string;
  voice_name: string;
  stability: number;
  similarity_boost: number;
  description: string;
  type: string;
}

interface VoicesConfig {
  voices: Record<string, VoiceConfig>;
  default_volume?: number;
}

// Emotional markers for dynamic voice adjustment
interface EmotionalSettings {
  stability: number;
  similarity_boost: number;
}

// 13 Emotional Presets - Prosody System
const EMOTIONAL_PRESETS: Record<string, EmotionalSettings> = {
  'excited': { stability: 0.7, similarity_boost: 0.9 },
  'celebration': { stability: 0.65, similarity_boost: 0.85 },
  'insight': { stability: 0.55, similarity_boost: 0.8 },
  'creative': { stability: 0.5, similarity_boost: 0.75 },
  'success': { stability: 0.6, similarity_boost: 0.8 },
  'progress': { stability: 0.55, similarity_boost: 0.75 },
  'investigating': { stability: 0.6, similarity_boost: 0.85 },
  'debugging': { stability: 0.55, similarity_boost: 0.8 },
  'learning': { stability: 0.5, similarity_boost: 0.75 },
  'pondering': { stability: 0.65, similarity_boost: 0.8 },
  'focused': { stability: 0.7, similarity_boost: 0.85 },
  'caution': { stability: 0.4, similarity_boost: 0.6 },
  'urgent': { stability: 0.3, similarity_boost: 0.9 },
};

// Load voices configuration
let voicesConfig: VoicesConfig | null = null;
try {
  const paiPersonalitiesPath = join(PAI_DIR, 'skills', 'CORE', 'voice-personalities.md');
  if (existsSync(paiPersonalitiesPath)) {
    const markdownContent = readFileSync(paiPersonalitiesPath, 'utf-8');
    const jsonMatch = markdownContent.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      voicesConfig = JSON.parse(jsonMatch[1]);
      console.log('✅ Loaded voice personalities from CORE/voice-personalities.md');
    }
  } else {
    const voicesPath = join(import.meta.dir, '..', '..', 'voice-personalities.json');
    if (existsSync(voicesPath)) {
      const voicesContent = readFileSync(voicesPath, 'utf-8');
      voicesConfig = JSON.parse(voicesContent);
      console.log('✅ Loaded from voice-personalities.json');
    }
  }
} catch (error) {
  console.warn('⚠️  Failed to load voice personalities, using defaults');
}

// Extract emotional marker from message
function extractEmotionalMarker(message: string): { cleaned: string; emotion?: string } {
  const emojiToEmotion: Record<string, string> = {
    '💥': 'excited', '🎉': 'celebration', '💡': 'insight', '🎨': 'creative',
    '✨': 'success', '📈': 'progress', '🔍': 'investigating', '🐛': 'debugging',
    '📚': 'learning', '🤔': 'pondering', '🎯': 'focused', '⚠️': 'caution', '🚨': 'urgent'
  };

  const emotionMatch = message.match(/\[(💥|🎉|💡|🎨|✨|📈|🔍|🐛|📚|🤔|🎯|⚠️|🚨)\s+(\w+)\]/);
  if (emotionMatch) {
    const emoji = emotionMatch[1];
    const emotionName = emotionMatch[2].toLowerCase();
    if (emojiToEmotion[emoji] === emotionName) {
      return { cleaned: message.replace(emotionMatch[0], '').trim(), emotion: emotionName };
    }
  }
  return { cleaned: message };
}

// Get voice configuration by voice ID or agent name
function getVoiceConfig(identifier: string): VoiceConfig | null {
  if (!voicesConfig) return null;
  if (voicesConfig.voices[identifier]) return voicesConfig.voices[identifier];
  for (const config of Object.values(voicesConfig.voices)) {
    if (config.voice_id === identifier) return config;
  }
  return null;
}

// Sanitize input for TTS
function sanitizeForSpeech(input: string): string {
  return input
    .replace(/<script/gi, '')
    .replace(/\.\.\//g, '')
    .replace(/[;&|><`$\\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .trim()
    .substring(0, 500);
}

// Validate user input
function validateInput(input: any): { valid: boolean; error?: string; sanitized?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Invalid input type' };
  }
  if (input.length > 500) {
    return { valid: false, error: 'Message too long (max 500 characters)' };
  }
  const sanitized = sanitizeForSpeech(input);
  if (!sanitized || sanitized.length === 0) {
    return { valid: false, error: 'Message contains no valid content after sanitization' };
  }
  return { valid: true, sanitized };
}

// Fish Audio voice reference ID (set via voice-sync.ts)
const FISH_AUDIO_REFERENCE_ID = process.env.FISH_AUDIO_REFERENCE_ID || "jessica-voice";

// Generate speech using Fish Audio (Primary - Local)
// Supports both GPU and CPU mode with automatic fallback
// Uses cloned voice reference for consistent voice across providers
async function generateSpeechFishAudio(text: string): Promise<ArrayBuffer | null> {
  try {
    // Fish Audio uses msgpack for requests
    const { pack } = await import("msgpackr");

    const response = await fetch(`${FISH_AUDIO_URL}/v1/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/msgpack',
      },
      body: pack({
        text,
        format: 'wav',  // WAV for better quality (no compression artifacts)
        reference_id: FISH_AUDIO_REFERENCE_ID,  // Use cloned voice
        // Quality parameters to reduce artifacts
        temperature: 0.7,        // Lower = more stable, less variation
        top_p: 0.7,              // Lower = more conservative sampling
        repetition_penalty: 1.2, // Higher = avoid repetition artifacts
        normalize: true,         // Normalize numbers for stability
      }),
      signal: AbortSignal.timeout(60000)  // 60s timeout (CPU mode is slower)
    });

    if (!response.ok) {
      console.warn(`🐟 Fish Audio error: ${response.status}`);
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.warn(`🐟 Fish Audio unavailable: ${error}`);
    return null;
  }
}

// Generate speech using ElevenLabs API (Fallback - Cloud)
async function generateSpeechElevenLabs(
  text: string,
  voiceId: string,
  voiceSettings?: { stability: number; similarity_boost: number }
): Promise<ArrayBuffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!voiceId) {
    throw new Error('Voice ID not configured - set ELEVENLABS_VOICE_ID environment variable');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const settings = voiceSettings || { stability: 0.5, similarity_boost: 0.5 };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',  // Multilingual for EN/PT-BR
      voice_settings: settings,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  return await response.arrayBuffer();
}

// Generate speech with local-first architecture
// Priority: Fish Audio (local) → ElevenLabs (only if explicitly requested or local fails)
async function generateSpeech(
  text: string,
  voiceId: string,
  voiceSettings?: { stability: number; similarity_boost: number },
  forceElevenLabs: boolean = false
): Promise<ArrayBuffer> {
  // Check if ElevenLabs was explicitly requested
  if (forceElevenLabs && ELEVENLABS_API_KEY) {
    console.log(`☁️  Using ElevenLabs (explicitly requested)...`);
    return generateSpeechElevenLabs(text, voiceId, voiceSettings);
  }

  // Try Fish Audio first (local, free)
  // Fish Audio handles GPU/CPU automatically - if GPU is busy, it uses CPU
  if (fishAudioAvailable) {
    console.log(`🐟 Trying Fish Audio (local)...`);
    const audio = await generateSpeechFishAudio(text);
    if (audio && audio.byteLength > 100) {
      console.log(`🐟 Fish Audio success (${audio.byteLength} bytes)`);
      return audio;
    }
    console.log(`🐟 Fish Audio failed or unavailable`);
  }

  // Last resort: ElevenLabs (only if Fish Audio completely fails)
  if (ELEVENLABS_API_KEY) {
    console.log(`☁️  Using ElevenLabs (Fish Audio unavailable)...`);
    return generateSpeechElevenLabs(text, voiceId, voiceSettings);
  }

  throw new Error('No TTS provider available. Start Fish Audio or configure ElevenLabs.');
}

// Get volume setting from config
function getVolumeSetting(): number {
  if (voicesConfig && 'default_volume' in voicesConfig) {
    const vol = voicesConfig.default_volume;
    if (typeof vol === 'number' && vol >= 0 && vol <= 1) {
      return vol;
    }
  }
  return 1.0;
}

// Detect available audio player on Linux
async function detectAudioPlayer(): Promise<string | null> {
  const players = [
    { cmd: 'mpv', args: ['--version'] },
    { cmd: 'ffplay', args: ['-version'] },
    { cmd: 'mpg123', args: ['--version'] },
    { cmd: 'play', args: ['--version'] },  // sox
  ];

  for (const player of players) {
    try {
      const proc = Bun.spawn([player.cmd, ...player.args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
      if (proc.exitCode === 0) {
        return player.cmd;
      }
    } catch {
      // Player not found, try next
    }
  }
  return null;
}

// Cache detected audio player
let cachedAudioPlayer: string | null = null;

// Convert WSL path to Windows path
function wslToWindowsPath(wslPath: string): string {
  // /tmp/file.wav -> C:\Users\...\AppData\Local\Temp\file.wav
  // /mnt/c/... -> C:\...
  if (wslPath.startsWith('/mnt/')) {
    const drive = wslPath.charAt(5).toUpperCase();
    return `${drive}:${wslPath.substring(6).replace(/\//g, '\\\\')}`;
  }
  // For /tmp, copy to Windows temp folder
  return wslPath;
}

// Play audio using Windows PowerShell (bypasses WSLg audio issues)
async function playAudioWindows(tempFile: string): Promise<void> {
  // Copy to Windows-accessible location
  const windowsTempDir = '/mnt/c/Users/' + (process.env.USER || 'luisr') + '/AppData/Local/Temp';
  const fileName = `voice-${Date.now()}.wav`;
  const windowsTempFile = `${windowsTempDir}/${fileName}`;
  const windowsPath = `C:\\\\Users\\\\${process.env.USER || 'luisr'}\\\\AppData\\\\Local\\\\Temp\\\\${fileName}`;

  // Copy file to Windows temp
  await Bun.write(windowsTempFile, await Bun.file(tempFile).arrayBuffer());

  return new Promise((resolve, reject) => {
    // Use PowerShell MediaPlayer for clean audio playback
    const psCommand = `Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open('${windowsPath}'); $player.Play(); Start-Sleep -Milliseconds 100; while ($player.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep -Milliseconds 100 }; $duration = $player.NaturalDuration.TimeSpan.TotalSeconds; Start-Sleep -Seconds ($duration + 0.5); $player.Close()`;

    const proc = spawn('powershell.exe', ['-Command', psCommand]);

    proc.on('error', (error) => {
      cleanupTempFile(windowsTempFile);
      reject(error);
    });

    proc.on('exit', (code) => {
      cleanupTempFile(windowsTempFile);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PowerShell exited with code ${code}`));
      }
    });
  });
}

// Play audio - platform-aware
async function playAudio(audioBuffer: ArrayBuffer): Promise<void> {
  const tempFile = `/tmp/voice-${Date.now()}.wav`;
  await Bun.write(tempFile, audioBuffer);

  const volume = getVolumeSetting();

  return new Promise(async (resolve, reject) => {
    try {
      if (IS_WSL) {
        // WSL2: Use Windows PowerShell for clean audio (bypasses WSLg RDP audio issues)
        console.log(`🔊 Playing via Windows (PowerShell)`);
        try {
          await playAudioWindows(tempFile);
          cleanupTempFile(tempFile);
          resolve();
        } catch (error) {
          cleanupTempFile(tempFile);
          reject(error);
        }
      } else if (IS_MACOS) {
        // macOS: use afplay
        const proc = spawn('/usr/bin/afplay', ['-v', volume.toString(), tempFile]);
        proc.on('error', reject);
        proc.on('exit', (code) => {
          cleanupTempFile(tempFile);
          code === 0 ? resolve() : reject(new Error(`afplay exited with code ${code}`));
        });
      } else if (IS_LINUX) {
        // Native Linux: detect and use available player
        if (!cachedAudioPlayer) {
          cachedAudioPlayer = await detectAudioPlayer();
        }

        if (!cachedAudioPlayer) {
          cleanupTempFile(tempFile);
          reject(new Error('No audio player found. Install mpv: sudo apt install mpv'));
          return;
        }

        let args: string[];
        switch (cachedAudioPlayer) {
          case 'mpv':
            // mpv with volume (0-100 scale)
            args = ['--no-terminal', '--no-video', `--volume=${Math.round(volume * 100)}`, tempFile];
            break;
          case 'ffplay':
            args = ['-nodisp', '-autoexit', '-volume', Math.round(volume * 100).toString(), tempFile];
            break;
          case 'mpg123':
            args = ['-q', tempFile];  // mpg123 doesn't have easy volume control
            break;
          case 'play':
            args = ['-q', tempFile];  // sox play
            break;
          default:
            args = [tempFile];
        }

        console.log(`🔊 Playing with ${cachedAudioPlayer}`);
        const proc = spawn(cachedAudioPlayer, args);

        proc.on('error', (error) => {
          cleanupTempFile(tempFile);
          reject(error);
        });

        proc.on('exit', (code) => {
          cleanupTempFile(tempFile);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`${cachedAudioPlayer} exited with code ${code}`));
          }
        });
      } else {
        cleanupTempFile(tempFile);
        reject(new Error(`Unsupported platform: ${process.platform}`));
      }
    } catch (error) {
      cleanupTempFile(tempFile);
      reject(error);
    }
  });
}

function cleanupTempFile(path: string) {
  try {
    unlinkSync(path);
  } catch {
    // Ignore cleanup errors
  }
}

// Send Linux notification (notify-send)
async function sendDesktopNotification(title: string, message: string): Promise<void> {
  if (IS_LINUX) {
    try {
      const proc = Bun.spawn(['notify-send', title, message], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
    } catch {
      // notify-send not available, ignore
    }
  } else if (IS_MACOS) {
    try {
      const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name ""`;
      const proc = Bun.spawn(['/usr/bin/osascript', '-e', script], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
    } catch {
      // Ignore notification errors
    }
  }
}

// Send notification with voice
// forceElevenLabs: true = use ElevenLabs explicitly, false = use Fish Audio (local-first)
async function sendNotification(
  title: string,
  message: string,
  voiceEnabled = true,
  voiceId: string | null = null,
  forceElevenLabs: boolean = false
) {
  const titleValidation = validateInput(title);
  const messageValidation = validateInput(message);

  if (!titleValidation.valid) throw new Error(`Invalid title: ${titleValidation.error}`);
  if (!messageValidation.valid) throw new Error(`Invalid message: ${messageValidation.error}`);

  const safeTitle = titleValidation.sanitized!;
  let safeMessage = messageValidation.sanitized!;

  const { cleaned, emotion } = extractEmotionalMarker(safeMessage);
  safeMessage = cleaned;

  // Generate and play voice (Fish Audio first, ElevenLabs as fallback)
  if (voiceEnabled && (fishAudioAvailable || ELEVENLABS_API_KEY)) {
    try {
      const voice = voiceId || DEFAULT_VOICE_ID;
      const voiceConfig = getVoiceConfig(voice);

      let voiceSettings = { stability: 0.5, similarity_boost: 0.5 };
      if (emotion && EMOTIONAL_PRESETS[emotion]) {
        voiceSettings = EMOTIONAL_PRESETS[emotion];
        console.log(`🎭 Emotion: ${emotion}`);
      } else if (voiceConfig) {
        voiceSettings = {
          stability: voiceConfig.stability,
          similarity_boost: voiceConfig.similarity_boost
        };
        console.log(`👤 Personality: ${voiceConfig.description}`);
      }

      console.log(`🎙️  Generating speech...`);

      const audioBuffer = await generateSpeech(safeMessage, voice, voiceSettings, forceElevenLabs);
      await playAudio(audioBuffer);
    } catch (error) {
      console.error("Failed to generate/play speech:", error);
    }
  }

  // Desktop notification
  await sendDesktopNotification(safeTitle, safeMessage);
}

// Rate limiting
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  return true;
}

// Start HTTP server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const clientIp = req.headers.get('x-forwarded-for') || 'localhost';

    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ status: "error", message: "Rate limit exceeded" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
      );
    }

    // POST /notify
    if (url.pathname === "/notify" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "MAI Notification";
        const message = data.message || "Task completed";
        const voiceEnabled = data.voice_enabled !== false;
        const voiceId = data.voice_id || data.voice_name || null;
        // use_elevenlabs: true = force ElevenLabs, false = use Fish Audio (local-first)
        const forceElevenLabs = data.use_elevenlabs === true;

        console.log(`📨 Notification: "${title}" - "${message}"`);
        await sendNotification(title, message, voiceEnabled, voiceId, forceElevenLabs);

        return new Response(
          JSON.stringify({ status: "success", message: "Notification sent", provider: forceElevenLabs ? "elevenlabs" : "fish-audio" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (error: any) {
        console.error("Notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // POST /pai
    if (url.pathname === "/pai" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "MAI Assistant";
        const message = data.message || "Task completed";
        // use_elevenlabs: true = force ElevenLabs (premium), false = use Fish Audio (local)
        const forceElevenLabs = data.use_elevenlabs === true;

        console.log(`🤖 MAI notification: "${message}"`);
        await sendNotification(title, message, true, null, forceElevenLabs);

        return new Response(
          JSON.stringify({ status: "success", message: "MAI notification sent", provider: forceElevenLabs ? "elevenlabs" : "fish-audio" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (error: any) {
        console.error("MAI notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // GET /health
    if (url.pathname === "/health") {
      const audioPlayer = cachedAudioPlayer || await detectAudioPlayer();
      // Re-check Fish Audio availability
      fishAudioAvailable = await checkFishAudio();
      return new Response(
        JSON.stringify({
          status: "healthy",
          platform: process.platform,
          port: PORT,
          providers: {
            primary: {
              name: "Fish Audio S1",
              type: "local",
              available: fishAudioAvailable,
              url: FISH_AUDIO_URL,
              reference_id: FISH_AUDIO_REFERENCE_ID
            },
            fallback: {
              name: "ElevenLabs",
              type: "cloud",
              available: !!ELEVENLABS_API_KEY,
              voice_id: DEFAULT_VOICE_ID || "(not configured)"
            }
          },
          audio_player: audioPlayer || "none",
          pai_dir: PAI_DIR
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response("MAI Voice Server - POST to /notify or /pai", {
      headers: corsHeaders,
      status: 200
    });
  },
});

// Startup: Check Fish Audio availability
fishAudioAvailable = await checkFishAudio();

// Startup info
console.log(`🚀 MAI Voice Server running on port ${PORT}`);
console.log(`🖥️  Platform: ${process.platform}${IS_WSL ? ' (WSL2)' : ''}`);
if (IS_WSL) {
  console.log(`🔊 Audio: Windows PowerShell (bypasses WSLg)`);
} else if (IS_LINUX) {
  const player = await detectAudioPlayer();
  console.log(`🔊 Audio player: ${player || '❌ None found - install mpv'}`);
}
console.log(`\n📢 TTS Providers (local-first architecture):`);
console.log(`   🐟 Primary: Fish Audio S1 - ${fishAudioAvailable ? '✅ Available' : '❌ Not running'} (${FISH_AUDIO_URL})`);
console.log(`      Voice reference: ${FISH_AUDIO_REFERENCE_ID}`);
console.log(`   ☁️  Fallback: ElevenLabs - ${ELEVENLABS_API_KEY ? '✅ Configured' : '❌ No API key'}`);
console.log(`\n📡 Endpoint: POST http://localhost:${PORT}/pai`);
