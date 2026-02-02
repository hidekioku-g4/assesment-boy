// server/prompts/agenda.js - 次回アジェンダ提案用プロンプト

const formatSectionValue = (value) => {
  if (!value || typeof value !== 'string') return '（未入力）';
  return value.trim();
};

const formatSupportRecordForPrompt = (sections = []) => {
  if (!Array.isArray(sections) || sections.length === 0) {
    return '（支援記録の入力がまだありません）';
  }
  return sections
    .map((section) => {
      const title = section?.title || section?.id || '不明なセクション';
      const value = formatSectionValue(section?.value);
      return `- ${title}\n  ${value}`;
    })
    .join('\n');
};

const formatHistoricalRecords = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) {
    return '（参照可能な過去記録はありません）';
  }

  return records
    .map((record, index) => {
      const label = record?.label || `記録${index + 1}`;
      const updatedAt = record?.updatedAt ? `更新日: ${record.updatedAt}` : '';
      const sectionLines = Array.isArray(record?.sections)
        ? record.sections
            .map((section) => {
              const title = section?.title || section?.id || '不明なセクション';
              const value = formatSectionValue(section?.value);
              return `    - ${title}: ${value}`;
            })
            .join('\n')
        : '    - （内容なし）';

      return `● ${label}${updatedAt ? `（${updatedAt}）` : ''}\n${sectionLines}`;
    })
    .join('\n');
};

const formatDocuments = (documents = []) => {
  if (!Array.isArray(documents) || documents.length === 0) {
    return '（事前資料は添付されていません）';
  }
  return documents
    .map((doc, index) => {
      const title = doc?.title || `資料${index + 1}`;
      const summary =
        typeof doc?.summary === 'string' && doc.summary.trim()
          ? doc.summary.trim()
          : typeof doc?.content === 'string'
            ? doc.content.slice(0, 400)
            : '（要約なし）';
      return `- ${title}\n  ${summary}`;
    })
    .join('\n');
};

export function getAgendaPrompt({
  supportRecordSections = [],
  memos = {},
  keywords = [],
  summary = null,
  documents = [],
  historyRecords = [],
}) {
  const memoFact = typeof memos?.fact === 'string' && memos.fact.trim().length > 0 ? memos.fact.trim() : '（未入力）';
  const memoInterpretation =
    typeof memos?.interpretation === 'string' && memos.interpretation.trim().length > 0
      ? memos.interpretation.trim()
      : '（未入力）';
  const memoAction =
    typeof memos?.action === 'string' && memos.action.trim().length > 0 ? memos.action.trim() : '（未入力）';

  const summaryPast = summary?.past || '（未入力）';
  const summaryFuture = summary?.future || '（未入力）';
  const keywordLine = Array.isArray(keywords) && keywords.length > 0 ? keywords.join('、') : '（設定なし）';

  return `あなたは次回のセッションに向けた準備を手伝うアシスタントです。
これまでの記録をもとに、次回話したいことや確認したいことを提案してください。

# 最新のセッション記録
${formatSupportRecordForPrompt(supportRecordSections)}

# メモ
- 事実: ${memoFact}
- 気づき: ${memoInterpretation}
- やること: ${memoAction}

# 直近のまとめ
- 前回: ${summaryPast}
- 次回: ${summaryFuture}

# キーワード
${keywordLine}

# 過去のセッション記録（最近の順で最大3件）
${formatHistoricalRecords(historyRecords)}

# 参考資料
${formatDocuments(documents)}

## 出力仕様
JSONのみを返してください（コードブロック不要）。構造は以下の通りです。
{
  "agenda": [
    {
      "title": "次回話したいテーマ",
      "why": "なぜこの話題が大切か",
      "relatedSections": ["session_overview", "support_plan"],
      "followUps": ["次回までにやっておくこと", "確認しておくこと"]
    }
  ],
  "reminders": [
    "前回決めたことの確認",
    "忘れずに伝えたいこと"
  ]
}

制約:
- JSON以外の文字は一切出力しないこと。
- agendaは優先度の高いものから最大5件、remindersは最大5件。
- relatedSectionsは記録テンプレートのidを使用（session_overview, current_status, support_plan, next_actions, shared_notes）。
- followUpsは具体的にやることを挙げること。
- 過去記録が無い場合は、今あるメモから読み取れる範囲で提案する。
`;
}

export default {
  getAgendaPrompt,
};
