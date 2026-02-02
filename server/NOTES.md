了解。エンジニア共有用に、**「nova-2はなぜ動いたか」→「nova-3で何が違うか」→「具体的な対応案」**の順で一枚にまとめた。

---

# Deepgram リアルタイム文字起こし

## 現状整理 / 成功条件（nova-2）と差分（nova-3）

## 1) 現状の動作構成（nova-2は安定動作）

### サーバ（要点）

* **生WebSocket直結**：`wss://api.deepgram.com/v1/listen?...`
* **URLクエリで設定**（本文では送らない）

  * `model=nova-2`
  * `language=ja`（または `ja-JP`）
  * `encoding=linear16`
  * `sample_rate=48000`
  * `punctuate=true&smart_format=true&interim_results=true`
* **接続直後に1回だけ**:

  ```json
  { "type": "Configure", "features": {
      "punctuate": true, "interim_results": true, "smart_format": true
  }}
  ```
* **KeepAlive**: 5秒ごとに `{ "type": "KeepAlive" }`
* **終了時**: `{ "type": "Finalize" }` → `close(1000)`
* **下流へのブリッジ**: Deepgramからのメッセージは**テキストフレーム**でブラウザに転送（バイナリ→文字列に変換して送出）

### クライアント（要点）

* **PCM16送出**（最小構成・ブラウザ差に強い）

  * `AudioContext(48kHz)` → `ScriptProcessorNode(4096)`
  * `Float32` → **`Int16LE`変換** → `/ws` へバイナリ送信（250〜90fps相当）
* **表示**

  * `type:"Results"` をそのまま受け取り、

    * `is_final||speech_final` → **確定(#finalに追記)**
    * それ以外 → **一時(#partialに上書き)**
* **無音対策**：無音でも小さなダミーを送出（切断回避）

### なぜ **nova-2 が安定して動いたか（根拠とメカニズム）**

* **フォーマット整合**：`linear16 / 48kHz / mono` でサーバ→Deepgramが完全一致。
* **初期化順序が正しい**：URLクエリでモデル/言語/エンコーディングを渡し、**`Configure(features)` は1回だけ**送信。
* **アイドル切断回避**：5s KeepAlive + 無音でも送る実装で、無音10秒前後の切断を抑止。
* **クライアント表示の型整合**：サーバ→ブラウザを**テキストフレーム**化（`Blob`/バイナリで落とさず JSON 直読可能）。
* **権限/環境**：`.env` を ESM 対応（`import 'dotenv/config'`）で確実読込、キー露出なし（サーバのみ）。

---

## 2) **nova-3** で起きた事象と差分の論点

### 事象（実ログ）

* 接続 → `Metadata` 返却までは到達。
* 直後に `close 1000`（エラーではない正常終了コード）。
* `Results` が一件も降りないケースあり（= **音声未受理 or 仕様条件未充足**）。

### 差分が疑われる点

1. **チャネル指定の明示**

   * 生PCMは**mono想定**。`channels=1` を**URLクエリに明示**すると安定度が上がるケースがある。
2. **言語コードの厳格化**

   * `ja` と `ja-JP` の扱いがモデル/世代でブレることがある。`ja-JP` 明示で回避可能。
3. **/v1 と /v2 の挙動差**

   * nova-3 周辺のランタイム/ルータが `/v2` スタックで安定するケースがある（`/v2/listen` を試して差分確認）。
4. **入力コーデック相性**

   * `linear16` が環境で揺らぐ場合は **`opus`** でのストリーミングに切替テスト（MediaRecorder→WebM/Opus→サーバ中継）。
5. **権限・有効化**

   * テナントで nova-3 の realtime が有効化されているか（稀に権限差で無音終了）。

---

## 3) エンジニア向け：**最小差分パッチ**（nova-3 検証順）

### (A) mono 明示 ＋ 言語コード正規化（/v1のまま）

```diff
// server: Deepgram接続URLのパラメータ生成
const params = new URLSearchParams({
- model, language: lang,
+ model,
+ language: (lang === 'ja' ? 'ja-JP' : lang),
  encoding: 'linear16',
  sample_rate: '48000',
+ channels: '1',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true'
});
```

### (B) それでもダメなら **/v2** に切替

```diff
- const dg = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { ... });
+ const dg = new WebSocket(`wss://api.deepgram.com/v2/listen?${params}`, { ... });
```

### (C) さらに通らない場合の**Opus送信テスト**（最終手段）

* クライアントを MediaRecorder に切替（`audio/webm;codecs=opus` で 100–250ms チャンク）
* サーバ側は：

```diff
- encoding=linear16
+ encoding=opus
  sample_rate=48000        // （Opusでも指定可／Deepgram側が解釈）
```

> 注：テストは **A → B → C の順**で。（Aで通るケースが多い）

---

## 4) 動作確認チェックリスト（nova-3検証時）

* **Network→WS→/ws**

  * **Sent** に 2〜8KB の **Binary Message** が 0.25s 間隔で並ぶ（ブラウザ→サーバOK）
* **サーバログ**

  * `[dg] open & configure sent` が出る
  * `[dg->server] {"type":"Results"...}` が**1件でも出る**（音声受理）
* **ブラウザ表示**

  * `partial` に途中文が現れ、`final` に確定文が追記される
* もし **Metadataのみ→即close** の場合

  * A/B/C の順で差分パッチを当てて再検証
  * それでも無反応なら **Deepgramの最初のError/Metadata JSON** と **close code** を保存して共有

---

## 5) 参考スニペット（完成形の“パラメータと初期化”）

```js
// Deepgram接続（/v1 or /v2 は切替）
// ここでは /v1 例。/v2 を試す場合はパスを置換。
const params = new URLSearchParams({
  model: 'nova-3',                 // ← 切替
  language: 'ja-JP',               // ← 正規化
  encoding: 'linear16',            // ← まずはPCM16で
  sample_rate: '48000',
  channels: '1',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true'
});

const dg = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
  headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
});

dg.on('open', () => {
  dg.send(JSON.stringify({
    type: 'Configure',
    features: { punctuate: true, interim_results: true, smart_format: true }
  }));
  // KeepAlive
  setInterval(() => {
    if (dg.readyState === 1) dg.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 5000);
});
```

---

### まとめ（エンジニア向け一言）

* **nova-2 が通った理由**は「PCM16 mono/48k と初期化順序（URLクエリ + 1回だけのConfigure）＋KeepAlive＋テキスト転送」の整合が取れたから。
* **nova-3 は** その上で **mono明示（channels=1）／言語コード正規化（ja-JP）／場合により /v2 or Opus** が効く。
* まず **A→B→C** の順でパッチを当て、**`Results` が出始めるか**をサーバログで確認して欲しい。
