// SOLD OUT for Muse — 1.9.0 素材の市場還流 (市場の掘り出し物) の決まり
// This program is free software under the GNU GPL v2 or later. See LICENSE.
// 還流率・倍率の数字は品データ (tools/v190-resale.json → items.json の define) にだけ置き、ここでは大小と収支を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { CATALOG, MAX_ITEM } from '../src/data/catalog.js';
import { buy, editShowcase, enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { getWholeStore } from '../src/engine/market.js';
import { addResale, checkResale, closeResalePeriod, getResaleStore, resaleItems, resaleLine, resaleStock } from '../src/engine/resale.js';
import { seededRng } from '../src/engine/rng.js';
import { turnProc } from '../src/engine/turn.js';
import { newWorld } from '../src/engine/types.js';
import { marketData, marketText } from '../src/api/views.js';
import { marketPage } from '../src/api/viewer.js';

const NOW = Date.UTC(2027, 0, 13, 3, 0, 0) / 1000;

function setup() {
  const world = newWorld(NOW, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(7), NOW);
  const me = openShop(g, { name: 'alice', shopname: 'アリス商店' });
  enterShop(g, me, true);
  me.money = 10_000_000;
  return { world, g, me };
}

/** 品名から品番 */
function no(g: Game, name: string): number {
  const i = g.items.findIndex((it) => it?.name === name);
  assert.ok(i > 0, name);
  return i;
}

test('掘り出し物になるのは材料になる品と地図で採れる品。道具・本・最終品はならない', () => {
  const { g } = setup();
  const set = resaleItems(g);
  for (const name of ['獣の革', '丸太', '鉄塊', '薬草', '精鋼板']) assert.ok(set.has(no(g, name)), `${name} は材料`);
  assert.ok(set.has(no(g, '石炭')), '石炭は材料ではないが、鉱山の地図で採れる');
  for (const name of ['ナユタの首飾り', 'エリクシル', '近くの鉱山への地図', '薬調合入門']) assert.ok(!set.has(no(g, name)), `${name} はならない`);
});

test('客に売れた数の一部だけが戻り、全部は戻らない。市場が厚い品には戻らない', () => {
  const { g } = setup();
  const kawa = no(g, '獣の革');
  const put = addResale(g, kawa, 100);
  assert.ok(put > 0, '市場が空なら戻る');
  assert.ok(put < 100, '全部は戻らない');
  assert.equal(put, Math.min(Math.trunc((100 * CATALOG.resaleRate) / 1000), Math.floor(resaleLine(g, kawa))));
  // 市場在庫が卸値=標準の線以上なら戻さない
  const tetsu = no(g, '鉄塊');
  g.world.wholestore[tetsu - 1] = Math.ceil(resaleLine(g, tetsu));
  assert.equal(addResale(g, tetsu, 1000), 0);
  // 1回にたくさん売れても、線を超えては戻さない
  const kawa2 = no(g, '木の枝');
  addResale(g, kawa2, 10_000_000);
  assert.ok(resaleStock(g, kawa2) <= resaleLine(g, kawa2));
  assert.ok(getResaleStore(g).find((c) => c.itemno === kawa2)!.price >= g.items[kawa2].price, '線の下なので標準以上');
  // 最終品は戻らない
  assert.equal(addResale(g, no(g, 'ナユタの首飾り'), 100), 0);
});

test('掘り出し物は市場の上限を超えない (ふつうの在庫・店の手持ちと共通)。入らなかった数を数える', () => {
  const { g, me } = setup();
  const kawa = no(g, '獣の革');
  const it = g.items[kawa];
  const cap = Math.trunc(it.wslimit * g.shops.length + 0.99);
  me.item[kawa - 1] = cap; // 手持ちで上限が埋まっている
  assert.equal(addResale(g, kawa, 100), 0);
  assert.equal(resaleStock(g, kawa), 0);
  assert.ok(g.world.resale!.today[kawa].rejected > 0);
  // あとから手持ちが増えて上限を超えたら、掘り出し物を削る
  me.item[kawa - 1] = 0;
  addResale(g, kawa, 100);
  assert.ok(resaleStock(g, kawa) > 0);
  const stocked = resaleStock(g, kawa);
  const rejectedBefore = g.world.resale!.today[kawa].rejected;
  me.item[kawa - 1] = cap * 2; // 手持ちだけで上限を超えている
  checkResale(g);
  assert.equal(resaleStock(g, kawa), 0);
  assert.equal(g.world.resale!.today[kawa].rejected - rejectedBefore, stocked, '数えるのは削った掘り出し物だけ');
  me.item[kawa - 1] = cap;
  assert.ok(me.item[kawa - 1] + resaleStock(g, kawa) + g.world.wholestore[kawa - 1] <= cap);
});

test('掘り出し物の卸値: 少ないうちは標準以上、plus 0以下の品は同じ在庫のふつうの卸値より高い', () => {
  const { g } = setup();
  const maruta = no(g, '丸太');
  assert.ok(g.items[maruta].plus <= 0);
  addResale(g, maruta, 100);
  const stock = resaleStock(g, maruta);
  const bargain = getResaleStore(g).find((c) => c.itemno === maruta)!;
  assert.ok(bargain.price >= g.items[maruta].price, '線より少ないので標準以上');
  g.world.wholestore[maruta - 1] = stock;
  const normal = getWholeStore(g).find((c) => c.itemno === maruta)!;
  assert.ok(bargain.price > normal.price, '同じ在庫ならふつうより高い');
});

test('買い方: "bargain":true で掘り出し物から。省略時は片方にしか無ければそちらから。在庫・お金は負にならない', () => {
  const { g, me } = setup();
  const kawa = no(g, '獣の革');
  addResale(g, kawa, 1000);
  const before = resaleStock(g, kawa);
  // ふつうの在庫が無いので、省略でも掘り出し物から
  const msg = buy(g, me, { from: 0, itemno: kawa, count: 5 });
  assert.match(msg, /掘り出し物/);
  assert.equal(resaleStock(g, kawa), before - 5);
  assert.equal(me.item[kawa - 1], 5);
  // ふつうの在庫があり、そちらが安ければ、省略時はふつうから
  g.world.wholestore[kawa - 1] = 50;
  buy(g, me, { from: 0, itemno: kawa, count: 3 });
  assert.equal(g.world.wholestore[kawa - 1], 47);
  assert.equal(resaleStock(g, kawa), before - 5);
  // 明示すれば掘り出し物から。在庫より多くは買えない
  buy(g, me, { from: 0, itemno: kawa, count: 100000, bargain: true });
  assert.equal(resaleStock(g, kawa), 0);
  assert.ok(me.money >= 0);
  // 記録: 戻った数 − 買われた数 = 在庫
  const c = g.world.resale!.today[kawa];
  assert.equal(c.made - c.bought, resaleStock(g, kawa));
  closeResalePeriod(g);
  assert.deepEqual(g.world.resale!.today, {});
  assert.equal(g.world.resale!.yesterday[kawa].bought, c.bought);
});

test('棚の品が客に売れると、時間の経過で掘り出し物が戻り、市場の一覧に出る', () => {
  const { g: g0, me, world } = setup();
  const g = new Game(world, DEFAULT_CONFIG, seededRng(7), NOW + 6 * 3600);
  const kawa = no(g, '獣の革');
  // 1店の街なので上限は wslimit×1。手持ちは上限の半分にして、戻る余地を残す
  me.item[kawa - 1] = Math.trunc(g.items[kawa].wslimit / 2);
  editShowcase(g0, me, { slot: 0, itemno: kawa, percent: 50 });
  world.people = 2_000_000;
  turnProc(g);
  const sold = me.itemtoday[kawa] ?? me.itemyesterday[kawa] ?? 0;
  assert.ok(sold > 0, '客に売れた');
  const made = (g.world.resale?.today[kawa]?.made ?? 0) + (g.world.resale?.yesterday[kawa]?.made ?? 0);
  assert.ok(made > 0 && made < sold, `売れた${sold}のうち一部 ${made} が戻る`);
  const d = marketData(g);
  assert.ok(d.bargains.some((b) => b.item === kawa));
  assert.match(marketText(d), /掘り出し物/);
});

test('観戦画面の市場: 掘り出し物はふつうの在庫と同じ行に「ふつう+掘り出し物」、掘り出し物だけの品は (掘り出し物)', () => {
  const { g } = setup();
  assert.doesNotMatch(marketPage(g), /掘り出し物/);
  const kawa = no(g, '獣の革');
  addResale(g, kawa, 1000);
  const only = resaleStock(g, kawa);
  assert.match(marketPage(g), new RegExp(`${g.items[kawa].name} \\(掘り出し物\\)</td><td>${only}<`));
  g.world.wholestore[kawa - 1] = 11;
  const html = marketPage(g);
  assert.match(html, new RegExp(`${g.items[kawa].name}</td><td>11\\+${only}<`));
  assert.equal(html.split(g.items[kawa].name).length - 1, 1, '同じ品は1行だけ');
});

test('省略時の買い方: 安い方から買い、足りなければ高い方からも続けて買う。時間は1回ぶん (リカさん 1.9.1)', () => {
  const { g, me } = setup();
  const kawa = no(g, '獣の革');
  g.world.wholestore[kawa - 1] = 10;
  g.world.resale = { stock: { [kawa]: 20 }, today: {}, yesterday: {} };
  const normal = getWholeStore(g).find((c) => c.itemno === kawa)!;
  const bargain = getResaleStore(g).find((c) => c.itemno === kawa)!;
  const [cheap, dear] = normal.price <= bargain.price ? [normal, bargain] : [bargain, normal];
  const money = me.money;
  const time = me.time;
  const msg = buy(g, me, { from: 0, itemno: kawa, count: 15 });
  assert.equal(me.item[kawa - 1], 15, '指定した数を1回で');
  const cheapLeft = cheap === normal ? g.world.wholestore[kawa - 1] : resaleStock(g, kawa);
  const dearLeft = dear === normal ? g.world.wholestore[kawa - 1] : resaleStock(g, kawa);
  assert.equal(cheapLeft, 0, '安い方を先に買い切る');
  assert.equal(dearLeft, dear.stock - (15 - cheap.stock), '残りを高い方から');
  assert.equal(money - me.money, cheap.price * cheap.stock + dear.price * (15 - cheap.stock), 'それぞれの単価で払う');
  assert.equal(me.time - time, g.buyTime(kawa, cheap.price, true), '時間は1回ぶん');
  assert.match(msg, /掘り出し物/);
  // 安い方で足りるなら、高い方には手を付けない
  g.world.wholestore[kawa - 1] = 10;
  g.world.resale = { stock: { [kawa]: 20 }, today: {}, yesterday: {} };
  const before = { ws: 10, rs: 20 };
  buy(g, me, { from: 0, itemno: kawa, count: 3 });
  assert.equal(cheap === normal ? before.rs : before.ws, cheap === normal ? resaleStock(g, kawa) : g.world.wholestore[kawa - 1]);
});

test('まとめ買いのギフト券は、2つを合わせた支払いで数える', () => {
  const { g, me } = setup();
  const kawa = no(g, 'ミスリル塊');
  const gift = no(g, 'ギフト券');
  const limit = g.items[kawa].limit;
  g.items[kawa].limit = 1_000_000;
  g.world.wholestore[kawa - 1] = 100;
  g.world.resale = { stock: { [kawa]: 100 }, today: {}, yesterday: {} };
  const before = me.item[gift - 1];
  const money = me.money;
  buy(g, me, { from: 0, itemno: kawa, count: 200 });
  g.items[kawa].limit = limit;
  const paid = money - me.money;
  assert.ok(paid >= 500000, '券が出るだけ払っている');
  assert.equal(me.item[gift - 1] - before, Math.min(Math.trunc(paid / 500000), g.items[gift].limit));
});
