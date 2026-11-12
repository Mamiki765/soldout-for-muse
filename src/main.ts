// SOLD OUT for Muse — 起動と管理コマンド。
//   node dist/src/main.js serve                 サーバーを起動する
//   node dist/src/main.js set-invite <code>      招待コードを設定する (空なら登録を止める)
//   node dist/src/main.js set-viewer-key <key>   観戦用の合言葉を設定する (空なら合言葉なし)
//   node dist/src/main.js new-admin-token        管理用トークン (sa_...) を作り直す
//   node dist/src/main.js admin-grant <店名|店id>  その店のトークン (Party のトークンも) で管理 API を使えるようにする
//   node dist/src/main.js admin-revoke <店名|店id> やめる
//   node dist/src/main.js seed-market [時間=12]    新素材 (plus のある追加品) の市場在庫を一度だけ初期投入する。サーバーを止めて実行
// 環境変数: DB_PATH (data/soldout.sqlite), PORT (8080), HOST (0.0.0.0), PUBLIC_URL,
//           IMAGES_DIR (public/images), HELP_PATH (docs/API.md), SOURCE_DIR (. / 空なら配布しない),
//           PARTY_URL (Muse Party の URL。あれば Party のトークンで遊べる), PARTY_PUBLIC_URL (観戦画面のリンク先),
//           BASE_PATH (別サイトの下に置くときの頭。例 /soldout)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { App } from './api/app.js';
import { setViewerKey } from './api/viewer.js';
import { httpPartyVerifier } from './api/party.js';
import { newToken, sha256, Store } from './store.js';
import { BASE_ITEMS } from './data/catalog.js';
import { DEFAULT_CONFIG } from './config.js';
import { Game } from './engine/game.js';
import { seedWholeStore } from './engine/market.js';
import { APP_VERSION, UPDATES } from './updates.js';

const env = process.env;
const dbPath = resolve(env.DB_PATH ?? 'data/soldout.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const [cmd = 'serve', arg] = process.argv.slice(2);

if (cmd === 'set-invite') {
  const store = new Store(dbPath);
  store.setSetting('invite_hash', arg ? sha256(arg) : undefined);
  store.close();
  console.log(arg ? '招待コードを設定しました' : '招待コードを消しました (新しい登録はできません)');
} else if (cmd === 'set-viewer-key') {
  const store = new Store(dbPath);
  setViewerKey({ store }, arg);
  store.close();
  console.log(arg ? '観戦用の合言葉を設定しました' : '観戦用の合言葉を消しました (誰でも観戦できます)');
} else if (cmd === 'new-admin-token') {
  const store = new Store(dbPath);
  const token = newToken('sa_');
  store.setSetting('admin_token_hash', sha256(token));
  store.close();
  console.log('管理用トークンを作りました (前のものは使えなくなります。二度と表示されません)');
  console.log(token);
} else if (cmd === 'admin-grant' || cmd === 'admin-revoke') {
  // 店名か店id を指定。その店のトークン (Party のトークンも) で管理 API が使えるようになる / やめる
  const store = new Store(dbPath);
  const world = store.loadWorld(Math.floor(Date.now() / 1000));
  const shop = world.shops.find((s) => String(s.id) === arg || s.shopname === arg || s.name === arg);
  const cur = (store.getSetting('admin_shops') ?? '').split(',').filter(Boolean).map(Number);
  if (cmd === 'admin-grant') {
    if (!shop) {
      console.error('その店が見つかりません: ' + (arg ?? '') + '\n店: ' + world.shops.map((s) => `${s.id} ${s.shopname}`).join(' / '));
      process.exit(1);
    }
    store.setSetting('admin_shops', [...new Set([...cur, shop.id])].join(','));
    console.log(`${shop.shopname} (店id ${shop.id}) を管理者にしました`);
  } else {
    const id = shop?.id ?? Number(arg);
    store.setSetting('admin_shops', cur.filter((x) => x !== id).join(',') || undefined);
    console.log(`店id ${id} の管理者をやめました`);
  }
  store.close();
} else if (cmd === 'seed-market') {
  // 今回の版で追加した品のうち plus のあるもの (市場在庫が時間で増減する素材) が対象。
  // 動いているサーバーは街の状態をメモリに持っていて後で上書きするので、必ず止めてから実行する。
  const hours = Number(arg ?? 12);
  if (!(hours > 0 && hours <= 72)) {
    console.error('時間は 1〜72 で指定してください');
    process.exit(2);
  }
  const store = new Store(dbPath);
  const key = 'market_seeded:' + APP_VERSION;
  if (store.getSetting(key)) {
    console.error(`v${APP_VERSION} の初期投入は済んでいます (${store.getSetting(key)})。二重には入れません`);
    store.close();
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const world = store.loadWorld(now);
  const g = new Game(world, DEFAULT_CONFIG, { next: Math.random }, now);
  const targets = UPDATES[0].new_items.map((it) => it.item).filter((no) => BASE_ITEMS[no].plus !== 0);
  const rows = seedWholeStore(g, targets, hours);
  store.saveWorld(world, [], now, DEFAULT_CONFIG.logExpireTime * 2);
  store.setSetting(key, `${new Date(now * 1000).toISOString()} ${hours}時間ぶん`);
  store.close();
  console.log(`市場に新素材を ${hours} 時間ぶん入れました (人口 ${world.people}、店 ${world.shops.length})`);
  for (const r of rows) console.log(`${r.no} ${r.name}: ${r.before} → ${r.after} (+${r.add})`);
} else if (cmd === 'serve') {
  const store = new Store(dbPath);
  const app = new App({
    store,
    publicUrl: env.PUBLIC_URL ?? '',
    imagesDir: resolve(env.IMAGES_DIR ?? 'public/images'),
    sourceDir: env.SOURCE_DIR === '' ? undefined : resolve(env.SOURCE_DIR ?? '.'),
    partyVerifier: env.PARTY_URL ? httpPartyVerifier(env.PARTY_URL) : undefined,
    partyPublicUrl: env.PARTY_PUBLIC_URL ?? env.PARTY_URL ?? '',
    basePath: env.BASE_PATH ?? '',
  });
  await app.loadHelp(resolve(env.HELP_PATH ?? 'docs/API.md')).catch(() => console.warn('API.md が読めませんでした'));
  const server = createServer((req, res) => {
    app.handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const port = Number(env.PORT ?? 8080);
  server.listen(port, env.HOST ?? '0.0.0.0', () => console.log(`SOLD OUT for Muse: http://${env.HOST ?? '0.0.0.0'}:${port}/ (db ${dbPath})`));
  const stop = (): void => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  console.error('使い方: main.js [serve | set-invite <code> | set-viewer-key <key> | new-admin-token | admin-grant <店> | admin-revoke <店> | seed-market [時間]]');
  process.exit(2);
}
