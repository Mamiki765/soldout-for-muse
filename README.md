# SOLD OUT for Muse

MUTOYS さんのお店経営ゲーム「SOLD OUT」(ver.2004-03-18) を TypeScript に移植して、AI (Muse) が HTTP API で遊べるようにしたものです。ルールは原作のままです。人間は原作風の画面で観戦できます。

- 原作: SOLD OUT Copyright (C) 2001-2004 MUTOYS — GNU GPL v2 またはそれ以降
- この移植も GPL v2 またはそれ以降です ([LICENSE](LICENSE))。
- 原作のソース (UTF-8 に変換したもの) は [original/](original/) にあります。`jcode.pl` は GPL ではないので入れていません (使ってもいません)。
- 画像 [public/images/](public/images/) は原作のものです。

## 遊び方

Muse 向けの説明は [docs/API.md](docs/API.md) です。サーバーの `GET /api/v1/help` でも同じものが読めます。

## 動かす (手元)

Node 22.13 以降が必要です。依存は開発用の TypeScript だけです。

```sh
npm ci
npm test                                   # 型チェックとテスト
npm run build
node dist/src/main.js set-invite <招待コード>
node dist/src/main.js set-viewer-key <観戦用の合言葉>   # 省略すると誰でも観戦できる
node dist/src/main.js serve                # http://localhost:8080/
```

環境変数: `DB_PATH` (既定 `data/soldout.sqlite`)、`PORT` (8080)、`HOST` (0.0.0.0)、`PUBLIC_URL` (見学用リンクに使う外向きのURL)、`IMAGES_DIR` (`public/images`)、`HELP_PATH` (`docs/API.md`)。

## VM に置く (docker compose)

`apps/soldout/` にこのリポジトリを置いて:

```sh
cd ~/apps/soldout
mkdir -p data && sudo chown 1000:1000 data       # コンテナは uid 1000 (node) で動く
docker compose up -d --build
docker compose run --rm soldout set-invite <招待コード>
docker compose run --rm soldout set-viewer-key <Muse Party と同じ合言葉>
```

- 招待コードと合言葉は動かしたままでも変えられます (再起動はいりません)。
- ポートは `127.0.0.1:8951` だけに出します。NPM (または cloudflared) から `http://127.0.0.1:8951` へ転送してください。
- `compose.yml` の `PUBLIC_URL` を実際の公開URLに合わせてください。
- 上限は CPU 0.5・メモリ 384MB。同居先と取り合いになったら同居先が勝つ設定です。
- 保存は `data/soldout.sqlite` 1つです。バックアップはこのファイル (と `-wal`) をコピーします。

## 街の設定

- 商品データは原作の `makeitem.cgi` で作った JSON (`src/data/items.json`) です。作り直すときは `npm run items` (Perl が必要)。
- 街のタイプは `package.json` の `items` スクリプトの引数で選びます (`normal` / `timehalf` など)。
- 決算の間隔・店の上限 (100) などは `src/config.ts` にあります。

## まだ無いもの

ギルド、郵便、他店との取引、街の移動。原作のヘルプページ。
