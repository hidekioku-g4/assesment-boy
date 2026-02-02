import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

export type GazeDirection = {
  x: number; // -1 (左) ~ 1 (右)
  y: number; // -1 (上) ~ 1 (下)
};

export type AnalysisFrame = {
  timestamp: number;
  gazeDirection: GazeDirection;
  eyeContact: boolean;
  blendshapes: Record<string, number>;
};

// 虹彩ランドマークのインデックス (MediaPipe Face Mesh)
// 左目虹彩: 468-472, 右目虹彩: 473-477
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;

export function useFaceLandmarker() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  // 初期化
  const initialize = useCallback(async () => {
    if (faceLandmarkerRef.current || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });

      faceLandmarkerRef.current = faceLandmarker;
      setIsInitialized(true);
      console.log('[FaceLandmarker] Initialized successfully');
    } catch (err) {
      console.error('[FaceLandmarker] Initialization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // 視線方向を計算
  const calculateGazeDirection = useCallback(
    (landmarks: { x: number; y: number; z: number }[]): GazeDirection => {
      if (landmarks.length < 478) {
        return { x: 0, y: 0 };
      }

      // 左目の虹彩位置を目の幅で正規化
      const leftIris = landmarks[LEFT_IRIS_CENTER];
      const leftOuter = landmarks[LEFT_EYE_OUTER];
      const leftInner = landmarks[LEFT_EYE_INNER];
      const leftEyeWidth = Math.abs(leftInner.x - leftOuter.x);
      const leftEyeCenter = (leftOuter.x + leftInner.x) / 2;
      const leftGazeX = leftEyeWidth > 0 ? (leftIris.x - leftEyeCenter) / leftEyeWidth : 0;

      // 右目の虹彩位置を目の幅で正規化
      const rightIris = landmarks[RIGHT_IRIS_CENTER];
      const rightOuter = landmarks[RIGHT_EYE_OUTER];
      const rightInner = landmarks[RIGHT_EYE_INNER];
      const rightEyeWidth = Math.abs(rightInner.x - rightOuter.x);
      const rightEyeCenter = (rightOuter.x + rightInner.x) / 2;
      const rightGazeX = rightEyeWidth > 0 ? (rightIris.x - rightEyeCenter) / rightEyeWidth : 0;

      // 両目の平均
      const gazeX = (leftGazeX + rightGazeX) / 2;

      // Y方向は虹彩のZ座標（奥行き）で近似
      const gazeY = (leftIris.y + rightIris.y) / 2 - 0.5;

      return {
        x: Math.max(-1, Math.min(1, gazeX * 4)), // スケール調整
        y: Math.max(-1, Math.min(1, gazeY * 2)),
      };
    },
    []
  );

  // アイコンタクト判定（視線が中央付近、オフセット対応）
  const isEyeContact = useCallback((gaze: GazeDirection, offset?: { x: number; y: number }): boolean => {
    const threshold = 0.35; // 中央35%以内ならアイコンタクトとみなす
    const offsetX = offset?.x ?? 0;
    const offsetY = offset?.y ?? 0;
    // オフセットを適用して判定（キャラの目を見ていてもOK）
    return Math.abs(gaze.x - offsetX) < threshold && Math.abs(gaze.y - offsetY) < threshold;
  }, []);

  // フレーム検出（オフセット対応）
  const detectFrame = useCallback(
    (video: HTMLVideoElement, timestampMs: number, gazeOffset?: { x: number; y: number }): AnalysisFrame | null => {
      if (!faceLandmarkerRef.current || !video.videoWidth) {
        return null;
      }

      try {
        const result: FaceLandmarkerResult = faceLandmarkerRef.current.detectForVideo(
          video,
          timestampMs
        );

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
          return null;
        }

        const landmarks = result.faceLandmarks[0];
        const gazeDirection = calculateGazeDirection(landmarks);
        const eyeContact = isEyeContact(gazeDirection, gazeOffset);

        // Blendshapes を Record に変換
        const blendshapes: Record<string, number> = {};
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
          for (const shape of result.faceBlendshapes[0].categories) {
            blendshapes[shape.categoryName] = shape.score;
          }
        }

        return {
          timestamp: timestampMs,
          gazeDirection,
          eyeContact,
          blendshapes,
        };
      } catch (err) {
        console.error('[FaceLandmarker] Detection error:', err);
        return null;
      }
    },
    [calculateGazeDirection, isEyeContact]
  );

  // クリーンアップ
  const cleanup = useCallback(() => {
    if (faceLandmarkerRef.current) {
      faceLandmarkerRef.current.close();
      faceLandmarkerRef.current = null;
      setIsInitialized(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isInitialized,
    isLoading,
    error,
    initialize,
    detectFrame,
    cleanup,
  };
}
