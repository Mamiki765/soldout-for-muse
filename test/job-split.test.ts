// SOLD OUT for Muse — 1.3.0 山師を探鉱夫・木こりに分けるテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, CATALOG, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { FORMER_MATERIAL_KEY, hasJobBonus, isFormerMaterial, splitMaterialJob } from '../src/engine/jobs.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { rankingData } from '../src/api/views.js';
import { Store } from '../src/store.js';

const T0 = 1_800_000_000;
const MINE = 9;
const MOUNT = 12;

function fixture(job = '') {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  dt.job = job;
  return { g, dt };
}

/** 地図の最初の行き先を1回使ってかかった秒数 */
function mapTime(job: string, map: number, former = false): number {
  const { g, dt } = fixture(job);
  if (former) dt.user[FORMER_MATERIAL_KEY] = '1.3.0';
  dt.item[map - 1] = 1;
  const before = dt.time;
  useItemAction(g, dt, map, 0, { count: 1 });
  return dt.time - before;
}

test('職の名前: 探鉱夫・木こりが増え、山師も分けられなかった店のために残す', () => {
  assert.equal(CATALOG.jobTypes.mine, '探鉱夫');
  assert.equal(CATALOG.jobTypes.wood, '木こり');
  assert.equal(CATALOG.jobTypes.material, '山師');
});

test('地図の職ボーナス: 鉱山の地図は探鉱夫、山の地図は木こりだけ (転職のススメの行き先も)', () => {
  for (const [map, job] of [[MINE, 'mine'], [MOUNT, 'wood']] as const) {
    for (const u of BASE_ITEMS[map].uses) assert.deepEqual(u.jobs.map((j) => j.job), [job], `${map}/${u.no}`);
    const change = BASE_ITEMS[78].uses.filter((u) => u.params[0] === String(map));
    assert.equal(change.length, 1);
    assert.equal(change[0].params[3], job);
  }
  const all = BASE_ITEMS.flatMap((it) => it?.uses ?? []).flatMap((u) => u.jobs.map((j) => j.job));
  assert.ok(!all.includes('material'), 'material のボーナスはもう無い');
  assert.ok(!BASE_ITEMS[78].uses.some((u) => u.params[3] === 'material'));
});

test('ボーナスの付き方: 新しい探鉱夫・木こりは自分の地図だけ、元山師と山師は両方', () => {
  const base = mapTime('', MINE);
  const baseM = mapTime('', MOUNT);
  assert.equal(mapTime('mine', MINE), base / 2);
  assert.equal(mapTime('mine', MOUNT), baseM, '探鉱夫は山の地図で速くならない');
  assert.equal(mapTime('wood', MOUNT), baseM / 2);
  assert.equal(mapTime('wood', MINE), base, '木こりは鉱山の地図で速くならない');
  assert.equal(mapTime('mine', MOUNT, true), baseM / 2, '元山師の探鉱夫は山の地図も半分');
  assert.equal(mapTime('wood', MINE, true), base / 2, '元山師の木こりは鉱山の地図も半分');
  assert.equal(mapTime('material', MINE), base / 2, '分けられなかった山師は両方');
  assert.equal(mapTime('material', MOUNT), baseM / 2);
  // 元山師の印があってもほかの職のボーナスは付かない
  const { dt } = fixture('drug');
  dt.user[FORMER_MATERIAL_KEY] = '1.3.0';
  assert.equal(hasJobBonus(dt, 'mine'), true);
  assert.equal(hasJobBonus(dt, 'tool'), false);
});

test('分け方: 熟練の高い地図の職へ。並びは山師のまま', () => {
  const a = fixture('material').dt;
  a.exp[MINE] = 300;
  splitMaterialJob(a);
  assert.equal(a.job, 'mine');
  assert.equal(isFormerMaterial(a), true);
  const b = fixture('material').dt;
  b.exp[MINE] = 10;
  b.exp[MOUNT] = 20;
  splitMaterialJob(b);
  assert.equal(b.job, 'wood');
  assert.equal(isFormerMaterial(b), true);
  const c = fixture('material').dt;
  splitMaterialJob(c);
  assert.equal(c.job, 'material', '熟練0同士は分けない');
  assert.equal(isFormerMaterial(c), false);
  const d = fixture('weapon').dt;
  d.exp[MINE] = 500;
  splitMaterialJob(d);
  assert.equal(d.job, 'weapon', 'ほかの職は触らない');
  assert.equal(d.user[FORMER_MATERIAL_KEY], undefined);
});

test('転職し直すと元山師ではなくなる (同じ職でも)', () => {
  const { g, dt } = fixture('mine');
  dt.user[FORMER_MATERIAL_KEY] = '1.3.0';
  dt.user._job_gift = '1.0.0';
  dt.item[78 - 1] = 1;
  const toMine = BASE_ITEMS[78].uses.find((u) => u.params[3] === 'mine')!.no;
  useItemAction(g, dt, 78, toMine, { count: 1 });
  assert.equal(dt.job, 'mine');
  assert.equal(isFormerMaterial(dt), false);
  assert.equal(hasJobBonus(dt, 'wood'), false);
});

test('ランキングの職名: 探鉱夫・木こりは括弧なし、分けられなかった山師は山師', () => {
  const { g, dt } = fixture('mine');
  assert.equal(rankingData(g)[0].job, '探鉱夫');
  dt.job = 'wood';
  assert.equal(rankingData(g)[0].job, '木こり');
  dt.job = 'material';
  assert.equal(rankingData(g)[0].job, '山師');
});

test('保存データの山師は読み込むと分かれる', () => {
  const store = new Store(':memory:');
  const { g, dt } = fixture('material');
  dt.exp[MOUNT] = 835;
  store.saveWorld(g.world, [], T0, 3600);
  const w = store.loadWorld(T0);
  const s = w.shops.find((x) => x.id === dt.id)!;
  assert.equal(s.job, 'wood');
  assert.equal(s.user[FORMER_MATERIAL_KEY], '1.3.0');
  store.close();
});
