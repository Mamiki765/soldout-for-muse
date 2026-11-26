// SOLD OUT for Muse — 1.7.0 採る2職の道具 (ツルハシ・木こりのオノ)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { GATHER_TOOLS } from '../src/engine/gather-tools.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction, useResultMessages } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const MAP_MINE = 9;
const MAP_WOOD = 12;
const PICK = 142;
const AXE = 143;
const IRON = 5;

// 乱数はいつも 0.85: 確率 800 の鉄塊は道具なしでは出ず、道具 (+10%: 880) があれば出る
function fixture(job: string) {
  const g = new Game(newWorld(T0, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0.85 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = job;
  dt.time = T0 - 48 * 3600;
  dt.money = 500_000;
  enterShop(g, dt, true);
  dt.item[MAP_MINE - 1] = 1;
  dt.item[MAP_WOOD - 1] = 1;
  return { g, dt };
}
const useNo = (book: number, name: string) => BASE_ITEMS[book].uses.find((u) => u.name === name)!.no;

test('1.7.0 ツルハシ・木こりのオノ: データは tools/v170-tool-jobs.json とエンジンでそろい、ほかの職が作る', () => {
  const spec = JSON.parse(readFileSync('tools/v170-tool-jobs.json', 'utf8')).gather_tools;
  assert.deepEqual(GATHER_TOOLS.map((t) => ({ ...t, skip: [...t.skip] })), spec.effect);
  for (const it of spec.items) {
    const cur = BASE_ITEMS[it.no];
    assert.deepEqual([cur.name, cur.price, cur.popular, cur.limit, cur.type, cur.seedmarket], [it.name, 20000, 259200, 10, 10, 20]);
  }
  const pick = BASE_ITEMS[20].uses.find((u) => u.get[0]?.item_no === PICK)!;
  assert.deepEqual(pick.use.map((l) => [l.item_no, l.count]), [[18, 1], [5, 6], [4, 1]]);
  assert.deepEqual(pick.jobs.map((j) => j.job), ['weapon']);
  const axe = BASE_ITEMS[17].uses.find((u) => u.get[0]?.item_no === AXE)!;
  assert.deepEqual(axe.use.map((l) => [l.item_no, l.count]), [[4, 2], [5, 4]]);
  assert.equal(axe.needexp, 300);
});

test('1.7.0 ツルハシ: 持っていれば取れる確率+10% (職レベルと足し算) で、1回ごとに傷む。炭鉱には効かない', () => {
  const { g, dt } = fixture('mine');
  const iron = useNo(MAP_MINE, '鉄鉱山へ行く');
  // 道具なし: 鉄塊 (800) は 850 の乱数で出ない
  useItemAction(g, dt, MAP_MINE, iron, { count: 1 });
  assert.equal(dt.item[IRON - 1], 0);
  dt.item[PICK - 1] = 1;
  const u = useItemAction(g, dt, MAP_MINE, iron, { count: 3 });
  assert.equal(dt.item[IRON - 1], 90, '3往復×30個');
  const msg = useResultMessages(g, dt, u);
  assert.ok(msg.includes('ツルハシで+10% (3回)'), msg.join('\n'));
  assert.ok(msg.some((m) => /^ツルハシの耐久: \d+%$/.test(m)), msg.join('\n'));
  assert.ok(dt.bookwear![PICK][0] > 0.149 && dt.bookwear![PICK][0] < 0.151);
  // 炭鉱は効かない (傷みもしない)
  const before = dt.bookwear![PICK][0];
  const c = useItemAction(g, dt, MAP_MINE, useNo(MAP_MINE, '炭鉱に潜る'), { count: 1 });
  assert.ok(!useResultMessages(g, dt, c).some((m) => m.startsWith('ツルハシで')));
  assert.equal(dt.bookwear![PICK][0], before);
});

test('1.7.0 ツルハシ: 寿命に届いた回で壊れ、そのあとの回には効かない', () => {
  const { g, dt } = fixture('mine');
  dt.item[PICK - 1] = 1;
  dt.bookwear = { [PICK]: [1.2, 1.21] };
  const u = useItemAction(g, dt, MAP_MINE, useNo(MAP_MINE, '鉄鉱山へ行く'), { count: 3 });
  assert.equal(dt.item[PICK - 1], 0);
  assert.equal(dt.item[IRON - 1], 30, '壊れた1回目だけ効く');
  const msg = useResultMessages(g, dt, u);
  assert.ok(msg.includes('ツルハシが壊れました') && msg.includes('ツルハシで+10% (1回)'), msg.join('\n'));
});

test('1.7.0 木こりのオノ: 近くの山への地図のどの行き先にも効く', () => {
  const { g, dt } = fixture('wood');
  dt.item[AXE - 1] = 2;
  dt.exp[MAP_WOOD] = 1000;
  for (const u of BASE_ITEMS[MAP_WOOD].uses.filter((x) => x.exp && x.get.length)) {
    const r = useItemAction(g, dt, MAP_WOOD, u.no, { count: 1 });
    if (!r.result.count) continue;
    assert.ok(useResultMessages(g, dt, r).includes('木こりのオノで+10% (1回)'), u.name ?? '');
  }
});
