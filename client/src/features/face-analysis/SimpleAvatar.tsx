import { useEffect, useRef, useState } from 'react';

type Props = {
  width?: number;
  height?: number;
  isSpeaking?: boolean;
  audioElement?: HTMLAudioElement | null;
};

export function SimpleAvatar({
  width = 140,
  height = 140,
  isSpeaking = false,
  audioElement,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [eyesClosed, setEyesClosed] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // 瞬き
  useEffect(() => {
    let timerId: number;
    const blink = () => {
      setEyesClosed(true);
      setTimeout(() => setEyesClosed(false), 120);
    };

    const scheduleNextBlink = () => {
      const delay = 2000 + Math.random() * 3000;
      timerId = window.setTimeout(() => {
        blink();
        scheduleNextBlink();
      }, delay);
    };

    scheduleNextBlink();
    return () => clearTimeout(timerId);
  }, []);

  // 音声解析
  useEffect(() => {
    if (!audioElement) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;

      if (!analyserRef.current) {
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 256;
      }

      if (!(audioElement as any)._simpleAvatarConnected) {
        const source = ctx.createMediaElementSource(audioElement);
        source.connect(analyserRef.current);
        analyserRef.current.connect(ctx.destination);
        (audioElement as any)._simpleAvatarConnected = true;
      }
    } catch (err) {
      console.warn('[SimpleAvatar] Audio setup failed:', err);
    }
  }, [audioElement]);

  // 口アニメーション
  useEffect(() => {
    const animate = () => {
      if (isSpeaking && analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const voiceRange = dataArray.slice(0, 30);
        const avg = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length;
        setMouthOpen(Math.min(1, avg / 70));
      } else {
        setMouthOpen((prev) => Math.max(0, prev - 0.15));
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isSpeaking]);

  // Canvas描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;

    // 変換行列をリセットしてからスケール適用（累積防止）
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // クリア
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const faceRadius = Math.min(width, height) * 0.42;

    // 影
    ctx.beginPath();
    ctx.ellipse(cx, cy + faceRadius * 0.95, faceRadius * 0.9, faceRadius * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fill();

    // 髪（後ろ）
    ctx.beginPath();
    ctx.ellipse(cx, cy - faceRadius * 0.15, faceRadius * 1.1, faceRadius * 0.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#4A3C31';
    ctx.fill();

    // 顔
    ctx.beginPath();
    ctx.ellipse(cx, cy, faceRadius, faceRadius * 1.05, 0, 0, Math.PI * 2);
    const faceGradient = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy, faceRadius);
    faceGradient.addColorStop(0, '#FFE8D6');
    faceGradient.addColorStop(1, '#F5D5C0');
    ctx.fillStyle = faceGradient;
    ctx.fill();

    // 髪（前髪）
    ctx.beginPath();
    ctx.moveTo(cx - faceRadius * 0.9, cy - faceRadius * 0.3);
    ctx.quadraticCurveTo(cx - faceRadius * 0.5, cy - faceRadius * 1.1, cx, cy - faceRadius * 0.85);
    ctx.quadraticCurveTo(cx + faceRadius * 0.5, cy - faceRadius * 1.1, cx + faceRadius * 0.9, cy - faceRadius * 0.3);
    ctx.quadraticCurveTo(cx + faceRadius * 0.7, cy - faceRadius * 0.5, cx + faceRadius * 0.4, cy - faceRadius * 0.45);
    ctx.quadraticCurveTo(cx, cy - faceRadius * 0.55, cx - faceRadius * 0.4, cy - faceRadius * 0.45);
    ctx.quadraticCurveTo(cx - faceRadius * 0.7, cy - faceRadius * 0.5, cx - faceRadius * 0.9, cy - faceRadius * 0.3);
    ctx.fillStyle = '#4A3C31';
    ctx.fill();

    // サイドヘア
    ctx.beginPath();
    ctx.ellipse(cx - faceRadius * 0.85, cy + faceRadius * 0.1, faceRadius * 0.25, faceRadius * 0.5, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#4A3C31';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + faceRadius * 0.85, cy + faceRadius * 0.1, faceRadius * 0.25, faceRadius * 0.5, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 眉毛
    const browY = cy - faceRadius * 0.15;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5D4E42';

    ctx.beginPath();
    ctx.moveTo(cx - faceRadius * 0.45, browY);
    ctx.quadraticCurveTo(cx - faceRadius * 0.3, browY - 4, cx - faceRadius * 0.15, browY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + faceRadius * 0.15, browY);
    ctx.quadraticCurveTo(cx + faceRadius * 0.3, browY - 4, cx + faceRadius * 0.45, browY);
    ctx.stroke();

    // 目
    const eyeY = cy + faceRadius * 0.05;
    const eyeSpacing = faceRadius * 0.35;

    if (eyesClosed) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#4A3C31';
      ctx.beginPath();
      ctx.moveTo(cx - eyeSpacing - 8, eyeY);
      ctx.quadraticCurveTo(cx - eyeSpacing, eyeY + 4, cx - eyeSpacing + 8, eyeY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + eyeSpacing - 8, eyeY);
      ctx.quadraticCurveTo(cx + eyeSpacing, eyeY + 4, cx + eyeSpacing + 8, eyeY);
      ctx.stroke();
    } else {
      // 白目
      ctx.beginPath();
      ctx.ellipse(cx - eyeSpacing, eyeY, 9, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.strokeStyle = '#E0D0C0';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(cx + eyeSpacing, eyeY, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 黒目
      ctx.beginPath();
      ctx.ellipse(cx - eyeSpacing, eyeY + 1, 6, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3D2E24';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + eyeSpacing, eyeY + 1, 6, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // ハイライト
      ctx.beginPath();
      ctx.ellipse(cx - eyeSpacing + 2, eyeY - 2, 2.5, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + eyeSpacing + 2, eyeY - 2, 2.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 頬
    ctx.beginPath();
    ctx.ellipse(cx - faceRadius * 0.55, cy + faceRadius * 0.25, 8, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 180, 180, 0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + faceRadius * 0.55, cy + faceRadius * 0.25, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 口
    const mouthY = cy + faceRadius * 0.45;
    const mouthWidth = 10 + mouthOpen * 5;
    const mouthHeight = 3 + mouthOpen * 12;

    if (mouthOpen > 0.2) {
      // 開いた口
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, mouthWidth, mouthHeight, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#C44';
      ctx.fill();

      // 舌
      if (mouthOpen > 0.4) {
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + mouthHeight * 0.4, mouthWidth * 0.6, mouthHeight * 0.4, 0, 0, Math.PI);
        ctx.fillStyle = '#E77';
        ctx.fill();
      }
    } else {
      // 閉じた口（にっこり）
      ctx.beginPath();
      ctx.moveTo(cx - 8, mouthY);
      ctx.quadraticCurveTo(cx, mouthY + 6, cx + 8, mouthY);
      ctx.strokeStyle = '#C44';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

  }, [width, height, mouthOpen, eyesClosed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        borderRadius: '50%',
        background: 'linear-gradient(180deg, #E8F4F8 0%, #D4E8ED 100%)',
      }}
    />
  );
}

export default SimpleAvatar;
