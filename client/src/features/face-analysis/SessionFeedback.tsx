import { useMemo, useState, useEffect } from 'react';
import { AnalysisSummary } from './FaceAnalysisRecorder';

type Props = {
  summary: AnalysisSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestAIFeedback?: (summary: AnalysisSummary) => Promise<string>;
};

export function SessionFeedback({ summary, isOpen, onClose, onRequestAIFeedback }: Props) {
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  // スコアから評価テキストを生成
  const evaluation = useMemo(() => {
    if (!summary || summary.totalFrames === 0) {
      return {
        eyeContact: { score: 0, label: '計測なし', color: 'gray' },
        stability: { score: 0, label: '計測なし', color: 'gray' },
        expression: { label: '計測なし', color: 'gray' },
      };
    }

    // アイコンタクト評価
    const eyeContactPercent = Math.round(summary.eyeContactRate * 100);
    let eyeContactLabel = '';
    let eyeContactColor = '';
    if (eyeContactPercent >= 70) {
      eyeContactLabel = 'とても良い';
      eyeContactColor = '#4CAF50';
    } else if (eyeContactPercent >= 50) {
      eyeContactLabel = '良い';
      eyeContactColor = '#8BC34A';
    } else if (eyeContactPercent >= 30) {
      eyeContactLabel = 'もう少し';
      eyeContactColor = '#FFC107';
    } else {
      eyeContactLabel = '練習しよう';
      eyeContactColor = '#FF9800';
    }

    // 安定度評価
    const stabilityPercent = Math.round(summary.gazeStability * 100);
    let stabilityLabel = '';
    let stabilityColor = '';
    if (stabilityPercent >= 70) {
      stabilityLabel = '安定している';
      stabilityColor = '#4CAF50';
    } else if (stabilityPercent >= 50) {
      stabilityLabel = 'まあまあ安定';
      stabilityColor = '#8BC34A';
    } else if (stabilityPercent >= 30) {
      stabilityLabel = '少し落ち着かない';
      stabilityColor = '#FFC107';
    } else {
      stabilityLabel = 'キョロキョロしがち';
      stabilityColor = '#FF9800';
    }

    // 表情評価
    let expressionLabel = '';
    let expressionColor = '';
    switch (summary.dominantExpression) {
      case 'relaxed':
        expressionLabel = 'リラックスしていた';
        expressionColor = '#4CAF50';
        break;
      case 'tense':
        expressionLabel = '少し緊張気味';
        expressionColor = '#FFC107';
        break;
      default:
        expressionLabel = '落ち着いていた';
        expressionColor = '#2196F3';
    }

    return {
      eyeContact: { score: eyeContactPercent, label: eyeContactLabel, color: eyeContactColor },
      stability: { score: stabilityPercent, label: stabilityLabel, color: stabilityColor },
      expression: { label: expressionLabel, color: expressionColor },
    };
  }, [summary]);

  // AIフィードバックを取得
  useEffect(() => {
    if (isOpen && summary && summary.totalFrames > 0 && onRequestAIFeedback && !aiFeedback) {
      setIsLoadingFeedback(true);
      onRequestAIFeedback(summary)
        .then((feedback) => {
          setAiFeedback(feedback);
        })
        .catch((err) => {
          console.error('[SessionFeedback] AI feedback error:', err);
          setAiFeedback('フィードバックを取得できませんでした。');
        })
        .finally(() => {
          setIsLoadingFeedback(false);
        });
    }
  }, [isOpen, summary, onRequestAIFeedback, aiFeedback]);

  // リセット
  useEffect(() => {
    if (!isOpen) {
      setAiFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 16,
          padding: 24,
          maxWidth: 400,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            margin: '0 0 20px 0',
            fontSize: 20,
            fontWeight: 'bold',
            textAlign: 'center',
          }}
        >
          セッションフィードバック
        </h2>

        {!summary || summary.totalFrames === 0 ? (
          <p style={{ textAlign: 'center', color: '#666' }}>
            顔の検出データがありません。
            <br />
            カメラが有効になっていたか確認してください。
          </p>
        ) : (
          <>
            {/* アイコンタクト */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontWeight: 'bold' }}>アイコンタクト</span>
                <span style={{ color: evaluation.eyeContact.color, fontWeight: 'bold' }}>
                  {evaluation.eyeContact.score}% - {evaluation.eyeContact.label}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  backgroundColor: '#E0E0E0',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${evaluation.eyeContact.score}%`,
                    backgroundColor: evaluation.eyeContact.color,
                    borderRadius: 4,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
            </div>

            {/* 視線の安定度 */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontWeight: 'bold' }}>視線の安定度</span>
                <span style={{ color: evaluation.stability.color, fontWeight: 'bold' }}>
                  {evaluation.stability.score}% - {evaluation.stability.label}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  backgroundColor: '#E0E0E0',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${evaluation.stability.score}%`,
                    backgroundColor: evaluation.stability.color,
                    borderRadius: 4,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                視線が大きく動いた回数: {summary.gazeWanderCount}回
              </p>
            </div>

            {/* 表情 */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 'bold' }}>表情の傾向</span>
                <span style={{ color: evaluation.expression.color, fontWeight: 'bold' }}>
                  {evaluation.expression.label}
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <ExpressionBar
                  label="緊張"
                  value={summary.expressionTrends.tension}
                  color="#FF9800"
                />
                <ExpressionBar
                  label="笑顔"
                  value={summary.expressionTrends.smile}
                  color="#4CAF50"
                />
                <ExpressionBar
                  label="自然"
                  value={summary.expressionTrends.neutral}
                  color="#2196F3"
                />
              </div>
            </div>

            {/* AIフィードバック */}
            {onRequestAIFeedback && (
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  backgroundColor: '#F5F5F5',
                  borderRadius: 8,
                }}
              >
                <p style={{ fontWeight: 'bold', marginBottom: 8 }}>AIからのアドバイス</p>
                {isLoadingFeedback ? (
                  <p style={{ color: '#666' }}>考え中...</p>
                ) : (
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{aiFeedback}</p>
                )}
              </div>
            )}

            {/* 統計情報 */}
            <p
              style={{
                fontSize: 11,
                color: '#999',
                textAlign: 'center',
                marginTop: 16,
              }}
            >
              検出フレーム数: {summary.totalFrames} (約{Math.round(summary.totalFrames * 0.2)}秒)
            </p>
          </>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '12px 24px',
            backgroundColor: '#1976D2',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function ExpressionBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const percent = Math.round(value * 100);
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div
        style={{
          height: 40,
          backgroundColor: '#E0E0E0',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: `${percent}%`,
            backgroundColor: color,
            transition: 'height 0.5s ease',
          }}
        />
      </div>
      <p style={{ fontSize: 11, marginTop: 4 }}>{label}</p>
    </div>
  );
}

export default SessionFeedback;
