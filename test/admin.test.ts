// 目安箱と管理用 API (ミュート用)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { newToken, sha256, Store } from '../src/store.js';

test('目安箱に入れて、管理用トークンで回収して返事する', async () => {
  let now = 1_800_000_000;
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
    const reg = (await (await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'mute', shopname: 'ミュート商店' }) })).json()) as { token: string };
    const t = reg.token;

    // 投函
    let r = await post('/api/v1/suggest', t, { category: 'feature', text: 'ギルドを実装してほしい' });
    assert.equal(r.status, 201);
    r = await post('/api/v1/suggest', t, { category: 'なんでも', text: 'x' });
    assert.equal(r.status, 409, '知らないカテゴリは断る');
    for (let i = 0; i < 4; i++) await post('/api/v1/suggest', t, { category: '不具合', text: '案' + i });
    assert.match(await (await get('/api/v1/admin/suggestions?category=bug', admin)).text(), /\[不具合\]/);
    r = await post('/api/v1/suggest', t, { text: '6件目' });
    assert.equal(r.status, 409, '24時間に5件まで');

    // 管理用トークンで /me を聞くと role admin (保管庫の接続確認向け)
    r = await get('/api/v1/me?format=json', admin);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { role: 'admin' });

    // 一般のトークンでは管理 API は使えない
    r = await get('/api/v1/admin/suggestions', t);
    assert.equal(r.status, 403);

    // 回収して返事
    r = await get('/api/v1/admin/suggestions', admin);
    const all = await r.text();
    assert.match(all, /#1 .*\[追加実装\] 未読 店\d+ ミュート商店\n {2}ギルドを実装してほしい/);
    now += 60;
    r = await post('/api/v1/admin/suggestions/1', admin, { status: 'accepted', reply: '次にやります' });
    assert.equal(r.status, 200);
    r = await post('/api/v1/admin/suggestions/1', admin, { status: 'bogus' });
    assert.equal(r.status, 400);

    // Muse 側: digest に返事の知らせ、読むと消える
    assert.match(await (await get('/api/v1/digest', t)).text(), /目安箱の返事1/);
    assert.match(await (await get('/api/v1/suggest', t)).text(), /採用\n {2}ギルドを実装してほしい\n {2}→ 次にやります/);
    assert.doesNotMatch(await (await get('/api/v1/digest', t)).text(), /目安箱の返事/);

    // お知らせ・街の様子・招待コード
    r = await post('/api/v1/admin/notice', admin, { text: '今夜メンテします' });
    assert.equal(r.status, 200);
    assert.match(await (await get('/api/v1/log?all=1', t)).text(), /【お知らせ】今夜メンテします/);
    assert.match(await (await get('/api/v1/admin/stats', admin)).text(), /^店1\/100/);
    r = await post('/api/v1/admin/invite', admin, { code: null });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/v1/register', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'lapis', shopname: 'ラピス堂' }) });
    assert.equal(r.status, 403, '招待コードを止めたら登録できない');
  } finally {
    server.close();
  }
});
