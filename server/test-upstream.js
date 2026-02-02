// server/test-upstream.js
// ------------------------------------------------------------
// Deepgram の WebSocket Realtime API に接続して、
// 正しく Configure メッセージを送れるか確認するためのテストスクリプト。
// ------------------------------------------------------------

import 'dotenv/config';
import WebSocket from 'ws';

// ------------------------------------------------------------
// 1) URLパラメータで設定を渡す
//    model / language / encoding / sample_rate などは
//    クエリ文字列で指定する。
// ------------------------------------------------------------
const params = new URLSearchParams({
  model: 'nova-2',
  language: 'ja',
  encoding: 'opus',
  sample_rate: '48000',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true'
});

// DeepgramのWebSocketエンドポイント
const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
  headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
});

// ------------------------------------------------------------
// 2) 接続オープン時：Configure メッセージを送信
// ------------------------------------------------------------
ws.on('open', () => {
  console.log('[test] open');

  // Deepgramでは Configure に features が必須
  ws.send(JSON.stringify({
    type: 'Configure',
    features: {
      punctuate: true,
      interim_results: true,
      smart_format: true
    }
  }));

  console.log('[test] configure sent');

  // 1秒後にクローズ（動作確認用）
  setTimeout(() => ws.close(1000, 'done'), 1000);
});

// ------------------------------------------------------------
// 3) 受信したメッセージを表示
// ------------------------------------------------------------
ws.on('message', m => {
  const s = String(m);
  console.log('[test] msg', s.length > 200 ? s.slice(0, 200) + '...' : s);
});

// ------------------------------------------------------------
// 4) close / error ログ
// ------------------------------------------------------------
ws.on('close', (code, reason) => {
  console.log('[test] close', code, reason?.toString?.());
});

ws.on('error', (e) => {
  console.error('[test] error', e);
});
