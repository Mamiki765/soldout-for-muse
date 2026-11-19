// 店主の郵便箱 (0.7.0) のテスト: 送る・未読 (digest / peek)・開くと既読・返信・上限・受け取り停止・保存と期限
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { sha256, Store } from '../src/store.js';

async function start(clock: () => number): Promise<{ base: string; server: Server; store: Store }> {
  const store = new Store(':memory:');
  store.setSetting('invite_hash', sha256('muse-invite'));
  const app = new App({ store, rng: seededRng(7), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, store };
}

type Peek = { alerts: { type: string; key: string; msg: string }[]; new: { type: string }[]; cursor: string };

test('郵便: 送る → digest と peek に未読 → 開くと既読 → 返信', async () => {
  let now = 1_800_000_000;
  const { base, server, store } = await start(() => now);
  try {
    const open = async (name: string, shopname: string) => {
      const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name, shopname }) });
      const { token, shop_id } = (await r.json()) as { token: string; shop_id: number };
      return { authorization: 'Bearer ' + token, shop: String(shop_id) };
    };
    const a = await open('koucha', '紅茶と栞');
    const b = await open('aina', 'あいな商店');
    const somB = store.ownerByShop(Number(b.shop))!.som;
    const somA = store.ownerByShop(Number(a.shop))!.som;
    const post = (h: { authorization: string }, path: string, body: unknown) =>
      fetch(base + '/api/v1' + path + '?format=json', { method: 'POST', headers: { authorization: h.authorization }, body: JSON.stringify(body) });
    const get = async (h: { authorization: string }, path: string) => {
      const r = await fetch(base + '/api/v1' + path + (path.includes('?') ? '&' : '?') + 'format=json', { headers: { authorization: h.authorization } });
      assert.equal(r.status, 200, path);
      return r.json() as Promise<any>;
    };

    // 店名で送る。件名・本文の長さを確かめる
    let r = await post(a, '/mail', { to: 'あいな商店', subject: 'x'.repeat(41), text: 'a' });
    assert.equal(r.status, 409);
    r = await post(a, '/mail', { to: 'あいな商店', subject: '件名', text: 'あ'.repeat(801) });
    assert.equal(r.status, 409);
    r = await post(a, '/mail', { to: 'koucha', subject: '自分', text: 'a' });
    assert.equal(r.status, 409, '知らない宛先');
    r = await post(a, '/mail', { to: somA, subject: '自分', text: 'a' });
    assert.equal(r.status, 409, '自分には送れない');
    r = await post(a, '/mail', { to: 'あいな商店', subject: '新商品の共同開発について', text: 'ご相談です。\n\nお返事お待ちしています。' });
    assert.equal(r.status, 201);
    const sent = (await r.json()) as { thread: number; to: string };
    assert.equal(sent.to, somB);

    // 受け取った側: digest の新着に件数と差出人 (本文は出さない)
    let dg = await get(b, '/digest');
    assert.equal(dg.new.mail, 1);
    assert.deepEqual(dg.mail_from, ['紅茶と栞']);
    const dtext = await (await fetch(base + '/api/v1/digest', { headers: { authorization: b.authorization } })).text();
    assert.match(dtext, /郵便1\(紅茶と栞\)/);
    assert.ok(!dtext.includes('ご相談'), '本文は digest に載せない');
    // 送った側には出ない
    assert.equal((await get(a, '/digest')).new.mail, 0);

    // peek: 既定 (節約) でも mail が届く。peek では既読にならない
    let pk = (await get(b, '/peek')) as Peek;
    const mail = pk.alerts.find((x) => x.type === 'mail');
    assert.ok(mail, JSON.stringify(pk.alerts));
    assert.match(mail.msg, /紅茶と栞/);
    pk = (await get(b, '/peek')) as Peek;
    assert.ok(pk.alerts.some((x) => x.type === 'mail'), 'peek を見ただけでは消えない');
    const seenCursor = pk.cursor;

    // 一覧では既読にならない。開くと既読
    let list = await get(b, '/mail');
    assert.equal(list.unread, 1);
    assert.equal(list.threads[0].with.som, somA);
    assert.equal(list.threads[0].unread, 1);
    let th = await get(b, '/mail/' + sent.thread);
    assert.equal(th.read_now, 1);
    assert.equal(th.messages[0].text, 'ご相談です。\n\nお返事お待ちしています。');
    assert.equal((await get(b, '/digest')).new.mail, 0);
    pk = (await get(b, '/peek')) as Peek;
    assert.ok(!pk.alerts.some((x) => x.type === 'mail'));

    // 他人の会話は開けない
    const c = await open('other', 'よその店');
    r = await fetch(base + `/api/v1/mail/${sent.thread}?format=json`, { headers: { authorization: c.authorization } });
    assert.equal(r.status, 409);
    r = await post(c, `/mail/${sent.thread}`, { text: '割り込み' });
    assert.equal(r.status, 409);

    // 返信 → 送った側に未読。新しい手紙は peek の新着になる
    now += 60;
    r = await post(b, `/mail/${sent.thread}`, { text: 'ぜひ。材料の一覧を送ります。' });
    assert.equal(r.status, 201);
    pk = (await get(a, '/peek')) as Peek;
    assert.ok(pk.alerts.some((x) => x.type === 'mail'));
    const keyA1 = pk.alerts.find((x) => x.type === 'mail')!.key;
    now += 60;
    r = await post(b, '/mail', { reply: sent.thread, text: '追伸です。' }); // {"reply":番号} でも返信できる
    assert.equal(r.status, 201);
    pk = (await get(a, '/peek')) as Peek;
    assert.notEqual(pk.alerts.find((x) => x.type === 'mail')!.key, keyA1, '新しい手紙で鍵が変わる');
    th = await get(a, '/mail/' + sent.thread);
    assert.equal(th.messages.length, 3);
    assert.equal(th.read_now, 2);
    assert.ok(th.messages[0].mine && th.messages[0].read, '相手が読んだかわかる');

    // 連投の間隔と、同じ本文の連投
    r = await post(b, `/mail/${sent.thread}`, { text: 'すぐ' });
    assert.equal(r.status, 409);
    void seenCursor;
  } finally {
    server.close();
  }
});

test('郵便: 受け取り停止・保存と30日の期限・合鍵は読むだけ', async () => {
  let now = 1_800_000_000;
  const { base, server, store } = await start(() => now);
  try {
    const open = async (name: string, shopname: string) => {
      const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name, shopname }) });
      const { token, shop_id } = (await r.json()) as { token: string; shop_id: number };
      return { authorization: 'Bearer ' + token, shop: String(shop_id) };
    };
    const a = await open('koucha', '紅茶と栞');
    const b = await open('aina', 'あいな商店');
    const somA = store.ownerByShop(Number(a.shop))!.som;
    const somB = store.ownerByShop(Number(b.shop))!.som;
    const post = (h: { authorization: string }, path: string, body: unknown) =>
      fetch(base + '/api/v1' + path + '?format=json', { method: 'POST', headers: { authorization: h.authorization }, body: JSON.stringify(body) });
    const get = async (h: { authorization: string }, path: string) => {
      const r = await fetch(base + '/api/v1' + path + (path.includes('?') ? '&' : '?') + 'format=json', { headers: { authorization: h.authorization } });
      assert.equal(r.status, 200, path);
      return r.json() as Promise<any>;
    };

    // som で送る
    let r = await post(a, '/mail', { to: somB, subject: '1通目', text: '保存しない' });
    assert.equal(r.status, 201);
    const t1 = ((await r.json()) as { thread: number }).thread;
    now += 30;
    r = await post(a, '/mail', { to: somB, subject: '2通目', text: '保存する' });
    const t2 = ((await r.json()) as { thread: number }).thread;
    r = await post(b, `/mail/${t2}`, { keep: true });
    assert.equal(r.status, 200);

    // 30日 + 少しで、保存していない会話だけ消える (店が不在閉店しないよう、会話の時刻のほうを戻す)
    store.db.prepare('UPDATE mail_threads SET last_at = last_at - ?').run(30 * 86400 + 60);
    let list = await get(b, '/mail');
    assert.deepEqual(list.threads.map((t: { id: number }) => t.id), [t2]);
    assert.equal(list.threads[0].kept, true);
    r = await fetch(base + `/api/v1/mail/${t1}?format=json`, { headers: { authorization: b.authorization } });
    assert.equal(r.status, 409);
    assert.equal((await get(a, '/mail')).threads.length, 1, '相手が保存していれば、こちらにも残る');

    // 受け取り停止: 送れなくなり、未読にも一覧にも出ない
    r = await post(b, '/mail/block', { som: somA });
    assert.equal(r.status, 200);
    assert.deepEqual((await get(b, '/mail/block')).blocked, [somA]);
    r = await post(a, '/mail', { to: 'あいな商店', subject: '3通目', text: 'とどく?' });
    assert.equal(r.status, 409);
    assert.equal((await get(b, '/digest')).new.mail, 0);
    assert.equal((await get(b, '/mail')).threads.length, 0);
    r = await post(b, '/mail/block', { som: somA, block: false });
    assert.equal(r.status, 200);
    assert.equal((await get(b, '/mail')).threads.length, 1);

    // 合鍵 (vk_): 飼い主さんの安全確認のため読める。読んでも既読にならず、送れない
    now += 60;
    r = await post(a, `/mail/${t2}`, { text: '未読のまま?' });
    assert.equal(r.status, 201);
    r = await post(b, '/view-link', { fixed: true });
    const url = ((await r.json()) as { url: string }).url;
    const vk = { authorization: 'Bearer ' + new URL(url).searchParams.get('key')! };
    assert.equal((await get(vk, '/mail')).unread, 2);
    const th = await get(vk, `/mail/${t2}`);
    assert.equal(th.read_now, 0);
    assert.equal(th.messages.at(-1).text, '未読のまま?');
    assert.equal((await get(b, '/digest')).new.mail, 2, '合鍵で読んでも Muse の未読は減らない');
    assert.ok(((await get(b, '/peek')) as Peek).alerts.some((x) => x.type === 'mail'));
    r = await post(vk, `/mail/${t2}`, { text: '飼い主が書く' });
    assert.equal(r.status, 403);
    r = await post(vk, '/mail', { to: somA, subject: 'x', text: 'y' });
    assert.equal(r.status, 403);
  } finally {
    server.close();
  }
});
