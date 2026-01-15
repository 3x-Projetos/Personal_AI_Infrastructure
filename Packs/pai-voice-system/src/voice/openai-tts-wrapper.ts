#!/usr/bin/env bun
/**
 * OpenAI Audio API Wrapper - TTS + STT
 *
 * Provides OpenAI-compatible audio endpoints:
 *   - TTS via Fish Audio
 *   - STT via Faster-Whisper
 *
 * Usage:
 *   bun run src/voice/openai-tts-wrapper.ts
 *
 * Endpoints:
 *   POST /v1/audio/speech         - TTS (OpenAI compatible)
 *   POST /v1/audio/transcriptions - STT (OpenAI compatible)
 *   POST /v1/audio/translations   - Translate to English (OpenAI compatible)
 *   GET  /v1/models               - List available models
 *   GET  /v1/voices               - List available voices (extension)
 *   GET  /voices                  - Web UI for voice management
 *   POST /voices/create           - Create new voice from audio
 *   DELETE /voices/:id            - Delete a voice
 *   POST /voices/test             - Test a voice
 *   GET  /health                  - Health check
 */

import { serve, $ } from "bun";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

const PORT = parseInt(process.env.OPENAI_TTS_PORT || "8081");
const FISH_AUDIO_URL = process.env.FISH_AUDIO_URL || "http://localhost:8080";
const STT_SERVER_URL = process.env.STT_SERVER_URL || "http://localhost:8082";

// Audio padding in milliseconds to prevent Bluetooth speaker wake-up cutting
const AUDIO_PADDING_MS = parseInt(process.env.AUDIO_PADDING_MS || "300");

/**
 * Add silence padding to audio using FFmpeg
 * This prevents the first word from being cut when Bluetooth speakers "wake up"
 */
async function addSilencePadding(audioBuffer: ArrayBuffer, format: string): Promise<ArrayBuffer> {
  const tempId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const inputPath = join(tmpdir(), `tts-input-${tempId}.${format}`);
  const outputPath = join(tmpdir(), `tts-output-${tempId}.${format}`);

  try {
    // Write input audio to temp file
    await Bun.write(inputPath, audioBuffer);

    // Use FFmpeg to add silence padding at the beginning
    // -af "adelay=300|300" adds 300ms delay to left|right channels
    const result = await $`ffmpeg -y -i ${inputPath} -af "adelay=${AUDIO_PADDING_MS}|${AUDIO_PADDING_MS}" ${outputPath} 2>/dev/null`.quiet();

    if (result.exitCode !== 0) {
      console.warn(`⚠️  FFmpeg padding failed, returning original audio`);
      return audioBuffer;
    }

    // Read the padded audio
    const paddedAudio = await Bun.file(outputPath).arrayBuffer();

    return paddedAudio;
  } catch (error) {
    console.warn(`⚠️  Audio padding error: ${error}`);
    return audioBuffer;
  } finally {
    // Cleanup temp files
    try { await unlink(inputPath); } catch {}
    try { await unlink(outputPath); } catch {}
  }
}

// Dynamic voice map - loaded from Fish Audio
let voiceMap: Record<string, string> = {};
let voiceList: string[] = [];

// Fetch voices from Fish Audio
async function refreshVoices(): Promise<void> {
  try {
    const response = await fetch(`${FISH_AUDIO_URL}/v1/references/list`);
    if (response.ok) {
      const { unpack } = await import("msgpackr");
      const buffer = await response.arrayBuffer();
      const data = unpack(new Uint8Array(buffer));
      voiceList = data.reference_ids || [];

      // Build voice map - OpenAI voices + custom voices
      voiceMap = {
        // Default OpenAI voices map to first available or 'default'
        "alloy": voiceList[0] || "default",
        "echo": voiceList[1] || voiceList[0] || "default",
        "fable": voiceList[2] || voiceList[0] || "default",
        "onyx": voiceList[3] || voiceList[0] || "default",
        "nova": voiceList[4] || voiceList[0] || "default",
        "shimmer": voiceList[5] || voiceList[0] || "default",
      };

      // Add direct access to all custom voices
      for (const voice of voiceList) {
        voiceMap[voice] = voice;
      }

      console.log(`🎙️  Loaded ${voiceList.length} voices: ${voiceList.join(", ")}`);
    }
  } catch (error) {
    console.warn("⚠️  Could not fetch voices from Fish Audio:", error);
  }
}

// HTML for voice management UI
function getVoiceManagerHTML(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAI Voice Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #e0e0e0;
      padding: 2rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #00d4ff, #9b59b6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }

    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 {
      font-size: 1.2rem;
      margin-bottom: 1rem;
      color: #00d4ff;
    }

    .voices-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .voice-item {
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid rgba(255,255,255,0.08);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .voice-item .name {
      font-weight: 600;
      color: #fff;
    }
    .voice-item .actions {
      display: flex;
      gap: 0.5rem;
      margin-top: auto;
    }

    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(90deg, #00d4ff, #9b59b6);
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #e0e0e0;
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.15); }
    .btn-danger {
      background: rgba(231, 76, 60, 0.2);
      color: #e74c3c;
    }
    .btn-danger:hover { background: rgba(231, 76, 60, 0.3); }

    .form-group {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #aaa;
      font-size: 0.9rem;
    }
    input[type="text"], textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      background: rgba(0,0,0,0.3);
      color: #e0e0e0;
      font-size: 1rem;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #00d4ff;
    }
    textarea { min-height: 80px; resize: vertical; }

    .file-input {
      border: 2px dashed rgba(255,255,255,0.2);
      border-radius: 8px;
      padding: 2rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .file-input:hover { border-color: #00d4ff; }
    .file-input.dragover { border-color: #00d4ff; background: rgba(0,212,255,0.1); }
    .file-input input { display: none; }
    .file-input .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .file-input .selected { color: #00d4ff; margin-top: 0.5rem; }

    .status {
      padding: 1rem;
      border-radius: 6px;
      margin-top: 1rem;
      display: none;
    }
    .status.success { display: block; background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
    .status.error { display: block; background: rgba(231, 76, 60, 0.2); color: #e74c3c; }
    .status.loading { display: block; background: rgba(0, 212, 255, 0.2); color: #00d4ff; }

    .endpoint-info {
      background: rgba(0,0,0,0.3);
      border-radius: 6px;
      padding: 1rem;
      font-family: monospace;
      font-size: 0.85rem;
      overflow-x: auto;
    }
    .endpoint-info code { color: #00d4ff; }

    .recording-controls {
      display: flex;
      gap: 1rem;
      align-items: center;
      margin-bottom: 1rem;
    }
    .record-btn {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 3px solid #e74c3c;
      background: transparent;
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    .record-btn::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      background: #e74c3c;
      border-radius: 50%;
      transition: all 0.2s;
    }
    .record-btn.recording::after {
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }
    .record-btn:hover { border-color: #c0392b; }
    .record-btn:hover::after { background: #c0392b; }

    .recording-status {
      font-size: 0.9rem;
      color: #888;
    }
    .recording-status.active { color: #e74c3c; }

    audio {
      width: 100%;
      margin-top: 0.5rem;
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .tab {
      padding: 0.5rem 1rem;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.1);
      color: #888;
    }
    .tab.active {
      background: rgba(0,212,255,0.2);
      border-color: #00d4ff;
      color: #00d4ff;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎙️ PAI Voice Manager</h1>
    <p class="subtitle">Gerencie vozes para o Fish Audio TTS</p>

    <!-- Available Voices -->
    <div class="card">
      <h2>📢 Vozes Disponíveis</h2>
      <div id="voices-grid" class="voices-grid">
        <p style="color: #888">Carregando...</p>
      </div>
    </div>

    <!-- Create New Voice -->
    <div class="card">
      <h2>➕ Criar Nova Voz</h2>

      <div class="tabs">
        <button class="tab active" onclick="switchTab('upload')">📁 Upload</button>
        <button class="tab" onclick="switchTab('record')">🎤 Gravar</button>
      </div>

      <!-- Upload Tab -->
      <div id="tab-upload" class="tab-content active">
        <form id="create-voice-form">
          <div class="form-group">
            <label for="voice-id">ID da Voz (sem espaços)</label>
            <input type="text" id="voice-id" name="id" placeholder="ex: minha-voz, romano, assistente" required pattern="[a-z0-9-]+">
          </div>

          <div class="form-group">
            <label>Áudio de Referência (10-30 segundos)</label>
            <div class="file-input" id="file-drop">
              <div class="icon">📁</div>
              <p>Arraste um arquivo de áudio ou clique para selecionar</p>
              <p style="font-size: 0.8rem; color: #666">WAV, MP3, OGG (máx 10MB)</p>
              <p class="selected" id="file-selected"></p>
              <input type="file" id="audio-file" name="audio" accept="audio/*" required>
            </div>
          </div>

          <div class="form-group">
            <label for="voice-text">Transcrição do Áudio (exatamente o que foi falado)</label>
            <textarea id="voice-text" name="text" placeholder="Digite aqui exatamente o que foi falado no áudio..." required></textarea>
          </div>

          <button type="submit" class="btn-primary">🚀 Criar Voz</button>
        </form>
      </div>

      <!-- Record Tab -->
      <div id="tab-record" class="tab-content">
        <div class="form-group">
          <label for="voice-id-record">ID da Voz (sem espaços)</label>
          <input type="text" id="voice-id-record" placeholder="ex: minha-voz" required pattern="[a-z0-9-]+">
        </div>

        <div class="form-group">
          <label>Gravar Áudio (10-30 segundos)</label>
          <div class="recording-controls">
            <button type="button" class="record-btn" id="record-btn" onclick="toggleRecording()"></button>
            <span class="recording-status" id="recording-status">Clique para gravar</span>
          </div>
          <audio id="recorded-audio" controls style="display: none;"></audio>
        </div>

        <div class="form-group">
          <label for="voice-text-record">Transcrição (o que você vai falar)</label>
          <textarea id="voice-text-record" placeholder="Digite aqui o que você vai falar na gravação..." required></textarea>
        </div>

        <button type="button" class="btn-primary" onclick="createVoiceFromRecording()">🚀 Criar Voz</button>
      </div>

      <div id="status" class="status"></div>
    </div>

    <!-- API Info -->
    <div class="card">
      <h2>🔌 Configuração OpenWebUI</h2>
      <div class="endpoint-info">
        <p><strong>URL do TTS:</strong> <code id="tts-url"></code></p>
        <p><strong>Modelo:</strong> <code>tts-1</code> ou <code>tts-1-hd</code></p>
        <p><strong>Vozes:</strong> <code id="available-voices">alloy, echo, fable, onyx, nova, shimmer</code></p>
        <br>
        <p style="color: #888; font-size: 0.8rem;">
          Vozes customizadas podem ser usadas diretamente pelo ID (ex: <code>jessica-voice</code>)
        </p>
      </div>
    </div>
  </div>

  <script>
    let mediaRecorder;
    let audioChunks = [];
    let recordedBlob = null;

    // Load voices on page load
    async function loadVoices() {
      try {
        const response = await fetch('/v1/voices');
        const data = await response.json();
        const grid = document.getElementById('voices-grid');

        if (data.voices && data.voices.length > 0) {
          grid.innerHTML = data.voices.map(voice => \`
            <div class="voice-item">
              <span class="name">\${voice}</span>
              <div class="actions">
                <button class="btn-secondary" onclick="testVoice('\${voice}')">▶️ Testar</button>
                <button class="btn-danger" onclick="deleteVoice('\${voice}')">🗑️</button>
              </div>
            </div>
          \`).join('');

          document.getElementById('available-voices').textContent =
            'alloy, echo, fable, onyx, nova, shimmer, ' + data.voices.join(', ');
        } else {
          grid.innerHTML = '<p style="color: #888">Nenhuma voz encontrada. Crie uma abaixo!</p>';
        }
      } catch (error) {
        console.error('Error loading voices:', error);
      }
    }

    // Switch tabs
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector(\`[onclick="switchTab('\${tab}')"]\`).classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    }

    // File drag and drop
    const fileDrop = document.getElementById('file-drop');
    const fileInput = document.getElementById('audio-file');

    fileDrop.addEventListener('click', () => fileInput.click());
    fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        document.getElementById('file-selected').textContent = e.dataTransfer.files[0].name;
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        document.getElementById('file-selected').textContent = fileInput.files[0].name;
      }
    });

    // Create voice form
    document.getElementById('create-voice-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('status');
      status.className = 'status loading';
      status.textContent = '⏳ Criando voz...';

      const formData = new FormData(e.target);

      try {
        const response = await fetch('/voices/create', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (response.ok) {
          status.className = 'status success';
          status.textContent = '✅ ' + result.message;
          e.target.reset();
          document.getElementById('file-selected').textContent = '';
          loadVoices();
        } else {
          status.className = 'status error';
          status.textContent = '❌ ' + result.error;
        }
      } catch (error) {
        status.className = 'status error';
        status.textContent = '❌ Erro: ' + error.message;
      }
    });

    // Recording functions
    async function toggleRecording() {
      const btn = document.getElementById('record-btn');
      const statusEl = document.getElementById('recording-status');
      const audioEl = document.getElementById('recorded-audio');

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        statusEl.textContent = 'Processando...';
        statusEl.classList.remove('active');
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];

          mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
          mediaRecorder.onstop = () => {
            recordedBlob = new Blob(audioChunks, { type: 'audio/wav' });
            audioEl.src = URL.createObjectURL(recordedBlob);
            audioEl.style.display = 'block';
            statusEl.textContent = 'Gravação pronta!';
            stream.getTracks().forEach(track => track.stop());
          };

          mediaRecorder.start();
          btn.classList.add('recording');
          statusEl.textContent = '🔴 Gravando...';
          statusEl.classList.add('active');
        } catch (error) {
          alert('Erro ao acessar microfone: ' + error.message);
        }
      }
    }

    async function createVoiceFromRecording() {
      if (!recordedBlob) {
        alert('Grave um áudio primeiro!');
        return;
      }

      const id = document.getElementById('voice-id-record').value;
      const text = document.getElementById('voice-text-record').value;

      if (!id || !text) {
        alert('Preencha todos os campos!');
        return;
      }

      const status = document.getElementById('status');
      status.className = 'status loading';
      status.textContent = '⏳ Criando voz...';

      const formData = new FormData();
      formData.append('id', id);
      formData.append('audio', recordedBlob, 'recording.wav');
      formData.append('text', text);

      try {
        const response = await fetch('/voices/create', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (response.ok) {
          status.className = 'status success';
          status.textContent = '✅ ' + result.message;
          document.getElementById('voice-id-record').value = '';
          document.getElementById('voice-text-record').value = '';
          document.getElementById('recorded-audio').style.display = 'none';
          recordedBlob = null;
          loadVoices();
        } else {
          status.className = 'status error';
          status.textContent = '❌ ' + result.error;
        }
      } catch (error) {
        status.className = 'status error';
        status.textContent = '❌ Erro: ' + error.message;
      }
    }

    // Test voice
    async function testVoice(voiceId) {
      const status = document.getElementById('status');
      status.className = 'status loading';
      status.textContent = '🔊 Testando voz...';

      try {
        const response = await fetch('/voices/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voice: voiceId,
            text: 'Olá! Esta é uma demonstração da minha voz. Posso falar em português e inglês.'
          })
        });

        if (response.ok) {
          const blob = await response.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.play();
          status.className = 'status success';
          status.textContent = '✅ Reproduzindo...';
          audio.onended = () => { status.className = 'status'; };
        } else {
          const result = await response.json();
          status.className = 'status error';
          status.textContent = '❌ ' + result.error;
        }
      } catch (error) {
        status.className = 'status error';
        status.textContent = '❌ Erro: ' + error.message;
      }
    }

    // Delete voice
    async function deleteVoice(voiceId) {
      if (!confirm(\`Tem certeza que deseja excluir a voz "\${voiceId}"?\`)) return;

      const status = document.getElementById('status');
      status.className = 'status loading';
      status.textContent = '🗑️ Excluindo...';

      try {
        const response = await fetch('/voices/' + voiceId, { method: 'DELETE' });
        const result = await response.json();

        if (response.ok) {
          status.className = 'status success';
          status.textContent = '✅ ' + result.message;
          loadVoices();
        } else {
          status.className = 'status error';
          status.textContent = '❌ ' + result.error;
        }
      } catch (error) {
        status.className = 'status error';
        status.textContent = '❌ Erro: ' + error.message;
      }
    }

    // Initial load
    loadVoices();
    document.getElementById('tts-url').textContent = location.origin + '/v1/audio/speech';
  </script>
</body>
</html>`;
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Main server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    // ============ OpenAI Compatible Endpoints ============

    // POST /v1/audio/speech - OpenAI TTS
    if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
      try {
        const data = await req.json();
        const text = data.input;
        const voice = data.voice || "alloy";
        const format = data.response_format || "mp3";

        if (!text) {
          return new Response(
            JSON.stringify({ error: { message: "input is required" } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Map voice to Fish Audio reference_id
        const referenceId = voiceMap[voice] || voice;

        // Extract optional S1 parameters from request
        const speed = data.speed || 1.0;  // 0.5-2.0
        const emotion = data.emotion;      // e.g., "happy", "sad", "excited"

        // Prepare text with emotion marker if provided
        let processedText = text;
        if (emotion) {
          // Add emotion marker at the beginning: "(happy) Hello!"
          processedText = `(${emotion}) ${text}`;
        }

        console.log(`🎙️  TTS request: voice="${voice}" → reference="${referenceId}"${emotion ? ` [${emotion}]` : ""}`);

        const fishResponse = await fetch(`${FISH_AUDIO_URL}/v1/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: processedText,
            format: format === "mp3" ? "mp3" : "wav",
            reference_id: referenceId,
            // Quality parameters for expressiveness
            chunk_length: 250,        // 100-300, higher = better prosody
            temperature: 0.9,         // 0.1-1.0, higher = more expressive/varied
            top_p: 0.85,              // 0.1-1.0, higher = more diverse outputs
            repetition_penalty: 1.1,  // 0.9-2.0, prevents repetitive patterns
            normalize: true,
          }),
          signal: AbortSignal.timeout(120000),  // 2 min timeout for quality mode
        });

        if (!fishResponse.ok) {
          const error = await fishResponse.text();
          console.error(`❌ Fish Audio error: ${error}`);
          return new Response(
            JSON.stringify({ error: { message: `TTS error: ${fishResponse.status}` } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        let audioBuffer = await fishResponse.arrayBuffer();
        console.log(`✅ TTS generated: ${audioBuffer.byteLength} bytes`);

        // Add silence padding to prevent Bluetooth speaker wake-up cutting
        if (AUDIO_PADDING_MS > 0) {
          audioBuffer = await addSilencePadding(audioBuffer, format === "mp3" ? "mp3" : "wav");
          console.log(`✅ TTS padded: ${audioBuffer.byteLength} bytes (+${AUDIO_PADDING_MS}ms)`);
        }

        return new Response(audioBuffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": format === "mp3" ? "audio/mpeg" : "audio/wav",
          },
        });
      } catch (error: any) {
        console.error(`❌ TTS error: ${error.message}`);
        return new Response(
          JSON.stringify({ error: { message: error.message } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // POST /v1/audio/transcriptions - OpenAI STT (proxy to Faster-Whisper)
    if (url.pathname === "/v1/audio/transcriptions" && req.method === "POST") {
      try {
        // Forward the multipart form data directly to STT server
        const sttResponse = await fetch(`${STT_SERVER_URL}/v1/audio/transcriptions`, {
          method: "POST",
          headers: req.headers,
          body: req.body,
          // @ts-ignore - duplex is needed for streaming body
          duplex: "half",
        });

        if (!sttResponse.ok) {
          const error = await sttResponse.text();
          console.error(`❌ STT error: ${error}`);
          return new Response(
            JSON.stringify({ error: { message: `STT error: ${sttResponse.status}` } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        const result = await sttResponse.json();
        console.log(`✅ STT success: "${result.text?.substring(0, 50)}..."`);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.error(`❌ STT error: ${error.message}`);
        return new Response(
          JSON.stringify({ error: { message: error.message } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // POST /v1/audio/translations - Translate to English (proxy to Faster-Whisper)
    if (url.pathname === "/v1/audio/translations" && req.method === "POST") {
      try {
        const sttResponse = await fetch(`${STT_SERVER_URL}/v1/audio/translations`, {
          method: "POST",
          headers: req.headers,
          body: req.body,
          // @ts-ignore
          duplex: "half",
        });

        if (!sttResponse.ok) {
          return new Response(
            JSON.stringify({ error: { message: `Translation error: ${sttResponse.status}` } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        const result = await sttResponse.json();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: { message: error.message } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // GET /v1/models - List models (TTS + STT)
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "tts-1", object: "model", owned_by: "fish-audio", created: Date.now() },
            { id: "tts-1-hd", object: "model", owned_by: "fish-audio", created: Date.now() },
            { id: "whisper-1", object: "model", owned_by: "faster-whisper", created: Date.now() },
          ],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /v1/voices - List voices (extension)
    if (url.pathname === "/v1/voices" && req.method === "GET") {
      await refreshVoices();
      return new Response(
        JSON.stringify({
          voices: voiceList,
          openai_voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
          mapping: voiceMap,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ Voice Management Endpoints ============

    // GET /voices - Web UI
    if (url.pathname === "/voices" && req.method === "GET") {
      return new Response(getVoiceManagerHTML(), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    // POST /voices/create - Create new voice
    if (url.pathname === "/voices/create" && req.method === "POST") {
      try {
        const formData = await req.formData();
        const id = formData.get("id") as string;
        const audio = formData.get("audio") as File;
        const text = formData.get("text") as string;

        if (!id || !audio || !text) {
          return new Response(
            JSON.stringify({ error: "id, audio, and text are required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Validate ID format
        if (!/^[a-z0-9-]+$/.test(id)) {
          return new Response(
            JSON.stringify({ error: "ID must contain only lowercase letters, numbers, and hyphens" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Forward to Fish Audio
        const fishFormData = new FormData();
        fishFormData.append("id", id);
        fishFormData.append("audio", audio);
        fishFormData.append("text", text);

        const response = await fetch(`${FISH_AUDIO_URL}/v1/references/add`, {
          method: "POST",
          body: fishFormData,
        });

        if (!response.ok) {
          const error = await response.text();
          return new Response(
            JSON.stringify({ error: `Fish Audio error: ${error}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        // Refresh voice list
        await refreshVoices();

        console.log(`✅ Voice created: ${id}`);
        return new Response(
          JSON.stringify({ message: `Voz "${id}" criada com sucesso!` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // DELETE /voices/:id - Delete voice
    if (url.pathname.startsWith("/voices/") && req.method === "DELETE") {
      const voiceId = url.pathname.split("/voices/")[1];

      try {
        const response = await fetch(`${FISH_AUDIO_URL}/v1/references/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference_id: voiceId }),
        });

        if (!response.ok) {
          return new Response(
            JSON.stringify({ error: "Failed to delete voice" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        await refreshVoices();
        console.log(`🗑️  Voice deleted: ${voiceId}`);

        return new Response(
          JSON.stringify({ message: `Voz "${voiceId}" excluída com sucesso!` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // POST /voices/test - Test a voice
    if (url.pathname === "/voices/test" && req.method === "POST") {
      try {
        const data = await req.json();
        const voice = data.voice || voiceList[0] || "default";
        const emotion = data.emotion || "friendly";  // Default to friendly for demo
        const text = data.text || "(friendly) Olá! Esta é uma demonstração da minha voz. Posso expressar diferentes emoções!";

        // Add emotion marker if not already in text
        const processedText = text.startsWith("(") ? text : `(${emotion}) ${text}`;

        const fishResponse = await fetch(`${FISH_AUDIO_URL}/v1/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: processedText,
            format: "wav",
            reference_id: voice,
            chunk_length: 250,
            temperature: 0.9,
            top_p: 0.85,
            repetition_penalty: 1.1,
            normalize: true,
          }),
          signal: AbortSignal.timeout(120000),
        });

        if (!fishResponse.ok) {
          return new Response(
            JSON.stringify({ error: "TTS generation failed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
          );
        }

        let audioBuffer = await fishResponse.arrayBuffer();

        // Add padding for Bluetooth speakers
        if (AUDIO_PADDING_MS > 0) {
          audioBuffer = await addSilencePadding(audioBuffer, "wav");
        }

        return new Response(audioBuffer, {
          headers: { ...corsHeaders, "Content-Type": "audio/wav" },
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // GET /health - Health check
    if (url.pathname === "/health") {
      await refreshVoices();

      // Check STT server status
      let sttStatus = { available: false, model: null as string | null };
      try {
        const sttHealth = await fetch(`${STT_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (sttHealth.ok) {
          const data = await sttHealth.json();
          sttStatus = { available: true, model: data.model };
        }
      } catch { /* STT not available */ }

      return new Response(
        JSON.stringify({
          status: "ok",
          tts: {
            provider: "fish-audio",
            url: FISH_AUDIO_URL,
            voices: voiceList,
            voice_count: voiceList.length,
          },
          stt: {
            provider: "faster-whisper",
            url: STT_SERVER_URL,
            available: sttStatus.available,
            model: sttStatus.model,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Root - redirect to voice manager
    if (url.pathname === "/") {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, "Location": "/voices" },
      });
    }

    return new Response("Not Found", { headers: corsHeaders, status: 404 });
  },
});

// Initial voice load
await refreshVoices();

console.log(`
🎙️  OpenAI TTS Wrapper running on port ${PORT}
🐟 Fish Audio backend: ${FISH_AUDIO_URL}

📡 Endpoints:
   POST http://localhost:${PORT}/v1/audio/speech  (OpenAI compatible)
   GET  http://localhost:${PORT}/v1/models        (Model list)
   GET  http://localhost:${PORT}/v1/voices        (Voice list)
   GET  http://localhost:${PORT}/voices           (Web UI)

🌐 Voice Manager UI: http://localhost:${PORT}/voices

📢 Available voices: ${voiceList.join(", ") || "none"}
`);
