// SOLD OUT for Muse — 素材の行き先の案内 (1.8.2、目安箱#12)。
// 分業が進むと、副産物 (山の地図の干し草・獣の革など) が使わない店の倉庫に積もり、使う店に届かない。
//   surplusItems   自分の本・道具では使わないのに倉庫の維持費がかさんでいる素材 (手引きのヒントに出す)
//   inWarehouses   材料が足りない作り方の材料で、棚にも市場にも無いが、ほかの店の倉庫にはあるもの (digest の1行)
// どちらも乱数を使わず、読むだけ。隠し品・購入不可 (nobuy) は出さない。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { isPublicItem } from '../data/catalog.js';
import type { Game } from './game.js';
import { orders } from './orders.js';
import { scaleUseMaterials } from './scripts.js';
import type { Shop } from './types.js';
import { loadUses } from './use.js';

/** 「使わない品」として出す、1品あたりの倉庫の維持費 (1日あたりの円) の下限 */
export const SURPLUS_COST_MIN = 3000;
/** ヒントに並べる最大の品数 */
export const SURPLUS_MAX = 2;
/** digest の「倉庫に持っている店がある」に並べる最大の品数 */
export const IN_WAREHOUSE_MAX = 3;

export interface Surplus {
  item: number;
  name: string;
  count: number;
  /** この品の倉庫の維持費 (1日あたり。棚に並べると1/10) */
  cost: number;
}

export interface InWarehouse {
  item: number;
  name: string;
  /** 作り方1回ぶん以上を倉庫に持っている、ほかの店の数 */
  shops: number;
}

/** 買える品か (隠し品・購入不可・無い品番を除く) */
function buyable(g: Game, no: number): boolean {
  return no >= 1 && no <= g.maxItem && isPublicItem(no) && !g.itemFlag(no, 'nobuy');
}

/** どこかの作り方で材料として使われる品 (道具の枠は除く)。品番 → 1回に使う最大の数 */
export function materialItems(g: Game): Map<number, number> {
  const out = new Map<number, number>();
  for (let no = 1; no <= g.maxItem; no++) {
    for (const u of g.items[no]?.uses ?? []) {
      for (const l of u.use) {
        if (!(l.count > 0) || !(l.proba > 0)) continue;
        out.set(l.item_no, Math.max(out.get(l.item_no) ?? 0, l.count));
      }
    }
  }
  return out;
}

/** 店が持っている本・道具の作り方に出てくる品 (材料・道具とも、熟練に関係なく) */
function ownUseItems(g: Game, dt: Shop): Set<number> {
  const out = new Set<number>();
  for (let tool = 1; tool <= g.maxItem; tool++) {
    if (!(dt.item[tool - 1] > 0)) continue;
    for (const u of g.items[tool]?.uses ?? []) for (const l of u.use) out.add(l.item_no);
  }
  return out;
}

/** 自分の募集・ほしい物リストの品 (欲しがっている品は「使わない」とは言わない) */
function wanted(g: Game, dt: Shop): Set<number> {
  const out = new Set<number>(dt.wish ?? []);
  for (const o of orders(g)) if (o.shop === dt.id && o.left > 0) out.add(o.item);
  return out;
}

/**
 * 自分の本・道具では使わないのに、倉庫の維持費が1日 SURPLUS_COST_MIN 以上かかっている素材。
 * ほかの作り方の材料になる品だけ (材料にならない完成品は、ふつうに棚で売るもの)。棚に並べている品・自分で使い道のある品 (本・地図・道具) は除く。
 * 維持費の多い順に SURPLUS_MAX 品まで
 */
export function surplusItems(g: Game, dt: Shop): Surplus[] {
  const materials = materialItems(g);
  const own = ownUseItems(g, dt);
  const want = wanted(g, dt);
  const shelved = new Set<number>();
  for (let k = 0; k < dt.showcasecount; k++) if (dt.showcase[k]) shelved.add(dt.showcase[k]);
  const out: Surplus[] = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const count = dt.item[no - 1] ?? 0;
    if (!(count > 0) || !materials.has(no) || own.has(no) || want.has(no) || shelved.has(no)) continue;
    const it = g.items[no];
    if (!isPublicItem(no) || it.uses?.length) continue;
    const cost = it.cost * count;
    if (cost < SURPLUS_COST_MIN) continue;
    out.push({ item: no, name: it.name, count, cost });
  }
  return out.sort((a, b) => b.cost - a.cost || a.item - b.item).slice(0, SURPLUS_MAX);
}

/** 手引きのヒントの文 */
export function surplusHintText(g: Game, list: Surplus[]): string {
  const what = list.map((x) => `${x.name}${x.count}${g.items[x.item].scale}`).join('・');
  const cost = list.reduce((a, x) => a + x.cost, 0);
  return `倉庫の${what}は、このお店の本や道具では使いません (倉庫の維持費が1日${Math.round(cost)})。棚に並べると維持費は1/10になり、材料に欲しい店が買っていきます。買い取り募集 (GET /api/v1/orders) に納品するのも手です。専門店にこだわる必要はありません`;
}

/**
 * 材料が足りない作り方の材料 (熟練が足りていて、一度でも使ったことのある本・道具だけ。onshelf.ts の B と同じ) と、ほしい物リストの品のうち、
 * ほかの店の棚にも市場にも無いが、ほかの店の倉庫に作り方1回ぶん以上あるもの。自分で募集を出している品は除く。
 * 持っている店の多い順に IN_WAREHOUSE_MAX 品まで (店名は出さない)
 */
export function inWarehouses(g: Game, dt: Shop): InWarehouse[] {
  const need = new Map<number, number>();
  for (const no of dt.wish ?? []) need.set(no, 1);
  for (let tool = 1; tool <= g.maxItem; tool++) {
    if (!(dt.item[tool - 1] > 0) || !g.items[tool]?.uses?.length) continue;
    for (const u of loadUses(g, tool)) {
      const exp = dt.exp[u.expno] ?? 0;
      if (!(exp > 0) || exp < u.needexp) continue;
      scaleUseMaterials(dt, u);
      for (const l of u.use) {
        if (!(l.count > 0) || !(l.proba > 0)) continue;
        if ((dt.item[l.no - 1] ?? 0) < l.count) need.set(l.no, Math.max(need.get(l.no) ?? 0, l.count));
      }
    }
  }
  if (!need.size) return [];
  const mine = new Set<number>();
  for (const o of orders(g)) if (o.shop === dt.id && o.left > 0) mine.add(o.item);
  const onShelves = new Set<number>();
  for (const s of g.shops) {
    if (s.id === dt.id) continue;
    for (let k = 0; k < s.showcasecount; k++) {
      const no = s.showcase[k];
      if (no && s.item[no - 1] > 0 && s.price[k] > 0) onShelves.add(no);
    }
  }
  const out: InWarehouse[] = [];
  for (const [no, n] of need) {
    if (!buyable(g, no) || mine.has(no) || onShelves.has(no) || (g.world.wholestore[no - 1] ?? 0) > 0) continue;
    let shops = 0;
    for (const s of g.shops) if (s.id !== dt.id && (s.item[no - 1] ?? 0) >= n) shops++;
    if (shops) out.push({ item: no, name: g.items[no].name, shops });
  }
  return out.sort((a, b) => b.shops - a.shops || a.item - b.item).slice(0, IN_WAREHOUSE_MAX);
}

/** digest の1行 (品と店数だけ。どの店かは出さない) */
export function inWarehouseLine(list: InWarehouse[]): string | null {
  if (!list.length) return null;
  const shown = list.map((x) => `${x.name}(${x.shops}店)`).join(' ');
  return `倉庫に持っている店がある ${shown} → 棚には出ていません。買い取り募集を出すと集まります {"type":"order","item":品番,"price":単価,"count":個数,"hours":24}`;
}
