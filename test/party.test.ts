// Muse Party のトークンで遊ぶ: 招待コードなしで開店、1人1店、別人格でも同じ店、相互リンク
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { App } from '../src/api/app.js';
import { httpPartyVerifier } from '../src/api/party.js';
import { seededRng } from '../src/engine/rng.js';
import { Store } from '../src/store.js';

test('Muse Party のトークンで遊べる', async () => {
  // 本物の Party の代わり: トークン → owner_id
  const owners: Record<string, string> = { 'pt-mute-main': 'o-mute000001', 'pt-mute-alt': 'o-mute000001', 'pt-lapis': 'o-lapis00001' };
  let calls = 0;
  const party = createServer((req, res) => {
    calls++;
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const o = owners[tok];
    if (req.url !== '/api/me' || !o) {
      res.writeHead(401).end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ owner_id: o, participant_id: 'p-' + tok, name: tok }));
  });
  await new Promise<void>((r) => party.listen(0, '127.0.0.1', r));
  const partyUrl = `http://127.0.0.1:${(party.address() as AddressInfo).port}`;

  let now = 1_800_000_000;
  const store = new Store(':memory:');
  const app = new App({ store, rng: seededRng(3), clock: () => now, partyVerifier: httpPartyVerifier(partyUrl), partyPublicUrl: 'https://party.example' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const as = (t: string) => ({ authorization: 'Bearer ' + t });
  try {
    // お店がまだない
    let r = await fetch(base + '/api/v1/digest', { headers: as('pt-mute-main') });
    assert.equal(r.status, 404);
    // 知らないトークン
    r = await fetch(base + '/api/v1/digest', { headers: as('pt-nobody') });
    assert.equal(r.status, 401);

    // 招待コードなしで開店 (name は省略できる)
    r = await fetch(base + '/api/v1/register', { method: 'POST', headers: as('pt-mute-main'), body: JSON.stringify({ shopname: 'ミュート商店' }) });
    assert.equal(r.status, 201, await r.clone().text());
    assert.doesNotMatch(await r.text(), /so_/);

    // 別人格のトークンでも同じ店。2店目は断る
    r = await fetch(base + '/api/v1/register', { method: 'POST', headers: as('pt-mute-alt'), body: JSON.stringify({ shopname: 'ミュート裏商店' }) });
    assert.equal(r.status, 409);
    r = await fetch(base + '/api/v1/digest', { headers: as('pt-mute-alt') });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /^ミュート商店/);

    // 別の人は別の店
    r = await fetch(base + '/api/v1/register', { method: 'POST', headers: as('pt-lapis'), body: JSON.stringify({ shopname: 'ラピス堂' }) });
    assert.equal(r.status, 201);
    r = await fetch(base + '/api/v1/digest', { headers: as('pt-lapis') });
    assert.match(await r.text(), /^ラピス堂/);

    // Party への問い合わせは覚えておく (同じトークンで何度来ても増えない)
    const before = calls;
    for (let i = 0; i < 5; i++) await fetch(base + '/api/v1/digest', { headers: as('pt-lapis') });
    assert.equal(calls, before);

    // 許可した店は Party のトークンのまま管理 API が使える
    r = await fetch(base + '/api/v1/admin/stats', { headers: as('pt-mute-main') });
    assert.equal(r.status, 403);
    const muteShop = store.shopIdByPartyOwner('o-mute000001')!;
    store.setSetting('admin_shops', String(muteShop));
    r = await fetch(base + '/api/v1/admin/stats', { headers: as('pt-mute-alt') });
    assert.equal(r.status, 200, '別人格のトークンでも同じ人なら管理者');
    r = await fetch(base + '/api/v1/admin/stats', { headers: as('pt-lapis') });
    assert.equal(r.status, 403);

    // 観戦画面から Party へ飛べる
    const html = await (await fetch(base + '/view/ranking')).text();
    assert.match(html, /href="https:\/\/party\.example"/);

    // 閉店したら同じ人がまた開店できる
    r = await fetch(base + '/api/v1/actions', { method: 'POST', headers: as('pt-lapis'), body: JSON.stringify({ type: 'close', confirm: 'closeshop' }) });
    assert.match(await r.text(), /^OK close/);
    r = await fetch(base + '/api/v1/register', { method: 'POST', headers: as('pt-lapis'), body: JSON.stringify({ shopname: 'ラピス堂二号' }) });
    assert.equal(r.status, 201, await r.clone().text());
  } finally {
    server.close();
    party.close();
  }
});
