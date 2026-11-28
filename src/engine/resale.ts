// SOLD OUT for Muse — 1.10.0 素材の市場還流 (市場の「掘り出し物」)。目安箱の案。
// 客 (NPC) に売れた素材・地図で採れる品の一部 (resaleRate) を、市場のふつうの在庫とは別の「掘り出し物」の枠に戻す。
//   - 戻すのは、その品の市場在庫 (掘り出し物＋ふつう) が、卸値がちょうど標準価格になる量 (pricebase×k) より少ないときだけ。
//     市場に十分ある品 (自然に湧く品・鉱脈中の鉱石など) には戻さないので、値崩れも、客への転売で儲かるループも起きない
//   - 市場の上限 (wslimit×店数) は、ふつうの在庫と共通。入りきらない分は戻さない (rejected に数える)
//   - 掘り出し物の卸値は掘り出し物の在庫だけで計算し、その時点の plus が0以下の品には bargainPrice を掛ける
//   - 掘り出し物の枠は自然には増減しない (plus と無関係)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, isPublicItem } from '../data/catalog.js';
import type { Game } from './game.js';
import type { ResaleCount, ResaleState } from './types.js';
import type { WholeStoreCase } from './market.js';

/** 地図の品の分類 (item.type)。地図で採れる品は素材でなくても掘り出し物になる (石炭など) */
const MAP_TYPE = 9;

let eligibleCache: { items: unknown; set: Set<number> } | undefined;

/** 掘り出し物になる品: ほかの品の作り方の材料になる品か、地図で採れる品。道具・本・地図・隠し品・購入不可は除く */
export function resaleItems(g: Game): Set<number> {
  if (eligibleCache?.items === g.items) return eligibleCache.set;
  const set = new Set<number>();
  for (let no = 1; no <= g.maxItem; no++) {
    const it = g.items[no];
    if (!it?.code) continue;
    for (const u of it.uses ?? []) {
      for (const l of u.use) if (l.count > 0 && l.proba > 0 && l.item_no !== no) set.add(l.item_no);
      if (it.type === MAP_TYPE) for (const l of u.get) set.add(l.item_no);
    }
  }
  for (const no of [...set]) {
    const it = g.items[no];
    if (!it?.code || it.uses?.length || !isPublicItem(no) || g.itemFlag(no, 'nobuy') || !it.pricehalf) set.delete(no);
  }
  eligibleCache = { items: g.items, set };
  return set;
}

export function resaleState(g: Game): ResaleState {
  return (g.world.resale ??= { stock: {}, today: {}, yesterday: {} });
}

function count(rec: Record<number, ResaleCount>, no: number): ResaleCount {
  return (rec[no] ??= { made: 0, bought: 0, rejected: 0 });
}

export function resaleStock(g: Game, no: number): number {
  return g.world.resale?.stock[no] ?? 0;
}

/** 卸値がちょうど標準価格になる市場在庫 (pricebase×k)。これより少ないときだけ戻す */
export function resaleLine(g: Game, no: number): number {
  return g.items[no].pricebase * (g.marketUsers() / g.config.marketUserBase);
}

/** 市場の上限のうち、店の手持ち・募集の預かり・ふつうの在庫・掘り出し物を除いた空き */
function room(g: Game, no: number): number {
  const item = g.items[no];
  let held = 0;
  for (const dt of g.shops) held += dt.item[no - 1];
  for (const o of g.world.orders ?? []) if (o.item === no) held += o.count - o.left;
  const shopcount = g.shops.length || 1;
  const limitcount = item.wslimit < 0 ? -item.wslimit : Math.trunc(item.wslimit * shopcount + 0.99);
  return limitcount - held - (g.world.wholestore[no - 1] ?? 0) - resaleStock(g, no);
}

/** 客に sold 個売れたとき (turn.ts の売上処理から)。戻した数を返す */
export function addResale(g: Game, no: number, sold: number): number {
  if (!(sold > 0) || !(CATALOG.resaleRate > 0) || !resaleItems(g).has(no)) return 0;
  if ((g.world.wholestore[no - 1] ?? 0) + resaleStock(g, no) >= resaleLine(g, no)) return 0;
  let add = (sold * CATALOG.resaleRate) / 1000;
  if (add < 1 && add > 0) add = g.rand(1 / add) < 1 ? 1 : 0;
  add = Math.trunc(add);
  if (!add) return 0;
  const r = resaleState(g);
  const put = Math.max(0, Math.min(add, room(g, no)));
  if (put) r.stock[no] = (r.stock[no] ?? 0) + put;
  count(r.today, no).made += put;
  if (add > put) count(r.today, no).rejected += add - put;
  return put;
}

/** 市場の上限を超えた掘り出し物を削る (checkWholeStore のあと。ふつうの在庫が先) */
export function checkResale(g: Game): void {
  const r = g.world.resale;
  if (!r) return;
  for (const key of Object.keys(r.stock)) {
    const no = Number(key);
    const over = -room(g, no);
    if (over > 0) {
      r.stock[no] = Math.max(0, r.stock[no] - over);
      count(r.today, no).rejected += over;
    }
    if (!(r.stock[no] > 0)) delete r.stock[no];
  }
}

/** 市場で掘り出し物が買われた */
export function takeResale(g: Game, no: number, num: number): void {
  const r = resaleState(g);
  r.stock[no] = Math.max(0, (r.stock[no] ?? 0) - num);
  if (!r.stock[no]) delete r.stock[no];
  count(r.today, no).bought += num;
}

/** 決算: 今期の記録を前期へ */
export function closeResalePeriod(g: Game): void {
  const r = g.world.resale;
  if (!r) return;
  r.yesterday = r.today;
  r.today = {};
}

/** 掘り出し物の卸値。掘り出し物の在庫だけで、ふつうの卸値と同じ式。その時点の plus が0以下なら bargainPrice 倍 */
export function resalePrice(g: Game, no: number): number {
  const item = g.items[no];
  const stock = resaleStock(g, no);
  const k = g.marketUsers() / g.config.marketUserBase;
  let price = item.price;
  if (item.pricehalf) price = price / ((stock - item.pricebase * k) / (item.pricehalf * k) + 1);
  if (item.plus <= 0) price = (price * CATALOG.bargainPrice) / 1000;
  price = Math.trunc(price);
  if (price <= 0 && item.price) price = 1;
  return price;
}

/** 市場の掘り出し物の一覧 (在庫のある品だけ、市場と同じ並び) */
export function getResaleStore(g: Game): WholeStoreCase[] {
  const r = g.world.resale;
  if (!r) return [];
  const list = Object.keys(r.stock).map(Number).filter((no) => r.stock[no] > 0 && isPublicItem(no));
  list.sort((a, b) => g.items[a].sort - g.items[b].sort || a - b);
  return list.map((itemno) => ({ itemno, price: resalePrice(g, itemno), stock: r.stock[itemno] }));
}
