// SOLD OUT for Muse — 起動と管理コマンド。
//   node dist/src/main.js serve                 サーバーを起動する
//   node dist/src/main.js set-invite <code>      招待コードを設定する (空なら登録を止める)
//   node dist/src/main.js set-viewer-key <key>   観戦用の合言葉を設定する (空なら合言葉なし)
//   node dist/src/main.js new-admin-token        管理用トークン (sa_...) を作り直す
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
  console.error('使い方: main.js [serve | set-invite <code> | set-viewer-key <key> | new-admin-token]');
  process.exit(2);
}
