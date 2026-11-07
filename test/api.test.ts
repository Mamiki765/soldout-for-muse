// API の通し確認: 登録 → digest (304) → 行動のまとめ送り → 出来事 → 井戸端 → 見学用リンク
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { setViewerKey } from '../src/api/viewer.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';

async function start(clock: () => number): Promise<{ base: string; server: Server; app: App; store: Store }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, app, store };
}

test('API の通し確認', async () => {
  let now = 1_800_000_000;
  const { base, server, store } = await start(() => now);
  try {
    // 招待コード違い
    let r = await fetch(base + '/api/v1/register', { method: 'POST', body: JSON.stringify({ invite: 'x', name: 'mute', shopname: 'ミュート商店' }) });
    assert.equal(r.status, 403);

    r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) });
    assert.equal(r.status, 201, await r.clone().text());
    const reg = (await r.json()) as { token: string; shop_id: number };
    assert.match(reg.token, /^so_/);
    const auth = { authorization: 'Bearer ' + reg.token };

    // digest は短く、同じなら 304
    r = await fetch(base + '/api/v1/digest', { headers: auth });
    assert.equal(r.status, 200);
    const etag = r.headers.get('etag')!;
    const digest = await r.text();
    assert.ok(digest.split('\n').length <= 4, digest);
    r = await fetch(base + '/api/v1/digest', { headers: { ...auth, 'if-none-match': etag } });
    assert.equal(r.status, 304);

    // 開店直後の市場は空なので、少し時間を進めて入荷させる
    now += 2 * 3600;
    // 市場の品を 1 つ選んで、仕入れて棚に並べる
    r = await fetch(base + '/api/v1/market?format=json', { headers: auth });
    const market = (await r.json()) as { items: { item: number; price: number; stock: number }[] };
    const pick = market.items.find((x) => x.stock >= 5)!;
    assert.ok(pick, '市場に在庫がある');
    r = await fetch(base + '/api/v1/actions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        actions: [
          { type: 'buy', item: pick.item, count: 5 },
          { type: 'shelf', slot: 1, item: pick.item, percent: 120 },
          { type: 'buy', item: 9999, count: 1 },
        ],
      }),
    });
    assert.equal(r.status, 200);
    const out = await r.text();
    const lines = out.split('\n');
    assert.match(lines[0], /^OK buy/);
    assert.match(lines[1], /^OK shelf/);
    assert.match(lines[2], /^NG buy/);

    // 時間を進めると売れて出来事が増える
    now += 3 * 3600;
    r = await fetch(base + '/api/v1/digest', { headers: auth });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/v1/log', { headers: auth });
    const log1 = await r.text();
    assert.ok(log1.length > 0);
    // 2 回目は既読なので空に近い
    r = await fetch(base + '/api/v1/log?format=json', { headers: auth });
    assert.deepEqual(await r.json(), []);

    // 井戸端
    r = await fetch(base + '/api/v1/chat', { method: 'POST', headers: auth, body: JSON.stringify({ text: 'こんにちは' }) });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/v1/chat', { method: 'POST', headers: auth, body: JSON.stringify({ text: 'こんにちは' }) });
    assert.equal(r.status, 409, '重複投稿は断る');

    // 見学用リンクは 1 回だけ使える
    r = await fetch(base + '/api/v1/view-link?format=json', { method: 'POST', headers: auth });
    const link = (await r.json()) as { url: string };
    const local = link.url.replace('https://so.example', base);
    r = await fetch(local, { redirect: 'manual' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /ミュート商店/);
    assert.match(r.headers.get('set-cookie') ?? '', /so_shop=/);
    r = await fetch(local);
    assert.equal(r.status, 403);

    // 画像
    r = await fetch(base + '/images/item-no-1.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    r = await fetch(base + '/images/../package.json');
    assert.notEqual(r.status, 200);

    // 観戦用の合言葉
    setViewerKey({ store }, 'party');
    r = await fetch(base + '/view/ranking');
    assert.equal(r.status, 401);
    r = await fetch(base + '/view/ranking?k=party');
    assert.equal(r.status, 200);
    const ck = (r.headers.get('set-cookie') ?? '').split(';')[0];
    r = await fetch(base + '/view/market', { headers: { cookie: ck } });
    assert.equal(r.status, 200);

    // トークンなし
    r = await fetch(base + '/api/v1/digest');
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});
