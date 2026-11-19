// SOLD OUT for Muse — 0.7.0 職業バランスの見直しと新商品16種のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { V070 } from '../src/updates.js';

const T0 = 1_800_000_000;
const MINO = 25;
const MILK = 26;
const HAY = 115;
const TROUGH = 131;

function fixture(r = 0.2) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}
const FEED = BASE_ITEMS[MINO].uses.find((x) => x.name === '干し草を与えて搾る')!.no;

test('0.7.0: 新商品は116〜131の16品で、どれも作り方が1つある', () => {
  assert.equal(MAX_ITEM, 132);
  assert.deepEqual(V070.new_items!.map((i) => i.item), Array.from({ length: 16 }, (_, i) => 116 + i));
  for (let no = 116; no <= 131; no++) {
    const made = Object.values(BASE_ITEMS).flatMap((it) => it?.uses ?? []).filter((u) => u.get.some((l) => l.item_no === no));
    assert.ok(made.length >= 1, BASE_ITEMS[no].name);
  }
  const t = BASE_ITEMS[TROUGH];
  assert.deepEqual([t.name, t.price, t.limit], ['飼い葉桶', 20000, 10]);
});

test('0.7.0: 剣の鍛え方は6.4万円・すり切れ7.8%', () => {
  const book = BASE_ITEMS[20];
  assert.equal(book.price, 64000);
  const rates = new Set(book.uses.filter((u) => u.func === 'lostbook').map((u) => u.params[0]));
  assert.ok(rates.has('78'));
  assert.ok(!rates.has('100'));
});

test('飼い葉桶: 持っていると牛乳が頭数×1本増え、10%で1回ごとに1個すり減る', () => {
  // r=0.2: 壊れない (200 >= 100)
  let { g, dt } = fixture(0.2);
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  dt.item[TROUGH - 1] = 1;
  let u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 162 + 30, '10頭×3回で+30本');
  assert.equal(dt.item[TROUGH - 1], 1);
  assert.doesNotMatch(u.result.function_return!, /壊れ/);

  // r=0: 毎回壊れる。桶2個なら2回目まで上乗せし、3回目は桶が無いので上乗せしない
  ({ g, dt } = fixture(0));
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  dt.item[TROUGH - 1] = 2;
  u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 150 + 20);
  assert.equal(dt.item[TROUGH - 1], 0);
  assert.match(u.result.function_return!, /飼い葉桶が2個壊れました/);

  // まとめて搾っても1回ずつ搾っても同じ (桶1個・毎回壊れる)
  const batch = fixture(0);
  const single = fixture(0);
  for (const f of [batch, single]) {
    f.dt.item[MINO - 1] = 10;
    f.dt.item[HAY - 1] = 30;
    f.dt.item[TROUGH - 1] = 1;
  }
  useItemAction(batch.g, batch.dt, MINO, FEED, { count: 3 });
  for (let i = 0; i < 3; i++) useItemAction(single.g, single.dt, MINO, FEED, { count: 1 });
  assert.equal(batch.dt.item[MILK - 1], 160);
  assert.equal(single.dt.item[MILK - 1], 160);

  // 持っていなければ今までどおり
  ({ g, dt } = fixture(0.2));
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 30;
  useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(dt.item[MILK - 1], 162);
});

const CIG = 132;
const SMOKE = 0;

test('タイムシガレット: 1本で持ち時間+30分、待ち中でも吸え、上限48時間を超える分は吸えない', () => {
  const it = BASE_ITEMS[CIG];
  assert.deepEqual([it.name, it.price, it.limit, it.popular, it.cost], ['タイムシガレット', 1800, 9999, 0, 0]);
  const { g, dt } = fixture();
  assert.ok(g.itemFlag(CIG, 'noshowcase') && g.itemFlag(CIG, 'nosend') && g.itemFlag(CIG, 'nobuy'), '売れない・譲れない');
  dt.item[CIG - 1] = 100;
  // 待ち中 (持ち時間 -1時間) でも吸える
  dt.time = T0 + 3600;
  useItemAction(g, dt, CIG, SMOKE, { count: 4 });
  assert.equal(g.stockTime(dt), 3600);
  assert.equal(dt.item[CIG - 1], 96);
  // 上限48時間: あと47時間 = 94本まで
  const u = useItemAction(g, dt, CIG, SMOKE, { count: 100 });
  assert.equal(u.result.count, 94);
  assert.equal(g.stockTime(dt), 48 * 3600);
  assert.equal(dt.item[CIG - 1], 2);
  const full = useItemAction(g, dt, CIG, SMOKE, { count: 1 });
  assert.equal(full.result.count, 0);
  assert.match(full.result.failReason!, /いっぱい/);
  assert.equal(dt.item[CIG - 1], 2);
});

test('転職のお祝い: 職に就くと1店1回だけ道具がもらえる', async () => {
  const { giveJobGift, giveShopTime, JOB_GIFTS } = await import('../src/engine/campaign.js');
  // 13の転職先すべてに贈り物があり、1 (7万円) を大きく外れない
  const change = BASE_ITEMS[78].uses.filter((u) => u.params[3] && u.params[3] !== '_default_');
  assert.equal(change.length, 13);
  for (const u of change) {
    const gift = JOB_GIFTS[Number(u.params[0])];
    assert.ok(gift, u.name!);
    const yen = gift.reduce((n, [no, c]) => n + (no === CIG ? 10000 : BASE_ITEMS[no].price) * c, 0);
    assert.ok(yen >= 64000 && yen <= 90000, `${u.name} ${yen}`);
  }
  const { g, dt } = fixture();
  dt.item[78 - 1] = 2;
  const toPeddle = change.find((u) => u.params[3] === 'peddle')!.no;
  const toCow = change.find((u) => u.params[3] === 'cow')!.no;
  let u = useItemAction(g, dt, 78, toPeddle, { count: 1 });
  assert.equal(dt.job, 'peddle');
  assert.equal(dt.item[14 - 1], 7, '剣市への地図7枚 (上限10)');
  assert.match(u.result.function_return!, /お祝い/);
  u = useItemAction(g, dt, 78, toCow, { count: 1 });
  assert.equal(dt.job, 'cow');
  assert.equal(dt.item[25 - 1], 0, '2回目はもらえない');
  assert.equal(giveJobGift(g, dt, 25), '');

  // 既存店への8本: 職のある店は配布済みになり、無職の店はあとで就職するともらえる
  const a = fixture();
  const b = fixture();
  b.dt.job = 'weapon';
  a.g.shops.push(b.dt);
  const rows = giveShopTime(a.g);
  assert.equal(a.dt.item[CIG - 1], 8);
  assert.equal(b.dt.item[CIG - 1], 8);
  assert.equal(rows.length, 2);
  assert.equal(giveJobGift(a.g, b.dt, 20), '');
  assert.match(giveJobGift(a.g, a.dt, 20), /剣の鍛え方×1/);
  // お詫びの配布は印を付けない
  const c = fixture();
  c.dt.job = 'armor';
  giveShopTime(c.g, 48, false, 'お詫び');
  assert.equal(c.dt.item[CIG - 1], 48);
  assert.match(giveJobGift(c.g, c.dt, 21), /盾の作り方×1/);
});
