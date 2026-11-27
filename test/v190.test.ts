// SOLD OUT for Muse — 1.9.0 AI がはまる落とし穴の残り (転職の確認・上限を超える完成品・今何回できるか・前期の赤字) の決まりのテスト。
// 熟練・時間・上限の数字はデータの1か所だけに置き、ここでは「確かめるまで何も変わらない」「見込みと実際が同じ」などを確かめる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BASE_ITEMS, MAX_ITEM, itemNoByName } from '../src/data/catalog.js';
import { enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { jobChangePlan } from '../src/engine/scripts.js';
import { newWorld, type Shop } from '../src/engine/types.js';
import { checkUses, loadUses, runLimit, useItemAction, type RtUse } from '../src/engine/use.js';
import { digestData, itemDetailData } from '../src/api/views.js';
import { lastPeriodLossLine, periodEstimate, WATCH_RULES } from '../src/engine/watch.js';

const T0 = 1_800_000_000;
const JOB_CHANGE = itemNoByName('転職のススメ');

function fixture() {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g, { name: 'a', shopname: '試験商店A' });
  a.time = g.now - g.config.maxStockTime;
  a.money = 10_000_000;
  enterShop(g, a, true);
  return { g, a };
}

const isConfirm = (e: unknown) => e instanceof GameError && e.message.startsWith('確認:');
const snapshot = (dt: Shop) => JSON.stringify({ item: dt.item, exp: dt.exp, job: dt.job, time: dt.time, money: dt.money });

test('1.9.0: 転職は confirm が無ければ何も変えず、消える熟練と増える熟練を見せる。confirm で見込みどおりに変わる', () => {
  const { g, a } = fixture();
  const uses = loadUses(g, JOB_CHANGE);
  // 薬屋の熟練を持った店が、別の職へ転職する
  const from = uses[0];
  const to = uses.find((u) => Number(u.params[0]) !== Number(from.params[0]))!;
  const fromBook = Number(from.params[0]);
  const toBook = Number(to.params[0]);
  a.exp[fromBook] = 500;
  a.exp[toBook] = 100;
  a.item[JOB_CHANGE - 1] = 1;
  const before = snapshot(a);
  let msg = '';
  assert.throws(() => useItemAction(g, a, JOB_CHANGE, to.no, { count: 1 }), (e: unknown) => isConfirm(e) && ((msg = (e as Error).message), true));
  assert.equal(snapshot(a), before, '確認だけでは何も変わらない');
  assert.match(msg, new RegExp(`消える熟練: .*${BASE_ITEMS[fromBook].name}`));
  assert.match(msg, new RegExp(`増える熟練: ${BASE_ITEMS[toBook].name}`));
  assert.ok(!new RegExp(`消える熟練: [^。]*${BASE_ITEMS[toBook].name}`).test(msg), '転職先は「消える」に出さない');

  const plan = jobChangePlan(a, checkUses(g, a, loadUses(g, JOB_CHANGE)).find((u) => u.no === to.no)!);
  useItemAction(g, a, JOB_CHANGE, to.no, { count: 1, confirm: true });
  assert.equal(a.exp[fromBook] ?? 0, 0, '別の職の熟練は0になる');
  assert.equal(a.exp[toBook], plan.after, '確認で見せた値と実際の値が同じ');
  assert.ok(plan.after >= 100, '転職先の熟練は減らない');
  assert.equal(a.job, to.params[3]);
});

/** 確実に品ができて、スクリプトを使わず、熟練の要らない作り方を1つ探し、材料と道具を持たせる */
function sureRecipe(g: Game, dt: Shop): RtUse {
  for (let no = 1; no <= MAX_ITEM; no++) {
    for (const u of loadUses(g, no)) {
      if (u.result.function || u.needexp > 0 || u.money > 0) continue;
      if (!u.result.create.some((l) => l.proba >= 1000)) continue;
      dt.item[no - 1] = Math.max(1, dt.item[no - 1]);
      for (const l of u.use) dt.item[l.no - 1] = Math.max(dt.item[l.no - 1], l.count * 3);
      const ok = checkUses(g, dt, loadUses(g, no)).find((x) => x.no === u.no);
      if (ok?.useok) return ok;
    }
  }
  throw new Error('確実に品ができる作り方が見つかりません');
}

test('1.9.0: 確実にできる品だけで所持上限を超えるなら、confirm が無ければ材料も時間も使わない', () => {
  const { g, a } = fixture();
  const u = sureRecipe(g, a);
  const line = u.result.create.find((l) => l.proba >= 1000)!;
  const product = line.no;
  a.item[product - 1] = g.items[product].limit; // もう上限
  const before = snapshot(a);
  assert.throws(() => useItemAction(g, a, u.itemno, u.no, { count: 1 }), isConfirm);
  assert.equal(snapshot(a), before);
  // わざと作るときは confirm で続けられ、上限は超えない
  const r = useItemAction(g, a, u.itemno, u.no, { count: 1, confirm: true });
  assert.ok(r.result.count > 0);
  assert.ok(a.item[product - 1] <= g.items[product].limit);
});

test('1.9.0: 上限まで余裕があれば確認なしで作れる', () => {
  const { g, a } = fixture();
  const u = sureRecipe(g, a);
  const product = u.result.create.find((l) => l.proba >= 1000)!.no;
  a.item[product - 1] = 0;
  const r = useItemAction(g, a, u.itemno, u.no, { count: 1 });
  assert.ok(r.result.count > 0);
});

test('1.9.0: 「今何回できるか」は、その回数なら実行でき、usable でも持ち時間が無ければ0回と理由を返す', () => {
  const { g, a } = fixture();
  const u = sureRecipe(g, a);
  const product = u.result.create.find((l) => l.proba >= 1000)!.no;
  a.item[product - 1] = 0;
  const lim = runLimit(g, a, u);
  assert.ok(lim.max >= 1);
  // 商品詳細にも同じ回数が出る
  const d = itemDetailData(g, u.itemno, a);
  const row = d.uses.find((x) => x.use === u.no) as { usable?: boolean; max_count_now?: number | null };
  assert.equal(row.usable, true);
  assert.equal(row.max_count_now, lim.max);
  // 持ち時間を0に (クーポンも無い街で)
  const g2 = new Game(g.world, { ...DEFAULT_CONFIG, couponTime: 0 }, seededRng(1), T0);
  a.time = g2.now;
  enterShop(g2, a, true);
  const u2 = checkUses(g2, a, loadUses(g2, u.itemno)).find((x) => x.no === u.no)!;
  if (runLimit(g2, a, u2).max === Infinity) return; // 時間を使わない作り方なら確かめられない
  const row2 = itemDetailData(g2, u.itemno, a).uses.find((x) => x.use === u.no) as { usable?: boolean; max_count_now?: number | null; why_now?: string };
  assert.equal(row2.usable, true, 'usable は道具・材料・熟練だけの条件');
  assert.equal(row2.max_count_now, 0);
  assert.match(row2.why_now ?? '', /持ち時間が足りません \(1回/);
  const r = useItemAction(g2, a, u.itemno, u.no, { count: 1 });
  assert.equal(r.result.count, 0);
  assert.match(r.result.failReason ?? '', /持ち時間が足りません \(1回/);
});

test('1.9.0: 決算が近く、前期に維持費が売上を上回った店だけに、前期の売上と維持費を出す', () => {
  const { g, a } = fixture();
  const next = periodEstimate(g, a).next_period;
  a.costreports = [{ at: next - g.config.oneDayTime, total: 300, showcase: 100, showcasecount: 1, items: 200, untracked: 0, adjust: 0, lines: [], tax: 0 }];
  a.saleyesterday = 299;
  assert.match(lastPeriodLossLine(g, a, next), /前期は売上/);
  a.saleyesterday = 300;
  assert.equal(lastPeriodLossLine(g, a, next), '', '売上が維持費以上なら出さない');
  // 古い明細 (前の前の決算) では出さない
  a.saleyesterday = 0;
  a.costreports[0].at = next - 3 * g.config.oneDayTime;
  assert.equal(lastPeriodLossLine(g, a, next), '');
  // digest には決算が近いときだけ出る
  a.costreports[0].at = next - g.config.oneDayTime;
  const far = new Game(g.world, DEFAULT_CONFIG, seededRng(1), next - WATCH_RULES.periodSoon - 3600);
  const near = new Game(g.world, DEFAULT_CONFIG, seededRng(1), next - 60);
  const N0 = { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 };
  assert.ok(!digestData(far, a, N0).warnings.some((w: string) => w.startsWith('前期は売上')));
  assert.ok(digestData(near, a, N0).warnings.some((w: string) => w.startsWith('前期は売上')));
});
