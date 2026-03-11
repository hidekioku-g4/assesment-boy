// server/tts/cartesia.js — Cartesia Sonic-3 TTS プロバイダ

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || '';
const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID || '498e7f37-7fa3-4e2c-b8e2-8b6e9276f956';
const CARTESIA_MODEL = 'sonic-3';
const CARTESIA_API_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_API_VERSION = '2025-04-16';
const CHUNK_MAX_CHARS = 450;

// デフォルト速度（0.6-1.5 の範囲、Cartesia のデフォルト 1.0 は日本語では速すぎる）
const CARTESIA_DEFAULT_SPEED = Number(process.env.CARTESIA_DEFAULT_SPEED ?? 0.6);

// 日本語音声プリセット（面談・アセスメント向け6種）
const CARTESIA_VOICE_OPTIONS = [
  { id: '2b568345-1d48-4047-b25f-7baccf842eb0', name: 'Yumiko (フレンドリー・女性)', gender: 'FEMALE' },
  { id: '59d4fd2f-f5eb-4410-8105-58db7661144f', name: 'Yuki (冷静・女性)', gender: 'FEMALE' },
  { id: '498e7f37-7fa3-4e2c-b8e2-8b6e9276f956', name: 'Aiko (安心感・女性)', gender: 'FEMALE' },
  { id: '6b92f628-be90-497c-8f4c-3b035002df71', name: 'Kenji (穏やか・男性)', gender: 'MALE' },
  { id: '49e02441-83ea-4c77-bda8-79fdd7f07e92', name: 'Tohru (コーチ・男性)', gender: 'MALE' },
  { id: 'b8e1169c-f16a-4064-a6e0-95054169e553', name: 'Takashi (プロ・男性)', gender: 'MALE' },
];

const DEFAULT_VOICE_ID = CARTESIA_VOICE_ID;

/**
 * テキストを文単位で分割し、各チャンクが CHUNK_MAX_CHARS 以下になるようにする
 */
function splitIntoChunks(text) {
  const sentences = text.split(/(?<=[。！？\n])/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += sentence;
    if (current.length > CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = '';
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * クライアントの速度値 (0.5-2.0) を Cartesia の speed 値 (0.6-1.5) にマッピング
 * クライアント 0.5 → Cartesia 0.6, クライアント 2.0 → Cartesia 1.5
 */
function mapSpeed(clientSpeed) {
  if (!Number.isFinite(clientSpeed) || clientSpeed <= 1.0) return CARTESIA_DEFAULT_SPEED;
  // クライアント 1.0 以上のみ加速: client [1.0, 2.0] → cartesia [0.6, 1.5]
  const mapped = 0.6 + (clientSpeed - 1.0) * (1.5 - 0.6) / (2.0 - 1.0);
  return Math.max(0.6, Math.min(1.5, mapped));
}

/**
 * Cartesia REST API で1チャンクを合成
 */
async function synthesizeChunk(text, { voiceId, speed, contextId, isContinue }) {
  const body = {
    model_id: CARTESIA_MODEL,
    transcript: text,
    voice: { mode: 'id', id: voiceId },
    // WAV 出力 — MP3 のエンコーダ遅延による頭・尾の途切れを回避
    output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
    language: 'ja',
    generation_config: {
      speed: mapSpeed(speed),
    },
  };

  // context_id によるチャンク間の韻律一貫性
  if (contextId) {
    body.context_id = contextId;
    body.continue = isContinue;
  }

  const t0 = Date.now();
  const resp = await fetch(CARTESIA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CARTESIA_API_KEY}`,
      'Cartesia-Version': CARTESIA_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const ttfb = Date.now() - t0;

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Cartesia API error ${resp.status}: ${errText}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`[tts:cartesia] chunk "${text.slice(0, 20)}..." TTFB:${ttfb}ms, download:${Date.now() - t0 - ttfb}ms, ${buf.length} bytes`);
  return buf;
}

/**
 * WAV バッファから PCM データのみ抽出（44バイトヘッダーをスキップ）
 * 複数チャンクの結合時に必要（ヘッダーが音声データとして再生されるのを防ぐ）
 */
function extractPcmData(wavBuffer) {
  // 標準 WAV ヘッダーは 44 バイト。"data" チャンクの開始位置を探す
  const riff = wavBuffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') return wavBuffer; // WAV でなければそのまま返す

  // "data" サブチャンクを探す（拡張ヘッダー対応）
  let offset = 12; // "RIFF" + size + "WAVE" の後
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return wavBuffer.subarray(offset + 8, offset + 8 + chunkSize);
    }
    offset += 8 + chunkSize;
  }
  // "data" が見つからなければ 44 バイト目以降を返す（フォールバック）
  return wavBuffer.subarray(44);
}

/**
 * PCM データに WAV ヘッダーを付与
 */
function createWavBuffer(pcmData, sampleRate = 44100, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * @param {string} text
 * @param {{ speed?: number, voice?: string, pitch?: number }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function synthesize(text, { speed, voice } = {}) {
  if (!CARTESIA_API_KEY) {
    throw new Error('CARTESIA_API_KEY is not configured');
  }

  const voiceId = CARTESIA_VOICE_OPTIONS.some(v => v.id === voice) ? voice : DEFAULT_VOICE_ID;
  const startTime = Date.now();

  const chunks = splitIntoChunks(text);
  const contextId = chunks.length > 1 ? `ctx-${Date.now()}` : undefined;
  const buffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const isContinue = i < chunks.length - 1;
    const buf = await synthesizeChunk(chunks[i], {
      voiceId,
      speed,
      contextId,
      isContinue,
    });
    buffers.push(buf);
  }

  let buffer;
  if (buffers.length === 1) {
    buffer = buffers[0];
  } else {
    // 複数チャンク: 各 WAV から PCM のみ抽出して結合し、新しい WAV ヘッダーを付与
    const pcmParts = buffers.map(b => extractPcmData(b));
    const combinedPcm = Buffer.concat(pcmParts);
    buffer = createWavBuffer(combinedPcm, 24000, 1, 16);
  }

  console.log(`[tts:cartesia] done - ${chunks.length} chunk(s), speed:${mapSpeed(speed).toFixed(2)}, ${Date.now() - startTime}ms, ${buffer.length} bytes`);

  return { buffer, contentType: 'audio/wav' };
}

export function getVoices() {
  return { voices: CARTESIA_VOICE_OPTIONS, default: DEFAULT_VOICE_ID };
}
