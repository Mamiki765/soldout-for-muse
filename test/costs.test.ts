// 維持費の内訳 (SOLD OUT 目安箱 #5) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { CATALOG, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { costReportData, costReportText, itemCostLines, COST_REPORT_KEEP } from '../src/engine/costs.js';
import { Game } from '../src/engine/game.js';
import { createOrder, deliver } from '../src/engine/orders.js';
import { seededRng } from '../src/engine/rng.js';
import { turnProc } from '../src/engine/turn.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { jst } from '../src/api/views.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const HERB = itemNoByName('薬草');
const LEATHER = itemNoByName('獣の革');
const MILK = itemNoByName('ミノ牛乳');
const KIT = itemNoByName('解体/梱包キット');
const D = DEFAULT_CONFIG.oneDayTime;
const OFF = DEFAULT_CONFIG.tzOffset - DEFAULT_CONFIG.dateReviseTime;
/** T0 の後の最初の決算の時刻 */
const P1 = (Math.floor((T0 + OFF) / D) + 1) * D - OFF;

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g0, { name: 'ruri', shopname: '瑠璃のしおり堂' });
  const b = openShop(g0, { name: 'yama', shopname: '山師の店' });
  for (const s of [a, b]) {
    s.time = T0 - 48 * 3600;
    s.money = 10_000_000;
  }
  return { world, a, b };
}

function step(world: World, now: number, seed = 3): Game {
  const g = new Game(world, DEFAULT_CONFIG, seededRng(seed), now);
  turnProc(g);
  return g;
}

const shop = (world: World, id: number): Shop => world.shops.find((s) => s.id === id)!;

test('決算で引いた維持費と明細が一致し、途中の在庫の増減・陳列・預かり・道具を品物ごとに分ける', () => {
  const { world, a, b } = setup();
  const A = () => shop(world, a.id);
  A().item[HERB - 1] = 300;
  A().item[MILK - 1] = 40;
  A().item[KIT - 1] = 3;
  // 薬草を棚に (とても高い値段で、ほぼ売れない)。陳列中の品は在庫まるごと維持費1/10
  A().showcase[0] = HERB;
  A().price[0] = 99_999_999;
  shop(world, b.id).item[LEATHER - 1] = 500;
  // 獣の革の募集に200枚納品してもらう (受け取りは期限切れ時)
  const g1 = new Game(world, DEFAULT_CONFIG, seededRng(2), T0);
  const o = createOrder(g1, g1.shopById(a.id)!, { itemno: LEATHER, price: 100, count: 300, hours: 48 });
  deliver(g1, g1.shopById(b.id)!, a.id, [{ order: o.id, count: 200 }]);

  step(world, T0 + 3600);
  // 途中で牛乳を使い切り、薬草を足す (購入・使用の代わり)
  A().item[MILK - 1] = 0;
  A().item[HERB - 1] += 100;
  step(world, T0 + 5 * 3600);
  const g = step(world, P1 + 600); // 決算をまたぐ
  const dt = A();
  const r = dt.costreports![0];
  assert.ok(r, '明細が残る');
  assert.equal(r.at, P1);
  assert.equal(r.total, dt.costyesterday, '明細の合計 = 決算で引いた維持費');
  assert.equal(r.showcase, CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0);
  const sumLines = r.lines.reduce((s, l) => s + l[1] + l[2], 0);
  assert.equal(r.items, sumLines + r.untracked + r.adjust, '品物の維持費 = 品物別の和');
  assert.equal(r.untracked, 0, '新しい店は最初から記録');
  assert.equal(r.adjust, 0);
  assert.equal(r.total, r.showcase + r.items);
  assert.equal(dt.paytoday, r.total, '決算で支払に入れた額と同じ (決算の後に行動していない)');

  const line = (no: number) => r.lines.find((l) => l[0] === no);
  // 牛乳は最初の1時間だけ: 40 × 50/日 × 1h
  assert.ok(Math.abs(line(MILK)![1] - (40 * 50) / 24) <= 1, `${line(MILK)}`);
  // キットは道具 (分類10): 3 × 50/日 × 決算まで
  const hrs = (P1 - T0) / 3600;
  assert.ok(Math.abs(line(KIT)![1] - (3 * 50 * hrs) / 24) <= 1, `${line(KIT)}`);
  // 獣の革は預かり分: 200 × 30/日 × 決算まで
  assert.equal(line(LEATHER)![1], 0);
  assert.ok(Math.abs(line(LEATHER)![2] - (200 * 30 * hrs) / 24) <= 1, `${line(LEATHER)}`);
  // 薬草は陳列中: 払った額の9倍が「安くなった額」
  const herb = line(HERB)!;
  assert.ok(herb[3] > 0 && Math.abs(herb[3] - herb[1] * 9) <= 10, `${herb}`);

  // 表示: 分類別の和 = 品物の維持費の記録分、道具は別に出る
  const d = costReportData(g, g.shopById(a.id)!, 1);
  assert.equal(d.kind, 'settled');
  if (d.kind !== 'settled') return;
  assert.equal(d.by_type.reduce((s, c) => s + c.total, 0), d.stock + d.held);
  assert.equal(d.stock + d.held + d.untracked + d.adjust, d.items);
  assert.equal(d.tools, line(KIT)![1]);
  assert.equal(d.held, line(LEATHER)![2]);
  const text = costReportText(d, jst);
  assert.match(text, new RegExp(`合計 ￥${d.total} = 棚の維持費 ￥${d.showcase.cost}`));
  assert.match(text, /うち道具・キット/);
  assert.match(text, /募集の預かり ￥\d+/);
  assert.match(text, /入金庫の税 ￥\d+ \(維持費ではありません\)/);

  // 今期は決算の後の10分ぶんだけから始まる
  assert.equal(dt.costuntracked, undefined);
  const now = Object.values(dt.costitems!).reduce((s, x) => s + x[0] + x[1], 0);
  assert.ok(Math.abs(now - dt.costtoday) < 1e-6, `${now} ${dt.costtoday}`);
  assert.equal(dt.costitems![MILK], undefined, '使い切った品は今期に出ない');
});

test('古いデータ: 記録を始める前の今期の分は「記録開始前」として分け、品物に割り振らない', () => {
  const { world, a } = setup();
  const A = () => shop(world, a.id);
  A().item[MILK - 1] = 100;
  // 古い保存データの店 (内訳の欄が無く、今期の維持費がたまっている)
  delete A().costitems;
  A().costtoday = 1234.75;
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  // 区間を計算する前に見ると、全額が記録開始前
  const d0 = costReportData(g0, g0.shopById(a.id)!, 0);
  assert.equal(d0.kind, 'current');
  if (d0.kind === 'current') {
    assert.equal(d0.untracked, 1234);
    assert.equal(d0.lines.length, 0);
  }
  step(world, T0 + 2 * 3600);
  assert.equal(A().costuntracked, 1234.75);
  step(world, P1 + 60);
  const r = A().costreports![0];
  assert.equal(r.total, A().costyesterday);
  assert.ok(r.untracked === 1234 || r.untracked === 1235, `${r.untracked}`);
  assert.equal(r.items, r.lines.reduce((s, l) => s + l[1] + l[2], 0) + r.untracked + r.adjust);
  assert.equal(r.adjust, 0);
});

test('記録の無い決算は推測しない。明細は3期分まで残す', () => {
  const { world, a } = setup();
  const A = () => shop(world, a.id);
  A().costyesterday = 777; // 機能を入れる前の決算
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const none = costReportData(g0, g0.shopById(a.id)!, 1);
  assert.equal(none.kind, 'none');
  assert.match(costReportText(none, jst), /記録されていません.*合計￥777/);

  A().item[MILK - 1] = 10;
  for (let k = 1; k <= COST_REPORT_KEEP + 2; k++) step(world, P1 + (k - 1) * D + 60);
  const reps = A().costreports!;
  assert.equal(reps.length, COST_REPORT_KEEP);
  assert.equal(reps[0].at, P1 + (COST_REPORT_KEEP + 1) * D, '新しい順');
  assert.ok(reps[0].at > reps[1].at && reps[1].at > reps[2].at);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), P1 + 10 * D);
  assert.equal(costReportData(g, g.shopById(a.id)!, COST_REPORT_KEEP + 1).kind, 'none');
});

test('端数の配分: 品物別の円の和は、切り捨てた合計にちょうど合う', () => {
  const { world, a } = setup();
  const dt = shop(world, a.id);
  // 合計 5.2 → 5 円。切り捨てた和は 1+1+2 = 4 なので、端数 0.6 の2行のうち1行に1円配る
  dt.costitems = { 1: [1.6, 0, 0], 2: [1.6, 0, 0], 3: [0, 2.0, 0] };
  dt.costtoday = 1.6 + 1.6 + 2.0;
  const r = itemCostLines(dt);
  assert.equal(r.items, 5);
  assert.equal(r.lines.reduce((s, l) => s + l.stock + l.held, 0) + r.untracked + r.adjust, 5);
  assert.deepEqual(r.lines.map((l) => [l.item, l.stock, l.held]), [[1, 2, 0], [2, 1, 0], [3, 0, 2]], '同じ端数なら品番の小さいほう');
  // 浮動小数の誤差で累計の和が切り捨て後の合計を超えても、戻して合わせる
  dt.costitems = { 1: [2.0000000001, 0, 0], 2: [1, 0, 0] };
  dt.costtoday = 2.9999999999;
  const r2 = itemCostLines(dt);
  assert.equal(r2.items, 2);
  assert.equal(r2.lines.reduce((s, l) => s + l.stock + l.held, 0) + r2.adjust, 2);
  assert.equal(r2.adjust, 0);
});

test('API: GET /api/v1/costs (テキストと JSON、ago の範囲)', async () => {
  const { createServer } = await import('node:http');
  const { App } = await import('../src/api/app.js');
  const { sha256, Store } = await import('../src/store.js');
  let now = T0;
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock: () => now, publicUrl: 'https://so.example' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    let r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) });
    const { token } = (await r.json()) as { token: string };
    const auth = { authorization: 'Bearer ' + token };
    r = await fetch(base + '/api/v1/costs', { headers: auth });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /前期の維持費の内訳は記録されていません/);
    now = P1 + 3600;
    r = await fetch(base + '/api/v1/costs?format=json', { headers: auth });
    const j = (await r.json()) as { kind: string; total: number; showcase: { cost: number }; items: number };
    assert.equal(j.kind, 'settled');
    assert.equal(j.total, j.showcase.cost + j.items);
    r = await fetch(base + '/api/v1/costs?ago=0', { headers: auth });
    assert.match(await r.text(), /今期ここまで/);
    r = await fetch(base + '/api/v1/costs?ago=99&format=json', { headers: auth });
    assert.equal(((await r.json()) as { kind: string }).kind, 'none');
    r = await fetch(base + '/api/v1/me', { headers: auth });
    assert.match(await r.text(), /内訳 \/api\/v1\/costs/);
  } finally {
    server.close();
  }
});
