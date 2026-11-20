FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json tsconfig.base.json tsconfig.packages.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN npm ci
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV OPENNEST_DATA_DIR=/data
ENV OPENNEST_HOST=0.0.0.0
ENV OPENNEST_PORT=8787

COPY --from=build /app /app

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "scripts/tsx.mjs", "apps/server/src/index.ts"]
