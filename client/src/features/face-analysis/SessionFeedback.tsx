import { useMemo, useState, useEffect } from 'react';
import { AnalysisSummary } from './FaceAnalysisRecorder';
import { cn } from '@/lib/utils';

type Props = {
  summary: AnalysisSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestAIFeedback?: (summary: AnalysisSummary) => Promise<string>;
};

const scoreColor = (score: number) =>
  score >= 70 ? 'text-emerald-600' : score >= 50 ? 'text-lime-600' : score >= 30 ? 'text-amber-500' : 'text-orange-500';

const barColor = (score: number) =>
  score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-lime-500' : score >= 30 ? 'bg-amber-500' : 'bg-orange-500';

const expressionColorClass = (expr: string) => {
  switch (expr) {
    case 'relaxed': return 'text-emerald-600';
    case 'tense': return 'text-amber-500';
    default: return 'text-blue-500';
  }
};

export function SessionFeedback({ summary, isOpen, onClose, onRequestAIFeedback }: Props) {
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  const evaluation = useMemo(() => {
    if (!summary || summary.totalFrames === 0) {
      return {
        eyeContact: { score: 0, label: '計測なし' },
        stability: { score: 0, label: '計測なし' },
        expression: { label: '計測なし' },
      };
    }

    const eyeContactPercent = Math.round(summary.eyeContactRate * 100);
    const eyeContactLabel =
      eyeContactPercent >= 70 ? 'とても良い' :
      eyeContactPercent >= 50 ? '良い' :
      eyeContactPercent >= 30 ? 'もう少し' : '練習しよう';

    const stabilityPercent = Math.round(summary.gazeStability * 100);
    const stabilityLabel =
      stabilityPercent >= 70 ? '安定している' :
      stabilityPercent >= 50 ? 'まあまあ安定' :
      stabilityPercent >= 30 ? '少し落ち着かない' : 'キョロキョロしがち';

    const expressionLabel =
      summary.dominantExpression === 'relaxed' ? 'リラックスしていた' :
      summary.dominantExpression === 'tense' ? '少し緊張気味' : '落ち着いていた';

    return {
      eyeContact: { score: eyeContactPercent, label: eyeContactLabel },
      stability: { score: stabilityPercent, label: stabilityLabel },
      expression: { label: expressionLabel },
    };
  }, [summary]);

  useEffect(() => {
    if (isOpen && summary && summary.totalFrames > 0 && onRequestAIFeedback && !aiFeedback) {
      setIsLoadingFeedback(true);
      onRequestAIFeedback(summary)
        .then((feedback) => setAiFeedback(feedback))
        .catch((err) => {
          console.error('[SessionFeedback] AI feedback error:', err);
          setAiFeedback('フィードバックを取得できませんでした。');
        })
        .finally(() => setIsLoadingFeedback(false));
    }
  }, [isOpen, summary, onRequestAIFeedback, aiFeedback]);

  useEffect(() => {
    if (!isOpen) setAiFeedback(null);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-[90%] max-w-md max-h-[80vh] overflow-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-300/40"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-center text-lg font-bold text-slate-900">
          セッションフィードバック
        </h2>

        {!summary || summary.totalFrames === 0 ? (
          <p className="text-center text-sm text-slate-500">
            顔の検出データがありません。
            <br />
            カメラが有効になっていたか確認してください。
          </p>
        ) : (
          <>
            {/* アイコンタクト */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">アイコンタクト</span>
                <span className={cn('text-sm font-bold', scoreColor(evaluation.eyeContact.score))}>
                  {evaluation.eyeContact.score}% - {evaluation.eyeContact.label}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', barColor(evaluation.eyeContact.score))}
                  style={{ width: `${evaluation.eyeContact.score}%` }}
                />
              </div>
            </div>

            {/* 視線の安定度 */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">視線の安定度</span>
                <span className={cn('text-sm font-bold', scoreColor(evaluation.stability.score))}>
                  {evaluation.stability.score}% - {evaluation.stability.label}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', barColor(evaluation.stability.score))}
                  style={{ width: `${evaluation.stability.score}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                視線が大きく動いた回数: {summary.gazeWanderCount}回
              </p>
            </div>

            {/* 表情 */}
            <div className="mb-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">表情の傾向</span>
                <span className={cn('text-sm font-bold', expressionColorClass(summary.dominantExpression))}>
                  {evaluation.expression.label}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <ExpressionBar label="緊張" value={summary.expressionTrends.tension} colorClass="bg-orange-500" />
                <ExpressionBar label="笑顔" value={summary.expressionTrends.smile} colorClass="bg-emerald-500" />
                <ExpressionBar label="自然" value={summary.expressionTrends.neutral} colorClass="bg-blue-500" />
              </div>
            </div>

            {/* AIフィードバック */}
            {onRequestAIFeedback && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">AIからのアドバイス</p>
                {isLoadingFeedback ? (
                  <p className="text-sm text-slate-500">考え中...</p>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{aiFeedback}</p>
                )}
              </div>
            )}

            {/* 統計情報 */}
            <p className="mt-4 text-center text-xs text-slate-400">
              検出フレーム数: {summary.totalFrames} (約{Math.round(summary.totalFrames * 0.2)}秒)
            </p>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#c44d6d]"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function ExpressionBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex-1 text-center">
      <div className="flex h-10 flex-col justify-end overflow-hidden rounded bg-slate-200">
        <div
          className={cn('transition-all duration-500', colorClass)}
          style={{ height: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

export default SessionFeedback;
