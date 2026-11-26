// SOLD OUT for Muse — 1.7.0 ほしい物リスト (リカさん案 2026-11-26)。
// 店が品を登録するだけの軽いリスト (お金は預けない・数の上限なし・時間もかからない)。
// 採る側には「ほしい物リスト: 薬草 5店 (うち募集中 2店)」と店の数だけを見せ、誰が登録したかは見せない。
// 作る側には、登録した品がほかの店の棚・市場に出たら digest の「他店の棚に」の1行で知らせる (engine/onshelf.ts)。
import { isPublicItem } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import { deliverableOrders, thanksHint } from './orders.js';
import type { Shop } from './types.js';

/** ほしい物リスト (品番順) */
export function wishList(dt: Shop): number[] {
  return [...(dt.wish ?? [])].sort((a, b) => a - b);
}

function listText(g: Game, dt: Shop): string {
  const list = wishList(dt);
  return list.length ? `ほしい物リスト (${list.length}品): ${list.map((no) => g.items[no].name).join(' / ')}` : 'ほしい物リストは空です';
}

/** 足す (remove なら外す)。itemno 0 なら今のリストを返すだけ */
export function editWish(g: Game, dt: Shop, itemno: number, remove: boolean): string {
  if (!itemno) return listText(g, dt);
  if (!(itemno >= 1 && itemno <= g.maxItem) || !g.items[itemno] || !isPublicItem(itemno)) throw new GameError('そんなアイテムはないです。');
  const set = new Set(dt.wish ?? []);
  const name = g.items[itemno].name;
  let head: string;
  if (remove) {
    head = set.delete(itemno) ? `ほしい物リストから${name}を外しました` : `${name}はほしい物リストにありません`;
  } else {
    head = set.has(itemno) ? `${name}はもうほしい物リストにあります` : `ほしい物リストに${name}を足しました`;
    set.add(itemno);
  }
  if (set.size) dt.wish = [...set].sort((a, b) => a - b);
  else delete dt.wish;
  return `${head}。${listText(g, dt)}`;
}

export interface WishedItem {
  item: number;
  name: string;
  /** 欲しがっている店 (ほしい物リストに入れた店と、今納品できる募集を出している店。自分は除く) */
  shops: number;
  /** そのうち今納品できる募集を出している店 */
  ordering: number;
  /** 募集のいちばん高い単価 (募集がなければ 0) */
  price: number;
}

/** 自分の在庫 (items を渡せばその品だけ) をほかの店がどれだけ欲しがっているか。品番順 */
export function wishedFor(g: Game, dt: Shop, items: Iterable<number>): WishedItem[] {
  const only = new Set(items);
  const want = new Map<number, Set<number>>();
  const ord = new Map<number, { shops: Set<number>; price: number }>();
  for (const s of g.shops) {
    if (s.id === dt.id) continue;
    for (const no of s.wish ?? []) {
      if (!only.has(no)) continue;
      if (!want.has(no)) want.set(no, new Set());
      want.get(no)!.add(s.id);
    }
  }
  for (const o of deliverableOrders(g, dt, only)) {
    if (!want.has(o.item)) want.set(o.item, new Set());
    want.get(o.item)!.add(o.shop);
    const cur = ord.get(o.item) ?? { shops: new Set<number>(), price: 0 };
    cur.shops.add(o.shop);
    cur.price = Math.max(cur.price, o.price);
    ord.set(o.item, cur);
  }
  return [...want.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, shops]) => ({ item: no, name: g.items[no].name, shops: shops.size, ordering: ord.get(no)?.shops.size ?? 0, price: ord.get(no)?.price ?? 0 }));
}

/** 採取・生産から戻ったときの1行 (できた品を欲しがっている店があるときだけ)。1.7.0 の「募集中:」の行はこれにまとめた */
export function wishedLine(g: Game, dt: Shop, list: WishedItem[]): string | null {
  if (!list.length) return null;
  const parts = list.map((w) => `${w.name} ${w.shops}店` + (w.ordering ? ` (うち募集中 ${w.ordering}店・最高￥${w.price})` : ''));
  const anyOrder = list.some((w) => w.ordering);
  return `ほしい物リスト: ${parts.join(' / ')}` + (anyOrder ? ` → 募集は GET /api/v1/orders?item=品番 を見て deliver で納品できます${thanksHint(g, dt)}` : ' → 棚に並べると売れるかもしれません');
}
