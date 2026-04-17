// scripts/generate-aizuchi.js
// Pre-generate aizuchi (backchanneling) audio files for real-time playback
// Usage: node scripts/generate-aizuchi.js

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Google Cloud TTS
const VOICE_NAME = process.env.TTS_VOICE_NAME || 'ja-JP-Chirp3-HD-Leda';

const AIZUCHI_PHRASES = [
  { id: 'un', text: 'うん', category: 'agree' },
  { id: 'unun', text: 'うんうん', category: 'agree' },
  { id: 'sounandesune', text: 'そうなんですね', category: 'empathy' },
  { id: 'hee', text: 'へぇ', category: 'interest' },
  { id: 'naruhodo', text: 'なるほど', category: 'understanding' },
  { id: 'tashikani', text: 'たしかに', category: 'agree' },
  { id: 'iidesune', text: 'いいですね', category: 'positive' },
  { id: 'soudesuka', text: 'そうですか', category: 'empathy' },
  { id: 'wakaru', text: 'わかります', category: 'empathy' },
  { id: 'otsukaresama', text: 'お疲れ様です', category: 'care' },
];

async function generateWithGoogleTTS(text) {
  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  const client = new TextToSpeechClient();

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: 'ja-JP',
      name: VOICE_NAME,
    },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 24000,
      speakingRate: 1.0,
    },
  });

  return response.audioContent;
}

async function main() {
  const outDir = resolve('public/assets/aizuchi');
  mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${AIZUCHI_PHRASES.length} aizuchi audio files...`);
  console.log(`Voice: ${VOICE_NAME}`);
  console.log(`Output: ${outDir}`);
  console.log('');

  const manifest = [];

  for (const phrase of AIZUCHI_PHRASES) {
    try {
      process.stdout.write(`  ${phrase.id} (${phrase.text})... `);
      const audioContent = await generateWithGoogleTTS(phrase.text);
      const filePath = resolve(outDir, `${phrase.id}.wav`);
      writeFileSync(filePath, audioContent);
      manifest.push({
        id: phrase.id,
        text: phrase.text,
        category: phrase.category,
        file: `${phrase.id}.wav`,
      });
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  // Write manifest JSON
  const manifestPath = resolve(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${manifestPath}`);
  console.log(`Generated ${manifest.length}/${AIZUCHI_PHRASES.length} files`);
}

main().catch(console.error);
