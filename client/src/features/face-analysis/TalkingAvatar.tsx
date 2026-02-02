import { useEffect, useRef, useCallback } from 'react';

type Props = {
  width?: number;
  height?: number;
  isSpeaking?: boolean;
  audioElement?: HTMLAudioElement | null;
  className?: string;
};

// 顔のパーツ位置（比率）
const FACE = {
  // 顔の輪郭
  faceY: 0.5,
  faceRadiusX: 0.35,
  faceRadiusY: 0.42,
  // 目
  eyeY: 0.4,
  eyeSpacing: 0.15, // 中心からの距離
  eyeRadius: 0.045,
  pupilRadius: 0.02,
  // 眉
  browY: 0.32,
  browWidth: 0.08,
  browHeight: 0.015,
  // 鼻
  noseY: 0.52,
  noseWidth: 0.03,
  noseHeight: 0.06,
  // 口
  mouthY: 0.65,
  mouthWidth: 0.12,
  mouthHeightClosed: 0.015,
  mouthHeightOpen: 0.06,
};

// 色
const COLORS = {
  skin: '#FFE4C4', // ベージュ
  skinShadow: '#DEC4A4',
  eye: '#FFFFFF',
  pupil: '#3D2314',
  eyebrow: '#5D4037',
  mouth: '#E57373',
  mouthInner: '#B71C1C',
  outline: '#8D6E63',
};

export function TalkingAvatar({
  width = 200,
  height = 200,
  isSpeaking = false,
  audioElement,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const mouthOpenRef = useRef(0);

  // 顔を描画
  const drawFace = useCallback(
    (ctx: CanvasRenderingContext2D, mouthOpen: number) => {
      const w = width;
      const h = height;
      const cx = w / 2;

      ctx.clearRect(0, 0, w, h);

      // 顔の輪郭（楕円）
      ctx.beginPath();
      ctx.ellipse(
        cx,
        h * FACE.faceY,
        w * FACE.faceRadiusX,
        h * FACE.faceRadiusY,
        0,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = COLORS.skin;
      ctx.fill();
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 影（顔の下部）
      ctx.beginPath();
      ctx.ellipse(
        cx,
        h * 0.7,
        w * 0.25,
        h * 0.15,
        0,
        0,
        Math.PI
      );
      ctx.fillStyle = COLORS.skinShadow;
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;

      // 左眉
      drawEyebrow(ctx, cx - w * FACE.eyeSpacing, h * FACE.browY, w, false);
      // 右眉
      drawEyebrow(ctx, cx + w * FACE.eyeSpacing, h * FACE.browY, w, true);

      // 左目
      drawEye(ctx, cx - w * FACE.eyeSpacing, h * FACE.eyeY, w);
      // 右目
      drawEye(ctx, cx + w * FACE.eyeSpacing, h * FACE.eyeY, w);

      // 鼻
      drawNose(ctx, cx, h * FACE.noseY, w, h);

      // 口
      drawMouth(ctx, cx, h * FACE.mouthY, w, mouthOpen);
    },
    [width, height]
  );

  // 目を描画
  const drawEye = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number
  ) => {
    const eyeRadius = w * FACE.eyeRadius;
    const pupilRadius = w * FACE.pupilRadius;

    // 白目
    ctx.beginPath();
    ctx.ellipse(x, y, eyeRadius * 1.3, eyeRadius, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.eye;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 瞳
    ctx.beginPath();
    ctx.arc(x, y, pupilRadius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pupil;
    ctx.fill();

    // ハイライト
    ctx.beginPath();
    ctx.arc(x - pupilRadius * 0.3, y - pupilRadius * 0.3, pupilRadius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  };

  // 眉を描画
  const drawEyebrow = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    isRight: boolean
  ) => {
    const browWidth = w * FACE.browWidth;
    const browHeight = w * FACE.browHeight;

    ctx.beginPath();
    ctx.ellipse(x, y, browWidth, browHeight, isRight ? 0.1 : -0.1, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.eyebrow;
    ctx.fill();
  };

  // 鼻を描画
  const drawNose = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    const noseWidth = w * FACE.noseWidth;
    const noseHeight = h * FACE.noseHeight;

    ctx.beginPath();
    ctx.moveTo(x, y - noseHeight / 2);
    ctx.lineTo(x - noseWidth, y + noseHeight / 2);
    ctx.lineTo(x + noseWidth, y + noseHeight / 2);
    ctx.closePath();
    ctx.fillStyle = COLORS.skinShadow;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  // 口を描画
  const drawMouth = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    openAmount: number // 0-1
  ) => {
    const mouthWidth = w * FACE.mouthWidth;
    const mouthHeightClosed = w * FACE.mouthHeightClosed;
    const mouthHeightOpen = w * FACE.mouthHeightOpen;
    const currentHeight = mouthHeightClosed + (mouthHeightOpen - mouthHeightClosed) * openAmount;

    // 口の外側
    ctx.beginPath();
    ctx.ellipse(x, y, mouthWidth, currentHeight, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.mouth;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 口が開いている時は内側も描画
    if (openAmount > 0.1) {
      ctx.beginPath();
      ctx.ellipse(x, y, mouthWidth * 0.7, currentHeight * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.mouthInner;
      ctx.fill();
    }
  };

  // 音声振幅を取得してアニメーション
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let targetMouthOpen = 0;

    if (isSpeaking && analyserRef.current) {
      // 音声振幅から口の開き具合を計算
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      // 低〜中周波数帯の平均を取る（声の帯域）
      const voiceRange = dataArray.slice(0, Math.floor(dataArray.length / 4));
      const average = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length;
      targetMouthOpen = Math.min(1, average / 128);
    } else if (isSpeaking) {
      // Analyserがない場合は単純な開閉アニメーション
      targetMouthOpen = 0.3 + Math.sin(Date.now() / 100) * 0.2;
    }

    // スムーズに補間
    mouthOpenRef.current += (targetMouthOpen - mouthOpenRef.current) * 0.3;

    drawFace(ctx, mouthOpenRef.current);

    animationRef.current = requestAnimationFrame(animate);
  }, [isSpeaking, drawFace]);

  // AudioElementからAnalyserを設定
  useEffect(() => {
    if (!audioElement) {
      analyserRef.current = null;
      return;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      // 既存のsourceがあれば再利用を試みる
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaElementSource(audioElement);
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      sourceRef.current.connect(analyser);
      analyser.connect(audioContext.destination);

      analyserRef.current = analyser;

      // AudioContextが停止している場合は再開
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    } catch (err) {
      console.warn('[TalkingAvatar] Failed to setup audio analyser:', err);
    }
  }, [audioElement]);

  // アニメーションループ
  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{
        borderRadius: '50%',
        backgroundColor: '#F5F5F5',
      }}
    />
  );
}

export default TalkingAvatar;
