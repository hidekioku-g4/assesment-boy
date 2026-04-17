// server/tts/preprocess.js — TTS テキスト前処理（ふりがな・辞書置換・形態素解析）
import kuromoji from 'kuromoji';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TTS読み上げ用の単語置換辞書（読み間違え対策）
const TTS_PRONUNCIATION_MAP = {
  // 例: 'Thankslab': 'サンクスラボ',
  // 例: 'アセス君': 'アセスくん',
};

// ─── kuromoji 初期化 ───
let tokenizer = null;
let tokenizerReady = false;
const tokenizerPromise = new Promise((resolve) => {
  const dicPath = path.join(__dirname, '..', '..', 'node_modules', 'kuromoji', 'dict');
  kuromoji.builder({ dicPath }).build((err, _tokenizer) => {
    if (err) {
      console.error('[tts:preprocess] kuromoji init failed:', err.message);
      resolve(null);
      return;
    }
    tokenizer = _tokenizer;
    tokenizerReady = true;
    console.log('[tts:preprocess] kuromoji ready');
    resolve(_tokenizer);
  });
});

// カタカナ → ひらがな変換
function kataToHira(str) {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

// 漢字を含むかチェック
function containsKanji(str) {
  return /[\u4E00-\u9FFF]/.test(str);
}

/**
 * kuromoji で固有名詞・人名の漢字を読み仮名に変換
 * 一般的な漢字はそのまま残す（Cartesiaの自然なイントネーションを維持）
 */
function applyKuromojiReadings(text) {
  if (!tokenizer) return text;

  const tokens = tokenizer.tokenize(text);
  let result = '';

  for (const token of tokens) {
    const surface = token.surface_form;
    const pos = token.pos;           // 品詞（名詞, 動詞, etc.）
    const posDetail = token.pos_detail_1; // 品詞詳細（固有名詞, 一般, etc.）
    const reading = token.reading;   // カタカナ読み

    // 漢字を含まないトークンはそのまま
    if (!containsKanji(surface)) {
      result += surface;
      continue;
    }

    // 読みが無い場合はそのまま
    if (!reading) {
      result += surface;
      continue;
    }

    const hiraReading = kataToHira(reading);

    // 固有名詞（人名・地名・組織名）→ 必ず読みに置換
    if (pos === '名詞' && (posDetail === '固有名詞' || posDetail === '人名')) {
      result += hiraReading;
      continue;
    }

    // それ以外の漢字語はそのまま（Cartesiaに自然に読ませる）
    result += surface;
  }

  return result;
}

/**
 * @param {string} text
 * @param {{ skipKuromoji?: boolean, keepKanji?: boolean }} options
 *   - skipKuromoji: kuromoji 形態素解析をスキップ（Chirp 3 HD / Gemini TTS 用）
 *   - keepKanji: ふりがなアノテーションの漢字を残す（LLM ベース TTS 用）
 *     true:  漢字《よみ》 → 漢字（漢字を残して抑揚を維持）
 *     false: 漢字《よみ》 → よみ（Cartesia 等の旧 TTS 用）
 */
export function preprocessTtsText(text, options = {}) {
  const { skipKuromoji = false, keepKanji = false } = options;
  let result = text;

  // 1. Geminiの読み仮名アノテーション処理
  const beforeFurigana = result;
  if (keepKanji) {
    // LLM ベース TTS: 漢字を残し、《よみ》アノテーションだけ除去
    // 漢字から文脈を読んで自然な抑揚をつけるため
    result = result.replace(/《[^》]+》/g, '');
  } else {
    // 旧 TTS: 漢字《よみ》 → よみ に置換
    result = result.replace(
      /[\u4E00-\u9FFF\u30A0-\u30FFー][\u3040-\u309F\u4E00-\u9FFF\u30A0-\u30FFー]*《([^》]+)》/g,
      '$1'
    );
  }
  if (beforeFurigana !== result) {
    console.log(`[tts] furigana処理(keepKanji=${keepKanji}): "${beforeFurigana.slice(0, 80)}" → "${result.slice(0, 80)}"`);
  }

  // 2. kuromoji で固有名詞の漢字を読みに変換
  //    Chirp 3 HD / Gemini TTS など文脈を正しく読めるTTSでは skip する
  if (!skipKuromoji && tokenizerReady) {
    const beforeKuromoji = result;
    result = applyKuromojiReadings(result);
    if (beforeKuromoji !== result) {
      console.log(`[tts] kuromoji処理: "${beforeKuromoji.slice(0, 80)}" → "${result.slice(0, 80)}"`);
    }
  }

  // 3. 辞書による置換（誤読する固有名詞の補正用）
  for (const [word, pronunciation] of Object.entries(TTS_PRONUNCIATION_MAP)) {
    result = result.replaceAll(word, pronunciation);
  }

  return result;
}

/**
 * kuromoji の初期化を待つ（サーバー起動時に呼ぶ）
 */
export async function warmupTokenizer() {
  await tokenizerPromise;
  console.log(`[tts:preprocess] tokenizer ready: ${tokenizerReady}`);
}
