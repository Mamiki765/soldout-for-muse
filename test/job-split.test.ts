// SOLD OUT for Muse — 1.3.0 13職を職コードごとに分けるテスト (遊び方は分ける前と同じ)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, CATALOG, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { JOB_CHILDREN, JOB_PARENT, hasJobBonus, splitJob } from '../src/engine/jobs.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';
import { rankingData } from '../src/api/views.js';
import { Store } from '../src/store.js';

const T0 = 1_800_000_000;

function fixture(job = '') {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  dt.job = job;
  return { g, dt };
}

test('転職のススメ: 13の行き先がそれぞれ別の職コードで、名前がある', () => {
  const change = BASE_ITEMS[78].uses.filter((u) => u.params[3] && u.params[3] !== '_default_');
  assert.equal(change.length, 13);
  const codes = change.map((u) => u.params[3]!);
  assert.equal(new Set(codes).size, 13);
  for (const u of change) {
    const code = u.params[3]!;
    assert.ok(CATALOG.jobTypes[code], code);
    assert.equal(u.name, `${CATALOG.jobTypes[code]}へ転職したい`);
  }
  // 親子の表と転職のススメが合っている
  for (const [parent, kids] of Object.entries(JOB_CHILDREN)) for (const [book, code] of kids) {
    assert.equal(JOB_PARENT[code], parent);
    assert.equal(change.find((u) => u.params[3] === code)!.params[0], String(book));
  }
});

test('職ボーナス: 子の職は親のボーナスを全部受ける (分ける前と同じ)。ほかの職のは受けない', () => {
  for (const [code, parent] of Object.entries(JOB_PARENT)) {
    const { dt } = fixture(code);
    assert.equal(hasJobBonus(dt, parent), true, code);
    assert.equal(hasJobBonus(dt, code), true);
    for (const other of ['material', 'tool', 'weapon', 'armor', 'drug', 'peddle'].filter((x) => x !== parent)) assert.equal(hasJobBonus(dt, other), false, `${code} ${other}`);
  }
  assert.equal(hasJobBonus(fixture('drug').dt, 'drug'), true);
});

test('職ボーナスのかかる時間は、親の職と子の職でどの使い方も同じ', () => {
  const uses = BASE_ITEMS.flatMap((it) => (it?.uses ?? []).map((u) => [it!.no, u] as const)).filter(([, u]) => u.jobs.length);
  assert.ok(uses.length > 20);
  let ran = 0;
  for (const [code, parent] of Object.entries(JOB_PARENT)) {
    for (const [no, u] of uses) {
      if (!u.jobs.some((j) => j.job === parent)) continue;
      const time = (job: string) => {
        const { g, dt } = fixture(job);
        for (const l of u.use) dt.item[l.item_no - 1] = Math.max(dt.item[l.item_no - 1], l.count);
        dt.item[no - 1] = Math.max(dt.item[no - 1], 1);
        dt.exp[no] = 1000;
        dt.money = 1e9;
        const before = dt.time;
        try { useItemAction(g, dt, no, u.no, { count: 1 }); } catch { return 'ng'; }
        return dt.time - before;
      };
      const t = time(code);
      assert.equal(t, time(parent), `${code}: ${BASE_ITEMS[no].name}/${u.no}`);
      if (t !== 'ng') {
        ran++;
        const plain = time('drug');
        assert.ok(plain === 'ng' || t < plain, `${code}: ${BASE_ITEMS[no].name}/${u.no} ボーナスが付いている`);
      }
    }
  }
  assert.ok(ran > 30, `実際に使えた数 ${ran}`);
});

test('分け方: 熟練のいちばん高い本・地図の職へ。並びは親のまま', () => {
  const a = fixture('material').dt;
  a.exp[9] = 300;
  splitJob(a);
  assert.equal(a.job, 'mine');
  const b = fixture('tool').dt;
  b.exp[16] = 10; b.exp[17] = 30; b.exp[66] = 20;
  splitJob(b);
  assert.equal(b.job, 'woodwork');
  const c = fixture('weapon').dt;
  splitJob(c);
  assert.equal(c.job, 'weapon', '熟練0同士は分けない');
  const d = fixture('armor').dt;
  d.exp[21] = 50; d.exp[22] = 50;
  splitJob(d);
  assert.equal(d.job, 'armor', '並びは分けない');
  const e = fixture('drug').dt;
  e.exp[9] = 500;
  splitJob(e);
  assert.equal(e.job, 'drug', '子のない職は触らない');
  const f = fixture('sword').dt;
  f.exp[23] = 900;
  splitJob(f);
  assert.equal(f.job, 'sword', '分けたあとは熟練が変わっても職は変わらない');
});

test('ランキングの職名は13職の名前', () => {
  const { g, dt } = fixture('staff');
  assert.equal(rankingData(g)[0].job, '杖屋');
  dt.job = 'wood';
  assert.equal(rankingData(g)[0].job, '木こり');
});

test('保存データの親の職は読み込むと分かれる', () => {
  const store = new Store(':memory:');
  const { g, dt } = fixture('material');
  dt.exp[12] = 835;
  store.saveWorld(g.world, [], T0, 3600);
  const w = store.loadWorld(T0);
  assert.equal(w.shops.find((x) => x.id === dt.id)!.job, 'wood');
  store.close();
});
