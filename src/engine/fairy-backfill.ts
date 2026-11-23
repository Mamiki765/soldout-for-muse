// SOLD OUT for Muse — 保存済みの熟練と売上税から、職・商人ポイントを控えめに試算する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DEFAULT_CONFIG, type GameConfig } from '../config.js';
import { BASE_ITEMS, MAX_ITEM, isPublicItem, itemNoByName } from '../data/catalog.js';
import { Game, SALE_TAX_MAX_RATE } from './game.js';
import { joblvProgress } from './joblv.js';
import { MERCHANT_CAP_PER_PERIOD, MERCHANT_YEN_PER_POINT } from './merchant.js';
import { newShop, newWorld, type Shop, type World } from './types.js';
import { checkUses, itemUseTime, loadUses, type RtUse } from './use.js';

const FULL_SKILL = 1000;

function skillSeconds(g: Game, dt: Shop, no: number, choices: RtUse[]): number {
  dt.exp[no] = FULL_SKILL;
  const uses = checkUses(g, dt, structuredClone(choices)).filter((u) => u.useok && u.exp > 0);
  const shortest = Array<number>(FULL_SKILL + 1).fill(Infinity);
  shortest[0] = 0;
  for (let exp = 0; exp < FULL_SKILL; exp++) {
    if (!Number.isFinite(shortest[exp])) continue;
    dt.exp[no] = exp;
    for (const u of uses) {
      if (exp < u.needexp) continue;
      const seconds = itemUseTime(dt, u);
      if (seconds <= 0) continue;
      const gain = Math.min(FULL_SKILL, exp + u.exp);
      shortest[gain] = Math.min(shortest[gain], shortest[exp] + seconds);
    }
  }
  return shortest[FULL_SKILL];
}

/** 品番ごとの、熟練0→100%を最も短い手順で上げる作業秒数。材料の調達や決算の減衰は省く。 */
export function fastestSkillSeconds(config = DEFAULT_CONFIG): Record<number, number> {
  const g = new Game(newWorld(1, MAX_ITEM), config, { next: () => 0.5 }, 1);
  const chosenJobs = new Map(BASE_ITEMS[itemNoByName('転職のススメ')].uses
    .filter((u) => Number(u.params[0]) > 0 && u.params[3])
    .map((u) => [Number(u.params[0]), u.params[3]!]));
  const recipes = new Map<number, RtUse[]>();
  for (const it of BASE_ITEMS) {
    if (!it || !isPublicItem(it.no)) continue;
    for (const u of loadUses(g, it.no)) {
      if (!isPublicItem(u.expno) || u.exp <= 0) continue;
      const list = recipes.get(u.expno) ?? [];
      list.push(u);
      recipes.set(u.expno, list);
    }
  }
  const dt = newShop(0, MAX_ITEM);
  dt.item.fill(1000);
  const totals: Record<number, number> = {};
  for (const [no, choices] of recipes) {
    // 専門のない品にも職ボーナスがある。職を固定したまま育てる場合の最短だけを採用する。
    const jobs = new Set(['', chosenJobs.get(no) ?? '', ...choices.flatMap((u) => u.def.jobs.map((j) => j.job))]);
    const fastest = Math.min(...[...jobs].map((job) => {
      dt.job = job;
      return skillSeconds(g, dt, no, choices);
    }));
    if (Number.isFinite(fastest)) totals[no] = fastest;
  }
  return totals;
}

export interface FairyBackfillRow {
  id: number;
  shopname: string;
  joblvpt?: Record<number, number>;
  merchantpt?: number;
}

function shopIdentity(dt: Shop): string {
  return JSON.stringify([dt.id, dt.foundation, dt.name]);
}

/** 期ごとの税率が残っていないため、上限税率で戻した最小側の売上を使う。 */
function estimateMerchant(shop: Shop, tax: bigint, asOf: number, config: GameConfig): number {
  if (tax <= 0n || !Number.isSafeInteger(shop.foundation) || shop.foundation <= 0) return 0;
  const period = (at: number) => Math.floor((at + config.tzOffset - config.dateReviseTime) / config.oneDayTime);
  const completed = Math.max(0, period(asOf) - period(shop.foundation));
  const cap = BigInt(completed) * BigInt(MERCHANT_CAP_PER_PERIOD);
  const fromTax = tax * 100n / BigInt(SALE_TAX_MAX_RATE * MERCHANT_YEN_PER_POINT);
  return Number(fromTax < cap ? fromTax : cap);
}

export function planFairyBackfill(world: World, salesTax: (shopId: number) => bigint, config = DEFAULT_CONFIG, backups: readonly World[] = []): FairyBackfillRow[] {
  const pending = world.shops.filter((s) => s.joblvpt === undefined || s.merchantpt === undefined);
  if (!pending.length) return [];
  const seconds = pending.some((s) => s.joblvpt === undefined) ? fastestSkillSeconds(config) : {};
  const archives = backups.map((backup) => new Map(backup.shops.map((s) => [shopIdentity(s), s.exp])));
  return pending.map((s) => {
    const row: FairyBackfillRow = { id: s.id, shopname: s.shopname };
    if (s.joblvpt === undefined) {
      const key = shopIdentity(s);
      row.joblvpt = {};
      for (const [id, full] of Object.entries(seconds)) {
        const no = Number(id);
        const best = Math.min(FULL_SKILL, Math.max(0, s.exp[no] ?? 0, ...archives.map((a) => a.get(key)?.[no] ?? 0)));
        const credited = Math.floor(best * full / FULL_SKILL);
        if (credited > 0) row.joblvpt[no] = credited;
      }
    }
    if (s.merchantpt === undefined) row.merchantpt = estimateMerchant(s, salesTax(s.id), world.lasttime, config);
    return row;
  });
}

/** 試算を欠けている欄だけに反映し、職レベルの決算通知には移したぶんを重ねない。 */
export function applyFairyBackfill(world: World, rows: readonly FairyBackfillRow[]): number {
  const plans = new Map(rows.map((row) => [row.id, row]));
  let count = 0;
  for (const s of world.shops) {
    const row = plans.get(s.id);
    if (!row) continue;
    const joblv = s.joblvpt === undefined && row.joblvpt !== undefined;
    const merchant = s.merchantpt === undefined && row.merchantpt !== undefined;
    if (!joblv && !merchant) continue;
    if (joblv) {
      s.joblvpt = row.joblvpt;
      s.joblvReached = Object.fromEntries(Object.keys(s.joblvpt!).map(Number).map((no) => [no, joblvProgress(s, no).lv]));
    }
    if (merchant) s.merchantpt = row.merchantpt;
    s.fairyBackfillNotice = true;
    count++;
  }
  return count;
}
