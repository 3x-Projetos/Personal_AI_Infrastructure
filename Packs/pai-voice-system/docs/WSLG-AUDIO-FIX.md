# WSLg Audio Pipeline Fix

**Date:** 2026-01-14
**Status:** Resolved
**Impact:** Voice playback quality in WSL2

## Problem

Audio played from WSL2 through Linux players (mpv, paplay) had:
- Static/noise between words
- Random "cuts" at word boundaries (e.g., "cinco", "dez")
- Inconsistent playback quality

## Root Cause

WSL2 uses **WSLg** (Windows Subsystem for Linux GUI) which routes audio through an **RDP audio sink**:

```
WSL Audio Path (problematic):
Linux App → PulseAudio → WSLg RDPSink → Windows Audio → Speaker
```

The RDPSink is a virtual audio device that tunnels audio over RDP protocol, which:
- Drops packets under load
- Has variable latency
- Causes artifacts at chunk boundaries

## Solution

Bypass WSLg by playing audio directly through Windows PowerShell:

```
New Audio Path (clean):
Linux App → Copy WAV to Windows → PowerShell MediaPlayer → Windows Audio → Speaker
```

### Implementation

Modified `server-linux.ts` to detect WSL and use Windows playback:

```typescript
const IS_WSL = IS_LINUX && (process.env.WSL_DISTRO_NAME || process.env.WSLENV ||
  require('fs').existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'));

if (IS_WSL) {
  // Copy audio to Windows temp folder
  // Play via PowerShell MediaPlayer
}
```

## Verification

| Method | Static | Cuts | Quality |
|--------|--------|------|---------|
| mpv (Linux) | Yes | Yes | Poor |
| paplay (PulseAudio) | Reduced | Yes | Medium |
| PowerShell (Windows) | No | No | Excellent |

## Files Modified

- `src/voice/server-linux.ts` - Added WSL detection and Windows playback
- `src/voice/openai-tts-wrapper.ts` - Added silence padding option

## Related Issues

- WSLg audio quality: https://github.com/microsoft/wslg/issues
- PulseAudio RDP sink limitations

## Notes

- This solution adds ~100-200ms latency due to file copy to Windows
- Works with any Windows audio output (Bluetooth, USB, etc.)
- Browser-based playback (Web UI) was unaffected as it uses browser's audio API
