// server/prompts/support-record-draft.js
// v2.1.1: 否定表現の正規表現を改善

/**
 * currentDraftの要約
 * - 文字数を増やす（400文字）
 * - 否定表現を含む文を優先して残す
 */
const summarizeForPrompt = (text, maxLength = 400) => {
  if (!text || typeof text !== 'string') {
    return '（未入力）';
  }
  const trimmed = text.trim();
  if (!trimmed) return '（未入力）';
  
  // 短ければそのまま返す
  if (trimmed.length <= maxLength) {
    return trimmed.replace(/\s+/g, ' ');
  }
  
  // 否定表現を含む文を抽出（v2.1.1で改善）
  // - 「〜ない」→ 文末・句読点前の「ない」に修正
  // - 「なし」「不要」「×」を追加
  const negativePatterns = /[^。]*(?:しない|できない|していない|されていない|ない(?:。|、|$|\s)|禁止|不可|不要|NG|なし|注意|避ける|×)[^。]*。?/g;
  const negativeMatches = trimmed.match(negativePatterns) || [];
  
  // 重複除去してユニークな否定文だけ残す
  const uniqueNegatives = [...new Set(negativeMatches)];
  const negativePart = uniqueNegatives.slice(0, 3).join(' ').trim(); // 上位3件に制限
  
  // 否定部分 + 先頭部分で構成
  if (negativePart) {
    const negativeLength = Math.min(negativePart.length, Math.floor(maxLength * 0.4));
    const remainingLength = maxLength - negativeLength - 10; // "【注意】" + "…" の余白
    const headPart = trimmed.slice(0, remainingLength).replace(/\s+/g, ' ');
    return `${headPart}…【注意】${negativePart.slice(0, negativeLength)}`;
  }
  
  // 否定表現がなければ通常の切り詰め
  return `${trimmed.replace(/\s+/g, ' ').slice(0, maxLength - 1)}…`;
};

/**
 * 面談タイプ情報からガイド文を生成
 * JSON側の focusPoints と recordingTips を使用（二重管理解消）
 */
const buildGuideFromMeetingType = (meetingType) => {
  if (!meetingType) {
    return `【記録の基本】
- 会話にない情報は書かない
- 本人の発言は「」で引用
- 誰が・何を・いつまでに`;
  }
  
  const focusPoints = meetingType.focusPoints || [];
  const recordingTips = meetingType.recordingTips || [];
  
  let guide = '';
  
  if (focusPoints.length > 0) {
    guide += `【重視】${focusPoints.join(' / ')}`;
  }
  
  if (recordingTips.length > 0) {
    guide += `\n【記録】${recordingTips.join(' / ')}`;
  }
  
  return guide || '【記録】事実と発言を正確に、決定事項と検討事項を区別';
};

/**
 * メインのプロンプト生成関数
 * 
 * @param {string} transcript - クリーン済み文字起こし
 * @param {object} meetingType - 面談タイプ情報（JSONから取得したオブジェクト）
 * @param {array} sections - セクション定義の配列
 * @param {object} currentDraft - 現在のドラフト内容
 * @returns {string} プロンプト文字列
 */
export function getSupportRecordDraftPrompt(
  transcript,
  meetingType = null,
  sections = [],
  currentDraft = {},
) {
  const meetingName = meetingType?.name || '面談';
  const guide = buildGuideFromMeetingType(meetingType);

  // セクション定義（簡潔に）
  const sectionGuide = sections
    .map((s) => `- ${s.title} (${s.id})`)
    .join('\n');

  // 現在のドラフト（改善版要約）
  const currentContext = sections
    .map((s) => {
      const existing = currentDraft?.[s.id]?.value ?? '';
      const preview = summarizeForPrompt(existing);
      return `[${s.id}] ${preview}`;
    })
    .join('\n');

  // transcriptを先頭寄りに配置（LLMは先頭を重視）
  return `# ${meetingName}の記録作成

## 文字起こし
${transcript}

## ガイド
${guide}

## 項目
${sectionGuide}

## 現在のドラフト
${currentContext}

## ルール
- 会話にない情報は書かない（推測・創作禁止）
- 本人発言は「」引用、数値で表現できるものは数値で
- 既存と同じ内容は繰り返さない
- 訂正・否定があれば replace、追記は append
- 変更不要なら空の sections を返す

## 出力（JSONのみ）
{"sections":[{"id":"xxx","action":"replace|append","text":"..."}]}
`;
}

/**
 * 面談タイプ一覧からIDで検索するヘルパー
 */
export function findMeetingTypeById(meetingTypes, id) {
  return meetingTypes?.find(mt => mt.id === id) || null;
}

export default {
  getSupportRecordDraftPrompt,
  findMeetingTypeById,
};
