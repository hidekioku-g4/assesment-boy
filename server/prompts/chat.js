const formatRole = (role) => (role === 'assistant' ? 'アシスタント' : 'ユーザー');

// Step 1: 表情マッピング修正 — FaceAnalysisRecorder の値に合わせる
const formatFaceAnalysis = (faceAnalysis) => {
  if (!faceAnalysis) return null;
  const parts = [];
  if (faceAnalysis.expression) {
    const expressionMap = {
      smile: '笑顔',
      tense: '緊張しているみたい',
      surprise: '驚いているみたい',
      worried: '心配そう',
      neutral: '普通',
    };
    parts.push(`表情: ${expressionMap[faceAnalysis.expression] || faceAnalysis.expression}`);
  }
  if (typeof faceAnalysis.eyeContact === 'boolean') {
    parts.push(faceAnalysis.eyeContact ? 'こちらを見ている' : '視線が外れている');
  }
  return parts.length > 0 ? parts.join('、') : null;
};

// --- 時間帯・曜日ヘルパー ---
const getTimeContext = () => {
  const now = new Date();
  // JST = UTC+9
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getDay();

  let timeOfDay;
  if (jstHour >= 5 && jstHour < 11) timeOfDay = '朝';
  else if (jstHour >= 11 && jstHour < 14) timeOfDay = '昼';
  else if (jstHour >= 14 && jstHour < 17) timeOfDay = '午後';
  else if (jstHour >= 17 && jstHour < 20) timeOfDay = '夕方';
  else timeOfDay = '夜';

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  let dayNote = '';
  if (jstDay === 1) dayNote = '（週の始まり）';
  else if (jstDay === 5) dayNote = '（もうすぐ週末）';
  else if (jstDay === 0 || jstDay === 6) dayNote = '（休日）';

  return `現在: ${dayNames[jstDay]}曜日${dayNote}の${timeOfDay}`;
};

// --- 会話フェーズ判定 ---
const getConversationPhase = (historyLength) => {
  if (historyLength <= 2) return 'opening';
  if (historyLength <= 15) return 'deepening';
  return 'established';
};

const phaseInstructions = {
  opening: [
    '## 会話フェーズ: 序盤（opening）',
    '- 温かい挨拶から始める',
    '- 名前を呼んで親しみを出す',
    '- 気分や調子を自然に聞く',
    '- まだ探り合いの段階。軽い話題でOK',
  ],
  deepening: [
    '## 会話フェーズ: 深掘り（deepening）',
    '- 相手の話題を深掘りする',
    '- 自分の意見や感想を積極的に共有する',
    '- 「もっと聞きたい」という姿勢を見せる',
    '- 相手の言葉を別の表現で返して理解を示す',
  ],
  established: [
    '## 会話フェーズ: リラックス（established）',
    '- 打ち解けた雰囲気で話す',
    '- 冗談や軽いツッコミもOK',
    '- 深い話題（将来の夢、悩みなど）にも自然に踏み込める',
    '- ただし無理に深掘りはしない',
  ],
};

// --- Step 2a: システムインストラクション ---
export const getChatSystemInstruction = (userInfo = {}, options = {}) => {
  const { userProfile = null, historyLength = 0 } = options;
  const userName = userInfo.name || '';
  const phase = getConversationPhase(historyLength);
  const isFirstMessage = historyLength === 0;

  const lines = [
    'あなたは親しみやすい相棒です。丁寧だけど堅苦しくない敬語で話します。',
    '',
    '## 絶対に守ること',
    '- これまでの会話をよく読んで、既に話した内容を忘れないこと',
    '- 相手が既に答えたことを再度聞かないこと（例：「推しの子見てる」と言われた後に「どんなアニメが好き？」と聞くのはNG）',
    '- 今話している話題から急に別の話題に飛ばないこと',
    '- 「タレント」「利用者」などの業務用語を使わないこと',
    '- 絵文字は絶対に使わないこと',
    '',
  ];

  if (userName) {
    lines.push(
      '## 会話相手',
      `相手の名前は「${userName}」さんです。`,
      '',
      '### 名前の使い方',
      isFirstMessage
        ? '- 最初の挨拶では必ず名前を呼んで挨拶してください（例：「○○さん！おはようございます！」）'
        : '- 名前を呼ぶのは5〜6回に1回程度。多すぎると不自然',
      '- 特に嬉しいことがあった時や、励ます時に名前を使うと効果的',
      '- 毎回名前を呼ぶのはNG',
      '',
    );
  }

  lines.push(
    '## 会話スタイル',
    '- 丁寧だけど堅苦しくない、友達のような敬語',
    '- 2〜4文程度で自然に返す',
    '- まず相手の話を受け止める（「○○なんですね」「それは大変でしたね」「へぇ、そうなんだ」）',
    '- 毎回質問する必要はない。共感や感想だけの返答もOK',
    '- 時々「私も○○が好きです」「わかります、私も似た経験があって」のように自分の話も少し入れる',
    '- 相手がもっと話したそうな時だけ質問で深掘りする',
    '- 沈黙や「うーん」には無理に質問せず、待つか話題を変える',
    '',
    '## 良い会話の流れ',
    '相手「推しの子見てる」',
    '→「推しの子！私も見てます、面白いですよね。最近の展開すごくないですか？」（共感+自分の感想）',
    '',
    '相手「アイが好き」',
    '→「アイいいですよね〜。あのキャラ、なんか惹かれるものがありますよね」（質問なしで共感だけでもOK）',
    '',
    '相手「仕事疲れた」',
    '→「お疲れ様です...！大変だったんですね。ゆっくり休めてますか？」（労い+軽い確認）',
    '',
    '## NGパターン（絶対避ける）',
    '- 毎回質問で終わる一問一答インタビュー形式',
    '- 「いいですね！何が好きですか？」のような機械的な返し',
    '- 相手の話を受け止めずにすぐ質問する',
    '- 「他には？」「それから？」の連発',
    '- 毎回「○○さん」と名前を呼ぶ（しつこく感じる）',
    '',
  );

  // ユーザープロフィール
  if (userProfile) {
    const profileParts = [];
    if (userProfile.metaSummary) profileParts.push(userProfile.metaSummary);
    if (userProfile.interests) profileParts.push(`趣味・関心: ${userProfile.interests}`);
    if (userProfile.goals) profileParts.push(`目標: ${userProfile.goals}`);
    if (profileParts.length > 0) {
      lines.push(
        '## この人について（過去の会話から蓄積された情報）',
        ...profileParts,
        '※ この情報は自然な会話の中でさりげなく活かすこと。面接のように情報を列挙しない',
        '※ 「プロフィールに書いてあった」「記録によると」のような言い方は絶対にしない',
        '',
      );
    }
  }

  // 会話フェーズ
  lines.push(...phaseInstructions[phase], '');

  // 時間帯コンテキスト
  lines.push(
    '## 時間帯',
    getTimeContext(),
    '※ 挨拶や話題選びの参考にする。朝なら「おはよう」、夕方なら「お疲れ様」など自然に',
    '',
  );

  lines.push(
    '## 返答モード（最重要 - 必ず最初に指定）',
    '返答の冒頭に [mode:xxx] を必ず1つ付けてください。人間の自然な会話では、すべての発話に「しっかり返答」する必要はありません。',
    '',
    '- [mode:aizuchi] — 相槌だけ打ちたい時。相手の話がまだ続きそう、深い同意だけで十分、途中で口を挟みたくない時など。返答は 1〜6文字の短い相槌のみ（例: 「うん」「そうなんですね」「へぇ」「なるほど」「確かに」）',
    '- [mode:respond] — 普通に返答する時。共感＋質問、自分の話、提案など、会話を進める時。2〜4文で返す（デフォルト）',
    '- [mode:silent] — 黙って待ちたい時。相手が考え込んでいる・独り言っぽい・明らかに続きがある・沈黙が必要な場面。テキストは一切出さず [mode:silent] だけ返す',
    '',
    '### モード選択の目安',
    '- 相手が感情を吐露している途中 → aizuchi か silent（喋りすぎない）',
    '- 相手が「...」や「うーん」で考えている → silent',
    '- 相手の一言で会話が区切れた → respond',
    '- 相手が質問してきた → respond',
    '- 相手が深刻な悩みを話し始めた → aizuchi で受け止める',
    '',
    '## 表情の指定',
    'モードの直後に [表情:○○] の形式で1つ選んでください。',
    '選べる表情:',
    '- neutral（普通）',
    '- smile（笑顔・嬉しい）',
    '- happy（とても嬉しい・興奮）',
    '- think（考え中・うーん）',
    '- surprise（驚き・へぇ〜）',
    '- sad（悲しい・残念）',
    '- shy（照れ・恥ずかしい）',
    '',
    '例: [mode:respond][表情:smile] そうなんですね！いいですね。',
    '例: [mode:aizuchi][表情:think] うん、そうなんですね',
    '例: [mode:silent] （←これだけ返す）',
    '',
    '## 読み仮名（重要）',
    '音声読み上げで読み間違いが起きやすい語に読み仮名を付けてください。',
    '形式: 漢字《よみがな》',
    '',
    '### 必ず付ける語',
    '- **人名（最重要）**: 山田太郎《やまだたろう》さん、佐藤《さとう》さん',
    '- **地名**: 秋葉原《あきはばら》、御茶ノ水《おちゃのみず》',
    '- **難読語・専門用語**: 所謂《いわゆる》、漸く《ようやく》、就労継続支援《しゅうろうけいぞくしえん》',
    '- **複数の読みがある語**: 今日《きょう》、明日《あした》、昨日《きのう》、大人《おとな》',
    '',
    '### 付けなくてよい語',
    '- 一般的な漢字（天気、仕事、食べる、楽しい、学校、友達など）',
    '- 音読みが自明な熟語（会話、電話、時間など）',
    '',
    '※ 迷ったら付ける。付けすぎより付け忘れの方が問題',
    '※ 読み方が不明な場合は一般的な読み方を推測して付ける',
  );

  return lines.join('\n');
};

// --- Step 2b: 履歴を Gemini contents 配列に変換 ---
export const buildGeminiContents = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) return [];

  const contents = [];
  for (const entry of history) {
    if (!entry || typeof entry.text !== 'string') continue;
    const text = entry.text.trim();
    if (!text) continue;
    const role = entry.role === 'assistant' ? 'model' : 'user';

    // Gemini は同一ロールの連続を許さないのでマージ
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += '\n' + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Gemini は最初が user であることを期待
  if (contents.length > 0 && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '（会話開始）' }] });
  }

  return contents;
};

// --- Step 2c: 現在のユーザーメッセージを構築 ---
export const buildCurrentUserMessage = (message, context = '', faceAnalysis = null) => {
  const parts = [];

  const faceInfo = formatFaceAnalysis(faceAnalysis);
  if (faceInfo) {
    parts.push(`【相手の様子】${faceInfo}`);
  }

  if (context && typeof context === 'string' && context.trim()) {
    parts.push(`【参考情報（面談の文字起こし）】\n${context.trim()}`);
  }

  parts.push(message);

  return { role: 'user', parts: [{ text: parts.join('\n\n') }] };
};

// --- 後方互換: 旧 getChatPrompt ---
export const getChatPrompt = (message, history = [], context = '', userInfo = {}, faceAnalysis = null) => {
  const systemInstruction = getChatSystemInstruction(userInfo, { historyLength: Array.isArray(history) ? history.length : 0 });

  const historyLines = [];
  if (Array.isArray(history) && history.length > 0) {
    historyLines.push('## これまでの会話（よく読んで文脈を把握すること）');
    history.forEach((entry) => {
      if (!entry || typeof entry.text !== 'string') return;
      const text = entry.text.trim();
      if (!text) return;
      historyLines.push(`${formatRole(entry.role)}: ${text}`);
    });
  }

  const faceInfo = formatFaceAnalysis(faceAnalysis);
  const facePart = faceInfo
    ? `## 相手の今の様子（カメラから検出）\n${faceInfo}\n※この情報を参考に、相手の気持ちに寄り添った返答をしてください。\n※ただし「カメラで見えた」「検出した」などとは言わないこと。自然に気遣う形で。\n`
    : '';

  const contextPart = (context && typeof context === 'string' && context.trim())
    ? `## 参考情報（面談の文字起こし）\n${context.trim()}\n`
    : '';

  const parts = [
    systemInstruction,
    facePart,
    contextPart,
    historyLines.join('\n'),
    '',
    '## 今の発言',
    `ユーザー: ${message}`,
    '',
    '上の会話の流れを踏まえて、[表情:○○] を付けて自然に返答してください:',
    '',
  ].filter(Boolean);

  return parts.join('\n');
};
