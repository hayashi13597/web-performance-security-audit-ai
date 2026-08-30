# syntax=docker/dockerfile:1

# ---- deps: cài dependency cho toàn workspace ----
FROM node:22-bookworm-slim AS deps
RUN npm install -g pnpm@10.18.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
COPY examples/leaky-app/package.json examples/leaky-app/
RUN pnpm install --frozen-lockfile

# ---- build: engine (tsc) trước, rồi web (next build) ----
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build

# ---- runtime: dashboard + engine + 2 Chromium (Lighthouse + Playwright) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHROME_PATH=/usr/bin/chromium \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    WPSA_CHROME_NO_SANDBOX=1 \
    WPSA_DB_PATH=/data/wpsa-jobs.db
# Lighthouse dùng Chromium của hệ thống qua CHROME_PATH; tar cần cho giải nén tarball repo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium tar ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
# Playwright tải Chromium riêng vào /ms-playwright (--with-deps cài nốt thư viện hệ điều hành).
RUN mkdir -p /data /ms-playwright \
    && cd packages/engine \
    && ./node_modules/.bin/playwright install --with-deps chromium
VOLUME /data
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
