// server/safety.js - 安全フィルター（危機検出 + 出力チェック）

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
