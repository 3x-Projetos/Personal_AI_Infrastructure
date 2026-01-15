#!/bin/bash
# Setup Fish Audio S1 as fallback TTS provider
# SOTA 2026 emotional TTS - from PAI research 2026-01-09

set -e

echo "🐟 Setting up Fish Audio S1 (Fallback TTS)"
echo "==========================================="

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Install with: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# Create virtual environment
FISH_DIR="$HOME/.local/share/pai/fish-audio"
mkdir -p "$FISH_DIR"
cd "$FISH_DIR"

echo "📦 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "📥 Installing dependencies..."
pip install --upgrade pip
pip install torch torchaudio

echo "📥 Cloning Fish Speech repository..."
if [ ! -d "fish-speech" ]; then
    git clone https://github.com/fishaudio/fish-speech.git
fi
cd fish-speech
pip install -e .

echo "📥 Downloading S1-mini model (smaller, faster)..."
pip install huggingface_hub
huggingface-cli download fishaudio/openaudio-s1-mini --local-dir checkpoints/openaudio-s1-mini

echo ""
echo "✅ Fish Audio S1 installed!"
echo ""
echo "Supported emotions:"
echo "  (happy) (sad) (angry) (excited) (surprised)"
echo "  (worried) (nervous) (confident) (curious)"
echo "  (laughing) (sighing) (crying loudly)"
echo ""
echo "Usage example:"
echo "  cd $FISH_DIR/fish-speech"
echo "  source ../venv/bin/activate"
echo "  python -m fish_speech.webui"
echo ""
echo "Or use HTTP API (port 8080):"
echo "  python -m fish_speech.api --listen 0.0.0.0:8080"
