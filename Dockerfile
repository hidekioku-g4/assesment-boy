FROM node:18-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client/ client/
COPY postcss.config.cjs tailwind.config.cjs ./
RUN npm run client:build

FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ server/

# Static public files (live2d, aizuchi, voice-processor.js)
COPY public/ public/

# Overlay vite build output (index.html + hashed JS/CSS)
COPY --from=builder /app/public/ public/

COPY config/support-record.json config/

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["node", "server/server.js"]
