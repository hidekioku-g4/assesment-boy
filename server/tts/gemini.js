// server/tts/gemini.js — Gemini 3.1 Flash TTS プロバイダ（Audio tags 対応・Preview）
import { GoogleGenAI } from '@google/genai';
import { preprocessTtsText } from './preprocess.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE || 'Leda';
const SAMPLE_RATE = 24000;

// Gemini TTS で利用可能な音声（30種、ja含め全言語で同じ名前セット）
// Chirp 3 HD と同じ命名なので既存のボイス選択 UI をそのまま使える
const GEMINI_VOICE_OPTIONS = [
  // 女性声
  { id: 'Leda', name: 'Leda (女性・優しい)', gender: 'FEMALE' },
  { id: 'Kore', name: 'Kore (女性・明るい)', gender: 'FEMALE' },
  { id: 'Aoede', name: 'Aoede (女性・落ち着き)', gender: 'FEMALE' },
  { id: 'Autonoe', name: 'Autonoe (女性・はきはき)', gender: 'FEMALE' },
  { id: 'Callirrhoe', name: 'Callirrhoe (女性・柔らかい)', gender: 'FEMALE' },
  { id: 'Sulafat', name: 'Sulafat (女性・温かみ)', gender: 'FEMALE' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix (女性・知的)', gender: 'FEMALE' },
  // 男性声
  { id: 'Charon', name: 'Charon (男性・落ち着き)', gender: 'MALE' },
  { id: 'Enceladus', name: 'Enceladus (男性・優しい)', gender: 'MALE' },
  { id: 'Orus', name: 'Orus (男性・はきはき)', gender: 'MALE' },
  { id: 'Puck', name: 'Puck (男性・明るい)', gender: 'MALE' },
  { id: 'Algieba', name: 'Algieba (男性・温かみ)', gender: 'MALE' },
];

let clientPromise = null;
const getClient = () => {
  if (!clientPromise) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    clientPromise = Promise.resolve(new GoogleGenAI({ apiKey: GEMINI_API_KEY }));
  }
  return clientPromise;
};

// Chirp 3 HD と同じ ja-JP-Chirp3-HD-Xxx 形式の voice ID が来たら Xxx だけ抽出
function normalizeVoice(voice) {
  if (typeof voice !== 'string' || !voice) return DEFAULT_VOICE;
  const match = voice.match(/ja-JP-Chirp3-HD-(\w+)/);
  if (match) return match[1];
  if (GEMINI_VOICE_OPTIONS.some(v => v.id === voice)) return voice;
  return DEFAULT_VOICE;
}

// PCM 24kHz 16bit mono の生データに WAV ヘッダを付与
function pcmToWav(pcmBuf, sampleRate = SAMPLE_RATE) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuf.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuf.length, 40);
  return Buffer.concat([header, pcmBuf]);
}

/**
 * @param {string} text
 * @param {{ speed?: number, voice?: string }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function synthesize(text, { voice } = {}) {
  // Gemini TTS は漢字を正しく読むので kuromoji 前処理は不要
  const preprocessed = preprocessTtsText(text, { skipKuromoji: true, keepKanji: true });
  const voiceName = normalizeVoice(voice);
  const startTime = Date.now();

  const ai = await getClient();
  const response = await ai.models.generateContent({
    model: GEMINI_TTS_MODEL,
    contents: [{ parts: [{ text: preprocessed }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const audioPart = response?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data);
  const b64 = audioPart?.inlineData?.data;
  if (!b64) {
    throw new Error('gemini_tts_empty');
  }
  const pcmBuf = Buffer.from(b64, 'base64');
  const wavBuf = pcmToWav(pcmBuf);
  console.log(`[tts:gemini] done - voice:${voiceName}, model:${GEMINI_TTS_MODEL}, ${Date.now() - startTime}ms, ${wavBuf.length} bytes`);
  return { buffer: wavBuf, contentType: 'audio/wav' };
}

/**
 * SSE ストリーミング互換ラッパー。Gemini 3.1 Flash TTS は一括応答なので
 * 生成完了後に PCM を単一チャンクで emit する。
 */
export async function synthesizeStream(rawText, { voice, onChunk, onDone, onError }) {
  try {
    const text = preprocessTtsText(rawText.trim(), { skipKuromoji: true });
    if (!text) {
      onError(new Error('empty text'));
      return;
    }
    const voiceName = normalizeVoice(voice);
    const t0 = Date.now();

    const ai = await getClient();
    const response = await ai.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const audioPart = response?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data);
    const b64 = audioPart?.inlineData?.data;
    if (!b64) {
      onError(new Error('gemini_tts_empty'));
      return;
    }
    console.log(`[tts:gemini-stream] TTFA: ${Date.now() - t0}ms, voice:${voiceName}, text: "${text.slice(0, 30)}..."`);
    onChunk(b64);
    console.log(`[tts:gemini-stream] done in ${Date.now() - t0}ms, text: ${text.length} chars`);
    onDone();
  } catch (err) {
    console.error(`[tts:gemini-stream] error: ${err.message}`);
    onError(err);
  }
}

export function getVoices() {
  return { voices: GEMINI_VOICE_OPTIONS, default: DEFAULT_VOICE };
}

export async function warmup() {
  // Gemini API は初回接続時に遅延するので、空リクエストでウォームアップ
  try {
    await getClient();
    console.log('[tts:gemini] warmup done');
  } catch (err) {
    console.warn('[tts:gemini] warmup failed', err.message);
  }
}

export const STREAM_SAMPLE_RATE = SAMPLE_RATE;
