// server/safety.js - 安全フィルター（危機検出 + 出力チェック + 通知）

const CRISIS_WEBHOOK_URL = process.env.CRISIS_WEBHOOK_URL || '';
const CRISIS_NOTIFY_EMAIL = process.env.CRISIS_NOTIFY_EMAIL || '';

// 危機キーワードパターン（入力チェック用）
const CRISIS_PATTERNS = [
  /死にたい/,
  /消えたい/,
  /いなくなりたい/,
  /生きる意味/,
  /自[分殺].*傷/,
  /リスカ|リストカット/,
  /OD|オーバードーズ/,
  /首.*吊/,
  /飛び降り/,
  /もう.*(?:無理|限界|嫌|だめ|ダメ).*(?:全部|何もかも|全て)/,
  /(?:全部|何もかも|全て).*(?:嫌|無理|終わり)/,
  /誰にも.*(?:会いたくない|話したくない|必要とされ)/,
  /(?:生きて|存在して).*(?:意味ない|価値ない)/,
];

// 間接的な危機表現（コンテキスト付きで判定）
const INDIRECT_PATTERNS = [
  /楽になりたい/,
  /もう疲れた.*(?:全部|何もかも)/,
  /居場所.*ない/,
  /(?:誰も|何も).*(?:わかってくれない|助けてくれない)/,
];

/**
 * ユーザーメッセージの危機レベルを判定
 * @returns {{ level: 'none' | 'indirect' | 'direct', matched: string[] }}
 */
export function detectCrisis(message) {
  if (!message || typeof message !== 'string') return { level: 'none', matched: [] };
  const text = message.trim();

  const directMatches = CRISIS_PATTERNS.filter(p => p.test(text)).map(p => p.source);
  if (directMatches.length > 0) {
    return { level: 'direct', matched: directMatches };
  }

  const indirectMatches = INDIRECT_PATTERNS.filter(p => p.test(text)).map(p => p.source);
  if (indirectMatches.length > 0) {
    return { level: 'indirect', matched: indirectMatches };
  }

  return { level: 'none', matched: [] };
}

/**
 * 危機検出時にプロンプトに注入する追加コンテキスト
 */
export function getCrisisContext(level) {
  if (level === 'direct') {
    return [
      '【緊急: この発言は深刻な危機を示唆しています】',
      '以下を必ず守ってください:',
      '1. まず受け止める（「そこまで辛いんですね…話してくれてありがとうございます」）',
      '2. 絶対に否定・軽視・解決策の提示をしない',
      '3. 一人で抱えないでほしいと伝える',
      '4. 「信頼できる人や、いのちの電話（0570-783-556）に相談してみてほしい」と具体的に伝える',
      '5. 普段の友人ロールを超えてOK。相手の安全が最優先',
    ].join('\n');
  }
  if (level === 'indirect') {
    return [
      '【注意: この発言は辛い状況を示唆しています】',
      '普段より慎重に:',
      '- まず共感と受け止めを優先',
      '- 解決策や励ましは控える',
      '- 「もっと話してくれますか？」と丁寧に促す',
      '- 状況が深刻そうなら、専門家への相談をさりげなく提案',
    ].join('\n');
  }
  return '';
}

// 出力安全フィルター用パターン
const UNSAFE_OUTPUT_PATTERNS = [
  /(?:自殺|自傷).*(?:方法|やり方|手順)/,
  /(?:薬|睡眠薬|農薬).*(?:量|何錠|致死)/,
  /(?:首|手首).*(?:切り方|吊り方)/,
  /(?:飛び降り|身投げ).*(?:場所|ビル|橋)/,
  /一緒に死/,
];

/**
 * LLM出力の安全チェック
 * @returns {{ safe: boolean, reason: string }}
 */
export function checkOutputSafety(text) {
  if (!text || typeof text !== 'string') return { safe: true, reason: '' };

  for (const pattern of UNSAFE_OUTPUT_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: pattern.source };
    }
  }
  return { safe: true, reason: '' };
}

export const SAFE_FALLBACK_RESPONSE = '[mode:respond][表情:sad] 辛い気持ちを話してくれてありがとうございます。一人で抱え込まないでほしいです。もし今すごく辛かったら、いのちの電話（0570-783-556）や、身近な信頼できる人に話してみてください。私もここで聞いていますからね。';

const LLM_CRISIS_PROMPT = `あなたは就労支援施設のメンタルヘルス安全システムです。
ユーザーの発言を分析し、危機レベルを判定してください。

判定基準:
- direct: 自殺念慮、自傷意図、「死にたい」「消えたい」等の直接表現、または間接的でも文脈から深刻な危機が読み取れる場合
- indirect: 強い疲弊感、孤立感、絶望感、無力感を示唆する発言。「しんどい」「頑張れない」「もう終わり」「逃げたい」等
- none: 上記に該当しない通常の発言

以下の形式で回答（1行のみ）:
LEVEL:direct または LEVEL:indirect または LEVEL:none

注意:
- 日本語の間接的・婉曲的な表現に注意してください
- 「大丈夫」と言いつつ辛さが透ける場合はindirect
- 迷ったらindirect寄りに判定（見逃すより誤検出が安全）`;

/**
 * LLMベースの危機判定（正規表現で検出できない間接表現を捕捉）
 * @param {string} message
 * @param {object} genAI - GoogleGenAI instance
 * @param {string} model - model name
 * @returns {Promise<{level: 'none'|'indirect'|'direct', source: 'llm'}>}
 */
export async function detectCrisisLLM(message, genAI, model = 'gemini-2.0-flash') {
  if (!message || !genAI) return { level: 'none', source: 'llm' };

  try {
    const result = await genAI.models.generateContent({
      model,
      config: {
        systemInstruction: LLM_CRISIS_PROMPT,
        maxOutputTokens: 20,
        temperature: 0,
      },
      contents: [{ role: 'user', parts: [{ text: message }] }],
    });
    const output = (result?.text ?? '').trim();
    const match = output.match(/LEVEL:(direct|indirect|none)/i);
    const level = match ? match[1].toLowerCase() : 'none';
    return { level, source: 'llm' };
  } catch (error) {
    console.error('[safety] LLM crisis detection failed (fallback to none)', error?.message);
    return { level: 'none', source: 'llm_error' };
  }
}

/**
 * 危機検出時にWebhookで即時通知（Google Chat / Slack / Teams 等）
 * 非同期・非ブロッキング。失敗してもユーザーへの応答に影響しない。
 */
export async function notifyCrisis({ userName, crisisLevel, matchedPatterns, userMessage, eventType }) {
  if (!CRISIS_WEBHOOK_URL) return;

  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const excerpt = userMessage ? userMessage.slice(0, 100) : '';
  const levelEmoji = crisisLevel === 'direct' ? '🚨' : '⚠️';

  const text = [
    `${levelEmoji} **危機検出アラート** (${eventType || 'crisis_detected'})`,
    `時刻: ${timestamp}`,
    `利用者: ${userName || '不明'}`,
    `レベル: ${crisisLevel}`,
    `パターン: ${(matchedPatterns || []).join(', ')}`,
    excerpt ? `発言（抜粋）: ${excerpt}...` : '',
    '',
    '※ スタッフによる確認・フォローアップをお願いします',
  ].filter(Boolean).join('\n');

  try {
    const body = CRISIS_WEBHOOK_URL.includes('chat.googleapis.com')
      ? JSON.stringify({ text })
      : CRISIS_WEBHOOK_URL.includes('hooks.slack.com')
        ? JSON.stringify({ text })
        : JSON.stringify({ text, title: `${levelEmoji} 危機検出: ${userName || '不明'}` });

    await fetch(CRISIS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    console.log(`[safety] crisis notification sent for ${userName}`);
  } catch (error) {
    console.error('[safety] crisis notification failed (non-blocking)', error?.message || error);
  }
}
