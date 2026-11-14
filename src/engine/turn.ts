// SOLD OUT for Muse — 時間経過の処理 (売上・人気・人口・市場・イベント・決算)。
// 原作 auto/turn.cgi の TurnProc の移植。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { EVENTS } from '../data/catalog.js';
import type { Game } from './game.js';
import { checkWholeStore, getMarketStatus } from './market.js';
import { sweepOrders } from './orders.js';
import { turnPeriod } from './period.js';
import { EVENT_FUNCS, EVENT_NOW_FUNCS, TURN_FUNCS } from './scripts.js';

/** 原作 Turn: 前回の計算から updateTime 秒以上たっていれば TurnProc を行う */
export function turn(g: Game): boolean {
  if (!g.world.lasttime) return false;
  if (g.now - g.world.lasttime > g.config.updateTime) {
    turnProc(g);
    return true;
  }
  return false;
}

/** 原作 TurnProc */
export function turnProc(g: Game): void {
  const w = g.world;
  const cfg = g.config;
  const D = cfg.oneDayTime;
  const offset = cfg.tzOffset - cfg.dateReviseTime;
  const now = g.now + offset;
  let lasttime = w.lasttime + offset;
  let temptimenow = w.lasttime;

  // 1 span ごとに処理を繰り返すための準備 (決算の境目で区切る)
  const timespans: [boolean, number][] = [];
  while (Math.floor(lasttime / D) < Math.floor(now / D)) {
    timespans.push([true, D - (lasttime % D)]);
    lasttime += D - (lasttime % D);
  }
  timespans.push([false, now - lasttime]);
  w.lasttime = g.now;

  for (const [dateupdate, timespan] of timespans) {
    if (timespan <= 0) continue;

    // 店舗・商品別来客数計算処理
    let dtranksum = 0;
    const temprank = new Map<number, number>();
    for (const dt of g.shops) {
      // 専門店判定: 棚の商品がすべて同じ分類なら人気+10%扱い
      let group = -1;
      for (let i = 0; i < dt.showcasecount; i++) {
        const itemno = dt.showcase[i] ?? 0;
        if (itemno && group !== -1 && group !== g.items[itemno].type) {
          group = -1;
          break;
        }
        if (itemno) group = g.items[itemno].type;
      }
      const tr = dt.rank + (group !== -1 ? 1000 : 0);
      temprank.set(dt.id, tr);
      dtranksum += tr;
    }

    // アイテム別購入人数算出
    for (const dt of g.shops) {
      for (let cnt = 0; cnt < dt.showcasecount; cnt++) {
        const itemno = dt.showcase[cnt] ?? 0;
        const price = dt.price[cnt] ?? 0;
        if (itemno > 0 && price > 0 && dt.item[itemno - 1]) {
          // 原作では buypeoplebase は 1 回の TurnProc の中で span をまたいで足され続ける
          g.items[itemno].buypeoplebase += (g.items[itemno].price / price) ** (cnt === 0 ? 4 : 3);
        }
      }
    }
    for (let cnt = 1; cnt <= g.maxItem; cnt++) {
      const item = g.items[cnt];
      if (!item.popular) continue;
      item.buypeople = (((w.people * cfg.saleSpeed) / item.popular) * timespan) / 86400;
    }

    // 需要/供給バランス取得
    getMarketStatus(g);

    // 店舗別売上処理ループ
    let peopleup = 0;
    let peopledown = 0;
    const peopleupsalerate = (w.people / 100000) ** 1.5;
    const shopCount = g.shops.length;
    for (const dt of g.shops) {
      let rankdown = 0;
      let rankup = 0;
      const showcaseitemno = new Map<number, number>();

      for (let cnt = 0; cnt < dt.showcasecount; cnt++) {
        const itemno = dt.showcase[cnt] ?? 0;
        if (!(itemno && dt.item[itemno - 1])) continue;
        const item = g.items[itemno];
        const price = dt.price[cnt];
        showcaseitemno.set(itemno, (showcaseitemno.get(itemno) ?? 0) + 1); // 維持費計算用

        // 購買客数計算
        let rank = temprank.get(dt.id) ?? 0;
        if (rank < 100) rank = 99;
        const buypeopletemp =
          (item.buypeople * (item.price / price) ** (cnt === 0 ? 4 : 3)) / (item.buypeoplebase + 1);
        let buypeople = (rank / (dtranksum / shopCount)) * buypeopletemp;
        // 全店の人気が 0 だと原作は 0 除算で止まる。この移植では客が来ないものとして続ける
        if (!Number.isFinite(buypeople)) buypeople = 0;

        // 売上数決定
        let sale = 0;
        rank = item.price / price;
        if (rank < 1) rank /= (price - item.price) / 10000;
        if (buypeople > 0) sale = g.rand(buypeople * (rank > 1 ? 1 : rank));
        if (sale < 1 && sale > 0) {
          if (g.rand(1 / sale) < 1) sale = 1;
        }
        sale = Math.trunc(sale);

        if (sale > 0) {
          // 所持数で補正
          if (sale > dt.item[itemno - 1]) sale = dt.item[itemno - 1];

          // 人気UP: 需要供給バランスによる
          const rankupmulti = (10 - dt.rank / 1000) ** 2 / 5;
          let pricerate = item.marketprice / price;
          if (pricerate > 2) pricerate = 2;
          let rankupsale = g.rand((((rankupmulti / item.uppoint) * item.point) / 10) * sale * pricerate);
          if (rankupsale > timespan / 3) rankupsale = timespan / 3; // 5分間で最大1%上昇のリミット処理
          rankup += rankupsale;

          // 売上処理
          const saleprice = sale * price;
          const [, tax] = g.saleTax(itemno, sale, saleprice, g.userTaxRate(dt));
          dt.moneystock += saleprice - tax;
          dt.saletoday += saleprice;
          dt.item[itemno - 1] -= sale;
          dt.itemtoday[itemno] = (dt.itemtoday[itemno] ?? 0) + sale;
          dt.taxtoday += tax;

          // 売り切れ時の人気DOWN
          if (dt.item[itemno - 1] === 0) rankdown += (dt.rank / 100) ** 3 / 1000;

          // 人口増加
          const pu1 = price;
          const pu2 = item.price;
          peopleup += (sale * (pu1 < pu2 ? pu1 : pu2)) / peopleupsalerate + sale;
        }
      }

      // 時間経過による無条件人気DOWN
      rankdown +=
        ((Math.sqrt(timespan) * (dt.rank / 1000) ** cfg.popDownRate) / (5 ** cfg.popDownRate * 20)) * dt.showcasecount;
      // 時間経過による無条件人口DOWN
      peopledown += g.rand(((w.people / 10000) * timespan) / 3600);

      // rankdown と rankup による人気UP/DOWN処理
      let rankupdown = Math.abs(rankup - rankdown);
      if (rankupdown < 1 && rankdown > 0) {
        if (g.rand(1 / rankupdown) < 1) rankupdown = 1;
      }
      dt.rank += Math.trunc(rankup > rankdown ? rankupdown : -rankupdown);
      if (dt.rank < 0) dt.rank = 0;
      if (dt.rank > 10000) dt.rank = 10000;

      // 維持費計算＆蓄積 (陳列中の商品は1/10)
      let costsum = 0;
      for (let idx = 1; idx <= g.maxItem; idx++) {
        if (!dt.item[idx - 1]) continue;
        let c = dt.item[idx - 1];
        if (showcaseitemno.get(idx)) c /= 10;
        costsum += g.items[idx].cost * c;
      }
      // 買い取り募集で預かり中の品も、受け取る店の倉庫にあるものとして維持費を掛ける (まとめて受け取りで維持費を逃れないように)
      for (const o of w.orders ?? []) {
        if (o.shop === dt.id && o.count > o.left) costsum += g.items[o.item].cost * (o.count - o.left);
      }
      dt.costtoday += (costsum * timespan) / 86400;
    }

    // peopledown と peopleup による人口UP/DOWN処理
    let peopleupdown = Math.abs(peopleup - peopledown);
    if (peopleupdown < 1 && peopleupdown > 0) {
      if (g.rand(1 / peopleupdown) < 1) peopleupdown = 1;
    }
    w.people += Math.trunc(peopleup > peopledown ? peopleupdown : -peopleupdown);
    if (w.people < 100000) w.people += Math.trunc(g.rand(100000 - w.people));

    // @@ITEM funct 処理 (商品番号順)
    for (const item of g.items) {
      if (!item?.functurn) continue;
      const fn = TURN_FUNCS[item.code];
      if (!fn) throw new Error('未移植の functurn: ' + item.code);
      fn(g, item, g.shops.filter((dt) => dt.item[item.no - 1]), timespan);
    }
    // @@ITEM funcs (売れたときの処理) を持つ商品は原作データには無い

    g.sortShops();

    // 買い取り募集の期限切れ (この区間の終わりまでに期限が来たもの)。決算より先に返金・受け渡しをする
    sweepOrders(g, temptimenow + timespan);

    // 決算処理
    if (dateupdate && g.shops.length) turnPeriod(g);

    // 市場商品数のUP/DOWN処理
    for (let cnt = 1; cnt <= g.maxItem; cnt++) {
      const item = g.items[cnt];
      if (!item.code) continue;
      let add = 0;
      if (item.plus !== 0) {
        // 原作の $#DT は「店舗数-1」
        add =
          ((timespan / Math.abs(item.plus)) * w.people) /
          (100000 / ((cfg.maxUser + (g.shops.length - 1) - 1) * 0.2 + 1));
        if (add > 0) add = add / 2 + g.rand(add / 2);
        else add = 0;
        if (add < 1 && add > 0) {
          if (g.rand(1 / add) < 1) add = 1;
        }
        add = Math.trunc(add);
        w.wholestore[cnt - 1] += item.plus > 0 ? add : -add;
      }
    }
    // 市場在庫上限下限チェック＆補正
    checkWholeStore(g);

    // イベント終了処理
    const activeGroups = new Set<string>();
    for (const key of Object.keys(w.events)) {
      const ev = EVENTS.get(key);
      // 原作の %EVENT には自然発生しないイベント (start -1) は入っていない
      const E = ev && ev.auto_start ? ev : undefined;
      if (w.events[key] < temptimenow + timespan) {
        let ret = 1;
        if (E?.endfunc) {
          const fn = EVENT_FUNCS[E.endfunc] ?? EVENT_FUNCS[`${E.code}:end`];
          if (!fn) throw new Error('未移植の endfunc: ' + E.code);
          const [r, msg] = fn(g, splitParams(E.endfuncparam), timespan);
          ret = r;
          if (msg) g.writeLog(2, 0, 0, msg);
        }
        if (ret) {
          delete w.events[key];
          if (E?.endmsg) g.writeLog(2, 0, 0, E.endmsg);
        } else {
          activeGroups.add(E?.group ?? '');
        }
      } else {
        activeGroups.add(E?.group ?? '');
      }
    }

    // イベント開始処理 (原作は Perl のハッシュ順。ここでは定義順)
    for (const E of EVENTS.values()) {
      if (!E.auto_start) continue;
      if (activeGroups.has(E.group)) continue;
      if (g.rand(100000) < (timespan * E.startproba) / 864 || E.startproba === 0) {
        let ret = 1;
        if (E.startfunc) {
          const fn = EVENT_FUNCS[E.startfunc] ?? EVENT_FUNCS[`${E.code}:start`];
          if (!fn) throw new Error('未移植の startfunc: ' + E.code);
          const [r, msg] = fn(g, splitParams(E.startfuncparam), timespan);
          ret = r;
          if (msg) g.writeLog(2, 0, 0, msg);
        }
        if (ret) {
          if (E.startmsg) g.writeLog(2, 0, 0, E.startmsg);
          if (E.basetime + E.plustime) {
            w.events[E.code] =
              temptimenow + Math.trunc(g.rand(timespan)) + E.basetime + Math.trunc(g.rand(E.plustime));
          }
          activeGroups.add(E.group);
        }
      }
    }

    // 開催中イベントの処理 (event-n)
    for (const key of Object.keys(w.events)) {
      const fn = EVENT_NOW_FUNCS[key];
      if (!fn) continue;
      const E = EVENTS.get(key);
      const [, msg] = fn(g, splitParams(E?.nowfuncparam ?? null), timespan);
      if (msg) g.writeLog(2, 0, 0, msg);
    }

    temptimenow += timespan;
  }

  // 経営者不在処理
  for (const dt of g.shops) {
    if (dt.lastlogin + cfg.expireTime + g.expireTimeExtend(dt) < g.now) {
      g.closeShop(dt.id, '経営者不在');
      g.writeLog(1, 0, 0, dt.shopname + 'が経営者不在により閉店しました');
    }
  }
  g.sortShops();
}

function splitParams(s: string | null): string[] {
  if (!s) return [];
  return s.split(/[:,]/);
}
