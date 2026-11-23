// SOLD OUT for Muse — API の返事の組み立て。AI が読む前提で、短いテキストを基本にする。
// 同じ内容を JSON でも返せるよう、まずデータ (オブジェクト) を作り、テキストはそこから作る。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { restInfo } from '../engine/rest.js';
import { BASE_ITEMS, CATALOG, HIDDEN_NAME, MAX_ITEM, isPublicItem, itemNoByName, itemNote, itemVisibility, itemVisibilityVersion, makesHiddenItem } from '../data/catalog.js';
import { APP_VERSION } from '../updates.js';
import { TAX_FREE_MONEYSTOCK, type Game } from '../engine/game.js';
import { getMarketStatus, getWholeStore } from '../engine/market.js';
import { shownPeople, type Shop } from '../engine/types.js';
import { bookDurability } from '../engine/scripts.js';
import { checkUses, itemUseTime, loadUses, type RtUse } from '../engine/use.js';
import { maxDeposit } from '../engine/actions.js';
import { shelfNoticeOn, tutorialDigest, tutorialDigestLines } from '../engine/tutorial.js';
import { onShelf, onShelfLine } from '../engine/onshelf.js';
import { discardPlan, periodEstimate, type Alert, type peekData } from '../engine/watch.js';
import { ORDER_RULES, ORDER_RULES_LINE, ORDER_RENEW_LINE, orderStats, orderView, orders, renewLabel } from '../engine/orders.js';
import type { BoardPost, StoredLog, Suggestion } from '../store.js';
import { changePct, pctWord, type PeriodPriceRow } from '../engine/prices.js';

/** いちばん新しい決算の値動き (品番 → 行)。まだ無ければ空 */
export type LastPrices = Map<number, PeriodPriceRow>;

/** 秒を「18h05m」のような短い形にする */
export function dur(sec: number): string {
  if (sec <= 0) return '0m';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** 時刻を JST の「11/08 03:00」にする */
export function jst(t: number): string {
  const d = new Date((t + 9 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const pct = (rank: number) => Math.trunc(rank / 100);

/** 棚の一覧。slot は 1 始まり (行動の shelf / buy の slot・peek と同じ番号。0.3.3 までの JSON は 0 始まりだった) */
export function shelfData(g: Game, dt: Shop) {
  const out = [];
  for (let i = 0; i < dt.showcasecount; i++) {
    const no = dt.showcase[i] ?? 0;
    out.push(
      no
        ? { slot: i + 1, item: no, name: g.items[no].name, price: dt.price[i], stock: dt.item[no - 1] }
        : { slot: i + 1, item: 0, name: '', price: 0, stock: 0 },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// digest: いちばん短い要約

export interface DigestInput {
  newMine: number;
  newTown: number;
  newChat: number;
  newBbs: number;
  /** 目安箱の自分の案に返事・状態の変化があった数 */
  newReplies?: number;
  /** 郵便の未読の通数と差出人 (店名。本文は digest に載せない。1.0.0) */
  newMail?: number;
  mailFrom?: string[];
}

/**
 * 週末のクーポンの注意 (0.6.0)。曜日はクーポンが戻る時刻から数える (既定は日曜0時 JST)。
 * - 戻る2日前から (金・土) でクーポンが満タンのまま: 週末なので使いましょう
 * - 戻る1日前から (土) でクーポンが残っている: 0時までに使い切りましょう
 * 両方に当たるときは前者だけ出す。
 */
export function couponWarning(g: Game, dt: Shop): string | null {
  const max = g.config.couponTime;
  if (max <= 0) return null;
  const left = g.couponTime(dt);
  if (left <= 0) return null;
  const until = g.nextCouponTime() - g.now;
  const sw = g.couponFirst(dt) ? '' : ' (クーポンから先に使う: {"type":"coupon","first":true})';
  if (until <= 2 * 86400 && left >= max) return `そろそろ週末。時間クーポン${max / 3600}時間がまだ手つかずです。${jst(g.nextCouponTime())}に配り直され、残りは繰り越せないので早めに使いましょう${sw}`;
  if (until <= 86400) return `時間クーポンが${dur(left)}残っています。${jst(g.nextCouponTime())}に配り直され、残りは消えるので、それまでに使い切りましょう${sw}`;
  return null;
}

/** 入金庫に税が掛かりそうなときの注意 (0.6.0)。税の掛からない上限の9割から出す */
export function taxWarning(g: Game, dt: Shop): string | null {
  const line = TAX_FREE_MONEYSTOCK;
  if (dt.moneystock < line * 0.9) return null;
  const [tax, rate] = g.taxToday(dt);
  if (tax > 0) return `入金庫が${line}を超えていて、このままだと決算で税${tax} (超えた分の${rate}%) が掛かります。仕入れに使う分は決算の前に資金へ移すと税が減ります`;
  return `入金庫が税の掛からない上限${line}に近づいています (あと${line - dt.moneystock})。決算のときに超えていると、超えた分に税が掛かります`;
}

/** digest の「値動き」で知らせるしきい値 (前の決算から ±20% 以上) と、出す品の数 */
export const PRICE_MOVE_PCT = 20;
export const PRICE_MOVE_MAX = 5;

/**
 * 自分の倉庫・棚にある品のうち、相場か市場の単価が前の決算から大きく動いた品 (0.6.0)。
 * 動いた幅の大きい順に PRICE_MOVE_MAX 品まで
 */
export function priceMoves(g: Game, dt: Shop, prev: LastPrices) {
  if (!prev.size) return [];
  getMarketStatus(g);
  const whole = new Map(getWholeStore(g).map((c) => [c.itemno, c.price]));
  const mine = new Set<number>();
  for (let no = 1; no <= g.maxItem; no++) if (dt.item[no - 1]) mine.add(no);
  for (let k = 0; k < dt.showcasecount; k++) if (dt.showcase[k]) mine.add(dt.showcase[k]);
  const out: { item: number; name: string; market_change: number | null; price_change: number | null }[] = [];
  for (const no of mine) {
    const p = prev.get(no);
    if (!p || !isPublicItem(no)) continue;
    const mc = changePct(g.items[no].marketprice, p.market);
    const pc = changePct(whole.get(no) ?? 0, p.whole);
    const big = (x: number | null) => x !== null && Math.abs(x) >= PRICE_MOVE_PCT;
    if (big(mc) || big(pc)) out.push({ item: no, name: g.items[no].name, market_change: big(mc) ? mc : null, price_change: big(pc) ? pc : null });
  }
  const size = (x: (typeof out)[number]) => Math.max(Math.abs(x.market_change ?? 0), Math.abs(x.price_change ?? 0));
  return out.sort((a, b) => size(b) - size(a)).slice(0, PRICE_MOVE_MAX);
}

export function digestData(g: Game, dt: Shop, n: DigestInput, update: string | null = null, prev: LastPrices = new Map()) {
  const rankNo = g.shopIndex(dt.id) + 1;
  const stock = g.stockTime(dt);
  const full = g.config.maxStockTime - stock;
  const shelves = shelfData(g, dt);
  const warnings: string[] = [];
  for (const s of shelves) {
    if (!s.item) warnings.push(`棚${s.slot}が空`);
    else if (s.stock === 0) warnings.push(`棚${s.slot}の${s.name}が売切`);
  }
  if (full <= 0) warnings.push(`持ち時間が上限の${g.config.maxStockTime / 3600}時間に達し、これ以上たまりません。行動して使いましょう (何をするか迷ったら手引き GET /api/v1/tutorial)`);
  const cw = couponWarning(g, dt);
  if (cw) warnings.push(cw);
  const tw = taxWarning(g, dt);
  if (tw) warnings.push(tw);
  // 決算で払えないと倒産 (0.3.2)。売上を入れない見込みなので、悪いほうに見ている
  const est = periodEstimate(g, dt);
  if (est.short > 0) warnings.push(`このままだと決算で倒産の恐れ (見込み支払い${est.total}に対し資金+入金庫${est.available}、不足${est.short})`);
  // 自分の倉庫にある品を、ほかの店が募集しているか (品ごとに一番高い単価)
  const wanted = new Map<number, { item: number; name: string; price: number; orders: number }>();
  const myOrders: string[] = [];
  const discards = discardPlan(g, dt);
  for (const o of orders(g)) {
    if (o.shop === dt.id) {
      const it = g.items[o.item];
      const over = discards.get(o.id) ?? 0;
      if (over > 0) warnings.push(`募集#${o.id}を締めると${it.name}が所持上限を${over}${it.scale}超えて破棄`);
      myOrders.push(`#${o.id}${g.items[o.item].name}残${o.left}` + (o.count > o.left ? `(届${o.count - o.left})` : '') + (o.renew ? `(${renewLabel(o)})` : ''));
      continue;
    }
    if (!dt.item[o.item - 1] || !g.shopById(o.shop)) continue;
    const w = wanted.get(o.item);
    if (!w) wanted.set(o.item, { item: o.item, name: g.items[o.item].name, price: o.price, orders: 1 });
    else {
      w.orders++;
      if (o.price > w.price) w.price = o.price;
    }
  }
  // 改装中 (休業) の店は売れず決算もしないので、棚・倒産などの注意は出さず、休みの案内だけにする (1.1.0)
  const ri = restInfo(dt);
  if (ri) {
    warnings.length = 0;
    warnings.push(
      g.now < ri.reopen_from
        ? `改装中 (休業) です。${jst(ri.reopen_from)}の決算が済むと、{"type":"reopen"} かほかの行動で再開できます。${jst(ri.until)}には自動で再開します`
        : `改装中 (休業) です。{"type":"reopen"} かほかの行動で再開できます。${jst(ri.until)}には自動で再開します`,
    );
  }
  return {
    shop: dt.shopname,
    rank: rankNo,
    shops: g.shops.length,
    /** 改装中 (休業) なら {since, reopen_from, until}、営業中は null (1.1.0) */
    rest: ri,
    popularity: pct(dt.rank),
    point: dt.point,
    money: dt.money,
    moneystock: dt.moneystock,
    time: stock,
    time_full_in: full > 0 ? full : 0,
    coupon: g.couponTime(dt),
    coupon_first: g.couponFirst(dt),
    coupon_reset: g.nextCouponTime(),
    next_period: g.nextPeriodTime(),
    shelves,
    new: { mine: n.newMine, town: n.newTown, chat: n.newChat, bbs: n.newBbs, replies: n.newReplies ?? 0, mail: n.newMail ?? 0 },
    /** 未読の郵便の差出人 (店名) */
    mail_from: n.mailFrom ?? [],
    events: g.eventMessages,
    warnings,
    /** 自分が持っている品の買い取り募集 (GET /api/v1/orders で詳しく) */
    wanted: [...wanted.values()],
    my_orders: myOrders,
    /** 欲しい品 (自分の募集の品・材料だけ足りない作り方の材料) がほかの店の棚にある (engine/onshelf.ts)。{"type":"tutorial","shelf":false} で出さない */
    on_shelves: shelfNoticeOn(dt) ? onShelf(g, dt, g.now) : [],
    /** 手引きの次の段と、状況別のヒント (どちらも OFF にできる。engine/tutorial.ts) */
    tutorial: tutorialDigest(g, dt),
    /** 自分の品で、前の決算から相場・市場の単価が ±20% 以上動いたもの (0.6.0) */
    price_moves: priceMoves(g, dt, prev),
    version: APP_VERSION,
    update,
    /** 街の地図の案内 (無料の引っ越し・色変えが残っている間だけ。1.2.0) */
    town: [] as string[],
  };
}

export function digestText(d: ReturnType<typeof digestData>): string {
  const shelves = d.shelves
    .map((s) => (s.item ? `${s.slot}:${s.name}@${s.price}残${s.stock}` : `${s.slot}:空`))
    .join(' ');
  const news = [
    d.new.mine && `自分${d.new.mine}`,
    d.new.town && `街${d.new.town}`,
    d.new.chat && `井戸端${d.new.chat}`,
    d.new.bbs && `掲示板${d.new.bbs}`,
    d.new.replies && `目安箱の返事${d.new.replies}`,
    d.new.mail && `郵便${d.new.mail}(${d.mail_from.join(',')}) /api/v1/mail`,
  ].filter(Boolean);
  const lines = [
    `${d.shop} ${d.rest ? '改装中' : d.rank + '位'}/${d.shops} 人気${d.popularity}% 点${d.point} 資金${d.money} 入金庫${d.moneystock} 時間${dur(d.time)}${d.time_full_in ? '' : '(満)'}${d.coupon ? ` 券${dur(d.coupon)}${d.coupon_first ? '(優先)' : ''}` : ''} 決算${jst(d.next_period)}`,
    `棚 ${shelves}`,
  ];
  const tail: string[] = [];
  if (news.length) tail.push('新着 ' + news.join(' '));
  // 原作と同じく、イベントは説明だけ出す (残り時間は原作でも見えない)
  if (d.events.length) tail.push('イベント ' + d.events.join('/'));
  if (d.warnings.length) tail.push('注意 ' + d.warnings.join('/'));
  if (tail.length) lines.push(tail.join(' | '));
  const ords: string[] = [];
  if (d.wanted.length) ords.push('あなたの在庫が募集中 ' + d.wanted.map((w) => `${w.name}@${w.price}${w.orders > 1 ? `(${w.orders}件)` : ''}`).join(' '));
  if (d.my_orders.length) ords.push('自分の募集 ' + d.my_orders.join(' '));
  if (ords.length) lines.push(ords.join(' | '));
  if (d.price_moves.length) {
    const mv = d.price_moves.map((m) => [m.name, m.market_change !== null && `相場${pctWord(m.market_change)}`, m.price_change !== null && `単価${pctWord(m.price_change)}`].filter(Boolean).join(' '));
    lines.push(`値動き(前の決算から) ${mv.join(' / ')} 推移は /api/v1/items/品番`);
  }
  lines.push(...tutorialDigestLines(d.tutorial));
  // 欲しい品がほかの店の棚にある (品と店数だけ。単価は /shops で)
  const shelfLine = onShelfLine(d.on_shelves);
  if (shelfLine) lines.push(shelfLine);
  lines.push(...d.town);
  if (d.update) lines.push(d.update);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// me: 自分の店の詳細

export function meData(g: Game, dt: Shop) {
  getMarketStatus(g);
  const stock: { item: number; name: string; count: number; limit: number; today: number; yesterday: number; exp: number; market: number; std: number; cost: number; balance: number; shelves: number[]; durability?: number }[] = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const c = dt.item[no - 1];
    const today = dt.itemtoday[no] ?? 0;
    const yesterday = dt.itemyesterday[no] ?? 0;
    const exp = dt.exp[no] ?? 0;
    if (!c && !today && !yesterday && !exp) continue;
    const it = g.items[no];
    // std=標準価格 cost=維持費(1個24時間) balance=需要供給 (110以上で飽和・90以下で不足) shelves=並べている棚 (観戦画面の倉庫と同じ項目。0.5.0)
    const shelves: number[] = [];
    for (let k = 0; k < dt.showcasecount; k++) if (dt.showcase[k] === no) shelves.push(k + 1);
    // durability=本・地図・牛・桶の耐久% (新品100、0になるといつ壊れてもおかしくない。使ったことのあるものだけ。1.1.0)
    const durability = bookDurability(dt, no);
    stock.push({ item: no, name: it.name, count: c, limit: it.limit, today, yesterday, exp: Math.trunc(exp / 10), market: it.marketprice, std: it.price, cost: it.cost, balance: it.uppoint, shelves, ...(durability !== undefined ? { durability } : {}) });
  }
  stock.sort((a, b) => g.items[a.item].sort - g.items[b.item].sort);
  const [tax, taxrate] = g.taxToday(dt);
  return {
    id: dt.id,
    name: dt.name,
    shop: dt.shopname,
    job: jobName(dt) || '不定',
    rank: g.shopIndex(dt.id) + 1,
    popularity: pct(dt.rank),
    point: dt.point,
    money: dt.money,
    moneystock: dt.moneystock,
    deposit_max_now: maxDeposit(g, dt),
    time: g.stockTime(dt),
    time_max: g.config.maxStockTime,
    coupon: g.couponTime(dt),
    coupon_max: g.config.couponTime,
    coupon_first: g.couponFirst(dt),
    coupon_reset: g.nextCouponTime(),
    sale: { today: dt.saletoday, yesterday: dt.saleyesterday },
    pay: { today: dt.paytoday, yesterday: dt.payyesterday },
    cost: { today: Math.trunc(dt.costtoday), yesterday: dt.costyesterday, showcase: CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0 },
    tax: { sale_rate: g.userTaxRate(dt), stock_tax: tax, stock_tax_rate: taxrate },
    next_period: g.nextPeriodTime(),
    comment: dt.comment,
    // 観戦画面の店長室にある項目 (スペースで同じ画面を作れるように。0.5.0)
    wins: dt.rankingcount,
    founded_at: dt.foundation,
    // 改装中は不在閉店の時計が止まっている。再開してから数え始める
    closing_at: Math.max(dt.lastlogin, dt.rest?.until ?? 0) + g.config.expireTime + g.expireTimeExtend(dt),
    rest: restInfo(dt),
    tax_paid_today: dt.taxtoday,
    tax_yesterday: dt.taxyesterday,
    exp_total: Math.trunc(Object.values(dt.exp).reduce((a, b) => a + b, 0) / 10),
    shelves: shelfData(g, dt),
    stock,
  };
}

export function meText(d: ReturnType<typeof meData>): string {
  const lines = [
    `店 id${d.id} ${d.shop} 職業${d.job} ${d.rest ? `改装中(${jst(d.rest.until)}まで)` : d.rank + '位'} 人気${d.popularity}% 点${d.point}`,
    `資金${d.money} 入金庫${d.moneystock}(今すぐ入金できる最大${d.deposit_max_now}) 時間${dur(d.time)}/${dur(d.time_max)}${d.coupon_max ? ` 券${dur(d.coupon)}/${dur(d.coupon_max)}(${jst(d.coupon_reset)}に満タン、${d.coupon_first ? 'クーポン' : '持ち時間'}から先に使う)` : ''}`,
    `今期 売上${d.sale.today} 支払${d.pay.today} 維持費${d.cost.today}+棚${d.cost.showcase} | 前期 売上${d.sale.yesterday} 支払${d.pay.yesterday} 維持費${d.cost.yesterday} (内訳 /api/v1/costs)`,
    `税 売上税率+${d.tax.sale_rate}% 入金庫税${d.tax.stock_tax}(${d.tax.stock_tax_rate}%) 決算${jst(d.next_period)}`,
    '# 棚 番号 品番 名前 価格 在庫',
    ...d.shelves.map((s) => (s.item ? `${s.slot} ${s.item} ${s.name} ${s.price} ${s.stock}` : `${s.slot} - 空`)),
    '# 倉庫 品番 名前 数/上限 今期売/前期売 熟練% 相場',
    ...d.stock.map((s) => `${s.item} ${s.name} ${s.count}/${s.limit} ${s.today}/${s.yesterday} ${s.exp} ${s.market || '-'}`),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// market: 市場 (卸) と相場

export function marketData(g: Game, prev: LastPrices = new Map()) {
  getMarketStatus(g);
  const cases = getWholeStore(g).map((c) => {
    const it = g.items[c.itemno];
    const p = prev.get(c.itemno);
    return {
      item: c.itemno, name: it.name, stock: c.stock, price: c.price, std: it.price, market: it.marketprice, balance: it.uppoint,
      // 0.6.0: 普段の標準価格 (価格高騰のイベント中だけ std と違う)・今並んでいる棚の最安/最高・並べている店の数
      std_base: BASE_ITEMS[c.itemno].price,
      shelf_lo: it.marketprice ? it.marketpricelow : 0,
      shelf_hi: it.marketprice ? it.marketpricehigh : 0,
      shops: it.listshops,
      // 前の決算のときの値と、そこから何%動いたか (どちらかが無ければ null)
      market_prev: p?.market ?? 0,
      market_change: changePct(it.marketprice, p?.market ?? 0),
      price_prev: p?.whole ?? 0,
      price_change: changePct(c.price, p?.whole ?? 0),
    };
  });
  return { people: shownPeople(g.world), events: g.eventMessages, items: cases };
}

/** GET /api/v1/market/history: 何品かの決算ごとの値動き (0.6.0) */
export function priceHistoryText(list: { item: number; name: string; prices: ReturnType<typeof itemPricesData> }[]): string {
  const lines: string[] = [];
  for (const x of list) lines.push(`## ${x.item} ${x.name}`, ...itemPricesLines(x.prices));
  return lines.join('\n') + '\n';
}

/** 原作 GetMarketStatusGraph の文字版: 均衡/飽和/不足 */
export function balanceWord(per: number): string {
  if (!per) return '-';
  if (per >= 110) return '飽和';
  if (per <= 90) return '不足';
  return '均衡';
}

export function marketText(d: ReturnType<typeof marketData>): string {
  const lines = [
    `人口${d.people}` + (d.events.length ? ' イベント ' + d.events.join('/') : ''),
    '# 市場 品番 名前 在庫 単価 標準 相場(棚の最安〜最高・店数) 需給 前期比(単価/相場) 推移は /api/v1/items/品番',
  ];
  for (const c of d.items) {
    const std = c.std !== c.std_base ? `${c.std}(高騰中、普段${c.std_base})` : String(c.std);
    const market = c.market ? `${c.market}(${c.shelf_lo}〜${c.shelf_hi}・${c.shops}店)` : '-';
    lines.push(`${c.item} ${c.name} ${c.stock} ${c.price} ${std} ${market} ${balanceWord(c.balance)} ${pctWord(c.price_change)}/${pctWord(c.market_change)}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// shops: 他店の一覧 (原作の「他店」)

export function shopsData(g: Game, opts: { item?: number; limit: number }) {
  return g.shops
    .map((s, i) => ({
      id: s.id,
      rank: i + 1,
      shop: s.shopname,
      popularity: pct(s.rank),
      point: s.point,
      comment: s.comment,
      shelves: shelfData(g, s).filter((x) => x.item && x.stock),
    }))
    .filter((s) => !opts.item || s.shelves.some((x) => x.item === opts.item))
    .slice(0, opts.limit);
}

export function shopsText(d: ReturnType<typeof shopsData>): string {
  const lines = ['# 店 id 順位 店名 人気% 点 | 棚番号:品番:名前@価格x在庫'];
  for (const s of d) {
    const sh = s.shelves.map((x) => `${x.slot}:${x.item}:${x.name}@${x.price}x${x.stock}`).join(' ');
    lines.push(`${s.id} ${s.rank} ${s.shop} ${s.popularity} ${s.point} | ${sh || '-'}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// ranking

/** 原作 inc-html-ranking.cgi: 棚が全部同じ種類の商品なら「剣専門店」のように出す。空の棚があれば出さない */
export function specialtyType(g: Game, dt: Shop): number {
  let type = -1;
  for (const no of dt.showcase.slice(0, dt.showcasecount)) {
    const t = no ? g.items[no]?.type ?? 0 : 0;
    if (type !== -1 && t !== type) return 0;
    type = t;
  }
  return type > 0 ? type : 0;
}

/**
 * 職業の表示名。不定なら '' (原作のランキングは不定を出さない)。
 * 転職先は職業コードより細かい (革細工屋・木工細工屋・装飾細工屋はどれも道具屋) ので、
 * 転職で熟練を集める本・地図のうち熟練がいちばん高いもので「道具屋(革細工)」「武器屋(杖)」のように出す。
 * 山師は 1.3.0 で探鉱夫・木こりに分けた (括弧なしの職名)。分けられなかった山師 (熟練が並び) だけ「山師」のまま
 * いちばん高いものが並んだとき (どれも 0 を含む) は職業名だけ (案: リカさんより)
 */
export function jobName(dt: Shop): string {
  if (!dt.job) return '';
  const name = CATALOG.jobTypes[dt.job] ?? dt.job;
  const branches = JOB_BRANCHES[dt.job];
  if (!branches) return name;
  let best = '';
  let bestExp = 0;
  let tie = false;
  for (const [itemno, label] of branches) {
    const exp = dt.exp[itemno] ?? 0;
    if (exp > bestExp) {
      best = label;
      bestExp = exp;
      tie = false;
    } else if (exp === bestExp) {
      tie = true;
    }
  }
  return best && !tie ? `${name}(${best})` : name;
}
/** 職業コードごとの転職先: [熟練を集める本・地図, 括弧に出す名前] (転職のススメの並び) */
const JOB_BRANCHES: Record<string, [number, string][]> = {
  tool: [[itemNoByName('革細工入門'), '革細工'], [itemNoByName('木工細工入門'), '木工'], [itemNoByName('装飾細工入門'), '装飾']],
  weapon: [[itemNoByName('剣の鍛え方'), '剣'], [itemNoByName('杖の作り方'), '杖']],
  armor: [[itemNoByName('盾の作り方'), '盾'], [itemNoByName('鎧の作り方'), '鎧']],
};

export function rankingData(g: Game) {
  return g.shops.map((s, i) => {
    const sp = specialtyType(g, s);
    return {
      rank: i + 1,
      id: s.id,
      shop: s.shopname,
      job: jobName(s),
      specialty: sp ? CATALOG.itemTypes[sp] : '',
      point: s.point,
      popularity: pct(s.rank),
      yesterday: s.rankingyesterday,
      wins: s.rankingcount,
    };
  });
}

export function rankingText(d: ReturnType<typeof rankingData>, periodLog: { msg: string }[]): string {
  const lines = ['# 順位 店id 店名 点 人気% 前期順位 優勝回数 (店名の前は 専門店:【職業】)'];
  for (const r of d) {
    const tag = (r.specialty ? r.specialty + '専門店:' : '') + (r.job ? `【${r.job}】` : '');
    lines.push(`${r.rank} ${r.id} ${tag}${r.shop} ${r.point} ${r.popularity} ${r.yesterday || '-'} ${r.wins}`);
  }
  const result = periodLog.filter((l) => l.msg.startsWith('「')).map((l) => l.msg);
  if (result.length) lines.push('# 前回の決算', ...result);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// items: 商品の一覧と、1 品の詳しい説明
//   一覧: 品番・名前・分類・標準価格 (定義の値。イベントでは変わらない) と「入手」(←道具の品番 / 市場 / 他) だけ。
//         版が変わるまで同じなので、ETag の 304 がそのまま効く
//   詳細: 作り方 (この品が手に入る使い方の逆引き)・材料になる先・使い方 (この品を使うと何ができるか)
//   隠した品 (data/item-ref.json) は一覧で「品番 ？？？」、詳細は無い品と同じ。ほかの品の行では名前を ？？？ にする

/** 道具の品番・使い方の番号の組 */
interface UseRef {
  item: number;
  use: number;
}

/** 逆引きの索引 (定義から1回だけ作る): 品番 → その品が成果に入っている使い方 / 材料に入っている使い方 */
let reverseIndex: { madeBy: Map<number, UseRef[]>; usedIn: Map<number, UseRef[]>; version: number } | undefined;

function reverse() {
  if (reverseIndex && reverseIndex.version === itemVisibilityVersion()) return reverseIndex;
  const madeBy = new Map<number, UseRef[]>();
  const usedIn = new Map<number, UseRef[]>();
  const push = (m: Map<number, UseRef[]>, no: number, r: UseRef) => {
    const list = m.get(no) ?? m.set(no, []).get(no)!;
    if (!list.some((x) => x.item === r.item && x.use === r.use)) list.push(r);
  };
  for (let no = 1; no <= MAX_ITEM; no++) {
    const it = BASE_ITEMS[no];
    if (!it || !isPublicItem(no)) continue; // 隠した品の使い方は、どこにも逆引きで出さない
    for (const u of it.uses) {
      if (!u.get.every((l) => isPublicItem(l.item_no)) || makesHiddenItem(no, u.no)) continue; // 隠した品が出る使い方は無いものとして扱う
      for (const l of u.get) push(madeBy, l.item_no, { item: no, use: u.no });
      for (const l of u.use) if (l.item_no !== no) push(usedIn, l.item_no, { item: no, use: u.no });
    }
  }
  for (let no = 1; no <= MAX_ITEM; no++) {
    for (const [item, use] of itemNote(no).from) if (isPublicItem(item)) push(madeBy, no, { item, use });
  }
  reverseIndex = { madeBy, usedIn, version: itemVisibilityVersion() };
  return reverseIndex;
}

/** 名前 (隠した品は ？？？) */
function shownName(no: number): string {
  return itemVisibility(no) === 'hidden' ? HIDDEN_NAME : BASE_ITEMS[no]?.name ?? '';
}

/** 一覧と詳細に共通の「入手」: 逆引きの道具の品番・市場に入ってくるか・それ以外 */
function sourceOf(no: number) {
  const from = [...new Set((reverse().madeBy.get(no) ?? []).map((r) => r.item))];
  const market = BASE_ITEMS[no].plus > 0;
  return { from, market, other: !from.length && !market };
}

export function itemsData(g: Game, filter: { type?: string; q?: string } = {}) {
  const out = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const vis = itemVisibility(no);
    if (vis === 'hidden') {
      if (!filter.type && !filter.q) out.push({ item: no, name: HIDDEN_NAME, hidden: true as const });
      continue;
    }
    const it = BASE_ITEMS[no];
    const type = CATALOG.itemTypes[it.type];
    if (filter.type && type !== filter.type) continue;
    if (filter.q && !it.name.includes(filter.q)) continue;
    if (vis === 'teaser') {
      out.push({ item: no, name: it.name, teaser: true as const });
      continue;
    }
    const src = sourceOf(no);
    out.push({
      item: no,
      name: it.name,
      type,
      price: it.price,
      cost: it.cost,
      limit: it.limit,
      from: src.from,
      market: src.market,
      flags: flagWords(it.flag),
    });
  }
  return out;
}

function flagWords(flag: string): string[] {
  const out: string[] = [];
  if (flag.includes('s')) out.push('陳列不可');
  if (flag.includes('b')) out.push('他店から購入不可');
  if (flag.includes('t')) out.push('処分不可');
  return out;
}

function sourceWord(from: number[], market: boolean): string {
  const w = [from.length ? '←' + from.join(',') : '', market ? '市場' : ''].filter(Boolean).join(' ');
  return w || '他';
}

export function itemsText(d: ReturnType<typeof itemsData>): string {
  const lines = ['# 商品 品番 名前 分類 標準価格 維持費/日 上限 入手(←N=品番Nの使い方で手に入る/市場/他) 注記。作り方は GET /api/v1/items/品番'];
  for (const i of d) {
    if ('hidden' in i) lines.push(`${i.item} ${i.name}`);
    else if ('teaser' in i) lines.push(`${i.item} ${i.name} 予告`);
    else lines.push(`${i.item} ${i.name} ${i.type} ${i.price} ${i.cost} ${i.limit} ${sourceWord(i.from, i.market)}${i.flags.length ? ' ' + i.flags.join(',') : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** 品番か名前 (商品コードも可) から、詳細を見せてよい品番。隠した品・無い品は undefined */
export function findItem(key: string): number | undefined {
  const k = key.trim();
  let no: number | undefined;
  if (/^\d+$/.test(k)) no = Number(k);
  else {
    for (let i = 1; i <= MAX_ITEM; i++) if (BASE_ITEMS[i] && (BASE_ITEMS[i].name === k || BASE_ITEMS[i].code === k)) no = i;
  }
  if (no === undefined || no < 1 || no > MAX_ITEM || itemVisibility(no) === 'hidden') return undefined;
  return no;
}

/** 職業の補正の言葉 (例: 探鉱夫・元山師 時間1/2) */
function jobWords(u: RtUse): string[] {
  return u.def.jobs.map((j) => {
    // 元山師 (1.3.0 より前の山師) は探鉱夫・木こりの両方のボーナスが付く (engine/jobs.ts)
    const who = (CATALOG.jobTypes[j.job] ?? j.job) + (j.job === 'mine' || j.job === 'wood' ? '・元山師' : '');
    const what = j.key === 'times' || j.key === 'time' ? '時間' : j.key === 'money' ? '費用' : j.key;
    const how = j.op === '/' ? `1/${j.value}` : j.op === '*' ? `×${j.value}` : j.op === '=' ? `=${j.value}` : `${j.op}${j.value}`;
    return `${who} ${what}${how}`;
  });
}

const lineOut = (l: { no: number; count: number; proba: number }, key: 'consume' | 'chance') => ({ item: l.no, name: shownName(l.no), count: l.count, [key]: l.proba / 10 }) as { item: number; name: string; count: number } & Record<typeof key, number>;

/** 作り方の1行 (道具 tool の使い方 useNo)。dt があれば、その店での時間と今使えるかも付ける */
function recipeData(g: Game, tool: number, useNo: number, dt?: Shop) {
  const uses = dt ? checkUses(g, dt, loadUses(g, tool)) : loadUses(g, tool);
  const u = uses.find((x) => x.no === useNo);
  if (!u) return undefined;
  const skill = u.expno;
  const owned = !!dt && (dt.item[tool - 1] ?? 0) > 0;
  // 職業の補正は店ごとに checkUses が time に掛ける。定義の時間は補正前で出す
  return {
    item: tool,
    tool: shownName(tool),
    use: u.no,
    name: u.name,
    time: u.def.time,
    time_skilled: u.def.exptime,
    money: u.money,
    needs: u.use.map((l) => lineOut(l, 'consume')),
    gets: u.result.create.map((l) => lineOut(l, 'chance')),
    skill_item: { item: skill, name: shownName(skill) },
    needexp: Math.trunc(u.needexp / 10),
    jobs: jobWords(u),
    ...(dt ? { my_time: itemUseTime(dt, u), usable: owned && !!u.useok } : {}),
    ...(dt && !owned ? { why: `${shownName(tool)}を持っていません` } : dt && !u.useok && u.ngReason ? { why: u.ngReason } : {}),
  };
}

/**
 * 1 商品の詳しい説明。dt があれば、その店での時間と今使えるかも付ける。
 * 隠した品は呼ぶ前に findItem で弾く。予告の品は teaserText を返す
 */
/**
 * 1品の値動き (0.6.0)。今の値・今期ここまでの最安/最高・決算ごとの記録 (新しい順)。
 * history は保存側から渡す (渡さなければ空)
 */
export function itemPricesData(g: Game, itemno: number, history: PeriodPriceRow[] = []) {
  getMarketStatus(g);
  const it = g.items[itemno];
  const wh = getWholeStore(g).find((c) => c.itemno === itemno);
  const st = g.world.mstat;
  const e = st?.items[itemno];
  return {
    std: it.price,
    std_base: BASE_ITEMS[itemno].price,
    market: it.marketprice,
    shelf_lo: it.marketprice ? it.marketpricelow : 0,
    shelf_hi: it.marketprice ? it.marketpricehigh : 0,
    shops: it.listshops,
    balance: it.marketprice ? it.uppoint : 0,
    whole: wh?.price ?? 0,
    whole_stock: g.world.wholestore[itemno - 1] ?? 0,
    this_period: { since: st?.since ?? 0, market_lo: e?.[0] ?? 0, market_hi: e?.[1] ?? 0, whole_lo: e?.[2] ?? 0, whole_hi: e?.[3] ?? 0 },
    history,
  };
}

export function itemPricesLines(p: ReturnType<typeof itemPricesData>): string[] {
  const range = (lo: number, hi: number) => (lo ? (lo === hi ? String(lo) : `${lo}〜${hi}`) : '-');
  const now = [
    `標準${p.std}${p.std !== p.std_base ? `(高騰中、普段${p.std_base})` : ''}`,
    p.market ? `相場${p.market}(棚${range(p.shelf_lo, p.shelf_hi)}・${p.shops}店・${balanceWord(p.balance)})` : '相場-(どの店にも並んでいない)',
    p.whole ? `市場の単価${p.whole}(在庫${p.whole_stock})` : '市場に在庫なし',
  ];
  const lines = ['# 値動き 今: ' + now.join(' ')];
  const t = p.this_period;
  if (t.since) lines.push(`今期(${jst(t.since)}から) 相場${range(t.market_lo, t.market_hi)} 市場の単価${range(t.whole_lo, t.whole_hi)}`);
  if (p.history.length) {
    lines.push('# 決算ごと 決算 相場(期中の最安〜最高) 市場の単価(最安〜最高) 市場在庫 街で売れた数 並べた店 標準');
    for (const h of p.history) {
      // 決算のときの値 (期中の最安〜最高)。期中に一度も見ていなければ '-' だけ
      const cell = (v: number, lo: number, hi: number) => (lo ? `${v || '-'}(${range(lo, hi)})` : '-');
      const m = cell(h.market, h.market_lo, h.market_hi);
      const w = cell(h.whole, h.whole_lo, h.whole_hi);
      lines.push(`${jst(h.at)} ${m} ${w} ${h.whole_stock} ${h.sold} ${h.shops}店 ${h.std}`);
    }
  } else lines.push('決算ごとの記録はまだありません (0.6.0 にしてから最初の決算で記録が始まります)');
  return lines;
}

export function itemDetailData(g: Game, itemno: number, dt?: Shop, history?: PeriodPriceRow[]) {
  const it = g.items[itemno];
  const base = BASE_ITEMS[itemno];
  const uses = dt ? checkUses(g, dt, loadUses(g, itemno)) : loadUses(g, itemno);
  const owned = !!dt && (dt.item[itemno - 1] ?? 0) > 0;
  const rev = reverse();
  const src = sourceOf(itemno);
  const note = itemNote(itemno).note;
  return {
    item: itemno,
    name: it.name,
    info: it.info,
    type: CATALOG.itemTypes[it.type],
    price: base.price,
    ...(it.price !== base.price ? { price_now: it.price } : {}),
    cost: it.cost,
    limit: it.limit,
    flags: flagWords(it.flag),
    market: src.market,
    ...(note ? { note } : {}),
    /** 値動き (0.6.0)。history を渡したときだけ */
    ...(history ? { prices: itemPricesData(g, itemno, history) } : {}),
    ...(it.expitem ? { skill_item: { item: it.expitem, name: shownName(it.expitem) } } : {}),
    made_by: (rev.madeBy.get(itemno) ?? []).map((r) => recipeData(g, r.item, r.use, dt)).filter((x) => x !== undefined),
    used_in: (rev.usedIn.get(itemno) ?? []).map((r) => ({ item: r.item, tool: shownName(r.item), use: r.use, name: BASE_ITEMS[r.item].uses.find((u) => u.no === r.use)?.name ?? '' })),
    uses: uses.map((u) => ({
      use: u.no,
      name: u.name,
      info: u.def.info ?? '',
      time: dt ? itemUseTime(dt, u) : u.time,
      money: u.money,
      exp: Math.trunc(u.exp / 10),
      needexp: Math.trunc(u.needexp / 10),
      needs: u.use.map((l) => lineOut(l, 'consume')),
      gets: u.result.create.map((l) => lineOut(l, 'chance')),
      target: u.argspec.includes('target'),
      message: u.argspec.includes('message'),
      one_at_a_time: u.argspec.includes('nocount'),
      // 使う品そのものを持っていなければ使えない (本・地図など、材料の行に自分が入っていない品も) (監査 A13)
      usable: dt ? owned && !!u.useok : undefined,
      ...(dt && !owned ? { why: `${it.name}を持っていません` } : dt && !u.useok && u.ngReason ? { why: u.ngReason } : {}),
    })),
  };
}

const needsText = (needs: { name: string; count: number; consume: number }[]) =>
  needs.map((n) => `${n.name}x${n.count}${n.consume === 100 ? '' : n.consume === 0 ? '(消費しない)' : `(${n.consume}%で消費)`}`).join(',') || '-';
const getsText = (gets: { name: string; count: number; chance: number }[]) =>
  gets.map((n) => `${n.name}x${n.count}${n.chance === 100 ? '' : `(${n.chance}%)`}`).join(',') || '-';

/** 予告の品 (item-ref.json の teaser) の詳細: 名前だけ */
export function teaserData(itemno: number) {
  return { item: itemno, name: BASE_ITEMS[itemno].name, teaser: true as const };
}

export function teaserText(d: ReturnType<typeof teaserData>): string {
  return `${d.item} ${d.name} は準備中です\n`;
}

export function itemDetailText(d: ReturnType<typeof itemDetailData>): string {
  const lines = [
    `${d.item} ${d.name} (${d.type}) 標準${d.price}${d.price_now !== undefined ? `(いまは${d.price_now})` : ''} 維持費${d.cost} 上限${d.limit}${d.flags.length ? ' ' + d.flags.join(',') : ''}`,
    d.info,
  ];
  const how = [d.market && '市場に入ってくる', d.note].filter(Boolean).join('。');
  if (how) lines.push('入手: ' + how);
  if (d.prices) lines.push(...itemPricesLines(d.prices));
  if (d.skill_item) lines.push(`熟練は${d.skill_item.name}と共通 (時間の縮み・増える熟練は${d.skill_item.name}の熟練)`);
  if (d.made_by.length) {
    lines.push('# 作り方 道具/番号 使い方 時間(熟練0%→100%) 費用 | 材料 → 成果 | 熟練の持ち主 要熟練 職業補正');
    for (const r of d.made_by) {
      const me = r.my_time !== undefined ? ` あなた${dur(r.my_time)}` : '';
      const ng = r.usable === false ? ` 今は使えない${r.why ? `(${r.why})` : ''}` : '';
      lines.push(
        `${r.item}${r.tool}/${r.use} ${r.name} ${dur(r.time)}→${dur(r.time_skilled)}${me} ${r.money} | ${needsText(r.needs)} → ${getsText(r.gets)} | ${r.skill_item.name}${r.needexp ? ` 要${r.needexp}%` : ''}${r.jobs.length ? ' ' + r.jobs.join(',') : ''}${ng}`,
      );
    }
  }
  if (d.used_in.length) lines.push('# 材料になる先 ' + d.used_in.map((u) => `${u.item}${u.tool}/${u.use}${u.name}`).join(', '));
  if (d.uses.length) lines.push('# 使い方 番号 名前 時間 費用 | 材料 → 成果 | 熟練');
  for (const u of d.uses) {
    const extra = [u.target && '要標的', u.message && '一言可', u.one_at_a_time && '1回ずつ', u.usable === false && (u.why ? `今は使えない(${u.why})` : '今は使えない')].filter(Boolean).join(',');
    lines.push(`${u.use} ${u.name} ${dur(u.time)} ${u.money} | ${needsText(u.needs)} → ${getsText(u.gets)} | +${u.exp}%${u.needexp ? ` 要${u.needexp}%` : ''}${extra ? ' ' + extra : ''}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// log / 掲示板

const MODE_WORD = ['', '重要', '街', '噂'];

export function logText(logs: StoredLog[]): string {
  if (!logs.length) return '新しい出来事はありません\n';
  return logs.map((l) => `${l.id} ${jst(l.time)} ${l.from ? '自' : MODE_WORD[l.mode] || '街'} ${l.msg}`).join('\n') + '\n';
}

export function postsText(posts: BoardPost[]): string {
  if (!posts.length) return '新しい書き込みはありません\n';
  return posts.map((p) => `${p.id} ${jst(p.time)} ${p.shopname}(id${p.shop_id}): ${p.msg}`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 目安箱

const STATUS_JA: Record<string, string> = { open: '未読', seen: '読んだ', accepted: '採用', done: '実装済み', rejected: '見送り' };
export const CATEGORY_JA: Record<string, string> = { feature: '追加実装', bug: '不具合', balance: '調整', other: 'その他' };

export function suggestionsText(list: Suggestion[], admin = false): string {
  if (!list.length) return admin ? '案はありません\n' : 'まだ案を出していません。POST /api/v1/suggest {"text":"..."}\n';
  return (
    list
      .map((s) => {
        const head = `#${s.id} ${jst(s.time)} [${CATEGORY_JA[s.category] ?? s.category}] ${STATUS_JA[s.status] ?? s.status}${admin ? ` 店${s.shop_id} ${s.shopname}` : ''}`;
        return head + '\n  ' + s.text.replace(/\n/g, '\n  ') + (s.reply ? '\n  → ' + s.reply.replace(/\n/g, '\n    ') : '');
      })
      .join('\n') + '\n'
  );
}

// ---------------------------------------------------------------------------
// orders: 買い取り募集の一覧

export function ordersData(g: Game, dt: Shop | undefined, opt: { item?: number; mine?: boolean }) {
  let list = orders(g).filter((o) => g.shopById(o.shop));
  if (opt.item) list = list.filter((o) => o.item === opt.item);
  if (opt.mine && dt) list = list.filter((o) => o.shop === dt.id);
  list = [...list].sort((a, b) => a.item - b.item || b.price - a.price || a.id - b.id);
  const stats = orderStats(g);
  return {
    orders: list.map((o) => ({ ...orderView(g, o), have: dt ? dt.item[o.item - 1] : undefined })),
    today: dt
      ? {
          posted: stats.posted[dt.id] ?? 0,
          posts_max: dt.showcasecount * ORDER_RULES.postsPerShelf,
          open: orders(g).filter((o) => o.shop === dt.id).length,
          open_max: dt.showcasecount,
          filled: stats.filled[dt.id] ?? 0,
          fills_max: ORDER_RULES.fillsPerDay,
          delivered_to: Object.keys(stats.pairs)
            .filter((k) => k.startsWith(dt.id + '>'))
            .map((k) => Number(k.split('>')[1])),
        }
      : undefined,
  };
}

export function ordersText(d: ReturnType<typeof ordersData>): string {
  const lines = d.orders.map(
    (o) =>
      `#${o.id} ${o.name}@${o.price}(${o.percent}%) 残${o.left}/${o.count}${o.min ? ` 最低${o.min}` : ''} ${o.shopname}(${o.shop_id}) 〆${jst(o.expires)}${o.renew !== 'none' ? ` ${renewLabel(o)}` : ''}` +
      (o.have ? ` 在庫${o.have}` : ''),
  );
  if (!lines.length) lines.push('募集はありません');
  lines.unshift(ORDER_RULES_LINE + ORDER_RENEW_LINE);
  if (d.today) {
    const t = d.today;
    lines.push(
      `今期 募集${t.posted}/${t.posts_max}回 掲示中${t.open}/${t.open_max}件 応じた${t.filled}/${t.fills_max}種類` +
        (t.delivered_to.length ? ` 納品済みの相手 ${t.delivered_to.join(',')}` : ''),
    );
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// peek: 番犬スクリプト向けの見張り (読むだけ)

export function peekText(d: ReturnType<typeof peekData>, fresh: Alert[], cursor: string, withFacts = false): string {
  const lines = [`as_of ${d.as_of} age ${d.age}s cursor ${cursor || '-'}` + (d.next_timed ? ` next_timed ${d.next_timed}` : '')];
  const freshKeys = new Set(fresh.map((a) => a.key));
  for (const a of d.alerts) lines.push(`${freshKeys.has(a.key) ? 'NEW' : 'OLD'} ${a.level} ${a.type} ${a.msg}`);
  if (!d.alerts.length) lines.push('アラートなし');
  if (withFacts) {
    // facts=1 のときは判断の材料も (時刻は UNIX 秒、長さは秒)
    const f = d.facts;
    const p = f.period;
    lines.push('--- facts');
    lines.push(`人気 ${f.popularity}% 資金 ${f.money} 入金庫 ${f.moneystock} 持ち時間 ${f.time}s (満タンまで ${f.time_full_in}s) クーポン ${f.coupon}s (戻る ${f.coupon_reset})`);
    lines.push(`${p.pending ? '決算(時刻を過ぎて未反映)' : '次の決算'} ${p.next_period} 見込み支払い ${p.total} (維持費${p.cost_projected}+棚${p.showcase_cost}+税${p.tax}) 払える額 ${p.available} 不足 ${p.short}`);
    lines.push(`不在閉店 ${f.closing_at}`);
    for (const sh of f.shelves) {
      lines.push(`棚${sh.slot} ` + (sh.item ? `${sh.name} ￥${sh.price} 残${sh.stock}` + (sh.empty_in !== null ? ` 空くまで${sh.empty_in}s` : '') : '空'));
    }
    for (const e of f.events) lines.push(`イベント ${e.mine ? '[自分の品] ' : ''}${e.info}`);
  }
  return lines.join('\n') + '\n';
}
