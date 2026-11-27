// SOLD OUT for Muse — 商品データに埋め込まれていた Perl のコード (@@FUNC*, _local_) の移植。
// 原作 inc-item-data.cgi の該当箇所をそのまま TypeScript にしたもの。
// 商品データの JSON には元の Perl コードも残してある (local_func など) ので、突き合わせに使える。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, itemNoByName } from '../data/catalog.js';
import type { Game, RtItem } from './game.js';
import type { Shop } from './types.js';
import { formatHms, type RtUse } from './use.js';

/** 1.0.0 の飼い葉桶 (干し草を与えて搾るの牛乳が 頭数×1本 増える) */
import { giveJobGift } from './campaign.js';

const TROUGH = 131;

// ---------------------------------------------------------------------------
// package item の補助関数 (原作 inc/inc-item.cgi)

/** item::UseItem($itemno,$count,$msg): 商品を消費し、結果に記録する */
function itemUseItem(dt: Shop, u: RtUse, itemno: number, count: number, msg: string): void {
  if (dt.item[itemno - 1] < count) count = dt.item[itemno - 1];
  dt.item[itemno - 1] -= count;
  u.result.useitem.push({ item_no: itemno, count });
  u.result.usemsg.push(msg);
}

/** item::AddItemSub */
export function addItemSub(g: Game, dt: Shop, itemno: number, count: number): number {
  const limit = g.items[itemno].limit;
  if (limit < dt.item[itemno - 1] + count) count = limit - dt.item[itemno - 1];
  dt.item[itemno - 1] += count;
  return count;
}

/** item::AddItem($itemno,$count,$msg) */
function itemAddItem(g: Game, dt: Shop, u: RtUse, itemno: number, count: number, msg: string): void {
  count = addItemSub(g, dt, itemno, count);
  u.result.additem.push({ item_no: itemno, count });
  u.result.addmsg.push(msg);
}

/** item::WriteLog / event::WriteLog ($mode,$from,$msg) */
/** news: Muse がやった万引き・悪い噂の結果。段 3 や NPC と同じ文でも、街の噂として酒場に流す (1.8.0) */
function log(g: Game, mode: number, from: number, msg: string, news?: boolean): void {
  g.writeLog(mode, from, 0, msg, news);
}

function capRank(dt: Shop): void {
  if (dt.rank > 10000) dt.rank = 10000;
}

/** 本の寿命 (傷みの平均を1とした割合) の幅。1.1.0 */
export const BOOK_LIFE_MIN = 0.7;
export const BOOK_LIFE_MAX = 1.3;

/**
 * 本・地図・牛・桶・ナユタの首飾り (1.8.4) の耐久の表示 (100〜0%)。新品が100%、寿命のいちばん短い場合 (BOOK_LIFE_MIN) に届くと0%。
 * 0%になるまでは壊れず、0%のあとはいつ壊れてもおかしくない (寿命の幅そのものは見せない。リカさん案)
 */
export function bookDurability(dt: Shop, itemno: number): number | undefined {
  const w = dt.bookwear?.[itemno];
  return w ? Math.min(100, Math.max(0, Math.ceil((1 - w[0] / BOOK_LIFE_MIN) * 100 - 1e-9))) : undefined;
}

/** 結果に出す1行「薬調合入門の耐久: 46%」。0%なら「いつ壊れてもおかしくない」を添える */
export function durabilityLine(g: Game, dt: Shop, itemno: number, label: string, zero: string): string {
  const d = bookDurability(dt, itemno) ?? 100;
  return `${g.items[itemno].name}の${label}: ${d}%` + (d === 0 ? ` (${zero})` : '');
}

/**
 * 耐久値を wear (平均の寿命=1) だけ減らし、寿命に届いたら true (超えた分は次の1個に持ち越す)。
 * 品物は減らさない (呼び出し側で減らす)。持っている数が0になっても傷みは残す (売って買い直しても新品にならない)。
 * wear=0 で呼ぶと、たまった傷みでもう1個壊れるかだけを見る。
 */
export function wearStep(g: Game, dt: Shop, itemno: number, wear: number): boolean {
  dt.bookwear ??= {};
  const newLife = (): number => BOOK_LIFE_MIN + g.rand(BOOK_LIFE_MAX - BOOK_LIFE_MIN);
  const w = (dt.bookwear[itemno] ??= [0, newLife()]);
  w[0] += wear;
  if (w[0] < w[1]) return false;
  w[0] = Math.max(0, w[0] - w[1]);
  w[1] = newLife();
  return true;
}

/** 1回に1セット (1往復) だけ使ったときに耐久の行へ添える一言 (1.8.2)。置き場の本・地図は何セットまとめても傷むのは1回分 */
export const BATCH_WEAR_TIP = 'まとめて実行しても傷むのは1回分';

/** 本・地図を wear だけ傷め、寿命に届いたら1冊破棄する。結果に耐久の%を出す。tip は耐久の行に添える一言 */
function addBookWear(g: Game, dt: Shop, u: RtUse, itemno: number, wear: number, tip = ''): string {
  if (!(wear > 0) || !(dt.item[itemno - 1] > 0)) return '';
  const name = g.items[itemno].name;
  if (wearStep(g, dt, itemno, wear)) itemUseItem(dt, u, itemno, 1, name + 'が読めない程ボロボロになりましたので破棄しました');
  return durabilityLine(g, dt, itemno, '耐久', 'いつ壊れてもおかしくない。同じ品を買い足しても耐久は戻りません') + (tip ? ` (${tip})` : '');
}

const ROBOT = (): number => itemNoByName('店番ロボット');
/** 干し草 (0.6.0) */
const HAY = 115;

// ---------------------------------------------------------------------------
// USE の function (使用したときの効果)

export interface UseFuncContext {
  /** 標的の店 ($DTS) */
  dts: Shop | undefined;
  /** 実行回数 ($count) */
  count: number;
}

export type UseFunc = (g: Game, dt: Shop, u: RtUse, c: UseFuncContext) => string | void;

/** キーは "関数名" (共通関数, @@FUNCITEM) または "商品コード:関数名" (その商品専用の _local_) */
export const USE_FUNCS: Record<string, UseFunc> = {
  // ★本or地図がボロボロになって破棄するという処理
  // 1.1.0: 原作は毎回 rand(1000)<param1 で壊れていたが、運の偏りで続けて壊れることがあったので耐久値制にした。
  // 1回ごとに param1/1000 だけ傷み、寿命 (0.7〜1.3、平均1) に届いたら壊れる。長い目で見た壊れる冊数は原作と同じ。
  // 1.8.2: 1セット (1往復) だけのときは、まとめても傷みは1回分だと耐久の行に添える
  lostbook(g, dt, u, { count }) {
    const itemno = u.itemno;
    return addBookWear(g, dt, u, itemno, Number(u.params[0]) / 1000, count === 1 ? BATCH_WEAR_TIP : '');
  },

  // v0.3.0: 置き場の本のすり切れ (lostbook と同じ) に加え、道具の本 params[1] が1セットごとに params[2]/1000 ですり切れる。
  // 1回の実行で減るのは最大1冊 (まとめて作っても、持っている冊数で作れるセット数が縛られない)
  // 1.1.0: 道具の本も耐久値制。1回の実行で傷むのは、原作の「1回で1冊減る確率」1-(1-p)^セット数 と同じ量
  lostbooktool(g, dt, u, { count }) {
    const lines = [USE_FUNCS.lostbook(g, dt, u, { dts: undefined, count })];
    const tool = Number(u.params[1]);
    const proba = Number(u.params[2]) / 1000;
    if (tool && dt.item[tool - 1] > 0) lines.push(addBookWear(g, dt, u, tool, 1 - (1 - proba) ** count));
    return lines.filter(Boolean).join('<br>');
  },

  // ★人気アップ(汎用) param1 アップポイント / param2 最近の出来事用コメント
  popup(g, dt, u) {
    const up = Math.trunc(Number(u.params[0]) * (2 - dt.rank / 5000));
    dt.rank += up;
    capRank(dt);
    const ret = (u.params[1] ?? '') + '：人気' + Math.trunc(up / 100) + '%アップ';
    log(g, 0, dt.id, ret);
    log(g, 3, 0, dt.shopname + 'が' + (u.params[1] ?? ''));
    return ret;
  },

  // 資金調達の方法
  'book-work:_local_1'(g, dt, u, { count }) {
    dt.money += Number(u.params[0]) * count;
    const ret = '￥' + Number(u.params[0]) * count + 'ゲット！';
    log(g, 0, dt.id, 'バイトし、' + ret);
    log(g, 3, 0, dt.shopname + 'がバイトしたようです');
    return ret;
  },

  // ミノタウロス♀ 乳を搾る
  'mino:_local_1'(g, dt, u, { count }) {
    // 職レベルの出来高倍率は意図して掛けない (2026-11-23)。
    const p1 = Number(u.params[0]);
    let val = p1 * count;
    val *= dt.item[25 - 1];
    val = Math.trunc(g.rand(val)) + 1;
    itemAddItem(g, dt, u, 26, val, 'ミノ牛乳を精製しました');
    // 1.1.0: 原作は1回ごとに p1*p1/1000 で1頭ずつ天に召されていた。本と同じ耐久値制にして、
    // 搾るたびに p1*p1/1000×回数 だけ老い、寿命 (0.7〜1.3) に届くごとに1頭。平均の頭数は原作と同じ
    const useproba = p1 * p1;
    const heads = dt.item[25 - 1];
    let usecount = 0;
    if (heads > 0 && wearStep(g, dt, 25, (useproba / 1000) * count)) {
      usecount = 1;
      while (usecount < heads && wearStep(g, dt, 25, 0)) usecount++;
    }
    if (usecount) {
      itemUseItem(dt, u, 25, usecount, g.items[25].name + 'が' + (p1 === 1 ? '寿命' : '過労') + 'で天に召されました');
    }
    const ret = 'ミノ牛乳を' + val + '本精製しました';
    log(g, 0, dt.id, ret);
    return heads > 0 ? `${ret}<br>${durabilityLine(g, dt, 25, '寿命', 'いつ天に召されてもおかしくない')}` : ret;
  },

  // 干し草を与えて搾る (目安箱 #7、0.6.0 で追加。原作に無い使い方)。干し草は前処理 mino:_local_b2 で頭数ぶん×回数を消費済み。
  // 1回で 頭数×params[0] 〜 頭数×(params[0]+params[1]) 本 (5〜7、平均6)。
  // 1.1.1: 牛は「乳を搾る」と同じく1回ごとに 1/1000 だけ老い、寿命に届くごとに1頭天に召される (前は減らなかった)
  'mino:_local_2'(g, dt, u, { count }) {
    // 飼い葉桶の上乗せを含め、職レベルの出来高倍率は意図して掛けない (2026-11-23)。
    const base = Number(u.params[0]);
    const spread = Number(u.params[1]);
    const n = dt.item[25 - 1] * count;
    // 1.0.0: 飼い葉桶 (131) を持っていると 1回ごとに 頭数×1本 多く出る。1回ごとに10%で桶が1個壊れ、
    // 桶が無くなったあとの回には上乗せしない (まとめて搾っても1回ずつ搾っても同じになるように)
    const heads = dt.item[25 - 1];
    let troughs = dt.item[TROUGH - 1];
    const spreadRoll = Math.trunc(g.rand(spread * n + 1));
    let bonus = 0;
    let broken = 0;
    // 1.1.0: 桶も耐久値制。1回ごとに10%傷み、寿命 (0.7〜1.3) に届いたら1個壊れる。平均の個数は今までと同じ
    const hadTrough = troughs > 0;
    for (let i = 0; i < count && troughs > 0; i++) {
      bonus += heads;
      if (wearStep(g, dt, TROUGH, 0.1)) {
        troughs--;
        broken++;
      }
    }
    const val = base * n + spreadRoll + bonus;
    const got = addItemSub(g, dt, 26, val);
    u.result.additem.push({ item_no: 26, count: got });
    u.result.addmsg.push('ミノ牛乳を精製しました');
    let ret = 'ミノ牛乳を' + val + '本精製しました';
    if (got < val) ret += ' (持てる上限で' + (val - got) + '本は捨てました)';
    if (broken) {
      itemUseItem(dt, u, TROUGH, broken, g.items[TROUGH].name + 'が壊れました');
      ret += ' (' + g.items[TROUGH].name + 'が' + broken + '個壊れました)';
    }
    let died = 0;
    if (heads > 0 && wearStep(g, dt, 25, (1 / 1000) * count)) {
      died = 1;
      while (died < heads && wearStep(g, dt, 25, 0)) died++;
    }
    if (died) itemUseItem(dt, u, 25, died, g.items[25].name + 'が寿命で天に召されました');
    log(g, 0, dt.id, ret);
    const lines = [ret];
    if (heads > 0) lines.push(durabilityLine(g, dt, 25, '寿命', 'いつ天に召されてもおかしくない'));
    if (hadTrough) lines.push(durabilityLine(g, dt, TROUGH, '耐久', 'いつ壊れてもおかしくない'));
    return lines.join('<br>');
  },

  // ミノ牛乳 飲む
  'mino_milk:_local_1'(g, dt, _u, { count }) {
    let ret = '';
    if (count >= 30) {
      dt.rank -= count * 2;
      if (dt.rank < 0) dt.rank = 0;
      log(g, 2, 0, dt.shopname + 'の店主が救急車で運ばれました');
      log(g, 2, 0, 'いっぺんにミノ牛乳' + count + '本を飲むなんて正気の沙汰じゃありません');
      ret = '…気が付いたら病院のベッドの上でした';
    } else if (count >= 10) {
      ret = 'オナカを壊してしまいました  いっぺんにミノ牛乳' + count + '本は飲み過ぎです';
      log(g, 0, dt.id, ret);
    } else {
      dt.rank += Math.trunc(g.rand(count + 1)) + count;
      capRank(dt);
      ret = 'ミノ牛乳を飲んで健康になった気がします';
      log(g, 0, dt.id, ret);
    }
    return ret;
  },

  // 陳列棚増築取壊キット
  // 結果に棚の増減と決算ごとの棚の維持費を数字で出す (案: リカさんより)。原作は「陳列棚をN個にしました」だけ。
  'edit-showcase:_local_1'(g, dt, u) {
    const oldcnt = dt.showcasecount;
    const newcnt = Number(u.params[0]);
    dt.showcasecount = newcnt;
    if (oldcnt < newcnt) {
      for (let i = oldcnt; i < newcnt; i++) {
        dt.showcase[i] = 0;
        dt.price[i] = 0;
      }
    }
    if (oldcnt > newcnt) {
      dt.showcase.splice(newcnt);
      dt.price.splice(newcnt);
    }
    log(g, 0, dt.id, `陳列棚を${dt.showcasecount}個にしました`);
    log(g, 3, 0, `${dt.shopname}の陳列棚が${dt.showcasecount}個になりました`);
    return showcaseChangeText(oldcnt, newcnt);
  },

  // 禁断の書 悪い噂を流す
  'badgossip:_local_1'(g, dt, u, { dts }) {
    if (!dts) return '';
    let ret: string;
    let rate = g.shopIndex(dt.id) - g.shopIndex(dts.id);
    if (rate < 0) rate = -rate * 2;
    if (rate < 1.5) rate = 1.5;
    const proba = 1000 / rate;
    if (g.rand(1000) < proba) {
      dts.rank -= Math.trunc(dts.rank / 4);
      ret = dts.shopname + 'の悪い噂を流す作戦が成功しました';
      log(g, 0, dt.id, ret);
      log(g, 3, 0, dts.shopname + 'の悪い噂が広まり人気が下がりました', true);
      if (u.arg.message) log(g, 2, 0, dt.shopname + 'からの犯行声明:「' + u.arg.message + '」');
    } else {
      dt.rank -= Math.trunc(dt.rank / 2);
      ret = dts.shopname + 'の悪い噂を流す作戦が失敗しました';
      log(g, 0, dt.id, ret);
      log(g, 3, 0, dt.shopname + 'が' + dts.shopname + 'の悪い噂を流そうと画策していたようです', true);
    }
    return ret;
  },

  // 禁断の書 万引きする
  'badgossip:_local_2'(g, dt, u, { dts }) {
    if (!dts) return '';
    const robot = ROBOT();
    let rate = g.shopIndex(dt.id) - g.shopIndex(dts.id);
    if (rate < 0) rate = -rate * 2;
    if (rate < 1.5) rate = 1.5;
    const proba = 1000 / rate;
    let ret = '万引きは失敗し、お店の人気が下がりました';
    if (g.rand(1000) < proba) {
      if (dts.item[robot - 1]) {
        dt.rank -= Math.trunc(dt.rank / 2);
        if (g.rand(1000) < 700) {
          dts.item[robot - 1]--;
          log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入り${g.items[robot].name}を破壊しましたが結局捕まりました`, true);
        } else {
          log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入りましたが${g.items[robot].name}に捕まりました`, true);
        }
      } else {
        let manbikiCount = 0;
        for (let idx = 0; idx < dts.showcasecount; idx++) {
          const itemno = dts.showcase[idx];
          if (itemno) {
            let cnt = Math.trunc(dts.item[itemno - 1] / 4);
            if (dt.item[itemno - 1] + cnt > g.items[itemno].limit) cnt = g.items[itemno].limit - dt.item[itemno - 1];
            dts.item[itemno - 1] -= cnt;
            dt.item[itemno - 1] += cnt;
            manbikiCount += cnt * dts.price[idx];
          }
        }
        ret = '万引きは成功しました';
        if (manbikiCount) log(g, 2, 0, `${dts.shopname}が総額￥${manbikiCount}の万引き被害に遭いました`, true);
        if (u.arg.message && manbikiCount) log(g, 2, 0, dt.shopname + 'からの犯行声明:「' + u.arg.message + '」');
        if (!manbikiCount) log(g, 2, 0, dts.shopname + 'に入った万引き犯は何も取らずに逃げました', true);
      }
    } else {
      dt.rank -= Math.trunc(dt.rank / 3);
      log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入りましたが失敗しました`, true);
    }
    log(g, 0, dt.id, ret);
    return ret;
  },

  // 禁断の書 業種の悪い噂を流す
  'badgossip:_local_3'(g, dt, u, { dts }) {
    if (!dts) return '';
    const category: Record<number, string> = { 4: 'ken', 5: 'yoroi', 6: 'tate', 7: 'tue', 8: 'acce' }; // 8 は v0.3.0 で追加 (反アクセサリ運動)
    const itemno = dts.showcase[Math.trunc(g.rand(dts.showcasecount))] ?? 0;
    const itemtype = itemno ? g.items[itemno].type : 0;
    const cat = category[itemtype];
    const eventkey = 'kill-' + cat;
    if (!cat || eventkey in g.world.events) return '噂を流すのに失敗しました';
    g.world.events[eventkey] = g.now + 3 * 60 * 60;
    log(g, 2, 0, CATALOG.itemTypes[itemtype] + '市場の悪い噂が広まっているようです');
    if (u.arg.message) log(g, 2, 0, dt.shopname + 'からの犯行声明:「' + u.arg.message + '」');
    return CATALOG.itemTypes[itemtype] + '市場の悪い噂が広まったようです';
  },

  // 禁断の書 使いたくないので警察に届け出を出す (Muse 追加・目安箱 #6)。本は use の消費でなくなる。
  // 人気は params[0] (100 = 1%) を1回ぶん上げる (所持上限1冊なので1回きり)
  'badgossip:_local_4'(g, dt, u, { count }) {
    if (!count) return '';
    const up = Math.trunc(Number(u.params[0] ?? 0)) * count;
    dt.rank += up;
    capRank(dt);
    const ret = '禁断の書を警察に引き渡しました：人気' + Math.trunc(up / 100) + '%アップ';
    log(g, 0, dt.id, ret);
    log(g, 3, 0, dt.shopname + 'が禁断の書を警察に届け出ました');
    return ret;
  },

  // 転職のススメ
  'port-exp:_local_1'(g, dt, u) {
    let ret = '';
    const p1 = Number(u.params[0] ?? 0);
    if (p1) {
      let exp1 = dt.exp[p1] ?? 0;
      let exp2 = 0;
      for (const s of String(u.params[1] ?? '').split(':')) {
        if (s === '') continue;
        const exps = Number(s);
        const exp = dt.exp[exps] ?? 0;
        // 原作は「$exps==$exp1」(商品番号と熟練度を比べている)。そのまま再現する
        if (!exp || exps === exp1) continue;
        exp2 += exp;
        delete dt.exp[exps];
        const msg = g.items[exps].name + 'の熟練度  ' + Math.trunc(exp / 10) + '%  が  0%  になりました';
        ret += msg + '<br>';
        log(g, 0, dt.id, msg);
      }
      exp2 = Math.trunc(exp2 * Number(u.params[2] ?? 0));
      exp1 += exp2;
      if (exp1 > 1000) exp1 = 1000;
      const msg =
        g.items[p1].name + 'の熟練度  ' + Math.trunc((dt.exp[p1] ?? 0) / 10) + '%  が  ' + Math.trunc(exp1 / 10) + '%  になりました';
      ret += msg + '<br>';
      log(g, 0, dt.id, msg);
      dt.exp[p1] = exp1;
    }
    const p4 = u.params[3] ?? '';
    if (p4 && p4 !== '_default_') {
      dt.job = p4;
      ret += '職業が「' + (CATALOG.jobTypes[p4] ?? '') + '」になりました';
      // 1.0.0 の転職キャンペーン (1店1回)
      const gift = giveJobGift(g, dt, p1);
      if (gift) ret += '<br>' + gift;
    }
    if (p4 === '_default_') {
      dt.job = '';
      ret += '職業が「不定」になりました';
    }
    return ret;
  },
};

/** 決算ごとにかかる棚の維持費 */
export function showcaseCost(count: number): number {
  return CATALOG.showcaseCost[count - 1] ?? 0;
}

/** 「棚 5→3: 陳列枠-2、棚の維持費(決算ごと) ￥200000→￥5000」 */
export function showcaseChangeText(oldcnt: number, newcnt: number): string {
  const diff = newcnt - oldcnt;
  return `棚 ${oldcnt}→${newcnt}: 陳列枠${diff > 0 ? '+' : ''}${diff}、棚の維持費(決算ごと) ￥${showcaseCost(oldcnt)}→￥${showcaseCost(newcnt)}`;
}

/**
 * 使う前の取りやめ判定。文字列を返したら、何も消費せずに NG にする。
 * キーは USE_FUNCS と同じ。
 */
export const USE_CANCEL_CHECKS: Record<string, (g: Game, dt: Shop, u: RtUse, req: { confirm?: boolean }) => string | undefined> = {
  // 陳列棚増築取壊キット: 今と同じ数ならキットもお金も時間も使わない。
  // 増やすとき・減らすときとも、confirm が無ければ実行せずに見込みだけ返す (増やすと維持費が重くなるため。案: リカさんより)
  'edit-showcase:_local_1'(g, dt, u, req) {
    const newcnt = Number(u.params[0]);
    const oldcnt = dt.showcasecount;
    if (newcnt === oldcnt) return `棚は今も${newcnt}個です。変更なし (キャンセル。何も消費していません)`;
    if (newcnt < oldcnt && !req.confirm) {
      const off = [];
      for (let i = newcnt; i < oldcnt; i++) {
        const no = dt.showcase[i] ?? 0;
        if (no) off.push(`棚${i + 1}:${g.items[no].name}`);
      }
      return (
        `確認: ${showcaseChangeText(oldcnt, newcnt)}` +
        (off.length ? ` (外れる: ${off.join(' ')}。在庫は倉庫に残ります)` : '') +
        '。取り壊すなら同じ行動に "confirm":true を付けて送り直してください。キットはなくなり、戻すには費用と時間がかかります (まだ何も変えていません)'
      );
    }
    if (newcnt > oldcnt && !req.confirm) {
      return (
        `確認: ${showcaseChangeText(oldcnt, newcnt)}、増築費用￥${u.money} 時間${formatHms(u.time)}` +
        '。棚の維持費は決算ごとにかかり続けます。増築するなら同じ行動に "confirm":true を付けて送り直してください (まだ何も変えていません)'
      );
    }
    return undefined;
  },
};

/** USE の functionbefore。0=通常 1=使えない 2=表示だけ */
/**
 * 材料の数が店の状態で変わる使い方 (干し草を与えて搾る: 干し草が1回に頭数ぶん) の材料を、その店の数に直す。
 * 実行前の判定 (USE_BEFORE_FUNCS) と、判定を通さずに材料を見るところ (他店の棚に など) の両方で使う
 */
export function scaleUseMaterials(dt: Shop, u: RtUse): void {
  if (u.itemcode !== 'mino' || u.def.func_before !== '_local_b2') return;
  const line = u.use.find((l) => l.no === HAY);
  if (line) line.count = Math.max(1, dt.item[25 - 1]);
}

export type UseBeforeFunc = (g: Game, dt: Shop, u: RtUse) => number;

export const USE_BEFORE_FUNCS: Record<string, UseBeforeFunc> = {
  // 干し草を与えて搾る: 干し草が1回に頭数ぶん要る (定義には1頭ぶんで書いてあり、使い方を調べるときに頭数ぶんへ直す)
  'mino:_local_b2'(_g, dt, u) {
    scaleUseMaterials(dt, u);
    return 0;
  },
  // 剣市への地図: 1割の確率で収穫が2倍
  'shiire-ken:_local_b1'(g, _dt, u) {
    if (g.rand(1000) > 100) return 0;
    for (const c of u.result.create) c.count *= 2;
    u.result.message.resultok = '今回は収穫がいつもより多かったです';
    return 0;
  },
};

// ---------------------------------------------------------------------------
// ITEM の functurn (売上計算のたびに呼ばれる)

export type TurnFunc = (g: Game, item: RtItem, shops: Shop[], timespan: number) => void;

/** キーは商品コード */
export const TURN_FUNCS: Record<string, TurnFunc> = {
  // ナユタの首飾り: 一押し棚に標準価格以下で並べていると人気が上がる
  // 1.8.4: 効いている間は本と同じ耐久の仕組みで首飾りがすり減る。item.param = 1決算あたりの傷み (1000 = 平均1個)。
  // 原作は所持上限1・材料が売値より高く、売れたら効果が止まる「お金で人気を買う」品だったので、効果にだけ値段をつけ直す
  'sousyoku-nayuta'(g, item, shops, timespan) {
    let rankup = timespan / 86.4;
    rankup = rankup < 1 && g.rand(1) < rankup ? 1 : Math.trunc(rankup);
    const wear = ((Number(item.param) || 0) / 1000) * (timespan / g.config.oneDayTime);
    for (const dt of shops) {
      if (dt.showcase[0] !== item.no || dt.price[0] > item.price) continue;
      if (rankup) {
        dt.rank += rankup;
        capRank(dt);
      }
      const have = dt.item[item.no - 1];
      if (wear > 0 && have > 0 && wearStep(g, dt, item.no, wear)) {
        // まとめて計算したとき (長く誰も来なかったあと) は、寿命の短い首飾りが続けて尽きることがある。牛と同じく残りも数える
        let lost = 1;
        while (lost < have && wearStep(g, dt, item.no, 0)) lost++;
        dt.item[item.no - 1] -= lost;
        log(g, 0, dt.id, `${item.name}が${lost}つすり減ってなくなりました`);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// EVENT の startfunc / endfunc / func

/** [ret, msg]。ret が 0 ならイベントは「開始しなかった」扱い (メッセージは出る) */
export type EventFunc = (g: Game, params: string[], timespan: number) => [number, string?];

/** startfunc / endfunc。キーは関数名 (共通関数) または "イベントコード:start" */
export const EVENT_FUNCS: Record<string, EventFunc> = {
  // 原作 inc/inc-event.cgi
  stock_le(g, [itemno, count]) {
    return [g.world.wholestore[Number(itemno) - 1] <= Number(count) ? 1 : 0];
  },
  stock_ge(g, [itemno, count]) {
    return [g.world.wholestore[Number(itemno) - 1] >= Number(count) ? 1 : 0];
  },

  'manbiki:start'(g, [hitproba, breakproba]) {
    const robot = ROBOT();
    for (const dt of g.shops) {
      if (g.rand(1000) > Number(hitproba)) continue;
      if (dt.item[robot - 1]) {
        if (g.rand(1000) > Number(breakproba)) return [0, dt.shopname + 'へ万引きが入りましたが阻止されました'];
        dt.item[robot - 1]--;
        return [0, dt.shopname + 'へ万引きが入り' + g.items[robot].name + 'が破壊されました'];
      }
      let count = 0;
      for (let idx = 0; idx < dt.showcasecount; idx++) {
        const itemno = dt.showcase[idx];
        if (!itemno) continue;
        const cnt = Math.trunc(dt.item[itemno - 1] / 10);
        dt.item[itemno - 1] -= cnt;
        count += cnt * dt.price[idx];
      }
      if (count) return [0, dt.shopname + 'が総額￥' + count + 'の万引き被害に遭いました'];
      return [0, dt.shopname + 'に入った万引き犯は何も取らずに逃げました'];
    }
    return [0];
  },

  'goutou:start'(g, [hitproba]) {
    const robot = ROBOT();
    for (const dt of g.shops) {
      if (g.rand(1000) > Number(hitproba)) continue;
      if (dt.item[robot - 1]) {
        dt.item[robot - 1]--;
        return [0, dt.shopname + 'へ強盗が入り' + g.items[robot].name + 'が破壊されました'];
      }
      dt.rank -= Math.trunc(dt.rank / 5);
      let count = 0;
      for (let idx = 0; idx < dt.showcasecount; idx++) {
        const itemno = dt.showcase[idx];
        if (!itemno) continue;
        const cnt = Math.trunc(dt.item[itemno - 1] / 4);
        dt.item[itemno - 1] -= cnt;
        count += cnt * dt.price[idx];
      }
      if (count) return [0, dt.shopname + 'が総額￥' + count + 'の強盗被害に遭いました'];
      return [0, dt.shopname + 'に入った強盗犯は何も取らずに逃げました'];
    }
    return [0];
  },

  'getmoney:start'(g, [money]) {
    for (const dt of [...g.shops].reverse()) {
      if (g.rand(1000) > 300) continue;
      dt.money += Number(money);
      if (dt.money > g.maxMoney) dt.money = g.maxMoney;
      return [0, dt.shopname + 'へ￥' + money + 'の補助金が支給されました'];
    }
    return [0];
  },

  'getpop:start'(g, [pop]) {
    for (const dt of [...g.shops].reverse()) {
      if (g.rand(1000) > 300) continue;
      dt.rank += Number(pop);
      capRank(dt);
      return [0, dt.shopname + 'が雑誌で紹介され人気が上がったようです'];
    }
    return [0];
  },

  'loto:start'(g) {
    log(g, 2, 0, '宝くじの抽選が行われました');
    for (const dt of g.shops) {
      const count = dt.item[11 - 1];
      dt.item[11 - 1] = 0;
      if (!count) continue;
      for (let i = 0; i < count; i++) {
        const rnd = g.rand(6096454);
        let hit = 0;
        if (rnd < 152411) hit = 5;
        if (rnd < 10000) hit = 4;
        if (rnd < 216) hit = 3;
        if (rnd < 6) hit = 2;
        if (rnd < 1) hit = 1;
        if (hit) {
          const getmoney = [0, 1000000000, 150000000, 5000000, 100000, 10000][hit];
          dt.moneystock += getmoney;
          // 原作は入金庫に足したあと資金(money)のほうを上限で丸めている。そのまま再現する
          if (dt.money > g.maxMoney) dt.money = g.maxMoney;
          log(g, hit <= 3 ? 1 : 2, 0, `${dt.shopname}が${hit}等￥${getmoney}を当てました！`);
        }
      }
    }
    return [0];
  },
};

/** イベント開催中に毎回呼ばれる func。キーはイベントコード */
export const EVENT_NOW_FUNCS: Record<string, EventFunc> = {
  // ハッピー: 全店の人気が少しずつ上がる
  happy(g, _params, timespan) {
    let time = timespan;
    if (time > 10 * 3600) time = 10 * 3600;
    time = Math.trunc(time / 36);
    for (const dt of g.shops) {
      dt.rank += Math.trunc(g.rand(time));
      capRank(dt);
    }
    return [0];
  },
};
