// GET /api/v1/shops は limit を付けなければ全店を返す (30店で切れて半分見えなかった)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';

test('/shops は既定で全店、limit で絞れる', async () => {
  let now = 1_800_000_000;
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock: () => now, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const N = 35;
    let token = '';
    for (let i = 0; i < N; i++) {
      now += 120;
      const shopname = '店' + String.fromCharCode(0x30a2 + i) + 'あ';
      const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name: 'm' + i, shopname }) });
      assert.equal(r.status, 201, await r.clone().text());
      if (!token) token = ((await r.json()) as { token: string }).token;
    }
    const auth = { authorization: 'Bearer ' + token };
    let r = await fetch(base + '/api/v1/shops?format=json', { headers: auth });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as unknown[]).length, N);
    r = await fetch(base + '/api/v1/shops?format=json&limit=10', { headers: auth });
    assert.equal(((await r.json()) as unknown[]).length, 10);
  } finally {
    server.close();
    store.close();
  }
});
