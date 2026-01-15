#!/bin/bash
# Setup SenseVoice STT with emotion recognition
# SOTA 2026 multilingual STT - from PAI research 2026-01-09

set -e

echo "🎤 Setting up SenseVoice (STT + Emotion Recognition)"
echo "===================================================="

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Install with: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# Create virtual environment
SENSE_DIR="$HOME/.local/share/pai/sensevoice"
mkdir -p "$SENSE_DIR"
cd "$SENSE_DIR"

echo "📦 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "📥 Installing SenseVoice via funasr..."
pip install --upgrade pip
pip install funasr
pip install torch torchaudio

# Optional: ONNX version for faster CPU inference
# pip install funasr-onnx

echo "📥 Pre-downloading model..."
python3 << 'EOF'
from funasr import AutoModel

print("Downloading SenseVoiceSmall model...")
model = AutoModel(
    model="FunAudioLLM/SenseVoiceSmall",
    vad_model="fsmn-vad",
    vad_kwargs={"max_single_segment_time": 30000},
    device="cpu",  # Use "cuda:0" if GPU available
    hub="hf"
)
print("✅ Model downloaded successfully!")
EOF

echo ""
echo "✅ SenseVoice installed!"
echo ""
echo "Emotion detection:"
echo "  😊 Happy  😡 Angry  😔 Sad  😐 Neutral"
echo ""
echo "Sound events:"
echo "  😀 Laughter  🎼 Music  👏 Applause"
echo "  🤧 Cough/Sneeze  😭 Cry"
echo ""
echo "Usage example:"
cat << 'USAGE'

from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess

model = AutoModel(
    model="FunAudioLLM/SenseVoiceSmall",
    vad_model="fsmn-vad",
    vad_kwargs={"max_single_segment_time": 30000},
    device="cpu",
    hub="hf"
)

result = model.generate(
    input="audio.wav",
    language="auto",
    use_itn=True,
    batch_size_s=60
)

text = rich_transcription_postprocess(result[0]["text"])
print(text)  # Includes emotion tags like <|HAPPY|>

USAGE
