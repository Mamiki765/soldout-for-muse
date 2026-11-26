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
import { addMerchantYen } from './merchant.js';
import { addItemSub } from './scripts.js';
import type { BuyOrder, OrderRenew, OrderStats, Shop } from './types.js';

/** 募集まわりの決まり。数値はリカさん決定 (2026-11-14) */
export const ORDER_RULES = {
  /** 単価の幅 (標準価格に対する %) */
  minPercent: 50,
  /** 1.7.0 で 150 → 300。標準の3倍を超えると売却税が2割を超え、どちらにも得がない (税は (単価÷標準−1)²×5%、上限99%) */
  maxPercent: 300,
  /** これを超える単価で募集を出すと「採算に注意」と知らせる (1.7.0、リカさん 2026-11-26) */
  warnPercent: 150,
  /** 期限 (時間) */
  minHours: 1,
  maxHours: 48,
  /** 1期 (決算から次の決算まで) に出せる募集の数 = 棚の数 × これ。取り下げても戻らない */
  postsPerShelf: 3,
  /** 1期に応じられる募集の数 (納品側)。納品は売った側の人気・点数に入るので、稼ぎの基本は陳列のまま */
  fillsPerDay: 10,
  /** 1セット (1回の deliver) に入れられる募集の数 */
  linesPerSet: 8,
  /** 納品のお礼 (1.7.0、リカさん案 2026-11-26): 1回の納品 (1セット) が標準価格の合計でこれ以上なら、納品した側にタイムシガレット1本 */
  thanksMinStd: 5000,
  /** 納品のお礼をもらえる回数 (1期に) */
  thanksPerPeriod: 2,
  /** 回数を決めた自動再掲 (repost) の回数の上限 (int32 の最大) */
  maxRepeat: 2_147_483_647,
};

/** 決まりの一文。ヘルプ・告知・一覧の先頭に同じ文を置く (Museが迷わないように。リカさん 2026-11-14) */
export const ORDER_RULES_LINE =
  `買い取り募集のきまり: 単価は標準価格の${ORDER_RULES.minPercent}〜${ORDER_RULES.maxPercent}%、期限は${ORDER_RULES.minHours}〜${ORDER_RULES.maxHours}時間、` +
  `募集は同時に棚の数まで・1期に棚の数×${ORDER_RULES.postsPerShelf}回まで (取り下げても回数は戻らない)、` +
  `標準価格の${ORDER_RULES.warnPercent}%を超える単価は出せるが採算に注意 (納品する側の売却税も上がる)、` +
  `納品は同じ店へ1期1セットまで (その店の募集なら${ORDER_RULES.linesPerSet}種類まで1セットにまとめて届けられる)・応じられるのは全部で1期${ORDER_RULES.fillsPerDay}種類まで、受け取るとき所持上限を超えた分は破棄。` +
  `1セットが標準価格の合計で${ORDER_RULES.thanksMinStd.toLocaleString('en-US')}円ぶん以上なら、納品した側にお礼のタイムシガレット1本 (1期${ORDER_RULES.thanksPerPeriod}回まで)。回数は決算で戻る (1期=決算から次の決算まで)。`;

/** 期限切れのときの自動の張り直しの一文。一覧ではきまりの後ろに続ける */
export const ORDER_RENEW_LINE =
  `期限切れの扱い (renew): extend=1個も届いていなければ同じ長さだけ無料で延長 (時間・回数を使わない、1個でも届いていれば締める)、` +
  `repost=回数 (repeat) を決めて残りを同じ単価・同じ長さで再掲、forever=取り下げるまで再掲。` +
  `再掲は1回ごとに募集の回数を1回使い、前の回に届いていれば新しい募集と同じ取引時間 (持ち時間から) も使う (1個も届いていなければ時間は差し引き0)。届いた分はそのとき倉庫へ。時間か回数が足りない・所持上限なら締める。`;

/** 募集の一覧 (古い保存データには無いので、無ければ作る) */
export function orders(g: Game): BuyOrder[] {
  return (g.world.orders ??= []);
}

/** 今の「期」(決算の区切り) の番号 */
export function periodNo(g: Game): number {
  const cfg = g.config;
  return Math.floor((g.now + cfg.tzOffset - cfg.dateReviseTime) / cfg.oneDayTime);
}

/** 今期の回数表。決算をまたいだら空にする */
export function orderStats(g: Game): OrderStats {
  return statsAt(g, periodNo(g));
}

/**
 * 期 no の回数表。期限切れの処理は「期限が来た時刻」の期で数える (長くアクセスが無かったときも、その期の回数を使う)。
 * 保存してあるのより前の期を聞かれたとき (区切りちょうどの端) は、保存してある表で数える (きびしいほうに倒す)
 */
function statsAt(g: Game, no: number): OrderStats {
  const s = g.world.orderStats;
  if (s && s.period >= no) return s;
  return (g.world.orderStats = { period: no, posted: {}, filled: {}, pairs: {}, thanked: {} });
}

function periodAt(g: Game, t: number): number {
  const cfg = g.config;
  return Math.floor((t + cfg.tzOffset - cfg.dateReviseTime) / cfg.oneDayTime);
}

function bump(map: Record<string, number>, key: string | number, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

/** 単価の幅 [下限, 上限] (円) */
export function priceRange(g: Game, itemno: number): [number, number] {
  const std = g.items[itemno].price;
  return [Math.max(1, Math.ceil((std * ORDER_RULES.minPercent) / 100)), Math.max(1, Math.floor((std * ORDER_RULES.maxPercent) / 100))];
}

/**
 * 標準価格の warnPercent% を超える単価のときの注意 (1.7.0)。出せるけれど、買う側は割高、納品する側は売却税が上がる。
 * 超えていなければ null
 */
export function orderPriceWarning(g: Game, itemno: number, price: number): string | null {
  const item = g.items[itemno];
  if (!item?.price || price * 100 <= item.price * ORDER_RULES.warnPercent) return null;
  const pct = Math.round((price / item.price) * 100);
  const [rate] = g.saleTax(itemno, 1, price, 0);
  const market = item.marketprice ? `、市場の単価は今￥${item.marketprice}` : '';
  return `採算に注意: ${item.name}の単価￥${price}は標準価格￥${item.price}の${pct}%です${market}。この品を使って作る物の儲けが残るか確かめてください。納品する側には売却税が${rate}%かかります (標準の${ORDER_RULES.warnPercent}%を超えると上がる)`;
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
  /** 期限切れのときの扱い (任意。無ければ締める) */
  renew?: string;
  /** renew が repost のときの回数 (1〜maxRepeat) */
  repeat?: number;
}

/** renew と repeat を確かめて、募集に入れる形にする */
export function checkRenew(renew: string | undefined, repeat: number | undefined): { renew?: OrderRenew; repeat?: number } {
  const r = renew === undefined || renew === '' ? (repeat !== undefined ? 'repost' : 'none') : renew;
  if (r === 'none') {
    if (repeat !== undefined && Math.trunc(repeat) !== 0) throw new GameError('repeat は renew が repost のときだけ指定できます');
    return {};
  }
  if (r === 'extend' || r === 'forever') {
    if (repeat !== undefined) throw new GameError(`repeat は renew が repost のときだけ指定できます (${r} は回数を決めません)`);
    return { renew: r };
  }
  if (r !== 'repost') throw new GameError('renew は none (締める)・extend (未成立なら無料延長)・repost (回数を決めて再掲)・forever (無期限で再掲) のどれかです');
  const n = repeat === undefined ? NaN : Math.trunc(repeat);
  if (!(n >= 1 && n <= ORDER_RULES.maxRepeat)) throw new GameError(`範囲外: repost の回数 (repeat) は1〜${ORDER_RULES.maxRepeat}回です`);
  return { renew: 'repost', repeat: n };
}

/** 期限切れの扱いの短い説明 (一覧・ログ用) */
export function renewLabel(o: { renew?: string; repeat?: number | null }): string {
  if (o.renew === 'extend') return '未成立なら延長';
  if (o.renew === 'repost') return `再掲あと${o.repeat ?? 0}回`;
  if (o.renew === 'forever') return '再掲無期限';
  return '';
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
  const renew = checkRenew(req.renew, req.repeat);

  const mine = orders(g).filter((o) => o.shop === dt.id).length;
  if (mine >= dt.showcasecount) throw new GameError(`上限: 同時に出せる募集 ${mine}/${dt.showcasecount}件 (棚の数まで)。あと0件です。取り下げるか、締まると出せます`);
  const stats = orderStats(g);
  const maxPosts = dt.showcasecount * ORDER_RULES.postsPerShelf;
  if ((stats.posted[dt.id] ?? 0) >= maxPosts) throw new GameError(`上限: 今期出した募集 ${stats.posted[dt.id] ?? 0}/${maxPosts}回 (棚の数×${ORDER_RULES.postsPerShelf})。あと0回です。取り下げても戻らず、決算で戻ります`);

  const total = price * count;
  if (dt.money < total) throw new GameError('資金が足りません (代金は募集のときに全額預けます)');
  const usetime = g.timeDeal(total, itemno, count, dt);
  const fromCoupon = g.useTime(usetime);
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
    ...(fromCoupon ? { coupon: fromCoupon, couponWeek: g.couponWeekStart() } : {}),
    created: g.now,
    expires: g.now + hours * 3600,
    hours,
    ...renew,
  };
  orders(g).push(o);
  g.writeLog(0, dt.id, 0, `${item.name}を${count}${item.scale}@￥${price}で募集しました (預り￥${total}、${hours}時間${o.renew ? `、${renewLabel(o)}` : ''})`);
  return o;
}

/** 預かっていた品をまとめて渡す。締めるまでに棚などで買い足して上限を超えた分は、原作の郵便と同じく破棄 */
function handOver(g: Game, o: BuyOrder, buyer: Shop): { got: number; put: number } {
  const got = o.count - o.left;
  const put = Math.max(0, Math.min(got, g.items[o.item].limit - buyer.item[o.item - 1]));
  buyer.item[o.item - 1] += put;
  return { got, put };
}

/** 募集の期限の長さ (秒)。古い募集は出したときの長さから求める */
function spanOf(o: BuyOrder): number {
  const h = o.hours ?? Math.round((o.expires - o.created) / 3600);
  return Math.max(ORDER_RULES.minHours, Math.min(ORDER_RULES.maxHours, h)) * 3600;
}

/**
 * A. 未成立なら無料延長。期限 t までに1個も届いていなければ、t を越えるまで同じ長さを足す (何回分でも一度に)。
 * 時間・代金・募集の回数は使わない。最初に払った取引時間はそのまま (延長では返さない)。延長できたら true
 */
function extendOrder(g: Game, o: BuyOrder, upTo: number): boolean {
  if (o.left !== o.count) return false;
  const span = spanOf(o);
  const k = Math.floor((upTo - o.expires) / span) + 1;
  o.expires += k * span;
  o.renewed = (o.renewed ?? 0) + k;
  const item = g.items[o.item];
  g.writeLog(0, o.shop, 0, `募集#${o.id} ${item.name}は1個も届かなかったので期限を延ばしました (${k > 1 ? `${k}回分、` : ''}〆${fmt(g, o.expires)})`);
  return true;
}

/**
 * B・C. 有料で再掲。期限 t (= o.expires) の時点で、新しい募集を出したのと同じだけ払って、残りの数を同じ単価・同じ長さで張り直す。
 * - 届いていた分は t の時点で倉庫へ (所持上限を超えた分は破棄。締めるときと同じ)。預り金は残りの代金そのまま引き継ぐ
 * - 取引時間: 前の回に1個でも届いていれば、残りの代金で棚で1回買うのと同じ時間を、t の時点の持ち時間から払う (クーポンは使わない)。前の回の時間は戻さない。
 *   1個も届いていなければ「買わなかった」のと同じなので、前の回の時間を返す代わりに新しい時間も取らない (差し引き0。リカさん判断 2026-11-15)
 * - 募集の回数: t の期の「棚の数×3」を1回使う
 * - 時間・回数が足りない、または残りの数が所持上限に入らないときは張り直さない (false。呼び手が締める)
 * 張り直せたら true。失敗したときは何も変えない
 */
function repostOrder(g: Game, o: BuyOrder, buyer: Shop): string | true {
  const t = o.expires;
  const item = g.items[o.item];
  const stats = statsAt(g, periodAt(g, t));
  const maxPosts = buyer.showcasecount * ORDER_RULES.postsPerShelf;
  if ((stats.posted[buyer.id] ?? 0) >= maxPosts) return '今期の募集回数を使い切ったため再掲せず';
  // 届いていた分を倉庫へ入れたあとに、残りが所持上限に入るか (ほかの募集の残りと預かり分も数える)
  const got = o.count - o.left;
  const after = Math.min(item.limit, buyer.item[o.item - 1] + got);
  const others = orders(g)
    .filter((x) => x !== o && x.shop === buyer.id && x.item === o.item)
    .reduce((a, x) => a + x.count, 0);
  if (after + others + o.left > item.limit) return '所持上限のため再掲せず';
  const paid = got > 0;
  const cost = paid ? g.timeDeal(o.left * o.price, o.item, o.left, buyer) : 0;
  if (paid) {
    const max = g.config.maxStockTime;
    const base = t - buyer.time > max ? t - max : buyer.time;
    if (t - base < cost) return '持ち時間が足りないため再掲せず';
    buyer.time = base + cost;
  }
  bump(stats.posted, buyer.id);
  const { put } = handOver(g, o, buyer);
  if (o.renew === 'repost') o.repeat = (o.repeat ?? 1) - 1;
  o.renewed = (o.renewed ?? 0) + 1;
  o.count = o.left;
  if (o.min > o.left) o.min = o.left;
  if (paid) {
    o.time = cost;
    delete o.coupon;
    delete o.couponWeek;
  }
  o.created = t;
  o.expires = t + spanOf(o);
  if (o.renew === 'repost' && !o.repeat) {
    delete o.renew;
    delete o.repeat;
  }
  g.writeLog(
    0,
    buyer.id,
    0,
    `募集#${o.id} ${item.name}を再掲しました (残り${o.left}${item.scale}@￥${o.price}、〆${fmt(g, o.expires)}` +
      (o.renew ? `、${renewLabel(o)}` : '、再掲はこれで最後') +
      (got ? `。届いた${got}${item.scale}を倉庫へ` + (put < got ? `、所持上限を超えた${got - put}${item.scale}は破棄` : '') : '') +
      ')',
  );
  return true;
}

function fmt(g: Game, t: number): string {
  const d = new Date((t + g.config.tzOffset) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 自分の募集の期限切れの扱いを変える (時間はかからない) */
export function setOrderRenew(g: Game, dt: Shop, id: number, renew: string | undefined, repeat: number | undefined): string {
  const o = orders(g).find((x) => x.id === Math.trunc(id));
  if (!o || o.shop !== dt.id) throw new GameError('その募集はありません');
  const r = checkRenew(renew ?? 'none', repeat);
  delete o.renew;
  delete o.repeat;
  Object.assign(o, r);
  o.hours ??= spanOf(o) / 3600;
  return `募集#${o.id}の期限切れの扱いを${o.renew ? renewLabel(o) : 'なし (締める)'}にしました`;
}

/** 預けた資金と時間のうち、使わなかった分を返して募集を消す */
function closeOrder(g: Game, o: BuyOrder, buyer: Shop | undefined, reason: string): string {
  const list = orders(g);
  const i = list.indexOf(o);
  if (i >= 0) list.splice(i, 1);
  if (!buyer) return '';
  const item = g.items[o.item];
  const { got, put } = handOver(g, o, buyer);
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
  if (timeBack) g.refundTime(buyer, timeBack, o.coupon ?? 0, o.couponWeek ?? 0);
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
    } else {
      // 期限が来たら、その時刻の順に 延長 / 再掲 / 締め。再掲は1回ごとに時間と募集の回数を使うので、回数は有限で止まる
      let why = '';
      // 1回のアクセスで張り直すのは最大 RENEW_LOOP 回まで (残りは次のアクセスで続ける。期限切れの募集には納品できない)
      for (let loop = 0; o.expires <= upTo && loop < RENEW_LOOP; loop++) {
        changed = true;
        if (o.renew === 'extend' && extendOrder(g, o, upTo)) continue;
        if (o.renew === 'repost' || o.renew === 'forever') {
          const r = repostOrder(g, o, buyer);
          if (r === true) continue;
          why = r;
        }
        closeOrder(g, o, buyer, why ? `期限切れで終了 (${why})` : '期限切れで終了');
        break;
      }
    }
  }
  return changed;
}

const RENEW_LOOP = 1000;

/** 納品のお礼の品 (タイムシガレット、1本で持ち時間+30分) */
const THANKS_ITEM = 132;

export interface WantedItem {
  item: number;
  name: string;
  /** その品を欲しがっている、今納品できる募集の数 */
  orders: number;
  /** いちばん高い単価 */
  price: number;
  /** 残りの数の合計 */
  left: number;
}

/**
 * 自分の在庫 (items を渡せばその品だけ) を欲しがっている、ほかの店の募集。今この店が納品できるものだけ数える
 * (期限内・残りあり・その店へ今期まだ納品していない・今期の応じる回数が残っている)。品番順。読むだけ (1.7.0)
 */
export function wantedFor(g: Game, dt: Shop, items?: Iterable<number>): WantedItem[] {
  const only = items ? new Set(items) : null;
  const stats = g.world.orderStats;
  const cur = stats && stats.period >= periodNo(g) ? stats : undefined;
  if ((cur?.filled[dt.id] ?? 0) >= ORDER_RULES.fillsPerDay) return [];
  const out = new Map<number, WantedItem>();
  for (const o of orders(g)) {
    if (o.shop === dt.id || !(o.left > 0) || o.expires <= g.now) continue;
    if (only && !only.has(o.item)) continue;
    if (!(dt.item[o.item - 1] > 0) || !g.shopById(o.shop)) continue;
    if (cur?.pairs[`${dt.id}>${o.shop}`]) continue;
    const w = out.get(o.item);
    if (!w) out.set(o.item, { item: o.item, name: g.items[o.item].name, orders: 1, price: o.price, left: o.left });
    else {
      w.orders++;
      w.left += o.left;
      if (o.price > w.price) w.price = o.price;
    }
  }
  return [...out.values()].sort((a, b) => a.item - b.item);
}

/** 採取・生産から戻ったときの1行 (できた品を欲しがっている募集があるときだけ) */
export function wantedLine(g: Game, list: WantedItem[]): string | null {
  if (!list.length) return null;
  const parts = list.map((w) => `${w.name} ${w.orders}件 (最高￥${w.price}・残り${w.left}${g.items[w.item].scale})`);
  return `募集中: ${parts.join(' / ')} → GET /api/v1/orders?item=品番 を見て deliver で納品できます`;
}

export interface DeliverLine {
  order: number;
  count: number;
}

/**
 * 納品 (1セット)。同じ募集主の募集なら、複数の品を1セットにまとめて渡せる。
 * 同じ相手へは1期1セットまで (逆向きは別に1セット)。応じた募集は1件ずつ「種類」と数えて1期10種類まで。
 */
export function deliver(g: Game, dt: Shop, toId: number, lines: DeliverLine[]): string[] {
  if (!lines.length) throw new GameError('納品する募集を指定してください');
  if (lines.length > ORDER_RULES.linesPerSet) throw new GameError(`上限: 1セットに入れられるのは${ORDER_RULES.linesPerSet}種類までです (今${lines.length}種類)`);
  const buyer = g.shopById(Math.trunc(toId));
  if (!buyer) throw new GameError('その店は見つかりません');
  if (buyer === dt) throw new GameError('自分の募集には納品できません');
  const stats = orderStats(g);
  const pair = `${dt.id}>${buyer.id}`;
  if (stats.pairs[pair]) throw new GameError(`上限: ${buyer.shopname}への納品は今期1/1セット (同じ店へは1期1セット)。決算で戻ります。次からは届けたい募集をまとめて1セットで送ってください`);
  const done = stats.filled[dt.id] ?? 0;
  if (done + lines.length > ORDER_RULES.fillsPerDay) {
    throw new GameError(`上限: 今期応じた募集 ${done}/${ORDER_RULES.fillsPerDay}種類。あと${Math.max(0, ORDER_RULES.fillsPerDay - done)}種類なので、このセットの${lines.length}種類は入りません。決算で戻ります`);
  }
  const seen = new Set<number>();
  const msgs: string[] = [];
  let stdValue = 0;
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
    stdValue += num * item.price;
    const [, tax] = g.saleTax(o.item, num, amount, g.userTaxRate(dt));
    dt.item[o.item - 1] -= num;
    dt.itemtoday[o.item] = (dt.itemtoday[o.item] ?? 0) + num;
    dt.moneystock += amount - tax;
    dt.saletoday += amount;
    g.recordSaleTax(dt, tax, amount);
    // 棚の「売り切れで人気が下がる」は掛けない (意図的)。納品は棚を使わないので売り切れ放置が起きない。
    // 人気・点数への効き過ぎは、1期に応じられる件数 (fillsPerDay) で抑える (リカさん判断 2026-11-14)
    // 買い手: 預り金から払う (時間は募集のときに払い済み)。品は締めるまで募集の中で預かる
    buyer.paytoday += amount;
    addMerchantYen(buyer, amount);
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
  // 納品のお礼 (1.7.0): 1セットが標準価格の合計で thanksMinStd 円以上なら、1期 thanksPerPeriod 回までタイムシガレット1本。
  // 1本だけ投げてお礼をもらう遊び方にならないよう、額は買い手が決める単価ではなく標準価格で数える
  if (stdValue >= ORDER_RULES.thanksMinStd) {
    const thanked = (stats.thanked ??= {});
    if ((thanked[dt.id] ?? 0) < ORDER_RULES.thanksPerPeriod) {
      const got = addItemSub(g, dt, THANKS_ITEM, 1);
      if (got > 0) {
        bump(thanked, dt.id);
        const left = ORDER_RULES.thanksPerPeriod - thanked[dt.id];
        const msg = `納品のお礼に${g.items[THANKS_ITEM].name}を1本受け取りました (今期あと${left}回)`;
        msgs.push(msg);
        g.writeLog(0, dt.id, 0, msg);
      }
    }
  }
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
    /** 期限切れのときの扱い (none / extend / repost / forever) */
    renew: o.renew ?? 'none',
    /** repost の残り回数 (repost 以外は null) */
    repeat: o.renew === 'repost' ? (o.repeat ?? 0) : null,
    /** 期限の長さ (時間) */
    hours: spanOf(o) / 3600,
  };
}
