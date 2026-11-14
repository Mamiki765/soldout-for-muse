// SOLD OUT for Muse — 買い取り募集 (原作にない追加機能)。
// 欲しい品・単価・数量を掲示し、ほかの店が納品して代金を受け取る。
// 時間と税は「売り手が棚に並べて、買い手がそれを買う」のと同じだけ掛かるようにしてある。
//   買い手: 募集を出すときに、棚で買うときの取引時間 (timeDeal) 1回ぶんと代金全額を先に預ける
//   売り手: 納品のときに、募集1件ごとに陳列1回ぶんの手間と売却税
// 案: 店106「瑠璃のしおり堂」さんより (目安箱 #2, 2026-11)。取引条件はリカさん・ミュートさんより (2026-11)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import type { BuyOrder, OrderStats, Shop } from './types.js';

/** 募集まわりの決まり。数値はリカさん決定 (2026-11-14) */
export const ORDER_RULES = {
  /** 単価の幅 (標準価格に対する %) */
  minPercent: 50,
  maxPercent: 150,
  /** 期限 (時間) */
  minHours: 1,
  maxHours: 48,
  /** 1日 (決算から次の決算まで) に出せる募集の数 = 棚の数 × これ。取り下げても戻らない */
  postsPerShelf: 3,
  /** 1日に応じられる募集の数 (納品側)。納品は売った側の人気・点数に入るので、稼ぎの基本は陳列のまま */
  fillsPerDay: 10,
};

/** 募集の一覧 (古い保存データには無いので、無ければ作る) */
export function orders(g: Game): BuyOrder[] {
  return (g.world.orders ??= []);
}

/** 今の「1日」(決算の区切り) の番号 */
export function periodNo(g: Game): number {
  const cfg = g.config;
  return Math.floor((g.now + cfg.tzOffset - cfg.dateReviseTime) / cfg.oneDayTime);
}

/** 今日の回数表。決算をまたいだら空にする */
export function orderStats(g: Game): OrderStats {
  const no = periodNo(g);
  const s = g.world.orderStats;
  if (s && s.period === no) return s;
  return (g.world.orderStats = { period: no, posted: {}, filled: {}, pairs: {} });
}

function bump(map: Record<string, number>, key: string | number, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

/** 単価の幅 [下限, 上限] (円) */
export function priceRange(g: Game, itemno: number): [number, number] {
  const std = g.items[itemno].price;
  return [Math.max(1, Math.ceil((std * ORDER_RULES.minPercent) / 100)), Math.max(1, Math.floor((std * ORDER_RULES.maxPercent) / 100))];
}

/** その店がこれから受け取る予定の数 (募集の残り) */
function pendingOf(g: Game, shopId: number, itemno: number): number {
  return orders(g)
    .filter((o) => o.shop === shopId && o.item === itemno)
    .reduce((a, o) => a + o.left, 0);
}

export interface OrderRequest {
  itemno: number;
  /** 単価 (円) */
  price: number;
  count: number;
  /** 期限 (時間) */
  hours: number;
  /** 1回の納品で受け付ける最低数 (任意) */
  min?: number;
}

/** 募集を出す */
export function createOrder(g: Game, dt: Shop, req: OrderRequest): BuyOrder {
  const itemno = Math.trunc(req.itemno);
  if (!(itemno >= 1 && itemno <= g.maxItem) || !g.items[itemno]) throw new GameError('そんなアイテムはないです。');
  const item = g.items[itemno];
  if (!item.price || g.itemFlag(itemno, 'nobuy') || g.itemFlag(itemno, 'nosend')) throw new GameError('この商品は募集できません');
  const price = Math.trunc(req.price);
  const [lo, hi] = priceRange(g, itemno);
  if (!(price >= lo && price <= hi)) throw new GameError(`単価は標準価格の${ORDER_RULES.minPercent}〜${ORDER_RULES.maxPercent}% (${lo}〜${hi}円) で指定してください`);
  const hours = Math.trunc(req.hours);
  if (!(hours >= ORDER_RULES.minHours && hours <= ORDER_RULES.maxHours)) throw new GameError(`期限は${ORDER_RULES.minHours}〜${ORDER_RULES.maxHours}時間で指定してください`);
  const count = Math.trunc(req.count);
  if (!(count >= 1)) throw new GameError('数量を指定してください');
  const room = item.limit - dt.item[itemno - 1] - pendingOf(g, dt.id, itemno);
  if (count > room) throw new GameError(`所持上限を超えます (今の在庫と募集中の残りを足して、あと${Math.max(0, room)}${item.scale}まで)`);
  const min = req.min === undefined ? 0 : Math.trunc(req.min);
  if (min < 0 || min > count) throw new GameError('最低納品数は 0〜数量 で指定してください');

  const mine = orders(g).filter((o) => o.shop === dt.id).length;
  if (mine >= dt.showcasecount) throw new GameError(`同時に出せる募集は棚の数 (${dt.showcasecount}件) までです`);
  const stats = orderStats(g);
  const maxPosts = dt.showcasecount * ORDER_RULES.postsPerShelf;
  if ((stats.posted[dt.id] ?? 0) >= maxPosts) throw new GameError(`今日出せる募集は${maxPosts}回までです (取り下げても回数は戻りません。決算で戻ります)`);

  const total = price * count;
  if (dt.money < total) throw new GameError('資金が足りません (代金は募集のときに全額預けます)');
  const usetime = g.timeDeal(total, itemno, count);
  g.useTime(usetime);
  dt.money -= total;
  bump(stats.posted, dt.id);

  const w = g.world;
  const o: BuyOrder = {
    id: (w.orderSeq = (w.orderSeq ?? 0) + 1),
    shop: dt.id,
    item: itemno,
    price,
    count,
    left: count,
    min,
    escrow: total,
    time: usetime,
    created: g.now,
    expires: g.now + hours * 3600,
  };
  orders(g).push(o);
  g.writeLog(0, dt.id, 0, `${item.name}を${count}${item.scale}@￥${price}で募集しました (預り￥${total}、${hours}時間)`);
  return o;
}

/** 預けた資金と時間のうち、使わなかった分を返して募集を消す */
function closeOrder(g: Game, o: BuyOrder, buyer: Shop | undefined, reason: string): string {
  const list = orders(g);
  const i = list.indexOf(o);
  if (i >= 0) list.splice(i, 1);
  if (!buyer) return '';
  let back = o.escrow;
  let toStock = 0;
  if (buyer.money + back > g.maxMoney) {
    toStock = buyer.money + back - g.maxMoney;
    back -= toStock;
  }
  buyer.money += back;
  buyer.moneystock += toStock;
  // 取引時間は個数によらず1回ぶん。1個も買えなかったときだけ返す (棚で1回も買わなかったのと同じ)
  const timeBack = o.left === o.count ? o.time : 0;
  buyer.time -= timeBack;
  const item = g.items[o.item];
  const msg =
    `募集#${o.id} ${item.name}を${reason} (買えた数 ${o.count - o.left}/${o.count}${item.scale}、返金￥${o.escrow}` +
    (toStock ? ` うち￥${toStock}は資金の上限を超えたので入金庫へ` : '') +
    (timeBack ? '、時間も戻しました' : '') +
    ')';
  g.writeLog(0, buyer.id, 0, msg);
  return msg;
}

/** 募集を取り下げる */
export function cancelOrder(g: Game, dt: Shop, id: number): string {
  const o = orders(g).find((x) => x.id === Math.trunc(id));
  if (!o || o.shop !== dt.id) throw new GameError('その募集はありません');
  return closeOrder(g, o, dt, '取り下げました');
}

/** 期限切れの募集を返金して消し、閉店した店の募集を片付ける。何か変わったら true */
export function sweepOrders(g: Game): boolean {
  const list = g.world.orders;
  if (!list || !list.length) return false;
  let changed = false;
  for (const o of [...list]) {
    const buyer = g.shopById(o.shop);
    if (!buyer) {
      // 閉店した店の資金は 0 になる (原作 CloseShop) ので、預り金も街に消える
      list.splice(list.indexOf(o), 1);
      changed = true;
    } else if (o.expires <= g.now) {
      closeOrder(g, o, buyer, '期限切れで終了');
      changed = true;
    }
  }
  return changed;
}

export interface DeliverLine {
  order: number;
  count: number;
}

/**
 * 納品 (段ボール1箱)。同じ募集主の募集なら、複数の品を1箱にまとめて渡せる。
 * 同じ相手へは1日1箱まで (逆向きは別に1箱)。応じた募集は1件ずつ数えて1日10件まで。
 */
export function deliver(g: Game, dt: Shop, toId: number, lines: DeliverLine[]): string[] {
  if (!lines.length) throw new GameError('納品する募集を指定してください');
  if (lines.length > 8) throw new GameError('1箱に入れられる募集は8件までです');
  const buyer = g.shopById(Math.trunc(toId));
  if (!buyer) throw new GameError('その店は見つかりません');
  if (buyer === dt) throw new GameError('自分の募集には納品できません');
  const stats = orderStats(g);
  const pair = `${dt.id}>${buyer.id}`;
  if (stats.pairs[pair]) throw new GameError(`${buyer.shopname}への納品は今日はもう済んでいます (同じ相手へは1日1箱。決算で戻ります)`);
  const done = stats.filled[dt.id] ?? 0;
  if (done + lines.length > ORDER_RULES.fillsPerDay) {
    throw new GameError(`今日応じられる募集はあと${Math.max(0, ORDER_RULES.fillsPerDay - done)}件です (1日${ORDER_RULES.fillsPerDay}件まで)`);
  }
  const seen = new Set<number>();
  const msgs: string[] = [];
  for (const line of lines) {
    const id = Math.trunc(line.order);
    if (seen.has(id)) throw new GameError(`募集#${id}が2回入っています`);
    seen.add(id);
    const o = orders(g).find((x) => x.id === id);
    if (!o || o.shop !== buyer.id || o.expires <= g.now) throw new GameError(`募集#${id}は${buyer.shopname}の募集ではありません (終わったかもしれません)`);
    const item = g.items[o.item];
    let num = Math.trunc(line.count);
    if (!(num >= 1)) throw new GameError(`募集#${id}: 数量を指定してください`);
    if (num > o.left) num = o.left;
    const have = dt.item[o.item - 1];
    if (have < num) throw new GameError(`募集#${id}: ${item.name}の在庫が足りません (在庫${have})`);
    // 買い手の倉庫に入る分だけ (募集の後で在庫が増えていた場合)
    const room = item.limit - buyer.item[o.item - 1];
    if (room < num) num = Math.max(0, room);
    if (!num) throw new GameError(`募集#${id}: ${buyer.shopname}の${item.name}は所持上限です`);
    if (o.min && num < o.min && num < o.left) throw new GameError(`募集#${id}: 1回に${o.min}${item.scale}以上で納品してください`);

    // 売り手: 陳列1回ぶんの手間と、棚で売れたのと同じ売却税
    g.useTime(CATALOG.timeEditShowcase);
    const amount = num * o.price;
    const [, tax] = g.saleTax(o.item, num, amount, g.userTaxRate(dt));
    dt.item[o.item - 1] -= num;
    dt.itemtoday[o.item] = (dt.itemtoday[o.item] ?? 0) + num;
    dt.moneystock += amount - tax;
    dt.saletoday += amount;
    dt.taxtoday += tax;
    // 買い手: 預り金から払う (時間は募集のときに払い済み)
    buyer.item[o.item - 1] += num;
    buyer.paytoday += amount;
    o.escrow -= amount;
    o.left -= num;
    bump(stats.filled, dt.id);

    const msg = `${buyer.shopname}の募集#${id}に${item.name}を${num}${item.scale}@￥${o.price}(計￥${amount}、税￥${tax})で納品しました`;
    msgs.push(msg);
    g.writeLog(0, dt.id, 0, msg);
    g.writeLog(0, buyer.id, 0, `${dt.shopname}から募集#${id}の${item.name}が${num}${item.scale}届きました (￥${amount}、残り${o.left}${item.scale})`);
    if (!o.left) closeOrder(g, o, buyer, '集め終わりました');
  }
  stats.pairs[pair] = 1;
  return msgs;
}

/** 一覧用 */
export function orderView(g: Game, o: BuyOrder) {
  const buyer = g.shopById(o.shop);
  const item = g.items[o.item];
  return {
    id: o.id,
    shop_id: o.shop,
    shopname: buyer?.shopname ?? '',
    item: o.item,
    name: item.name,
    scale: item.scale,
    price: o.price,
    percent: Math.round((o.price / item.price) * 100),
    left: o.left,
    count: o.count,
    min: o.min,
    expires: o.expires,
  };
}
