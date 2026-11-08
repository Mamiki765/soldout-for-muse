// SOLD OUT for Muse — 1 回のリクエスト処理で使う「場」。
// 原作ではリクエストごとに data.cgi と商品データを読み込み、グローバル変数 ($DT, @DT, @ITEM ...)
// で処理していた。この移植ではそれを Game オブジェクトにまとめる。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS, CATALOG, EVENTS, MAX_ITEM, type ItemDef } from '../data/catalog.js';
import type { GameConfig } from '../config.js';
import type { LogEntry, Shop, World } from './types.js';
import type { Rng } from './rng.js';

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
  /** 開催中イベント (説明と終わる時刻) */
  readonly activeEvents: { code: string; info: string; endsAt: number }[] = [];
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
    this.activeEvents.push({ code, info: ev.info ?? code, endsAt: this.world.events[code] ?? 0 });
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

  /** 原作 UseTime: 持ち時間を tm 秒使う */
  useTime(tm: number, user = true): void {
    const dt = this.dt;
    if (!dt || !dt.status) return;
    const tmp = this.now - dt.time;
    if (tmp > this.config.maxStockTime) dt.time = this.now - this.config.maxStockTime;
    if (tmp < 0 && user) throw new GameError('時間待ちでしょ？');
    dt.time += tm;
  }

  /** 原作 GetStockTime: 持ち時間 (秒) */
  stockTime(dt: Shop): number {
    const tmp = this.now - dt.time;
    return tmp > this.config.maxStockTime ? this.config.maxStockTime : tmp;
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
