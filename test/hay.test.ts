// SOLD OUT for Muse — 干し草と酪農の決まり (0.6.0 目安箱 #7 から)。
// 値段・時間・個数などの数字は品のデータ (src/data/items.json) から読み、ここには書かない (AGENTS.md「テストの決まり」)
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
import { APOLOGY_HAY_PER_HEAD } from '../src/engine/apology.js';
import { BOOK_LIFE_MIN } from '../src/engine/scripts.js';

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
const PASTURE = useNo(MOUNTAIN, '牧草地で草を刈る');
const HEAVY = useNo(MILK, 'ヘビー発酵');
const CHEESE = 36;

/** 1回使ったときに減った持ち時間 */
function spent(job: string, exp: number, item: number, use: number, setup: (dt: ReturnType<typeof fixture>['dt']) => void, count = 1): number {
  const { g, dt } = fixture(job);
  setup(dt);
  dt.exp[item] = exp;
  const before = dt.time;
  useItemAction(g, dt, item, use, { count });
  return dt.time - before;
}

test('干し草: 原料で、市場に湧き、使い方はない。市場の在庫が少ないほど高く、多いほど安い', () => {
  const it = BASE_ITEMS[HAY];
  assert.equal(it.name, '干し草');
  assert.equal(it.type, 1, '原料');
  assert.ok(it.plus > 0, '市場に湧く');
  assert.deepEqual(it.uses, []);
  const { g } = fixture();
  const price = (stock: number) => {
    g.world.wholestore[HAY - 1] = stock;
    return getWholeStore(g).find((c) => c.itemno === HAY)!.price;
  };
  const prices = [1, 50, 200, 600, 1000].map(price);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] <= prices[i - 1], `在庫が増えると安くなる ${prices}`);
  assert.ok(prices[0] > it.price && prices.at(-1)! < it.price, '標準価格をはさんで上下する');
});

test('干し草: 新素材の初期投入 (seed-market) の対象で、0.6.0 の新規アイテムに出る', () => {
  assert.deepEqual(V060.new_items!.map((x) => x.item), [HAY]);
  const { g } = fixture();
  g.world.people = 300000;
  const [row] = seedWholeStore(g, [HAY], 12);
  assert.ok(row.add > 0);
});

// 1.10.0 の狩り場は干し草の値崩れ中に足したので、干し草を付けない (tools/v1100.json)
test('近くの山への地図: 牧草地・狩り場のほかのどの行き先でも干し草が1行だけ取れ、牧草地は材料なし・熟練なしで行ける', () => {
  const uses = BASE_ITEMS[MOUNTAIN].uses;
  for (const u of uses) {
    if (u.no === PASTURE || u.name === '狩り場で獣を狩る') continue;
    assert.equal(u.get.filter((l) => l.item_no === HAY).length, 1, u.name!);
  }
  const p = uses[PASTURE];
  assert.equal(p.needexp, 0);
  assert.deepEqual(p.use, []);
  assert.ok(p.get.some((l) => l.item_no === HAY));
  assert.ok(p.get.some((l) => l.item_no === 1), '1.7.0 から薬草も');
  assert.ok(p.exptime <= p.time, '熟練で長くならない');
  assert.deepEqual(p.jobs, [{ job: 'material', key: 'times', op: '/', value: 2 }], '採取の職 (山師の系統) で時間が半分');
});

test('牧草地で草を刈る: 熟練0でも行け、職ボーナスで時間が半分、乱数が当たれば定義どおりの数が取れ、熟練が付く', () => {
  const p = BASE_ITEMS[MOUNTAIN].uses[PASTURE];
  const setup = (dt: ReturnType<typeof fixture>['dt']) => { dt.item[MOUNTAIN - 1] = 1; };
  assert.equal(spent('material', 0, MOUNTAIN, PASTURE, setup) * 2, spent('', 0, MOUNTAIN, PASTURE, setup));
  const { g, dt } = fixture('material', 0);
  dt.item[MOUNTAIN - 1] = 1;
  const u = useItemAction(g, dt, MOUNTAIN, PASTURE, { count: 1 });
  assert.equal(u.result.count, 1);
  assert.equal(dt.item[HAY - 1], p.get.find((l) => l.item_no === HAY)!.count);
  assert.ok(dt.exp[MOUNTAIN] > 0);
});

test('干し草を与えて搾る: 1回に頭数ぶんの干し草を使い、牛は減らず、牛乳は少なくとも頭数ぶん増え、熟練が付く', () => {
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 35;
  const u = useItemAction(g, dt, MINO, FEED, { count: 3 });
  assert.equal(u.result.count, 3);
  assert.equal(dt.item[HAY - 1], 35 - 10 * 3);
  assert.equal(dt.item[MINO - 1], 10, '寿命にはまだ届かない');
  assert.ok(dt.item[MILK - 1] >= 10 * 3);
  assert.match(u.result.function_return!, new RegExp(`ミノ牛乳を${dt.item[MILK - 1]}本精製しました`), '返事の本数と増えた本数が同じ');
  assert.ok(dt.exp[MINO] > 0);
});

test('干し草を与えて搾る (1.1.1): 牛は乳を搾ると同じく使うたびに老い、寿命に届くと1頭減る', () => {
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 10;
  dt.item[HAY - 1] = 40;
  useItemAction(g, dt, MINO, FEED, { count: 1 });
  const one = dt.bookwear![MINO][0];
  useItemAction(g, dt, MINO, FEED, { count: 2 });
  assert.ok(one > 0 && Math.abs(dt.bookwear![MINO][0] - one * 3) < 1e-9, '回数に比例して老いる');
  assert.equal(dt.item[MINO - 1], 10);
  dt.bookwear![MINO] = [BOOK_LIFE_MIN - one / 2, BOOK_LIFE_MIN];
  const u = useItemAction(g, dt, MINO, FEED, { count: 1 });
  assert.equal(dt.item[MINO - 1], 9, '寿命に届いて1頭');
  assert.match(u.result.function_return!, /ミノタウロス♀の寿命: /);
});

test('干し草を与えて搾る: 牛乳の数は乱数で増え (運が良いほど多い)、頭数に比例する', () => {
  const milk = (r: number, heads: number) => {
    const { g, dt } = fixture('', r);
    dt.item[MINO - 1] = heads;
    dt.item[HAY - 1] = heads;
    useItemAction(g, dt, MINO, FEED, { count: 1 });
    return dt.item[MILK - 1];
  };
  assert.ok(milk(0, 20) < milk(0.999999, 20));
  assert.equal(milk(0, 20), milk(0, 10) * 2);
  assert.ok(milk(0.999999, 20) <= milk(0.999999, 10) * 2 + 1);
});

test('干し草を与えて搾る: 熟練が上がると時間が短くなり、酪農家はさらに半分', () => {
  const setup = (dt: ReturnType<typeof fixture>['dt']) => { dt.item[MINO - 1] = 10; dt.item[HAY - 1] = 10; };
  const t = (job: string, exp: number) => spent(job, exp, MINO, FEED, setup);
  assert.ok(t('', 1000) < t('', 0));
  assert.ok(t('', 500) <= t('', 0) && t('', 500) >= t('', 1000));
  assert.equal(t('cow', 0) * 2, t('', 0));
  assert.equal(t('cow', 1000) * 2, t('', 1000));
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

test('干し草を与えて搾る: 牛乳は所持上限を超えず、超えた分は捨てたと書く', () => {
  const { g, dt } = fixture();
  const limit = BASE_ITEMS[MILK].limit;
  dt.item[MINO - 1] = 20;
  dt.item[HAY - 1] = 20;
  dt.item[MILK - 1] = limit - 1;
  const u = useItemAction(g, dt, MINO, FEED, { count: 1 });
  assert.equal(dt.item[MILK - 1], limit);
  assert.match(u.result.function_return!, /持てる上限で\d+本は捨てました/);
});

test('放牧地で草を刈る: 材料なしで干し草が取れ、牛は減らず、熟練で時間は変わらず、酪農家は半分', () => {
  const def = BASE_ITEMS[MINO].uses[CUT];
  assert.equal(def.time, def.exptime, '熟練で変わらない');
  assert.ok(def.get.length === 1 && def.get[0].item_no === HAY);
  const setup = (dt: ReturnType<typeof fixture>['dt']) => { dt.item[MINO - 1] = 1; };
  assert.equal(spent('cow', 0, MINO, CUT, setup) * 2, spent('', 0, MINO, CUT, setup));
  assert.equal(spent('', 1000, MINO, CUT, setup), spent('', 0, MINO, CUT, setup));
  const { g, dt } = fixture('cow', 0);
  dt.item[MINO - 1] = 1;
  useItemAction(g, dt, MINO, CUT, { count: 2 });
  assert.equal(dt.item[HAY - 1], def.get[0].count * 2, '乱数が当たれば定義の数×回数');
  assert.equal(dt.item[MINO - 1], 1);
});

test('原作の乳を搾る・ハードに乳を搾る: 説明に本数と老い方が出て、ハードのほうが多く搾れて多く老いる。熟練で時間が縮む (1.2.2)', () => {
  const [normal, hard] = BASE_ITEMS[MINO].uses;
  assert.deepEqual([normal.name, hard.name], ['乳を搾る', 'ハードに乳を搾る']);
  for (const u of [normal, hard]) assert.ok(u.exptime < u.time, `${u.name}: 熟練100%で短くなる`);
  assert.match(normal.info!, /1〜頭数本/);
  assert.match(hard.info!, /1〜頭数×2本/);
  assert.match(hard.info!, /予備の1頭/);
  const wear = (info: string) => Number(info.match(/([\d.]+)%/)![1]);
  assert.ok(wear(hard.info!) > wear(normal.info!));
  const milk = (use: number, r: number) => {
    const { g, dt } = fixture('', r);
    dt.item[MINO - 1] = 10;
    useItemAction(g, dt, MINO, use, { count: 1 });
    return dt.item[MILK - 1];
  };
  for (const r of [0, 0.5, 0.999]) {
    assert.ok(milk(0, r) >= 1 && milk(0, r) <= 10, '1〜頭数本');
    assert.ok(milk(1, r) >= milk(0, r) && milk(1, r) <= 20, 'ハードは1〜頭数×2本');
  }
});

test('干し草を与えて搾る: 干し草は定義では1頭ぶん、店では頭数ぶん。材料の逆引きと「他店の棚に」にも出る', async () => {
  const { onShelf } = await import('../src/engine/onshelf.js');
  const { itemDetailData } = await import('../src/api/views.js');
  const def = BASE_ITEMS[MINO].uses[FEED];
  assert.deepEqual(def.use.map((l) => [l.item_no, l.count, l.proba > 0]), [[MINO, 1, false], [HAY, 1, true]]);
  const { g, dt } = fixture();
  assert.ok(itemDetailData(g, HAY).used_in.some((u) => u.item === MINO && u.use === FEED), '干し草の「材料になる先」に出る');
  dt.item[MINO - 1] = 12;
  dt.item[HAY - 1] = 11;
  dt.exp[MINO] = 10;
  const other = openShop(g, { name: 'hay', shopname: '牧草の店' });
  other.showcase[0] = HAY;
  other.price[0] = BASE_ITEMS[HAY].price;
  other.item[HAY - 1] = 300;
  assert.deepEqual(onShelf(g, dt).map((x) => [x.item, x.why]), [[HAY, 'recipe']], '12頭に11束では足りない');
  dt.item[HAY - 1] = 12;
  assert.deepEqual(onShelf(g, dt), [], '頭数ぶんあれば出さない');
});

test('ヘビー発酵: 牛乳からチーズができ、熟練で時間が縮み、酪農家は半分。材料ぶんだけ作る', () => {
  const heavy = BASE_ITEMS[MILK].uses[HEAVY];
  const per = heavy.get.find((l) => l.item_no === CHEESE)!.count;
  const need = heavy.use.find((l) => l.item_no === MILK)!.count;
  assert.ok(heavy.exptime < heavy.time);
  assert.match(heavy.info!, new RegExp(`ミノチーズが${per}個`), '説明の個数が定義と同じ');
  const setup = (dt: ReturnType<typeof fixture>['dt']) => { dt.item[MINO - 1] = 10; dt.item[MILK - 1] = need; };
  assert.equal(spent('cow', 0, MILK, HEAVY, setup) * 2, spent('', 0, MILK, HEAVY, setup));
  // 乳製品の熟練はミノタウロス♀に付く (熟練共有)
  const skilled = (dt: ReturnType<typeof fixture>['dt']) => { setup(dt); dt.exp[MINO] = 1000; };
  assert.ok(spent('', 0, MILK, HEAVY, skilled) < spent('', 0, MILK, HEAVY, setup));
  const { g, dt } = fixture('cow');
  dt.item[MINO - 1] = 10;
  dt.item[MILK - 1] = need * 2;
  const u = useItemAction(g, dt, MILK, HEAVY, { count: 5 });
  assert.equal(u.result.count, 2, '材料ぶんの2回だけ');
  assert.equal(dt.item[CHEESE - 1], per * 2);
  assert.equal(dt.item[MILK - 1], 0);
});

test('詫び草: ミノを持つ店にだけ頭数に比例して配り、所持上限を超えない。記録に1行', async () => {
  const { giveApologyHay } = await import('../src/engine/apology.js');
  const limit = BASE_ITEMS[HAY].limit;
  const { g, dt } = fixture();
  dt.item[MINO - 1] = 12;
  const big = openShop(g, { name: 'big', shopname: '大牧場' });
  big.item[MINO - 1] = 30;
  big.item[HAY - 1] = limit - 100;
  const none = openShop(g, { name: 'none', shopname: '牛なし' });
  const rows = giveApologyHay(g);
  assert.deepEqual(rows.map((r) => [r.shop, r.cows]), [[dt.id, 12], [big.id, 30]]);
  assert.equal(dt.item[HAY - 1], 12 * APOLOGY_HAY_PER_HEAD);
  assert.equal(big.item[HAY - 1], Math.min(limit, limit - 100 + 30 * APOLOGY_HAY_PER_HEAD));
  assert.equal(none.item[HAY - 1], 0);
  assert.ok(g.newLogs.some((l) => l.from === dt.id && l.msg.includes(`お詫びの干し草を${12 * APOLOGY_HAY_PER_HEAD}束`)));
});
