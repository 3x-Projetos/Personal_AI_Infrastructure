# PAI Voice System

**Version:** 2.0.0
**Platform:** Linux/WSL2
**Status:** Operational
**Architecture:** Local-First (Fish Audio S1 + ElevenLabs fallback)

## Overview

Text-to-speech notification system for MAI with local-first architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    PAI VOICE SYSTEM                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Request → Voice Server (8888)                              │
│                │                                            │
│                ▼                                            │
│        ┌──────────────┐                                     │
│        │ Fish Audio   │ ◄── Primary (local, free)           │
│        │ S1 (8080)    │     GPU: ~2-5s | CPU: ~15-30s       │
│        └──────┬───────┘                                     │
│               │                                             │
│        [fail or explicit]                                   │
│               │                                             │
│               ▼                                             │
│        ┌──────────────┐                                     │
│        │ ElevenLabs   │ ◄── Fallback (cloud, premium)       │
│        │ (API)        │     10,000 chars/month free tier    │
│        └──────────────┘                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Start voice system (Fish Audio + Voice Server)
~/PAI/Packs/pai-voice-system/pai-voice-start.sh

# Check status
~/PAI/Packs/pai-voice-system/pai-voice-start.sh status

# Stop
~/PAI/Packs/pai-voice-system/pai-voice-start.sh stop

# Test notification
curl -X POST http://localhost:8888/pai \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello Romano!"}'
```

## Auto-Start

Voice system starts automatically when WSL boots (configured in `~/.bashrc`).

## Configuration

### Environment Variables (~/.env)

```bash
# Fish Audio (Primary - Local)
FISH_AUDIO_URL=http://localhost:8080  # Default

# ElevenLabs (Fallback - Cloud)
ELEVENLABS_API_KEY=sk_xxxxx
ELEVENLABS_VOICE_ID=cgSgspJ2msm6clMCkdW9  # Jessica

# Voice Server
VOICE_SERVER_PORT=8888
```

## API Reference

### POST /pai
Simple notification with default settings.

```bash
curl -X POST http://localhost:8888/pai \
  -d '{"message":"Task completed!"}'
```

### POST /notify
Full control over notification.

```bash
curl -X POST http://localhost:8888/notify \
  -d '{
    "title": "MAI",
    "message": "Hello!",
    "voice_enabled": true,
    "use_elevenlabs": false
  }'
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| message | string | required | Text to speak |
| title | string | "MAI" | Notification title |
| voice_enabled | boolean | true | Enable/disable TTS |
| use_elevenlabs | boolean | false | Force ElevenLabs (explicit request only) |

### GET /health
Check system status.

```json
{
  "status": "healthy",
  "providers": {
    "primary": {
      "name": "Fish Audio S1",
      "type": "local",
      "available": true,
      "url": "http://localhost:8080"
    },
    "fallback": {
      "name": "ElevenLabs",
      "type": "cloud",
      "available": true
    }
  },
  "audio_player": "mpv"
}
```

## Voice Options

### Fish Audio S1 (Primary)
- **Type:** Local (runs on your machine)
- **Cost:** Free
- **Latency:** GPU ~2-5s, CPU ~15-30s
- **Features:**
  - Voice cloning (10-30s reference audio)
  - Emotional TTS: `(happy)`, `(sad)`, `(angry)`, `(excited)`
  - Multilingual: EN, PT, ZH, JA, ES, etc.

### ElevenLabs (Fallback)
- **Type:** Cloud API
- **Cost:** 10,000 chars/month free tier
- **Latency:** ~1-2s
- **Voices:**
  - Jessica (active): Expressive, conversational
  - Lily: Warm, British
  - Matilda: Friendly, American
  - Aria: Energetic, social

## When is ElevenLabs Used?

1. **Explicit request:** `use_elevenlabs: true`
2. **Fish Audio fails:** Server unreachable or error
3. **Never automatically:** GPU busy → Fish Audio uses CPU (slower but works)

## GPU vs CPU

| Mode | Time (10 words) | Memory |
|------|-----------------|--------|
| GPU (CUDA) | ~2-5s | ~5 GB VRAM |
| CPU | ~15-30s | ~4 GB RAM |

Fish Audio automatically uses available resources. If GPU is busy with other models, generation is slower but still works.

## Hooks Integration

The Stop hook (`stop-hook-voice.ts`) extracts the `🗣️ MAI:` line from responses and sends it to the voice server.

**Response format (from CORE skill):**
```
🗣️ MAI: Brief spoken message here (12 words max)
```

## File Locations

| File | Purpose |
|------|---------|
| `~/PAI/Packs/pai-voice-system/` | Main pack directory |
| `~/.local/share/pai/fish-audio/` | Fish Audio installation |
| `~/.local/share/pai/logs/` | Service logs |
| `~/.env` | API keys and configuration |

## Troubleshooting

### No audio output
1. Check mpv: `which mpv`
2. Check PulseAudio: `pactl info`
3. Check logs: `tail -f ~/.local/share/pai/logs/voice-server.log`

### Fish Audio not starting
1. Check GPU: `nvidia-smi`
2. Check model: `ls ~/.local/share/pai/fish-audio/fish-speech/checkpoints/`
3. Start manually: `~/.local/share/pai/fish-audio/start-api.sh`

### ElevenLabs not working
1. Check API key: `cat ~/.env | grep ELEVENLABS`
2. Check quota: `bun ~/PAI/Packs/pai-voice-system/src/voice/quota-tracker.ts`

## Voice Cloning (Voice Sync)

Keep the same voice across providers using `voice-sync.ts`.

### How It Works

1. Generates a reference audio sample from ElevenLabs
2. Registers it with Fish Audio as a voice reference
3. All Fish Audio requests use this cloned voice

### Usage

```bash
# First time setup
bun run scripts/voice-sync.ts

# Re-sync (overwrite existing)
bun run scripts/voice-sync.ts --force
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| FISH_AUDIO_REFERENCE_ID | jessica-voice | Voice reference ID |
| FISH_AUDIO_URL | http://localhost:8080 | Fish Audio API |
| ELEVENLABS_API_KEY | (required) | ElevenLabs API key |
| ELEVENLABS_VOICE_ID | (required) | Source voice to clone |

### Bilingual Support

The reference audio includes both PT-BR and EN speech to capture prosody for both languages.

### Files

| File | Purpose |
|------|---------|
| `scripts/voice-sync.ts` | Voice cloning script |
| `~/.config/pai/voices/mai-reference.mp3` | Local backup of reference audio |

## Session 2026-01-12

- Installed Fish Audio S1 (openaudio-s1-mini model)
- Configured local-first architecture
- Added Stop hook for automatic voice extraction
- Updated routing: Fish Audio → ElevenLabs (explicit only)
- Added auto-start via ~/.bashrc
- **Voice Cloning:** Added `voice-sync.ts` for ElevenLabs → Fish Audio voice sync
- **Bilingual:** Reference audio includes PT-BR + EN for both languages
