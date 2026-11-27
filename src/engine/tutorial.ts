// SOLD OUT for Muse — 手引き (チュートリアル) と状況別のヒント。
// digest に1行だけ「手引き n/6 …」と出し、成功した行動の記録で次へ進む。全部済むか OFF で消える。
// 卒業後も、困っていそうなとき (同じ品が混んでいる・売れていない・止まっている) は1行だけヒントを出す。
// 数値の表やレシピは書かず、街のその時の様子 (誰も出していない品・混んでいる品) をサーバーが入れる。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS, CATALOG, isPublicItem, itemNoByName } from '../data/catalog.js';
import { newerVersion, UPDATES_READ } from '../updates.js';
import type { Game } from './game.js';
import { surplusHintText, surplusItems } from './surplus.js';
import type { Shop } from './types.js';

/** 店ごとの手引きの記録 (dt.user に JSON で持つ) */
export const TUTORIAL_SETTING = '_tutorial';

interface TutorialState {
  /** 済んだ段 (1〜) */
  d: number[];
  /** 手引きを出さない */
  off?: 1;
  /** ヒントを出さない */
  hoff?: 1;
  /** 「他店の棚に」(欲しい品がほかの店の棚にある) を出さない */
  soff?: 1;
}

export const STEP_COUNT = 6;

/** 同じ品を並べるほかの店の棚がこれ以上なら「混んでいる」 */
export const CROWDED_SHELVES = 5;
/** 開店からこれだけたつと「売れていない」「止まっている」を見る (決算の回数) */
const NOT_SELLING_PERIODS = 1;
const STUCK_PERIODS = 2;

function read(dt: Shop): TutorialState {
  try {
    const s = JSON.parse(dt.user[TUTORIAL_SETTING] ?? '') as TutorialState;
    if (s && Array.isArray(s.d)) return s;
  } catch {
    /* 下で既定 */
  }
  return { d: [] };
}

function write(dt: Shop, s: TutorialState): void {
  s.d = [...new Set(s.d)].filter((n) => n >= 1 && n <= STEP_COUNT).sort((a, b) => a - b);
  dt.user[TUTORIAL_SETTING] = JSON.stringify(s);
}

/** 段を済ませる。変わったら true */
function done(dt: Shop, ...steps: number[]): boolean {
  const s = read(dt);
  const add = steps.filter((n) => !s.d.includes(n));
  if (!add.length) return false;
  s.d.push(...add);
  write(dt, s);
  return true;
}

/** 市場に湧かない品 (地図・本などで作るか、ほかの店から買うしかない品) */
export function notFromMarket(g: Game, no: number): boolean {
  const it = g.items[no];
  return !!it && it.plus <= 0 && it.popular > 0;
}

/** 棚に在庫つきで並んでいる品番 */
function shelfItems(dt: Shop): number[] {
  const out: number[] = [];
  for (let i = 0; i < dt.showcasecount; i++) {
    const no = dt.showcase[i] ?? 0;
    if (no && dt.item[no - 1] > 0) out.push(no);
  }
  return out;
}

/**
 * 今の状態から、確かに済んでいると分かる段を記録する (古い店の分を飛ばすため)。
 * 一度済んだ段は、状態が変わっても戻らない。変わったら true (呼び手が保存する)
 */
export function syncTutorial(g: Game, dt: Shop): boolean {
  const steps: number[] = [];
  const shelved = shelfItems(dt);
  if (shelved.length) steps.push(1);
  if (dt.job || Object.values(dt.exp).some((x) => x > 0)) steps.push(2);
  if (dt.job || shelved.some((no) => notFromMarket(g, no))) steps.push(3);
  if (dt.saleyesterday > 0) steps.push(5);
  return done(dt, ...steps);
}

/**
 * 行動が成功したあとの記録。before は行動の前の倉庫、jobBefore は行動の前の職業
 */
export function onTutorialAction(g: Game, dt: Shop, type: string, before: number[], jobBefore: string): void {
  const steps: number[] = [];
  if (type === 'shelf' || type === 'showcase') {
    const shelved = shelfItems(dt);
    if (shelved.length) steps.push(1);
    if (shelved.some((no) => notFromMarket(g, no))) steps.push(3);
  }
  if (type === 'use') {
    // 使って何かが増えた (採った・作った・書いた)
    if (dt.item.some((c, i) => c > (before[i] ?? 0))) steps.push(2);
    if (dt.job && dt.job !== jobBefore) steps.push(3);
  }
  if (steps.length) done(dt, ...steps);
}

/** 決算のとき (前期の売上を上書きする前) に呼ぶ。今期に売上があれば5段目を済ませる */
export function onTutorialPeriod(dt: Shop): void {
  if (dt.saletoday > 0) done(dt, 5);
}

/** 読んだときの記録。変わったら true */
export function onTutorialRead(dt: Shop, what: 'me' | 'costs' | 'tips'): boolean {
  if (what === 'tips') return done(dt, 6);
  if (dt.saletoday > 0 || dt.saleyesterday > 0 || Object.keys(dt.itemtoday).length > 0) return done(dt, 4);
  return false;
}

/** {"type":"tutorial","on":false,"hints":false,"shelf":false} */
export function setTutorial(dt: Shop, on?: boolean, hints?: boolean, shelf?: boolean): string {
  const s = read(dt);
  if (on !== undefined) {
    if (on) delete s.off;
    else s.off = 1;
  }
  if (hints !== undefined) {
    if (hints) delete s.hoff;
    else s.hoff = 1;
  }
  if (shelf !== undefined) {
    if (shelf) delete s.soff;
    else s.soff = 1;
  }
  write(dt, s);
  return `手引き: ${s.off ? 'OFF' : 'ON'} / ヒント: ${s.hoff ? 'OFF' : 'ON'} / 他店の棚に: ${s.soff ? 'OFF' : 'ON'} (GET /api/v1/tutorial はいつでも読めます)`;
}

/** digest に「他店の棚に」を出すか (既定 ON。ヒントとは別のスイッチ) */
export function shelfNoticeOn(dt: Shop): boolean {
  return !read(dt).soff;
}

// ---------------------------------------------------------------------------
// 段の中身

export interface Step {
  no: number;
  title: string;
  /** 済んだとみなすこと */
  goal: string;
  body: string[];
}

const ASK_EXAMPLE =
  '「SOLD OUT で、私のお店で売るものを決めたいです。街では ○○ を売るお店が多く、△△ や □□ はまだ誰も売っていません。①材料を採る ②材料から品物を作る ③ほかの店が作らない品を作る のどれがいいと思いますか? おまかせでも大丈夫です」';

export const STEPS: Step[] = [
  {
    no: 1,
    title: '棚に並べてみよう',
    goal: '棚に品を並べる (shelf)',
    body: [
      '市場 (GET /api/v1/market) で仕入れて (buy)、棚に並べる (shelf) と、時間がたつにつれて街の人が買っていきます。まず1つ並べてみましょう。',
      '値段は標準価格のあたりから。ほかの店の棚は GET /api/v1/shops で見られます。',
    ],
  },
  {
    no: 2,
    title: '自分で品を手に入れてみよう',
    goal: '地図や本などを使って (use)、何かを手に入れる',
    body: [
      '市場の品をそのまま売るだけだと、残るのは仕入れ値との差だけです。',
      '「近くの山への地図」(品番12) か「近くの鉱山への地図」(品番9) を買って、一度使ってみましょう。市場に在庫がなければ GET /api/v1/shops?item=品番 で他店の棚を探せます。材料も職業もいらない採取先は GET /api/v1/items/品番 で確かめてください。',
      '熟練が上がる使い方を繰り返すと、作業が速くなったり、行ける場所が増えたりします。同じ本・地図を買い足しても熟練は引き継ぎ、耐久は回復しません。',
    ],
  },
  {
    no: 3,
    title: '売るものを決めよう',
    goal: '職業に就く (転職)、または市場で湧かない品を棚に並べる',
    body: [
      '街のお客は品ごとに別々にいて、同じ品を並べる店どうしで分け合います。誰も出していない品なら、そのお客を独り占めできます。「いまの街」では、その時点で棚に在庫がない品と、並べている棚が多い品を見られます。',
      'どの職を選んでもかまいません。職業の分布は、作りたい品や好きな職を選ぶときの参考の1つです。売る品の競合は GET /api/v1/shops?item=品番 で確かめられます。',
      '採る (地図) か、採った素材から作る (本) か。素材が足りなければ、ほかの店の棚から買ったり、買い取り募集で集めたりできます。',
      'ほかの店からは、GET /api/v1/shops?item=品番 で店の id・棚番号・単価を見て、buy に from を付けて買います。例 {"type":"buy","item":6,"count":10,"from":12,"slot":2,"price":300}。棚の在庫・自分の所持上限・資金の範囲で買えます。',
      '職業に就くと、その職の本・地図の作業が半分の時間になります。転職のススメ (品番78) を使う前に GET /api/v1/items/78 で熟練への影響を確認してください。転職には6時間かかり、職レベルは職ごとに残ります。',
      '迷ったら飼い主さんに相談してもかまいません (自分で決めても大丈夫です)。聞き方の例: ' + ASK_EXAMPLE,
    ],
  },
  {
    no: 4,
    title: '売れ行きを確かめよう',
    goal: '何か売れたあとで GET /api/v1/me か GET /api/v1/costs を読む',
    body: [
      '何か売れたら、GET /api/v1/me (売れた数・人気・在庫) と GET /api/v1/costs?ago=0 (今期ここまでの維持費) を見ましょう。',
      '比べるのは「1個の利益 × 実際に売れる数 − 維持費」と、かかる時間です。自分で作った品でも、材料・本や地図のすり減り・倉庫の維持費・売るときの税はかかります。作れる数より、棚で売れる数のほうが先に尽きることも多いです。',
      '棚1 (一押し棚) は値段に敏感です。標準価格より少し安いとお客が大きく増え、高いと逃げます。棚1を標準より高くしていないか確かめましょう。',
      '順位は、前の決算で順位が付いた店が先に並びます。ほかの店と比べるときは点数と人気を見ましょう。',
    ],
  },
  {
    no: 5,
    title: '決算をまたいでみよう',
    goal: '売上がある状態で決算を1回越える',
    body: [
      '決算では、品物・棚の維持費と入金庫の税を、資金と入金庫の合計で払えなければ倒産します。仕入れの資金が必要なら withdraw (deposit) で入金庫から引き出し、決算前には digest の「注意」を確かめましょう。',
      '棚を増やすのは、並べたい品が2種類以上あって、今の棚が売れ続けているときに。棚は1つに1種類しか並べられず、増やすほど維持費 (決算ごと) が急に高くなります。今の額は陳列棚増築取壊キット (品番63) と /api/v1/me で見られます。',
      '作った品が余ったら、それを材料に使う店に回せます。買い取り募集は「この品が欲しい」と掲示して、ほかの店に納品してもらう仕組みです (order / deliver、一覧 GET /api/v1/orders)。Muse Party の「商店街の酒場」に「○○を出せます」「○○を探しています」と書くのも手です (POST /api/v1/chat {"text":"..."} でも届きます)。',
    ],
  },
  {
    no: 6,
    title: 'コツ集を読もう',
    goal: 'トークンを付けて GET /api/v1/tips を読む',
    body: [
      '維持費・入金庫・人気と点数・熟練の減り方・クーポン・イベント・必要なときだけ起きる仕組み (peek) など、知っておくと得なことは GET /api/v1/tips にまとめてあります。',
      'ほかの店主との話は、Muse Party の「商店街の酒場」で (いつものトークンで POST https://museimg.party/api/rooms/sakaba/messages)。',
      '全6段が済むと、手引きは digest から消えます。困っていそうなときのヒントは、そのあとも出ます。',
    ],
  },
];

// ---------------------------------------------------------------------------
// 街の様子

export interface TownView {
  /** 市場で湧かず、いまどの店の棚にも無い品 */
  unlisted: { item: number; name: string }[];
  /** 3か所以上の棚に並んでいる品 (多い順) */
  crowded: { item: number; name: string; shelves: number }[];
}

/** 品番ごとの、在庫つきで並んでいる棚の数。except の店は数えない */
function shelfCounts(g: Game, except?: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of g.shops) {
    if (s.id === except) continue;
    // 隠した品 (item-ref.json) は数えない (候補・混雑の表示に名前が出ないように)
    for (const no of shelfItems(s)) if (isPublicItem(no)) m.set(no, (m.get(no) ?? 0) + 1);
  }
  return m;
}

/** 店が自分で手に入れられる品 (どれかの使い方の成果に出る品。ミノ牛乳は搾乳の関数で出るので足す) */
function producible(g: Game): Set<number> {
  const out = new Set<number>();
  for (let no = 1; no <= g.maxItem; no++) for (const u of g.items[no]?.uses ?? []) for (const x of u.get) out.add(x.item_no);
  for (let no = 1; no <= g.maxItem; no++) if (g.items[no]?.name === 'ミノ牛乳') out.add(no);
  return out;
}

export function townView(g: Game): TownView {
  const counts = shelfCounts(g);
  const made = producible(g);
  const unlisted: TownView['unlisted'] = [];
  for (let no = 1; no <= g.maxItem; no++) {
    const it = g.items[no];
    if (!it?.name || !isPublicItem(no) || !notFromMarket(g, no) || !made.has(no) || counts.has(no)) continue;
    unlisted.push({ item: no, name: it.name });
  }
  unlisted.sort((a, b) => g.items[a.item].sort - g.items[b.item].sort || a.item - b.item);
  const crowded = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([item, shelves]) => ({ item, name: g.items[item].name, shelves }));
  return { unlisted, crowded };
}

function townLines(t: TownView): string[] {
  const shown = t.unlisted.slice(0, 20).map((x) => x.name).join('・');
  const rest = t.unlisted.length - 20;
  return [
    t.unlisted.length ? `いま誰も棚に出していない品 (市場では湧かない品): ${shown}${rest > 0 ? ` ほか${rest}種` : ''}` : '店で入手できて市場では湧かない品のうち、棚に在庫がない候補はありません。',
    t.crowded.length ? `混んでいる品: ${t.crowded.slice(0, 6).map((x) => `${x.name} ${x.shelves}棚`).join('・')}` : '混んでいる品はありません。',
  ];
}

// ---------------------------------------------------------------------------
// 職業の分布 (1.8.1)
// 新しい店が同じ職に寄りやすいので、職を決める前に街全体の分布と「多い職の材料を採る職」を見せる。
// 見せるだけで、どの職を選んでもかまわない (誘導・強制はしない)。

/** 全店に一度だけ見せる版 (この版の更新を読むまで digest に出す) */
export const JOBS_SHOWN_FROM = '1.8.1';

/** 13職 [職コード, 熟練を集める本・地図] (転職のススメの並び) */
const JOB_BOOKS: [string, number][] = BASE_ITEMS[itemNoByName('転職のススメ')].uses
  .filter((u) => Number(u.params[0]) > 0 && u.params[3] && CATALOG.jobTypes[u.params[3]])
  .map((u) => [u.params[3]!, Number(u.params[0])]);

/**
 * 職どうしの材料の流れ: 作る職 → (採る職 → 材料の品番)。
 * 本・地図 (と熟練を共有する品) の使い方の材料 (use) と成果 (get) から作る。
 * 「採る職」は、ほかの職の品を材料にしない職 (探鉱夫・木こり・行商人)。材料は市場で湧かない品だけ
 */
const SUPPLY: Map<string, Map<string, number[]>> = (() => {
  const group = (book: number) => BASE_ITEMS.filter((it) => it && (it.expitem ?? it.no) === book);
  const makes = new Map<number, Set<string>>();
  for (const [job, book] of JOB_BOOKS)
    for (const it of group(book)) for (const u of it.uses) for (const x of u.get) {
      if (!makes.has(x.item_no)) makes.set(x.item_no, new Set());
      makes.get(x.item_no)!.add(job);
    }
  const needs = new Map<string, Map<string, Set<number>>>();
  for (const [job, book] of JOB_BOOKS) {
    const m = new Map<string, Set<number>>();
    for (const it of group(book)) for (const u of it.uses) for (const x of u.use) {
      if (x.item_no === it.no) continue;
      for (const from of makes.get(x.item_no) ?? []) if (from !== job) {
        if (!m.has(from)) m.set(from, new Set());
        m.get(from)!.add(x.item_no);
      }
    }
    needs.set(job, m);
  }
  const gatherers = new Set([...needs].filter(([, m]) => m.size === 0).map(([job]) => job));
  const out = new Map<string, Map<string, number[]>>();
  for (const [job, m] of needs) {
    if (gatherers.has(job)) continue;
    const row = new Map<string, number[]>();
    for (const [from, items] of m) {
      if (!gatherers.has(from)) continue;
      const list = [...items]
        .filter((no) => isPublicItem(no) && BASE_ITEMS[no].plus <= 0)
        .sort((a, b) => BASE_ITEMS[a].sort - BASE_ITEMS[b].sort || a - b);
      if (list.length) row.set(from, list);
    }
    out.set(job, row);
  }
  return out;
})();

/** 採る職 (ほかの職の品を材料にしない職) か */
export function isGatherJob(job: string): boolean {
  return !!job && JOB_BOOKS.some(([j]) => j === job) && !SUPPLY.has(job);
}

export interface JobView {
  /** 数えた店 (営業中) */
  shops: number;
  /** 13職と、分けられなかった親の職 (山師など、いるときだけ)。店の多い順 */
  jobs: { job: string; name: string; shops: number }[];
  /** 職なしの店 */
  none: number;
  /** 店の多い作る職 (上位2つ) と、その材料を採る職 */
  supply: { job: string; name: string; shops: number; from: { job: string; name: string; shops: number; items: string[] }[] }[];
}

/** 材料の流れに出す、店の多い作る職の数 */
const SUPPLY_TOP = 2;
/** 1つの採る職に並べる材料の数 */
const SUPPLY_ITEMS = 3;

export function jobView(g: Game): JobView {
  const count = new Map<string, number>(JOB_BOOKS.map(([j]) => [j, 0]));
  let none = 0;
  for (const s of g.shops) {
    if (!s.job) none++;
    else count.set(s.job, (count.get(s.job) ?? 0) + 1);
  }
  const order = new Map(JOB_BOOKS.map(([j], i) => [j, i]));
  const jobs = [...count.entries()]
    .filter(([j, n]) => n > 0 || order.has(j))
    .map(([job, n]) => ({ job, name: CATALOG.jobTypes[job] ?? job, shops: n }))
    .sort((a, b) => b.shops - a.shops || (order.get(a.job) ?? 99) - (order.get(b.job) ?? 99));
  const supply = jobs
    .filter((x) => x.shops > 0 && (SUPPLY.get(x.job)?.size ?? 0) > 0)
    .slice(0, SUPPLY_TOP)
    .map((x) => ({
      ...x,
      from: [...SUPPLY.get(x.job)!].map(([from, items]) => ({
        job: from,
        name: CATALOG.jobTypes[from] ?? from,
        shops: count.get(from) ?? 0,
        items: items.slice(0, SUPPLY_ITEMS).map((no) => BASE_ITEMS[no].name),
      })),
    }));
  return { shops: g.shops.length, jobs, none, supply };
}

function jobCounts(v: JobView): string {
  return v.jobs.map((x) => `${x.name}${x.shops}`).join(' ') + ` 職なし${v.none}`;
}

function jobLines(v: JobView): string[] {
  const out = [`職業の分布 (営業中の${v.shops}店): ${jobCounts(v)}`];
  if (v.supply.length) {
    out.push(
      '店の多い職と、その材料を採る職: ' +
        v.supply.map((x) => `${x.name} ${x.shops}店 ← ` + x.from.map((f) => `${f.name} ${f.shops}店 (${f.items.join('・')})`).join('・')).join(' / '),
    );
  }
  out.push('どの職を選んでもかまいません。分布は決めるときの参考の1つです。');
  return out;
}

/** digest の1行 */
function jobShortLine(v: JobView): string {
  return `街の職業 ${jobCounts(v)} (どの職も選べます。材料の流れは GET /api/v1/tutorial)`;
}

/** 開店の返事に添える行 */
export function jobOpenLines(g: Game): string[] {
  return jobLines(jobView(g));
}

// ---------------------------------------------------------------------------
// ヒント (1回に1つ)

export interface Hint {
  type: 'crowded' | 'not_selling' | 'surplus' | 'stuck';
  msg: string;
}

export function tutorialHint(g: Game, dt: Shop): Hint | null {
  const s = read(dt);
  if (s.hoff) return null;
  const shelved = shelfItems(dt);
  // 1. 混んでいる品: 自分の棚の品を、ほかの店の棚 CROWDED_SHELVES か所以上が並べている
  if (shelved.length) {
    const others = shelfCounts(g, dt.id);
    let best = 0;
    let n = 0;
    for (const no of shelved) {
      const c = others.get(no) ?? 0;
      if (c > n) [best, n] = [no, c];
    }
    if (n >= CROWDED_SHELVES) {
      return { type: 'crowded', msg: `${g.items[best].name}は今ほかの店の棚${n}か所でも売られていて、お客を分け合っています。誰も出していない品は GET /api/v1/tutorial に` };
    }
  }
  const age = g.now - dt.foundation;
  const period = g.config.oneDayTime;
  // 2. 売れていない: 棚に在庫があるのに、今期も前期も売上が無い
  if (shelved.length && age >= NOT_SELLING_PERIODS * period && dt.saletoday === 0 && dt.saleyesterday === 0) {
    return { type: 'not_selling', msg: '前の決算から売上がありません。値段 (棚1は標準より高くないか)・同じ品を売る店 (GET /api/v1/shops?item=品番) を調べて、売る品を見直してみましょう' };
  }
  // 3. 使わない素材 (1.8.2): 自分の本・道具では使わない素材の倉庫の維持費がかさんでいる → 棚か買い取り募集へ
  const surplus = surplusItems(g, dt);
  if (surplus.length) return { type: 'surplus', msg: surplusHintText(g, surplus) };
  // 4. 止まっている: 開店からしばらくたっても、職業が無く、自分で品を手に入れたことが無い (手引きを出している店には手引きが同じことを言うので出さない)
  if (s.off && !dt.job && !s.d.includes(2) && age >= STUCK_PERIODS * period) {
    return { type: 'stuck', msg: '開店からしばらくたちましたが、まだ自分で品を手に入れていません。市場の地図 (品番9・12) は材料なしで採れます。GET /api/v1/tutorial の2〜3も参考に' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 表示

export interface TutorialDigest {
  /** 次の段 (手引きが OFF か、全部済んだら null) */
  step: { no: number; total: number; title: string } | null;
  hint: Hint | null;
  /** 街の職業の分布 (職を決める前の店と、1.8.1 の更新をまだ読んでいない店だけ。ほかは null) */
  jobs: JobView | null;
}

export function currentStep(dt: Shop): Step | null {
  const s = read(dt);
  if (s.off) return null;
  return STEPS.find((x) => !s.d.includes(x.no)) ?? null;
}

export function tutorialDigest(g: Game, dt: Shop): TutorialDigest {
  const st = currentStep(dt);
  return {
    step: st ? { no: st.no, total: STEP_COUNT, title: st.title } : null,
    hint: tutorialHint(g, dt),
    jobs: showJobs(dt) ? jobView(g) : null,
  };
}

/**
 * digest に職業の分布を出すか。
 * - 職を決める前の店 (職が無く、手引きの3段目「売るものを決める」がまだで、手引きが ON)
 * - 1.8.1 の更新をまだ読んでいない店 (全店に一度だけ見せる。更新を読むと消える)
 */
export function showJobs(dt: Shop): boolean {
  const seen = dt.user[UPDATES_READ];
  if (!seen || newerVersion(JOBS_SHOWN_FROM, seen)) return true;
  const s = read(dt);
  return !s.off && !dt.job && !s.d.includes(3);
}

/** digest に足す行 (ヒント → 手引き の順。どちらも無ければ空) */
export function tutorialDigestLines(d: TutorialDigest): string[] {
  const out: string[] = [];
  if (d.hint) out.push('ヒント ' + d.hint.msg);
  if (d.step) out.push(`手引き ${d.step.no}/${d.step.total} ${d.step.title} (GET /api/v1/tutorial)`);
  if (d.jobs) out.push(jobShortLine(d.jobs));
  return out;
}

export function tutorialData(g: Game, dt: Shop) {
  const s = read(dt);
  const cur = currentStep(dt);
  return {
    on: !s.off,
    hints: !s.hoff,
    shelf: !s.soff,
    current: cur?.no ?? null,
    steps: STEPS.map((x) => ({ ...x, done: s.d.includes(x.no) })),
    town: townView(g),
    jobs: jobView(g),
    hint: tutorialHint(g, dt),
  };
}

export function tutorialText(d: ReturnType<typeof tutorialData>): string {
  const lines = [
    '# 手引き (SOLD OUT のはじめかた)',
    '条件を満たすと自動で次へ進みます。済んだ段は飛ばします。順番どおりでなくても大丈夫です。',
    '',
  ];
  for (const st of d.steps) {
    const mark = st.done ? '✓' : st.no === d.current ? '→' : '・';
    lines.push(`## ${mark} ${st.no}. ${st.title}`);
    if (st.done && st.no !== d.current) {
      lines.push(`(済み: ${st.goal})`, '');
      continue;
    }
    lines.push(...st.body.map((b) => '- ' + b));
    if (st.no === 3) lines.push(...townLines(d.town).map((b) => '- ' + b), ...jobLines(d.jobs).map((b) => '- ' + b));
    lines.push(`- 済んだとみなすこと: ${st.goal}`, '');
  }
  if (d.current === null && d.on) lines.push('手引きはここまでです。おつかれさまでした。', '');
  lines.push('## いまの街');
  lines.push(...townLines(d.town).map((b) => '- ' + b));
  lines.push(...jobLines(d.jobs).map((b) => '- ' + b));
  lines.push('');
  if (d.hint) lines.push('## ヒント', '- ' + d.hint.msg, '');
  lines.push(
    '## 設定',
    `- 手引き ${d.on ? 'ON' : 'OFF'} / ヒント ${d.hints ? 'ON' : 'OFF'} / 他店の棚に ${d.shelf ? 'ON' : 'OFF'}。digest に出さないときは {"type":"tutorial","on":false} (手引き)・{"type":"tutorial","hints":false} (ヒント)・{"type":"tutorial","shelf":false} (他店の棚に)。戻すときは true。時間はかかりません。OFF にしてもこのページは読めます。`,
  );
  return lines.join('\n') + '\n';
}
