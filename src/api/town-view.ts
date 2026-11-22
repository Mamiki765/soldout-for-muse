// SOLD OUT for Muse — 街の地図 (1.2.0) の API の文と、観戦画面の地図のページ。
// 地図そのものはブラウザで描く (public/town/town-gen.js と tiles.js、絵は kit/town)。
// サーバーは「どの店がどの区画にいるか」と店の様子を JSON でページに埋め込むだけ。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWN_GEN_PATH, type Town, type TownGen } from '../town/gen.js';
import { MOVE_WAIT_PERIODS, PAINT_WAIT_PERIODS, TOWN_OPTS, type ShopInfo, type TownService } from '../town/town.js';
import { APP_VERSION } from '../updates.js';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function md(t: number): string {
  const d = new Date((t + 9 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// Muse 向け API

export function colorsData(gen: TownGen, publicUrl: string) {
  return {
    roof: gen.ROOFS.map((c, i) => ({ no: i + 1, name: c.name, hex: c.hex })),
    door: gen.DOORS.map((c, i) => ({ no: i + 1, name: c.name, hex: c.hex })),
    how: '{"type":"paint","roof":1〜8,"door":1〜8} (片方だけでもよい。空けた方は今の色のまま)',
    sample: publicUrl + '/view/town/colors',
  };
}

export function colorsText(d: ReturnType<typeof colorsData>): string {
  return [
    '屋根 ' + d.roof.map((c) => `${c.no}:${c.name}`).join(' '),
    '入口 ' + d.door.map((c) => `${c.no}:${c.name}`).join(' '),
    `塗り方 ${d.how}`,
    `見本 (人間向け、S/M/L の家の絵) ${d.sample}`,
  ].join('\n') + '\n';
}

type HomeData = NonNullable<ReturnType<TownService['homeData']>>;

export function homeText(d: HomeData): string {
  const nb = (k: 'left' | 'right' | 'front', label: string) => {
    const n = d.neighbors[k];
    if (!n) return `${label}:なし`;
    return `${label}:${n.state === 'open' || n.state === 'resting' ? n.shop + (n.state === 'resting' ? '(休業)' : '') : n.state === 'vacant' ? '空き' : n.state === 'empty_house' ? '空き家' : '予約'}`;
  };
  const lines = [
    `住所 ${d.address} (${d.address_long}・${d.district.heading}${d.street ? '・' + d.street : ''}) 家${d.home_size}`,
    `色 屋根${d.colors.roof.no}:${d.colors.roof.name} 入口${d.colors.door.no}:${d.colors.door.name}`,
    `お隣 ${nb('left', '左')} ${nb('right', '右')} ${nb('front', '向かい')}`,
  ];
  const free = [d.free_move_until && `引っ越し${md(d.free_move_until)}まで`, d.free_paint_until && `色変え${md(d.free_paint_until)}まで`].filter(Boolean);
  if (free.length) lines.push(`無料で1回 ${free.join(' / ')}`);
  const wait = [d.move_ready_at && `引っ越しは${md(d.move_ready_at)}から`, d.paint_ready_at && `色変えは${md(d.paint_ready_at)}から`].filter(Boolean);
  if (wait.length) lines.push(`次に使えるのは ${wait.join(' / ')}`);
  lines.push('色変え {"type":"paint","roof":1〜8,"door":1〜8} 色の番号 GET /api/v1/town/colors ／ 引っ越し {"type":"move","to":"1区2-4"} 空き GET /api/v1/town/around?vacant=1');
  return lines.join('\n') + '\n';
}

type AroundData = NonNullable<ReturnType<TownService['around']>>;

export function aroundText(d: AroundData): string {
  const st: Record<string, string> = { vacant: '空き', empty_house: '空き家', reserved: '予約', landmark: '目印' };
  const out = [`${d.district.no ? d.district.no + '区' : '中央'}${d.district.name ? ' ' + d.district.name : ''} (${d.scope === 'district' ? '地区ぜんぶ' : '同じ通りの両側'}) ここ=${d.here}`];
  let street = '';
  for (const l of d.lots) {
    if (l.street !== street) {
      street = l.street ?? '';
      out.push(`[${street}]`);
    }
    const what = l.state === 'open' || l.state === 'resting' ? `${l.shop}${l.state === 'resting' ? '(休業)' : ''} ${l.home_size}` : l.state === 'landmark' ? `${l.shop}` : st[l.state];
    out.push(`${l.address ?? '-'} ${what}${l.here ? ' ←ここ' : ''}`);
  }
  out.push('引っ越しは {"type":"move","to":"住所"} (空きの区画だけ)');
  return out.join('\n') + '\n';
}

export function vacantText(d: { districts: { no: number; name: string | null; vacant: string[] }[] }): string {
  return d.districts.map((x) => `${x.no}区${x.name ? ' ' + x.name : ''}: ${x.vacant.length ? x.vacant.join(' ') : '空きなし'}`).join('\n') + '\n引っ越しは {"type":"move","to":"住所"}\n';
}

/** 地図のマス目 (スペースで描く用)。district: 区の番号 (0 = 中央の2つ)。既定は自分の地区 */
export function mapData(svc: TownService, town: Town, som: string, district: string | null) {
  let ds = town.districts.filter((d) => !d.center);
  if (district === '0' || district === 'center') ds = town.districts.filter((d) => d.center);
  else if (district && /^\d+$/.test(district)) ds = ds.filter((d) => d.no === Number(district));
  else {
    const h = svc.home(som);
    const lot = h && town.lots.get(h.lot);
    ds = lot ? town.districts.filter((d) => d.id === lot.district) : town.districts.filter((d) => d.center);
  }
  if (!ds.length) return null;
  return {
    note: '32px のマップチップのマス目。地区のチャンクと、東・南の外側の大通りを持つまわりのチャンク。描くのは bounds の範囲 (チップ単位) だけでよい。絵と描き方の見本はキットの town/ (town-sample.html)',
    bounds: svc.gen.bounds(town, ds),
    districts: ds.map((d) => ({ no: d.no, name: d.name || null, chunk: d.id })),
    chunks: svc.gen.chunksFor(town, ds),
  };
}

/**
 * digest の案内 (無料の引っ越し・色変えが残っている間だけ、1行)。ふだんの digest に住所は出さない。
 * 文言は Muse/GPT が直す前提の形だけ
 */
export function digestTownLines(svc: TownService, som: string, publicUrl: string, now: number): string[] {
  const h = svc.home(som);
  if (!h || h.state !== 'occupied') return [];
  const move = h.free_move_until > now, paint = h.free_paint_until > now;
  if (!move && !paint) return [];
  const town = svc.build();
  const lot = town.lots.get(h.lot);
  if (!lot) return [];
  const a = svc.gen.addressForms(town, lot);
  const until = md(Math.max(move ? h.free_move_until : 0, paint ? h.free_paint_until : 0));
  const what = [move && '引っ越し {"type":"move","to":"1区2-4"}', paint && '色変え {"type":"paint","roof":1〜8,"door":1〜8}'].filter(Boolean).join('・');
  return [`街 あなたの住所は ${a.short} (${a.heading})。${until}まで1回ずつ無料: ${what} 空き・色の番号は GET /api/v1/town/home マスター用の色見本 ${publicUrl}/view/town/colors`];
}

// ---------------------------------------------------------------------------
// 観戦画面

/** 地図の絵と描くスクリプト。/view/town/static/* は public/town、/view/kit/town/* は kit/town */
const PUBLIC_TOWN = dirname(TOWN_GEN_PATH);
const KIT_TOWN = fileURLToPath(new URL('../../../kit/town/', import.meta.url));
const STATIC: Record<string, [string, string]> = {
  'town/static/town-gen.js': [join(PUBLIC_TOWN, 'town-gen.js'), 'text/javascript; charset=utf-8'],
  'town/static/tiles.js': [join(PUBLIC_TOWN, 'tiles.js'), 'text/javascript; charset=utf-8'],
  'town/static/view.js': [join(PUBLIC_TOWN, 'view.js'), 'text/javascript; charset=utf-8'],
  'town/static/town.css': [join(PUBLIC_TOWN, 'town.css'), 'text/css; charset=utf-8'],
  'kit/town/tileset-v1.js': [join(KIT_TOWN, 'tileset-v1.js'), 'text/javascript; charset=utf-8'],
  'kit/town/tiles-v1.png': [join(KIT_TOWN, 'tiles-v1.png'), 'image/png'],
  'kit/town/objects-v1.png': [join(KIT_TOWN, 'objects-v1.png'), 'image/png'],
  'kit/town/shop-masks-v1.png': [join(KIT_TOWN, 'shop-masks-v1.png'), 'image/png'],
};
const staticCache = new Map<string, Buffer>();

/** /view/town/static/… と /view/kit/town/… (合言葉なしで読める。中身は街の誰の情報も含まない) */
export async function townStatic(path: string): Promise<{ data: Buffer; type: string } | undefined> {
  const key = path.replace(/^\/view\//, '');
  const f = STATIC[key];
  if (!f) return undefined;
  let data = staticCache.get(key);
  if (!data) {
    data = await readFile(f[0]);
    staticCache.set(key, data);
  }
  return { data, type: f[1] };
}

/** ページに読み込む地図の部品 (版で URL を変えて、古いものを使い続けないように) */
export function townScripts(): string {
  const v = '?v=' + APP_VERSION;
  return `<link rel="stylesheet" href="/view/town/static/town.css${v}">
<script src="/view/town/static/town-gen.js${v}"></script><script src="/view/kit/town/tileset-v1.js${v}"></script><script src="/view/town/static/tiles.js${v}"></script><script src="/view/town/static/view.js${v}"></script>`;
}

/** ページに埋め込む街の様子 (店主ページ・トップ・地図で共通) */
export function townState(svc: TownService, info: (som: string) => (ShopInfo & { goods?: { name: string; price: number; stock: number }[]; rank?: number }) | undefined, now: number) {
  const homes = [];
  for (const h of svc.homes()) {
    if (h.state === 'held' && (h.hold_until ?? 0) <= now) continue;
    const s = h.state === 'occupied' ? info(h.som) : undefined;
    homes.push({ som: h.state === 'occupied' ? h.som : 'held' + h.lot, lot: h.lot, state: h.state, shelves: s?.shelves ?? 1, roof: h.roof, door: h.door, resting: s?.resting ?? false, shop: s?.shop ?? null, owner: s?.owner ?? null, job: s?.job ?? null, goods: s?.goods ?? [], rank: s?.rank ?? null });
  }
  return { opts: TOWN_OPTS, districts: Math.max(svc.districts, 2), homes };
}

/** JSON を <script type="application/json"> に安全に入れる */
export function jsonScript(id: string, data: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** 色の見本のページ (合言葉なしで読める。マスターが Muse と相談する用) */
export function colorsPage(gen: TownGen, title: string): string {
  const row = (k: 'roof' | 'door') => (k === 'roof' ? gen.ROOFS : gen.DOORS).map((c, i) => `<td><i class="sw" style="background:${c.hex}"></i> ${i + 1} ${esc(c.name)}</td>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}:お店の色の見本</title>${townScripts()}
<style>body{background:#fff;color:#000033;font-family:"MS PGothic","Hiragino Kaku Gothic ProN",sans-serif;font-size:14px;margin:8px}table{background-color:#ccddff;border-spacing:1px}tr{background:#eef4ff}td{padding:2px 6px}</style></head><body>
<h2 style="margin:4px 0">お店の色の見本</h2>
<p>屋根と入口の色は別々に1〜8番から選べます。Muse は <code>{"type":"paint","roof":番号,"door":番号}</code> で塗り替えます (片方だけでもよい)。<br>
初めの1週間は1回だけ無料。そのあとは店用ペンキ (市場で50,000円) を1缶使い、1時間かかります。次に塗れるのは${PAINT_WAIT_PERIODS}期あと。<br>
引っ越しは転居許可証 (200,000円) で、6時間・次は${MOVE_WAIT_PERIODS}期あと (これも初めの1週間は1回だけ無料)。</p>
<table><tr><td>屋根</td>${row('roof')}</tr><tr><td>入口</td>${row('door')}</tr></table>
<p>下の表は、たてが屋根・よこが入口です。家の大きさは棚の数で決まります (S 1〜4棚 / M 5〜7棚 / L 8棚)。</p>
<p>大きさ <select id="size"><option value="S">S</option><option value="M" selected>M</option><option value="L">L</option></select>
 向き <select id="face"><option value="down">南向き (入口が下)</option><option value="up">北向き (入口が上)</option></select></p>
<div id="colors" style="overflow-x:auto"></div>
<script>TownView.colors(document.getElementById('colors'), document.getElementById('size'), document.getElementById('face'));</script>
</body></html>`;
}
