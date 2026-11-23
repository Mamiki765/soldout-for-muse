// SOLD OUT for Muse — 13職の1決算ぶんの商いから商人ポイントの上限を試算する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DEFAULT_CONFIG } from '../../dist/src/config.js';
import { BASE_ITEMS, CATALOG, MAX_ITEM, itemNoByName } from '../../dist/src/data/catalog.js';
import { Game } from '../../dist/src/engine/game.js';
import { merchantBalanceFingerprint, MERCHANT_CAP_PER_PERIOD, MERCHANT_YEN_PER_POINT } from '../../dist/src/engine/merchant.js';
import { MERCHANT_JOB_MULTIPLIER } from '../../dist/src/engine/jobs.js';
import { newShop, newWorld } from '../../dist/src/engine/types.js';
import { checkUses, itemUseTime, loadUses } from '../../dist/src/engine/use.js';

const PEOPLE = 1_000_000;
const INPUT_PRICE_RATIO = 0.8;
const COW_COUNT = 20;
const DAY = 86_400;
const period = DEFAULT_CONFIG.oneDayTime;
const g = new Game(newWorld(1, MAX_ITEM), DEFAULT_CONFIG, { next: () => 0.5 }, 1);
const jobs = BASE_ITEMS[itemNoByName('転職のススメ')].uses.filter((u) => Number(u.params[0]) > 0 && u.params[3]);
const purchasePrice = (no) => Math.round(BASE_ITEMS[no].price * INPUT_PRICE_RATIO);

function outputs(u) {
  if (u.itemcode !== 'mino' || u.no > 2) {
    return u.result.create.map(({ no, count, proba, fraction }) => [no, (count + (fraction ?? 0) / 1000) * proba / 1000]);
  }
  const base = Number(u.params[0]);
  const expected = u.no === 2 ? (base + Number(u.params[1]) / 2) * COW_COUNT : (base * COW_COUNT + 1) / 2;
  return [[itemNoByName('ミノ牛乳'), expected]];
}

function purchaseCost(u, count) {
  let yen = u.use.reduce((sum, l) => sum + l.count * l.proba * purchasePrice(l.no) * count / 1000, 0);
  const func = u.result.function;
  if (func === 'lostbook' || func === 'lostbooktool') {
    yen += purchasePrice(u.itemno) * Number(u.params[0]) / 1000;
    if (func === 'lostbooktool') {
      const tool = Number(u.params[1]);
      if (tool) yen += purchasePrice(tool) * (1 - (1 - Number(u.params[2]) / 1000) ** count);
    }
  }
  if (u.itemcode === 'mino' && u.no <= 2) {
    const wear = u.no === 2 ? 1 : Number(u.params[0]) ** 2;
    yen += purchasePrice(u.itemno) * wear * count / 1000;
  }
  return Math.floor(yen);
}

function sell(outcomes, count) {
  return outcomes.map(([no, expected]) => {
    const item = BASE_ITEMS[no];
    // 標準価格で同程度の店がもう1店あると想定。turn の需要に、乱数の平均 (1/2) と自店の取り分 (1/3) を掛ける。
    const demand = item.popular ? PEOPLE * DEFAULT_CONFIG.saleSpeed * period / (DAY * item.popular * 6) : 0;
    const sold = Math.floor(Math.min(item.limit, demand, expected * count));
    return { no, sold, yen: sold * item.price };
  });
}

function runJob({ params }) {
  const [expno, , , job] = params;
  const dt = newShop(1, MAX_ITEM);
  dt.job = job;
  dt.exp[expno] = 1000;
  // 道具や材料を確保できたときの比較。乳牛だけは実際のシナリオの頭数にする。
  dt.item.fill(1_000_000);
  dt.item[itemNoByName('ミノタウロス♀') - 1] = COW_COUNT;
  const plans = BASE_ITEMS.filter((it) => (it.expitem ?? it.no) === Number(expno))
    .flatMap((it) => checkUses(g, dt, loadUses(g, it.no)))
    .filter((u) => u.useok && u.exp && itemUseTime(dt, u) > 0);
  let best;
  for (const u of plans) {
    const outcomes = outputs(u);
    if (!outcomes.length) continue;
    for (let count = 1; count <= Math.floor(period / itemUseTime(dt, u)); count++) {
      const sold = sell(outcomes, count);
      const sales = sold.reduce((total, l) => total + l.yen, 0);
      const purchases = purchaseCost(u, count);
      const beforeTax = sales - purchases - u.money * count;
      dt.profitstock = beforeTax;
      const taxRate = g.userTaxRate(dt);
      const tax = sold.reduce((total, l) => total + g.saleTax(l.no, l.sold, l.yen, taxRate)[1], 0);
      const profit = beforeTax - tax;
      const turnover = sales + purchases + tax;
      if (!best || profit > best.profit) best = { code: job, job: CATALOG.jobTypes[job], recipe: u.name, count, sales, purchases, tax, profit, turnover };
    }
  }
  if (!best) throw new Error(`${job}: 比較できる作り方がありません`);
  return best;
}

const results = jobs.map(runJob).sort((a, b) => a.profit - b.profit);
const weakest = results[0];
console.table(results.map(({ code, ...row }) => ({
  ...row,
  multiplier: MERCHANT_JOB_MULTIPLIER[code],
  credited: Math.min(MERCHANT_CAP_PER_PERIOD, Math.floor(row.turnover * MERCHANT_JOB_MULTIPLIER[code] / MERCHANT_YEN_PER_POINT)),
})));
console.log(`最も低い利益: ${weakest.job}、1決算の取引額 ${weakest.turnover.toLocaleString('ja-JP')}円`);
console.log(`この試算の最低利益の職で、補正前の点数: ${Math.floor(weakest.turnover / MERCHANT_YEN_PER_POINT)}点`);
console.log(`MERCHANT_CAP_PER_PERIOD=${MERCHANT_CAP_PER_PERIOD}`);
console.log(`MERCHANT_BALANCE_FINGERPRINT=${merchantBalanceFingerprint()}`);
