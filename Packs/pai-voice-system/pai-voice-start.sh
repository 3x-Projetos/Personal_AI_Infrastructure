#!/bin/bash
# PAI Voice System - Unified Startup Script
# Starts Fish Audio (TTS) and Voice Server in background
#
# Usage:
#   ~/PAI/Packs/pai-voice-system/pai-voice-start.sh
#   ~/PAI/Packs/pai-voice-system/pai-voice-start.sh stop
#   ~/PAI/Packs/pai-voice-system/pai-voice-start.sh status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FISH_DIR="$HOME/.local/share/pai/fish-audio"
LOG_DIR="$HOME/.local/share/pai/logs"

# Create log directory
mkdir -p "$LOG_DIR"

# PID files
FISH_PID_FILE="$LOG_DIR/fish-audio.pid"
VOICE_PID_FILE="$LOG_DIR/voice-server.pid"
WRAPPER_PID_FILE="$LOG_DIR/openai-tts-wrapper.pid"
STT_PID_FILE="$LOG_DIR/stt-server.pid"

# STT Server directory
STT_DIR="$HOME/.local/share/pai/faster-whisper"

start_fish_audio() {
    if [ -f "$FISH_PID_FILE" ] && kill -0 "$(cat "$FISH_PID_FILE")" 2>/dev/null; then
        echo "🐟 Fish Audio already running (PID: $(cat "$FISH_PID_FILE"))"
        return 0
    fi

    echo "🐟 Starting Fish Audio S1..."
    cd "$FISH_DIR/fish-speech"
    source "$FISH_DIR/venv/bin/activate"

    nohup python tools/api_server.py \
        --llama-checkpoint-path checkpoints/openaudio-s1-mini \
        --decoder-checkpoint-path checkpoints/openaudio-s1-mini/codec.pth \
        --listen 0.0.0.0:8080 \
        --device cuda \
        > "$LOG_DIR/fish-audio.log" 2>&1 &

    echo $! > "$FISH_PID_FILE"
    echo "🐟 Fish Audio started (PID: $!)"

    # Wait for API to be ready
    echo "   Waiting for model to load..."
    for i in {1..60}; do
        if curl -s http://localhost:8080/v1/health > /dev/null 2>&1; then
            echo "   ✅ Fish Audio ready!"
            return 0
        fi
        sleep 1
    done
    echo "   ⚠️  Fish Audio may still be loading..."
}

start_voice_server() {
    if [ -f "$VOICE_PID_FILE" ] && kill -0 "$(cat "$VOICE_PID_FILE")" 2>/dev/null; then
        echo "🔊 Voice Server already running (PID: $(cat "$VOICE_PID_FILE"))"
        return 0
    fi

    echo "🔊 Starting Voice Server..."
    cd "$SCRIPT_DIR"

    nohup bun run src/voice/server-linux.ts \
        > "$LOG_DIR/voice-server.log" 2>&1 &

    echo $! > "$VOICE_PID_FILE"
    echo "🔊 Voice Server started (PID: $!)"

    sleep 2
    if curl -s http://localhost:8888/health > /dev/null 2>&1; then
        echo "   ✅ Voice Server ready!"
    fi
}

start_openai_wrapper() {
    if [ -f "$WRAPPER_PID_FILE" ] && kill -0 "$(cat "$WRAPPER_PID_FILE")" 2>/dev/null; then
        echo "🎙️  OpenAI TTS Wrapper already running (PID: $(cat "$WRAPPER_PID_FILE"))"
        return 0
    fi

    echo "🎙️  Starting OpenAI TTS Wrapper..."
    cd "$SCRIPT_DIR"

    nohup bun run src/voice/openai-tts-wrapper.ts \
        > "$LOG_DIR/openai-tts-wrapper.log" 2>&1 &

    echo $! > "$WRAPPER_PID_FILE"
    echo "🎙️  OpenAI TTS Wrapper started (PID: $!)"

    sleep 2
    if curl -s http://localhost:8081/health > /dev/null 2>&1; then
        echo "   ✅ OpenAI TTS Wrapper ready!"
        echo "   🌐 Voice Manager: http://localhost:8081/voices"
    fi
}

start_stt_server() {
    if [ -f "$STT_PID_FILE" ] && kill -0 "$(cat "$STT_PID_FILE")" 2>/dev/null; then
        echo "🎤 STT Server already running (PID: $(cat "$STT_PID_FILE"))"
        return 0
    fi

    echo "🎤 Starting STT Server (Faster-Whisper)..."

    cd "$STT_DIR"
    source "$STT_DIR/venv/bin/activate"

    # Use large-v3 model with CUDA if available
    nohup python stt-server.py \
        --model large-v3 \
        --device auto \
        > "$LOG_DIR/stt-server.log" 2>&1 &

    echo $! > "$STT_PID_FILE"
    echo "🎤 STT Server started (PID: $!)"

    # Wait for model to load (can take 10-30s for large-v3)
    echo "   Loading Whisper model (this may take a moment)..."
    for i in {1..60}; do
        if curl -s http://localhost:8082/health > /dev/null 2>&1; then
            echo "   ✅ STT Server ready!"
            return 0
        fi
        sleep 1
    done
    echo "   ⚠️  STT Server may still be loading..."
}

stop_services() {
    echo "🛑 Stopping PAI Voice System..."

    if [ -f "$STT_PID_FILE" ]; then
        kill "$(cat "$STT_PID_FILE")" 2>/dev/null || true
        rm -f "$STT_PID_FILE"
        echo "   STT Server stopped"
    fi

    if [ -f "$WRAPPER_PID_FILE" ]; then
        kill "$(cat "$WRAPPER_PID_FILE")" 2>/dev/null || true
        rm -f "$WRAPPER_PID_FILE"
        echo "   OpenAI TTS Wrapper stopped"
    fi

    if [ -f "$VOICE_PID_FILE" ]; then
        kill "$(cat "$VOICE_PID_FILE")" 2>/dev/null || true
        rm -f "$VOICE_PID_FILE"
        echo "   Voice Server stopped"
    fi

    if [ -f "$FISH_PID_FILE" ]; then
        kill "$(cat "$FISH_PID_FILE")" 2>/dev/null || true
        rm -f "$FISH_PID_FILE"
        echo "   Fish Audio stopped"
    fi

    echo "✅ PAI Voice System stopped"
}

show_status() {
    echo "📊 PAI Voice System Status"
    echo "─────────────────────────────"

    if [ -f "$FISH_PID_FILE" ] && kill -0 "$(cat "$FISH_PID_FILE")" 2>/dev/null; then
        echo "🐟 Fish Audio: ✅ Running (PID: $(cat "$FISH_PID_FILE"))"
        curl -s http://localhost:8080/v1/health 2>/dev/null && echo "" || echo "   (API not responding)"
    else
        echo "🐟 Fish Audio: ❌ Not running"
    fi

    if [ -f "$VOICE_PID_FILE" ] && kill -0 "$(cat "$VOICE_PID_FILE")" 2>/dev/null; then
        echo "🔊 Voice Server: ✅ Running (PID: $(cat "$VOICE_PID_FILE"))"
    else
        echo "🔊 Voice Server: ❌ Not running"
    fi

    if [ -f "$WRAPPER_PID_FILE" ] && kill -0 "$(cat "$WRAPPER_PID_FILE")" 2>/dev/null; then
        echo "🎙️  OpenAI Wrapper: ✅ Running (PID: $(cat "$WRAPPER_PID_FILE"))"
        echo "   🌐 Voice Manager: http://localhost:8081/voices"
    else
        echo "🎙️  OpenAI Wrapper: ❌ Not running"
    fi

    if [ -f "$STT_PID_FILE" ] && kill -0 "$(cat "$STT_PID_FILE")" 2>/dev/null; then
        echo "🎤 STT Server: ✅ Running (PID: $(cat "$STT_PID_FILE"))"
    else
        echo "🎤 STT Server: ❌ Not running"
    fi

    echo ""
    echo "📁 Logs: $LOG_DIR/"
}

case "${1:-start}" in
    start)
        echo "🚀 Starting PAI Voice System..."
        echo "─────────────────────────────────"
        start_fish_audio
        start_stt_server
        start_voice_server
        start_openai_wrapper
        echo ""
        echo "✅ PAI Voice System ready!"
        echo "   Voice Server:  http://localhost:8888/pai"
        echo "   OpenAI TTS:    http://localhost:8081/v1/audio/speech"
        echo "   OpenAI STT:    http://localhost:8081/v1/audio/transcriptions"
        echo "   Voice Manager: http://localhost:8081/voices"
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 2
        exec "$0" start
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
