// server/prompts/support-record-refine.js

export function getSupportRecordRefinePrompt(
  cleanedText,
  meetingTypeName = null,
  sections = [],
) {
  const meetingLine = meetingTypeName ? `面談タイプ: ${meetingTypeName}` : '面談タイプ: 未設定';
  const sectionGuide = sections
    .map((section) => {
      const title = section?.title ?? section?.id ?? 'セクション';
      const helper = section?.helperText ? ` / 書き方のヒント: ${section.helperText}` : '';
      return `- ${title} (${section.id})${helper}`;
    })
    .join('\n');

  const sectionBody = sections
    .map((section) => {
      const title = section?.title ?? section?.id ?? 'セクション';
      const value = typeof section?.value === 'string' ? section.value.trim() : '';
      const body = value ? value : '（空）';
      return `## ${title} (${section.id})\n${body}`;
    })
    .join('\n\n');

  return `あなたはセッション記録を整える編集者です。
${meetingLine}

# 全体文脈（クリーン済み文字起こし）
${cleanedText}

# セクション定義
${sectionGuide}

# 各セクションの現在内容
${sectionBody}

# 指示
- 内容の意味は変えない
- 誤字脱字・語尾の揺れ・重複を整える
- セクションの趣旨に沿って読みやすく整形する
- 会話にない情報は追加しない
- 断定できないことは断定しない
- 箇条書きは維持（不要なら短く整理）
- 空のセクションは空のままにする

# 出力形式（JSONのみ）
{
  "sections": [
    { "id": "session_overview", "text": "..." },
    { "id": "next_actions", "text": "..." }
  ]
}
`;
}

export default {
  getSupportRecordRefinePrompt,
};
