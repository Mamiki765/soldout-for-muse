// SOLD OUT for Muse — 1 回のリクエスト処理で使う「場」。
// 原作ではリクエストごとに data.cgi と商品データを読み込み、グローバル変数 ($DT, @DT, @ITEM ...)
// で処理していた。この移植ではそれを Game オブジェクトにまとめる。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS, CATALOG, EVENTS, MAX_ITEM, type ItemDef } from '../data/catalog.js';
import type { GameConfig } from '../config.js';
import type { LogEntry, Shop, World } from './types.js';
import type { Rng } from './rng.js';

/** 時間クーポンの保存先 (Shop.user)。配られた週の開始時刻と残り秒 */
export const COUPON_WEEK = '_coupon_week';
export const COUPON_LEFT = '_coupon_left';

/** リクエスト中の商品。原作の @ITEM の要素。イベントでパラメータが変わり、計算用の一時値も持つ。 */
export interface RtItem extends ItemDef {
  // 以下は売上計算や相場計算の一時値 (原作でも保存しない)
  buypeoplebase: number;
  buypeople: number;
  todaystock: number;
  todayprice: number;
  todaysale: number;
  yesterdaysale: number;
  marketprice: number;
  marketpricelow: number;
  marketpricehigh: number;
  uppoint: number;
}

/** 行動の失敗。原作の OutError に相当する。 */
export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

export class Game {
  readonly world: World;
  readonly config: GameConfig;
  readonly rng: Rng;
  /** 現在時刻 ($NOW_TIME) */
  readonly now: number;
  /** 商品 (@ITEM)。index 0 はダミー */
  readonly items: RtItem[];
  /** 開催中イベントの説明 (@EVENTMSG) */
  readonly eventMessages: string[] = [];

  /** 操作中の店 ($DT)。行動しない処理では undefined */
  dt: Shop | undefined;
  /** 仕入時間。店や職業で変わる ($TIME_SEND_ITEM) */
  timeSendItem: number = CATALOG.timeSendItem;
  /** 決算処理中かどうか ($PERIOD_MODE) */
  periodMode = false;
  /** このリクエストで増えた最近の出来事。保存側がまとめて書き込む */
  readonly newLogs: LogEntry[] = [];

  constructor(world: World, config: GameConfig, rng: Rng, now: number) {
    this.world = world;
    this.config = config;
    this.rng = rng;
    this.now = now;
    this.items = BASE_ITEMS.map((it) => (it ? newRtItem(it) : (undefined as unknown as RtItem)));
    // 原作 DataRead: 開催中イベントのファイルを require して商品パラメータを書き換える
    for (const code of Object.keys(world.events)) this.applyEvent(code);
  }

  get maxItem(): number {
    return MAX_ITEM;
  }

  get maxMoney(): number {
    return CATALOG.maxMoney;
  }

  /** 原作 data/item/event/<code>.cgi の処理 */
  private applyEvent(code: string): void {
    const ev = EVENTS.get(code);
    if (!ev) return;
    if (ev.info) this.eventMessages.push(ev.info);
    for (const p of ev.params) {
      const item = this.items[p.item_no] as unknown as Record<string, number>;
      if (!item) continue;
      const cur = Number(item[p.key] ?? 0);
      switch (p.op) {
        case '+': item[p.key] = cur + p.value; break;
        case '-': item[p.key] = cur - p.value; break;
        case '*': item[p.key] = cur * p.value; break;
        case '/': item[p.key] = Math.trunc(cur / p.value); break;
        case '=': item[p.key] = p.value; break;
        default: throw new Error('未知のイベント演算子: ' + p.op);
      }
    }
  }

  /** Perl の rand(n) */
  rand(n = 1): number {
    return this.rng.next() * n;
  }

  /** 営業中の店 (@DT) */
  get shops(): Shop[] {
    return this.world.shops;
  }

  shopById(id: number): Shop | undefined {
    return this.world.shops.find((s) => s.id === id && s.status);
  }

  /** 店の順位 (0 始まり)。原作の $id2idx{$id} */
  shopIndex(id: number): number {
    return this.world.shops.findIndex((s) => s.id === id);
  }

  /** 原作 WriteLog($mode,$from,$to,$msg) (最近の出来事) */
  writeLog(mode: number, from: number, to: number, msg: string): void {
    const entry: LogEntry = { time: this.now, mode, from, to, msg };
    if (this.periodMode) this.world.periodLog.push(entry);
    this.newLogs.push(entry);
  }

  /** 原作 GetDTPoint */
  getPoint(dt: Shop): number {
    return Math.trunc(
      dt.rank *
        ((dt.profitstock * 2 + dt.saletoday - dt.taxtoday + dt.saleyesterday - dt.taxyesterday) / 400000 + 1),
    );
  }

  /** 原作 SortDT: 閉店した店を除き、前期順位のある店を先に、点数の高い順に並べる */
  sortShops(): void {
    const shops = this.world.shops.filter((s) => s.status);
    for (const s of shops) s.point = this.getPoint(s);
    // Perl の sort は安定ソート (5.8 以降は mergesort)
    shops.sort((a, b) => {
      const na = a.rankingyesterday ? 0 : 1;
      const nb = b.rankingyesterday ? 0 : 1;
      if (na !== nb) return na - nb;
      return b.point - a.point;
    });
    this.world.shops = shops;
  }

  /** 原作 CloseShop。郵便の処理はこの移植では未実装 */
  closeShop(id: number, _mode: string): void {
    const dt = this.world.shops.find((s) => s.id === id);
    if (!dt) return;
    dt.status = 0;
    dt.money = 0;
    dt.rank = 0;
  }

  /**
   * 原作 UseTime: 持ち時間を tm 秒使う。
   * この移植では週1の時間クーポンから先に使い、足りない分を持ち時間から使う。
   * 戻り値はクーポンから使った秒数。
   */
  useTime(tm: number, user = true): number {
    const dt = this.dt;
    if (!dt || !dt.status) return 0;
    const tmp = this.now - dt.time;
    if (tmp > this.config.maxStockTime) dt.time = this.now - this.config.maxStockTime;
    const coupon = this.couponTime(dt);
    if (tmp < 0 && user && coupon <= 0) throw new GameError('時間待ちでしょ？ (持ち時間が足りません。時間は実際の時間と同じ速さで回復します)');
    const fromCoupon = Math.max(0, Math.min(coupon, tm));
    if (this.config.couponTime > 0) {
      dt.user[COUPON_WEEK] = String(this.couponWeekStart());
      dt.user[COUPON_LEFT] = String(coupon - fromCoupon);
    }
    dt.time += tm - fromCoupon;
    return fromCoupon;
  }

  /**
   * 使った時間を戻す (買い取り募集の取り下げなど)。
   * クーポンから払った分 coupon は、払った週 week が今週ならクーポンへ戻し、週が変わっていれば捨てる。残りは持ち時間へ。
   */
  refundTime(dt: Shop, tm: number, coupon = 0, week = 0): void {
    const c = Math.max(0, Math.min(coupon, tm));
    dt.time -= tm - c;
    if (c > 0 && this.config.couponTime > 0 && week === this.couponWeekStart()) {
      dt.user[COUPON_WEEK] = String(week);
      dt.user[COUPON_LEFT] = String(Math.min(this.config.couponTime, this.couponTime(dt) + c));
    }
  }

  /** 原作 GetStockTime: 持ち時間 (秒)。クーポンは含まない */
  stockTime(dt: Shop): number {
    const tmp = this.now - dt.time;
    return tmp > this.config.maxStockTime ? this.config.maxStockTime : tmp;
  }

  /** 今週の時間クーポンの残り (秒)。週が変わっていれば満タン (新しい店も満タンから) */
  couponTime(dt: Shop): number {
    if (this.config.couponTime <= 0) return 0;
    if (Number(dt.user[COUPON_WEEK] ?? 0) !== this.couponWeekStart()) return this.config.couponTime;
    const left = Number(dt.user[COUPON_LEFT] ?? 0);
    return Number.isFinite(left) && left > 0 ? Math.min(left, this.config.couponTime) : 0;
  }

  /** 行動に使える時間 = クーポン残り + 持ち時間 (秒) */
  usableTime(dt: Shop): number {
    return this.couponTime(dt) + this.stockTime(dt);
  }

  /** 今週のクーポンが配られた時刻 (直近の couponWeekday 曜 couponHour 時) */
  couponWeekStart(now = this.now): number {
    const shift = this.config.tzOffset - this.config.couponHour * 3600;
    const days = Math.floor((now + shift) / 86400);
    // 1970-01-01 は木曜 (4)
    const back = (((days + 4 - this.config.couponWeekday) % 7) + 7) % 7;
    return (days - back) * 86400 - shift;
  }

  /** 次にクーポンが戻る時刻 */
  nextCouponTime(): number {
    return this.couponWeekStart() + 7 * 86400;
  }

  /** 原作 CheckItemFlag */
  itemFlag(itemno: number, flag: 'noshowcase' | 'nosend' | 'notradeout' | 'notradein' | 'notrash' | 'nobuy'): boolean {
    if (itemno < 0 || itemno > this.maxItem) return false;
    const letter = { noshowcase: 's', nosend: 'm', notradeout: 'e', notradein: 'i', notrash: 't', nobuy: 'b' }[flag];
    return (this.items[itemno]?.flag ?? '').includes(letter);
  }

  /** 原作 AddItem($DT,$itemno,$count): 上限まで追加し、追加できた数を返す */
  addItem(dt: Shop, itemno: number, count: number): number {
    const limit = this.items[itemno].limit;
    if (dt.item[itemno - 1] + count > limit) count = limit - dt.item[itemno - 1];
    dt.item[itemno - 1] += count;
    return count;
  }

  /** 原作 GetUserTaxRate */
  userTaxRate(dt: Shop): number {
    let taxrate = Math.trunc(dt.profitstock / 20000);
    if (taxrate < 0) taxrate = 0;
    if (taxrate > 50) taxrate = 50;
    return taxrate;
  }

  /** 原作 GetSaleTax。[税率, 税額] */
  saleTax(itemno: number, itemcnt: number, price: number, plustaxrate: number): [number, number] {
    const std = this.items[itemno].price;
    let taxrate = std && itemcnt ? price / itemcnt / std - 1 : 0;
    if (taxrate > 0) taxrate = taxrate ** 2 * 5;
    let taxratedown = 1;
    // 原作は「$taxratedown=$taxrate+1,$raxrate=0」(変数名の書き間違いで taxrate は 0 にならない)。そのまま再現する
    if (taxrate < 0) taxratedown = taxrate + 1;
    taxrate = Math.trunc((taxrate + plustaxrate) * taxratedown);
    if (taxrate > 99) taxrate = 99;
    const tax = Math.trunc((price * taxrate) / 100);
    return [taxrate, tax];
  }

  /** 原作 GetTaxToday: 入金庫の残高にかかる税。[税額, 税率] */
  taxToday(dt: Shop): [number, number] {
    let tax = dt.moneystock - 1000000;
    let taxrate = 0;
    if (tax < 0) tax = 0;
    if (tax) {
      taxrate = 10 + Math.trunc(tax / 1000000);
      if (taxrate > 80) taxrate = 80;
      tax = Math.trunc((tax * taxrate) / 100);
    }
    return [tax, taxrate];
  }

  /** 原作 GetTimeDeal: 取引にかかる時間 */
  timeDeal(price: number, itemno?: number, itemcount?: number): number {
    if (!itemno) {
      if (!price) return 0;
      if (!CATALOG.timeSendMoneyPlus) return CATALOG.timeSendMoney;
      return Math.trunc((CATALOG.timeSendMoney * price) / CATALOG.timeSendMoneyPlus) + CATALOG.timeSendMoney;
    }
    if (!itemcount) return 0;
    const std = this.items[itemno].price;
    let mul = 1;
    if (price && std) mul = std / (price / itemcount);
    if ((!price && std) || mul > 20) mul = 20;
    return Math.trunc(this.timeSendItem * mul);
  }

  /** 原作 GetExpireTimeExtend */
  /** 市場の入荷量の式に入れる店舗数 (原作の $MAX_USER の位置)。50, 100, 150… と、店数が収まる50の倍数 */
  marketUsers(): number {
    const step = this.config.marketUserBase;
    return Math.max(1, Math.ceil(this.shops.length / step)) * step;
  }

  expireTimeExtend(dt: Shop): number {
    let ex = Math.trunc((dt.lastlogin - dt.foundation) / 86400) * this.config.expireExTime;
    if (ex > this.config.expireMaxTime) ex = this.config.expireMaxTime;
    return ex;
  }

  /** 次回決算の時刻 */
  nextPeriodTime(): number {
    const offset = this.config.tzOffset - this.config.dateReviseTime;
    const now = this.world.lasttime + offset;
    const next = now + this.config.oneDayTime - (now % this.config.oneDayTime);
    return next - offset;
  }
}

function newRtItem(def: ItemDef): RtItem {
  return {
    ...def,
    buypeoplebase: 0,
    buypeople: 0,
    todaystock: 0,
    todayprice: 0,
    todaysale: 0,
    yesterdaysale: 0,
    marketprice: 0,
    marketpricelow: 0,
    marketpricehigh: 0,
    uppoint: 0,
  };
}
