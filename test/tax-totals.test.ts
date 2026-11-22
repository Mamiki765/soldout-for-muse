import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/api/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { itemNoByName, MAX_ITEM } from '../src/data/catalog.js';
import { openShop } from '../src/engine/actions.js';
import { Game } from '../src/engine/game.js';
import { seededRng } from '../src/engine/rng.js';
import { newWorld } from '../src/engine/types.js';
import { Store } from '../src/store.js';

const NOW = 1_800_000_000;
const CYCLE = DEFAULT_CONFIG.oneDayTime;
const KEEP = 2 * DEFAULT_CONFIG.logExpireTime;
const LEATHER = itemNoByName('獣の革');
const zero = { sales: 0n, deposit: 0n, total: 0n };

function seedShop(store: Store, tracking: boolean) {
  const world = newWorld(NOW, MAX_ITEM);
  if (tracking) world.taxTrackingStartedAt = NOW;
  const g = new Game(world, DEFAULT_CONFIG, seededRng(5), NOW);
  const shop = openShop(g, { name: 'seller', shopname: '売り手の店' });
  shop.money = 2_000_000;
  shop.moneystock = 2_000_000;
  shop.taxtoday = 1234;
  store.saveWorld(world, [], NOW, KEEP);
  return { shop, boundary: g.nextPeriodTime() };
}

test('旧版からの初回更新は過去の税を補填せず、再起動後の遅延決算は境界ごとに一度だけ加算する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soldout-tax-'));
  const path = join(dir, 'town.sqlite');
  try {
    const initial = new Store(path);
    let boundary: number;
    let som: string;
    try {
      const seeded = seedShop(initial, false);
      boundary = seeded.boundary;
      const app = new App({ store: initial, rng: seededRng(5), clock: () => boundary });
      som = initial.ownerByShop(seeded.shop.id)!.som;
      assert.equal(initial.taxTrackingStartedAt(), null);
      assert.equal(initial.ownerTaxTotals('som9999'), undefined);
      assert.deepEqual(initial.ownerTaxTotals(som), zero);
      app.viewerGame();
      assert.equal(initial.taxTrackingStartedAt(), boundary);
      assert.deepEqual(initial.ownerTaxTotals(som), zero);
      assert.equal(initial.loadWorld(boundary).shops[0].taxyesterday, 110_000 + 1234, '従来の決算には全額入る');
    } finally {
      initial.close();
    }

    const reopened = new Store(path);
    try {
      let now = boundary + CYCLE - 1;
      const app = new App({ store: reopened, rng: seededRng(5), clock: () => now });
      app.viewerGame();
      assert.deepEqual(reopened.ownerTaxTotals(som), zero);
      now = boundary + CYCLE;
      app.viewerGame();
      assert.deepEqual(reopened.ownerTaxTotals(som), { sales: 0n, deposit: 110_000n, total: 110_000n });
      now = boundary + 3 * CYCLE + 1;
      app.viewerGame();
      assert.equal(reopened.loadWorld(now).lasttime, now);
      const totals = { sales: 0n, deposit: 330_000n, total: 330_000n };
      assert.deepEqual(reopened.ownerTaxTotals(som), totals);
      app.viewerGame();
      new App({ store: reopened, rng: seededRng(5), clock: () => now }).viewerGame();
      assert.deepEqual(reopened.ownerTaxTotals(som), totals);
      assert.equal(reopened.taxTrackingStartedAt(), boundary);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('決算の保存失敗は税額と街を巻き戻し、DBが読めるようになったら再計算する', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const { shop, boundary } = seedShop(store, true);
  const app = new App({ store, rng: seededRng(5), clock: () => boundary });
  const som = store.ownerByShop(shop.id)!.som;
  const add = store.addTaxTotals.bind(store);
  const load = store.loadWorld.bind(store);
  const writeSpy = t.mock.method(store, 'addTaxTotals', (deltas: Parameters<Store['addTaxTotals']>[0]) => {
    add(deltas);
    throw new Error('save failed after tax write');
  });
  const readSpy = t.mock.method(store, 'loadWorld', () => { throw new Error('read failed'); });
  t.mock.method(console, 'error', () => {});
  assert.throws(() => app.viewerGame(), /save failed after tax write/);
  assert.deepEqual(store.ownerTaxTotals(som), zero);
  assert.equal(load(boundary).lasttime, NOW);
  assert.equal(store.priceHistory(LEATHER, 1).length, 0);
  assert.throws(() => app.viewerGame(), /read failed/);

  writeSpy.mock.restore();
  readSpy.mock.restore();
  app.viewerGame();
  assert.equal(load(boundary).lasttime, boundary);
  assert.deepEqual(store.ownerTaxTotals(som), { sales: 0n, deposit: 110_000n, total: 110_000n });
});

test('売上税の3経路を記録し、休業の精算と閉店・Party再出店でも累計を保つ', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  let now = NOW;
  const app = new App({
    store, rng: { next: () => 0.5 }, clock: () => now,
    partyVerifier: async (token) => ({ ownerId: token, name: token }),
  });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`;
  const post = (path: string, token: string, body: object) => fetch(base + path, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, accept: 'application/json' }, body: JSON.stringify(body),
  });
  const register = async (token: string, shopname: string) => {
    const r = await post('register', token, { shopname });
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as { shop_id: number }).shop_id;
  };
  const action = async (token: string, body: object) => {
    const r = await post('actions', token, body);
    assert.equal(r.status, 200, await r.clone().text());
    const result = (await r.json()) as { results: { ok: boolean; msg: string[] }[] };
    return result.results[0];
  };
  const sellerId = await register('seller', '売り手の店');
  const buyerId = await register('buyer', '買い手の店');
  const seller = () => app.world.shops.find((s) => s.id === sellerId)!;
  const som = store.ownerByShop(sellerId)!.som;
  now += 301;
  app.viewerGame();
  seller().profitstock = 1_000_000;
  seller().moneystock = 2_000_000;
  seller().money = 2_000_000;
  seller().item[LEATHER - 1] = 500;
  // 旧版の期中集計を残した状態で、新たな売上分のみが加算される
  seller().taxtoday = 1234;
  const basePrice = app.viewerGame().items[LEATHER].price;
  seller().showcase[0] = LEATHER;
  seller().price[0] = basePrice;

  const buy = { type: 'buy', from: sellerId, item: LEATHER, count: 2, request_id: 'shelf-buy' };
  assert.equal((await action('buyer', buy)).ok, true);
  const shelfTax = BigInt(seller().taxtoday - 1234);
  assert.ok(shelfTax > 0n);
  assert.equal(store.ownerTaxTotals(som)?.sales, shelfTax);
  assert.equal((await action('buyer', buy)).ok, true);
  assert.equal(store.ownerTaxTotals(som)?.sales, shelfTax);

  assert.equal((await action('buyer', { type: 'order', item: LEATHER, count: 3, price: basePrice, hours: 1 })).ok, true);
  const order = app.world.orders![0].id;
  assert.equal((await action('seller', { type: 'deliver', order, count: 3 })).ok, true);
  const afterDelivery = BigInt(seller().taxtoday - 1234);
  assert.ok(afterDelivery > shelfTax);
  assert.equal(store.ownerTaxTotals(som)?.sales, afterDelivery);

  now += 1800;
  const g = app.viewerGame();
  const sales = BigInt(seller().taxtoday - 1234);
  assert.ok(sales > afterDelivery, 'NPCも購入した');
  assert.deepEqual(store.ownerTaxTotals(som), { sales, deposit: 0n, total: sales });
  const deposit = BigInt(g.taxToday(seller())[0]);
  assert.ok(deposit > 0n);
  assert.equal((await action('seller', { type: 'rest', days: 7, confirm: true })).ok, true);
  assert.equal((await action('seller', { type: 'rest', days: 7, confirm: true })).ok, false);
  assert.equal(BigInt(seller().taxyesterday), sales + 1234n + deposit);
  const totals = { sales, deposit, total: sales + deposit };
  assert.deepEqual(store.ownerTaxTotals(som), totals);

  now = g.nextPeriodTime();
  app.viewerGame();
  assert.deepEqual(store.ownerTaxTotals(som), totals, '休業中の通常決算で重ねて課税しない');
  assert.equal((await action('seller', { type: 'close', confirm: 'closeshop' })).ok, true);
  assert.equal(store.ownerBySom(som)?.shop_id, null);
  assert.deepEqual(store.ownerTaxTotals(som), totals);
  const reopened = await register('seller', '売り手の新店');
  assert.notEqual(reopened, sellerId);
  assert.equal(store.ownerByShop(reopened)?.som, som);
  assert.deepEqual(store.ownerTaxTotals(som), totals);
  assert.deepEqual(store.ownerTaxTotals(store.ownerByShop(buyerId)!.som), zero);
});

test('倒産の決算で店主IDを外す前に入金庫税を記録する', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const { shop, boundary } = seedShop(store, true);
  shop.money = 0;
  shop.costtoday = 3_000_000;
  const world = store.loadWorld(NOW);
  world.shops = [shop];
  store.saveWorld(world, [], NOW, KEEP);
  const app = new App({ store, rng: seededRng(5), clock: () => boundary });
  const som = store.ownerByShop(shop.id)!.som;
  app.viewerGame();
  assert.equal(store.loadWorld(boundary).shops.length, 0);
  assert.equal(store.ownerBySom(som)?.shop_id, null);
  assert.deepEqual(store.ownerTaxTotals(som), { sales: 0n, deposit: 110_000n, total: 110_000n });
});

test('累計がJavaScriptの安全な整数範囲を超えても1円単位で加算する', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const { shop } = seedShop(store, true);
  const world = store.loadWorld(NOW);
  const owner = store.createOwner({ shopId: shop.id, name: shop.name, nameSource: 'local', now: NOW });
  const save = (sales: bigint, deposit: bigint) => store.saveWorld(world, [], NOW, KEEP, () => {
    store.addTaxTotals(new Map([[shop.id, { sales, deposit }]]));
  });
  const large = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  save(large, large);
  save(1n, 2n);
  assert.deepEqual(store.ownerTaxTotals(owner.som), { sales: large + 1n, deposit: large + 2n, total: 2n * large + 3n });
});
