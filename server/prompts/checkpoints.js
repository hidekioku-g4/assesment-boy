// server/prompts/checkpoints.js

export function getCheckpointPrompt(transcript, checkpoints = [], meetingTypeName = null) {
  const header = meetingTypeName ? `面談タイプ: ${meetingTypeName}` : '面談タイプ: 未指定';
  const checklist = checkpoints
    .map(
      (item, index) =>
        `${index + 1}. id="${item.id}" / label="${item.label}"`,
    )
    .join('\n');

  return `あなたは記録アシスタントです。以下のセッション文字起こしを読み、指定されたチェックポイントごとに「話題として十分触れられているか」をジャッジしてください。

# セッション情報
${header}

# チェックポイント一覧
${checklist}

# 文字起こし
${transcript.trim()}

# 出力フォーマット
JSON のみを返してください（キー以外に文章を書かない）。形式:
{
  "checkpoints": [
    {
      "id": "checkpoint id",
      "status": "hit" | "miss",
      "confidence": 0〜1 の数値,
      "rationale": "根拠となる短い説明"
    }
  ]
}

- status は「十分に言及されている」なら hit、それ以外は miss にしてください。
- confidence は0〜1で主観的な確信度を示してください。
- rationale には根拠となる要約（日本語）を40文字以内で記載してください。
- 会話に一切出ていない場合や断片的で足りない場合は miss にし、理由を明示してください。
- checkpoint の順番・id は入力に合わせてください。`;
}

export default {
  getCheckpointPrompt,
};
