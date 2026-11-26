// SOLD OUT for Muse — 1.7.0 人口の見張り (72時間モブ売上ゼロの営業店率)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { idleShopLine, idleShopStat, IDLE_SALE_SECS } from '../src/engine/townwatch.js';
import { turnProc } from '../src/engine/turn.js';
import { newWorld } from '../src/engine/types.js';

const T0 = 1_800_000_000;
const H = 3600;

test('1.7.0 人口の見張り: 改装中と開店72時間以内の店は数えず、72時間モブに売れていない店の割合を出す', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((n) => openShop(g0, { name: n, shopname: n + 'のお店' }));
  for (const s of [a, b, c, d, e]) s.foundation = T0 - 10 * 24 * H;
  const now = T0 + 100 * H;
  world.mobsaleSince = T0;
  a.lastmobsale = now - 1 * H; // 売れている
  b.lastmobsale = now - IDLE_SALE_SECS - 1; // 72時間を少し超えた
  // c はまだ記録なし (止まっている)
  d.rest = { from: now - H, until: now + 24 * H } as never; // 改装中は数えない
  e.foundation = now - 10 * H; // 開店したての店は数えない
  const g = new Game(world, DEFAULT_CONFIG, seededRng(2), now);
  const s = idleShopStat(g);
  assert.deepEqual(s, { open: 3, idle: 2, rate: 2 / 3, ready: true });
  assert.equal(idleShopLine(s), '人口の見張り: 72時間モブ売上ゼロの営業店 2/3店 (66.7%) 30%超え。止まっている店を自然減に数えない案 (P1) を考える目安です');
  // 記録を始めて72時間たつまでは ready でない
  world.mobsaleSince = now - 10 * H;
  assert.equal(idleShopStat(g).ready, false);
});

test('1.7.0 人口の見張り: モブに売れたら lastmobsale が残り、記録を始めた時刻も入る', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const s = openShop(g0, { name: 'a', shopname: '見張りの店' });
  s.item[30 - 1] = 1000;
  s.showcase[0] = 30;
  s.price[0] = 1;
  s.rank = 5000;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(3), T0 + 6 * H);
  turnProc(g);
  assert.equal(world.mobsaleSince !== undefined, true);
  assert.equal(world.shops[0].lastmobsale !== undefined, true, '安いポーションは売れる');
});

test('1.7.0 人口の見張り: 何日ぶんかまとめて計算しても、売れた区切りの時刻で残す (最後の計算の時刻にしない)', () => {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const s = openShop(g0, { name: 'a', shopname: '見張りの店' });
  s.item[30 - 1] = 1; // ポーション1本だけ。最初の区切りで売り切れる
  s.showcase[0] = 30;
  s.price[0] = 1;
  s.rank = 5000;
  const now = T0 + 5 * 24 * H;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(3), now);
  turnProc(g);
  const at = world.shops[0].lastmobsale!;
  assert.ok(at !== undefined && at < now - 3 * 24 * H, `最初の区切りで売れた時刻 ${at - T0}`);
});
