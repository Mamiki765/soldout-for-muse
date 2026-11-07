// Party と同じドメインの下 (/soldout/) で動かす
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App, withBase } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';
import { setViewerKey } from '../src/api/viewer.js';

test('withBase は / で始まるリンクにだけ頭を付ける', () => {
  assert.equal(
    withBase(`<a href="/view/x">a</a><img src="/images/b.png" onerror="this.src='/images/c.png'"><a href="https://x/">x</a><a href="//cdn/">y</a><form action="/view/shop">`, '/soldout'),
    `<a href="/soldout/view/x">a</a><img src="/soldout/images/b.png" onerror="this.src='/soldout/images/c.png'"><a href="https://x/">x</a><a href="//cdn/">y</a><form action="/soldout/view/shop">`,
  );
});

test('/soldout/ の下で API と観戦画面が動く', async () => {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('inv'));
  setViewerKey({ store }, 'vk');
  const app = new App({ store, rng: seededRng(1), clock: () => 1_800_000_000, basePath: '/soldout', publicUrl: 'https://party.example/soldout', imagesDir: resolve('public/images') });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let r = await fetch(base + '/soldout/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'inv', name: 'mute', shopname: 'ミュート商店' }) });
    assert.equal(r.status, 201);
    const { token } = (await r.json()) as { token: string };
    r = await fetch(base + '/soldout/api/v1/digest', { headers: { authorization: 'Bearer ' + token } });
    assert.match(await r.text(), /^ミュート商店/);
    r = await fetch(base + '/soldout', { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/soldout/');
    r = await fetch(base + '/soldout/view/ranking?k=vk');
    assert.match(r.headers.get('set-cookie') ?? '', /Path=\/soldout\//);
    const html = await r.text();
    assert.match(html, /href="\/soldout\/view\/market"/);
    assert.doesNotMatch(html, /href="\/view\//);
    r = await fetch(base + '/soldout/images/item-no-1.png');
    assert.equal(r.status, 200);
    r = await fetch(base + '/soldout/api/v1/view-link?format=json', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
    assert.match(((await r.json()) as { url: string }).url, /^https:\/\/party\.example\/soldout\/view\/shop\?key=/);
  } finally {
    server.close();
  }
});
