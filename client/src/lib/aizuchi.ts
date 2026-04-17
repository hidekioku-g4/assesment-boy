type AizuchiEntry = {
  id: string;
  text: string;
  category: string;
  file: string;
  buffer?: AudioBuffer;
};

// 即座の相槌に使う安全な短いフレーズのみ
const INSTANT_IDS = ['un', 'unun', 'hee'];
const COOLDOWN_MS = 8000;

let entries: AizuchiEntry[] = [];
let loaded = false;
let lastPlayedTime = 0;
let lastPlayedId = '';

export async function preloadAizuchi(audioCtx: AudioContext): Promise<void> {
  if (loaded) return;
  try {
    const res = await fetch('/assets/aizuchi/manifest.json');
    if (!res.ok) return;
    const manifest: AizuchiEntry[] = await res.json();

    const decoded = await Promise.all(
      manifest.map(async (entry) => {
        try {
          const audioRes = await fetch(`/assets/aizuchi/${entry.file}`);
          const arrayBuf = await audioRes.arrayBuffer();
          const buffer = await audioCtx.decodeAudioData(arrayBuf);
          return { ...entry, buffer };
        } catch {
          return entry;
        }
      }),
    );

    entries = decoded.filter((e) => e.buffer);
    loaded = true;
    console.log(`[aizuchi] preloaded ${entries.length} files`);
  } catch (err) {
    console.warn('[aizuchi] preload failed:', err);
  }
}

export function findAizuchiBuffer(text: string): AudioBuffer | null {
  if (!loaded) return null;
  const trimmed = text.trim().replace(/[。！？、]/g, '');
  const match = entries.find((e) => e.text === trimmed);
  return match?.buffer ?? null;
}

export function pickInstantAizuchi(): { buffer: AudioBuffer; id: string; text: string } | null {
  if (!loaded) return null;
  const now = Date.now();
  if (now - lastPlayedTime < COOLDOWN_MS) return null;

  const candidates = entries.filter(
    (e) => INSTANT_IDS.includes(e.id) && e.id !== lastPlayedId && e.buffer,
  );
  if (candidates.length === 0) return null;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return { buffer: pick.buffer!, id: pick.id, text: pick.text };
}

export function playAizuchiBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  analyser: AnalyserNode | null,
  id: string,
): { source: AudioBufferSourceNode; gain: GainNode; endTime: number } {
  const gain = audioCtx.createGain();
  gain.gain.value = 0.85;

  if (analyser) {
    gain.connect(analyser);
    analyser.connect(audioCtx.destination);
  } else {
    gain.connect(audioCtx.destination);
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);

  const startTime = Math.max(audioCtx.currentTime, 0);
  source.start(startTime);
  const endTime = startTime + buffer.duration;

  lastPlayedTime = Date.now();
  lastPlayedId = id;

  console.log(`[aizuchi] playing: ${id} (${buffer.duration.toFixed(2)}s)`);

  return { source, gain, endTime };
}

export function isAizuchiReady(): boolean {
  return loaded && entries.length > 0;
}

export function getAizuchiCooldownRemaining(): number {
  return Math.max(0, COOLDOWN_MS - (Date.now() - lastPlayedTime));
}
