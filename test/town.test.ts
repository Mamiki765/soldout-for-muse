// 街の地図と住所 (1.2.0) のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { setViewerKey } from '../src/api/viewer.js';
import { mapData } from '../src/api/town-view.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';
import { FREE_DAYS, HOLD_DAYS, MOVE_ITEM, PAINT_ITEM, TownService } from '../src/town/town.js';

const T0 = 1_800_000_000;
const PERIOD = 97200;
const soms = (n: number) => Array.from({ length: n }, (_, i) => 'som' + String(i + 1).padStart(4, '0'));

test('街を作る: 今いる店をみな別々の区画に置き、全員に1週間の無料券', () => {
  const store = new Store(':memory:');
  try {
    const svc = new TownService(store, PERIOD);
    assert.equal(svc.init(soms(121), T0), 121);
    const homes = svc.homes();
    assert.equal(homes.length, 121);
    assert.equal(new Set(homes.map((h) => h.lot)).size, 121, '区画は重ならない');
    assert.ok(svc.districts > 2, '店の数に合わせて地区が開く');
    assert.ok(homes.every((h) => h.state === 'occupied' && h.free_move_until === T0 + FREE_DAYS * 86400 && h.free_paint_until === h.free_move_until));
    const town = svc.build();
    for (const h of homes) {
      const lot = town.lots.get(h.lot)!;
      assert.equal(lot.kind, 'shop');
      assert.equal(lot.holder, h.som);
      assert.match(svc.gen.addressForms(town, lot).short, /^\d+区[12]-\d+$/);
    }
    assert.equal(svc.init(soms(3), T0), 0, '2回目は何もしない');
  } finally {
    store.close();
  }
});


test('地図 API の隣接区: 四方向・中央・端の null を返す', () => {
  const store = new Store(':memory:');
  try {
    const svc = new TownService(store, PERIOD);
    svc.init(soms(121), T0);
    const town = svc.build();
    const center = mapData(svc, town, 'som0001', '0')!;
    assert.equal(center.districts.length, 2, '中央は東西2チャンク');
    assert.equal(center.districts[0].neighbors.e?.no, 0);
    assert.equal(center.districts[1].neighbors.w?.no, 0);

    const byCell = new Map(town.districts.map((d) => [d.gx + ',' + d.gy, d]));
    let foundEdge = false, foundCenter = false, foundDistrict = false;
    const directions = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const;
    for (const d of town.districts) {
      const result = mapData(svc, town, 'som0001', String(d.no))!;
      const got = result.districts.find((x) => x.chunk === d.id)!;
      assert.ok(got, d.id);
      for (const [side, [dx, dy]] of Object.entries(directions) as [keyof typeof directions, readonly [number, number]][]) {
        const target = byCell.get((d.gx + dx) + ',' + (d.gy + dy));
        const n = got.neighbors[side];
        assert.deepEqual(n, target ? { no: target.no, name: target.name || null } : null, d.id + ':' + side);
        if (!target) foundEdge = true;
        else if (target.center) foundCenter = true;
        else foundDistrict = true;
      }
    }
    assert.ok(foundEdge && foundCenter && foundDistrict);
  } finally {
    store.close();
  }
});

test('ブロックしあう店は、隣・向かいにならない', () => {
  const store = new Store(':memory:');
  try {
    store.db.exec('CREATE TABLE IF NOT EXISTS mail_blocks (som TEXT NOT NULL, blocked TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (som, blocked))');
    const list = soms(40);
    const pairs: [string, string][] = [];
    for (let i = 0; i < 38; i += 2) pairs.push([list[i], list[i + 1]]);
    for (const [a, b] of pairs) store.db.prepare('INSERT INTO mail_blocks VALUES (?, ?, 0)').run(a, b);
    const svc = new TownService(store, PERIOD);
    svc.init(list, T0);
    const town = svc.build();
    for (const [a, b] of pairs) {
      const la = town.lots.get(svc.home(a)!.lot)!;
      const near = [la.links?.left, la.links?.right, la.links?.front].filter(Boolean);
      assert.ok(!near.includes(svc.home(b)!.lot), `${a} と ${b} が隣り合っている`);
    }
    // ブロックの相手の隣へは「予約」として引っ越せない
    const [a, b] = pairs[0];
    const lb = town.lots.get(svc.home(b)!.lot)!;
    const next = [lb.links?.left, lb.links?.right, lb.links?.front].map((id) => id && town.lots.get(id)).find((l) => l && l.kind === 'shop' && l.state === 'vacant');
    if (next) assert.throws(() => svc.checkMove(a, String(next.id), T0), /予約されています/);
  } finally {
    store.close();
  }
});

test('閉店すると空き家で残り、猶予中に開き直せば同じ区画。猶予が切れたら空く', () => {
  const store = new Store(':memory:');
  try {
    const svc = new TownService(store, PERIOD);
    svc.init(soms(5), T0);
    const lot = svc.home('som0001')!.lot;
    svc.onClosed('som0001', T0 + 10);
    assert.equal(svc.home('som0001')!.state, 'held');
    assert.equal(svc.build(undefined, T0 + 20).lots.get(lot)!.state, 'held');
    assert.equal(svc.onOpen('som0001', T0 + 100)!.id, lot, '同じ区画に戻る');
    assert.equal(svc.home('som0001')!.state, 'occupied');
    // 猶予切れ: 区画は空きに戻り、次に開くと新しい区画
    svc.onClosed('som0001', T0 + 200);
    const after = T0 + 200 + HOLD_DAYS * 86400 + 1;
    assert.equal(svc.build(undefined, after).lots.get(lot)!.state, 'vacant');
    svc.expire(after);
    assert.equal(svc.home('som0001'), undefined);
    const again = svc.onOpen('som0001', after)!;
    assert.ok(again);
    assert.equal(svc.home('som0001')!.free_move_until, after + FREE_DAYS * 86400, '新しく住むと無料券が付く');
    // 新しい店
    const lot6 = svc.onOpen('som0006', after)!;
    assert.ok(lot6 && lot6.id !== again.id);
  } finally {
    store.close();
  }
});

test('色変え: 番号の範囲、今と同じ色、片方だけは今の色のまま', () => {
  const store = new Store(':memory:');
  try {
    const svc = new TownService(store, PERIOD);
    svc.init(['som0001'], T0);
    const cur = svc.gen.homeColors('som0001', null, null);
    assert.throws(() => svc.checkPaint('som0001', null, null, T0), /roof/);
    assert.throws(() => svc.checkPaint('som0001', 9, null, T0), /1〜8/);
    assert.throws(() => svc.checkPaint('som0001', cur.roof, cur.door, T0), /同じ色/);
    const roof = (cur.roof % 8) + 1;
    const p = svc.checkPaint('som0001', roof, null, T0);
    assert.deepEqual(p, { free: true, roof, door: cur.door });
    svc.writePaint('som0001', p.roof, p.door, p.free, T0);
    const h = svc.home('som0001')!;
    assert.equal(h.free_paint_until, 0, '無料の1回を使った');
    assert.equal(h.paint_ready_at, 0, '無料の回は待ちなし');
    assert.equal(svc.checkPaint('som0001', null, (cur.door % 8) + 1, T0).free, false);
  } finally {
    store.close();
  }
});

async function start(clock: () => number): Promise<{ base: string; server: Server; app: App; store: Store }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  setViewerKey({ store }, 'key');
  const app = new App({ store, rng: seededRng(3), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, app, store };
}

test('API: 住所・digest の案内・無料の色変えと引っ越し、そのあとはペンキと許可証・時間・待ち', async () => {
  let now = T0;
  const { base, server, app } = await start(() => now);
  try {
    const reg = async (name: string) => {
      const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name, shopname: name + '商店' }) });
      assert.equal(r.status, 201);
      return (await r.json()) as { token: string; shop_id: number };
    };
    const me = await reg('aki');
    for (let i = 0; i < 6; i++) await reg('m' + i);
    const auth = { authorization: 'Bearer ' + me.token };
    const act = async (a: Record<string, unknown>) => {
      const r = await fetch(base + '/api/v1/actions?format=json', { method: 'POST', headers: auth, body: JSON.stringify(a) });
      return ((await r.json()) as { results: { ok: boolean; msg: string[] }[] }).results[0];
    };
    const home = async () => (await (await fetch(base + '/api/v1/town/home?format=json', { headers: auth })).json()) as { address: string; colors: { roof: { no: number }; door: { no: number } }; free_move_until: number | null; free_paint_until: number | null; move_ready_at: number | null; paint_ready_at: number | null };

    let h = await home();
    assert.match(h.address, /^1区[12]-\d+$/);
    assert.ok(h.free_move_until && h.free_paint_until);
    // digest: 無料券がある間だけ「街 」の1行
    let digest = await (await fetch(base + '/api/v1/digest', { headers: auth })).text();
    assert.equal(digest.split('\n').filter((l) => l.startsWith('街 ')).length, 1, digest);
    assert.ok(digest.includes(h.address));
    assert.ok(digest.includes('https://so.example/view/town/colors'));

    // 無料の色変え
    const roof = (h.colors.roof.no % 8) + 1;
    let r = await act({ type: 'paint', roof });
    assert.equal(r.ok, true, r.msg.join());
    assert.match(r.msg[0], /無料/);
    h = await home();
    assert.equal(h.colors.roof.no, roof);
    assert.equal(h.free_paint_until, null);
    // 2回目はペンキが要る
    r = await act({ type: 'paint', door: (h.colors.door.no % 8) + 1 });
    assert.equal(r.ok, false);
    assert.match(r.msg[0], /店用ペンキ/);
    const shop = () => app.world.shops.find((s) => s.id === me.shop_id)!;
    shop().item[PAINT_ITEM - 1] = 1;
    const t0 = shop().time;
    r = await act({ type: 'paint', door: (h.colors.door.no % 8) + 1 });
    assert.equal(r.ok, true, r.msg.join());
    assert.equal(shop().item[PAINT_ITEM - 1], 0, 'ペンキを1缶使った');
    assert.equal(shop().time - t0, 3600, '1時間');
    h = await home();
    assert.ok(h.paint_ready_at && h.paint_ready_at > now, '次は1期あと');
    shop().item[PAINT_ITEM - 1] = 1;
    r = await act({ type: 'paint', roof: (roof % 8) + 1 });
    assert.equal(r.ok, false);
    assert.match(r.msg[0], /次に色を変えられるのは/);

    // 無料の引っ越し (空き区画へ)
    const vac = await (await fetch(base + '/api/v1/town/around?vacant=1&format=json', { headers: auth })).json() as { districts: { vacant: string[] }[] };
    const to = vac.districts.flatMap((d) => d.vacant);
    assert.ok(to.length >= 2);
    r = await act({ type: 'move', to: to[0] });
    assert.equal(r.ok, true, r.msg.join());
    h = await home();
    assert.equal(h.address, to[0]);
    r = await act({ type: 'move', to: to[1] });
    assert.equal(r.ok, false);
    assert.match(r.msg[0], /転居許可証/);
    shop().item[MOVE_ITEM - 1] = 1;
    r = await act({ type: 'move', to: to[1] });
    assert.equal(r.ok, true, r.msg.join());
    assert.equal(shop().item[MOVE_ITEM - 1], 0);
    // 人のいる区画・無い住所へは行けない
    r = await act({ type: 'move', to: '99区1-1' });
    assert.equal(r.ok, false);

    // 改装中は塗れない (決算前)。決算のあとなら塗ると再開する (ほかの行動と同じ)
    shop().rest = { since: now, min: now + 3600, until: now + 30 * 86400 };
    shop().item[PAINT_ITEM - 1] = 1;
    r = await act({ type: 'paint', roof: 1, door: 1 });
    assert.equal(r.ok, false);
    assert.match(r.msg[0], /改装中/);
    delete shop().rest;

    // 無料券を使い切ったら digest の案内は消える
    digest = await (await fetch(base + '/api/v1/digest', { headers: auth })).text();
    assert.ok(!digest.split('\n').some((l) => l.startsWith('街 ')), digest);

    // 期限が過ぎても消える (別の店)
    const other = await reg('late');
    now += FREE_DAYS * 86400 + 1;
    digest = await (await fetch(base + '/api/v1/digest', { headers: { authorization: 'Bearer ' + other.token } })).text();
    assert.ok(!digest.split('\n').some((l) => l.startsWith('街 ')), digest);
  } finally {
    server.close();
  }
});

test('観戦画面: 色見本と絵は合言葉なし、地図のページは合言葉で。空き家に元の店主は出さない', async () => {
  const now = T0;
  const { base, server } = await start(() => now);
  try {
    let r = await fetch(base + '/api/v1/town/colors?format=json');
    assert.equal(r.status, 200);
    const c = (await r.json()) as { roof: { no: number; name: string }[]; door: unknown[] };
    assert.equal(c.roof.length, 8);
    assert.equal(c.door.length, 8);
    assert.equal((await fetch(base + '/view/town/colors')).status, 200);
    for (const p of ['/view/town/static/town-gen.js', '/view/town/static/tiles.js', '/view/town/static/view.js', '/view/town/static/town.css', '/view/kit/town/tileset-v1.js', '/view/kit/town/tiles-v1.png']) {
      r = await fetch(base + p);
      assert.equal(r.status, 200, p);
    }
    assert.equal((await fetch(base + '/view/town/static/../../../package.json')).status === 200, false);
    assert.equal((await fetch(base + '/view/town')).status, 401);

    const regs = [];
    for (const name of ['aki', 'mute']) {
      const res = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name, shopname: name + '商店' }) });
      regs.push((await res.json()) as { token: string });
    }
    // mute が閉店 → 空き家
    r = await fetch(base + '/api/v1/actions', { method: 'POST', headers: { authorization: 'Bearer ' + regs[1].token }, body: JSON.stringify({ type: 'close', confirm: 'closeshop' }) });
    assert.equal(r.status, 200);
    const cookie = (await fetch(base + '/?k=key')).headers.get('set-cookie')!.split(';')[0];
    const html = await (await fetch(base + '/view/town', { headers: { cookie } })).text();
    const data = JSON.parse(/<script type="application\/json" id="town-data">(.*?)<\/script>/s.exec(html)![1]) as { homes: { som: string; state: string; shop: string | null }[] };
    assert.equal(data.homes.length, 2);
    const held = data.homes.find((x) => x.state === 'held')!;
    assert.match(held.som, /^held\d+$/);
    assert.equal(held.shop, null);
    assert.ok(!html.includes('mute商店'));
    assert.ok(html.includes('aki商店'));
    // トップと店主ページに住所
    const top = await (await fetch(base + '/', { headers: { cookie } })).text();
    assert.match(top, /class="adr">1区[12]-\d+</);
    assert.ok(top.includes('id="town-mini"'));
    const owner = await (await fetch(base + '/view/owner/som0001', { headers: { cookie } })).text();
    assert.match(owner, /住所 第1区[12]丁目\d+番地/);
  } finally {
    server.close();
  }
});
