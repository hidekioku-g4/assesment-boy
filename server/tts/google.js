// server/tts/google.js — Google Cloud TTS プロバイダ
import path from 'path';

const TTS_VOICE_NAME = process.env.TTS_VOICE_NAME || 'ja-JP-Neural2-B';
const TTS_LANGUAGE_CODE = process.env.TTS_LANGUAGE_CODE || 'ja-JP';
const TTS_AUDIO_ENCODING = process.env.TTS_AUDIO_ENCODING || 'MP3';
const TTS_SPEAKING_RATE = Number(process.env.TTS_SPEAKING_RATE ?? 1.25);
const TTS_PITCH = Number(process.env.TTS_PITCH ?? 0);

const TTS_VOICE_OPTIONS = [
  { id: 'ja-JP-Neural2-B', name: 'Neural2-B (女性・標準)', gender: 'FEMALE' },
  { id: 'ja-JP-Neural2-C', name: 'Neural2-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Neural2-D', name: 'Neural2-D (男性・低め)', gender: 'MALE' },
  { id: 'ja-JP-Wavenet-A', name: 'Wavenet-A (女性)', gender: 'FEMALE' },
  { id: 'ja-JP-Wavenet-B', name: 'Wavenet-B (女性・落ち着き)', gender: 'FEMALE' },
  { id: 'ja-JP-Wavenet-C', name: 'Wavenet-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Wavenet-D', name: 'Wavenet-D (男性・落ち着き)', gender: 'MALE' },
  { id: 'ja-JP-Standard-A', name: 'Standard-A (女性・軽量)', gender: 'FEMALE' },
  { id: 'ja-JP-Standard-B', name: 'Standard-B (女性)', gender: 'FEMALE' },
  { id: 'ja-JP-Standard-C', name: 'Standard-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Standard-D', name: 'Standard-D (男性)', gender: 'MALE' },
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
  const voiceName = TTS_VOICE_OPTIONS.some(v => v.id === voice) ? voice : TTS_VOICE_NAME;
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
  if (Number.isFinite(pitchVal)) {
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
