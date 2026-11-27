// v0.2.0 (ファッション) で足した品・作り方・行き先の決まり。
// 値段・時間・確率・個数などの数字は品のデータ (src/data/items.json) から読み、ここには書かない (AGENTS.md「テストの決まり」)。
// データが原作＋各版の差分 (tools/*.json) から作られていることは「原作定義からの再生成がコミット対象JSONと完全一致する」で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BASE_ITEMS, MAX_ITEM, type ItemDef, type UseDef } from '../src/data/catalog.js';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
// 時間の増減を dt.time で見るので、週1の時間クーポンは切っておく
const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
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

/** v0.2.0 で足した23品の番号と正式名。81〜87 が完成品 (装飾品)、ほかは素材 */
const V020_NAMES: [number, string][] = [
  [80,'草織り布'],[81,'ヒョウ柄ミニスカート'],[82,'厚底ブーツ'],[83,'ルーズソックス'],[84,'ラメのチョーカー'],
  [85,'革のロングコート'],[86,'宝石のブローチ'],[87,'寄木の髪飾り'],[88,'鉄鉱石'],[89,'ミスリル原石'],[90,'オリハルコン原石'],
  [91,'樹脂'],[92,'砂鉄'],[93,'宝石原石'],[94,'香木'],[95,'樹皮'],[96,'繊維草'],[97,'精鋼板'],[98,'ミスリル線'],
  [99,'製材板'],[100,'樹脂板'],[101,'なめし革'],[102,'研磨宝石'],
];

/** v0.2.0 の作り方: 本・できる品・材料 (品番だけ。個数はデータから読む) */
const production: [number, number, number[]][] = [
  [16,80,[96,1,3]], [17,99,[4]], [16,101,[2,95,91]], [20,97,[5,88,92]], [20,98,[89,6]], [17,100,[99,91]], [66,102,[93,80]],
  [16,81,[101,80,2,97]], [16,82,[101,99,100,97,80]], [16,83,[80,101,2]], [66,84,[98,80,101,32]], [16,85,[101,80,2,68]],
  [66,86,[102,98,6,67,8]], [17,87,[100,99,94,91,68]],
];

/** v0.2.0 の行き先 (地図・行き先の名前・取れる品) */
const gathering: [number, string, number[]][] = [
  [9,'砂鉄の河床を探る',[88,92]],
  [9,'青晶洞を探索する',[89,93]],
  [9,'深層の鉱脈を掘る',[90,93,8]],
  [12,'樹脂林で樹液を採る',[91,95]],
  [12,'香木林を探索する',[94,96]],
];

// 置き先の本の既存USEと同じ、非消費の工具 (count 1・proba 0) の所持条件
const BOOK_TOOLS: Record<number, number[]> = { 66: [18, 19], 20: [18] };
const toolsOf = (book: number) => BOOK_TOOLS[book] ?? [];
const recipeOf = (book: number, product: number) => BASE_ITEMS[book].uses.find((u) => u.get[0]?.item_no === product)!;
const consumed = (u: UseDef) => u.use.filter((l) => l.proba > 0);

test('全品で番号・コード・名前が重ならず、v0.2.0 の23種は正式名・種類どおり。全USEの参照・個数・確率が正しい範囲', () => {
  assert.equal(current.items.length, MAX_ITEM);
  assert.equal(new Set(current.items.map((it) => it.code)).size, MAX_ITEM);
  assert.equal(new Set(current.items.map((it) => it.name)).size, MAX_ITEM);
  for (const [no, name] of V020_NAMES) {
    const i = BASE_ITEMS[no];
    assert.deepEqual([i.no, i.name, i.type], [no, name, no >= 81 && no <= 87 ? 8 : 1]);
    assert.ok(i.price > 0 && i.limit > 0 && i.cost >= 0, name);
    if (i.type === 8) assert.equal(i.plus, 0, `${name}: 完成品は市場に湧かない`);
  }
  for (const i of current.items) {
    assert.equal(BASE_ITEMS[i.no].no, i.no);
    assert.equal(new Set(i.uses.map((u) => u.no)).size, i.uses.length);
    for (const u of i.uses) {
      assert.ok(u.exptime === undefined || u.exptime === null || u.exptime <= u.time, `${i.name}/${u.name}: 熟練で長くならない`);
      for (const l of [...u.use, ...u.get]) {
        assert.ok(BASE_ITEMS[l.item_no], `${i.no}/${u.no}: item ${l.item_no}`);
        assert.ok(l.count > 0 && Number.isInteger(l.count));
        assert.ok(l.proba >= 0 && l.proba <= 1000);
      }
    }
  }
});

test('原作の品の名前・番号は変えず、v0.2.0 以降の使い方は原作の使い方の後ろに足す', () => {
  for (const old of original.items) {
    const now = BASE_ITEMS[old.no];
    assert.equal(now.name, old.name, `No.${old.no}`);
    assert.ok(now.uses.length >= old.uses.length, `No.${old.no}: 使い方は減らさない`);
    old.uses.forEach((u, i) => assert.equal(now.uses[i].name, u.name, `No.${old.no}/${i}`));
  }
  assert.deepEqual(BASE_ITEMS[77].uses.map((u) => u.name), originalByNo(77).uses.map((u) => u.name), 'お祝いセットの使い方は変えない');
});

test('v0.2.0 の作り方14件: 材料の品はそのまま、本の工具は減らない所持条件、職ボーナスで時間が半分', () => {
  for (const [book, product, materials] of production) {
    const u = recipeOf(book, product);
    assert.ok(u, BASE_ITEMS[product].name);
    assert.deepEqual(u.use.filter((l) => l.proba === 0).map((l) => [l.item_no, l.count]), toolsOf(book).map((n) => [n, 1]));
    assert.deepEqual(consumed(u).map((l) => l.item_no), materials);
    assert.deepEqual(u.get.map((l) => l.item_no), [product]);
    assert.equal(u.func, 'lostbook');
    assert.ok(!u.needexp);
    assert.deepEqual(u.jobs, [{ job: book === 20 ? 'weapon' : 'tool', key: 'times', op: '/', value: 2 }]);
  }
});

test('工具を1つでも欠くと新規5件は実行できず、状態も変わらない', () => {
  for (const [book, product] of production.filter(([book]) => toolsOf(book).length)) {
    for (const missing of toolsOf(book)) {
      const { g,dt } = fixture(book,book === 20 ? 'weapon':'tool');
      const u = recipeOf(book, product);
      for (const l of consumed(u)) dt.item[l.item_no-1] = l.count;
      for (const n of toolsOf(book)) if (n !== missing) dt.item[n-1] = 1;
      assert.equal(checkUses(g,dt,loadUses(g,book)).find((x) => x.no === u.no)!.useok, false);
      const before = structuredClone(dt);
      assert.throws(() => useItemAction(g,dt,book,u.no,{count:1}), GameError);
      assert.deepEqual(dt,before);
    }
  }
});

test('v0.2.0 の行き先5件: 熟練の条件があり、取れる品が並び、熟練で時間が縮む。原作の行き先は熟練の条件なしのまま', () => {
  for (const [book, name, products] of gathering) {
    const u = BASE_ITEMS[book].uses.find((u) => u.name === name)!;
    assert.ok(u.needexp && u.needexp > 0, name);
    assert.ok(u.exptime < u.time, name);
    for (const no of products) assert.ok(u.get.some((l) => l.item_no === no), `${name}: ${BASE_ITEMS[no].name}`);
  }
  for (const book of [9,12]) assert.ok(BASE_ITEMS[book].uses.slice(0,originalByNo(book).uses.length).every((u) => u.needexp === null));
});

const T0 = 1_800_000_000;
function fixture(book: number, job: string, r = 0.2) {
  const world = newWorld(T0, MAX_ITEM);
  const g = new Game(world, DEFAULT_CONFIG, { next: () => r }, T0);
  const dt = openShop(g, { name:'test', shopname:'試験商店' });
  dt.item[book-1] = 1;
  dt.job = job;
  dt.time = T0-48*3600;
  enterShop(g, dt, true);
  return { g,dt };
}

test('行き先の熟練の条件: 1足りないと断って何も変えず、ちょうどなら行けて熟練が付き、取れる品が手に入る', () => {
  for (const [book, name] of gathering) {
    const def = BASE_ITEMS[book].uses.find((u) => u.name === name)!;
    const threshold = def.needexp!;
    const { g,dt } = fixture(book, 'material', 0);
    dt.exp[book] = threshold-1;
    assert.equal(checkUses(g,dt,loadUses(g,book)).find((u) => u.no === def.no)!.useok, false);
    const before = structuredClone(dt);
    assert.throws(() => useItemAction(g,dt,book,def.no,{count:1}), GameError);
    assert.deepEqual(dt,before);
    dt.exp[book] = threshold;
    const u = useItemAction(g,dt,book,def.no,{count:1});
    assert.equal(u.result.count,1);
    assert.equal(dt.exp[book], threshold + def.exp);
    for (const l of def.get) assert.ok(dt.item[l.item_no-1] >= l.count, `${name}: 乱数が当たれば ${BASE_ITEMS[l.item_no].name} が定義の数以上`);
  }
});

test('行き先の時間: 熟練が高いほど短く (長くならず)、職ボーナスで半分', () => {
  for (const [book, name] of gathering) {
    const def = BASE_ITEMS[book].uses.find((u) => u.name === name)!;
    const spent = (job: string, exp: number) => {
      const { g,dt } = fixture(book, job, 0.999);
      dt.exp[book] = exp;
      const before = dt.time;
      useItemAction(g,dt,book,def.no,{count:1});
      return dt.time - before;
    };
    const lo = def.needexp!;
    assert.ok(spent('', 1000) < spent('', lo), name);
    assert.ok(spent('', 600) <= spent('', lo) && spent('', 600) >= spent('', 1000), name);
    assert.equal(spent('material', lo) * 2, spent('', lo), name);
  }
});

test('新規生産は1セットごとの材料を消費し、工具は減らず、一致職業の時間が半分になる', () => {
  for (const [book, product] of production) {
    const u = recipeOf(book, product);
    const job = book === 20 ? 'weapon' : 'tool';
    const run = (jobName: string) => {
      const { g,dt } = fixture(book, jobName, 0);
      for (const l of consumed(u)) dt.item[l.item_no-1] = l.count*2;
      for (const n of toolsOf(book)) dt.item[n-1] = 1;
      const before = dt.time;
      const r = useItemAction(g,dt,book,u.no,{count:2});
      assert.equal(r.result.count,2);
      for (const l of consumed(u)) assert.equal(dt.item[l.item_no-1],0);
      for (const n of toolsOf(book)) assert.equal(dt.item[n-1],1, '工具は消費しない');
      // 乱数 0 なので成功と端数の抽選はみな当たる
      const made = u.get[0];
      assert.equal(dt.item[product-1], (made.count + (made.fraction ? 1 : 0)) * 2, BASE_ITEMS[product].name);
      return dt.time - before;
    };
    assert.equal(run(job) * 2, run(''), BASE_ITEMS[product].name);
  }
});

test('原作定義からの再生成がコミット対象JSONと完全一致する', () => {
  assert.equal(execFileSync('perl',['tools/dump-items.pl','normal'],{encoding:'utf8'}),readFileSync('src/data/items.json','utf8'));
});

test('79品時代のセーブは在庫を保ったまま143枠へ拡張し、新素材は初期投入しない', () => {
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
    assert.deepEqual(loaded.wholestore,[...Array(79).fill(3),...Array(64).fill(0)]);
    assert.deepEqual(loaded.shops[0].item,[...Array(79).fill(2),...Array(64).fill(0)]);
    assert.equal(loaded.shops[0].exp[9],400);
  } finally { store.close(); }
});

test('新素材の市場初期投入: plus が正の品だけに一度、上限内で足し、減る側と他には触れない', () => {
  const { g,dt } = fixture(16,'tool');
  g.world.people = 300000;
  const before = structuredClone(g.world);
  const withPlus = V020_NAMES.map(([no]) => no).filter((no) => BASE_ITEMS[no].plus !== 0);
  const targets = withPlus.filter((no) => BASE_ITEMS[no].plus > 0);
  assert.deepEqual(targets,[96],'v0.2.0 で市場に湧くのは繊維草だけ');
  assert.ok(withPlus.every((no) => no < 81 || no > 87), '完成品は plus 0 なので対象外');
  // 減る側 (plus 負) を渡しても足さない
  const neg = seedWholeStore(g,withPlus.filter((no) => BASE_ITEMS[no].plus < 0),12);
  assert.equal(neg.length,15);
  for (const r of neg) assert.deepEqual([r.before,r.add,r.after],[0,0,0],r.name);
  dt.item[96-1] = 0;
  const rows = seedWholeStore(g,targets,12);
  const fiber = rows[0].after;
  assert.ok(fiber > 0);
  // 12時間ぶんは24時間ぶんの約半分 (上限に当たらない品)
  const { g:g2 } = fixture(16,'tool');
  g2.world.people = 300000;
  assert.ok(Math.abs(seedWholeStore(g2,[96],24)[0].after - fiber*2) <= 1);
  // 店の手持ちも上限に数える
  const { g:g3,dt:dt3 } = fixture(16,'tool');
  g3.world.people = 300000;
  const cap = Math.trunc(g3.items[96].wslimit * g3.shops.length + 0.99);
  dt3.item[96-1] = cap - 1;
  assert.equal(seedWholeStore(g3,[96],12)[0].after,1);
  const after = structuredClone(g.world);
  after.wholestore[96-1] = 0;
  assert.deepEqual(after.wholestore,before.wholestore);
  assert.deepEqual([after.events,after.people],[before.events,before.people]);
});
