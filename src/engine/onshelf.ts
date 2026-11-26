// 「欲しい品がほかの店の棚にある」の照合 (digest の1行と、見張り peek の on_shelf)。
// 欲しい品は2種類 (案: ミュートと合意 2026-11-18):
//   A (order)  自分の買い取り募集の品。最安の棚の単価が募集の単価以下のときだけ
//   W (wish)   ほしい物リストの品 (1.7.0)。ほかの店の棚のほか、市場に在庫があるときも (market)
//   B (recipe) 倉庫にある本・地図などの使い方のうち、熟練は足りていて材料だけ足りないものの材料。
//              一度でも使ったことのある道具 (熟練 > 0) に限る (使ったことのない本まで入れるとうるさい)
// 隠し品・購入不可 (nobuy)・自分の店は除く。乱数は使わず、読むだけ (peek からも呼ぶ)。
import { isPublicItem } from '../data/catalog.js';
import type { Game } from './game.js';
import { orders } from './orders.js';
import type { Shop } from './types.js';
import { scaleUseMaterials } from './scripts.js';
import { loadUses } from './use.js';

export interface OnShelf {
  item: number;
  name: string;
  /** その品を棚に並べている店の数 (在庫 > 0) */
  shops: number;
  /** いちばん安い棚の単価と店 */
  cheapest: number;
  shop: number;
  why: 'order' | 'wish' | 'recipe';
  /** 市場にも在庫がある (ほしい物リストの品だけ見る。1.7.0) */
  market?: boolean;
}

/** 他店の棚を品番ごとにまとめる (在庫のある棚だけ、品ごとに店数と最安) */
function shelfIndex(g: Game, dt: Shop): Map<number, { shops: number; cheapest: number; shop: number }> {
  const idx = new Map<number, { shops: number; cheapest: number; shop: number }>();
  for (const s of g.shops) {
    if (s.id === dt.id) continue;
    const seen = new Set<number>();
    for (let i = 0; i < s.showcasecount; i++) {
      const no = s.showcase[i];
      const price = s.price[i];
      if (!no || !(s.item[no - 1] > 0) || !(price > 0)) continue;
      const cur = idx.get(no);
      if (!cur) idx.set(no, { shops: 1, cheapest: price, shop: s.id });
      else {
        if (!seen.has(no)) cur.shops++;
        if (price < cur.cheapest) {
          cur.cheapest = price;
          cur.shop = s.id;
        }
      }
      seen.add(no);
    }
  }
  return idx;
}

/** 買える品か (隠し品・購入不可・無い品番を除く) */
function buyable(g: Game, no: number): boolean {
  return no >= 1 && no <= g.maxItem && isPublicItem(no) && !g.itemFlag(no, 'nobuy');
}

/** 欲しい品のうち、ほかの店の棚にあるもの。A (募集) を先、B (材料) を後、それぞれ品番順 */
export function onShelf(g: Game, dt: Shop, now?: number): OnShelf[] {
  const idx = shelfIndex(g, dt);
  if (!idx.size && !dt.wish?.length) return [];
  const out = new Map<number, OnShelf>();
  const put = (no: number, why: OnShelf['why']) => {
    const hit = idx.get(no);
    if (!hit || out.has(no)) return;
    out.set(no, { item: no, name: g.items[no].name, shops: hit.shops, cheapest: hit.cheapest, shop: hit.shop, why });
  };

  // A: 自分の募集 (残りがあり、期限内のもの)。同じ品で単価違いが複数なら、いちばん高い単価で比べる
  const orderPrice = new Map<number, number>();
  for (const o of orders(g)) {
    if (o.shop !== dt.id || !(o.left > 0)) continue;
    if (now !== undefined && o.expires <= now) continue;
    orderPrice.set(o.item, Math.max(orderPrice.get(o.item) ?? 0, o.price));
  }
  for (const [no, price] of [...orderPrice].sort((a, b) => a[0] - b[0])) {
    const hit = idx.get(no);
    if (hit && hit.cheapest <= price && buyable(g, no)) put(no, 'order');
  }

  // W: ほしい物リスト (1.7.0)。棚になくても市場にあれば出す
  for (const no of [...(dt.wish ?? [])].sort((a, b) => a - b)) {
    if (out.has(no) || !buyable(g, no)) continue;
    const hit = idx.get(no);
    const market = (g.world.wholestore[no - 1] ?? 0) > 0;
    if (!hit && !market) continue;
    out.set(no, { item: no, name: g.items[no].name, shops: hit?.shops ?? 0, cheapest: hit?.cheapest ?? 0, shop: hit?.shop ?? 0, why: 'wish', ...(market ? { market: true } : {}) });
  }

  // B: 材料だけ足りない作り方
  const want = new Set<number>();
  for (let tool = 1; tool <= g.maxItem; tool++) {
    if (!(dt.item[tool - 1] > 0) || !g.items[tool]?.uses?.length) continue;
    for (const u of loadUses(g, tool)) {
      const exp = dt.exp[u.expno] ?? 0;
      if (!(exp > 0) || exp < u.needexp) continue;
      scaleUseMaterials(dt, u);
      for (const l of u.use) {
        // 使う品そのもの (ミノ牛乳を10使う発酵など) も、足りなければ材料として数える
        if (!(l.count > 0)) continue;
        if ((dt.item[l.no - 1] ?? 0) < l.count && buyable(g, l.no)) want.add(l.no);
      }
    }
  }
  for (const no of [...want].sort((a, b) => a - b)) put(no, 'recipe');
  return [...out.values()];
}

/** digest に出す最大の品数 */
export const ON_SHELF_DIGEST_MAX = 3;

/**
 * digest の1行。単価は出さない (どこかの店が値段を変えるたびに中身が変わって 304 が返らなくなるので、
 * 「並んだ・消えた」ときだけ変わるように品と店数だけ)。単価・店は GET /api/v1/shops?item=品番
 */
export function onShelfLine(list: OnShelf[]): string | null {
  if (!list.length) return null;
  const shown = list.slice(0, ON_SHELF_DIGEST_MAX).map((x) => `${x.name}(${[x.shops ? `${x.shops}店` : '', x.market ? '市場' : ''].filter(Boolean).join('・')})`);
  const rest = list.length - ON_SHELF_DIGEST_MAX;
  return `他店の棚に ${shown.join(' ')}${rest > 0 ? ` ほか${rest}品` : ''} → GET /api/v1/shops?item=品番${list.some((x) => x.market) ? ' (市場は GET /api/v1/market)' : ''}`;
}
