// SOLD OUT for Muse — 商品データに埋め込まれていた Perl のコード (@@FUNC*, _local_) の移植。
// 原作 inc-item-data.cgi の該当箇所をそのまま TypeScript にしたもの。
// 商品データの JSON には元の Perl コードも残してある (local_func など) ので、突き合わせに使える。
// Copyright (C) 2001-2004 MUTOYS (original), SOLD OUT for Muse contributors (port)
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG, itemNoByName } from '../data/catalog.js';
import type { Game, RtItem } from './game.js';
import type { Shop } from './types.js';
import type { RtUse } from './use.js';

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
function log(g: Game, mode: number, from: number, msg: string): void {
  g.writeLog(mode, from, 0, msg);
}

function capRank(dt: Shop): void {
  if (dt.rank > 10000) dt.rank = 10000;
}

const ROBOT = (): number => itemNoByName('店番ロボット');

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
  lostbook(g, dt, u) {
    const itemno = u.itemno;
    if (g.rand(1000) < Number(u.params[0])) {
      itemUseItem(dt, u, itemno, 1, g.items[itemno].name + 'が読めない程ボロボロになりましたので破棄しました');
    }
    return '';
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
    const p1 = Number(u.params[0]);
    let val = p1 * count;
    val *= dt.item[25 - 1];
    val = Math.trunc(g.rand(val)) + 1;
    itemAddItem(g, dt, u, 26, val, 'ミノ牛乳を精製しました');
    const useproba = p1 * p1;
    let usecount = 0;
    for (let i = 0; i < count; i++) if (g.rand(1000) < useproba) usecount++;
    if (usecount) {
      itemUseItem(dt, u, 25, usecount, g.items[25].name + 'が' + (p1 === 1 ? '寿命' : '過労') + 'で天に召されました');
    }
    const ret = 'ミノ牛乳を' + val + '本精製しました';
    log(g, 0, dt.id, ret);
    return ret;
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
      log(g, 3, 0, dts.shopname + 'の悪い噂が広まり人気が下がりました');
      if (u.arg.message) log(g, 2, 0, dt.shopname + 'からの犯行声明:「' + u.arg.message + '」');
    } else {
      dt.rank -= Math.trunc(dt.rank / 2);
      ret = dts.shopname + 'の悪い噂を流す作戦が失敗しました';
      log(g, 0, dt.id, ret);
      log(g, 3, 0, dt.shopname + 'が' + dts.shopname + 'の悪い噂を流そうと画策していたようです');
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
          log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入り${g.items[robot].name}を破壊しましたが結局捕まりました`);
        } else {
          log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入りましたが${g.items[robot].name}に捕まりました`);
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
        if (manbikiCount) log(g, 2, 0, `${dts.shopname}が総額￥${manbikiCount}の万引き被害に遭いました`);
        if (u.arg.message && manbikiCount) log(g, 2, 0, dt.shopname + 'からの犯行声明:「' + u.arg.message + '」');
        if (!manbikiCount) log(g, 2, 0, dts.shopname + 'に入った万引き犯は何も取らずに逃げました');
      }
    } else {
      dt.rank -= Math.trunc(dt.rank / 3);
      log(g, 3, 0, `${dt.shopname}が${dts.shopname}へ万引きに入りましたが失敗しました`);
    }
    log(g, 0, dt.id, ret);
    return ret;
  },

  // 禁断の書 業種の悪い噂を流す
  'badgossip:_local_3'(g, dt, u, { dts }) {
    if (!dts) return '';
    const category: Record<number, string> = { 4: 'ken', 5: 'yoroi', 6: 'tate', 7: 'tue' };
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
  // 減らすときは、confirm が無ければ実行せずに見込みだけ返す (増やすときは確認なし。案: リカさんより)
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
    return undefined;
  },
};

/** USE の functionbefore。0=通常 1=使えない 2=表示だけ */
export type UseBeforeFunc = (g: Game, dt: Shop, u: RtUse) => number;

export const USE_BEFORE_FUNCS: Record<string, UseBeforeFunc> = {
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
  'sousyoku-nayuta'(g, item, shops, timespan) {
    let rankup = timespan / 86.4;
    rankup = rankup < 1 && g.rand(1) < rankup ? 1 : Math.trunc(rankup);
    if (!rankup) return;
    for (const dt of shops) {
      if (dt.showcase[0] !== item.no || dt.price[0] > item.price) continue;
      dt.rank += rankup;
      capRank(dt);
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
