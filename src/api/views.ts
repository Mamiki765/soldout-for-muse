// SOLD OUT for Muse — API の返事の組み立て。AI が読む前提で、短いテキストを基本にする。
// 同じ内容を JSON でも返せるよう、まずデータ (オブジェクト) を作り、テキストはそこから作る。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { CATALOG } from '../data/catalog.js';
import { APP_VERSION } from '../updates.js';
import type { Game } from '../engine/game.js';
import { getMarketStatus, getWholeStore } from '../engine/market.js';
import type { Shop } from '../engine/types.js';
import { checkUses, itemUseTime, loadUses } from '../engine/use.js';
import { maxDeposit } from '../engine/actions.js';
import type { BoardPost, StoredLog, Suggestion } from '../store.js';

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

const pct = (rank: number) => Math.trunc(rank / 100);

function shelfData(g: Game, dt: Shop) {
  const out = [];
  for (let i = 0; i < dt.showcasecount; i++) {
    const no = dt.showcase[i] ?? 0;
    out.push(
      no
        ? { slot: i, item: no, name: g.items[no].name, price: dt.price[i], stock: dt.item[no - 1] }
        : { slot: i, item: 0, name: '', price: 0, stock: 0 },
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
}

export function digestData(g: Game, dt: Shop, n: DigestInput, update: string | null = null) {
  const rankNo = g.shopIndex(dt.id) + 1;
  const stock = g.stockTime(dt);
  const full = g.config.maxStockTime - stock;
  const shelves = shelfData(g, dt);
  const warnings: string[] = [];
  for (const s of shelves) {
    if (!s.item) warnings.push(`棚${s.slot + 1}が空`);
    else if (s.stock === 0) warnings.push(`棚${s.slot + 1}の${s.name}が売切`);
  }
  if (full <= 0) warnings.push('持ち時間が満タン');
  return {
    shop: dt.shopname,
    rank: rankNo,
    shops: g.shops.length,
    popularity: pct(dt.rank),
    point: dt.point,
    money: dt.money,
    moneystock: dt.moneystock,
    time: stock,
    time_full_in: full > 0 ? full : 0,
    next_period: g.nextPeriodTime(),
    shelves,
    new: { mine: n.newMine, town: n.newTown, chat: n.newChat, bbs: n.newBbs, replies: n.newReplies ?? 0 },
    events: g.eventMessages,
    warnings,
    version: APP_VERSION,
    update,
  };
}

export function digestText(d: ReturnType<typeof digestData>): string {
  const shelves = d.shelves
    .map((s) => (s.item ? `${s.slot + 1}:${s.name}@${s.price}残${s.stock}` : `${s.slot + 1}:空`))
    .join(' ');
  const news = [
    d.new.mine && `自分${d.new.mine}`,
    d.new.town && `街${d.new.town}`,
    d.new.chat && `井戸端${d.new.chat}`,
    d.new.bbs && `掲示板${d.new.bbs}`,
    d.new.replies && `目安箱の返事${d.new.replies}`,
  ].filter(Boolean);
  const lines = [
    `${d.shop} ${d.rank}位/${d.shops} 人気${d.popularity}% 点${d.point} 資金${d.money} 入金庫${d.moneystock} 時間${dur(d.time)}${d.time_full_in ? '' : '(満)'} 決算${jst(d.next_period)}`,
    `棚 ${shelves}`,
  ];
  const tail: string[] = [];
  if (news.length) tail.push('新着 ' + news.join(' '));
  // 原作と同じく、イベントは説明だけ出す (残り時間は原作でも見えない)
  if (d.events.length) tail.push('イベント ' + d.events.join('/'));
  if (d.warnings.length) tail.push('注意 ' + d.warnings.join('/'));
  if (tail.length) lines.push(tail.join(' | '));
  if (d.update) lines.push(d.update);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// me: 自分の店の詳細

export function meData(g: Game, dt: Shop) {
  getMarketStatus(g);
  const stock: { item: number; name: string; count: number; limit: number; today: number; yesterday: number; exp: number; market: number }[] = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const c = dt.item[no - 1];
    const today = dt.itemtoday[no] ?? 0;
    const yesterday = dt.itemyesterday[no] ?? 0;
    const exp = dt.exp[no] ?? 0;
    if (!c && !today && !yesterday && !exp) continue;
    const it = g.items[no];
    stock.push({ item: no, name: it.name, count: c, limit: it.limit, today, yesterday, exp: Math.trunc(exp / 10), market: it.marketprice });
  }
  stock.sort((a, b) => g.items[a.item].sort - g.items[b.item].sort);
  const [tax, taxrate] = g.taxToday(dt);
  return {
    id: dt.id,
    name: dt.name,
    shop: dt.shopname,
    job: dt.job ? CATALOG.jobTypes[dt.job] ?? dt.job : '不定',
    rank: g.shopIndex(dt.id) + 1,
    popularity: pct(dt.rank),
    point: dt.point,
    money: dt.money,
    moneystock: dt.moneystock,
    deposit_max_now: maxDeposit(g, dt),
    time: g.stockTime(dt),
    time_max: g.config.maxStockTime,
    sale: { today: dt.saletoday, yesterday: dt.saleyesterday },
    pay: { today: dt.paytoday, yesterday: dt.payyesterday },
    cost: { today: Math.trunc(dt.costtoday), yesterday: dt.costyesterday, showcase: CATALOG.showcaseCost[dt.showcasecount - 1] ?? 0 },
    tax: { sale_rate: g.userTaxRate(dt), stock_tax: tax, stock_tax_rate: taxrate },
    next_period: g.nextPeriodTime(),
    comment: dt.comment,
    shelves: shelfData(g, dt),
    stock,
  };
}

export function meText(d: ReturnType<typeof meData>): string {
  const lines = [
    `店 id${d.id} ${d.shop} 職業${d.job} ${d.rank}位 人気${d.popularity}% 点${d.point}`,
    `資金${d.money} 入金庫${d.moneystock}(今すぐ入金できる最大${d.deposit_max_now}) 時間${dur(d.time)}/${dur(d.time_max)}`,
    `今期 売上${d.sale.today} 支払${d.pay.today} 維持費${d.cost.today}+棚${d.cost.showcase} | 前期 売上${d.sale.yesterday} 支払${d.pay.yesterday} 維持費${d.cost.yesterday}`,
    `税 売上税率+${d.tax.sale_rate}% 入金庫税${d.tax.stock_tax}(${d.tax.stock_tax_rate}%) 決算${jst(d.next_period)}`,
    '# 棚 番号 品番 名前 価格 在庫',
    ...d.shelves.map((s) => (s.item ? `${s.slot + 1} ${s.item} ${s.name} ${s.price} ${s.stock}` : `${s.slot + 1} - 空`)),
    '# 倉庫 品番 名前 数/上限 今期売/前期売 熟練% 相場',
    ...d.stock.map((s) => `${s.item} ${s.name} ${s.count}/${s.limit} ${s.today}/${s.yesterday} ${s.exp} ${s.market || '-'}`),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// market: 市場 (卸) と相場

export function marketData(g: Game) {
  getMarketStatus(g);
  const cases = getWholeStore(g).map((c) => {
    const it = g.items[c.itemno];
    return { item: c.itemno, name: it.name, stock: c.stock, price: c.price, std: it.price, market: it.marketprice, balance: it.uppoint };
  });
  return { people: g.world.people, events: g.eventMessages, items: cases };
}

/** 原作 GetMarketStatusGraph の文字版: 均衡/飽和/不足 */
export function balanceWord(per: number): string {
  if (!per) return '-';
  if (per >= 110) return '飽和';
  if (per <= 90) return '不足';
  return '均衡';
}

export function marketText(d: ReturnType<typeof marketData>): string {
  const lines = [`人口${d.people}` + (d.events.length ? ' イベント ' + d.events.join('/') : ''), '# 市場 品番 名前 在庫 単価 標準 相場 需給'];
  for (const c of d.items) lines.push(`${c.item} ${c.name} ${c.stock} ${c.price} ${c.std} ${c.market || '-'} ${balanceWord(c.balance)}`);
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
    const sh = s.shelves.map((x) => `${x.slot + 1}:${x.item}:${x.name}@${x.price}x${x.stock}`).join(' ');
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

/** 職業の表示名。不定なら '' (原作のランキングは不定を出さない) */
export function jobName(dt: Shop): string {
  return dt.job ? CATALOG.jobTypes[dt.job] ?? dt.job : '';
}

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
// items: 商品の一覧 (変わらないので最初に 1 回取れば十分)

export function itemsData(g: Game) {
  const out = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const it = g.items[no];
    out.push({
      item: no,
      name: it.name,
      type: CATALOG.itemTypes[it.type],
      price: it.price,
      cost: it.cost,
      limit: it.limit,
      uses: it.uses.length,
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

export function itemsText(d: ReturnType<typeof itemsData>): string {
  const lines = ['# 商品 品番 名前 分類 標準価格 維持費/日 上限 使い方の数 注記'];
  for (const i of d) lines.push(`${i.item} ${i.name} ${i.type} ${i.price} ${i.cost} ${i.limit} ${i.uses}${i.flags.length ? ' ' + i.flags.join(',') : ''}`);
  return lines.join('\n') + '\n';
}

/** 1 商品の詳しい説明と使い方。dt があれば、その店で今使えるかも付ける */
export function itemDetailData(g: Game, itemno: number, dt?: Shop) {
  const it = g.items[itemno];
  const uses = dt ? checkUses(g, dt, loadUses(g, itemno)) : loadUses(g, itemno);
  return {
    item: itemno,
    name: it.name,
    info: it.info,
    type: CATALOG.itemTypes[it.type],
    price: it.price,
    cost: it.cost,
    limit: it.limit,
    flags: flagWords(it.flag),
    uses: uses.map((u) => ({
      use: u.no,
      name: u.name,
      info: u.def.info ?? '',
      time: dt ? itemUseTime(dt, u) : u.time,
      money: u.money,
      exp: Math.trunc(u.exp / 10),
      needexp: Math.trunc(u.needexp / 10),
      needs: u.use.map((l) => ({ item: l.no, name: g.items[l.no].name, count: l.count, consume: l.proba / 10 })),
      gets: u.result.create.map((l) => ({ item: l.no, name: g.items[l.no].name, count: l.count, chance: l.proba / 10 })),
      target: u.argspec.includes('target'),
      message: u.argspec.includes('message'),
      one_at_a_time: u.argspec.includes('nocount'),
      usable: dt ? u.useok : undefined,
    })),
  };
}

export function itemDetailText(d: ReturnType<typeof itemDetailData>): string {
  const lines = [`${d.item} ${d.name} (${d.type}) 標準${d.price} 維持費${d.cost} 上限${d.limit}${d.flags.length ? ' ' + d.flags.join(',') : ''}`, d.info];
  if (d.uses.length) lines.push('# 使い方 番号 名前 時間 費用 | 材料 → 成果 | 熟練');
  for (const u of d.uses) {
    const needs = u.needs.map((n) => `${n.name}x${n.count}${n.consume === 100 ? '' : n.consume === 0 ? '(消費しない)' : `(${n.consume}%で消費)`}`).join(',');
    const gets = u.gets.map((n) => `${n.name}x${n.count}${n.chance === 100 ? '' : `(${n.chance}%)`}`).join(',');
    const extra = [u.target && '要標的', u.message && '一言可', u.one_at_a_time && '1回ずつ', u.usable === false && '今は使えない'].filter(Boolean).join(',');
    lines.push(
      `${u.use} ${u.name} ${dur(u.time)} ${u.money} | ${needs || '-'} → ${gets || '-'} | +${u.exp}%${u.needexp ? ` 要${u.needexp}%` : ''}${extra ? ' ' + extra : ''}`,
    );
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
