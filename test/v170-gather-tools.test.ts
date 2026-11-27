// SOLD OUT for Muse — 1.7.0 採る2職の道具 (ツルハシ・木こりのオノ) の決まり。数字はデータと GATHER_TOOLS から読む (AGENTS.md「テストの決まり」)
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

const PICK_TOOL = GATHER_TOOLS.find((t) => t.tool === PICK)!;
const AXE_TOOL = GATHER_TOOLS.find((t) => t.tool === AXE)!;
const useNo = (book: number, name: string) => BASE_ITEMS[book].uses.find((u) => u.name === name)!.no;
const ironLine = () => BASE_ITEMS[MAP_MINE].uses[useNo(MAP_MINE, '鉄鉱山へ行く')].get.find((l) => l.item_no === IRON)!;

// 乱数は、鉄鉱山の鉄塊の確率と「道具の倍率 (100+percent)% を掛けた確率」のちょうど間にする: 道具なしでは出ず、道具があれば出る (確率はデータから、職レベル0)
function fixture(job: string) {
  const p = Math.min(1000, ironLine().proba);
  const r = (p + (p * (100 + PICK_TOOL.percent)) / 100) / 2 / 1000;
  const g = new Game(newWorld(T0, MAX_ITEM), DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = job;
  dt.time = T0 - 48 * 3600;
  dt.money = 500_000;
  enterShop(g, dt, true);
  dt.item[MAP_MINE - 1] = 1;
  dt.item[MAP_WOOD - 1] = 1;
  return { g, dt };
}

test('1.7.0 ツルハシ・木こりのオノ: エンジンの効き目は tools/v170-tool-jobs.json とそろい、ほかの職 (剣屋・木工細工屋) が作る', () => {
  const spec = JSON.parse(readFileSync('tools/v170-tool-jobs.json', 'utf8')).gather_tools;
  assert.deepEqual(GATHER_TOOLS.map((t) => ({ ...t, skip: [...t.skip] })), spec.effect);
  for (const it of spec.items) assert.equal(BASE_ITEMS[it.no].name, it.name);
  const pick = BASE_ITEMS[20].uses.find((u) => u.get[0]?.item_no === PICK)!;
  assert.deepEqual(pick.jobs.map((j) => j.job), ['weapon']);
  const axe = BASE_ITEMS[17].uses.find((u) => u.get[0]?.item_no === AXE)!;
  assert.ok(axe.needexp && axe.needexp > 0, 'オノは木工細工入門の熟練で開く');
  for (const t of [PICK_TOOL, AXE_TOOL]) assert.ok(t.percent > 0 && t.wear > 0 && t.wear < 1);
});

test('1.7.0 ツルハシ: 持っていれば取れる確率が上がり (職レベルと足し算)、使った回数ぶん傷む。炭鉱にも効く', () => {
  const { g, dt } = fixture('mine');
  const iron = useNo(MAP_MINE, '鉄鉱山へ行く');
  useItemAction(g, dt, MAP_MINE, iron, { count: 1 });
  assert.equal(dt.item[IRON - 1], 0, '道具なしでは出ない乱数');
  dt.item[PICK - 1] = 1;
  const u = useItemAction(g, dt, MAP_MINE, iron, { count: 3 });
  assert.equal(dt.item[IRON - 1], ironLine().count * 3, '3往復とも出る');
  const msg = useResultMessages(g, dt, u);
  assert.ok(msg.includes(`山師のツルハシで+${PICK_TOOL.percent}% (3回)`), msg.join('\n'));
  assert.ok(msg.some((m) => /^山師のツルハシの耐久: \d+%$/.test(m)), msg.join('\n'));
  assert.ok(Math.abs(dt.bookwear![PICK][0] - PICK_TOOL.wear * 3) < 1e-9);
  const c = useItemAction(g, dt, MAP_MINE, useNo(MAP_MINE, '炭鉱に潜る'), { count: 1 });
  assert.ok(useResultMessages(g, dt, c).includes(`山師のツルハシで+${PICK_TOOL.percent}% (1回)`));
});

test('1.7.0 ツルハシ: 寿命に届いた回で壊れ、そのあとの回には効かない', () => {
  const { g, dt } = fixture('mine');
  dt.item[PICK - 1] = 1;
  dt.bookwear = { [PICK]: [1.21 - PICK_TOOL.wear / 2, 1.21] };
  const u = useItemAction(g, dt, MAP_MINE, useNo(MAP_MINE, '鉄鉱山へ行く'), { count: 3 });
  assert.equal(dt.item[PICK - 1], 0);
  assert.equal(dt.item[IRON - 1], ironLine().count, '壊れた1回目だけ効く');
  const msg = useResultMessages(g, dt, u);
  assert.ok(msg.includes('山師のツルハシが壊れました') && msg.includes(`山師のツルハシで+${PICK_TOOL.percent}% (1回)`), msg.join('\n'));
});

test('1.7.0 木こりのオノ: 近くの山への地図のどの行き先にも効く', () => {
  const { g, dt } = fixture('wood');
  dt.item[AXE - 1] = 2;
  dt.exp[MAP_WOOD] = 1000;
  for (const u of BASE_ITEMS[MAP_WOOD].uses.filter((x) => x.exp && x.get.length)) {
    const r = useItemAction(g, dt, MAP_WOOD, u.no, { count: 1 });
    if (!r.result.count) continue;
    assert.ok(useResultMessages(g, dt, r).includes(`木こりのオノで+${AXE_TOOL.percent}% (1回)`), u.name ?? '');
  }
});
