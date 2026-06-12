# syntax=docker/dockerfile:1.7
# Multi-stage build for BigBoom. Bun runtime for both build and run.
# Image is consumed by the central ~/docker-compose.yml on noahpi.

FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/bigboom.sqlite

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/bun.lock /app/serve.ts ./
RUN bun install --frozen-lockfile --production

EXPOSE 3000
CMD ["bun", "serve.ts"]
