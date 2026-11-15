// SOLD OUT for Muse — アイテム一覧・作り方の逆引き・隠し指定のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, overrideItemVisibility } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { getWholeStore } from '../src/engine/market.js';
import { itemDetailData, itemDetailText } from '../src/api/views.js';
import { checkUses, loadUses } from '../src/engine/use.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { sha256, Store } from '../src/store.js';

const PUDDING = 114;
const MILK = 26;

async function start() {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(3), clock: () => 1_800_000_000 });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const reg = (await (await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) })).json()) as { token: string };
  return { base, server, auth: { authorization: 'Bearer ' + reg.token } };
}

const getText = async (url: string, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { headers });
  return { status: r.status, text: await r.text() };
};

test('一覧: 入手の列・定義の価格・絞り込み。認証なしで読める', async () => {
  const { base, server } = await start();
  try {
    const { status, text } = await getText(base + '/api/v1/items');
    assert.equal(status, 200);
    assert.match(text, /^114 固めプリン 薬 2200 70 100 ←26$/m);
    assert.match(text, /^26 ミノ牛乳 薬 200 50 500 ←25$/m, '手書きの補足 (ミノタウロス♀の乳搾り) も入手に出る');
    assert.match(text, /^22 鎧の作り方 本 50000 800 5 ←10,79 市場/m);
    assert.match(text, /^27 七面鳥の丸焼き .* 他/m);
    const json = (await (await fetch(base + '/api/v1/items?format=json')).json()) as { item: number; price: number }[];
    assert.equal(json.length, MAX_ITEM);
    for (const i of json) assert.equal(i.price, BASE_ITEMS[i.item].price);
    const pudding = await getText(base + '/api/v1/items?q=' + encodeURIComponent('プリン'));
    assert.equal(pudding.text.trim().split('\n').length, 2);
    const books = (await (await fetch(base + '/api/v1/items?format=json&type=' + encodeURIComponent('本'))).json()) as { type: string }[];
    assert.ok(books.length > 0 && books.every((b) => b.type === '本'));
  } finally {
    server.close();
  }
});

test('詳細: 作り方の逆引き・材料になる先・名前で開く。トークンがあれば店ごとの欄', async () => {
  const { base, server, auth } = await start();
  try {
    let r = await getText(base + '/api/v1/items/' + encodeURIComponent('固めプリン'));
    assert.equal(r.status, 200, '名前・認証なしで開ける');
    assert.match(r.text, /^26ミノ牛乳\/6 固めプリンを作成する 1h00m→45m 0 \| ミノタウロス♀x5\(消費しない\),ミノ牛乳x10,砂糖x3 → 固めプリンx2 \| ミノタウロス♀ 酪農家 時間1\/2$/m);
    assert.doesNotMatch(r.text, /あなた|今は使えない/);

    const d = (await (await fetch(base + `/api/v1/items/${PUDDING}?format=json`, { headers: auth })).json()) as {
      made_by: { item: number; use: number; time: number; time_skilled: number; skill_item: { item: number }; usable: boolean; why?: string }[];
    };
    assert.equal(d.made_by.length, 1);
    assert.deepEqual([d.made_by[0].item, d.made_by[0].use, d.made_by[0].time, d.made_by[0].time_skilled, d.made_by[0].skill_item.item], [26, 6, 3600, 2700, 25]);
    assert.equal(d.made_by[0].usable, false);
    assert.match(d.made_by[0].why!, /ミノ牛乳を持っていません/);

    // 副産物 (解体) も作り方に並ぶ
    const iron = (await (await fetch(base + '/api/v1/items/5?format=json')).json()) as { made_by: { item: number }[] };
    assert.equal(iron.made_by.length, 8);
    assert.ok(iron.made_by.some((m) => m.item === 39), '解体キット');

    // 材料になる先 (砂糖 → 固めプリン)
    const sugar = BASE_ITEMS.find((i) => i?.name === '砂糖')!.no;
    r = await getText(base + `/api/v1/items/${sugar}`);
    assert.match(r.text, /# 材料になる先 .*26ミノ牛乳\/6固めプリンを作成する/);

    r = await getText(base + '/api/v1/items/9999');
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});

test('隠した品は一覧で「品番 ？？？」、詳細・名前・行動・他の品の行・市場では無い品と同じ', async () => {
  overrideItemVisibility(PUDDING, 'hidden');
  const { base, server, auth } = await start();
  try {
    let r = await getText(base + '/api/v1/items');
    assert.match(r.text, /^114 ？？？$/m);
    assert.doesNotMatch(r.text, /固めプリン/);
    r = await getText(base + '/api/v1/items?q=' + encodeURIComponent('？'));
    assert.doesNotMatch(r.text, /^114/m, '絞り込みには出ない');
    for (const key of ['114', encodeURIComponent('固めプリン')]) {
      r = await getText(base + '/api/v1/items/' + key, auth);
      assert.equal(r.status, 404);
      assert.match(r.text, /そんなアイテムはないです/);
    }
    // 隠した品が出る使い方 (使い方の名前にも品の名前が入る) は、道具の詳細・材料になる先から消える
    r = await getText(base + `/api/v1/items/${MILK}`);
    assert.match(r.text, /ロイヤルチーズケーキを作成する/);
    assert.doesNotMatch(r.text, /固めプリン/);
    r = await getText(base + '/api/v1/items/' + encodeURIComponent('砂糖'));
    assert.doesNotMatch(r.text, /固めプリン/);
    // 行動で名前・品番を書いても無い品。使い方の番号で作ろうとしても無い
    const act = await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify({ actions: [{ type: 'shelf', slot: 1, item: PUDDING, price: 2000 }] }) });
    assert.match(await act.text(), /そんなアイテムはないです/);
    const act2 = await fetch(base + '/api/v1/actions', { method: 'POST', headers: auth, body: JSON.stringify({ actions: [{ type: 'shelf', slot: 1, item: '固めプリン', price: 2000 }] }) });
    assert.match(await act2.text(), /「固めプリン」という商品はありません/);
    // 観戦画面も同じ
    const html = await getText(base + '/view/items');
    assert.match(html.text, /<td>114<\/td><td>？？？<\/td>/);
    assert.doesNotMatch(html.text, /固めプリン<\/td>|固めプリン×|固めプリンを作成する/, '表の中には出ない (更新のお知らせは別)');

    // 市場に在庫があっても並ばない
    const world = newWorld(1_800_000_000, MAX_ITEM);
    const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, 1_800_000_000);
    openShop(g, { name: 't', shopname: '試験' });
    world.wholestore[PUDDING - 1] = 10;
    assert.ok(!getWholeStore(g).some((c) => c.itemno === PUDDING));
    // 使い方の番号で作ろうとしても、その使い方は無い
    assert.ok(loadUses(g, MILK).length > 0);
    assert.ok(!loadUses(g, MILK).some((u) => u.no === 6));
  } finally {
    server.close();
    overrideItemVisibility(PUDDING);
  }
});

test('予告の品は名前だけ。詳細は準備中', async () => {
  overrideItemVisibility(PUDDING, 'teaser');
  const { base, server } = await start();
  try {
    let r = await getText(base + '/api/v1/items');
    assert.match(r.text, /^114 固めプリン 予告$/m);
    r = await getText(base + '/api/v1/items/114');
    assert.equal(r.text, '114 固めプリン は準備中です\n');
  } finally {
    server.close();
    overrideItemVisibility(PUDDING);
  }
});

test('観戦画面のアイテム一覧に作り方と材料になる先が出る', async () => {
  const { base, server } = await start();
  try {
    const r = await getText(base + '/view/items');
    assert.equal(r.status, 200);
    assert.match(r.text, /固めプリン/);
    assert.match(r.text, /ミノ牛乳「固めプリンを作成する」: ミノタウロス♀×5\(消費しない\)、ミノ牛乳×10、砂糖×3 → 固めプリン×2 \(1h00m→45m、熟練はミノタウロス♀、酪農家 時間1\/2\)/);
    assert.match(r.text, /\[アイテム一覧\]/);
  } finally {
    server.close();
  }
});

test('処理で出す品 (乳搾り → ミノ牛乳) を隠すと、その使い方も消える。足りない理由の名前も伏せる', () => {
  const world = newWorld(1_800_000_000, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, 1_800_000_000);
  const dt = openShop(g, { name: 't', shopname: '試験' });
  overrideItemVisibility(MILK, 'hidden');
  try {
    assert.equal(loadUses(g, 25).filter((u) => u.no === 0 || u.no === 1).length, 0);
  } finally {
    overrideItemVisibility(MILK);
  }
  // 道具 (ミノタウロス♀) を隠すと、ミノ牛乳の入手の一言 (道具の名前入り) も出さない
  overrideItemVisibility(25, 'hidden');
  try {
    const d = itemDetailData(g, MILK);
    assert.equal(d.note, undefined);
    assert.doesNotMatch(itemDetailText(d), /ミノタウロス/);
  } finally {
    overrideItemVisibility(25);
  }
  const SUGAR = BASE_ITEMS.find((i) => i?.name === '砂糖')!.no;
  dt.item[MILK - 1] = 10;
  dt.item[25 - 1] = 5;
  overrideItemVisibility(SUGAR, 'hidden');
  try {
    const u = checkUses(g, dt, loadUses(g, MILK)).find((x) => x.no === 6)!;
    assert.match(u.ngReason!, /？？？x3/);
    assert.doesNotMatch(u.ngReason!, /砂糖/);
  } finally {
    overrideItemVisibility(SUGAR);
  }
});
