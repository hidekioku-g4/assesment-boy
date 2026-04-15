FROM node:18-slim

WORKDIR /app

# package.json と lockfile を先にコピー（キャッシュ効率）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# サーバーコード
COPY server/ server/

# フロントエンドビルド済みファイル（事前に npm run client:build で生成）
COPY public/ public/

# 設定ファイルの初期値（BQ フォールバック用）
COPY config/support-record.json config/

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["node", "server/server.js"]
