// SOLD OUT for Muse — 0.6.0 干し草飼料 (目安箱 #7) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { getWholeStore, seedWholeStore } from '../src/engine/market.js';
import { newWorld } from '../src/engine/types.js';
import { checkUses, loadUses, useItemAction } from '../src/engine/use.js';
import { V060 } from '../src/updates.js';

const T0 = 1_800_000_000;
const HAY = 115;
const MINO = 25;
const MILK = 26;
const MOUNTAIN = 12;

function fixture(job = '', r = 0.2) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  dt.job = job;
  return { g, dt };
}

const useNo = (item: number, name: string) => {
  const u = BASE_ITEMS[item].uses.find((x) => x.name === name);
  assert.ok(u, name);
  return u.no;
};
const FEED = useNo(MINO, '干し草を与えて搾る');
const CUT = useNo(MINO, '放牧地で草を刈る');

test('干し草: 品番115・原料・1束150円・市場に湧き、在庫が少ないと高い', () => {
  const it = BASE_ITEMS[HAY];
  assert.deepEqual([it.name, it.type, it.price, it.cost, it.limit, it.popular, it.scale], ['干し草', 1, 150, 10, 1000, 21600, '束']);
  assert.ok(it.plus > 0, '市場に湧く');
  assert.deepEqual(it.uses, []);
  const { g } = fixture();
  const price = (stock: number) => {
    g.world.wholestore[HAY - 1] = stock;
    return getWholeStore(g).find((c) => c.itemno === HAY)!.price;
  };
  assert.equal(price(1), 298, '在庫がほぼ無いと約2倍');
  assert.equal(price(200), 150, '在庫200で標準価格');
  assert.equal(price(600), 75, '在庫が多いと安い');
});

test('干し草: 新素材の初期投入 (seed-market) の対象で、0.6.0 の新規アイテムに出る', () => {
  assert.deepEqual(V060.new_items, [{ item: HAY, name: '干し草', price: 150, type: 1 }]);
  const { g } = fixture();
  g.world.people = 300000;
  const [row] = seedWholeStore(g, [HAY], 12);
  assert.ok(row.add > 0);
});

test('近くの山への地図: 7つの行き先すべてに干し草×20 (80%) が付き、牧草地で草を刈るが増える', () => {
  const uses = BASE_ITEMS[MOUNTAIN].uses;
  assert.equal(uses.length, 8);
  for (const u of uses.slice(0, 7)) {
    assert.deepEqual(u.get.at(-1), { item_no: HAY, count: 20, proba: 800 }, u.name!);
    assert.equal(u.get.filter((l) => l.item_no === HAY).length, 1);
  }
  const p = uses[7];
  assert.deepEqual([p.name, p.needexp, p.time, p.exptime, p.exp, p.func, p.params[0]], ['牧草地で草を刈る', 0, 14400, 7200, 10, 'lostbook', '100']);
  assert.deepEqual(p.get, [{ item_no: HAY, count: 120, proba: 900 }]);
  assert.deepEqual(p.jobs, [{ job: 'material', key: 'times', op: '/', value: 2 }]);
  assert.deepEqual(p.use, []);
});

test('牧草地で草を刈る: 熟練0でも行けて、山師は熟練0で2時間・干し草×120 (1束ずつ90%)', () => {
  const { g, dt } = fixture('material');
  dt.item[MOUNTAIN - 1] = 1;
  const before = dt.time;
  const u = useItemAction(g, dt, MOUNTAIN, 7, { count: 1 });
  assert.equal(u.result.count, 1);
  assert.equal(dt.time - before, 7200, '熟練0・山師で4時間の半分');
  assert.equal(dt.item[HAY - 1], 120, '乱数0.2なので全部成功');
  assert.equal(dt.exp[MOUNTAIN], 10);
});

test('干し草を与えて搾る: 頭数ぶんの干し草を使い、牛乳が頭数×5〜7本、牛は減らない', () => {
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 35;
  const before = dt.time;
  const u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(u.result.count, 3);
  assert.equal(dt.item[HAY - 1], 5, '10頭×3回=30束');
  assert.equal(dt.item[MINO - 1], 10, '過労死なし');
  // 5×10×3 + trunc(0.2×(2×10×3+1)) = 150 + 12
  assert.equal(dt.item[MILK - 1], 162);
  assert.match(u.result.function_return!, /ミノ牛乳を162本精製しました/);
  assert.equal(dt.time - before, 7200 * 3, '熟練0・酪農家でないので2時間×3');
  assert.equal(dt.exp[MINO], 30, '1回ごとにミノタウロス♀の熟練+1%');
});

test('干し草を与えて搾る: 牛乳は頭数×5が最低、頭数×7が最高', () => {
  for (const [r, want] of [[0, 100], [0.999999, 140]] as const) {
    const { g, dt } = fixture('', r);
    dt.item[MINO - 1] = 20;
    dt.item[HAY - 1] = 20;
    useItemAction(g, dt, MINO, FEED, { count: 1 });
    assert.equal(dt.item[MILK - 1], want);
  }
});

test('干し草を与えて搾る: 熟練最大で3/4の時間、酪農家はさらに半分', () => {
  for (const [job, exp, t] of [['', 1000, 5400], ['cow', 0, 3600], ['cow', 1000, 2700]] as const) {
    const { g, dt } = fixture(job);
    dt.item[MINO - 1] = 10;
    dt.item[HAY - 1] = 10;
    dt.exp[MINO] = exp;
    const before = dt.time;
    useItemAction(g, dt, MINO, FEED, { count: 1 });
    assert.equal(dt.time - before, t, `${job} 熟練${exp}`);
  }
});

test('干し草を与えて搾る: 干し草が頭数ぶん無いと使えず、ある回数だけ搾る', () => {
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 9;
  const u = checkUses(g, dt, loadUses(g, MINO)).find((x) => x.no === FEED)!;
  assert.equal(u.useok, false);
  assert.match(u.ngReason!, /干し草x10/);
  const before = structuredClone(dt);
  assert.throws(() => useItemAction(g, dt, MINO, FEED, { count: 1 }), GameError);
  assert.deepEqual(dt, before);
  dt.item[HAY - 1] = 25;
  const r = useItemAction(g, dt, MINO, FEED, { count: 5 });
  assert.equal(r.result.count, 2, '25束なら10頭で2回');
  assert.equal(dt.item[HAY - 1], 5);
});

test('干し草を与えて搾る: 牛乳の上限500を超えた分は捨てたと書く', () => {
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 20;
  dt.item[HAY - 1] = 20;
  dt.item[MILK - 1] = 450;
  const u = useItemAction(g, dt, MINO, FEED, { count: 1 });
  assert.equal(dt.item[MILK - 1], 500);
  assert.match(u.result.function_return!, /持てる上限で\d+本は捨てました/);
});

test('放牧地で草を刈る: 干し草×60 (90%)、2時間・酪農家は1時間、熟練で変わらない', () => {
  const def = BASE_ITEMS[MINO].uses[CUT];
  assert.deepEqual([def.time, def.exptime, def.exp], [7200, 7200, 10]);
  assert.deepEqual(def.get, [{ item_no: HAY, count: 60, proba: 900 }]);
  const { g, dt } = fixture('cow');
  dt.item[MINO - 1] = 1;
  const before = dt.time;
  useItemAction(g, dt, MINO, CUT, { count: 2 });
  assert.equal(dt.time - before, 7200);
  assert.equal(dt.item[HAY - 1], 120);
  assert.equal(dt.item[MINO - 1], 1);
});

test('原作の乳を搾る・ハードに乳を搾るは式も時間もそのままで、説明に数字が付く', () => {
  const [normal, hard] = BASE_ITEMS[MINO].uses;
  assert.deepEqual([normal.name, normal.params[0], normal.time, normal.exptime], ['乳を搾る', '1', 7200, 7200]);
  assert.deepEqual([hard.name, hard.params[0], hard.time, hard.exptime], ['ハードに乳を搾る', '2', 7200, 7200]);
  assert.match(normal.info!, /1〜頭数本/);
  assert.match(normal.info!, /0\.1%/);
  assert.match(hard.info!, /1〜頭数×2本/);
  assert.match(hard.info!, /0\.4%/);
  assert.match(hard.info!, /予備の1頭/);
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 10;
  useItemAction(g, dt, MINO, 0, { count: 1 });
  assert.equal(dt.item[MILK - 1], 3, 'trunc(0.2×10)+1');
});
