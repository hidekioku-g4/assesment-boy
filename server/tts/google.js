// server/tts/google.js — Google Cloud TTS プロバイダ（Chirp 3 HD デフォルト）
import path from 'path';

const TTS_VOICE_NAME = process.env.TTS_VOICE_NAME || 'ja-JP-Chirp3-HD-Leda';
const TTS_LANGUAGE_CODE = process.env.TTS_LANGUAGE_CODE || 'ja-JP';
const TTS_AUDIO_ENCODING = process.env.TTS_AUDIO_ENCODING || 'MP3';
const TTS_SPEAKING_RATE = Number(process.env.TTS_SPEAKING_RATE ?? 1.0);
const TTS_PITCH = Number(process.env.TTS_PITCH ?? 0);

// Chirp 3 HD 日本語ボイス（試聴用に代表的なものを厳選）
// 全30種は /api/tts/voices?all=1 で取得可能
const TTS_VOICE_OPTIONS = [
  // 女性声（面談向けに落ち着き・親しみやすさ重視で選定）
  { id: 'ja-JP-Chirp3-HD-Leda', name: 'Leda (女性・優しい)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Kore', name: 'Kore (女性・明るい)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Aoede', name: 'Aoede (女性・落ち着き)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Autonoe', name: 'Autonoe (女性・はきはき)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Callirrhoe', name: 'Callirrhoe (女性・柔らかい)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Sulafat', name: 'Sulafat (女性・温かみ)', gender: 'FEMALE' },
  { id: 'ja-JP-Chirp3-HD-Vindemiatrix', name: 'Vindemiatrix (女性・知的)', gender: 'FEMALE' },
  // 男性声
  { id: 'ja-JP-Chirp3-HD-Charon', name: 'Charon (男性・落ち着き)', gender: 'MALE' },
  { id: 'ja-JP-Chirp3-HD-Enceladus', name: 'Enceladus (男性・優しい)', gender: 'MALE' },
  { id: 'ja-JP-Chirp3-HD-Orus', name: 'Orus (男性・はきはき)', gender: 'MALE' },
  { id: 'ja-JP-Chirp3-HD-Puck', name: 'Puck (男性・明るい)', gender: 'MALE' },
  { id: 'ja-JP-Chirp3-HD-Algieba', name: 'Algieba (男性・温かみ)', gender: 'MALE' },
];

const resolveCredentialPath = (value) => {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

let ttsClientPromise = null;
const getTtsClient = async () => {
  if (!ttsClientPromise) {
    ttsClientPromise = import('@google-cloud/text-to-speech')
      .then((mod) => {
        const Client = mod.TextToSpeechClient || mod.default?.TextToSpeechClient;
        if (!Client) {
          throw new Error('TextToSpeechClient not found');
        }
        const keyFilename = resolveCredentialPath(
          process.env.GCP_WIF_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
        );
        const projectId =
          process.env.GCP_PROJECT_ID ||
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.BQ_PROJECT_ID ||
          undefined;
        const options = {};
        if (keyFilename) {
          options.keyFilename = keyFilename;
        }
        if (projectId) {
          options.projectId = projectId;
        }
        return new Client(options);
      });
  }
  return ttsClientPromise;
};

/**
 * @param {string} text
 * @param {{ speed?: number, voice?: string, pitch?: number }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function synthesize(text, { speed, voice, pitch } = {}) {
  const voiceName = (typeof voice === 'string' && voice.startsWith('ja-JP-')) ? voice : TTS_VOICE_NAME;
  const isChirp3 = voiceName.includes('Chirp3');
  const speakingRate = Number.isFinite(speed) && speed > 0
    ? Math.max(0.5, Math.min(2.0, speed))
    : TTS_SPEAKING_RATE;
  const pitchVal = Number.isFinite(pitch)
    ? Math.max(-20, Math.min(20, pitch))
    : TTS_PITCH;

  const startTime = Date.now();
  const client = await getTtsClient();
  const clientReady = Date.now();

  const audioConfig = { audioEncoding: TTS_AUDIO_ENCODING };
  if (Number.isFinite(speakingRate) && speakingRate > 0) {
    audioConfig.speakingRate = speakingRate;
  }
  // Chirp 3 HD は pitch 非対応。Neural2/Wavenet/Standard のみに適用
  if (!isChirp3 && Number.isFinite(pitchVal)) {
    audioConfig.pitch = pitchVal;
  }

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: TTS_LANGUAGE_CODE, name: voiceName },
    audioConfig,
  });
  const synthesizeEnd = Date.now();

  const audioContent = response?.audioContent;
  if (!audioContent) {
    throw new Error('tts_empty');
  }

  const buffer = Buffer.isBuffer(audioContent)
    ? audioContent
    : Buffer.from(audioContent, 'base64');
  const contentType =
    TTS_AUDIO_ENCODING === 'MP3'
      ? 'audio/mpeg'
      : TTS_AUDIO_ENCODING === 'OGG_OPUS'
        ? 'audio/ogg'
        : 'audio/wav';

  console.log(`[tts:google] done - Client: ${clientReady - startTime}ms, Synthesize: ${synthesizeEnd - clientReady}ms, Total: ${Date.now() - startTime}ms`);
  return { buffer, contentType };
}

export function getVoices() {
  return { voices: TTS_VOICE_OPTIONS, default: TTS_VOICE_NAME };
}
