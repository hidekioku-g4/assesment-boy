// server/prompts/support-record-draft.js
// 改善版: 面談タイプ別の指示ブロックを追加

const summarizeForPrompt = (text) => {
  if (!text || typeof text !== 'string') {
    return '（未入力）';
  }
  const trimmed = text.trim();
  if (!trimmed) return '（未入力）';
  if (trimmed.length <= 240) return trimmed.replace(/\s+/g, ' ');
  return `${trimmed.replace(/\s+/g, ' ').slice(0, 220)}…`;
};

// 面談タイプ別の重視ポイントと記録のコツ
const MEETING_TYPE_GUIDES = {
  assessment: {
    name: 'アセスメント面談',
    focus: `【この面談で重視すること】
- 職業準備性の4階層（健康管理→日常生活→対人・態度→作業能力）で情報を整理
- 本人の「強み」と「課題」の両面をバランスよく把握
- 補完方法（どんな支援があればできるか）の発見
- 本人の言葉をベースに、推測や評価は避ける`,
    tips: `【記録のポイント】
- 「〜したい」「〜が不安」など本人の感情表現を見逃さない
- 家族・医療機関からの情報は出典を明記
- 「できる/できない」ではなく「どんな支援があればできるか」の視点で
- 生活歴・支援歴は時系列で整理`
  },
  
  individual_support: {
    name: '個別支援会議',
    focus: `【この面談で重視すること】
- 目標は「短期」「長期」で設定し、達成基準を明確に
- 「検討中」と「決定」を区別する
- 誰が・何を・いつまでに、を具体的に
- 本人の同意・納得度も記録`,
    tips: `【記録のポイント】
- 目標は「週3日通所」など数値で表現
- 役割分担は担当者名を明記
- 本人と家族の意向が異なる場合は両論併記
- 決定事項には本人同意の有無を必ず記載`
  },
  
  monitoring: {
    name: 'モニタリング面談',
    focus: `【この面談で重視すること】
- 前回からの「変化」を数値・事実で捉える（通所回数、起床時刻など）
- 目標の達成度を段階評価（達成/一部達成/未達成）
- 本人の自己評価と支援員の観察を両方記録
- 計画変更の必要性を判断`,
    tips: `【記録のポイント】
- 「良くなった」ではなく具体的に（例: 通所12回→14回）
- 停滞・後退も正直に記録し、改善策をセットで
- 本人の発言は「」で引用
- 次期計画への示唆を意識して記録`
  },
  
  service_meeting: {
    name: 'サービス担当者会議',
    focus: `【この面談で重視すること】
- 参加者・参加機関を明記（本人参加は必須要件）
- 各機関の役割と担当範囲を明確に
- 情報共有のルール（頻度・手段・窓口）を決める
- 決定事項と残課題を区別`,
    tips: `【記録のポイント】
- 欠席者への照会状況も記載
- 本人の発言は直接引用で記録
- 機関ごとの役割は「誰が・何を・いつまでに」の形式で
- 次回会議の予定も明記`
  },
  
  case_meeting: {
    name: 'ケース会議',
    focus: `【この面談で重視すること】
- 問題の経緯を時系列で整理（いつ・どこで・何が起きたか）
- 緊急度・優先度を明示（高/中/低）
- 決定事項と保留事項を区別
- エスカレーション先・緊急連絡フローを明確に`,
    tips: `【記録のポイント】
- 事実と意見・感情を分けて記録
- 各関係者の見解を立場ごとに整理
- 対応の期限は具体的に（「今週中」→「○月○日まで」）
- リスクと対処法をセットで記載`
  }
};

// デフォルトのガイド（面談タイプが不明な場合）
const DEFAULT_GUIDE = {
  name: '面談',
  focus: `【この面談で重視すること】
- 事実と本人の発言を正確に記録
- 決定事項と検討事項を区別
- 次のアクションを明確に`,
  tips: `【記録のポイント】
- 会話にない情報は書かない
- 本人の発言は「」で引用
- 誰が・何を・いつまでに、を具体的に`
};

export function getSupportRecordDraftPrompt(
  transcript,
  meetingTypeId = null,
  meetingTypeName = null,
  sections = [],
  currentDraft = {},
) {
  // 面談タイプに応じたガイドを取得
  const guide = meetingTypeId && MEETING_TYPE_GUIDES[meetingTypeId] 
    ? MEETING_TYPE_GUIDES[meetingTypeId] 
    : DEFAULT_GUIDE;
  
  const displayName = meetingTypeName || guide.name;
  const meetingLine = `面談タイプ: ${displayName}`;

  // セクション定義の生成
  const sectionGuide = sections
    .map((section) => {
      const title = section?.title ?? section?.id ?? '項目';
      const helper = section?.helperText ? ` → ${section.helperText}` : '';
      return `- ${title} (${section.id})${helper}`;
    })
    .join('\n');

  // 現在のドラフト状況
  const currentContext = sections
    .map((section) => {
      const existing = currentDraft?.[section.id]?.value ?? '';
      const preview = summarizeForPrompt(existing);
      return `- ${section.id}: ${preview}`;
    })
    .join('\n');

  return `あなたは就労支援の面談記録を作成するアシスタントです。
${meetingLine}

${guide.focus}

${guide.tips}

# 項目定義
${sectionGuide}

# 現在のドラフト（参考）
${currentContext}

# クリーン済み文字起こし（直近の追加分）
${transcript}

# 基本ルール
- 会話にない情報は絶対に書かない（推測・創作禁止）
- 事実・発言・課題・合意・タスクを中心に記録
- 簡潔な日本語で書く（敬体不要、「です・ます」不要）
- 本人の発言は「」で引用
- 数値で表現できるものは数値で（例: 週3日、月12回）
- 既存の内容と同じことは繰り返さない
- 訂正や否定があれば replace を使う

# 出力ルール
- 追記なら action は "append"
- 全体を書き直すなら "replace"
- 変更が必要な項目だけ出力する
- 変更不要なら空の sections 配列を返す

# 出力形式（JSONのみ、説明文不要）
{
  "sections": [
    { "id": "セクションID", "action": "replace", "text": "記録内容" },
    { "id": "セクションID", "action": "append", "text": "追記内容" }
  ]
}
`;
}

// 面談タイプIDからガイド情報を取得するヘルパー関数
export function getMeetingTypeGuide(meetingTypeId) {
  return MEETING_TYPE_GUIDES[meetingTypeId] || DEFAULT_GUIDE;
}

// 利用可能な面談タイプ一覧を取得
export function getAvailableMeetingTypes() {
  return Object.entries(MEETING_TYPE_GUIDES).map(([id, guide]) => ({
    id,
    name: guide.name
  }));
}

export default {
  getSupportRecordDraftPrompt,
  getMeetingTypeGuide,
  getAvailableMeetingTypes,
};
