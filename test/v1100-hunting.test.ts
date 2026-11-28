// SOLD OUT for Muse — 1.10.0 狩り場 (近くの山への地図の、獣の革の行き先)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { useItemAction } from '../src/engine/use.js';

const T0 = 1_800_000_000;
const MT_MAP = 12;
const LEATHER = 2;
const HAY = 115;
const uses = BASE_ITEMS[MT_MAP].uses;
const hunt = uses.find((u) => u.name === '狩り場で獣を狩る')!;
const pasture = uses.find((u) => u.name === '牧草地で草を刈る')!;

function fixture(job: string) {
  const g = new Game(newWorld(T0, MAX_ITEM), { ...DEFAULT_CONFIG, couponTime: 0 }, { next: () => 0.1 }, T0);
  const dt = openShop(g, { name: 'test', shopname: '試験商店' });
  dt.job = job;
  dt.time = T0 - 48 * 3600;
  enterShop(g, dt, true);
  return { g, dt };
}

/** 熟練100%・職ボーナスありの、標準価格での1時間あたりの値打ち */
const perHour = (u: typeof hunt) =>
  u.get.reduce((s, l) => s + l.count * l.proba / 1000 * BASE_ITEMS[l.item_no].price, 0) / (u.exptime / 2);

test('狩り場は熟練なし・材料なしで行け、いちばん多く採れるのは獣の革で、干し草は採れない', () => {
  assert.ok(hunt, '近くの山への地図にある');
  assert.ok(!hunt.needexp);
  assert.deepEqual(hunt.use, []);
  assert.ok(!hunt.get.some((l) => l.item_no === HAY), '干し草は値崩れ中なので付けない');
  const most = hunt.get.reduce((a, b) => (b.count * b.proba > a.count * a.proba ? b : a));
  assert.equal(most.item_no, LEATHER);
});

test('狩り場は獣道より革がたくさん採れる', () => {
  const leather = (u: typeof hunt) => u.get.filter((l) => l.item_no === LEATHER).reduce((s, l) => s + l.count * l.proba, 0);
  assert.ok(leather(hunt) > leather(uses.find((u) => u.name === '獣道を探索')!));
});

test('狩り場の時間・地図の傷み・職ボーナスは牧草地と同じ', () => {
  assert.deepEqual([hunt.time, hunt.exptime, hunt.exp, hunt.func, hunt.params, hunt.jobs], [pasture.time, pasture.exptime, pasture.exp, pasture.func, pasture.params, pasture.jobs]);
});

// 木こりのいちばん稼げる行き先は変えない (狩り場は熟練の要る行き先より下に置く)
test('狩り場は木こりのいちばん稼げる行き先を超えない', () => {
  const others = uses.filter((u) => u !== hunt).map(perHour);
  assert.ok(perHour(hunt) < Math.max(...others));
});

test('狩り場で革が採れ、探鉱夫・木こりは時間が半分、在庫は負にならない', () => {
  const spent = (job: string) => {
    const { g, dt } = fixture(job);
    dt.item[MT_MAP - 1] = 1;
    const before = dt.time;
    useItemAction(g, dt, MT_MAP, hunt.no, { count: 1 });
    assert.ok(dt.item[LEATHER - 1] > 0, job);
    assert.ok(dt.item.every((n) => n >= 0), job);
    assert.ok(dt.item[LEATHER - 1] <= BASE_ITEMS[LEATHER].limit, job);
    return dt.time - before;
  };
  assert.equal(spent('wood') * 2, spent('book'));
  assert.equal(spent('mine') * 2, spent('book'));
});
