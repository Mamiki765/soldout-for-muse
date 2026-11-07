// SOLD OUT for Muse — 決算。原作 auto/period.cgi と商品データの @@FUNCUPDATE の移植。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, itemNoByName } from '../data/catalog.js';
import type { Game } from './game.js';
import type { Shop } from './types.js';

/** 原作 TurnPeriod */
export function turnPeriod(g: Game): void {
  g.periodMode = true;
  g.world.periodLog = [];
  const shops = g.shops;

  if (shops[0]) {
    const dt = shops[0];
    dt.rankingcount++;
    const count = dt.rankingcount === 1 ? '初優勝' : dt.rankingcount + '度目の優勝';
    g.writeLog(1, 0, 0, `「今期の優勝店は${dt.shopname}さんでした。${count}おめでとうございます。」`);
    let msg = '「点数は' + dt.point + '点';
    if (shops[1]) msg += 'で、2位との差は' + (dt.point - shops[1].point) + '点';
    msg += 'でした。」';
    g.writeLog(1, 0, 0, msg);
  }

  updateResetBefore(g);

  const cfg = g.config;
  let dtcount = 0;
  for (const dt of g.shops) {
    dtcount++;
    dt.rankingyesterday = dtcount;
    dt.pointyesterday = dt.point;

    const [taxtoday] = g.taxToday(dt);
    dt.profitstock = Math.trunc(
      (dt.profitstock * cfg.profitDayCount + dt.saletoday - dt.paytoday) / (cfg.profitDayCount + 1),
    );
    dt.saleyesterday = dt.saletoday;
    dt.saletoday = 0;
    dt.payyesterday = dt.paytoday;
    dt.paytoday = 0;
    dt.itemyesterday = dt.itemtoday;
    dt.itemtoday = {};
    dt.taxyesterday = taxtoday + dt.taxtoday;
    dt.taxtoday = 0;

    for (let cnt = 1; cnt <= g.maxItem; cnt++) {
      if (dt.item[cnt - 1] > g.items[cnt].limit) dt.item[cnt - 1] = g.items[cnt].limit;
      dt.item[cnt - 1] = Math.trunc(dt.item[cnt - 1]);
    }

    // 維持費
    let cost = Math.trunc(dt.costtoday);
    cost += CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0;
    dt.money -= cost;
    dt.paytoday += cost;
    // 入金庫の残高にかかる税
    dt.money -= taxtoday;

    // ギルドはこの移植では未実装。無所属ペナルティだけ設定があれば適用する
    if (dt.guild === '' && cfg.guildUnattachPenalty) {
      const money = Math.trunc((dt.saleyesterday * cfg.guildUnattachPenalty) / 1000);
      dt.money -= money;
      g.writeLog(2, 0, 0, dt.shopname + 'がギルド無所属ペナルティを受けました。-\\' + money);
    }

    if (dt.money < 0) {
      dt.moneystock += dt.money;
      dt.money = 0;
    }
    if (dt.moneystock < 0) {
      dt.money += dt.moneystock;
      dt.moneystock = 0;
    }
    if (dt.money < 0) {
      g.closeShop(dt.id, '資金不足倒産');
      g.writeLog(1, 0, 0, dt.shopname + 'が資金不足により倒産しました');
    }

    dt.costyesterday = cost;
    dt.costtoday = 0;

    // 熟練度の自然減少
    for (const key of Object.keys(dt.exp)) {
      const k = Number(key);
      if (cfg.expDownRate) dt.exp[k] -= Math.trunc((dt.exp[k] * cfg.expDownRate) / 1000);
      dt.exp[k] -= cfg.expDownPoint;
      if (dt.exp[k] <= 0) delete dt.exp[k];
    }
  }

  g.sortShops();
  updateResetAfter(g);
  g.periodMode = false;
}

type Prize = [string, [number, number][]];

/** @@FUNCUPDATE UpdateResetBefore: 決算直前の処理 (上位店への賞品) */
function updateResetBefore(g: Game): void {
  const n = itemNoByName;
  const celebrate: Prize[] = [
    ['お祝いグッズ', [[n('七面鳥の丸焼き'), 1]]],
    ['お祝いグッズ', [[n('こだわりのラム酒'), 1]]],
    ['お祝いグッズ', [[n('おしゃれブーツ'), 1]]],
  ];
  const gift = (c: number): Prize => ['ギフト券', [[n('ギフト券'), c]]];
  const top123: Prize[][] = [
    [gift(5), gift(4), gift(3), gift(2), gift(1), ['ロボット', [[n('店番ロボット'), 1]]], ...celebrate],
    [gift(3), gift(3), gift(2), gift(2), gift(1), ['禁断の書', [[n('禁断の書'), 1]]], ...celebrate],
    [gift(2), gift(2), gift(2), gift(1), gift(1), ['広告パック', [[n('広告パック'), 1]]], ...celebrate],
    [
      gift(2), gift(1), gift(1),
      ['広告パック', [[n('広告パック'), 1]]],
      ['広告パック', [[n('広告パック'), 1]]],
      ['広告パック', [[n('広告パック'), 1]]],
      ...celebrate,
    ],
  ];
  const shops = g.shops;
  if (shops[0]) topGetItem(g, shops[0], top123[0], '今回優勝の');
  if (shops[1]) topGetItem(g, shops[1], top123[1], '惜しくも2位の');
  if (shops[2]) topGetItem(g, shops[2], top123[2], 'ぎりぎり入賞の');
  // 原作: for($i=9; $i<$#DT; $i+=10)
  for (let i = 9; i < shops.length - 1; i += 10) {
    if (shops[i]) topGetItem(g, shops[i], top123[3], '特別賞として' + (i + 1) + '位の');
  }
}

function topGetItem(g: Game, dt: Shop, list: Prize[], head: string): void {
  const getitem = list[Math.trunc(g.rand(list.length))];
  g.writeLog(2, 0, 0, head + dt.shopname + 'さんには' + getitem[0] + 'が贈られました');
  for (const [itemno, count] of getitem[1]) {
    const cnt = g.addItem(dt, itemno, count);
    const item = g.items[itemno];
    g.writeLog(0, dt.id, 0, head + '賞品として' + item.name + 'を' + count + item.scale + '獲得しました');
    const trashed = count - cnt;
    if (trashed) g.writeLog(0, dt.id, 0, 'しかし最大所持数以上だったので' + trashed + item.scale + '破棄しました');
  }
}

/** @@FUNCUPDATE UpdateResetAfter: 決算直後の処理 (熟練度の合計が多すぎると技術書を失う) */
function updateResetAfter(g: Game): void {
  const techs = ['鍛冶屋の技術', '魔法の知識', '解体屋の魂', '目利きの真髄'].map(itemNoByName);
  for (const dt of g.shops) {
    let expsum = 0;
    for (const v of Object.values(dt.exp)) expsum += v;
    if (expsum <= 4000) continue;
    expsum -= 4000;
    for (const itemno of techs) {
      if (dt.item[itemno - 1] && g.rand(14000) < expsum) {
        g.writeLog(2, 0, 0, '初心を忘れ、' + dt.shopname + 'さんの' + g.items[itemno].name + 'が失われました');
        g.writeLog(0, dt.id, 0, g.items[itemno].name + 'を失いました');
        dt.item[itemno - 1]--;
      }
    }
  }
}
