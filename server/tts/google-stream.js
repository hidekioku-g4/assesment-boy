// server/tts/google-stream.js — Google Chirp 3 HD ストリーミング TTS（低レイテンシ）
import path from 'path';
import { preprocessTtsText } from './preprocess.js';

const DEFAULT_VOICE = process.env.GOOGLE_TTS_VOICE || 'ja-JP-Chirp3-HD-Leda';
const LANGUAGE_CODE = 'ja-JP';
const SAMPLE_RATE = 24000;

const resolveCredentialPath = (value) => {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

let ttsClientPromise = null;
const getTtsClient = async () => {
  if (!ttsClientPromise) {
    ttsClientPromise = import('@google-cloud/text-to-speech').then((mod) => {
      const Client = mod.TextToSpeechClient || mod.default?.TextToSpeechClient;
      const keyFilename = resolveCredentialPath(
        process.env.GCP_WIF_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
      );
      const projectId =
        process.env.GCP_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.BQ_PROJECT_ID ||
        undefined;
      const options = {};
      if (keyFilename) options.keyFilename = keyFilename;
      if (projectId) options.projectId = projectId;
      return new Client(options);
    });
  }
  return ttsClientPromise;
};

function mapSpeed(clientSpeed) {
  if (!Number.isFinite(clientSpeed) || clientSpeed <= 0) return 1.0;
  return Math.max(0.25, Math.min(2.0, clientSpeed));
}

/**
 * ストリーミング TTS — Chirp 3 HD の streamingSynthesize を利用
 * @param {string} rawText
 * @param {{ speed?: number, voice?: string, onChunk: (base64: string) => void, onDone: () => void, onError: (err: Error) => void }} options
 */
export async function synthesizeStream(rawText, { speed, voice, onChunk, onDone, onError }) {
  // Chirp 3 HD は漢字・文脈を正しく読むので kuromoji 前処理は最小限（ふりがなアノテーションだけ処理）
  const text = preprocessTtsText(rawText.trim(), { skipKuromoji: true, keepKanji: true });
  if (!text) {
    onError(new Error('empty text'));
    return;
  }

  const voiceName = (typeof voice === 'string' && voice.includes('Chirp3')) ? voice : DEFAULT_VOICE;
  const speakingRate = mapSpeed(speed);

  try {
    const client = await getTtsClient();
    const t0 = Date.now();
    let firstChunkTime = null;

    const stream = client.streamingSynthesize();

    stream.on('data', (response) => {
      const audio = response?.audioContent;
      if (!audio || audio.length === 0) return;
      if (!firstChunkTime) {
        firstChunkTime = Date.now();
        console.log(`[tts:google-stream] TTFA: ${firstChunkTime - t0}ms, voice: ${voiceName}, text: "${text.slice(0, 30)}..."`);
      }
      const base64 = Buffer.isBuffer(audio) ? audio.toString('base64') : Buffer.from(audio).toString('base64');
      onChunk(base64);
    });

    stream.on('error', (err) => {
      console.error('[tts:google-stream] error:', err.message);
      onError(err);
    });

    stream.on('end', () => {
      console.log(`[tts:google-stream] done in ${Date.now() - t0}ms, text: ${text.length} chars`);
      onDone();
    });

    // 1. config フレーム
    stream.write({
      streamingConfig: {
        voice: { languageCode: LANGUAGE_CODE, name: voiceName },
        streamingAudioConfig: {
          audioEncoding: 'PCM',
          sampleRateHertz: SAMPLE_RATE,
          speakingRate,
        },
      },
    });

    // 2. input フレーム（テキスト投入）
    stream.write({ input: { text } });

    // 3. 終了
    stream.end();
  } catch (err) {
    console.error('[tts:google-stream] setup failed:', err.message);
    onError(err);
  }
}

export async function warmup() {
  try {
    await getTtsClient();
    console.log('[tts:google-stream] warmup done');
  } catch (err) {
    console.warn('[tts:google-stream] warmup failed', err.message);
  }
}

export const STREAM_SAMPLE_RATE = SAMPLE_RATE;
