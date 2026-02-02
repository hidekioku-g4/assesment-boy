# Codex ハンドオフメモ（UI リニューアル案件）

## 背景
- React + shadcn/Tailwind で既存の Vanilla UI を置き換える途中。
- 段階的な AI パイプライン（クリーン → 用語抽出 → 構造化）やキーワード管理など、旧 UI の機能を再実装する必要がある。
- 前回は一度に多くの変更を試みたため途中で破綻し、元のコード状態に戻している。

## 現状のポイント
- `client/src/App.tsx` は元の状態（React 化前の大規模リファクタを適用する前）に戻っている。
- `client` ディレクトリや新しい依存（React, Tailwind, shadcn 関連）はインストール済み。`npm run client:build` でビルド可能。
- `server/server.js` はすでに `@google/genai` を使用するよう更新済みで稼働中。

## 次に進める際の推奨ステップ
1. **ビュー切り替えの導入（最小実装）**  
   - `activeView` ステートを導入し、サイドバーとメインパネルの切り替えを条件分岐で実装。  
   - サマリー／語彙ビューはプレースホルダ表示で OK。

2. **パイプライン UI の移設**  
   - サマリータブに「クリーン」「用語抽出」「構造化」カード＋ステータスバッジを設置。  
   - ボタンから既存 API (`/api/clean` 等) を順番に呼び、現在のステートへ保存。

3. **旧 UI の補助機能を段階的に移植**  
   - キーワード管理、メモ入力、ダウンロード（JSON/Markdown/CSV）などを個別の小さな PR で反映。  
   - UI コンポーネント化は必要に応じて段階的に（例：`SummaryStepCard` など）。

4. **語彙ビュー・リアルタイムパネルの仕上げ**  
   - 語彙タブでは抽出済み用語の詳細（コンテキスト・定義）を表示。  
   - 右側パネルのリアルタイム分析・トピック表示は必要に応じてユーティリティ化。

## 作業上の注意
- **1 タスク = 1 PR の粒度** を意識し、変更を小さく保つ。  
- ファイルを全差し替えする場合は段階的に（部分的な関数単位またはコンポーネント単位）編集する。  
- 大きな差分を試す場合は一時 branch を作成し、ロールバックが容易な状態を維持。  
- `npm run client:build` と `npm run dev` の動作確認を小まめに行い、失敗したら即座に差分を見直す。

## 元仕様を確認するには
- 旧 UI の挙動は `public/index.html` と `public/client.js` にまとまっている。  
  - **キーワード編集、メモ入力、段階的なクリーン/抽出/構造化の流れ**などは `public/client.js` が一次ソース。  
  - 新 UI に移植する際は必要なロジックを順番に読み替えていくこと。
- スタイル・クラス名などは `public/modern.css` に記録されている（参考用）。

## 参考
- 既存 React + Tailwind セットアップ: `client/vite.config.ts`, `tailwind.config.cjs`, `postcss.config.cjs`。  
- 新 SDK の利用例: `server/server.js` の `genAI.models.generateContent` 呼び出し。  
- ビルドコマンド: `npm run client:build`（本番バンドル）、`npm run client:dev`（Vite dev サーバー）。
