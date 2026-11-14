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
  const app = new App({ store, rng: seededRng(7), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
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
    assert.ok(digest.split('\n').length <= 5, digest); // 従来の要約＋更新案内1行
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
          { type: 'sell', item: pick.item },
        ],
      }),
    });
    assert.equal(r.status, 200);
    const out = await r.text();
    const lines = out.split('\n');
    assert.match(lines[0], /^OK buy/);
    assert.match(lines[1], /^OK shelf/);
    assert.match(lines[2], /^NG buy/);
    // 知らない行動には、使える行動と引き出しの名前を案内する
    assert.match(lines[3], /^NG sell: 知らない行動です: sell \(売るには shelf/);

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

    // 見学用リンク
    r = await fetch(base + '/api/v1/view-link?format=json', { method: 'POST', headers: auth });
    const link = (await r.json()) as { url: string };
    const local = link.url.replace('https://so.example', base);
    r = await fetch(local, { redirect: 'manual' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /ミュート商店/);
    assert.match(r.headers.get('set-cookie') ?? '', /so_shop=/);
    // 期限内なら何度でも開ける (リンクプレビューが先に開いても大丈夫)
    r = await fetch(local);
    assert.equal(r.status, 200);
    now += 31 * 60;
    r = await fetch(local);
    assert.equal(r.status, 403, '30分たったら開けない');
    now -= 31 * 60;

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

    // ソースの配布 (Muse は API、人は観戦合言葉で)
    r = await fetch(base + '/api/v1/source', { headers: auth });
    assert.match(await r.text(), /^original\//m);
    r = await fetch(base + '/api/v1/source/LICENSE', { headers: auth });
    assert.match(await r.text(), /GNU GENERAL PUBLIC LICENSE/);
    r = await fetch(base + '/api/v1/source/..%2F..%2Fetc%2Fpasswd', { headers: auth });
    assert.equal(r.status, 404);
    r = await fetch(base + '/source/src');
    assert.equal(r.status, 401, '合言葉なしでは見られない');
    r = await fetch(base + '/source/src', { headers: { cookie: ck } });
    assert.match(await r.text(), /engine\//);
    r = await fetch(base + '/source.tar.gz', { headers: { cookie: ck } });
    const tgz = Buffer.from(await r.arrayBuffer());
    assert.equal(tgz[0], 0x1f);
    assert.equal(tgz[1], 0x8b);
    const rankHtml = await (await fetch(base + "/view/ranking", { headers: { cookie: ck } })).text();
    assert.doesNotMatch(rankHtml, /github\.com/i, 'リポジトリの持ち主は出さない');

    // トークンなし
    r = await fetch(base + '/api/v1/digest');
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('0.3.0 の別名と新しい書き方 (旧い書き方もそのまま)', async () => {
  let now = 1_800_000_000;
  const { base, server, app, store } = await start(() => now);
  try {
    let r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'alias', shopname: '別名商店' }) });
    const reg = (await r.json()) as { token: string; shop_id: number };
    const auth = { authorization: 'Bearer ' + reg.token };
    now += 30 * 3600; // 持ち時間をためる
    const shop = () => app.world.shops.find((s) => s.id === reg.shop_id)!;
    const dt = shop();
    dt.moneystock = 5000;
    dt.money = 1_000_000;
    const send = async (actions: unknown[]): Promise<string[]> => {
      const res = await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify({ actions }) });
      return (await res.text()).split('\n');
    };
    let lines = await send([
      { type: 'withdraw', amount: 'all' },
      { type: 'shelves', count: 1 },
      { type: 'shelves', count: 3 },
      { type: 'shelves', count: 3, confirm: true },
      { type: 'shelves', count: 2 },
      { type: 'shelves', count: 0 },
    ]);
    assert.match(lines[0], /^OK withdraw: ￥5000入金しました/);
    assert.match(lines[1], /^NG shelves: 棚は今も1個です。変更なし/);
    assert.match(lines[2], /^NG shelves: 確認: 棚 1→3: 陳列枠\+2.*増築費用/, '増やすときも確認だけ');
    assert.match(lines[3], /^OK shelves: 棚 1→3: 陳列枠\+2/);
    assert.match(lines[4], /^NG shelves: 陳列棚増築取壊キットを持っていません/);
    assert.match(lines[5], /^NG shelves: 棚は1〜8個/);
    assert.equal(shop().showcasecount, 3);

    // 品名と使い方の名前で書ける
    shop().item[63 - 1] = 1;
    lines = await send([
      { type: 'use', item: '陳列棚増築取壊キット', use: '陳列棚を2つにする' },
      { type: 'use', item: '陳列棚増築取壊キット', use: '陳列棚を2つにする', confirm: true },
      { type: 'use', item: '陳列棚増築取壊キット', use: 'ない使い方' },
      { type: 'buy', item: 'ないもの', count: 1 },
    ]);
    assert.match(lines[0], /^NG use: 確認: 棚 3→2: 陳列枠-1.*confirm/, '減らすときは確認だけ');
    assert.match(lines[1], /^OK use: 棚 3→2: 陳列枠-1/);
    assert.match(lines[2], /^NG use: 使い方「ない使い方」はありません/);
    assert.match(lines[3], /^NG buy: 「ないもの」という商品はありません/);
    assert.equal(shop().showcasecount, 2);

    // shelves でも減らすときは確認が要る
    shop().item[63 - 1] = 1;
    lines = await send([{ type: 'shelves', count: 1 }, { type: 'shelves', count: 1, confirm: true }]);
    assert.match(lines[0], /^NG shelves: 確認: 棚 2→1/);
    assert.match(lines[1], /^OK shelves: 棚 2→1: 陳列枠-1/);
    assert.equal(shop().showcasecount, 1);
    void store;
  } finally {
    server.close();
  }
});

test('tips は認証なしで読める', async () => {
  const { base, server } = await start(() => 1_800_000_000);
  try {
    const r = await fetch(base + '/api/v1/tips');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /^# SOLD OUT のコツ/);
  } finally {
    server.close();
  }
});
