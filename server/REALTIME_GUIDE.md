いいベース。
これを今の実装と仕様差分（`v1:nova-2/nova-3=日本語`、`v2:flux-general-en=英語のみ`）に合わせて直した版を出すね。
構成と語り口は揃えたまま、要点だけ明確に更新してある。

---

# Deepgram リアルタイム文字起こし 安定運用ガイド（2025-10 更新）

このドキュメントは、現行実装をもとに「安定して遅延の少ないリアルタイム文字起こし」を運用・拡張するための実務ポイントをまとめたものです。

* 対象コード: `server/server.js`, `public/client.js`
* 簡易検証: `server/test-upstream.js`
* 前提: Node.js 18+, Deepgram API Key を `.env` の `DEEPGRAM_API_KEY` に設定

---

## 現行アーキテクチャ

| 層    | 技術構成                                                             | 主な役割                                        |
| ---- | ---------------------------------------------------------------- | ------------------------------------------- |
| フロント | HTML + Vanilla JS (`client.js`)                                  | マイク入力 → PCM16 / Opus 変換 → WebSocket送信／結果描画  |
| サーバ  | Node.js (Express + ws / ESM)                                     | Deepgram接続中継、Configure／KeepAlive／Finalize処理 |
| 音声形式 | PCM16 / Opus (48kHz, mono)                                       | 安定性・帯域効率両立                                  |
| 通信   | ws://localhost:3000/ws → wss://api.deepgram.com/v1 or /v2/listen | 双方向リアルタイム転送                                 |

---

## モデル選択ルール（2025年10月時点）

| モデル / 言語                 | 接続エンドポイント    | 備考                                                             |
| ------------------------ | ------------ | -------------------------------------------------------------- |
| **nova-2 / nova-3（日本語）** | `/v1/listen` | 日本語リアルタイムは v1 のみ対応。nova-3(v1) が無効な環境では自動で nova-2 にフォールバック。     |
| **flux-general-en（英語）**  | `/v2/listen` | v2(Flux) は英語専用。クエリは最小限（`model`, `encoding`, `sample_rate` のみ）。 |
| **nova-3（英語）**           | `/v2/listen` | 内部的に `flux-general-en` にマップ。                                   |

> ⚠ `flux-general-ja` 等はまだ存在せず、「Only the flux-general-en model is supported.」というエラーが返る。これは API キーの問題ではなく仕様上の制限。

---

## Deepgram 接続仕様（v1/v2両対応）

* 共通メッセージ構成

  * 接続直後に `{ type: "Configure", features: { punctuate, interim_results, smart_format } }`
  * 5秒ごとに `{ type: "KeepAlive" }`
  * 終了時 `{ type: "Finalize" }` → close(1000)
* v1 のみ受け付けるクエリ: `model`, `language`, `encoding`, `sample_rate`, `punctuate`, `smart_format`, `interim_results`
* v2 は **最小クエリのみ**（`model`, `encoding`, `sample_rate`）

  * それ以外は `Configure` メッセージで指定
* mono指定はブラウザで処理済み。`channels` はクエリに含めない。

---

## クライアント（ブラウザ）側の実装ポイント

* **録音**

  * `AudioContext`（PCM16）または `MediaRecorder`（Opus）を選択式。
  * `sampleRate=48000`, `channelCount=1`
* **コーデック選択**

  * Opus（`audio/webm;codecs=opus`）推奨。環境により PCM16 fallback。
* **チャンク**

  * 250ms チャンク送出（低遅延と安定性のバランス）。
* **UI**

  * モデル選択（nova-2 / nova-3 / flux-general）
  * コーデック（PCM16 / Opus）
  * 言語（ja / ja-JP / en-US / multi）
* **送受信**

  * バイナリは `arraybuffer` のまま送信。
  * 受信データの `Results` を解析して `partial` と `final` を表示。

---

## サーバ（ブリッジ）側の実装ポイント

* **自動判定ロジック**

  * 日本語系（`ja*`） → `/v1/listen` × nova-2
  * 英語系（`en*`） → `/v2/listen` × flux-general-en
  * `nova-3` 選択時：日本語→nova-2(v1)、英語→flux-general-en(v2)
* **クリーンな終了**

  * 下流 close/error → `Finalize` → 上流 close。
  * 上流 close/error → 下流へ通知 → close。
* **KeepAlive**

  * 5秒間隔。途絶時にタイムアウト防止。
* **ログ**

  * `[dg attempt]` `[dg open]` `[dg->server]` `[dg closed]` の4段階で状態確認。

---

## エラーハンドリング指針

| 症状                                             | 対応                                          |
| ---------------------------------------------- | ------------------------------------------- |
| `400 INVALID_QUERY_PARAMETER`                  | v2 に不要なクエリ（language, punctuate等）を送っている。修正済。 |
| `Only the flux-general-en model is supported.` | 日本語モデルがまだ未公開。英語に切り替える。                      |
| `close 1000` 直後に無音                             | nova-3(v1)が無効。nova-2にフォールバック。               |
| 文字起こしが出ない                                      | Configure送信ミス、無音、またはAPIキー権限未付与。             |

---

## 運用チェックリスト（更新版）

* [ ] `.env` に `DEEPGRAM_API_KEY` を設定済 (`ENV OK: true`)
* [ ] 日本語 → nova-2(v1) 経路で `Results` が返る
* [ ] 英語 → flux-general-en(v2) 経路で `Results` が返る
* [ ] KeepAlive が 5s ごとに送られている
* [ ] 停止操作で Finalize → close(1000)
* [ ] 再接続でリークがない（FD/メモリ増加なし）

---

## よくある質問（FAQ）

**Q. nova-3 は日本語に対応していないの？**
→ モデル自体は対応予定だが、Realtime v2 API では英語専用。日本語は従来の `/v1/listen` で nova-2/3 を使用。

**Q. APIキーの権限不足？**
→ いいえ。エラーメッセージが `Only the flux-general-en model is supported` の場合は仕様制限。キー権限ではなくモデル側の制約。

**Q. 将来 v2 で日本語を使うには？**
→ Deepgram が flux-general-ja を公開したら、`effModelV2` を `flux-general-ja` に変更するだけで移行可。

---

## 将来への備え

* v2 のモデル対応が拡張されたら `server.js` の分岐を `langSuffix(lang)` ベースに戻すだけ。
* v1 のサポート終了時も、`Configure/KeepAlive/Finalize` の枠組みは共通なので大きな書き換えは不要。

---

## セキュリティ / 運用補足

* APIキーはサーバのみで保持。フロントには出さない。
* HTTPS(WSS) 化と CORS 制御を検討。
* ログに個人情報やAPIキーを出力しない。

---

## 参考リンク

* Deepgram Docs:

  * [Realtime Streaming API v1](https://developers.deepgram.com/docs/streaming-api)
  * [Realtime v2 (Flux)](https://developers.deepgram.com/docs/flux-realtime)
* 実装: `server/server.js`, `public/client.js`

---

これで、今の動作（日本語→v1 / 英語→v2）がそのままガイドラインとして残せる。
更新が入っても `effModelV2` の指定を変えるだけで追随できる構造になってる。
