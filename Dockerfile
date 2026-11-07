# SOLD OUT for Muse。arm64 (OCI A1) でも amd64 でも動く。依存は TypeScript だけ (実行時は Node の標準機能のみ)。
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
RUN mkdir /data && chown node /data
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY package.json ./
COPY public ./public
COPY docs ./docs
COPY LICENSE ./
# GPL のソース提供: リポジトリの中身をそのまま /source から配る (.dockerignore のものは除く)
COPY . ./source
USER node
ENV NODE_ENV=production DB_PATH=/data/soldout.sqlite PORT=8080 HOST=0.0.0.0 SOURCE_DIR=/app/source
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=256", "dist/src/main.js"]
CMD ["serve"]
