// SOLD OUT for Muse — 値動きの記録 (原作にない追加。0.6.0)。
// 目安箱 Party ID 6「今の価格しか分からず、値上がり中か値下がり中か分からない」への対応。
// - 今期ここまでの相場・市場の単価の最安・最高を、時間を計算したときと行動を保存するときに比べて更新する (定期の見回りはしない)
// - 決算のとき、品ごとに1行 (決算時点の値・期中の最安/最高・街全体の売れ数など) を作り、保存側が market_history に書く
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { isPublicItem } from '../data/catalog.js';
import type { Game } from './game.js';
import { getMarketStatus, getWholeStore } from './market.js';

/** 何期ぶん残すか (約34日) */
export const PRICE_HISTORY_KEEP = 30;

/** 決算1回・1品ぶんの記録 */
export interface PeriodPriceRow {
  /** 決算の時刻 */
  at: number;
  item: number;
  /** 決算時点の相場 (棚の値段を在庫で重みづけした平均。並んでいなければ 0) */
  market: number;
  /** 期中に見た相場の最安・最高 (並んでいなかったら 0) */
  market_lo: number;
  market_hi: number;
  /** 決算時点の棚の最安・最高の値段 */
  shelf_lo: number;
  shelf_hi: number;
  /** 決算時点で並べていた店の数 */
  shops: number;
  /** 決算時点の市場の単価 (市場に在庫が無ければ 0) */
  whole: number;
  whole_lo: number;
  whole_hi: number;
  /** 決算時点の市場の在庫 */
  whole_stock: number;
  /** その期に街全体で売れた数 (全店の今期売上数の合計) */
  sold: number;
  /** 決算時点の標準価格 (価格高騰のイベント中はその値) */
  std: number;
  /** 決算時点の需給 (110以上で飽和・90以下で不足。並んでいなければ 0) */
  balance: number;
}

/** 今の市場の単価 (品番 → 単価)。市場に在庫がある品だけ */
function wholePrices(g: Game): Map<number, { price: number; stock: number }> {
  return new Map(getWholeStore(g).map((c) => [c.itemno, { price: c.price, stock: c.stock }]));
}

/**
 * 今の相場と市場の単価を、今期ここまでの最安・最高と比べて更新する。
 * 時間計算のあと (turnProc の終わり) と、行動を保存する前に呼ぶ。読むだけの処理 (peek・GET) からは呼ばない。
 */
export function observePrices(g: Game): void {
  getMarketStatus(g);
  const whole = wholePrices(g);
  const w = g.world;
  if (!w.mstat) w.mstat = { since: g.now, items: {} };
  const items = w.mstat.items;
  for (let no = 1; no <= g.maxItem; no++) {
    const it = g.items[no];
    if (!it?.code || !isPublicItem(no)) continue;
    const m = it.marketprice;
    const p = whole.get(no)?.price ?? 0;
    if (!m && !p) continue;
    const e = (items[no] ??= [0, 0, 0, 0]);
    if (m) {
      if (!e[0] || m < e[0]) e[0] = m;
      if (m > e[1]) e[1] = m;
    }
    if (p) {
      if (!e[2] || p < e[2]) e[2] = p;
      if (p > e[3]) e[3] = p;
    }
  }
}

/**
 * 決算の頭で呼ぶ (店の今期売上数が前期へ移る前)。街全体の今期の売れ数だけ数えておく。
 * 1行にするのは、同じ区間の市場在庫の増減が済んでから (closePeriodPrices)
 */
export function collectPeriodSales(g: Game, at: number): void {
  const sold = new Map<number, number>();
  for (const dt of g.shops) {
    for (const [k, v] of Object.entries(dt.itemtoday)) sold.set(Number(k), (sold.get(Number(k)) ?? 0) + v);
  }
  // 今期の途中で改装中に入った店が、それまでに売った分 (1.1.0)
  for (const [k, v] of Object.entries(g.world.restsold ?? {})) sold.set(Number(k), (sold.get(Number(k)) ?? 0) + v);
  delete g.world.restsold;
  g.pendingPrices = { at, sold };
}

/**
 * turnProc で、決算をした区間の市場在庫の増減が済んだあとに呼ぶ。品ごとの1行を g.newPriceRows に足し、今期の最安・最高を空にする。
 * 棚にも市場にも無く、売れてもいない品は書かない。決算が無かった区間では何もしない。
 */
export function closePeriodPrices(g: Game): void {
  const pending = g.pendingPrices;
  if (!pending) return;
  g.pendingPrices = undefined;
  const { at, sold } = pending;
  observePrices(g);
  const whole = wholePrices(g);
  const items = g.world.mstat?.items ?? {};
  for (let no = 1; no <= g.maxItem; no++) {
    const it = g.items[no];
    if (!it?.code || !isPublicItem(no)) continue;
    const e = items[no];
    const wh = whole.get(no);
    const s = sold.get(no) ?? 0;
    if (!e && !it.marketprice && !wh && !s) continue;
    g.newPriceRows.push({
      at,
      item: no,
      market: it.marketprice,
      market_lo: e?.[0] ?? 0,
      market_hi: e?.[1] ?? 0,
      shelf_lo: it.marketprice ? it.marketpricelow : 0,
      shelf_hi: it.marketprice ? it.marketpricehigh : 0,
      shops: it.listshops,
      whole: wh?.price ?? 0,
      whole_lo: e?.[2] ?? 0,
      whole_hi: e?.[3] ?? 0,
      whole_stock: g.world.wholestore[no - 1] ?? 0,
      sold: s,
      std: it.price,
      balance: it.marketprice ? it.uppoint : 0,
    });
  }
  // 次の期は決算のときの値から始める (1回のアクセスで決算を2回以上またいでも、各期の最安・最高に始まりの値が入るように)
  g.world.mstat = { since: at, items: {} };
  observePrices(g);
}

/** 前と比べて何%動いたか (どちらかが 0 なら null) */
export function changePct(now: number, prev: number): number | null {
  if (!now || !prev) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/** '+12%' '-5%' '±0%'。null は '-' */
export function pctWord(p: number | null): string {
  if (p === null) return '-';
  return p > 0 ? `+${p}%` : p < 0 ? `${p}%` : '±0%';
}
