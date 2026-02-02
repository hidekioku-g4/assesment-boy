// server/prompts/realtime.js - リアルタイム解析プロンプト

export const SUPPORT_RECORD_SECTIONS = [
  {
    id: 'session_overview',
    title: '今日の話',
    focus: 'セッション全体の流れ・目的・気持ちや背景の変化を1〜2文で要約する。',
  },
  {
    id: 'current_status',
    title: '今の状況',
    focus: '仕事や生活で感じていること、強み・困りごとなどの最新の状況を簡潔に記す。',
  },
  {
    id: 'support_plan',
    title: 'やっていくこと',
    focus: '決めたことや、これからやっていくことをまとめる。',
  },
  {
    id: 'next_actions',
    title: '次回までにやること',
    focus: '次回までにやることや確認することを、箇条書きまたは短文で整理する。',
  },
  {
    id: 'shared_notes',
    title: 'メモ・共有事項',
    focus: '大切なことや覚えておきたいこと、誰かに伝えたいことを記録する。',
  },
];

const summarizeForPrompt = (text) => {
  if (!text || typeof text !== 'string') {
    return '（未入力）';
  }
  const trimmed = text.trim();
  if (!trimmed) return '（未入力）';
  if (trimmed.length <= 220) return trimmed.replace(/\s+/g, ' ');
  return `${trimmed.replace(/\s+/g, ' ').slice(0, 200)}…`;
};

export function getRealtimePrompt(
  transcriptChunk,
  previousContext = { topics: [], supportRecord: {} },
) {
  const topicsContext =
    previousContext?.topics && previousContext.topics.length > 0
      ? previousContext.topics
          .map((topic, index) => {
            const safeId = topic?.id ?? `topic_${index + 1}`;
            const safeTitle = (topic?.title || '').trim() || '（タイトル未設定）';
            return `- ${safeId}: ${safeTitle}`;
          })
          .join('\n')
      : '（まだトピックはありません）';

  const supportRecordContext = SUPPORT_RECORD_SECTIONS.map((section) => {
    const current =
      previousContext?.supportRecord?.[section.id]?.value ?? '';
    const preview = summarizeForPrompt(current);
    return `- ${section.title} (${section.id})\n  現在: ${preview}`;
  }).join('\n');

  const trimmedChunk = typeof transcriptChunk === 'string' ? transcriptChunk.trim() : '';

  return `あなたはセッションをリアルタイムに要約・整理するアシスタントです。
最新の書き起こし内容をもとに、以下の3つのタスクを同時に処理してください。

# 既存のトピック履歴
${topicsContext}

# 既存の記録ドラフト
${supportRecordContext}

# タスクA: リアルタイム分類 (classifications)
- 大切な発言を短い文章1〜2文でまとめ、「What / So What / Now What」のいずれかのカテゴリに振り分ける。
- 同じ内容を繰り返さないように注意する。新しい気づきや行動があった場合だけ追加する。

# タスクB: トピック検出 (topic)
- 進行中の話題を継続する場合は \`{"action":"continue_topic","id":"既存id"}\` を返す。
- 新しい話題が始まった場合のみ \`{"action":"new_topic","id":"topic_N","title":"10文字程度のラベル"}\` を生成する。
- タイトルは簡潔な日本語で、わかりやすい言葉を使う。

# タスクC: 記録ドラフトの更新 (support_record.sections)
- 以下の5項目に対して、書き起こしから得られた新しい情報を整理し、必要な欄だけを更新する。
- 出力する際は各項目ごとに \`{"id": "...","action": "append|replace","text": "..."}\` の形式で返す。
  - \`append\`: 既存の記録に追記すべき場合。短い箇条書きや1〜2文を追加する。
  - \`replace\`: 内容を置き換える方が自然な場合（例: 考えが大きく変わった）。置換する文章全体を含める。
- 各項目で新情報が無い場合は、その項目を出力しない。
- 文章は日本語で書く。大切なことは具体的に残す。

項目ごとのフォーカス:
- session_overview: 今日の話のテーマ・目的・気持ちといった大枠。
- current_status: 生活リズム、仕事のこと、課題など今の状況。
- support_plan: 決めたことや、これからやっていくこと。
- next_actions: 次回までにやること、確認すること。
- shared_notes: 覚えておきたいこと、誰かに伝えたいこと。

## JSON出力例
{
  "classifications": [
    {"text": "朝の遅刻が3日続いている", "category": "What"},
    {"text": "生活リズムを整えたいと思った", "category": "So What"}
  ],
  "topic": {
    "action": "new_topic",
    "id": "topic_3",
    "title": "生活リズムのこと"
  },
  "support_record": {
    "sections": [
      {"id": "current_status", "action": "append", "text": "朝の起床が不安定で10時を過ぎる日が続いている。"},
      {"id": "next_actions", "action": "append", "text": "- 7時起床を目指して記録をつける"}
    ]
  }
}

# 対象となる最新の書き起こし
${trimmedChunk}

# 出力ルール
- JSONのみを返す。コードブロックや補足説明は不要。
- 変更がないセクション・フィールドは省略する。
- 空文字列や意味のない文は返さない。
- 出力の最初と最後に余分な文字を付けない。`;
}

export default {
  getRealtimePrompt,
  SUPPORT_RECORD_SECTIONS,
};
