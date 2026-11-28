// SOLD OUT for Muse — 店の行動。原作 new.cgi, buy-s.cgi, showcase-edit.cgi, moneystock.cgi,
// item-send.cgi, user.cgi の移植。画面 (HTML) の部分は除き、処理だけを移している。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, itemNoByName } from '../data/catalog.js';
import { GameError, type Game } from './game.js';
import { getWholeStore } from './market.js';
import { getResaleStore, takeResale } from './resale.js';
import { addItemSub } from './scripts.js';
import { newShop, type Shop } from './types.js';
import { escapeHtml, formatHms } from './use.js';
import { addMerchantYen } from './merchant.js';

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
  if (g.config.maxUser > 0 && g.allShops.length >= g.config.maxUser) {
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
  if (g.allShops.some((s) => s.name === name)) throw new GameError('既に存在する名前です。-> ' + name);
  if (g.allShops.some((s) => s.shopname === sname)) throw new GameError('既に存在する店名です。-> ' + sname);

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
  /** 取引にかかる時間の上限 (秒)。超えるなら時間を使わずに中止する (1.3.0)。省略で上限なし */
  maxTime?: number;
  /**
   * 市場の掘り出し物から買う (1.9.0)。true で掘り出し物、false でふつうの在庫。
   * 省略時は、両方にあれば安い方から買い、足りなければ続けてもう片方からも買う (時間は1回ぶん、1.9.1)。片方にしか無ければそちらから。
   * slot を付けたときはふつうの在庫、price を付けたときはその単価の方だけから買う
   */
  bargain?: boolean;
}

/** 仕入れる。市場で bargain を省略したときは、ふつうの在庫と掘り出し物の安い方から買い、足りなければもう片方からも買う (1.9.1) */
export function buy(g: Game, dt: Shop, req: BuyRequest): string {
  if (req.from !== 0 || req.bargain !== undefined || req.slot !== undefined) return buyOne(g, dt, req);
  const no = Math.trunc(req.itemno);
  const normal = (g.world.wholestore[no - 1] ?? 0) > 0 ? getWholeStore(g).find((c) => c.itemno === no) : undefined;
  const bargain = getResaleStore(g).find((c) => c.itemno === no);
  if (!normal || !bargain) return buyOne(g, dt, req);
  // 単価を指定したら、その単価の方だけ (両方同じ単価ならふつうの在庫)
  if (req.expectPrice !== undefined) return buyOne(g, dt, { ...req, bargain: req.expectPrice !== normal.price && req.expectPrice === bargain.price });
  const cheapIsBargain = bargain.price < normal.price;
  const first = cheapIsBargain ? bargain : normal;
  const want = Math.trunc(req.count);
  const before = dt.item[no - 1];
  const paid = dt.paytoday;
  let ret = buyOne(g, dt, { ...req, count: Math.min(want, first.stock), bargain: cheapIsBargain }, true, false);
  const rest = want - (dt.item[no - 1] - before);
  if (rest > 0) {
    try {
      ret += '\n' + buyOne(g, dt, { ...req, count: rest, bargain: !cheapIsBargain }, false, false);
    } catch (e) {
      // 続きが買えない (資金・所持上限など) ときは、安い方で買えた分だけ
      if (!(e instanceof GameError)) throw e;
    }
  }
  // ギフト券は2つを合わせた支払いで数える
  marketGift(g, dt, dt.paytoday - paid);
  return ret;
}

/** @@FUNCBUY: 市場からの仕入の場合、\500000 に付き1枚のギフト券を進呈する */
function marketGift(g: Game, dt: Shop, total: number): void {
  let count = Math.trunc(total / 500000);
  if (count) count = addItemSub(g, dt, itemNoByName('ギフト券'), count);
  if (count) g.writeLog(0, dt.id, 0, '市場からギフト券を' + count + '枚もらいました');
}

/** 原作 buy-s.cgi: 市場または他店から仕入れる。chargeTime が false なら時間を使わない (同じ取引の続き)。gift が false ならギフト券はまとめて呼び出し元で */
function buyOne(g: Game, dt: Shop, req: BuyRequest, chargeTime = true, gift = true): string {
  const itemno = Math.trunc(req.itemno);
  let num = Math.trunc(req.count);
  const isWhole = req.from === 0;

  // 仕入先の棚を「店」の形で用意する
  let showcase: number[];
  let prices: number[];
  let stockOf: (no: number) => number;
  let dts: Shop | undefined;
  let bargain = false;
  if (isWhole) {
    const wanted = Math.trunc(req.itemno);
    const bargains = getResaleStore(g);
    bargain = req.bargain ?? (!(g.world.wholestore[wanted - 1] > 0) && bargains.some((c) => c.itemno === wanted));
    const cases = bargain ? bargains : getWholeStore(g);
    showcase = cases.map((c) => c.itemno);
    prices = cases.map((c) => c.price);
    const r = g.world.resale;
    stockOf = bargain ? (no) => r?.stock[no] ?? 0 : (no) => g.world.wholestore[no - 1] ?? 0;
  } else {
    dts = g.shopById(req.from);
    if (!dts) throw new GameError('その店は見つかりません (店終いしたかもしれません)');
    if (dts === dt) throw new GameError('自分の店から買う気ですか？');
    if (dts.rest) throw new GameError(dts.shopname + 'は改装中でお休みです');
    showcase = dts.showcase.slice(0, dts.showcasecount);
    prices = dts.price.slice(0, dts.showcasecount);
    const s = dts;
    stockOf = (no) => s.item[no - 1] ?? 0;
  }
  // 失敗したとき、何を読み直せばよいか (1.9.0。同じ注文を送り直して同じ失敗を繰り返さないように)
  const lookAgain = isWhole
    ? `今の市場は GET /api/v1/market、ほかの店の棚は GET /api/v1/shops?item=${itemno} で確かめてください`
    : `今その品を並べている店は GET /api/v1/shops?item=${itemno}、市場は GET /api/v1/market で確かめてください`;
  if (itemno < 1 || itemno > g.maxItem) throw new GameError('そんなアイテムはないです。');
  let slot = req.slot ?? showcase.indexOf(itemno);
  slot = Math.trunc(slot);
  if (slot < 0 || slot >= showcase.length) {
    throw new GameError(req.slot === undefined
      ? `${isWhole ? '市場' : dts!.shopname + 'の棚'}に${g.items[itemno].name}は今並んでいません。${lookAgain}`
      : `そんな陳列棚はありません (${isWhole ? '市場' : dts!.shopname}の棚は1〜${showcase.length}番です)`);
  }
  if (!stockOf(itemno)) throw new GameError(`アイテムの在庫がありません (${g.items[itemno].name}は売り切れです)。${lookAgain}`);
  if (!isWhole && g.itemFlag(itemno, 'nobuy')) throw new GameError('この商品は購入不可です');

  const baseprice = prices[slot];
  // ギルドはこの移植では未実装 (常に「片方または双方ギルド無所属」扱い)
  const price = baseprice;
  if (itemno !== showcase[slot] || (req.expectPrice !== undefined && req.expectPrice !== price)) {
    throw new GameError(`商品や価格が変化したようです (今は ${showcase[slot] ? g.items[showcase[slot]].name : '空'} ￥${price}。${itemno === showcase[slot] ? `この値段で買うなら price を ${price} にして送り直してください。` : ''}${lookAgain})`);
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

  // 時間は1回の取引ごと (個数に関係しない)。式は g.buyTime (市場は半分)
  const usetime = chargeTime ? g.buyTime(itemno, baseprice, isWhole) : 0;
  if (chargeTime && req.maxTime !== undefined && usetime > req.maxTime) {
    throw new GameError(
      `この取引は${formatHms(usetime)}かかります (上限 ${formatHms(Math.max(0, Math.trunc(req.maxTime)))} を超えるので中止。時間は使っていません)。` +
        '時間は個数に関係なく1回ぶんなので、買うならまとめて買うのが得です',
    );
  }
  const fromCoupon = chargeTime ? g.useTime(usetime) : 0;

  const [, tax] = g.saleTax(itemno, num, baseprice * num, dts ? g.userTaxRate(dts) : 0);
  if (dts) {
    dts.item[itemno - 1] -= num;
    dts.itemtoday[itemno] = (dts.itemtoday[itemno] ?? 0) + num;
    dts.moneystock += num * baseprice - tax;
    dts.saletoday += num * baseprice;
    g.recordSaleTax(dts, tax, num * baseprice);
    // 売り切れたら売った店の人気が下がる
    if (dts.item[itemno - 1] === 0) {
      let rankdown = (dts.rank / 100) ** 3 / 1000;
      if (rankdown < 1 && rankdown > 0) {
        if (g.rand(1 / rankdown) < 1) rankdown = 1;
      }
      dts.rank -= Math.trunc(rankdown);
      if (dts.rank < 0) dts.rank = 0;
    }
  } else if (bargain) {
    takeResale(g, itemno, num);
  } else {
    g.world.wholestore[itemno - 1] -= num;
  }
  dt.item[itemno - 1] += num;
  dt.money -= num * price;
  dt.paytoday += num * price;
  addMerchantYen(dt, num * price);

  const item = g.items[itemno];
  const ret =
    `${dts ? dts.shopname : bargain ? '市場 (掘り出し物)' : '市場'}より${item.name}を${num}${item.scale}@￥${price}(計￥${price * num})にて仕入ました` +
    (chargeTime ? `/${formatHms(usetime)}消費` : '/同じ取引の続き (時間は使いません)') +
    (fromCoupon > 0 ? `(うちクーポン${formatHms(fromCoupon)})` : '');
  g.writeLog(0, dt.id, 0, ret);

  if (isWhole && gift) marketGift(g, dt, num * price);
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
  if (!(itemno && price)) price = 0;
  const setItem = price ? itemno : 0;
  // 今と同じ品・同じ値段 (やめるときは、もう空) なら何も変えず、時間も使わない (1.9.0)。
  // 成功した行動なので、ほかの行動と同じく不在閉店までの日数は延びる
  if (dt.showcase[no] === setItem && dt.price[no] === price) {
    return setItem
      ? `棚${no + 1}には今も${g.items[setItem].name}が${price}円で並んでいます。変更なし (時間は使っていません)`
      : `棚${no + 1}は今も空です。変更なし (時間は使っていません)`;
  }
  g.useTime(CATALOG.timeEditShowcase);
  let ret: string;
  if (setItem) {
    ret = `棚${no + 1}に${g.items[itemno].name}を${price}円で陳列`;
    g.writeLog(0, dt.id, 0, ret);
    g.writeLog(0, 0, 0, `${dt.shopname}で${g.items[itemno].name}が${price}円にて陳列されました`);
  } else {
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
  if (!(money > 0)) throw new GameError(dt.moneystock > 0 ? `資金がもう上限 (￥${g.maxMoney}) です` : '入金庫は空です');
  const usetime = g.timeDeal(money, undefined, undefined, dt);
  if (g.usableTime(dt) < usetime) {
    // 何度送っても同じなので、今引き出せる額を添える (1.9.0)
    const max = maxDeposit(g, dt);
    throw new GameError(
      `時間が足りません (￥${money}の引き出しには${formatHms(usetime)}、使える持ち時間は${formatHms(g.usableTime(dt))})。` +
        (max > 0 ? `今引き出せるのは￥${max}までです ("amount":"max" で同じ額)` : '今は1円も引き出せません。持ち時間が戻ってから送ってください'),
    );
  }
  dt.money += money;
  dt.moneystock -= money;
  g.useTime(usetime);
  const ret = `入金庫から資金へ￥${money}引き出しました`;
  g.writeLog(0, dt.id, 0, ret);
  return ret;
}

/**
 * 原作 inc-html-moneystock.cgi の「最大額指定」: 今の持ち時間で入金できる最大額。
 * 原作は比例の近似で、持ち時間がちょうど基本料金のときなどに払えない額を返していた (監査 A12)。
 * deposit と同じ timeDeal (切り捨て込み) で、払える整数額の上限を二分探索で求める。
 */
export function maxDeposit(g: Game, dt: Shop): number {
  const cap = Math.max(0, Math.min(dt.moneystock, g.maxMoney - dt.money));
  const stocktime = g.usableTime(dt);
  const time = (amount: number) => g.timeDeal(amount, undefined, undefined, dt);
  if (cap <= 0 || stocktime < time(1)) return 0;
  if (stocktime >= time(cap)) return cap;
  // timeDeal は額について単調に増える。lo は払える、hi は払えない
  let lo = 1;
  let hi = cap;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (time(mid) <= stocktime) lo = mid;
    else hi = mid;
  }
  return lo;
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
  if (sjisLength(newName) > 40) throw new GameError('店名は全角20文字相当までです。');
  if (sjisLength(newName) < 4) throw new GameError('店名が短すぎます。');
  if (/^[\s　]+$/.test(newName)) throw new GameError('名前・店名が空白になっているか、使用不可文字が使用されています。');
  if (dt.money < 200000) throw new GameError('資金が足りません。');
  if (g.allShops.some((s) => s.shopname === newName)) throw new GameError('既に存在する店名です。-> ' + newName);
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
