// server/tts/index.js — TTS プロバイダルーター（Cartesia / Google / Gemini 切替 + フォールバック）
import * as cartesia from './cartesia.js';
import * as google from './google.js';
import * as gemini from './gemini.js';

const provider = process.env.TTS_PROVIDER || 'google';
const fallback = process.env.TTS_FALLBACK || '';

const providers = { cartesia, google, gemini };

function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown TTS provider: ${name}`);
  return p;
}

/**
 * @param {string} text
 * @param {{ speed?: number, voice?: string, pitch?: number }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function synthesize(text, options) {
  try {
    return await getProvider(provider).synthesize(text, options);
  } catch (err) {
    if (fallback && fallback !== provider) {
      console.warn(`[tts] ${provider} failed, falling back to ${fallback}:`, err.message);
      return await getProvider(fallback).synthesize(text, options);
    }
    throw err;
  }
}

export function getVoices() {
  return getProvider(provider).getVoices();
}
