import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { peekReference } from '../src/api/peek-guide.js';

test('ページからコピーした番犬が5分ごとの変化・再起動・エラーを扱える', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'soldout-peek-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const html = peekReference();
  const code = (id: string) => html.split(`<code id="${id}">`)[1].split('</code>')[0]
    .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const sample = JSON.parse(code('peek-json'));
  writeFileSync(join(dir, 'watch.mjs'), code('peek-script'));
  const stub = join(dir, 'test-fetch.mjs');
  writeFileSync(stub, `import assert from 'node:assert/strict';
globalThis.fetch = async (url, {headers}) => {
  const {seen, body, status} = JSON.parse(process.env.REPLY);
  assert.equal(url.origin + url.pathname, 'https://museimg.party/soldout/api/v1/peek');
  assert.equal(url.searchParams.get('seen'), seen);
  assert.equal(url.searchParams.get('full'), '1');
  assert.equal(url.searchParams.get('facts'), '1');
  assert.equal(headers.Authorization, 'Bearer mct_fixture');
  if (status === 0) throw Error('offline');
  return new Response(status === 200 ? JSON.stringify(body) : null,
    {status, headers: {'X-Cursor': body.cursor}});
};`);
  function run(seen: string | null, status = 200, check = false, exitCode = 0) {
    const args = ['--import', pathToFileURL(stub).href, 'watch.mjs'];
    if (check) args.push('--check');
    const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, SOLDOUT_TOKEN: 'mct_fixture', REPLY: JSON.stringify({ seen, status, body: sample }) } });
    assert.equal(result.status, exitCode, result.stderr);
    if (check) assert.match(result.stderr, /疎通OK/);
    return result.stdout.trim();
  }
  const shelf = sample.facts.shelves[0];
  shelf.empty_in = 64 * 60;
  assert.equal(run(null, 200, true), '');
  assert.equal(run(null), '');
  shelf.empty_in = 59 * 60;
  assert.match(run(''), /あと59分/);
  shelf.empty_in = 54 * 60;
  assert.equal(run(''), '');
  sample.cursor = 'next';
  assert.equal(run('', 204), '');
  shelf.stock = 0;
  shelf.empty_in = null;
  sample.facts.time = 0;
  sample.facts.period.short = 100;
  assert.match(run('next'), /^決算で100円/);
  sample.facts.time = 600;
  assert.match(run('next'), /^棚1の在庫が0個です$/);
  const state = () => readFileSync(join(dir, 'peek-state.json'), 'utf8');
  const before = state();
  for (const status of [0, 503]) {
    assert.equal(run('next', status, false, 1), '');
    assert.equal(state(), before);
  }
  assert.equal(run('next', 401, false, 1), '');
  assert.equal(run('next', 401), ''); // 休止中はHTTPを呼ばない
  assert.equal(run('next', 200, true), '');
  assert.equal(run('next'), '');
  shelf.stock = 3;
  sample.facts.period.short = 0;
  assert.equal(run('next'), '');
  shelf.stock = 0;
  assert.match(run('next'), /^棚1の在庫が0個です$/);
});
