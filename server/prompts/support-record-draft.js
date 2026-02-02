// server/prompts/support-record-draft.js

const summarizeForPrompt = (text) => {
  if (!text || typeof text !== 'string') {
    return '（未入力）';
  }
  const trimmed = text.trim();
  if (!trimmed) return '（未入力）';
  if (trimmed.length <= 240) return trimmed.replace(/\s+/g, ' ');
  return `${trimmed.replace(/\s+/g, ' ').slice(0, 220)}…`;
};

export function getSupportRecordDraftPrompt(
  transcript,
  meetingTypeName = null,
  sections = [],
  currentDraft = {},
) {
  const meetingLine = meetingTypeName ? `面談タイプ: ${meetingTypeName}` : '面談タイプ: 未設定';

  const sectionGuide = sections
    .map((section) => {
      const title = section?.title ?? section?.id ?? '項目';
      const helper = section?.helperText ? ` / 目的: ${section.helperText}` : '';
      return `- ${title} (${section.id})${helper}`;
    })
    .join('\n');

  const currentContext = sections
    .map((section) => {
      const existing = currentDraft?.[section.id]?.value ?? '';
      const preview = summarizeForPrompt(existing);
      return `- ${section.id}: ${preview}`;
    })
    .join('\n');

  return `あなたはセッション記録を作成するアシスタントです。
${meetingLine}

# 項目定義
${sectionGuide}

# 現在のドラフト（参考）
${currentContext}

# クリーン済み文字起こし（直近の追加分）
${transcript}

# 指示
- 会話にない情報は書かない
- 話した内容・気持ち・やりたいこと・決めたことを中心に、簡潔な日本語で書く
- 既存の内容と同じことは繰り返さない
- 訂正や否定があれば replace を使う
- 追記なら action は "append"、全体を書き直すなら "replace"
- 変更が必要な項目だけ出力する

# 出力形式（JSONのみ）
{
  "sections": [
    { "id": "session_overview", "action": "replace", "text": "..." },
    { "id": "next_actions", "action": "append", "text": "- やること: ..." }
  ]
}
`;
}

export default {
  getSupportRecordDraftPrompt,
};
