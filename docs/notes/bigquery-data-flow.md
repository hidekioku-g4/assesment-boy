# BigQuery データ送信の仕組みと注意点

## 認証フロー

BigQueryへのアクセスには **Workload Identity Federation (WIF)** を使用しています。

```
[ユーザー] → [Azure AD ログイン] → [IDトークン取得]
                                         ↓
[クライアント] → [サーバーにトークン送信] → [ms-id-token.txt に保存]
                                                    ↓
[BigQuery操作時] ← [GCPがトークンを検証] ← [WIF経由で認証]
```

### 重要な注意点

1. **トークンの有効期限**
   - Azure ADのIDトークンは約1時間で期限切れになる
   - 期限切れのトークンでBigQueryを呼び出すと `invalid_grant` エラーになる
   - **対策**: BigQuery操作の前に `refreshSubjectToken()` を呼び出してトークンをリフレッシュ

2. **トークンの保存場所**
   - 開発時: `config/ms-id-token.txt`
   - 本番時: `%APPDATA%/おはようアセス君/config/ms-id-token.txt`

## データ送信方式（ストリーミングINSERT）

**800人同時利用を想定した高速方式を採用しています。**

### なぜストリーミングINSERTか？

| 方式 | 800人同時 | 履歴保持 | 速度 |
|------|----------|---------|------|
| MERGE (UPSERT) | NG（テーブルロック） | 最新のみ | 遅い |
| ストリーミングINSERT | OK | 全履歴 | 高速 |

- MERGEは内部的にテーブルスキャン+ロックが発生し、同時実行に弱い
- ストリーミングINSERTは並列処理に最適化されている

### データ構造

```
同じrecord_idで複数回送信された場合:

record_id | sent_at              | データ
----------|----------------------|--------
rec_001   | 2026-01-30 09:00:00  | v1
rec_001   | 2026-01-30 09:15:00  | v2 (修正版)
rec_001   | 2026-01-30 09:30:00  | v3 (最終版)
```

### 最新データの取得方法

BigQueryで最新のレコードのみ取得するSQL:

```sql
-- support_records の最新データを取得
SELECT * EXCEPT(rn)
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY record_id ORDER BY sent_at DESC) AS rn
  FROM `project.dataset.support_records`
)
WHERE rn = 1

-- session_summaries の最新データを取得
SELECT * EXCEPT(rn)
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY summary_id ORDER BY created_at DESC) AS rn
  FROM `project.dataset.session_summaries`
)
WHERE rn = 1
```

### ビューの作成（推奨）

最新データ取得用のビューを作成しておくと便利:

```sql
CREATE OR REPLACE VIEW `project.dataset.support_records_latest` AS
SELECT * EXCEPT(rn)
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY record_id ORDER BY sent_at DESC) AS rn
  FROM `project.dataset.support_records`
)
WHERE rn = 1
```

## テーブル設計の推奨事項

### パーティション化（オプション）

大量データの場合、日付でパーティションを切ると検索が高速化:

```sql
CREATE TABLE `project.dataset.support_records` (
  record_id STRING,
  session_date DATE,
  -- その他のカラム
  sent_at TIMESTAMP
)
PARTITION BY DATE(sent_at)
```

### クラスタリング（オプション）

record_idでの検索を高速化:

```sql
CREATE TABLE `project.dataset.support_records` (
  -- カラム定義
)
PARTITION BY DATE(sent_at)
CLUSTER BY record_id
```

## トラブルシューティング

### `invalid_grant` エラー

原因: IDトークンが期限切れ

対処:
1. アプリを再起動してログインし直す
2. または、クライアント側で `refreshSubjectToken()` が正しく呼ばれているか確認

### `missing_subject_token` エラー

原因: トークンファイルが存在しないか空

対処:
1. Microsoftアカウントでログインし直す
2. `config/ms-id-token.txt` が存在するか確認

### 重複データの扱い

- 重複は仕様（全履歴を保持）
- 最新データのみ必要な場合はROW_NUMBER()を使ったクエリまたはビューを使用
- 定期的な重複排除は不要（クエリ時に対応）
