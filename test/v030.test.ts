// SOLD OUT for Muse — v0.3.0 の新しい品・行き先・イベントが実際に効くかのテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, EVENTS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const v030 = JSON.parse(readFileSync('tools/v030.json', 'utf8')) as {
  production: { book: number; name?: string }[];
  gathering: { book: number; name: string; lostbook?: string }[];
  events: { code: string }[];
};
const NEW = BASE_ITEMS.slice(103, 114).map((it) => it.no);

function fixture(rand: number) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => rand }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}

/** 新しい品を作る USE (本・ミノ牛乳・本執筆キット) */
const productionUses = BASE_ITEMS.flatMap((it) => it ? it.uses.filter((u) => u.get.some((l) => NEW.includes(l.item_no)) && u.use.length).map((u) => ({ book: it.no, u })) : []);

test('v0.3.0: 新しい品の作り方8件は、熟練・道具・材料がそろえば作れ、道具は減らず、職業ボーナスで時間が半分', () => {
  assert.equal(productionUses.length, 8);
  for (const { book, u } of productionUses) {
    const { g, dt } = fixture(0.2);
    dt.job = u.jobs[0].job;
    dt.item[book - 1] = 1;
    const exp = u.needexp ?? 0;
    if (exp) dt.exp[book] = exp;
    for (const l of u.use) dt.item[l.item_no - 1] = l.proba === 0 ? l.count : l.count * 2;
    const before = dt.time - g.couponTime(dt); // クーポンから先に使うので合わせて数える
    const r = useItemAction(g, dt, book, u.no, { count: 2 });
    assert.equal(r.result.count, 2, u.name!);
    const t = Math.trunc(u.time / 2), e = Math.trunc(u.exptime / 2);
    assert.equal(dt.time - g.couponTime(dt) - before, 2 * (t - Math.trunc(((t - e) * exp) / 1000)), u.name! + ' の時間');
    for (const l of u.use) assert.equal(dt.item[l.item_no - 1], l.proba === 0 ? l.count : 0, `${u.name} の ${BASE_ITEMS[l.item_no].name}`);
    for (const l of u.get) assert.ok(dt.item[l.item_no - 1] > 0, `${u.name} で ${BASE_ITEMS[l.item_no].name} ができる`);
  }
});

test('v0.3.0: 調香の手引き・乳菓のレシピがないと香水・エリクシル・氷菓・焼き菓子は作れない', () => {
  for (const { book, u } of productionUses.filter(({ u }) => u.use.some((l) => l.item_no === 112 || l.item_no === 113))) {
    const { g, dt } = fixture(0.2);
    dt.item[book - 1] = 1;
    dt.exp[book] = u.needexp ?? 0;
    for (const l of u.use) dt.item[l.item_no - 1] = l.item_no >= 112 ? 0 : l.count * 2;
    assert.throws(() => useItemAction(g, dt, book, u.no, { count: 1 }), u.name!);
  }
});

test('v0.3.0/1.1.0: 調香の手引き・乳菓のレシピは1回の実行で 1-(1-3%)^セット数 傷み、寿命に届くと1冊だけ減る', () => {
  const uses = productionUses.filter(({ u }) => u.func === 'lostbooktool');
  assert.equal(uses.length, 4);
  for (const { book, u } of uses) {
    const tool = Number(u.params[1]);
    const wear = 1 - (1 - 0.03) ** 5;
    for (const lost of [true, false]) {
      const { g, dt } = fixture(0.5);
      dt.job = u.jobs[0].job;
      dt.item[book - 1] = 1;
      dt.exp[book] = u.needexp ?? 0;
      for (const l of u.use) dt.item[l.item_no - 1] = l.proba === 0 ? l.count + (l.item_no === tool ? 2 : 0) : l.count * 5;
      dt.bookwear = { [tool]: [lost ? 1 - wear + 0.001 : 1 - wear - 0.001, 1] };
      const r = useItemAction(g, dt, book, u.no, { count: 5 });
      assert.equal(r.result.count, 5, u.name!);
      assert.equal(dt.item[tool - 1], lost ? 2 : 3, `${u.name} 道具の本`);
      assert.ok(Math.abs(dt.bookwear[tool][0] - (lost ? 0.001 : 1 - 0.001)) < 1e-9, `${u.name} 持ち越し`);
    }
  }
});

test('v0.3.0/1.1.0: 新しい行き先は費用0円、港町・隊商は剣の市場より地図が傷み、霊草の谷は山の地図のほかの行き先と同じだけ傷む', () => {
  // 傷みの量そのものはデータ (1.8.2 で鉱山・山の地図は半分) にだけ置き、ここでは行き先どうしの大小を確かめる
  const base = (book: number, name: string) => Number(BASE_ITEMS[book].uses.find((x) => x.name === name)!.params[0]);
  const old = BASE_ITEMS[14].uses.find((x) => x.name === '剣の市場へ仕入に行く')!;
  for (const spec of v030.gathering) {
    const u = BASE_ITEMS[spec.book].uses.find((x) => x.name === spec.name)!;
    assert.equal(u.money, 0, spec.name);
    const wear = Number(u.params[0]);
    if (spec.name === '霊草の谷を探す') assert.equal(wear, base(12, '山のふもとを探索'), spec.name);
    else assert.ok(wear > Number(old.params[0]), spec.name);
    for (const lost of [true, false]) {
      const { g, dt } = fixture(0.5);
      dt.job = u.jobs[0].job;
      dt.item[spec.book - 1] = 2;
      dt.exp[spec.book] = u.needexp!;
      dt.bookwear = { [spec.book]: [lost ? 1 - wear / 1000 + 0.001 : 1 - wear / 1000 - 0.001, 1] };
      useItemAction(g, dt, spec.book, u.no, { count: 1 });
      assert.equal(dt.item[spec.book - 1], lost ? 1 : 2, `${spec.name}`);
    }
  }
  assert.ok(old.money > 0, '既存の剣市は費用がかかる');
});

test('v0.3.0: 開催中のイベントは新しい品の値を書き換える (エリクシルはポーションブームに乗る)', () => {
  const want: [string, number, 'popular' | 'point' | 'plus', number][] = [
    ['boom-posyon', 109, 'popular', Math.trunc(129600 / 1.5)], ['boom-posyon', 109, 'point', 2000],
    ['boom-fashion', 108, 'popular', Math.trunc(86400 / 1.5)],
    ['boom-milk', 107, 'popular', Math.trunc(10800 / 1.5)], ['boom-milk', 110, 'point', 2000], ['boom-milk', 111, 'popular', Math.trunc(172800 / 1.5)],
    ['boom-book', 112, 'popular', Math.trunc(259200 / 1.5)], ['boom-book', 113, 'popular', Math.trunc(259200 / 1.5)],
    ['plusup-import', 103, 'plus', 600], ['plusup-import', 104, 'plus', 600],
  ];
  for (const [code, no, key, value] of want) {
    const world = newWorld(T0, MAX_ITEM);
    world.events[code] = T0 + 3600;
    const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.5 }, T0);
    assert.equal(g.items[no][key], value, `${code} ${BASE_ITEMS[no].name}.${key}`);
  }
});

test('v0.3.0: イベントの定義に参照切れ・常時発生・グループ型の崩れがない', () => {
  const keys = new Set(['popular', 'price', 'point', 'plus']);
  for (const e of EVENTS.values()) {
    assert.equal(typeof e.group, 'string', e.code);
    if (e.auto_start) assert.ok(e.startproba > 0, `${e.code} は startproba 0 だと毎回始まる`);
    for (const p of e.params) {
      assert.ok(BASE_ITEMS[p.item_no], `${e.code} → ${p.item_no}`);
      assert.ok(keys.has(p.key), `${e.code} ${p.key}`);
    }
  }
  for (const m of ['tetu', 'misuriru', 'oriharukon']) assert.equal(EVENTS.get('priceup-' + m)!.group, EVENTS.get('plusup-' + m)!.group, '不足と流入は同時に起きない');
  for (const { code } of v030.events) assert.ok(EVENTS.has(code), code);
  assert.equal(EVENTS.get('kill-acce')!.auto_start, false, '反アクセサリ運動は禁断の書で起こす');
});
