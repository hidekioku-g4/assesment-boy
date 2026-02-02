# おはようアセス君

おはようアセスメント面談を支援するリアルタイム文字起こし・記録作成ツール。

傾聴君をベースに、アセスメント面談向けにカスタマイズしたバージョンです。

## アプリ設定情報

| 項目 | 値 |
|------|-----|
| アプリ名 | おはようアセス君 |
| appId | jp.thankslab.assess-kun |
| サーバーポート | 37212 |
| 認証ポート | 43122 |
| userData | `%APPDATA%/おはようアセス君/` |

## Azure AD 設定（設定済み前提）

| 項目 | 値 |
|------|-----|
| クライアントID | `15eefee7-2643-4dce-921d-1ffb52737ae7` |
| テナントID | `3d540d42-b0fd-4a55-b84f-b51a4a6da5a3` |

### 登録済みリダイレクトURI

| 用途 | URI |
|------|-----|
| ブラウザ開発（SPA） | `http://localhost:37212` |
| Electronアプリ | `http://localhost:43122/redirect` |

## データ取り扱い方針（最重要）

このプロジェクトは**激烈に機微な個人情報**を扱うため、**ローカル/サーバに永続保存しない**ことを大原則とします。
**最終保管先は BigQuery のみ**で、アプリ/サーバは原則ステートレス運用を前提とします。

- 面談内容・文字起こし・支援記録は**ディスク/DB/キャッシュ/ログに残さない**
- ブラウザの localStorage / sessionStorage / IndexedDB への保存も**原則禁止**
- 例外が必要な場合は**目的・期間・削除手順**を明記する

詳細は `docs/DATA_HANDLING_POLICY.md` を参照してください。

## セットアップ

1. Node.js 18 以上を用意
2. `.env` を作成し、必要なAPIキーを設定（`.env.example` を参照）
3. `client/.env` を作成し、Azure AD設定を記載（`client/.env.example` を参照）
4. 依存をインストール
   ```bash
   npm install
   ```

## 起動方法

### Electronアプリとして起動（推奨）

```bash
npm run electron:dev
```

### サーバー + ブラウザで起動（開発用）

```bash
# ターミナル1: サーバー起動
npm run dev

# ターミナル2: クライアント起動
npm run client:dev
```

ブラウザで `http://localhost:37212` を開く

### exeビルド

```bash
npm run dist
```

`dist/assess-kun-portable-x.x.x.exe` が生成されます。

## 傾聴君との共存

傾聴君と同時起動可能です（ポートが異なるため）。

| アプリ | サーバーポート | 認証ポート |
|--------|---------------|-----------|
| 傾聴君 | 37211 | 43121 |
| アセス君 | 37212 | 43122 |

## 主なファイル

| ファイル | 説明 |
|---------|------|
| `server/server.js` | メインサーバー（Deepgram/Gemini/BigQuery連携） |
| `client/src/App.tsx` | メインUI |
| `electron/main.cjs` | Electronメインプロセス |
| `config/support-record.json` | 支援記録テンプレート |
| `docs/DATA_HANDLING_POLICY.md` | データ取り扱い方針 |

## 環境変数

### `.env`（サーバー用）

```env
DEEPGRAM_API_KEY=xxx
GEMINI_API_KEY=xxx
PORT=37212
BQ_PROJECT_ID=xxx
# ... その他BigQuery設定
```

### `client/.env`（クライアント用）

```env
VITE_AZURE_CLIENT_ID=15eefee7-2643-4dce-921d-1ffb52737ae7
VITE_AZURE_TENANT_ID=3d540d42-b0fd-4a55-b84f-b51a4a6da5a3
VITE_AZURE_REDIRECT_URI=http://localhost:37212
ELECTRON_AUTH_PORT=43122
```

## ライセンス

Private（社内利用を想定）
