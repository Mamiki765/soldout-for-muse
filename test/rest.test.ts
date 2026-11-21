// 改装中 (休業、1.1.0) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { DEFAULT_CONFIG as BASE_CONFIG } from '../src/config.js';
import { CATALOG, itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { buy, enterShop, openShop } from '../src/engine/actions.js';
import { Game, GameError } from '../src/engine/game.js';
import { createOrder, orders } from '../src/engine/orders.js';
import { endRest, restGuard, REST_MAX_DAYS, startRest } from '../src/engine/rest.js';
import { seededRng } from '../src/engine/rng.js';
import { turn } from '../src/engine/turn.js';
import { newWorld, type Shop, type World } from '../src/engine/types.js';
import { closingAt, peekData } from '../src/engine/watch.js';
import { collectPeriodSales } from '../src/engine/prices.js';
import { digestData, digestText } from '../src/api/views.js';
import { newToken, sha256, Store } from '../src/store.js';

const DEFAULT_CONFIG = { ...BASE_CONFIG, couponTime: 0 };
const T0 = 1_800_000_000;
const HERB = itemNoByName('薬草');

function setup() {
  const world = newWorld(T0, MAX_ITEM);
  const g0 = new Game(world, DEFAULT_CONFIG, seededRng(1), T0);
  const a = openShop(g0, { name: 'aki', shopname: 'アキ商店' });
  const b = openShop(g0, { name: 'mute', shopname: 'ミュート堂' });
  const c = openShop(g0, { name: 'ruri', shopname: '瑠璃屋' });
  for (const s of [a, b, c]) {
    s.time = T0 - 48 * 3600;
    s.money = 1_000_000;
    s.item[HERB - 1] = 100;
    s.showcase[0] = HERB;
    s.price[0] = 30;
  }
  return { world, a, b, c };
}

const game = (world: World, now: number) => new Game(world, DEFAULT_CONFIG, seededRng(3), now);
const find = (world: World, id: number): Shop => world.shops.find((s) => s.id === id)!;

test('休むと今期の維持費を先に払い、街の店数・ランキングから外れる', () => {
  const { world, a } = setup();
  const g = game(world, T0 + 3600);
  turn(g);
  const me = g.shopById(a.id)!;
  me.costtoday = 1234.7;
  const showcase = CATALOG.showcaseCost[me.showcasecount - 1] ?? 0;
  const money0 = me.money;
  enterShop(g, me, true);
  const msg = startRest(g, me, 10, '', true);
  assert.match(msg[0], /改装に入りました/);
  assert.equal(me.money, money0 - 1234 - showcase, '倉庫代 (切り捨て) と棚の維持費を払う');
  assert.equal(me.costtoday, 0);
  assert.equal(g.shops.length, 2, '営業中の店から外れる');
  assert.equal(g.allShops.length, 3);
  assert.equal(g.shopIndex(a.id), -1, '順位なし');
  assert.ok(g.shopById(a.id), '店としてはまだある (認証・郵便用)');
  assert.equal(me.point, 0);
  assert.equal(me.rest!.min, g.nextPeriodTime(), '始めた期の決算までは再開できない');
  assert.equal(me.rest!.until, T0 + 3600 + 10 * 86400);
  assert.equal(world.shops[world.shops.length - 1].id, a.id, '営業中の店のうしろに並ぶ');
  assert.equal(g.marketUsers(), DEFAULT_CONFIG.marketUserBase);
  assert.throws(() => startRest(g, me, 10, '', true), /もう改装中/);
});

test('confirm が無ければ見込みだけ返し、何も変えない (1.1.2)', () => {
  const { world, a } = setup();
  const g = game(world, T0);
  const me = g.shopById(a.id)!;
  enterShop(g, me, true);
  createOrder(g, me, { itemno: HERB, price: 20, count: 50, hours: 24 });
  const before = structuredClone(world);
  assert.throws(() => startRest(g, me, 10), /^GameError: 確認: .*募集1件 \(#\d+\) は取り下げて返金.*"confirm":true/s);
  assert.deepEqual(world, before, '払わず、募集も残り、改装中にもならない');
});

test('日数は1〜30、払えない店は休めない', () => {
  const { world, a } = setup();
  const g = game(world, T0);
  const me = g.shopById(a.id)!;
  assert.throws(() => startRest(g, me, 0, '', true), GameError);
  assert.throws(() => startRest(g, me, REST_MAX_DAYS + 1, '', true), /1〜30/);
  me.money = 0;
  me.moneystock = 0;
  me.costtoday = 5000;
  assert.throws(() => startRest(g, me, 5, '', true), /払えないので/);
  assert.equal(me.rest, undefined);
});

test('休む前に今期売った数は、決算の値動きの記録に残る', () => {
  const { world, a, b } = setup();
  const g = game(world, T0);
  g.shopById(a.id)!.itemtoday[HERB] = 100;
  g.shopById(b.id)!.itemtoday[HERB] = 20;
  startRest(g, g.shopById(a.id)!, 5, '', true);
  collectPeriodSales(g, g.now);
  assert.equal(g.pendingPrices!.sold.get(HERB), 120);
  assert.equal(world.restsold, undefined, '数えたら空にする');
});

test('全店が休んでいても、決算で値動きの記録は書く', () => {
  const { world, a, b, c } = setup();
  let g = game(world, T0);
  g.shopById(a.id)!.itemtoday[HERB] = 100;
  for (const s of [a, b, c]) startRest(g, g.shopById(s.id)!, 30, '', true);
  assert.equal(g.shops.length, 0);
  g = game(world, T0 + 2 * DEFAULT_CONFIG.oneDayTime);
  turn(g);
  const row = g.newPriceRows.find((r) => r.item === HERB);
  assert.ok(row, '薬草の行がある');
  assert.equal(row!.sold, 100);
  assert.equal(world.restsold, undefined);
});

test('ギルド無所属ペナルティがある街では、それも払えないと休めない (店を倒産させない)', () => {
  const { world, a } = setup();
  const g = new Game(world, { ...DEFAULT_CONFIG, guildUnattachPenalty: 100 }, seededRng(3), T0);
  const me = g.shopById(a.id)!;
  me.money = 1000;
  me.moneystock = 0;
  me.saletoday = 100_000;
  me.showcasecount = 1;
  me.costtoday = 0;
  assert.throws(() => startRest(g, me, 5, '', true), /払えないので/);
  assert.equal(me.status, 1);
  assert.equal(me.rest, undefined);
});

test('休んでいる間は売れず、決算もせず、人気・熟練は凍り、不在閉店もしない', () => {
  const { world, a, b } = setup();
  let g = game(world, T0);
  find(world, a.id).exp[HERB] = 500;
  find(world, a.id).rank = 5000;
  startRest(g, g.shopById(a.id)!, 30, '', true);
  const frozen = structuredClone(find(world, a.id));
  // 20日たつ (不在閉店の7日を超える)。b は毎日行動する
  for (let d = 1; d <= 20; d++) {
    g = game(world, T0 + d * 86400);
    turn(g);
    find(world, b.id).lastlogin = g.now;
  }
  const me = find(world, a.id);
  assert.ok(me && me.status, '不在閉店しない');
  assert.ok(me.rest, 'まだ改装中');
  assert.equal(me.item[HERB - 1], frozen.item[HERB - 1], '売れない');
  assert.equal(me.money, frozen.money, '維持費も税もかからない');
  assert.equal(me.rank, frozen.rank, '人気は下がらない');
  assert.equal(me.exp[HERB], frozen.exp[HERB], '熟練も下がらない');
  assert.equal(me.rankingcount, 0, '優勝しない');
});

test('期限が来たら自動で再開し、そこから不在閉店の時計が動く。休んだ日数は延長に数えない', () => {
  const { world, a } = setup();
  let g = game(world, T0);
  startRest(g, g.shopById(a.id)!, 3, '', true);
  const until = find(world, a.id).rest!.until;
  g = game(world, until + 600);
  turn(g);
  const me = find(world, a.id);
  assert.equal(me.rest, undefined, '自動で再開');
  assert.equal(me.lastlogin, until, '時計は再開の時刻から');
  assert.equal(me.resttotal, until - T0);
  assert.equal(me.rankingyesterday, 0, '再開した期は前期順位なし');
  assert.equal(g.expireTimeExtend(me), 0, '休んだ3日は営業日数に入らない');
  assert.equal(closingAt(g, me), until + DEFAULT_CONFIG.expireTime);
  assert.ok(g.shopIndex(a.id) >= 0);
});

test('その期の決算までは再開できず、過ぎたら reopen かほかの行動で再開できる', () => {
  const { world, a } = setup();
  let g = game(world, T0);
  const me0 = g.shopById(a.id)!;
  startRest(g, me0, 30, '', true);
  const min = me0.rest!.min;
  g = game(world, min - 60);
  let me = g.shopById(a.id)!;
  assert.throws(() => endRest(g, me), /決算/);
  assert.throws(() => restGuard(g, me, 'shelf'), /改装中です/);
  assert.deepEqual(restGuard(g, me, 'alerts'), [], '設定の変更は休んだままできる');
  assert.ok(me.rest);
  g = game(world, min + 60);
  turn(g);
  me = g.shopById(a.id)!;
  const woke = restGuard(g, me, 'shelf');
  assert.match(woke[0], /営業を再開/);
  assert.equal(me.rest, undefined);
  // 再開してすぐまた休める (間隔の縛りはない。休むたびに今期分を払う)
  startRest(g, me, 2, '', true);
  assert.ok(me.rest);
});

test('休むと出していた買い取り募集は取り下げて返金。休んでいる店の棚からは買えない', () => {
  const { world, a, b } = setup();
  let g = game(world, T0);
  const me = g.shopById(a.id)!;
  enterShop(g, me, true);
  createOrder(g, me, { itemno: HERB, price: 20, count: 50, hours: 24 });
  assert.equal(orders(g).length, 1);
  const msgs = startRest(g, me, 5, '', true);
  assert.equal(orders(g).length, 0);
  assert.ok(msgs.some((m) => /取り下げ/.test(m)));
  g = game(world, T0 + 60);
  const other = g.shopById(b.id)!;
  enterShop(g, other, true);
  assert.throws(() => buy(g, other, { from: a.id, itemno: HERB, count: 1 }), /改装中/);
});

test('digest・peek: 改装中の案内だけ出し、店の様子の知らせは鳴らさない', () => {
  const { world, a } = setup();
  const g = game(world, T0);
  const me = g.shopById(a.id)!;
  me.showcase[0] = 0; // 棚を空にしても
  startRest(g, me, 5, '', true);
  const d = digestData(g, me, { newMine: 0, newTown: 0, newChat: 0, newBbs: 0 });
  assert.ok(d.rest);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /改装中/);
  assert.match(digestText(d), /改装中\//);
  const p = peekData(g, me);
  assert.equal(p.alerts.length, 0);
  assert.equal(p.next_timed, me.rest!.until);
  assert.ok(p.facts.rest);
});

test('API: rest / reopen の行動と、管理人の代理', async () => {
  let now = T0;
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const admin = newToken('sa_');
  store.setSetting('admin_token_hash', sha256(admin));
  const app = new App({ store, rng: seededRng(5), clock: () => now });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, token: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const get = (path: string, token: string) => fetch(base + path, { headers: { authorization: 'Bearer ' + token } });
  try {
    const reg = (await (await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) })).json()) as { token: string; shop_id: number };
    const reg2 = (await (await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'aki', shopname: 'アキ商店' }) })).json()) as { token: string; shop_id: number };
    // confirm が無ければ見込みだけ (何も変わらない)
    let r = await post('/api/v1/actions?format=json', reg.token, { type: 'rest', days: 7 });
    const j = (await r.json()) as { results: { ok: boolean; msg: string[]; confirm_with?: Record<string, unknown> }[] };
    assert.equal(j.results[0].ok, false);
    assert.match(j.results[0].msg[0], /確認: 改装中 \(休業\) に入ると、今期の維持費など ￥\d+ をすぐ払い/);
    assert.deepEqual(j.results[0].confirm_with, { type: 'rest', days: 7, confirm: true });
    assert.doesNotMatch(await (await get('/api/v1/digest', reg.token)).text(), /改装中/);
    r = await post('/api/v1/actions', reg.token, { type: 'rest', days: 7, confirm: true });
    assert.match(await r.text(), /OK rest: 改装に入りました/);
    assert.match(await (await get('/api/v1/digest', reg.token)).text(), /ミュート商店 改装中\/1/);
    assert.match(await (await get('/api/v1/town', reg2.token)).text(), /改装中: ミュート商店/);
    assert.match(await (await get('/api/v1/log?all=1', reg2.token)).text(), /ミュート商店は改装のため、しばらくお休みします/);
    r = await post('/api/v1/actions', reg.token, { type: 'reopen' });
    assert.match(await r.text(), /NG reopen: 改装はこの期の決算/);
    r = await post('/api/v1/actions', reg.token, { type: 'vacation' });
    assert.match(await r.text(), /rest です/);

    // 管理人の代理: 休ませる・再開させる (決算前でも再開できる)
    r = await post('/api/v1/admin/rest', admin, { shop: reg2.shop_id, days: 14 });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /管理人の手続きで改装に入りました/);
    r = await post('/api/v1/admin/rest', admin, { shop: reg2.shop_id, days: 14 });
    assert.equal(r.status, 400, 'もう改装中');
    now += 600;
    r = await post('/api/v1/admin/rest', admin, { shop: reg2.shop_id, end: true });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /営業を再開/);

    // 決算が過ぎたら、ふつうの行動で再開する
    now += 2 * 86400;
    r = await post('/api/v1/actions', reg.token, { type: 'comment', text: 'ただいま' });
    assert.match(await r.text(), /OK comment/);
    assert.match(await (await get('/api/v1/digest', reg.token)).text(), /改装中/, 'コメントでは再開しない');
    r = await post('/api/v1/actions', reg.token, { type: 'shelf', slot: 1, item: 0 });
    const t = await r.text();
    assert.match(t, /営業を再開/);
    assert.doesNotMatch(await (await get('/api/v1/digest', reg.token)).text(), /改装中/);
  } finally {
    server.close();
  }
});
