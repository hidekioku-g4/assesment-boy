import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// PixiJS v6用の設定
Live2DModel.registerTicker(PIXI.Ticker);

// BatchRendererの設定（checkMaxIfStatementsInShaderエラー回避）
try {
  PIXI.BatchRenderer.defaultMaxTextures = 16;
} catch (e) {
  console.warn('[Live2DAvatar] Failed to set BatchRenderer.defaultMaxTextures');
}

// 表情の定義
export type ExpressionType = 'neutral' | 'smile' | 'happy' | 'think' | 'surprise' | 'sad' | 'shy';

// 各表情のパラメータ設定（直接適用用）
const EXPRESSION_PARAMS: Record<ExpressionType, Record<string, number>> = {
  neutral: {},
  smile: {
    ParamEyeLSmile: 0.5,
    ParamEyeRSmile: 0.5,
    ParamMouthForm: 0.5,
  },
  happy: {
    ParamEyeLSmile: 1,
    ParamEyeRSmile: 1,
    ParamMouthForm: 1,
    ParamCheek: 0.6,
    ParamBrowLY: 0.3,
    ParamBrowRY: 0.3,
  },
  think: {
    ParamBrowLY: -0.3,
    ParamBrowRY: -0.3,
    ParamMouthForm: -0.3,
  },
  surprise: {
    ParamEyeLOpen: 1.2,
    ParamEyeROpen: 1.2,
    ParamBrowLY: 0.5,
    ParamBrowRY: 0.5,
    ParamMouthForm: 0.3,
  },
  sad: {
    ParamBrowLY: -0.5,
    ParamBrowRY: -0.3,
    ParamEyeLOpen: 0.6,
    ParamEyeROpen: 0.6,
    ParamMouthForm: -0.5,
  },
  shy: {
    ParamEyeLSmile: 0.3,
    ParamEyeRSmile: 0.3,
    ParamMouthForm: 0.3,
    ParamCheek: 1,
  },
};

type Props = {
  modelPath: string;
  width?: number;
  height?: number;
  isSpeaking?: boolean;
  isListening?: boolean;
  audioElement?: HTMLAudioElement | null;
  externalAnalyser?: AnalyserNode | null;
  onError?: (error: string) => void;
  zoom?: number;
  offsetY?: number;
  autoSize?: boolean;
  expression?: ExpressionType;
};

export function Live2DAvatar({
  modelPath,
  width: propWidth,
  height: propHeight,
  isSpeaking = false,
  isListening = false,
  audioElement,
  externalAnalyser,
  onError,
  zoom = 1.0,
  offsetY = 0,
  autoSize = false,
  expression = 'neutral',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  const [containerSize, setContainerSize] = useState({ width: propWidth || 300, height: propHeight || 400 });
  const currentExpressionRef = useRef<ExpressionType>('neutral');
  const isListeningRef = useRef(false);
  const animTimeRef = useRef(0);

  // zoom/offsetY/sizeをrefで保持
  const zoomRef = useRef(zoom);
  const offsetYRef = useRef(offsetY);
  const sizeRef = useRef({ width: 0, height: 0 });
  const originalModelSizeRef = useRef({ width: 0, height: 0 });

  // 実際に使用するサイズ
  const width = autoSize ? containerSize.width : (propWidth || 300);
  const height = autoSize ? containerSize.height : (propHeight || 400);

  zoomRef.current = zoom;
  offsetYRef.current = offsetY;
  sizeRef.current = { width, height };
  isListeningRef.current = isListening;

  // コンテナサイズの監視
  useEffect(() => {
    if (!autoSize || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [autoSize]);

  // Live2Dモデルの初期化
  useEffect(() => {
    if (!canvasRef.current || initRef.current) return;
    initRef.current = true;

    let cancelled = false;

    const initApp = async () => {
      try {
        console.log('[Live2DAvatar] Initializing...');

        const app = new PIXI.Application({
          view: canvasRef.current!,
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoStart: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });

        if (cancelled) {
          app.destroy(true);
          return;
        }

        appRef.current = app;
        console.log('[Live2DAvatar] PIXI App created');

        console.log('[Live2DAvatar] Loading model from:', modelPath);
        const model = await Live2DModel.from(modelPath, {
          autoInteract: false,
          autoUpdate: true,
        });

        if (cancelled) {
          model.destroy();
          app.destroy(true);
          return;
        }

        modelRef.current = model;
        originalModelSizeRef.current = { width: model.width, height: model.height };
        console.log('[Live2DAvatar] Model loaded, size:', model.width, 'x', model.height);

        model.anchor.set(0.5, 0);

        // 利用可能な表情を確認してプリロード
        const em = (model as any).internalModel?.motionManager?.expressionManager;
        if (em) {
          const expressionNames = em.definitions?.map((d: any) => d.Name || d.name) || [];
          console.log('[Live2DAvatar] Expressions available:', expressionNames);

          // 全ての表情をプリロード
          console.log('[Live2DAvatar] Preloading expressions...');
          for (const expName of expressionNames) {
            try {
              await (model as any).expression(expName);
              console.log('[Live2DAvatar] Preloaded expression:', expName);
            } catch (e) {
              console.warn('[Live2DAvatar] Failed to preload expression:', expName, e);
            }
          }
          // neutralに戻す
          await (model as any).expression('neutral');
          console.log('[Live2DAvatar] All expressions preloaded, expressions array length:', em.expressions?.length);
        } else {
          console.log('[Live2DAvatar] No expression manager found');
        }

        app.stage.addChild(model);
        setIsLoaded(true);
        console.log('[Live2DAvatar] Model added to stage');

      } catch (err) {
        console.error('[Live2DAvatar] Failed to load model:', err);
        const msg = err instanceof Error ? err.message : 'モデルの読み込みに失敗しました';
        setError(msg);
        onError?.(msg);
      }
    };

    initApp();

    return () => {
      cancelled = true;
      initRef.current = false;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (modelRef.current) {
        try {
          modelRef.current.destroy();
        } catch {
          // ignore
        }
        modelRef.current = null;
      }
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true });
        } catch {
          // ignore
        }
        appRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPath]);

  // 表情変更 - refを更新するだけ（実際の適用はtickerで行う）
  useEffect(() => {
    if (currentExpressionRef.current !== expression) {
      console.log('[Live2DAvatar] Expression changed:', currentExpressionRef.current, '->', expression);
      currentExpressionRef.current = expression;
    }
  }, [expression]);

  // 位置/スケール維持 + リップシンク
  useEffect(() => {
    if (!isLoaded) return;

    const model = modelRef.current;
    if (!model) return;

    const tickerCallback = () => {
      const currentModel = modelRef.current;
      if (!currentModel) return;

      // 毎フレーム位置とスケールを維持
      const { width, height } = sizeRef.current;
      const originalSize = originalModelSizeRef.current;
      if (width > 0 && height > 0 && originalSize.width > 0) {
        const baseScale = Math.min(width / originalSize.width, height / originalSize.height);
        const scale = baseScale * zoomRef.current;
        currentModel.scale.set(scale);
        currentModel.x = width / 2;
        currentModel.y = offsetYRef.current;
      }

      // 表情パラメータを毎フレーム適用
      const coreModel = (currentModel as any).internalModel?.coreModel;
      if (coreModel) {
        const expressionParams = EXPRESSION_PARAMS[currentExpressionRef.current];
        for (const [paramId, value] of Object.entries(expressionParams)) {
          try {
            coreModel.setParameterValueById(paramId, value, 1);
          } catch {
            // ignore
          }
        }
      }

      // 頷きアニメーション: ユーザーが話している間、小さく頷く
      animTimeRef.current += 1 / 60;
      if (isListeningRef.current && coreModel) {
        const t = animTimeRef.current;
        const nodY = Math.sin(t * Math.PI * 2 / 2.5) * 4;
        const swayX = Math.sin(t * Math.PI * 2 / 3.7) * 1.5;
        try {
          coreModel.setParameterValueById('ParamAngleY', nodY, 0.3);
          coreModel.setParameterValueById('ParamAngleX', swayX, 0.15);
        } catch { /* ignore */ }
      }

      // think表情: 目が上を向いてゆっくり左右に揺れる
      if (currentExpressionRef.current === 'think' && coreModel) {
        const t = animTimeRef.current;
        const eyeY = 0.4 + Math.sin(t * Math.PI * 2 / 4.0) * 0.15;
        const eyeX = Math.sin(t * Math.PI * 2 / 3.0) * 0.3;
        try {
          coreModel.setParameterValueById('ParamEyeBallY', eyeY, 0.5);
          coreModel.setParameterValueById('ParamEyeBallX', eyeX, 0.5);
        } catch { /* ignore */ }
      }

      // リップシンク: 外部 analyser（TTS ストリーミング用）を優先、なければ audioElement 経由
      const activeAnalyser = externalAnalyser || analyserRef.current;
      if (isSpeaking && activeAnalyser) {
        if (coreModel) {
          const dataArray = new Uint8Array(activeAnalyser.frequencyBinCount);
          activeAnalyser.getByteFrequencyData(dataArray);
          const voiceRange = dataArray.slice(2, 15);
          const avg = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length;
          const mouthOpen = avg > 30 ? Math.min(1, (avg - 30) / 80) : 0;

          try {
            coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen, 1);
          } catch {
            // ignore
          }
        }
      } else if (coreModel) {
        try {
          coreModel.setParameterValueById('ParamMouthOpenY', 0, 1);
        } catch {
          // ignore
        }
      }
    };

    PIXI.Ticker.shared.add(tickerCallback, undefined, PIXI.UPDATE_PRIORITY.LOW);

    return () => {
      PIXI.Ticker.shared.remove(tickerCallback);
    };
  }, [isLoaded, isSpeaking, isListening, externalAnalyser]);

  // オーディオ接続
  useEffect(() => {
    if (!audioElement || !isLoaded) return;

    const setupAudio = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const ctx = audioContextRef.current;

        if (ctx.state === 'suspended') {
          await ctx.resume();
          console.log('[Live2DAvatar] AudioContext resumed');
        }

        if (!analyserRef.current) {
          analyserRef.current = ctx.createAnalyser();
          analyserRef.current.fftSize = 256;
          analyserRef.current.smoothingTimeConstant = 0.3;
        }

        if (!(audioElement as any)._live2dConnected) {
          const source = ctx.createMediaElementSource(audioElement);
          source.connect(analyserRef.current);
          analyserRef.current.connect(ctx.destination);
          (audioElement as any)._live2dConnected = true;
          console.log('[Live2DAvatar] Audio connected');
        }
      } catch (err) {
        console.warn('[Live2DAvatar] Audio setup failed:', err);
      }
    };

    setupAudio();
  }, [audioElement, isLoaded]);

  // リサイズ時にPixiJS rendererを更新
  useEffect(() => {
    if (!appRef.current || !isLoaded) return;
    appRef.current.renderer.resize(width, height);
  }, [width, height, isLoaded]);

  if (error) {
    return (
      <div
        ref={containerRef}
        style={autoSize ? { width: '100%', height: '100%' } : { width, height }}
        className="flex items-center justify-center bg-slate-100 rounded-lg text-xs text-red-500 p-2"
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={autoSize ? { width: '100%', height: '100%' } : { width, height }}
      className="relative"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
      {!isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
          <span className="text-sm text-slate-400">読み込み中...</span>
        </div>
      )}
    </div>
  );
}

export default Live2DAvatar;
