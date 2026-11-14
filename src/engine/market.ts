// SOLD OUT for Muse — 市場 (卸) と相場。原作 auto/market.cgi, auto/whole.cgi の移植。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { Game } from './game.js';

/** 原作 GetMarketStatus: 陳列在庫・相場・需要供給バランス(uppoint)を計算して @ITEM に書き込む */
export function getMarketStatus(g: Game): void {
  const listed = new Set<number>();
  for (const item of g.items) {
    if (!item) continue;
    item.todaystock = 0;
    item.todayprice = 0;
    item.todaysale = 0;
    item.yesterdaysale = 0;
    item.marketprice = 0;
    item.uppoint = 0;
  }
  for (const dt of g.shops) {
    for (let caseno = 0; caseno < dt.showcasecount; caseno++) {
      const no = dt.showcase[caseno] ?? 0;
      const stock = no ? dt.item[no - 1] : 0;
      if (!no || !stock) continue;
      const item = g.items[no];
      item.todaystock += stock; // 陳列在庫トータル
      const price = dt.price[caseno] ?? 0;
      item.todayprice += price * stock; // 陳列金額トータル
      if (item.marketpricelow > price || !item.marketpricelow) item.marketpricelow = price; // 最安値
      if (item.marketpricehigh < price) item.marketpricehigh = price; // 最高値
      listed.add(no);
    }
    for (const [key, value] of Object.entries(dt.itemtoday)) {
      const item = g.items[Number(key)];
      item.todaysale += value; // 今期売上数
      listed.add(Number(key));
    }
    for (const [key, value] of Object.entries(dt.itemyesterday)) {
      const item = g.items[Number(key)];
      item.yesterdaysale += value; // 前期売上数
      listed.add(Number(key));
    }
  }
  const seed = (g.world.people * g.config.saleSpeed) / 3 / 50;
  for (const no of listed) {
    const item = g.items[no];
    const stock = item.todaystock;
    const popular = item.popular;
    let uppoint = !popular ? 100 : Math.trunc((stock / seed) * popular);
    if (uppoint < 10) uppoint = 10;
    if (uppoint > 1000) uppoint = 1000;
    if (stock) item.marketprice = Math.trunc(item.todayprice / stock);
    item.uppoint = uppoint;
  }
}

/** 市場の棚 1 つ分 */
export interface WholeStoreCase {
  itemno: number;
  price: number;
  stock: number;
}

/** 原作 GetWholeStore: 市場を「店」の形にしたもの。在庫が多いほど安くなる */
export function getWholeStore(g: Game): WholeStoreCase[] {
  const list: number[] = [];
  for (let i = 0; i < g.maxItem; i++) if (g.world.wholestore[i]) list.push(i);
  list.sort((a, b) => g.items[a + 1].sort - g.items[b + 1].sort);
  const cases: WholeStoreCase[] = [];
  for (const i of list) {
    const stock = g.world.wholestore[i];
    if (!stock) continue;
    const itemno = i + 1;
    const item = g.items[itemno];
    let price = item.price;
    if (item.pricehalf) {
      price = Math.trunc(price / ((stock - item.pricebase) / item.pricehalf + 1));
      if (price <= 0 && item.price) price = 1;
    }
    cases.push({ itemno, price, stock });
  }
  return cases;
}

/** 原作 CheckWholeStore: 市場在庫を上限 (wslimit×店舗数 − 各店の所持数) に収める */
export function checkWholeStore(g: Game): void {
  const shopcount = g.shops.length || 1;
  for (let cnt = 1; cnt <= g.maxItem; cnt++) {
    const item = g.items[cnt];
    if (!item?.code) continue;
    let limit = 0;
    for (const dt of g.shops) limit += dt.item[cnt - 1];
    // 原作は郵便で送付中の商品も数える。この移植では郵便は未実装で、代わりに買い取り募集で預かり中の品を数える
    for (const o of g.world.orders ?? []) if (o.item === cnt) limit += o.count - o.left;
    const limitcount = item.wslimit < 0 ? -item.wslimit : Math.trunc(item.wslimit * shopcount + 0.99);
    if (limit + g.world.wholestore[cnt - 1] > limitcount) {
      if (limitcount < limit) limit = limitcount;
      g.world.wholestore[cnt - 1] = limitcount - limit;
    }
    if (g.world.wholestore[cnt - 1] < 0) g.world.wholestore[cnt - 1] = 0;
  }
}

/**
 * 追加素材の市場在庫を、市場が自然に増減するときと同じ式 (turn.ts。乱数部分は期待値 0.75 倍) で hours 時間ぶん1回だけ足す。
 * 対象は plus が正の素材 (時間で市場に湧く側) だけ。plus が負の品は市場から減る側でプレイヤーが供給するので、
 * 渡されても足さない (v0.2.0 ではここを取り違えて、減る側の15種に在庫を入れてしまった)。
 * 時間・イベント・お店には触れず、対象品の市場在庫だけを変える。上限 (wslimit) は通常どおり効く。
 */
export function seedWholeStore(g: Game, itemNos: number[], hours: number) {
  const w = g.world;
  const shopcount = g.shops.length || 1;
  return itemNos.map((no) => {
    const item = g.items[no];
    const before = w.wholestore[no - 1];
    let add = 0;
    if (item.plus > 0) {
      add = Math.trunc(0.75 *
        ((hours * 3600 / Math.abs(item.plus)) * w.people) /
          (100000 / ((g.marketUsers() + (g.shops.length - 1) - 1) * 0.2 + 1)),
      );
    }
    let held = 0;
    for (const dt of g.shops) held += dt.item[no - 1];
    const limitcount = item.wslimit < 0 ? -item.wslimit : Math.trunc(item.wslimit * shopcount + 0.99);
    const after = Math.max(before, Math.min(before + add, limitcount - held));
    w.wholestore[no - 1] = after;
    return { no, name: item.name, before, add: after - before, after };
  });
}
