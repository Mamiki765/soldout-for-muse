// 手引き (チュートリアル) とヒントのテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { itemNoByName } from '../src/data/catalog.js';
import { seededRng } from '../src/engine/rng.js';
import { TUTORIAL_SETTING } from '../src/engine/tutorial.js';
import { sha256, Store } from '../src/store.js';

async function setup() {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  const clock = { now: 1_800_000_000 };
  const app = new App({ store, clock: () => clock.now, rng: seededRng(1) });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const open = async (name: string, shopname: string) => {
    const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name, shopname }) });
    const { token, shop_id } = (await r.json()) as { token: string; shop_id: number };
    return { auth: { authorization: 'Bearer ' + token }, id: shop_id };
  };
  const shop = (id: number) => app.world.shops.find((s) => s.id === id)!;
  const get = async (path: string, auth?: Record<string, string>) => (await fetch(base + path, { headers: auth })).text();
  const act = async (auth: Record<string, string>, body: unknown) =>
    (await (await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify(body) })).text());
  const close = async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    store.close();
  };
  return { app, store, clock, base, open, shop, get, act, close };
}

const done = (t: { shop: (id: number) => { user: Record<string, string> } }, id: number): number[] =>
  (JSON.parse(t.shop(id).user[TUTORIAL_SETTING] ?? '{"d":[]}') as { d: number[] }).d;

test('手引き: 新しい店は1段目から。棚に並べる・地図を使う・転職・me・tips で進む', async () => {
  const t = await setup();
  try {
    const a = await t.open('alice', '試験商店');
    let d = await t.get('/api/v1/digest', a.auth);
    assert.match(d, /^手引き 1\/6 棚に並べてみよう \(GET \/api\/v1\/tutorial\)$/m);

    const s = t.shop(a.id);
    s.money = 1_000_000;
    s.time = t.clock.now - 48 * 3600;
    // 市場に品を入れておく (薬草・鉱山の地図・転職のススメ)
    const herb = itemNoByName('薬草');
    const map = itemNoByName('近くの鉱山への地図');
    t.app.world.wholestore[herb - 1] = 100;
    t.app.world.wholestore[map - 1] = 5;

    let r = await t.act(a.auth, { actions: [{ type: 'buy', item: herb, count: 10 }, { type: 'shelf', slot: 1, item: herb, price: 20 }] });
    assert.match(r, /^OK shelf/m, r);
    assert.deepEqual(done(t, a.id), [1]);
    assert.match(r, /手引き 2\/6 自分で品を手に入れてみよう/);

    r = await t.act(a.auth, { actions: [{ type: 'buy', item: map, count: 1 }, { type: 'use', item: map, use: 0, count: 1 }] });
    assert.match(r, /^OK use/m, r);
    assert.deepEqual(done(t, a.id), [1, 2]);
    assert.match(r, /手引き 3\/6 売るものを決めよう/);

    // 手引きのページ: 3段目に街の様子 (誰も出していない品・混んでいる品) が出る
    const page = await t.get('/api/v1/tutorial', a.auth);
    assert.match(page, /## ✓ 1\. 棚に並べてみよう/);
    assert.match(page, /## → 3\. 売るものを決めよう/);
    assert.match(page, /いま誰も棚に出していない品 \(市場では湧かない品\): .*鉄塊/);
    assert.ok(!/いま誰も棚に出していない品[^\n]*薬草/.test(page), '市場で湧く品は並べない');
    assert.ok(!/いま誰も棚に出していない品[^\n]*七面鳥/.test(page), '店が手に入れられない品は並べない');
    assert.match(page, /飼い主さん/);

    // 市場で湧かない品 (鉄塊) を棚に並べると3段目も済む
    r = await t.act(a.auth, { type: 'shelf', slot: 1, item: '鉄塊', price: 1000 });
    assert.match(r, /^OK shelf/m, r);
    assert.deepEqual(done(t, a.id), [1, 2, 3]);

    // 売れる前に me を読んでも4段目は済まない。売れたあとなら済む
    s.saletoday = 0;
    s.itemtoday = {};
    await t.get('/api/v1/me', a.auth);
    assert.deepEqual(done(t, a.id), [1, 2, 3]);
    s.saletoday = 1000;
    await t.get('/api/v1/me', a.auth);
    assert.deepEqual(done(t, a.id), [1, 2, 3, 4]);

    // tips は匿名なら記録しない、トークン付きなら6段目
    const tips = await t.get('/api/v1/tips');
    assert.match(tips, /^はじめての人は、先に手引き GET \/api\/v1\/tutorial から/m);
    assert.deepEqual(done(t, a.id), [1, 2, 3, 4]);
    await t.get('/api/v1/tips', a.auth);
    assert.deepEqual(done(t, a.id), [1, 2, 3, 4, 6]);
    d = await t.get('/api/v1/digest', a.auth);
    assert.match(d, /手引き 5\/6 決算をまたいでみよう/);

    // 前期の売上があれば5段目も済み、手引きの行は消える
    s.saleyesterday = 500;
    d = await t.get('/api/v1/digest', a.auth);
    assert.ok(!d.includes('手引き '), d);
    assert.deepEqual(done(t, a.id), [1, 2, 3, 4, 5, 6]);
    // 一度済んだ段は、棚を空にしても戻らない
    await t.act(a.auth, { type: 'shelf', slot: 1, item: 0 });
    assert.deepEqual(done(t, a.id), [1, 2, 3, 4, 5, 6]);
  } finally {
    await t.close();
  }
});

test('手引き: 古い店は今の状態で済んでいる段を飛ばす。転職でも3段目が済む', async () => {
  const t = await setup();
  try {
    const a = await t.open('alice', '試験商店');
    const s = t.shop(a.id);
    s.job = 'material';
    s.exp[9] = 300;
    s.saleyesterday = 100;
    const d = await t.get('/api/v1/digest', a.auth);
    assert.deepEqual(done(t, a.id), [2, 3, 5]);
    assert.match(d, /手引き 1\/6 棚に並べてみよう/);
  } finally {
    await t.close();
  }
});

test('手引き・ヒントの OFF。OFF でも /tutorial は読める', async () => {
  const t = await setup();
  try {
    const a = await t.open('alice', '試験商店');
    let r = await t.act(a.auth, { type: 'tutorial' });
    assert.match(r, /^NG tutorial: on \(手引き\) か hints/m);
    r = await t.act(a.auth, { type: 'tutorial', on: false });
    assert.match(r, /^OK tutorial: 手引き: OFF \/ ヒント: ON/m);
    assert.ok(!r.includes('手引き 1/6'));
    const page = await t.get('/api/v1/tutorial', a.auth);
    assert.match(page, /手引き OFF \/ ヒント ON/);
    assert.match(page, /## → 1\. 棚に並べてみよう|## ・ 1\. 棚に並べてみよう/);
    r = await t.act(a.auth, { type: 'tutorial', on: true, hints: 'false' });
    assert.match(r, /手引き: ON \/ ヒント: OFF/);
    const j = (await (await fetch(t.base + '/api/v1/digest?format=json', { headers: a.auth })).json()) as { tutorial: { step: { no: number; total: number } | null; hint: unknown } };
    assert.deepEqual([j.tutorial.step?.no, j.tutorial.step?.total, j.tutorial.hint], [1, 6, null]);
  } finally {
    await t.close();
  }
});

test('ヒント: 混んでいる品 (ほかの店の棚5か所以上)・売れていない・止まっている', async () => {
  const t = await setup();
  try {
    const shops = [];
    for (let i = 0; i < 6; i++) shops.push(await t.open('u' + i, `試験${'一二三四五六'[i]}号店`));
    const stone = itemNoByName('魔石');
    for (const x of shops) {
      const s = t.shop(x.id);
      s.item[stone - 1] = 10;
      s.showcase[0] = stone;
      s.price[0] = 900;
      s.saletoday = 100;
    }
    const [a] = shops;
    let d = await t.get('/api/v1/digest', a.auth);
    assert.match(d, /^ヒント 魔石は今ほかの店の棚5か所でも売られていて/m);
    // ほかが減れば消える
    t.shop(shops[5].id).showcase[0] = 0;
    d = await t.get('/api/v1/digest', a.auth);
    assert.ok(!d.includes('ヒント '), d);

    // 売れていない: 開店から1期たっても今期・前期の売上が無い
    const s = t.shop(a.id);
    s.saletoday = 0;
    s.saleyesterday = 0;
    s.foundation = t.clock.now - 28 * 3600;
    d = await t.get('/api/v1/digest', a.auth);
    assert.match(d, /^ヒント 前の決算から売上がありません/m);

    // 止まっている: 手引きを OFF にしていて、2期たっても職業も自分で得た品も無い
    s.showcase[0] = 0;
    s.foundation = t.clock.now - 60 * 3600;
    d = await t.get('/api/v1/digest', a.auth);
    assert.ok(!d.includes('ヒント '), '手引きを出している店には出さない');
    await t.act(a.auth, { type: 'tutorial', on: false });
    d = await t.get('/api/v1/digest', a.auth);
    assert.match(d, /^ヒント 開店からしばらくたちましたが/m);
    await t.act(a.auth, { type: 'tutorial', hints: false });
    d = await t.get('/api/v1/digest', a.auth);
    assert.ok(!d.includes('ヒント '), d);
  } finally {
    await t.close();
  }
});
