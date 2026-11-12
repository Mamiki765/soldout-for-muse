// v0.2.0 実装仕様書の確定値と原作79種の差分制限を検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BASE_ITEMS, MAX_ITEM, itemNoByName, type ItemDef, type UseDef } from '../src/data/catalog.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { openShop, enterShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { newWorld } from '../src/engine/types.js';
import { checkUses, loadUses, useItemAction } from '../src/engine/use.js';
import { seedWholeStore } from '../src/engine/market.js';
import { Store } from '../src/store.js';

const original = JSON.parse(execFileSync('perl', ['tools/dump-items.pl', 'normal', '--original'], { encoding: 'utf8' })) as {
  items: ItemDef[]; events: unknown[]; define: Record<string, unknown>;
};
const current = JSON.parse(readFileSync('src/data/items.json', 'utf8')) as typeof original;
const originalByNo = (no: number) => original.items.find((it) => it.no === no)!;

// No, 正式名, price, popular, cost, limit, plus (§1)
const itemSpecs: [number, string, number, number, number, number, number][] = [
  [80,'草織り布',400,7200,40,2000,-3600],
  [81,'ヒョウ柄ミニスカート',12000,129600,600,50,0],
  [82,'厚底ブーツ',18000,172800,900,50,0],
  [83,'ルーズソックス',15000,172800,750,50,0],
  [84,'ラメのチョーカー',16000,172800,800,50,0],
  [85,'革のロングコート',24000,259200,1200,30,0],
  [86,'宝石のブローチ',24000,259200,1200,30,0],
  [87,'寄木の髪飾り',20000,172800,1000,50,0],
  [88,'鉄鉱石',150,3600,20,2000,-1200],
  [89,'ミスリル原石',500,7200,50,1000,-1200],
  [90,'オリハルコン原石',900,10800,80,500,-1200],
  [91,'樹脂',300,4800,30,2000,-1200],
  [92,'砂鉄',200,3600,30,2000,-1200],
  [93,'宝石原石',500,7200,50,1000,-1200],
  [94,'香木',600,7200,60,1000,-1200],
  [95,'樹皮',200,3600,30,2000,-1200],
  [96,'繊維草',100,2400,20,2000,43200],
  [97,'精鋼板',1600,14400,90,700,-3600],
  [98,'ミスリル線',3000,28800,120,500,-3600],
  [99,'製材板',900,10800,60,1000,-3600],
  [100,'樹脂板',1500,14400,80,700,-3600],
  [101,'なめし革',1400,14400,80,700,-3600],
  [102,'研磨宝石',2500,21600,100,500,-3600],
];

// book, product, 材料, get, proba, time, exptime, lostbook (§2〜3)
const production: [number, number, number[][], number, number, number, number, number][] = [
  [16,80,[[96,20],[1,10],[3,4]],20,800,3600,2400,50],
  [17,99,[[4,6]],20,900,3600,2400,50],
  [16,101,[[2,30],[95,20],[91,10]],20,800,3600,2400,50],
  [20,97,[[5,8],[88,20],[92,10]],20,800,7200,4800,70],
  [20,98,[[89,6],[6,4]],20,600,7200,4800,70],
  [17,100,[[99,6],[91,10]],10,900,7200,4800,70],
  [66,102,[[93,20],[80,4]],10,900,7200,4800,70],
  [16,81,[[101,30],[80,30],[2,30],[97,4]],10,800,10800,7200,100],
  [16,82,[[101,20],[99,10],[100,10],[97,8],[80,10]],10,600,14400,10800,100],
  [16,83,[[80,50],[101,10],[2,10]],10,400,10800,7200,100],
  [66,84,[[98,15],[80,10],[101,4],[itemNoByName('エーテル'),10]],10,600,14400,10800,100],
  [16,85,[[101,30],[80,30],[2,30],[68,10]],10,400,18000,14400,150],
  [66,86,[[102,10],[98,6],[6,8],[67,10],[8,4]],10,400,18000,14400,150],
  [17,87,[[100,30],[99,10],[94,15],[91,10],[68,4]],10,600,14400,10800,100],
];

const gathering: [number, string, number, number[][]][] = [
  [9,'砂鉄の河床を探る',200,[[88,80,800],[92,40,750]]],
  [9,'青晶洞を探索する',400,[[89,30,800],[93,20,750]]],
  [9,'深層の鉱脈を掘る',600,[[90,18,800],[93,12,750],[8,5,100]]],
  [12,'樹脂林で樹液を採る',200,[[91,30,800],[95,30,800]]],
  [12,'香木林を探索する',400,[[94,15,800],[96,50,800]]],
];

const changedMaterials = [
  [[5,6],[88,20],[92,5]], [[6,4],[8,3]],
  [[7,2],[90,5],[8,2]], [[5,4],[6,4],[7,4],[102,4],[8,3]],
];
const triples = (u: UseDef['use']) => u.map((l) => [l.item_no, l.count, l.proba]);
// 置き先の本の既存USEと同じ、非消費の工具 (count 1・proba 0) の所持条件
const BOOK_TOOLS: Record<number, number[]> = { 66: [18, 19], 20: [18] };
const toolsOf = (book: number) => BOOK_TOOLS[book] ?? [];

test('102種の番号・正式名・確定値と、全USEの参照が正しい', () => {
  assert.equal(MAX_ITEM, 102);
  assert.equal(current.items.length, 102);
  assert.equal(new Set(current.items.map((it) => it.code)).size, 102);
  assert.equal(new Set(current.items.map((it) => it.name)).size, 102);
  for (const [no,name,price,popular,cost,limit,plus] of itemSpecs) {
    const i = BASE_ITEMS[no];
    assert.deepEqual([i.no,i.name,i.price,i.popular,i.cost,i.limit,i.plus,i.point,i.type],
      [no,name,price,popular,cost,limit,plus,1000,no >= 81 && no <= 87 ? 8 : 1]);
    if (i.type === 8) assert.deepEqual([i.pricebase,i.pricehalf,i.wslimit], [20,30,0]);
  }
  for (const i of current.items) {
    assert.equal(BASE_ITEMS[i.no].no, i.no);
    assert.equal(new Set(i.uses.map((u) => u.no)).size, i.uses.length);
    for (const u of i.uses) for (const l of [...u.use, ...u.get]) {
      assert.ok(BASE_ITEMS[l.item_no], `${i.no}/${u.no}: item ${l.item_no}`);
      assert.ok(l.count > 0 && Number.isInteger(l.count));
      assert.ok(l.proba >= 0 && l.proba <= 1000);
    }
  }
});

test('既存79種は4レシピと末尾へのUSE追加以外に差分がなく、イベントも不変', () => {
  for (const old of original.items) {
    const expected = structuredClone(old);
    if (old.no === 66) expected.uses.forEach((u, index) => {
      u.use = [...u.use.filter((l) => l.proba === 0), ...changedMaterials[index].map(([item_no,count]) => ({ item_no,count,proba:1000 }))];
    });
    const actual = structuredClone(BASE_ITEMS[old.no]);
    actual.uses = actual.uses.slice(0, old.uses.length);
    assert.deepEqual(actual, expected, `No.${old.no}`);
  }
  assert.deepEqual(current.events, original.events);
  assert.deepEqual(current.define, { ...original.define, version: '0.2.0' });
  assert.deepEqual(BASE_ITEMS[77], originalByNo(77), 'お祝いセットは変更しない');
});

test('中間7種・完成7種の材料、時間、確率、摩耗、職業は仕様どおり', () => {
  for (const [book,product,ingredients,get,proba,time,exptime,lostbook] of production) {
    const u = BASE_ITEMS[book].uses.find((u) => u.get[0]?.item_no === product)!;
    assert.ok(u, BASE_ITEMS[product].name);
    assert.deepEqual(triples(u.use), [...toolsOf(book).map((n) => [n,1,0]), ...ingredients.map(([n,c]) => [n,c,1000])]);
    assert.deepEqual(triples(u.get), [[product,get,proba]]);
    assert.deepEqual([u.time,u.exptime,u.func,u.params[0],u.needexp], [time,exptime,'lostbook',String(lostbook),null]);
    assert.deepEqual(u.jobs, [{ job:book === 20 ? 'weapon' : 'tool', key:'times', op:'/', value:2 }]);
  }
  assert.equal(current.items.reduce((n,i) => n+i.uses.length,0)-original.items.reduce((n,i) => n+i.uses.length,0), 19);
  const choker = BASE_ITEMS[66].uses.find((u) => u.get[0]?.item_no === 84)!;
  assert.deepEqual(choker.use.map((l) => BASE_ITEMS[l.item_no].name), ['鍛冶屋の技術','魔法の知識','ミスリル線','草織り布','なめし革','エーテル']);
});

test('装飾細工入門・剣の鍛え方の新規USEは、既存USEと同じ工具を所持条件に持つ', () => {
  for (const book of [66, 20]) {
    const tools = (u: UseDef) => u.use.filter((l) => l.proba === 0).map((l) => [l.item_no, l.count]);
    const existing = originalByNo(book).uses;
    // 既存USEのうちナユタの首飾り以外が持つ共通の工具と一致させる (目利きの真髄は付けない)
    for (const u of existing) assert.ok(toolsOf(book).every((n) => tools(u).some(([no]) => no === n)), u.name!);
    for (const u of BASE_ITEMS[book].uses.slice(existing.length)) {
      assert.deepEqual(tools(u), toolsOf(book).map((n) => [n, 1]), u.name!);
    }
  }
  for (const book of [16, 17]) for (const u of BASE_ITEMS[book].uses) assert.ok(u.use.every((l) => l.proba > 0), u.name!);
});

test('工具を1つでも欠くと新規5件は実行できず、状態も変わらない', () => {
  for (const [book,product,ingredients] of production.filter(([book]) => toolsOf(book).length)) {
    for (const missing of toolsOf(book)) {
      const { g,dt } = fixture(book,book === 20 ? 'weapon':'tool');
      for (const [no,count] of ingredients) dt.item[no-1] = count;
      for (const n of toolsOf(book)) if (n !== missing) dt.item[n-1] = 1;
      const useNo = BASE_ITEMS[book].uses.find((u) => u.get[0]?.item_no === product)!.no;
      assert.equal(checkUses(g,dt,loadUses(g,book)).find((u) => u.no === useNo)!.useok, false);
      const before = structuredClone(dt);
      assert.throws(() => useItemAction(g,dt,book,useNo,{count:1}), GameError);
      assert.deepEqual(dt,before);
    }
  }
});

test('追加採取の5ゲート・複数産出・熟練と、既存の行き先を維持', () => {
  for (const [book,name,needexp,products] of gathering) {
    const u = BASE_ITEMS[book].uses.find((u) => u.name === name)!;
    assert.deepEqual([u.needexp,u.time,u.exptime,u.exp], [needexp,10800,5400,10]);
    assert.deepEqual(triples(u.get), products);
  }
  for (const book of [9,12]) assert.ok(BASE_ITEMS[book].uses.slice(0,originalByNo(book).uses.length).every((u) => u.needexp === null));
});

const T0 = 1_800_000_000;
function fixture(book: number, job: string) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => 0.2 }, T0);
  const dt = openShop(g, { name:'test', shopname:'試験商店' });
  dt.item[book-1] = 1;
  dt.job = job;
  dt.time = T0-48*3600;
  enterShop(g, dt, true);
  return { g,dt };
}

test('5ゲートを1未満では拒否し、閾値ちょうどでは複数素材を得て熟練+10', () => {
  for (const [book,name,threshold,products] of gathering) {
    const { g,dt } = fixture(book, 'material');
    const useNo = BASE_ITEMS[book].uses.find((u) => u.name === name)!.no;
    dt.exp[book] = threshold-1;
    assert.equal(checkUses(g,dt,loadUses(g,book)).find((u) => u.no === useNo)!.useok, false);
    const before = structuredClone(dt);
    assert.throws(() => useItemAction(g,dt,book,useNo,{count:1}), GameError);
    assert.deepEqual(dt,before);
    dt.exp[book] = threshold;
    const time = dt.time;
    const u = useItemAction(g,dt,book,useNo,{count:1});
    assert.equal(u.result.count,1);
    assert.equal(dt.exp[book],threshold+10);
    assert.equal(dt.time-time,5400-Math.trunc(2700*threshold/1000));
    for (const [no,get,proba] of products) assert.equal(dt.item[no-1], proba > 200 ? get : 0);
  }
});

test('新規生産は1セットごとの材料を消費し、一致職業の時間が半分になる', () => {
  for (const [book,product,ingredients,get,,time] of production) {
    const { g,dt } = fixture(book,book === 20 ? 'weapon':'tool');
    for (const [no,count] of ingredients) dt.item[no-1] = count*2;
    for (const n of toolsOf(book)) dt.item[n-1] = 1;
    const useNo = BASE_ITEMS[book].uses.find((u) => u.get[0]?.item_no === product)!.no;
    const before = dt.time;
    const u = useItemAction(g,dt,book,useNo,{count:2});
    assert.equal(u.result.count,2);
    assert.equal(dt.time-before,time); // (基礎時間/2) × 2セット
    assert.equal(dt.item[product-1],get*2);
    for (const [no] of ingredients) assert.equal(dt.item[no-1],0);
    for (const n of toolsOf(book)) assert.equal(dt.item[n-1],1, '工具は消費しない');
  }
});

test('原作定義からの再生成がコミット対象JSONと完全一致する', () => {
  assert.equal(execFileSync('perl',['tools/dump-items.pl','normal'],{encoding:'utf8'}),readFileSync('src/data/items.json','utf8'));
});

test('79品時代のセーブは在庫を保ったまま102枠へ拡張し、新素材は初期投入しない', () => {
  const store = new Store(':memory:');
  try {
    const w = newWorld(T0,79);
    const g = new Game(w,DEFAULT_CONFIG,{next:()=>0.2},T0);
    const dt = openShop(g,{name:'old',shopname:'既存商店'});
    dt.item = Array(79).fill(2);
    w.wholestore.fill(3);
    dt.exp[9] = 400;
    store.saveWorld(w,[],T0,172800);
    const loaded = store.loadWorld(T0);
    assert.deepEqual(loaded.wholestore,[...Array(79).fill(3),...Array(23).fill(0)]);
    assert.deepEqual(loaded.shops[0].item,[...Array(79).fill(2),...Array(23).fill(0)]);
    assert.equal(loaded.shops[0].exp[9],400);
  } finally { store.close(); }
});

test('新素材の市場初期投入: plus のある16種だけに一度、上限内で足し、他には触れない', () => {
  const { g,dt } = fixture(16,'tool');
  g.world.people = 300000;
  const before = structuredClone(g.world);
  const targets = itemSpecs.map(([no]) => no).filter((no) => BASE_ITEMS[no].plus !== 0);
  assert.equal(targets.length,16);
  assert.ok(targets.every((no) => no < 81 || no > 87), '完成品は plus 0 なので対象外');
  dt.item[88-1] = 299; // 店の手持ちも上限に数える (鉄鉱石 wslimit 300 × 1店)
  const rows = seedWholeStore(g,targets,12);
  for (const r of rows) {
    assert.equal(r.before,0);
    assert.equal(g.world.wholestore[r.no-1],r.after);
    assert.ok(r.after > 0, r.name);
  }
  assert.equal(rows.find((r) => r.no === 88)!.after,1);
  // 12時間ぶんは24時間ぶんの約半分 (上限に当たらない品)
  const fiber = rows.find((r) => r.no === 96)!.after;
  const { g:g2 } = fixture(16,'tool');
  g2.world.people = 300000;
  assert.ok(Math.abs(seedWholeStore(g2,[96],24)[0].after - fiber*2) <= 1);
  const after = structuredClone(g.world);
  for (const no of targets) after.wholestore[no-1] = 0;
  assert.deepEqual(after.wholestore,before.wholestore);
  assert.deepEqual([after.events,after.people],[before.events,before.people]);
});
