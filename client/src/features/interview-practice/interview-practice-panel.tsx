import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FeedbackStatus = 'idle' | 'running' | 'success' | 'error';

type InterviewQuestionSet = {
  id: 'basic' | 'support';
  label: string;
  description: string;
  questions: string[];
};

const QUESTION_SETS: InterviewQuestionSet[] = [
  {
    id: 'basic',
    label: '基本質問',
    description: '一般的な面接でよく聞かれる質問',
    questions: [
      '自己紹介をお願いします',
      '志望動機を教えてください',
      'これまでの経験で頑張ったことは？',
      '長所と短所を教えてください',
      '5年後どうなっていたいですか',
    ],
  },
  {
    id: 'support',
    label: '就労支援向け',
    description: '体調・配慮・作業特性に関する質問',
    questions: [
      '体調管理で気をつけていることは？',
      '苦手なことや配慮してほしいことは？',
      '得意な作業や好きな作業は？',
      '困ったときはどうしますか？',
      '働く上で大切にしたいことは？',
    ],
  },
];

const formatUsage = (usage: any) => {
  if (!usage) return null;
  const total = typeof usage.totalTokens === 'number' ? usage.totalTokens : null;
  const prompt = typeof usage.promptTokens === 'number' ? usage.promptTokens : null;
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : null;
  if (total === null && prompt === null && output === null) return null;
  const parts = [
    total !== null ? '合計 ' + total : null,
    prompt !== null ? '入力 ' + prompt : null,
    output !== null ? '出力 ' + output : null,
  ].filter(Boolean);
  return parts.join(' / ');
};

export type InterviewPracticePanelProps = {
  cleanedText: string;
  className?: string;
};

export function InterviewPracticePanel({ cleanedText, className }: InterviewPracticePanelProps) {
  const [questionSetId, setQuestionSetId] = useState<InterviewQuestionSet['id']>('basic');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>('idle');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);

  const currentSet = useMemo(
    () => QUESTION_SETS.find((set) => set.id === questionSetId) ?? QUESTION_SETS[0],
    [questionSetId],
  );
  const currentQuestion = currentSet.questions[questionIndex] ?? currentSet.questions[0];

  const resetFeedback = () => {
    setFeedback('');
    setFeedbackStatus('idle');
    setFeedbackError(null);
    setUsage(null);
  };

  const handleSetChange = (nextId: InterviewQuestionSet['id']) => {
    setQuestionSetId(nextId);
    setQuestionIndex(0);
    setAnswerText('');
    resetFeedback();
  };

  const handleMoveQuestion = (nextIndex: number) => {
    setQuestionIndex(nextIndex);
    setAnswerText('');
    resetFeedback();
  };

  const handleUseCleaned = () => {
    const snapshot = cleanedText.trim();
    if (!snapshot) {
      setFeedbackError('クリーン結果がありません。先に「クリーンを実行」してください。');
      return;
    }
    setAnswerText(snapshot);
    setFeedbackError(null);
  };

  const handleGenerateFeedback = async () => {
    const question = currentQuestion?.trim();
    const answer = answerText.trim();
    if (!question) {
      setFeedbackError('質問が選択されていません。');
      return;
    }
    if (!answer) {
      setFeedbackError('回答が空です。');
      return;
    }

    setFeedbackStatus('running');
    setFeedback('');
    setFeedbackError(null);
    setUsage(null);

    try {
      const response = await fetch('/api/interview-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      });
      if (!response.ok) {
        let message = 'feedback failed: ' + response.status;
        try {
          const payload = await response.json();
          if (payload?.error) {
            message = payload.error;
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const json = await response.json();
      const nextFeedback = typeof json?.feedback === 'string' ? json.feedback.trim() : '';
      if (!nextFeedback) {
        throw new Error('フィードバックが空でした。');
      }
      setFeedback(nextFeedback);
      setUsage(json?.usage ?? null);
      setFeedbackStatus('success');
    } catch (error) {
      setFeedbackStatus('error');
      setFeedbackError(error instanceof Error ? error.message : String(error));
    }
  };

  const usageLabel = formatUsage(usage);
  const hasPrev = questionIndex > 0;
  const hasNext = questionIndex < currentSet.questions.length - 1;

  return (
    <section
      className={cn(
        'flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-100',
        className,
      )}
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">面接練習</p>
            <h2 className="text-lg font-semibold text-slate-900">質問 → 回答 → フィードバック</h2>
          </div>
          <div className="text-xs text-slate-500">MVP: テキスト評価のみ</div>
        </div>
        <p className="text-xs text-slate-500">
          文字起こしを「クリーン実行」したあと、回答テキストに取り込んでフィードバックを生成します。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">質問セット</label>
            <div className="flex flex-wrap items-center gap-2">
              {QUESTION_SETS.map((set) => (
                <Button
                  key={set.id}
                  size="sm"
                  variant={questionSetId === set.id ? 'default' : 'outline'}
                  onClick={() => handleSetChange(set.id)}
                >
                  {set.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{currentSet.description}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                質問 {questionIndex + 1} / {currentSet.questions.length}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => handleMoveQuestion(questionIndex - 1)} disabled={!hasPrev}>
                  前へ
                </Button>
                <Button size="sm" onClick={() => handleMoveQuestion(questionIndex + 1)} disabled={!hasNext}>
                  次へ
                </Button>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900">
              {currentQuestion}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleUseCleaned}>
              クリーン結果を取り込む
            </Button>
            <span className="text-[11px] text-slate-500">
              {cleanedText.trim()
                ? 'クリーン済み: ' + cleanedText.trim().length + ' 文字'
                : 'クリーン結果なし'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-600">回答テキスト</label>
            <span className="text-[11px] text-slate-400">{answerText.trim().length} 文字</span>
          </div>
          <textarea
            rows={10}
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            placeholder="クリーン結果を取り込むか、ここに回答を入力してください。"
            className="min-h-[12rem] w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-inner focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleGenerateFeedback} disabled={feedbackStatus === 'running'}>
              {feedbackStatus === 'running' ? 'フィードバック生成中…' : 'フィードバックを生成'}
            </Button>
            {feedbackStatus === 'success' && (
              <span className="text-[11px] font-semibold text-emerald-600">フィードバック更新済み</span>
            )}
            {feedbackStatus === 'error' && (
              <span className="text-[11px] font-semibold text-red-600">生成に失敗しました</span>
            )}
            {usageLabel && <span className="text-[11px] text-slate-500">Geminiトークン: {usageLabel}</span>}
          </div>
          {feedbackError && <div className="text-xs text-red-600">{feedbackError}</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">フィードバック</h3>
          <span className="text-[11px] text-slate-400">
            {feedback ? '生成済み' : '未生成'}
          </span>
        </div>
        {feedback ? (
          <pre className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{feedback}</pre>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            まだフィードバックがありません。
          </div>
        )}
      </div>
    </section>
  );
}
