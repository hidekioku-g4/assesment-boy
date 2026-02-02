export const getSessionSummaryPrompt = ({
  cleanedText,
  supportRecord,
  meetingTypeName,
  talentName,
  sessionDate,
}) => {
  const lines = [
    'あなたはセッション内容を要約するアシスタントです。',
    '',
    '## タスク',
    '以下のセッション内容を要約し、次回に向けた情報を整理してください。',
    '',
    '## 出力形式（JSON）',
    '```json',
    '{',
    '  "summary": "セッションの要約（3〜5文程度）",',
    '  "keyTopics": ["主なトピック1", "主なトピック2", "主なトピック3"],',
    '  "nextSuggestions": ["次回話したいこと1", "次回話したいこと2"]',
    '}',
    '```',
    '',
    '## 要約のポイント',
    '- 話した内容や気持ちを簡潔にまとめる',
    '- 次回のセッションで話したいことや確認したいことを残す',
    '- 具体的なエピソードや数字があれば含める',
    '',
    '## セッション情報',
    `- セッション日: ${sessionDate || '不明'}`,
    `- セッションタイプ: ${meetingTypeName || '不明'}`,
    `- お名前: ${talentName || '不明'}`,
  ];

  if (supportRecord) {
    lines.push('', '## 支援記録', supportRecord);
  }

  if (cleanedText) {
    lines.push('', '## 文字起こし（クリーニング済み）', cleanedText);
  }

  lines.push('', '## 出力', 'JSONのみを出力してください。説明は不要です。');

  return lines.join('\n');
};

// 初回用の議題例（ランダムで1つ選ばれる）
const TOPIC_EXAMPLES = [
  {
    theme: '最近の生活リズム',
    question: '最近、朝起きる時間や夜寝る時間はどんな感じですか？',
  },
  {
    theme: '体調について',
    question: '最近の体調はいかがですか？疲れやすかったり、気になることはありますか？',
  },
  {
    theme: '仕事や作業のこと',
    question: '最近のお仕事や作業で、うまくいったことや困ったことはありますか？',
  },
  {
    theme: '人間関係',
    question: '職場や周りの人との関係で、何か気になることはありますか？',
  },
  {
    theme: '楽しかったこと',
    question: '最近、楽しかったことや嬉しかったことはありますか？',
  },
  {
    theme: '頑張っていること',
    question: '最近、自分なりに頑張っていることや挑戦していることはありますか？',
  },
  {
    theme: 'ストレスや不安',
    question: '最近、ストレスに感じることや不安なことはありますか？',
  },
  {
    theme: '目標について',
    question: 'これからやってみたいことや、目標にしていることはありますか？',
  },
  {
    theme: '休日の過ごし方',
    question: 'お休みの日はどんなふうに過ごしていますか？',
  },
  {
    theme: '食事や健康',
    question: '最近、食事はちゃんと取れていますか？好きな食べ物とかありますか？',
  },
];

const getRandomTopic = () => {
  const index = Math.floor(Math.random() * TOPIC_EXAMPLES.length);
  return TOPIC_EXAMPLES[index];
};

// 要約から次回の提案を抽出
const extractNextSuggestions = (summaries) => {
  if (!Array.isArray(summaries)) return [];
  const suggestions = [];
  for (const s of summaries) {
    if (s.nextSuggestions) {
      try {
        const parsed = typeof s.nextSuggestions === 'string'
          ? JSON.parse(s.nextSuggestions)
          : s.nextSuggestions;
        if (Array.isArray(parsed)) {
          suggestions.push(...parsed);
        }
      } catch {
        // JSONパース失敗時はそのまま文字列として追加
        if (typeof s.nextSuggestions === 'string' && s.nextSuggestions.trim()) {
          suggestions.push(s.nextSuggestions.trim());
        }
      }
    }
  }
  return suggestions.filter(Boolean).slice(0, 3); // 最大3つ
};

// メタ要約（長期プロフィール）をプロンプトに追加するヘルパー
const formatUserProfile = (userProfile) => {
  if (!userProfile?.metaSummary) return '';
  const parts = ['## この利用者さんについて（長期プロフィール）'];
  parts.push(userProfile.metaSummary);
  if (userProfile.interests) {
    parts.push(`趣味・関心: ${userProfile.interests}`);
  }
  if (userProfile.goals) {
    parts.push(`目標: ${userProfile.goals}`);
  }
  parts.push('');
  return parts.join('\n');
};

export const getAgendaSuggestionPrompt = ({
  summaries,
  userName,
  meetingTypeName,
  sessionDate,
  suggestedTopics = [], // 話してほしい議題（配列）
  userProfile = null, // メタ要約（長期プロフィール）
}) => {
  const isFirstTime = !Array.isArray(summaries) || summaries.length === 0;
  const nextSuggestions = extractNextSuggestions(summaries);
  const hasNextSuggestions = nextSuggestions.length > 0;
  const hasSuggestedTopics = Array.isArray(suggestedTopics) && suggestedTopics.length > 0;
  const profileText = formatUserProfile(userProfile);

  // 指定された議題がある場合は最優先
  if (hasSuggestedTopics) {
    const topicsText = suggestedTopics.join('、');
    const lines = [
      'あなたは就労継続支援事業所の利用者さんと会話するアシスタントです。',
      '',
      profileText,
      '## タスク',
      '今日話してほしい議題が指定されています。その中から1つを選んで自然に話題として提案してください。',
      '',
      '## 今日の議題候補',
      topicsText,
      '',
      '## 回答スタイル',
      '- 日本語で回答',
      '- 自然な会話調で2〜3文程度',
      userName ? `- 「${userName}さん！」で始める挨拶` : '- 「こんにちは！」や「おはようございます！」から始める',
      '- 議題を押し付けず、「今日は○○についてお話ししようと思ってるんですが、どうですか？」のように提案',
      '- 「他に話したいことがあればそちらでも大丈夫です」と選択肢を与える',
      '- 箇条書きは使わない',
      '',
      '## 出力例',
      `「${userName || ''}さん！おはようございます！今日は「${suggestedTopics[0] || ''}」についてお話ししようと思ってるんですが、いかがですか？もちろん、他に話したいことがあればそちらでも大丈夫です！」`,
      '',
      '## 出力',
      '挨拶と議題提案メッセージのみを出力してください。',
    ];
    return lines.join('\n');
  }

  if (isFirstTime) {
    // 初回利用の場合は自己紹介をお願いするオープンクエスチョン
    const lines = [
      'あなたは就労継続支援事業所の利用者さんと会話するアシスタントです。',
      '',
      '## タスク',
      'この利用者さんの初回利用です。親しみやすい挨拶をして、まずは相手のことを知りたいというスタンスで、自己紹介をお願いしてください。',
      '',
      '## 回答スタイル',
      '- 日本語で回答',
      '- 自然な会話調で2〜3文程度',
      userName ? `- 「${userName}さん！はじめまして！」で始める` : '- 「こんにちは！」や「はじめまして！」から始める',
      '- 「もしよかったら、あなたのことを教えてください」という姿勢で',
      '- 好きなこと、趣味、どんな人か、など自由に話してもらえるようなオープンクエスチョン',
      '- 押し付けがましくなく、「無理にとは言いませんが」的なニュアンスも入れる',
      '- 箇条書きは使わない',
      '',
      '## 出力例',
      userName
        ? `「${userName}さん！はじめまして！今日からよろしくお願いします。もしよかったら、あなたのことを教えていただけますか？好きなことや趣味、どんなことに興味があるかなど、何でも大丈夫です！」`
        : '「はじめまして！今日からよろしくお願いします。もしよかったら、あなたのことを教えていただけますか？好きなことや趣味、どんなことに興味があるかなど、何でも大丈夫です！」',
      '',
      '## 出力',
      '挨拶と自己紹介のお願いメッセージのみを出力してください。',
    ];
    return lines.join('\n');
  }

  // 前回の要約に「次回への提案」があればそれを優先
  if (hasNextSuggestions) {
    const suggestionText = nextSuggestions.join('、');
    const lines = [
      'あなたは就労継続支援事業所の利用者さんと会話するアシスタントです。',
      '',
      profileText,
      '## タスク',
      '前回のセッションで確認すべきとされた内容があります。それを議題として提案しつつ、他に話したいことがあればそちらでもOKと伝えてください。',
      '',
      '## 前回からの引き継ぎ議題',
      suggestionText,
      '',
      '## 回答スタイル',
      '- 日本語で回答',
      '- 自然な会話調で2〜3文程度',
      userName ? `- 「${userName}さん！」で始める挨拶` : '- 「こんにちは！」から始める',
      '- 前回の内容を踏まえて「前回○○だったので、今日は△△について確認しようと思っていました」のような形で',
      '- 「他に話したいことがあればそちらでも大丈夫です」と選択肢を与える',
      '- 最後に「どうしましょう？」や「いかがですか？」で締める',
      '- 箇条書きは使わない',
      '',
      '## 出力例',
      `「${userName || ''}さん！こんにちは！前回のお話で気になっていた「${nextSuggestions[0] || ''}」について、今日確認しようと思っていましたが、何か他に話したいことがあれば、そちらでも大丈夫です！どうしましょう？」`,
      '',
      '## 出力',
      '挨拶と議題提案メッセージのみを出力してください。',
    ];
    return lines.join('\n');
  }

  const lines = [
    'あなたは就労継続支援事業所の利用者さんと会話するアシスタントです。',
    '',
    profileText,
    '## タスク',
    'この利用者さんの過去のセッション要約をもとに、今日話し合いたいことや確認事項を提案してください。',
    '',
    '## 回答スタイル',
    '- 日本語で回答',
    '- 自然な会話調で2〜4文程度',
    '- 「前回は○○についてお話しましたね。今日は△△について一緒に考えてみませんか？」のような形式',
    '- 箇条書きは使わない',
    '- 利用者さん本人に語りかける形で',
    '',
    '## 今日のセッション情報',
    `- セッション日: ${sessionDate || '本日'}`,
    `- セッションタイプ: ${meetingTypeName || 'セッション'}`,
    userName ? `- お名前: ${userName}` : '',
    '',
    '## 過去のセッション要約',
  ].filter(Boolean);

  summaries.forEach((s, index) => {
    lines.push(
      '',
      `### ${index + 1}. ${s.sessionDate || '日付不明'}（${s.meetingTypeName || 'セッション'}）`,
      s.summary || '（要約なし）',
    );
    if (s.keyTopics) {
      lines.push(`主なトピック: ${s.keyTopics}`);
    }
    if (s.nextSuggestions) {
      lines.push(`次回への提案: ${s.nextSuggestions}`);
    }
  });

  lines.push('', '## 出力', '議題提案のメッセージのみを出力してください。');

  return lines.join('\n');
};
