// server/prompts/meta-summary.js - メタ要約（長期プロフィール）生成用プロンプト

export const getMetaSummaryPrompt = ({ summaries, currentProfile }) => {
  const summaryTexts = summaries
    .filter(s => s.summary && !s.summary.startsWith('[DRAFT:'))
    .map((s, i) => {
      const parts = [`### セッション${i + 1}（${s.sessionDate || '日付不明'}）`];
      if (s.summary) parts.push(`要約: ${s.summary}`);
      if (s.keyTopics) parts.push(`トピック: ${s.keyTopics}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const currentProfileText = currentProfile?.metaSummary
    ? `## 現在のプロフィール\n${currentProfile.metaSummary}\n\n## 現在の重要事実\n${currentProfile.keyFacts || '（なし）'}\n\n## 現在の趣味・関心\n${currentProfile.interests || '（なし）'}\n\n## 現在の目標\n${currentProfile.goals || '（なし）'}\n\n## 現在の備考\n${currentProfile.notes || '（なし）'}`
    : '（まだプロフィールがありません）';

  return `あなたはユーザーの長期プロフィールを管理するアシスタントです。
過去のセッション要約を読んで、ユーザーについての重要な情報を整理・更新してください。

## タスク
以下のセッション要約を読んで、ユーザーのプロフィールを更新してください。
既存のプロフィールがある場合は、新しい情報で補完・更新してください。

${currentProfileText}

## 新しいセッション要約
${summaryTexts || '（要約なし）'}

## 出力形式（JSON）
\`\`\`json
{
  "metaSummary": "この人についての総合的な説明（3〜5文）",
  "keyFacts": ["重要な事実1", "重要な事実2", "..."],
  "interests": "趣味・好み・関心事（箇条書きまたは文章）",
  "goals": "目標・希望・やりたいこと（箇条書きまたは文章）",
  "notes": "呼び方の好み等の備考（例: 呼び方: ひできさん）"
}
\`\`\`

## 注意点
- 既存の情報は可能な限り保持し、新しい情報で補完する
- 矛盾する情報がある場合は、新しい方を優先
- 推測は避け、セッションで実際に話された内容のみを記録
- 個人情報（住所、電話番号など）は記録しない
- 呼び方の好みがセッション中に言及されていれば notes に「呼び方: ○○さん」の形式で記録する
- 既存の notes がある場合はその内容を保持しつつ更新する
- JSON以外の文字は出力しないこと

## 出力
JSONのみを出力してください。`;
};

export default { getMetaSummaryPrompt };
