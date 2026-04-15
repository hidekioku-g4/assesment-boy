#!/bin/bash
# おはようアセス君 Cloud Run デプロイスクリプト
# 使い方:
#   bash scripts/deploy-cloud-run.sh deploy          → ステージングへデプロイ（デフォルト）
#   bash scripts/deploy-cloud-run.sh deploy-prod     → 本番へデプロイ（確認プロンプトあり）
#   bash scripts/deploy-cloud-run.sh [setup|all]     → 初回セットアップ
#
# 前提条件:
#   - gcloud CLI インストール済み & ログイン済み
#   - GCP プロジェクトが設定済み (gcloud config set project PROJECT_ID)
#   - Node.js 18+ インストール済み

set -euo pipefail

# === 設定 ===
PROJECT_ID="${GCP_PROJECT_ID:-tl-datamanagement-prod}"
REGION="asia-northeast1"
SERVICE_NAME_PROD="assess-kun"
SERVICE_NAME_STAGING="assess-kun-staging"
SA_NAME="assess-kun-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# === 色付き出力 ===
info()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m $*"; }

# === Step 1: Service Account 作成 + IAM 権限 ===
setup_sa() {
  info "Service Account を作成中..."
  gcloud iam service-accounts describe "$SA_EMAIL" 2>/dev/null || \
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="おはようアセス君 Web版" \
      --project="$PROJECT_ID"

  info "IAM 権限を付与中..."
  # BigQuery
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/bigquery.dataEditor" --quiet
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/bigquery.jobUser" --quiet

  ok "Service Account 設定完了: $SA_EMAIL"
}

# === Step 2: Secret Manager ===
setup_secrets() {
  info "Secret Manager にシークレットを登録..."

  for secret_name in DEEPGRAM_API_KEY GEMINI_API_KEY CARTESIA_API_KEY; do
    if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" 2>/dev/null; then
      warn "$secret_name は既に存在"
    else
      echo -n "Enter $secret_name: "
      read -rs value
      echo
      if [ -n "$value" ]; then
        echo -n "$value" | gcloud secrets create "$secret_name" \
          --data-file=- --project="$PROJECT_ID"
        # SA にアクセス権を付与
        gcloud secrets add-iam-policy-binding "$secret_name" \
          --member="serviceAccount:$SA_EMAIL" \
          --role="roles/secretmanager.secretAccessor" \
          --project="$PROJECT_ID" --quiet
        ok "$secret_name 登録完了"
      else
        warn "$secret_name スキップ（空入力）"
      fi
    fi
  done
}

# === Step 3: クライアントビルド + Cloud Run デプロイ ===
deploy() {
  local target="${1:-staging}"
  local service_name

  if [ "$target" = "prod" ]; then
    service_name="$SERVICE_NAME_PROD"
    warn "=== 本番環境へデプロイします ==="
    echo -n "本当に本番 ($service_name) にデプロイしますか？ (yes/N): "
    read -r confirm
    if [ "$confirm" != "yes" ]; then
      error "中断しました"
      exit 1
    fi
  else
    service_name="$SERVICE_NAME_STAGING"
    info "ステージング ($service_name) にデプロイします"
  fi

  info "クライアントをビルド中..."
  npm run client:build

  local min_instances=0
  if [ "$target" = "prod" ]; then
    min_instances=1
  fi

  info "Cloud Run にデプロイ中... ($service_name)"
  gcloud run deploy "$service_name" \
    --source . \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --allow-unauthenticated \
    --service-account "$SA_EMAIL" \
    --memory 512Mi \
    --cpu 1 \
    --timeout 3600 \
    --session-affinity \
    --no-cpu-throttling \
    --min-instances "$min_instances" \
    --max-instances 5 \
    --concurrency 10 \
    --set-secrets "DEEPGRAM_API_KEY=DEEPGRAM_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,CARTESIA_API_KEY=CARTESIA_API_KEY:latest" \
    --env-vars-file cloud-run-env.yaml

  # デプロイ後の URL 表示
  SERVICE_URL=$(gcloud run services describe "$service_name" \
    --region "$REGION" --project "$PROJECT_ID" \
    --format="value(status.url)" 2>/dev/null)
  ok "デプロイ完了! ($target)"
  echo ""
  info "URL: $SERVICE_URL"
  if [ "$target" = "staging" ]; then
    echo ""
    info "本番へデプロイするには: bash scripts/deploy-cloud-run.sh deploy-prod"
  fi
}

# === メイン ===
case "${1:-}" in
  setup)
    setup_sa
    setup_secrets
    ;;
  deploy)
    deploy staging
    ;;
  deploy-prod)
    deploy prod
    ;;
  all)
    setup_sa
    setup_secrets
    deploy staging
    ;;
  *)
    echo "Usage: $0 [setup|deploy|deploy-prod|all]"
    echo ""
    echo "  deploy       ステージングへデプロイ（デフォルト）"
    echo "  deploy-prod  本番へデプロイ（確認あり）"
    echo "  setup        初回セットアップ（SA・Secrets）"
    echo "  all          セットアップ + ステージングデプロイ"
    exit 1
    ;;
esac
