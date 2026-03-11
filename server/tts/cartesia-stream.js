// server/tts/cartesia-stream.js — Cartesia WebSocket ストリーミング TTS（低レイテンシ）
import WebSocket from 'ws';
import { preprocessTtsText } from './preprocess.js';

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || '';
const CARTESIA_API_VERSION = '2025-04-16';
const CARTESIA_WS_URL = `wss://api.cartesia.ai/tts/websocket?api_key=${CARTESIA_API_KEY}&cartesia_version=${CARTESIA_API_VERSION}`;
const CARTESIA_MODEL = 'sonic-3';
const CARTESIA_DEFAULT_SPEED = Number(process.env.CARTESIA_DEFAULT_SPEED ?? 0.6);
const SAMPLE_RATE = 24000;

// 持続的 WebSocket 接続（再利用でハンドシェイク省略 → レイテンシ削減）
let persistentWs = null;
let wsReady = false;
let pendingResolvers = new Map(); // contextId → { onChunk, onDone, onError }

function mapSpeed(clientSpeed) {
  if (!Number.isFinite(clientSpeed) || clientSpeed <= 1.0) return CARTESIA_DEFAULT_SPEED;
  const mapped = 0.6 + (clientSpeed - 1.0) * (1.5 - 0.6) / (2.0 - 1.0);
  return Math.max(0.6, Math.min(1.5, mapped));
}

function ensureConnection() {
  return new Promise((resolve, reject) => {
    if (persistentWs && wsReady && persistentWs.readyState === WebSocket.OPEN) {
      resolve(persistentWs);
      return;
    }

    // 既存接続をクリーンアップ
    if (persistentWs) {
      try { persistentWs.close(); } catch {}
      persistentWs = null;
      wsReady = false;
    }

    const t0 = Date.now();
    const ws = new WebSocket(CARTESIA_WS_URL);
    persistentWs = ws;

    ws.on('open', () => {
      wsReady = true;
      console.log(`[tts:stream] WebSocket connected in ${Date.now() - t0}ms`);
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const ctxId = msg.context_id;
        const handler = pendingResolvers.get(ctxId);
        if (!handler) return;

        if (msg.type === 'chunk' && msg.data) {
          handler.onChunk(msg.data); // base64 encoded PCM
        } else if (msg.type === 'done' || msg.done) {
          handler.onDone();
          pendingResolvers.delete(ctxId);
        } else if (msg.type === 'error' || msg.error) {
          handler.onError(new Error(msg.error || msg.message || 'cartesia_ws_error'));
          pendingResolvers.delete(ctxId);
        }
      } catch (err) {
        console.warn('[tts:stream] parse error', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[tts:stream] WebSocket error', err.message);
      wsReady = false;
      // reject pending handlers
      for (const [, handler] of pendingResolvers) {
        handler.onError(err);
      }
      pendingResolvers.clear();
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`[tts:stream] WebSocket closed (${code})`);
      wsReady = false;
      persistentWs = null;
      for (const [, handler] of pendingResolvers) {
        handler.onError(new Error(`ws_closed_${code}`));
      }
      pendingResolvers.clear();
    });
  });
}

/**
 * ストリーミング TTS — SSE コールバック方式
 * @param {string} rawText
 * @param {{ speed?: number, voice?: string, onChunk: (base64: string) => void, onDone: () => void, onError: (err: Error) => void }} options
 */
export async function synthesizeStream(rawText, { speed, voice, onChunk, onDone, onError }) {
  const text = preprocessTtsText(rawText.trim());
  if (!text) {
    onError(new Error('empty text'));
    return;
  }

  const ws = await ensureConnection();
  const contextId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t0 = Date.now();
  let firstChunkTime = null;

  pendingResolvers.set(contextId, {
    onChunk: (base64Data) => {
      if (!firstChunkTime) {
        firstChunkTime = Date.now();
        console.log(`[tts:stream] TTFA: ${firstChunkTime - t0}ms, text: "${text.slice(0, 30)}..."`);
      }
      onChunk(base64Data);
    },
    onDone: () => {
      console.log(`[tts:stream] done in ${Date.now() - t0}ms, text: ${text.length} chars`);
      onDone();
    },
    onError: (err) => {
      console.error(`[tts:stream] error: ${err.message}`);
      onError(err);
    },
  });

  const msg = {
    model_id: CARTESIA_MODEL,
    transcript: text,
    voice: { mode: 'id', id: voice || process.env.CARTESIA_VOICE_ID || '498e7f37-7fa3-4e2c-b8e2-8b6e9276f956' },
    output_format: {
      container: 'raw',
      encoding: 'pcm_s16le',
      sample_rate: SAMPLE_RATE,
    },
    language: 'ja',
    context_id: contextId,
    generation_config: {
      speed: mapSpeed(speed),
    },
  };

  ws.send(JSON.stringify(msg));
}

/**
 * WebSocket 接続をプリウォーム（起動時に呼ぶ）
 */
export async function warmup() {
  try {
    await ensureConnection();
    console.log('[tts:stream] warmup done');
  } catch (err) {
    console.warn('[tts:stream] warmup failed', err.message);
  }
}

export const STREAM_SAMPLE_RATE = SAMPLE_RATE;
