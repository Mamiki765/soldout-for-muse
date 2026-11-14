// SOLD OUT for Muse — 買い取り募集 (原作にない追加機能)。
// 欲しい品・単価・数量を掲示し、ほかの店が納品して代金を受け取る。
// 時間と税は「売り手が棚に並べて、買い手がそれを買う」のと同じだけ掛かるようにしてある。
//   買い手: 募集を出すときに、棚で買うときの取引時間 (timeDeal) 1回ぶんと代金全額を先に預ける
//   売り手: 納品のときに、募集1件ごとに陳列1回ぶんの手間と売却税
// 届いた品は募集の中で預かり、締めたとき (集め終わり・取り下げ・期限切れ) に一度にまとめて買い手の倉庫へ入れる
// (棚から1回まとめて買ったのと同じ形。案: リカさんより)
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

/** 決まりの一文。ヘルプ・告知・一覧の先頭に同じ文を置く (Museが迷わないように。リカさん 2026-11-14) */
export const ORDER_RULES_LINE =
  `買い取り募集のきまり: 単価は標準価格の${ORDER_RULES.minPercent}〜${ORDER_RULES.maxPercent}%、期限は${ORDER_RULES.minHours}〜${ORDER_RULES.maxHours}時間、` +
  `募集は同時に棚の数まで・1日に棚の数×${ORDER_RULES.postsPerShelf}回まで (取り下げても回数は戻らない)、` +
  `納品は同じ店へ1日1セットまで (その店の募集なら何種類でも1セットにまとめて届けられる)・応じられるのは全部で1日${ORDER_RULES.fillsPerDay}種類まで、受け取るとき所持上限を超えた分は破棄。回数は決算で戻る。`;

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

/** その店がこれから受け取る予定の数 (募集の残りと、預かり中の届いた品) */
function pendingOf(g: Game, shopId: number, itemno: number): number {
  return orders(g)
    .filter((o) => o.shop === shopId && o.item === itemno)
    .reduce((a, o) => a + o.count, 0);
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
  if (!(price >= lo && price <= hi)) throw new GameError(`範囲外: 単価は標準価格の${ORDER_RULES.minPercent}〜${ORDER_RULES.maxPercent}%、${item.name}なら${lo}〜${hi}円です`);
  const hours = Math.trunc(req.hours);
  if (!(hours >= ORDER_RULES.minHours && hours <= ORDER_RULES.maxHours)) throw new GameError(`範囲外: 期限は${ORDER_RULES.minHours}〜${ORDER_RULES.maxHours}時間です`);
  const count = Math.trunc(req.count);
  if (!(count >= 1)) throw new GameError('数量を指定してください');
  const room = item.limit - dt.item[itemno - 1] - pendingOf(g, dt.id, itemno);
  if (count > room) throw new GameError(`上限: ${item.name}の所持上限。今の在庫と募集中の残りを足すと、あと${Math.max(0, room)}${item.scale}までしか募集できません`);
  const min = req.min === undefined ? 0 : Math.trunc(req.min);
  if (min < 0 || min > count) throw new GameError('最低納品数は 0〜数量 で指定してください');

  const mine = orders(g).filter((o) => o.shop === dt.id).length;
  if (mine >= dt.showcasecount) throw new GameError(`上限: 同時に出せる募集 ${mine}/${dt.showcasecount}件 (棚の数まで)。あと0件です。取り下げるか、締まると出せます`);
  const stats = orderStats(g);
  const maxPosts = dt.showcasecount * ORDER_RULES.postsPerShelf;
  if ((stats.posted[dt.id] ?? 0) >= maxPosts) throw new GameError(`上限: 今日出した募集 ${stats.posted[dt.id] ?? 0}/${maxPosts}回 (棚の数×${ORDER_RULES.postsPerShelf})。あと0回です。取り下げても戻らず、決算で戻ります`);

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
  // 預かっていた品をまとめて渡す。締めるまでに棚などで買い足して上限を超えた分は、原作の郵便と同じく破棄
  const item = g.items[o.item];
  const got = o.count - o.left;
  const put = Math.max(0, Math.min(got, item.limit - buyer.item[o.item - 1]));
  buyer.item[o.item - 1] += put;
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
  const msg =
    `募集#${o.id} ${item.name}を${reason} (届いた${got}/${o.count}${item.scale}を倉庫へ` +
    (put < got ? `、所持上限を超えた${got - put}${item.scale}は破棄` : '') +
    `、返金￥${o.escrow}` +
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

/**
 * 期限切れの募集を返金して消し、閉店した店の募集を片付ける。何か変わったら true。
 * upTo: この時刻までに期限が来たものを締める。時間経過の計算 (turn.ts) が決算の前に呼ぶので、
 * 長くアクセスが無くても「期限が来てから決算」の順になる。
 */
export function sweepOrders(g: Game, upTo: number = g.now): boolean {
  const list = g.world.orders;
  if (!list || !list.length) return false;
  let changed = false;
  for (const o of [...list]) {
    const buyer = g.shopById(o.shop);
    if (!buyer) {
      // 閉店した店の資金は 0 になる (原作 CloseShop) ので、預り金も街に消える
      list.splice(list.indexOf(o), 1);
      changed = true;
    } else if (o.expires <= upTo) {
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
 * 納品 (1セット)。同じ募集主の募集なら、複数の品を1セットにまとめて渡せる。
 * 同じ相手へは1日1セットまで (逆向きは別に1セット)。応じた募集は1件ずつ「種類」と数えて1日10種類まで。
 */
export function deliver(g: Game, dt: Shop, toId: number, lines: DeliverLine[]): string[] {
  if (!lines.length) throw new GameError('納品する募集を指定してください');
  if (lines.length > 8) throw new GameError(`上限: 1セットに入れられるのは8種類までです (今${lines.length}種類)`);
  const buyer = g.shopById(Math.trunc(toId));
  if (!buyer) throw new GameError('その店は見つかりません');
  if (buyer === dt) throw new GameError('自分の募集には納品できません');
  const stats = orderStats(g);
  const pair = `${dt.id}>${buyer.id}`;
  if (stats.pairs[pair]) throw new GameError(`上限: ${buyer.shopname}への納品は今日1/1セット (同じ店へは1日1セット)。決算で戻ります。次からは届けたい募集をまとめて1セットで送ってください`);
  const done = stats.filled[dt.id] ?? 0;
  if (done + lines.length > ORDER_RULES.fillsPerDay) {
    throw new GameError(`上限: 今日応じた募集 ${done}/${ORDER_RULES.fillsPerDay}種類。あと${Math.max(0, ORDER_RULES.fillsPerDay - done)}種類なので、このセットの${lines.length}種類は入りません。決算で戻ります`);
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
    // 買い手の倉庫に入る分だけ (募集の後で在庫が増えていた場合)。預かり中の品も数える
    const held = orders(g)
      .filter((x) => x.shop === buyer.id && x.item === o.item)
      .reduce((a, x) => a + x.count - x.left, 0);
    const room = item.limit - buyer.item[o.item - 1] - held;
    if (room < num) num = Math.max(0, room);
    if (!num) throw new GameError(`上限: 募集#${id}は${buyer.shopname}の${item.name}が所持上限のため、あと0${item.scale}です`);
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
    // 棚の「売り切れで人気が下がる」は掛けない (意図的)。納品は棚を使わないので売り切れ放置が起きない。
    // 人気・点数への効き過ぎは、1日に応じられる件数 (fillsPerDay) で抑える (リカさん判断 2026-11-14)
    // 買い手: 預り金から払う (時間は募集のときに払い済み)。品は締めるまで募集の中で預かる
    buyer.paytoday += amount;
    o.escrow -= amount;
    o.left -= num;
    bump(stats.filled, dt.id);

    const msg = `${buyer.shopname}の募集#${id}に${item.name}を${num}${item.scale}@￥${o.price}(計￥${amount}、税￥${tax})で納品しました`;
    msgs.push(msg);
    g.writeLog(0, dt.id, 0, msg);
    g.writeLog(0, buyer.id, 0, `${dt.shopname}から募集#${id}の${item.name}が${num}${item.scale}届きました (￥${amount}、残り${o.left}${item.scale}。締めたときにまとめて倉庫へ)`);
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
    /** 届いて預かり中の数 (締めたときに倉庫へ) */
    got: o.count - o.left,
    min: o.min,
    expires: o.expires,
  };
}
