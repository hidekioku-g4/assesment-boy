import { useEffect, useRef, useCallback, useState } from 'react';
import { useFaceLandmarker, AnalysisFrame, GazeDirection } from './useFaceLandmarker';

export type AnalysisSummary = {
  totalFrames: number;
  eyeContactFrames: number;
  eyeContactRate: number; // 0-1
  gazeStability: number; // 0-1 (1 = 安定)
  gazeWanderCount: number; // 視線が大きく動いた回数
  expressionTrends: {
    tension: number; // 緊張度 (0-1)
    smile: number; // 笑顔度 (0-1)
    surprise: number; // 驚き度 (0-1)
    worried: number; // 心配度 (0-1)
    neutral: number; // 無表情度 (0-1)
  };
  dominantExpression: string;
  rawFrames: AnalysisFrame[];
};

export type RealtimeAnalysis = {
  eyeContact: boolean;
  gazeX: number;
  gazeY: number;
  expression: string; // 'neutral' | 'smile' | 'tense' | 'surprise' | 'worried'
};

type Props = {
  enabled: boolean;
  onError?: (error: string) => void;
  onSummaryReady?: (summary: AnalysisSummary) => void;
  onRealtimeUpdate?: (data: RealtimeAnalysis) => void;
  gazeOffset?: { x: number; y: number }; // キャラの目の位置に合わせたオフセット
};

const DETECTION_INTERVAL_MS = 200; // 200msごとに検出（5fps）
const GAZE_WANDER_THRESHOLD = 0.5; // 視線移動がこれ以上なら「泳いだ」
const CALIBRATION_FRAMES = 25; // キャリブレーション用フレーム数（5秒分）

// 日本人向けに調整した閾値（ベースラインからの相対値）
const THRESHOLDS = {
  smile: 0.08,      // 笑顔（元0.2→相対値で低めに）
  tension: 0.12,    // 緊張（元0.3→相対値で低めに）
  surprise: 0.10,   // 驚き
  worried: 0.08,    // 心配
};

// 表情検出に使うblendshapeキー
const EXPRESSION_KEYS = {
  smile: ['mouthSmileLeft', 'mouthSmileRight'],
  tension: ['browDownLeft', 'browDownRight', 'browInnerUp'],
  surprise: ['eyeWideLeft', 'eyeWideRight', 'jawOpen'],
  worried: ['browInnerUp', 'mouthFrownLeft', 'mouthFrownRight'],
};

export function FaceAnalysisRecorder({ enabled, onError, onSummaryReady, onRealtimeUpdate, gazeOffset }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesRef = useRef<AnalysisFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const lastGazeRef = useRef<GazeDirection | null>(null);
  const wanderCountRef = useRef(0);
  const isStartingRef = useRef(false); // 多重起動防止

  // キャリブレーション用
  const calibrationFramesRef = useRef<Record<string, number>[]>([]);
  const baselineRef = useRef<Record<string, number> | null>(null);
  const isCalibrated = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const { isInitialized, isLoading, error, initialize, detectFrame, cleanup } = useFaceLandmarker();

  // カメラ起動
  const startCamera = useCallback(async () => {
    // 既に起動中または起動済みの場合はスキップ
    if (isStartingRef.current || streamRef.current) {
      return;
    }
    isStartingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      // クリーンアップされた場合は停止
      if (!isStartingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        console.log('[FaceAnalysisRecorder] Camera started');
      }
    } catch (err) {
      // AbortErrorは無視（Strict Modeによる再マウント時に発生）
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[FaceAnalysisRecorder] Camera error:', err);
      onError?.(err instanceof Error ? err.message : 'カメラにアクセスできませんでした');
    } finally {
      isStartingRef.current = false;
    }
  }, [onError]);

  // カメラ停止
  const stopCamera = useCallback(() => {
    isStartingRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  // 検出ループ開始
  const gazeOffsetRef = useRef(gazeOffset);
  gazeOffsetRef.current = gazeOffset; // 最新の値を参照

  // blendshapeの平均値を計算するヘルパー
  const getAvgBlendshape = useCallback((blendshapes: Record<string, number>, keys: string[]): number => {
    let sum = 0;
    let count = 0;
    for (const key of keys) {
      if (blendshapes[key] !== undefined) {
        sum += blendshapes[key];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }, []);

  // ベースラインからの相対値を取得
  const getRelativeValue = useCallback((current: number, baselineKey: string): number => {
    if (!baselineRef.current) return current;
    const baseline = baselineRef.current[baselineKey] ?? 0;
    return Math.max(0, current - baseline);
  }, []);

  // 表情を判定（キャリブレーション対応）
  const detectExpression = useCallback((blendshapes: Record<string, number>): string => {
    const smile = getAvgBlendshape(blendshapes, EXPRESSION_KEYS.smile);
    const tension = getAvgBlendshape(blendshapes, EXPRESSION_KEYS.tension);
    const surprise = getAvgBlendshape(blendshapes, EXPRESSION_KEYS.surprise);
    const worried = getAvgBlendshape(blendshapes, EXPRESSION_KEYS.worried);

    // ベースラインからの相対値
    const relSmile = getRelativeValue(smile, 'smile');
    const relTension = getRelativeValue(tension, 'tension');
    const relSurprise = getRelativeValue(surprise, 'surprise');
    const relWorried = getRelativeValue(worried, 'worried');

    // 最も強い表情を判定
    if (relSurprise > THRESHOLDS.surprise && relSurprise > relSmile && relSurprise > relTension) {
      return 'surprise';
    }
    if (relWorried > THRESHOLDS.worried && relWorried > relSmile && relTension < THRESHOLDS.tension) {
      return 'worried';
    }
    if (relTension > THRESHOLDS.tension && relTension > relSmile) {
      return 'tense';
    }
    if (relSmile > THRESHOLDS.smile) {
      return 'smile';
    }
    return 'neutral';
  }, [getAvgBlendshape, getRelativeValue]);

  const startDetection = useCallback(() => {
    if (intervalRef.current) return;

    framesRef.current = [];
    lastGazeRef.current = null;
    wanderCountRef.current = 0;

    // キャリブレーションをリセット
    calibrationFramesRef.current = [];
    baselineRef.current = null;
    isCalibrated.current = false;

    intervalRef.current = window.setInterval(() => {
      if (!videoRef.current || !cameraReady) return;

      const frame = detectFrame(videoRef.current, performance.now(), gazeOffsetRef.current);
      if (frame) {
        framesRef.current.push(frame);

        // キャリブレーション中：ベースラインを蓄積
        if (!isCalibrated.current) {
          const expressionValues = {
            smile: getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.smile),
            tension: getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.tension),
            surprise: getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.surprise),
            worried: getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.worried),
          };
          calibrationFramesRef.current.push(expressionValues);

          // キャリブレーション完了
          if (calibrationFramesRef.current.length >= CALIBRATION_FRAMES) {
            const baseline: Record<string, number> = { smile: 0, tension: 0, surprise: 0, worried: 0 };
            for (const f of calibrationFramesRef.current) {
              baseline.smile += f.smile;
              baseline.tension += f.tension;
              baseline.surprise += f.surprise;
              baseline.worried += f.worried;
            }
            const n = calibrationFramesRef.current.length;
            baseline.smile /= n;
            baseline.tension /= n;
            baseline.surprise /= n;
            baseline.worried /= n;
            baselineRef.current = baseline;
            isCalibrated.current = true;
            calibrationFramesRef.current = []; // メモリ解放
            console.log('[FaceAnalysisRecorder] Calibration complete:', baseline);
          }
        }

        // 視線の大きな移動をカウント
        if (lastGazeRef.current) {
          const dx = Math.abs(frame.gazeDirection.x - lastGazeRef.current.x);
          const dy = Math.abs(frame.gazeDirection.y - lastGazeRef.current.y);
          if (Math.sqrt(dx * dx + dy * dy) > GAZE_WANDER_THRESHOLD) {
            wanderCountRef.current++;
          }
        }
        lastGazeRef.current = frame.gazeDirection;

        // リアルタイム更新コールバック
        if (onRealtimeUpdate) {
          const expression = detectExpression(frame.blendshapes);

          onRealtimeUpdate({
            eyeContact: frame.eyeContact,
            gazeX: frame.gazeDirection.x,
            gazeY: frame.gazeDirection.y,
            expression,
          });
        }
      }
    }, DETECTION_INTERVAL_MS);

    console.log('[FaceAnalysisRecorder] Detection started');
  }, [cameraReady, detectFrame, onRealtimeUpdate, getAvgBlendshape, detectExpression]);

  // 検出停止
  const stopDetection = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // 集計を計算
  const calculateSummary = useCallback((): AnalysisSummary => {
    const frames = framesRef.current;
    const totalFrames = frames.length;

    if (totalFrames === 0) {
      return {
        totalFrames: 0,
        eyeContactFrames: 0,
        eyeContactRate: 0,
        gazeStability: 1,
        gazeWanderCount: 0,
        expressionTrends: { tension: 0, smile: 0, surprise: 0, worried: 0, neutral: 1 },
        dominantExpression: 'neutral',
        rawFrames: [],
      };
    }

    // アイコンタクト率
    const eyeContactFrames = frames.filter((f) => f.eyeContact).length;
    const eyeContactRate = eyeContactFrames / totalFrames;

    // 視線の安定度（標準偏差ベース）
    const gazeXValues = frames.map((f) => f.gazeDirection.x);
    const gazeYValues = frames.map((f) => f.gazeDirection.y);
    const stdDevX = calculateStdDev(gazeXValues);
    const stdDevY = calculateStdDev(gazeYValues);
    const avgStdDev = (stdDevX + stdDevY) / 2;
    const gazeStability = Math.max(0, 1 - avgStdDev * 2);

    // 表情の傾向（各フレームで計算してベースライン補正）
    let smileSum = 0, tensionSum = 0, surpriseSum = 0, worriedSum = 0;

    for (const frame of frames) {
      const smile = getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.smile);
      const tension = getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.tension);
      const surprise = getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.surprise);
      const worried = getAvgBlendshape(frame.blendshapes, EXPRESSION_KEYS.worried);

      // ベースライン補正（キャリブレーション済みの場合）
      smileSum += getRelativeValue(smile, 'smile');
      tensionSum += getRelativeValue(tension, 'tension');
      surpriseSum += getRelativeValue(surprise, 'surprise');
      worriedSum += getRelativeValue(worried, 'worried');
    }

    const avgSmile = smileSum / totalFrames;
    const avgTension = tensionSum / totalFrames;
    const avgSurprise = surpriseSum / totalFrames;
    const avgWorried = worriedSum / totalFrames;
    const total = avgSmile + avgTension + avgSurprise + avgWorried;
    const neutral = Math.max(0, 1 - Math.min(1, total * 2));

    // 支配的な表情を判定
    const expressions = [
      { name: 'smile', value: avgSmile, threshold: THRESHOLDS.smile },
      { name: 'tense', value: avgTension, threshold: THRESHOLDS.tension },
      { name: 'surprise', value: avgSurprise, threshold: THRESHOLDS.surprise },
      { name: 'worried', value: avgWorried, threshold: THRESHOLDS.worried },
    ];
    const dominant = expressions.reduce((a, b) => (b.value > a.value ? b : a));
    const dominantExpression = dominant.value > dominant.threshold ? dominant.name : 'neutral';

    return {
      totalFrames,
      eyeContactFrames,
      eyeContactRate,
      gazeStability,
      gazeWanderCount: wanderCountRef.current,
      expressionTrends: {
        smile: Math.min(1, avgSmile * 3),
        tension: Math.min(1, avgTension * 3),
        surprise: Math.min(1, avgSurprise * 3),
        worried: Math.min(1, avgWorried * 3),
        neutral,
      },
      dominantExpression,
      rawFrames: frames,
    };
  }, [getAvgBlendshape, getRelativeValue]);

  // 結果を取得して通知
  const finishAndGetSummary = useCallback(() => {
    stopDetection();
    const summary = calculateSummary();
    onSummaryReady?.(summary);
    return summary;
  }, [stopDetection, calculateSummary, onSummaryReady]);

  // enabled が変わった時の処理
  useEffect(() => {
    if (!enabled) {
      stopDetection();
      stopCamera();
      cleanup();
      return;
    }

    let cancelled = false;

    const start = async () => {
      await initialize();
      if (!cancelled) {
        await startCamera();
      }
    };

    start();

    return () => {
      cancelled = true;
      stopDetection();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // カメラとMediaPipeが準備できたら検出開始
  useEffect(() => {
    if (enabled && cameraReady && isInitialized) {
      startDetection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cameraReady, isInitialized]);

  // エラー通知
  useEffect(() => {
    if (error) {
      onError?.(error);
    }
  }, [error, onError]);

  // 非表示のvideoタグのみレンダリング
  return (
    <video
      ref={videoRef}
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
      playsInline
      muted
    />
  );
}

// 標準偏差を計算するヘルパー
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

// コンポーネントとfinishAndGetSummaryを公開するためのRef型
export type FaceAnalysisRecorderRef = {
  finishAndGetSummary: () => AnalysisSummary;
};

export default FaceAnalysisRecorder;
