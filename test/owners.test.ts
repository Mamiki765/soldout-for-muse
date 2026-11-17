// SOLD OUT for Muse — 0.5.0 店主ID (som)・アイコン・出店許可証・スペース用の読むだけ API のテスト
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { httpPartyVerifier } from '../src/api/party.js';
import { inspectWebp } from '../src/api/webp.js';
import { seededRng } from '../src/engine/rng.js';
import { Store } from '../src/store.js';

/** 中身は空の、形だけ正しい webp (VP8L の頭だけ。検品は頭しか見ない) */
function webp(w: number, h: number, extra: { exif?: boolean; anim?: boolean } = {}): string {
  const chunk = (id: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, Buffer.alloc(data.length & 1)]);
  };
  const vp8l = Buffer.alloc(6);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  const parts: Buffer[] = [];
  if (extra.exif || extra.anim) {
    const x = Buffer.alloc(10);
    x[0] = (extra.exif ? 0x08 : 0) | (extra.anim ? 0x02 : 0);
    x.writeUIntLE(w - 1, 4, 3);
    x.writeUIntLE(h - 1, 7, 3);
    parts.push(chunk('VP8X', x));
  }
  parts.push(chunk('VP8L', vp8l));
  if (extra.exif) parts.push(chunk('EXIF', Buffer.from('camera-secret')));
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]).toString('base64');
}

test('webp の検品: 大きさを読み、EXIF を外し、動く webp と webp 以外を断る', () => {
  const plain = inspectWebp(Buffer.from(webp(200, 200), 'base64'));
  assert.deepEqual([plain.width, plain.height], [200, 200]);
  const ex = inspectWebp(Buffer.from(webp(300, 100, { exif: true }), 'base64'));
  assert.deepEqual([ex.width, ex.height], [300, 100]);
  assert.ok(!ex.data.includes(Buffer.from('camera-secret')), 'EXIF が外れる');
  assert.throws(() => inspectWebp(Buffer.from(webp(10, 10, { anim: true }), 'base64')), /動く webp/);
  assert.throws(() => inspectWebp(Buffer.from('\x89PNG\r\n\x1a\n0000000000000000')), /webp ではありません/);
});

test('店主ID・アイコン・許可証・差分・合鍵で読む・古い画像の片づけ', async () => {
  const names: Record<string, [string, string]> = { 'pt-mute': ['o-mute', 'ミュート'], 'pt-lapis': ['o-lapis', 'ラピス'] };
  const party = createServer((req, res) => {
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const o = names[tok];
    if (!o) return void res.writeHead(401).end('{}');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ owner_id: o[0], participant_id: 'p-' + tok, name: o[1] }));
  });
  await new Promise<void>((r) => party.listen(0, '127.0.0.1', r));
  const partyUrl = `http://127.0.0.1:${(party.address() as AddressInfo).port}`;
  const assetsDir = mkdtempSync(join(tmpdir(), 'soldout-assets-'));

  let now = 1_800_000_000;
  const store = new Store(':memory:');
  const app = new App({ store, rng: seededRng(5), clock: () => now, partyVerifier: httpPartyVerifier(partyUrl), partyPublicUrl: '', assetsDir, kitDir: resolve('kit') });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const as = (t: string) => ({ authorization: 'Bearer ' + t, accept: 'application/json' });
  const get = async (path: string, t: string) => {
    const r = await fetch(base + path, { headers: as(t) });
    assert.equal(r.status, 200, `${path}: ${await r.clone().text()}`);
    return r.json() as Promise<any>;
  };
  const post = (path: string, t: string, body: unknown) => fetch(base + path, { method: 'POST', headers: as(t), body: JSON.stringify(body) });
  try {
    // 開店した順に som が付き、店主名は Party の名前
    for (const [t, shop] of [['pt-mute', 'ミュート商店'], ['pt-lapis', 'ラピス堂']]) {
      const r = await post('/api/v1/register', t, { shopname: shop });
      assert.equal(r.status, 201, await r.clone().text());
    }
    let me = await get('/api/v1/profile', 'pt-mute');
    assert.equal(me.som, 'som0001');
    assert.equal(me.owner_name, 'ミュート');
    assert.equal(me.name_source, 'party');
    assert.equal((await get('/api/v1/profile', 'pt-lapis')).som, 'som0002');

    // Party で名前が変わったら sync_name ですぐ写る
    names['pt-mute'][1] = 'ミュート改';
    let r = await post('/api/v1/profile', 'pt-mute', { sync_name: true });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await get('/api/v1/profile', 'pt-mute')).owner_name, 'ミュート改');
    r = await post('/api/v1/profile', 'pt-mute', { display_name: '勝手な名前' });
    assert.equal(r.status, 409, 'Party の店は店主名を自分で変えられない');

    // アイコン: 200×200 の webp だけ
    r = await post('/api/v1/profile/icon', 'pt-mute', { image_base64: webp(100, 100) });
    assert.equal(r.status, 409);
    assert.match(await r.text(), /200×200/);
    r = await post('/api/v1/profile/icon', 'pt-mute', { image_base64: webp(200, 200) });
    assert.equal(r.status, 201, await r.clone().text());
    const icon1 = ((await r.json()) as { file: string }).file;
    assert.equal(icon1, 'som0001_000001.webp');
    r = await fetch(base + '/assets/' + icon1);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/webp');
    assert.match(r.headers.get('cache-control') ?? '', /immutable/);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');

    // 許可証: 下書き → 登録。サーバーの5項目＋通り名
    const draft = await get('/api/v1/profile/card/draft', 'pt-mute');
    assert.equal(draft.card.license_no, 'som0001');
    assert.equal(draft.card.shopname, 'ミュート商店');
    assert.deepEqual(draft.frame.size, [2293, 1482]);
    r = await post('/api/v1/profile/card', 'pt-mute', { image_base64: webp(1000, 700) });
    assert.equal(r.status, 409, '枠と違う大きさは断る');
    r = await post('/api/v1/profile/card', 'pt-mute', { image_base64: webp(2293, 1482), aka: [{ where: 'Muse Party', name: 'ミュート' }], alt: '青い髪' });
    assert.equal(r.status, 201, await r.clone().text());
    let card = (await get('/api/v1/owners/som0001', 'pt-lapis')).card;
    assert.equal(card.owner_name, 'ミュート改');
    assert.deepEqual(card.aka, [{ where: 'Muse Party', name: 'ミュート' }]);
    assert.equal(card.stale, false);
    // 通り名だけ直す (画像なし)
    r = await post('/api/v1/profile/card', 'pt-mute', { aka: [] });
    assert.equal(r.status, 201, await r.clone().text());
    assert.deepEqual((await get('/api/v1/owners/som0001', 'pt-mute')).card.aka, []);

    // 店名が変わると stale になり、digest で知らせる
    app.world.shops.find((s) => s.shopname === 'ミュート商店')!.money = 10_000_000; // 改名は費用がかかる
    r = await fetch(base + '/api/v1/actions', { method: 'POST', headers: as('pt-mute'), body: JSON.stringify({ type: 'rename', shopname: 'ミュート本舗' }) });
    assert.equal(((await r.json()) as { results: { ok: boolean }[] }).results[0].ok, true);
    card = (await get('/api/v1/owners/som0001', 'pt-mute')).card;
    assert.equal(card.stale, true);
    assert.equal(card.shopname, 'ミュート本舗');
    assert.equal(card.drawn.shopname, 'ミュート商店');
    const digest = await get('/api/v1/digest', 'pt-mute');
    assert.ok(digest.warnings.some((w: string) => /許可証の絵が古い/.test(w)));

    // 全店の一覧に店主・アイコンが付く
    const town = await get('/api/v1/town', 'pt-lapis');
    const mute = town.shops.find((s: { som: string }) => s.som === 'som0001');
    assert.equal(mute.icon, icon1);
    assert.equal(mute.owner_name, 'ミュート改');

    // 画像の差分: 差し替えると古いのは removed へ (1日後)
    const d0 = await get('/api/v1/assets?since=0', 'pt-lapis');
    assert.ok(d0.added.some((a: { file: string }) => a.file === icon1));
    r = await post('/api/v1/profile/icon', 'pt-mute', { image_base64: webp(200, 200) });
    const icon2 = ((await r.json()) as { file: string }).file;
    assert.equal(icon2, 'som0001_000003.webp');
    const d1 = await get('/api/v1/assets?since=' + d0.cursor, 'pt-lapis');
    assert.deepEqual(d1.added.map((a: { file: string }) => a.file), [icon2]);
    assert.ok(existsSync(join(assetsDir, icon1)), '差し替えてすぐは消さない');
    now += 86400 + 3601;
    await get('/api/v1/me', 'pt-lapis'); // 片づけはアクセスのついでに走る
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(!existsSync(join(assetsDir, icon1)), '1日たつと消える');
    assert.equal((await fetch(base + '/assets/' + icon1)).status, 404);
    const d2 = await get('/api/v1/assets?since=' + d1.cursor, 'pt-lapis');
    assert.ok(d2.removed.includes(icon1));

    // 1日5回まで
    for (let i = 0; i < 4; i++) await post('/api/v1/profile/icon', 'pt-lapis', { image_base64: webp(200, 200) });
    r = await post('/api/v1/profile/icon', 'pt-lapis', { image_base64: webp(200, 200) });
    assert.equal(r.status, 201);
    r = await post('/api/v1/profile/icon', 'pt-lapis', { image_base64: webp(200, 200) });
    assert.equal(r.status, 409);
    assert.match(await r.text(), /5回/);

    // 店の固定合鍵 (vk_) は読むだけ。未読や手引きは動かさない
    r = await post('/api/v1/view-link', 'pt-mute', { fixed: true });
    const vk = /vk_[\w-]+/.exec(await r.text())![0];
    assert.equal((await get('/api/v1/me', vk)).som, 'som0001');
    r = await fetch(base + '/api/v1/actions', { method: 'POST', headers: as(vk), body: JSON.stringify({ type: 'rename', shopname: '乗っ取り' }) });
    assert.equal(r.status, 403);
    r = await post('/api/v1/profile/icon', vk, { image_base64: webp(200, 200) });
    assert.equal(r.status, 403);
    assert.equal((await fetch(base + '/api/v1/tutorial', { headers: as(vk) })).status, 403);

    // CORS の事前確認
    r = await fetch(base + '/api/v1/town', { method: 'OPTIONS' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');

    // 枠の一覧はトークン不要
    const frames = (await (await fetch(base + '/api/v1/card/frames', { headers: { accept: 'application/json' } })).json()) as { default: string; frames: { frame: string }[] };
    assert.equal(frames.default, 'license-03');
    assert.ok(frames.frames.some((f) => f.frame === 'license-03'));
    assert.equal((await fetch(base + '/assets/kit/frames/frame-license-03.webp')).status, 200);
    assert.equal((await fetch(base + '/assets/kit/../package.json')).status, 404);

    // 観戦画面: TOP にアイコン、店主のページ
    const top = await (await fetch(base + '/')).text();
    assert.ok(top.includes(icon2), 'TOP に今のアイコン');
    const page = await fetch(base + '/view/owner/som0001');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /som0001/);
  } finally {
    server.close();
    party.close();
    rmSync(assetsDir, { recursive: true, force: true });
  }
});
