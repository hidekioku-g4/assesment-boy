FROM node:18-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client/ client/
COPY public/ public/
COPY postcss.config.cjs tailwind.config.cjs ./
RUN npm run client:build

FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# サーバーコード
COPY server/ server/

# フロントエンドビルド済みファイル（Dockerビルド内で生成）
COPY --from=builder /app/public/ public/

# 設定ファイルの初期値（BQ フォールバック用）
COPY config/support-record.json config/

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["node", "server/server.js"]
