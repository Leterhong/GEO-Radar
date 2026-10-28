# GEO Radar 生产镜像（Next.js standalone）
FROM node:22-alpine AS base
WORKDIR /app

# 安装依赖
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# 构建
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 构建期占位值；运行时由 docker-compose 注入真实值
ENV DATABASE_URL="postgresql://georadar:build_placeholder@127.0.0.1:5432/georadar"
ENV AUTH_SECRET="build-only-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
ENV CREDENTIAL_ENCRYPTION_KEY="build-only-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
ENV YUANBAO_SEARCH_ENABLED=false
ENV APP_URL=http://127.0.0.1:3000
RUN npx prisma generate && npm run build

# 运行镜像
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
