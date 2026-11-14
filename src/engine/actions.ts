// SOLD OUT for Muse — 店の行動。原作 new.cgi, buy-s.cgi, showcase-edit.cgi, moneystock.cgi,
// item-send.cgi, user.cgi の移植。画面 (HTML) の部分は除き、処理だけを移している。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, itemNoByName } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import { getWholeStore } from './market.js';
import { addItemSub } from './scripts.js';
import { newShop, type Shop } from './types.js';
import { escapeHtml, formatHms } from './use.js';

/** 原作の Shift_JIS での文字数 (半角1・全角2) */
export function sjisLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
  }
  return n;
}

/**
 * 原作 CheckUserPass のうち、ログインした店に対して毎回行う処理。
 * 行動 (書き込み) のときは lastlogin を更新し、@@FUNCINIT を実行する。
 */
export function enterShop(g: Game, dt: Shop, acting: boolean): void {
  g.dt = dt;
  if (acting) dt.lastlogin = g.now;
  // @@FUNCINIT
  g.timeSendItem = CATALOG.timeSendItem;
  if (dt.item[itemNoByName('目利きの真髄') - 1]) g.timeSendItem = Math.trunc((g.timeSendItem / 4) * 3);
  if (dt.job === 'peddle') g.timeSendItem = Math.trunc(g.timeSendItem / 2);
}

export interface OpenShopRequest {
  /** ログイン名 (半角英数と _ - で12文字まで) */
  name: string;
  /** 店名 (全角10文字/半角20文字まで) */
  shopname: string;
}

/** 原作 new.cgi: 新装開店 */
export function openShop(g: Game, req: OpenShopRequest): Shop {
  const w = g.world;
  const name = req.name ?? '';
  const sname = req.shopname ?? '';
  if (g.config.maxUser > 0 && g.shops.length >= g.config.maxUser) {
    throw new GameError('申し訳ありませんが、現在空き店舗がありません。空くのをお待ちください。');
  }
  if (
    /[,:;\t\r\n<>&]/.test(sname + name) ||
    /[^A-Za-z0-9_-]/.test(name) ||
    name === 'soldoutadmin' ||
    g.config.ngShopName.some((ng) => sname.includes(ng))
  ) {
    throw new GameError('名前・店名に使用できない文字が含まれています。');
  }
  if (!sname || !name) throw new GameError('名前・店名を入力してください。');
  if (/^[\s　]+$/.test(sname)) {
    throw new GameError('名前・店名が空白になっているか、使用不可文字が使用されています。');
  }
  if (sjisLength(sname) < 4) throw new GameError('店名の文字数が少ないです。');
  if (name.length > 12 || sjisLength(sname) > 20) {
    throw new GameError('名前(12文字)・店名(全角10文字)の文字数が多いです。');
  }
  if (g.shops.some((s) => s.name === name)) throw new GameError('既に存在する名前です。-> ' + name);
  if (g.shops.some((s) => s.shopname === sname)) throw new GameError('既に存在する店名です。-> ' + sname);

  if (!g.shops.length) w.lasttime = g.now;
  const dt = newShop(w.nextid, g.maxItem);
  w.nextid++;
  dt.lastlogin = g.now;
  dt.name = name;
  dt.shopname = sname;
  dt.money = 100000;
  dt.time = g.now - 12 * 60 * 60;
  dt.rank = 5010;
  dt.showcasecount = 1;
  dt.showcase = [0];
  dt.price = [0];
  dt.foundation = g.now;

  // @@FUNCNEW
  if (CATALOG.newShopMoney) dt.money = CATALOG.newShopMoney;
  if (CATALOG.newShopTime) dt.time = g.now - CATALOG.newShopTime;
  if (CATALOG.newShopItem) {
    const parts = CATALOG.newShopItem.split(':');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const no = itemNoByName(parts[i]);
      dt.item[no - 1] += Number(parts[i + 1]);
    }
  }
  g.writeLog(1, 0, 0, sname + 'が新装開店しました');
  w.shops.push(dt);
  g.sortShops();
  return dt;
}

export interface BuyRequest {
  /** 仕入先。0 なら市場 */
  from: number;
  itemno: number;
  count: number;
  /** 仕入先の棚番号 (0 始まり)。省略時はその商品が並んでいる最初の棚 */
  slot?: number;
  /** 見込みの単価。指定した場合、実際と違えば中止する (原作の「商品や価格が変化したようです」) */
  expectPrice?: number;
}

/** 原作 buy-s.cgi: 市場または他店から仕入れる */
export function buy(g: Game, dt: Shop, req: BuyRequest): string {
  const itemno = Math.trunc(req.itemno);
  let num = Math.trunc(req.count);
  const isWhole = req.from === 0;

  // 仕入先の棚を「店」の形で用意する
  let showcase: number[];
  let prices: number[];
  let stockOf: (no: number) => number;
  let dts: Shop | undefined;
  if (isWhole) {
    const cases = getWholeStore(g);
    showcase = cases.map((c) => c.itemno);
    prices = cases.map((c) => c.price);
    stockOf = (no) => g.world.wholestore[no - 1] ?? 0;
  } else {
    dts = g.shopById(req.from);
    if (!dts) throw new GameError('その店は見つかりません (店終いしたかもしれません)');
    if (dts === dt) throw new GameError('自分の店から買う気ですか？');
    showcase = dts.showcase.slice(0, dts.showcasecount);
    prices = dts.price.slice(0, dts.showcasecount);
    const s = dts;
    stockOf = (no) => s.item[no - 1] ?? 0;
  }
  let slot = req.slot ?? showcase.indexOf(itemno);
  slot = Math.trunc(slot);
  if (slot < 0 || slot >= showcase.length) throw new GameError('そんな陳列棚はありません');
  if (itemno < 1 || itemno > g.maxItem) throw new GameError('そんなアイテムはないです。');
  if (!stockOf(itemno)) throw new GameError('アイテムの在庫がありません。');
  if (!isWhole && g.itemFlag(itemno, 'nobuy')) throw new GameError('この商品は購入不可です');

  const baseprice = prices[slot];
  // ギルドはこの移植では未実装 (常に「片方または双方ギルド無所属」扱い)
  const price = baseprice;
  if (itemno !== showcase[slot] || (req.expectPrice !== undefined && req.expectPrice !== price)) {
    throw new GameError(`商品や価格が変化したようです (今は ${showcase[slot] ? g.items[showcase[slot]].name : '空'} ￥${price}。確かめてから送り直してください)`);
  }

  // 買える数が0になった理由を原作の文に添える (何を直せばよいか分かるように)
  let why = num > 0 ? '' : '数量が0です。1以上を指定してください';
  if (stockOf(itemno) < num) num = stockOf(itemno);
  if (num + dt.item[itemno - 1] > g.items[itemno].limit) {
    num = g.items[itemno].limit - dt.item[itemno - 1];
    if (num < 0) num = 0;
    if (!num && !why) why = `所持上限 (${g.items[itemno].limit}) に達しています`;
  }
  if (dt.money < num * price) num = Math.trunc(dt.money / price);
  if (num < 0) num = 0;
  if (!num && !why) why = '資金が足りません';
  if (!num) throw new GameError(`冷やかしですか？ (${why})`);

  if (isWhole) g.timeSendItem = Math.trunc(g.timeSendItem / 2);
  const usetime = g.timeDeal(baseprice * num, itemno, num);
  g.useTime(usetime);

  const [, tax] = g.saleTax(itemno, num, baseprice * num, dts ? g.userTaxRate(dts) : 0);
  if (dts) {
    dts.item[itemno - 1] -= num;
    dts.itemtoday[itemno] = (dts.itemtoday[itemno] ?? 0) + num;
    dts.moneystock += num * baseprice - tax;
    dts.saletoday += num * baseprice;
    dts.taxtoday += tax;
    // 売り切れたら売った店の人気が下がる
    if (dts.item[itemno - 1] === 0) {
      let rankdown = (dts.rank / 100) ** 3 / 1000;
      if (rankdown < 1 && rankdown > 0) {
        if (g.rand(1 / rankdown) < 1) rankdown = 1;
      }
      dts.rank -= Math.trunc(rankdown);
      if (dts.rank < 0) dts.rank = 0;
    }
  } else {
    g.world.wholestore[itemno - 1] -= num;
  }
  dt.item[itemno - 1] += num;
  dt.money -= num * price;
  dt.paytoday += num * price;

  const item = g.items[itemno];
  const ret =
    `${dts ? dts.shopname : '市場'}より${item.name}を${num}${item.scale}@￥${price}(計￥${price * num})にて仕入ました` +
    `/${formatHms(usetime)}消費`;
  g.writeLog(0, dt.id, 0, ret);

  // @@FUNCBUY: 市場からの仕入の場合、\500000 に付き1枚のギフト券を進呈する
  if (isWhole) {
    let count = Math.trunc((num * price) / 500000);
    if (count) count = addItemSub(g, dt, itemNoByName('ギフト券'), count);
    if (count) g.writeLog(0, dt.id, 0, '市場からギフト券を' + count + '枚もらいました');
  }
  return ret;
}

export interface ShowcaseRequest {
  /** 棚番号 (0 始まり) */
  slot: number;
  /** 商品番号。0 なら陳列をやめる */
  itemno: number;
  /** 価格 (円)。省略時は percent を使う */
  price?: number;
  /** 標準価格に対する % (1〜200)。price も percent も無ければ 100% */
  percent?: number;
}

/** 原作 showcase-edit.cgi: 陳列棚の設定 */
export function editShowcase(g: Game, dt: Shop, req: ShowcaseRequest): string {
  const no = Math.trunc(req.slot);
  const itemno = Math.trunc(req.itemno);
  const per = clampInt(req.percent ?? 100, 1, 200);
  const yen = clampInt(req.price ?? 0, 0, g.maxMoney);
  g.useTime(CATALOG.timeEditShowcase);
  if (no < 0 || no >= dt.showcasecount) throw new GameError(`不正な要求です (棚は1〜${dt.showcasecount}番です)`);
  if (itemno < 0 || itemno > g.maxItem) throw new GameError(`不正な要求です (品番は1〜${g.maxItem}、棚を空にするときは0です)`);
  if (per <= 0 && yen <= 0) throw new GameError('不正な要求です (price か percent を指定してください)');
  if (g.itemFlag(itemno, 'noshowcase')) throw new GameError('不正な要求です (この品は棚に並べられません)');
  let price = 0;
  if (itemno > 0) {
    if (!dt.item[itemno - 1]) throw new GameError('アイテムの在庫がありません。');
    price = yen !== 0 ? yen : Math.trunc((g.items[itemno].price / 100) * per);
  }
  if (price > g.maxMoney) price = g.maxMoney;
  let ret: string;
  let setItem = itemno;
  if (itemno && price) {
    ret = `棚${no + 1}に${g.items[itemno].name}を${price}円で陳列`;
    g.writeLog(0, dt.id, 0, ret);
    g.writeLog(0, 0, 0, `${dt.shopname}で${g.items[itemno].name}が${price}円にて陳列されました`);
  } else {
    setItem = 0;
    price = 0;
    ret = `棚${no + 1}への陳列をやめました`;
    g.writeLog(0, dt.id, 0, ret);
  }
  dt.showcase[no] = setItem;
  dt.price[no] = price;
  return ret;
}

/** 原作 CheckCount */
function clampInt(v: number, min: number, max: number): number {
  let c = Number(v) || 0;
  if (c < min) c = min;
  if (c > max) c = max;
  return Math.trunc(c);
}

/** 原作 moneystock.cgi: 入金庫から資金へ移す */
export function deposit(g: Game, dt: Shop, amount: number): string {
  let money = Math.trunc(amount);
  if (!(money > 0)) throw new GameError('金額が不正です');
  if (dt.money + money > g.maxMoney) money = g.maxMoney - dt.money;
  if (money > dt.moneystock) money = dt.moneystock;
  const usetime = g.timeDeal(money);
  if (g.usableTime(dt) < usetime) throw new GameError('時間が足りません');
  dt.money += money;
  dt.moneystock -= money;
  g.useTime(g.timeDeal(money));
  const ret = '￥' + money + '入金しました';
  g.writeLog(0, dt.id, 0, ret);
  return ret;
}

/** 原作 inc-html-moneystock.cgi の「最大額指定」: 今の持ち時間で入金できる最大額 */
export function maxDeposit(g: Game, dt: Shop): number {
  let maxmoney = dt.moneystock;
  const usetime = g.timeDeal(maxmoney) - CATALOG.timeSendMoney;
  const stocktime = g.usableTime(dt) - CATALOG.timeSendMoney;
  if (stocktime < 0) maxmoney = 0;
  if (usetime > 0 && stocktime > 0 && stocktime < usetime) maxmoney = Math.trunc((maxmoney / usetime) * stocktime);
  return maxmoney;
}

/** 原作 item-send.cgi: 商品を処分する (市場へ戻る) */
export function trash(g: Game, dt: Shop, itemno: number, countIn: number): string {
  itemno = Math.trunc(itemno);
  if (itemno < 1 || itemno > g.maxItem) throw new GameError('そんなアイテムはないです。');
  if (!dt.item[itemno - 1]) throw new GameError('アイテムの在庫がありません。');
  const item = g.items[itemno];
  const count = clampInt(countIn, 0, dt.item[itemno - 1]);
  if (g.itemFlag(itemno, 'notrash')) throw new GameError('不正な要求です (この品は捨てられません)');
  if (!count) throw new GameError('破棄数量を指定してください');
  const ret = item.name + 'を' + count + item.scale + '処分しました';
  dt.item[itemno - 1] -= count;
  g.writeLog(0, dt.id, 0, ret);
  g.writeLog(0, 0, 0, dt.shopname + 'が' + item.name + 'を処分したようです');
  const w = g.world;
  w.wholestore[itemno - 1] += count;
  let limit = 0;
  for (const s of g.shops) limit += s.item[itemno - 1];
  const limitcount = item.wslimit < 0 ? -item.wslimit : Math.trunc(item.wslimit * g.shops.length);
  if (limit + w.wholestore[itemno - 1] > limitcount) {
    if (limitcount < limit) limit = limitcount;
    w.wholestore[itemno - 1] = limitcount - limit;
  }
  if (w.wholestore[itemno - 1] < 0) w.wholestore[itemno - 1] = 0;
  return ret;
}

/** 原作 user.cgi: コメント変更 */
export function setComment(g: Game, dt: Shop, comment: string): string {
  if (sjisLength(comment) > 50) throw new GameError('コメントの文字数が多いです。');
  dt.comment = comment.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;');
  return 'コメント更新しました';
}

/** 原作 user.cgi: 改名 (20万円) */
export function renameShop(g: Game, dt: Shop, newName: string): string {
  if (/[,:;\t\r\n<>&]/.test(newName)) throw new GameError('名前・店名・パスワードに使用できない文字が含まれています。');
  if (sjisLength(newName) > 40) throw new GameError('店名は20文字以内です。');
  if (sjisLength(newName) < 4) throw new GameError('店名が短すぎます。');
  if (/^[\s　]+$/.test(newName)) throw new GameError('名前・店名が空白になっているか、使用不可文字が使用されています。');
  if (dt.money < 200000) throw new GameError('資金が足りません。');
  if (g.shops.some((s) => s.shopname === newName)) throw new GameError('既に存在する店名です。-> ' + newName);
  g.writeLog(1, 0, 0, dt.shopname + 'が「' + newName + '」へ改名しました。');
  dt.shopname = newName;
  dt.money -= 200000;
  return dt.shopname + 'へ改名しました。';
}

/** 原作 user.cgi: 店じまい */
export function closeOwnShop(g: Game, dt: Shop): string {
  g.closeShop(dt.id, '自主閉店');
  g.writeLog(1, 0, 0, dt.shopname + 'が閉店しました');
  return '店じまいの手続きが完了いたしました';
}

export { escapeHtml };
