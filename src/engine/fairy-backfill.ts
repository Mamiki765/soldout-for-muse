// SOLD OUT for Muse — 1.4.0 より前の熟練と税の記録から、職・商人ポイントを控えめに試算して足す。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DEFAULT_CONFIG, type GameConfig } from '../config.js';
import { BASE_ITEMS, MAX_ITEM, isPublicItem, itemNoByName } from '../data/catalog.js';
import { Game, SALE_TAX_MAX_RATE } from './game.js';
import { joblvProgress } from './joblv.js';
import { MERCHANT_JOB_MULTIPLIER } from './jobs.js';
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
  /** 今の値に足す職ポイント (秒)。品番ごと */
  joblvpt?: Record<number, number>;
  /** 今の値に足す商人ポイント */
  merchantpt?: number;
}

/** 試算に使う保存の1枚 (今の街かバックアップ)。税は店主ごとの累計 (店idで引く) */
export interface FairyBackfillSnapshot {
  world: World;
  salesTax: (shopId: number) => bigint;
  depositTax: (shopId: number) => bigint;
}

function shopIdentity(dt: Shop): string {
  return JSON.stringify([dt.id, dt.foundation, dt.name]);
}

/** 1.4.0 の職ポイントがまだ付いていない (= この熟練は 1.4.0 より前の働きだけ) */
const beforeJoblv = (s: Shop) => s.joblvpt === undefined;
/** 1.4.0 の商人ポイントがまだ動いていない (= この時点の税の累計は 1.4.0 より前の商いだけ) */
const beforeMerchant = (s: Shop) => s.merchantpt === undefined && s.merchantYen === undefined;

function merchantMultiplier(job: string): number {
  return Object.hasOwn(MERCHANT_JOB_MULTIPLIER, job) ? MERCHANT_JOB_MULTIPLIER[job] : 1;
}

/**
 * 税の累計から商いの円を下から見積もる。売上税は税率の上限で戻した最小の売上＋税そのもの、入金庫税は1円1円。
 * 期ごとの税率が残っていないので、これより少なくなることはない。
 */
function yenFromTax(sales: bigint, deposit: bigint): bigint {
  const s = sales > 0n ? sales : 0n;
  const d = deposit > 0n ? deposit : 0n;
  return s * 100n / BigInt(SALE_TAX_MAX_RATE) + s + d;
}

function estimateMerchant(shop: Shop, views: { s: Shop; at: number; sales: bigint; deposit: bigint }[], config: GameConfig): number {
  if (!views.length || !Number.isSafeInteger(shop.foundation) || shop.foundation <= 0) return 0;
  const period = (at: number) => Math.floor((at + config.tzOffset - config.dateReviseTime) / config.oneDayTime);
  const latest = views.reduce((a, b) => (b.at > a.at ? b : a));
  const mult = merchantMultiplier(latest.s.job);
  const capPerPeriod = MERCHANT_CAP_PER_PERIOD * MERCHANT_YEN_PER_POINT;
  // 税の累計は増える一方なので、いちばん新しい1枚が最大。
  const taxYen = Math.max(...views.map((v) => Number(yenFromTax(v.sales, v.deposit))));
  // 保存に残っている前期・今期の売上と仕入れは、その期だけの実際の額。同じ期は大きい方だけ。
  const byPeriod = new Map<number, number>();
  for (const v of views) {
    const p = period(v.at);
    const lines: [number, number][] = [[p - 1, v.s.saleyesterday + v.s.payyesterday], [p, v.s.saletoday + v.s.paytoday]];
    for (const [q, yen] of lines) {
      if (q < period(shop.foundation) || !(yen > 0)) continue;
      byPeriod.set(q, Math.max(byPeriod.get(q) ?? 0, Math.min(capPerPeriod, yen * mult)));
    }
  }
  const periodYen = [...byPeriod.values()].reduce((a, b) => a + b, 0);
  const completed = Math.max(0, period(latest.at) - period(shop.foundation)) + (byPeriod.has(period(latest.at)) ? 1 : 0);
  // 2つは同じ期間の別の数え方なので足さずに大きい方。期の上限 2,000 点 × 期の数を超えない。
  const yen = Math.max(Math.min(taxYen * mult, completed * capPerPeriod), periodYen);
  return Math.floor(Math.min(yen, completed * capPerPeriod) / MERCHANT_YEN_PER_POINT);
}

/**
 * 1.4.0 より前の働きを、今の値に足す分として試算する。今の街とバックアップの中から、その店にまだ
 * 1.4.0 のポイントが付いていない時点だけを使う (1.4.0 で貯めた分と重ならない)。移し替え済みの店は外す。
 */
export function planFairyBackfill(current: FairyBackfillSnapshot, config = DEFAULT_CONFIG, backups: readonly FairyBackfillSnapshot[] = []): FairyBackfillRow[] {
  const pending = current.world.shops.filter((s) => s.fairyBackfilledAt === undefined);
  if (!pending.length) return [];
  const snapshots = [current, ...backups].map((snap) => ({
    snap,
    shops: new Map(snap.world.shops.map((s) => [shopIdentity(s), s])),
  }));
  let seconds: Record<number, number> | undefined;
  const rows: FairyBackfillRow[] = [];
  for (const s of pending) {
    const key = shopIdentity(s);
    const views = snapshots.flatMap(({ snap, shops }) => {
      const old = shops.get(key);
      return old ? [{ s: old, at: snap.world.lasttime, sales: snap.salesTax(old.id), deposit: snap.depositTax(old.id) }] : [];
    });
    const row: FairyBackfillRow = { id: s.id, shopname: s.shopname };
    const jobViews = views.filter((v) => beforeJoblv(v.s));
    if (jobViews.length) {
      seconds ??= fastestSkillSeconds(config);
      const pts: Record<number, number> = {};
      for (const [id, full] of Object.entries(seconds)) {
        const no = Number(id);
        const best = Math.min(FULL_SKILL, Math.max(0, ...jobViews.map((v) => v.s.exp[no] ?? 0)));
        const credited = Math.floor(best * full / FULL_SKILL);
        if (credited > 0) pts[no] = credited;
      }
      if (Object.keys(pts).length) row.joblvpt = pts;
    }
    const merchant = estimateMerchant(s, views.filter((v) => beforeMerchant(v.s)), config);
    if (merchant > 0) row.merchantpt = merchant;
    if (row.joblvpt || row.merchantpt) rows.push(row);
  }
  return rows;
}

/** 試算を今の値に足す (1店1回きり)。移したぶんは職レベル・商人レベルの決算通知に重ねない。 */
export function applyFairyBackfill(world: World, rows: readonly FairyBackfillRow[], at: number): number {
  const plans = new Map(rows.map((row) => [row.id, row]));
  let count = 0;
  for (const s of world.shops) {
    const row = plans.get(s.id);
    if (!row || s.fairyBackfilledAt !== undefined) continue;
    if (row.joblvpt) {
      const pts = s.joblvpt ??= {};
      const reached = s.joblvReached ??= {};
      for (const [id, add] of Object.entries(row.joblvpt)) {
        const no = Number(id);
        const before = joblvProgress(s, no).lv;
        pts[no] = (pts[no] ?? 0) + add;
        // 1.4.0 で上がってまだ知らせていない分は残し、移した分で上がった段だけ知らせ済みにする。
        if ((reached[no] ?? 0) >= before) reached[no] = joblvProgress(s, no).lv;
      }
    }
    if (row.merchantpt) s.merchantpt = (s.merchantpt ?? 0) + row.merchantpt;
    s.fairyBackfilledAt = at;
    s.fairyBackfillNotice = true;
    count++;
  }
  return count;
}
