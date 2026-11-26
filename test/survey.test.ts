// 店主アンケート (1.6.0): 一覧・問い・答える (お礼は初回だけ)・答え直し・digest の案内・締切・合鍵・管理用の集計
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { App } from '../src/api/app.js';
import { seededRng } from '../src/engine/rng.js';
import { newToken, sha256, Store } from '../src/store.js';
import { normalizeAnswers, SURVEY_2026_12_BALANCE, SURVEYS, SurveyInputError } from '../src/surveys.js';

const CIG = 132;
const ID = SURVEY_2026_12_BALANCE.id;

async function start(clock: () => number, store = new Store(':memory:')): Promise<{ base: string; server: Server; store: Store; admin: string }> {
  store.setSetting('invite_hash', sha256('muse-invite'));
  const admin = newToken('sa_');
  store.setSetting('admin_token_hash', sha256(admin));
  const app = new App({ store, rng: seededRng(7), clock, publicUrl: 'https://so.example', imagesDir: resolve('public/images'), sourceDir: resolve('.'), helpText: 'HELP' });
  const server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, store, admin };
}

const full = { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'a', q6: '道具の3職は\n新しい品がほしい' };

test('アンケートの文面: どの選ぶ問いにも「異論なし」か「特になし」があり、金額 (円) を書かない', () => {
  for (const s of SURVEYS) {
    for (const q of s.questions) {
      if (q.kind !== 'text') assert.ok(q.choices!.some((c) => /^(異論なし|特になし)/.test(c.label)), `${s.id} ${q.id}`);
      assert.doesNotMatch([q.title, q.body ?? '', ...(q.choices ?? []).map((c) => c.label)].join(''), /円|万円/, `${s.id} ${q.id}`);
      assert.equal(new Set((q.choices ?? []).map((c) => c.key)).size, (q.choices ?? []).length);
    }
    assert.equal(new Set(s.questions.map((q) => q.id)).size, s.questions.length);
    assert.match(s.intro, /マスター/);
  }
});

test('答えの確かめ: 記号でも文面でも選べ、足りない・知らない・長すぎるは理由つきで断る', () => {
  const s = SURVEY_2026_12_BALANCE;
  assert.deepEqual(normalizeAnswers(s, { ...full, q1: '異論なし', q6: '  ' }), { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'a' });
  assert.throws(() => normalizeAnswers(s, { q1: 'a' }), (e) => e instanceof SurveyInputError && /q2, q3, q4, q5/.test(e.message));
  assert.throws(() => normalizeAnswers(s, { ...full, q9: 'a' }), /q9/);
  assert.throws(() => normalizeAnswers(s, { ...full, q1: 'z' }), /q1 の選択肢/);
  assert.throws(() => normalizeAnswers(s, { ...full, q1: ['a', 'b'] }), /ひとつ/);
  assert.throws(() => normalizeAnswers(s, { ...full, q6: 'あ'.repeat(501) }), /500文字/);
  assert.throws(() => normalizeAnswers(s, 'a'), /answers/);
});

test('アンケート: 答えるとお礼が1回だけ届き、digest の案内が消え、締切まで答え直せる。管理用で集計できる', async () => {
  let now = 1_800_000_000;
  const { base, server, store, admin } = await start(() => now);
  try {
    const open = async (name: string, shopname: string) => {
      const r = await fetch(base + '/api/v1/register?format=json', { method: 'POST', body: JSON.stringify({ invite: 'muse-invite', name, shopname }) });
      const { token, shop_id } = (await r.json()) as { token: string; shop_id: number };
      return { authorization: 'Bearer ' + token, shop: shop_id };
    };
    const a = await open('koucha', '紅茶と栞');
    const b = await open('aina', 'あいな商店');
    const get = (h: { authorization: string }, path: string) => fetch(base + '/api/v1' + path + (path.includes('?') ? '&' : '?') + 'format=json', { headers: { authorization: h.authorization } });
    const post = (h: { authorization: string }, path: string, body: unknown) =>
      fetch(base + '/api/v1' + path + '?format=json', { method: 'POST', headers: { authorization: h.authorization }, body: JSON.stringify(body) });
    const cigs = async (h: { shop: number }) => store.loadWorld(now).shops.find((x) => x.id === h.shop)!.item[CIG - 1] ?? 0;
    const digestText = async (h: { authorization: string }) => (await fetch(base + '/api/v1/digest', { headers: { authorization: h.authorization } })).text();

    // 一覧と digest の案内
    let list = (await (await get(a, '/surveys')).json()) as { surveys: { id: string; open: boolean; answered: boolean; reward: string }[] };
    assert.deepEqual(list.surveys.map((x) => [x.id, x.open, x.answered]), [[ID, true, false]]);
    assert.equal(list.surveys[0].reward, 'タイムシガレット4本 (2時間)');
    assert.match(await digestText(a), new RegExp(`アンケート受付中「次の調整についての意見募集」.*GET /api/v1/surveys/${ID}`));

    // 問いの文面
    const detail = await (await fetch(base + `/api/v1/surveys/${ID}`, { headers: { authorization: a.authorization } })).text();
    assert.match(detail, /q1 \[ひとつ選ぶ\] 職レベルを細かく/);
    assert.match(detail, /q6 \[自由記述・任意・500文字まで\]/);
    assert.match(detail, /POST \/api\/v1\/surveys\/2026-12-balance \{"answers":\{"q1":"a"/);
    assert.equal((await get(a, '/surveys/nope')).status, 404);

    // 足りないと 400、何も変わらない
    const before = await cigs(a);
    let r = await post(a, `/surveys/${ID}`, { answers: { q1: 'a' } });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /q2/);
    assert.equal(await cigs(a), before);

    // 初めて答える: お礼4本、出来事にも残る、digest の案内が消える
    r = await post(a, `/surveys/${ID}`, { answers: full });
    assert.equal(r.status, 201);
    assert.deepEqual(((await r.json()) as { reward: unknown }).reward, [{ item: CIG, name: 'タイムシガレット', count: 4 }]);
    assert.equal(await cigs(a), before + 4);
    assert.doesNotMatch(await digestText(a), /アンケート受付中/);
    assert.match(await digestText(b), /アンケート受付中/, 'ほかの店にはまだ出る');
    const log = await (await fetch(base + '/api/v1/log?all=1', { headers: { authorization: a.authorization } })).text();
    assert.match(log, /アンケート「次の調整についての意見募集」のお礼にタイムシガレット4本/);

    // 答え直し: お礼は増えない。自分の答えが見える
    r = await post(a, `/surveys/${ID}`, { ...full, q1: 'b' }); // answers で包まなくても受け付ける
    assert.equal(r.status, 200);
    assert.equal(await cigs(a), before + 4);
    const mine = (await (await get(a, `/surveys/${ID}`)).json()) as { answered: boolean; my_answers: Record<string, unknown> };
    assert.equal(mine.answered, true);
    assert.equal(mine.my_answers.q1, 'b');

    // 合鍵では読めるが答えられない
    store.addViewKey(a.shop, 'vk_test_survey', 0, 'fixed');
    const vk = { authorization: 'Bearer vk_test_survey' };
    assert.equal((await get(vk, `/surveys/${ID}`)).status, 200);
    assert.equal((await post(vk, `/surveys/${ID}`, { answers: full })).status, 403);

    // b は「いくつ」でも任意の自由記述を省いて答えられる
    r = await post(b, `/surveys/${ID}`, { answers: { q1: 'a', q2: 'a', q3: 'b', q4: 'a', q5: 'f' } });
    assert.equal(r.status, 201);

    // 管理用の集計
    const adm = { authorization: 'Bearer ' + admin };
    const tally = (await (await get(adm, `/admin/surveys/${ID}`)).json()) as { respondents: number; questions: { id: string; choices?: { key: string; n: number; pct: number }[]; texts?: { text: string }[] }[] };
    assert.equal(tally.respondents, 2);
    const q1 = tally.questions.find((q) => q.id === 'q1')!;
    assert.deepEqual(q1.choices!.filter((c) => c.n).map((c) => [c.key, c.n, c.pct]), [['a', 1, 50], ['b', 1, 50]]);
    assert.deepEqual(tally.questions.find((q) => q.id === 'q6')!.texts!.map((t) => t.text), ['道具の3職は\n新しい品がほしい']);
    const csv = await (await fetch(base + `/api/v1/admin/surveys/${ID}?csv=1`, { headers: adm })).text();
    assert.match(csv, /^﻿?som,shop,job,first_at,updated_at,q1,q2,q3,q4,q5,q6\n/);
    assert.match(csv, /紅茶と栞,.*,b,b,c,d,a,"道具の3職は\n新しい品がほしい"/);
    assert.equal((await get(a, `/admin/surveys/${ID}`)).status, 403, '店のトークンでは集計を見られない');

    // 締切: 7日たつと答えられず、digest の案内も出ない
    now += 7 * 86400;
    const c = await open('chai', 'チャイ堂');
    assert.doesNotMatch(await digestText(c), /アンケート受付中/);
    assert.equal((await post(c, `/surveys/${ID}`, { answers: full })).status, 409);
    // 管理用で締切を延ばせる
    r = await fetch(base + `/api/v1/admin/surveys/${ID}?format=json`, { method: 'POST', headers: adm, body: JSON.stringify({ days: 2 }) });
    assert.equal(r.status, 200);
    assert.equal((await post(c, `/surveys/${ID}`, { answers: full })).status, 201);
    r = await fetch(base + `/api/v1/admin/surveys/${ID}?format=json`, { method: 'POST', headers: adm, body: JSON.stringify({ close: true }) });
    assert.equal(r.status, 200);
    assert.equal((await post(c, `/surveys/${ID}`, { answers: full })).status, 409, '締めたあとは答え直しもできない');
  } finally {
    server.close();
  }
});

test('アンケートの受付は、その版で初めて起きたときから始まる (再起動しても延びない)', async () => {
  let now = 1_800_000_000;
  const store = new Store(':memory:');
  const s1 = await start(() => now, store);
  s1.server.close();
  now += 6 * 86400;
  const s2 = await start(() => now, store);
  try {
    const adm = { authorization: 'Bearer ' + s2.admin };
    const d = (await (await fetch(s2.base + '/api/v1/admin/surveys?format=json', { headers: adm })).json()) as { surveys: { opened_at: number; closes_at: number; open: boolean }[] };
    assert.equal(d.surveys[0].opened_at, 1_800_000_000);
    assert.equal(d.surveys[0].closes_at, 1_800_000_000 + 7 * 86400);
    assert.equal(d.surveys[0].open, true);
  } finally {
    s2.server.close();
  }
});
