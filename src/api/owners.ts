// SOLD OUT for Muse — 店主 (som ID・店主名)・アイコン・出店許可証 (0.5.0 で追加)。
// 画面 (スペース・許可証フォーム) は Muse が作る。サーバーは画像の検品・保管・配信と、そのための JSON を出すだけ (案: リカさんより)。
// 画像のファイル名は不変 (som0001_000001.webp)。同じ名前の中身は変えないので、ずっとキャッシュしてよい。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game } from '../engine/game.js';
import { GameError } from '../engine/game.js';
import type { Shop, World } from '../engine/types.js';
import type { Owner, Store } from '../store.js';
import { sjisLength } from '../engine/actions.js';
import { inspectWebp, WebpError } from './webp.js';
import { jobName, pct, shelfData, specialtyType } from './views.js';
import { CATALOG } from '../data/catalog.js';

/** アイコンの大きさ (正方形) と容量の上限 */
export const ICON_SIZE = 200;
export const ICON_MAX_BYTES = 150 * 1024;
/** 許可証の容量の上限 (大きさは枠と同じ) */
export const CARD_MAX_BYTES = 1536 * 1024;
/** 1日 (24時間) に上げられる回数 (アイコン・許可証それぞれ) */
export const UPLOADS_PER_DAY = 5;
/** 差し替えた古い画像を消すまでの秒数 (見ている途中の人の画像が切れないよう、少しだけ残す) */
export const REPLACED_KEEP = 24 * 3600;
/** 既定の枠 */
export const DEFAULT_FRAME = 'license-03';

export interface Frame {
  frame: string;
  file: string;
  size: [number, number];
  photo: { x: number; y: number; w: number; h: number };
  rows: { field: string; label: string; x: number; y: number; w: number; h: number; max_lines?: number }[];
  [k: string]: unknown;
}

export interface AkaEntry {
  where: string;
  id?: string;
  name?: string;
  label?: string;
}

/** 許可証の、Muse が書く分 (保存する形) */
interface CardStored {
  frame: string;
  aka: AkaEntry[];
  alt: string;
  /** 描いたときの値 (今の値と違えば「描き直すとよい」) */
  drawn: { owner_name: string; shopname: string | null; job: string; at: number };
}

export interface OwnerHubOptions {
  /** 画像の保存先 (無ければ画像の登録はできない) */
  assetsDir?: string;
  /** 画像の公開URLの頭 (末尾の / なし) */
  assetsBaseUrl: string;
  /** 枠とキットのフォルダ (kit/) */
  kitDir?: string;
}

/** 日本時間の日付 '2026-11-07' */
export function jstDate(t: number): string {
  const d = new Date((t + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 掲示板と同じく、URL や制御文字の混じった文字は断る */
function cleanText(v: unknown, what: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new GameError(`${what}がありません`);
    return '';
  }
  if (typeof v !== 'string') throw new GameError(`${what}は文字で書いてください`);
  const s = v.trim();
  if (required && !s) throw new GameError(`${what}がありません`);
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new GameError(`${what}に改行や制御文字は使えません`);
  if (/https?:\/\/|www\./i.test(s)) throw new GameError(`${what}に URL は書けません`);
  if ([...s].length > max) throw new GameError(`${what}は${max}字までです`);
  return s;
}

export function parseAka(v: unknown): AkaEntry[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new GameError('aka (通り名) は配列で送ってください');
  if (v.length > 20) throw new GameError('通り名は20件までです');
  return v.map((x, i) => {
    if (!x || typeof x !== 'object') throw new GameError(`通り名の${i + 1}件目が {"where":…} の形になっていません`);
    const o = x as Record<string, unknown>;
    const e: AkaEntry = { where: cleanText(o.where, `通り名${i + 1}件目の where`, 32, true) };
    const id = cleanText(o.id, `通り名${i + 1}件目の id`, 32);
    const name = cleanText(o.name, `通り名${i + 1}件目の name`, 32);
    const label = cleanText(o.label, `通り名${i + 1}件目の label`, 12);
    if (!id && !name) throw new GameError(`通り名の${i + 1}件目には id か name のどちらかが要ります`);
    if (id) e.id = id;
    if (name) e.name = name;
    if (label) e.label = label;
    return e;
  });
}

export class OwnerHub {
  readonly frames = new Map<string, Frame>();
  private kitFiles = new Map<string, Buffer>();

  constructor(
    private readonly store: Store,
    readonly o: OwnerHubOptions,
  ) {
    if (o.assetsDir) mkdirSync(o.assetsDir, { recursive: true });
    if (o.kitDir && existsSync(join(o.kitDir, 'frames'))) {
      for (const f of readdirSync(join(o.kitDir, 'frames'))) {
        if (!f.endsWith('.json')) continue;
        const fr = JSON.parse(readFileSync(join(o.kitDir, 'frames', f), 'utf8')) as Frame;
        this.frames.set(fr.frame, fr);
      }
    }
  }

  get uploadsEnabled(): boolean {
    return !!this.o.assetsDir;
  }

  url(file: string | null): string | null {
    return file ? `${this.o.assetsBaseUrl}/${file}` : null;
  }

  // ---------------------------------------------------------------------------
  // 店主の行

  /** 開店したとき。Party の人は前の som を引き継ぐ (閉店して建て直しても変わらない) */
  onOpen(shop: Shop, partyOwnerId: string | undefined, partyName: string | undefined, now: number): Owner {
    const had = partyOwnerId ? this.store.ownerByParty(partyOwnerId) : undefined;
    if (had) {
      const f: Parameters<Store['updateOwner']>[1] = { shop_id: shop.id };
      if (partyName && partyName !== had.display_name) f.display_name = partyName;
      this.store.updateOwner(had.som, f, now);
      return this.store.ownerBySom(had.som)!;
    }
    return this.store.createOwner({
      partyOwnerId,
      shopId: shop.id,
      name: partyName || shop.name,
      nameSource: partyOwnerId ? 'party' : 'local',
      now,
    });
  }

  /** 今いる店で店主の行が無いもの (0.5.0 より前の店) に、開店日の古い順で som を渡す */
  migrate(world: World, partyOf: (shopId: number) => string | undefined, now: number): number {
    const missing = world.shops.filter((s) => !this.store.ownerByShop(s.id)).sort((a, b) => a.foundation - b.foundation || a.id - b.id);
    for (const s of missing) {
      const party = partyOf(s.id);
      const had = party ? this.store.ownerByParty(party) : undefined;
      if (had) this.store.updateOwner(had.som, { shop_id: s.id }, now);
      // 許可年月日は開店日にする (0.5.0 より前の店は「初めて開店した日」が分からないので、今の店の開店日)
      else this.store.createOwner({ partyOwnerId: party, shopId: s.id, name: s.name, nameSource: party ? 'party' : 'local', now: s.foundation });
    }
    return missing.length;
  }

  /** Party の名前が変わっていたら写す (Party のトークンを確かめたついで) */
  syncPartyName(shopId: number, name: string, now: number): void {
    if (!name) return;
    const ow = this.store.ownerByShop(shopId);
    if (ow && ow.name_source === 'party' && ow.display_name !== name) this.store.updateOwner(ow.som, { display_name: name }, now);
  }

  onClosed(shopId: number, now: number): void {
    const ow = this.store.ownerByShop(shopId);
    if (ow) this.store.updateOwner(ow.som, { shop_id: null }, now);
  }

  ownerOf(shopId: number): Owner {
    const ow = this.store.ownerByShop(shopId);
    if (!ow) throw new GameError('店主の登録がまだありません (少し待ってからもう一度)');
    return ow;
  }

  // ---------------------------------------------------------------------------
  // 許可証の値

  /** サーバーが入れる5項目 (今の値) */
  serverValues(g: Game, ow: Owner) {
    const dt = ow.shop_id !== null ? g.shopById(ow.shop_id) : undefined;
    return {
      license_no: ow.som,
      owner_name: ow.display_name,
      shopname: dt ? dt.shopname : null,
      job: dt ? jobName(dt) || '不定' : '',
      licensed_on: jstDate(ow.created_at),
    };
  }

  private stored(ow: Owner): CardStored | undefined {
    return ow.card_json ? (JSON.parse(ow.card_json) as CardStored) : undefined;
  }

  /** 許可証の JSON (読む Muse 向け。画像を取らなくても中身が分かる) */
  cardData(g: Game, ow: Owner) {
    const st = this.stored(ow);
    if (!st) return null;
    const now = this.serverValues(g, ow);
    const stale = st.drawn.owner_name !== now.owner_name || st.drawn.shopname !== now.shopname || st.drawn.job !== now.job;
    return { v: 1, ...now, aka: st.aka, frame: st.frame, alt: st.alt, file: ow.card_file, url: this.url(ow.card_file), drawn: st.drawn, stale };
  }

  /** 許可証メーカーに渡す下書き (サーバーが入れる5項目＋今の通り名) */
  draft(g: Game, ow: Owner) {
    const st = this.stored(ow);
    const fr = this.frames.get(st?.frame ?? DEFAULT_FRAME) ?? this.frames.get(DEFAULT_FRAME);
    return {
      card: { v: 1, ...this.serverValues(g, ow), aka: st?.aka ?? [], frame: fr?.frame ?? DEFAULT_FRAME, alt: st?.alt ?? '' },
      frame: fr ?? null,
      icon_size: [ICON_SIZE, ICON_SIZE],
    };
  }

  // ---------------------------------------------------------------------------
  // 画像の受け取り

  private checkQuota(som: string, kind: 'icon' | 'card', now: number): void {
    if (this.store.countAssetsSince(som, kind, now - 86400) >= UPLOADS_PER_DAY) {
      throw new GameError(`${kind === 'icon' ? 'アイコン' : '許可証'}の登録は24時間に${UPLOADS_PER_DAY}回までです。作り直しは手元で済ませてから送ってください`);
    }
  }

  private async save(som: string, kind: 'icon' | 'card', data: Buffer, w: number, h: number, now: number): Promise<string> {
    if (!this.o.assetsDir) throw new GameError('画像の保存先が設定されていないので、今は登録できません');
    const no = this.store.nextAssetNo(som);
    const file = `${som}_${String(no).padStart(6, '0')}.webp`;
    const path = join(this.o.assetsDir, file);
    // 途中まで書いたファイルが配られないよう、一時ファイルに書いてから名前を変える
    await writeFile(path + '.tmp', data);
    await rename(path + '.tmp', path);
    this.store.addAsset({ file, som, kind, w, h, bytes: data.length, now });
    return file;
  }

  private decode(b64: unknown, max: number): Buffer {
    if (typeof b64 !== 'string' || !b64) throw new GameError('image_base64 (webp を base64 にしたもの) がありません');
    const s = b64.replace(/^data:image\/webp;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) throw new GameError('image_base64 が base64 になっていません');
    const buf = Buffer.from(s, s.includes('-') || s.includes('_') ? 'base64url' : 'base64');
    if (buf.length > max) throw new GameError(`画像が大きすぎます (${Math.ceil(buf.length / 1024)}KB。上限 ${Math.floor(max / 1024)}KB)`);
    return buf;
  }

  private inspect(buf: Buffer, w: number, h: number, what: string) {
    let info;
    try {
      info = inspectWebp(buf);
    } catch (e) {
      if (e instanceof WebpError) throw new GameError(`${what}: ${e.message}`);
      throw e;
    }
    if (info.width !== w || info.height !== h) {
      throw new GameError(`${what}は ${w}×${h} の webp にしてください (送られたのは ${info.width}×${info.height})`);
    }
    return info;
  }

  async uploadIcon(ow: Owner, body: Record<string, unknown>, now: number): Promise<string> {
    this.checkQuota(ow.som, 'icon', now);
    const info = this.inspect(this.decode(body.image_base64, ICON_MAX_BYTES), ICON_SIZE, ICON_SIZE, 'アイコン');
    const file = await this.save(ow.som, 'icon', info.data, ICON_SIZE, ICON_SIZE, now);
    if (ow.icon_file) this.store.markAssetReplaced(ow.icon_file, now);
    this.store.updateOwner(ow.som, { icon_file: file }, now);
    return file;
  }

  /** 許可証。画像があれば差し替え、無ければ通り名などの文字だけ直す */
  async uploadCard(g: Game, ow: Owner, body: Record<string, unknown>, now: number): Promise<string | null> {
    const prev = this.stored(ow);
    const frameId = body.frame === undefined ? prev?.frame ?? DEFAULT_FRAME : String(body.frame);
    const fr = this.frames.get(frameId);
    if (!fr) throw new GameError(`枠「${frameId}」はありません。GET /api/v1/card/frames で一覧を見られます`);
    const aka = body.aka === undefined ? prev?.aka ?? [] : parseAka(body.aka);
    const alt = body.alt === undefined ? prev?.alt ?? '' : cleanText(body.alt, 'alt (見た目の説明)', 120);
    const values = this.serverValues(g, ow);
    let file = ow.card_file;
    let drawn = prev?.drawn;
    if (body.image_base64 !== undefined) {
      this.checkQuota(ow.som, 'card', now);
      const [w, h] = fr.size;
      const info = this.inspect(this.decode(body.image_base64, CARD_MAX_BYTES), w, h, '許可証');
      file = await this.save(ow.som, 'card', info.data, w, h, now);
      if (ow.card_file) this.store.markAssetReplaced(ow.card_file, now);
      drawn = { owner_name: values.owner_name, shopname: values.shopname, job: values.job, at: now };
    } else if (!ow.card_file) {
      throw new GameError('はじめは画像 (image_base64) も一緒に送ってください');
    }
    const st: CardStored = { frame: fr.frame, aka, alt, drawn: drawn! };
    this.store.updateOwner(ow.som, { card_file: file, card_json: JSON.stringify(st) }, now);
    return file;
  }

  removeIcon(ow: Owner, now: number): void {
    if (!ow.icon_file) return;
    this.store.markAssetReplaced(ow.icon_file, now);
    this.store.updateOwner(ow.som, { icon_file: null }, now);
  }

  removeCard(ow: Owner, now: number): void {
    if (!ow.card_file && !ow.card_json) return;
    if (ow.card_file) this.store.markAssetReplaced(ow.card_file, now);
    this.store.updateOwner(ow.som, { card_file: null, card_json: null }, now);
  }

  /** 使い終わった画像を消す (差し替えから REPLACED_KEEP 秒) */
  async sweep(now: number): Promise<number> {
    const files = this.store.sweepAssets(now, REPLACED_KEEP);
    for (const f of files) await this.unlinkFile(f);
    return files.length;
  }

  /** 運営が下げる。すぐ消す */
  async takeDown(file: string, now: number): Promise<boolean> {
    const a = this.store.assetByFile(file);
    if (!a || a.removed_at !== null) return false;
    const ow = this.store.ownerBySom(a.som);
    if (ow?.icon_file === file) this.store.updateOwner(ow.som, { icon_file: null }, now);
    if (ow?.card_file === file) this.store.updateOwner(ow.som, { card_file: null, card_json: null }, now);
    this.store.removeAsset(file, now);
    await this.unlinkFile(file);
    return true;
  }

  private async unlinkFile(file: string): Promise<void> {
    if (!this.o.assetsDir) return;
    await unlink(join(this.o.assetsDir, file)).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // 一覧・1人ぶん・差分

  /** 店の一覧 (ランキングと他店を合体し、店主とアイコンを付けたもの)。順位順 */
  townData(g: Game) {
    return g.shops.map((s, i) => {
      const ow = this.store.ownerByShop(s.id);
      const sp = specialtyType(g, s);
      return {
        rank: i + 1,
        id: s.id,
        som: ow?.som ?? null,
        owner_name: ow?.display_name ?? s.name,
        icon: ow?.icon_file ?? null,
        card: ow?.card_file ?? null,
        shop: s.shopname,
        job: jobName(s),
        specialty: sp ? CATALOG.itemTypes[sp] : '',
        point: s.point,
        popularity: pct(s.rank),
        yesterday: s.rankingyesterday,
        wins: s.rankingcount,
        comment: s.comment,
        shelves: shelfData(g, s).filter((x) => x.item && x.stock),
      };
    });
  }

  /** 公開情報が since_rev より後に変わった店主 (閉店中の人も入る) */
  ownersSince(g: Game, since: number) {
    return {
      rev: this.store.ownersRev(),
      base: this.o.assetsBaseUrl + '/',
      owners: this.store.ownersSince(since).map((ow) => this.ownerSummary(g, ow)),
    };
  }

  ownerSummary(g: Game, ow: Owner) {
    const dt = ow.shop_id !== null ? g.shopById(ow.shop_id) : undefined;
    return {
      som: ow.som,
      owner_name: ow.display_name,
      shop: dt?.shopname ?? null,
      rank: dt ? g.shopIndex(dt.id) + 1 : null,
      icon: ow.icon_file,
      card: ow.card_file,
      rev: ow.rev,
    };
  }

  ownerDetail(g: Game, ow: Owner) {
    const dt = ow.shop_id !== null ? g.shopById(ow.shop_id) : undefined;
    return {
      som: ow.som,
      owner_name: ow.display_name,
      licensed_on: jstDate(ow.created_at),
      shop: dt
        ? {
            id: dt.id,
            shopname: dt.shopname,
            job: jobName(dt) || '不定',
            rank: g.shopIndex(dt.id) + 1,
            point: dt.point,
            popularity: pct(dt.rank),
            comment: dt.comment,
            shelves: shelfData(g, dt).filter((x) => x.item && x.stock),
          }
        : null,
      icon: ow.icon_file ? { file: ow.icon_file, url: this.url(ow.icon_file) } : null,
      card: this.cardData(g, ow),
      rev: ow.rev,
    };
  }

  /** 画像の差分。since の後に増えた・消えたファイルと、今それぞれが使っている画像 */
  assetsDiff(since: number) {
    const added = this.store.assetsAddedSince(since);
    const removed = since ? this.store.assetsRemovedSince(since) : [];
    const touched = new Set([...added.map((a) => a.som)]);
    for (const f of removed) touched.add(f.slice(0, f.indexOf('_')));
    const current: Record<string, { icon: string | null; card: string | null }> = {};
    const list = since ? [...touched].map((s) => this.store.ownerBySom(s)).filter((x): x is Owner => !!x) : this.store.ownersSince(0);
    for (const ow of list) current[ow.som] = { icon: ow.icon_file, card: ow.card_file };
    return {
      cursor: this.store.assetsCursor(),
      base: this.o.assetsBaseUrl + '/',
      added: added.map((a) => ({ file: a.file, som: a.som, kind: a.kind, bytes: a.bytes })),
      removed,
      current,
    };
  }

  /** 画像を配る (assetsDir の直下の som…webp と、kit/ の下) */
  async readAsset(name: string): Promise<{ data: Buffer; type: string } | undefined> {
    if (/^som\d{4,}_\d{6}\.webp$/.test(name)) {
      if (!this.o.assetsDir) return undefined;
      const a = this.store.assetByFile(name);
      if (!a || a.removed_at !== null) return undefined;
      const data = await readFile(join(this.o.assetsDir, name)).catch(() => undefined);
      return data && { data, type: 'image/webp' };
    }
    const m = /^kit\/((?:frames\/)?[\w.-]+\.(webp|json|zip|py|js|md|txt|ttf))$/.exec(name);
    if (!m || m[1].includes('..')) return undefined;
    let data = this.kitFiles.get(m[1]);
    if (!data) {
      // キットの zip はフォントを入れて VM で作るので assetsDir/kit に置く。枠などは kit/ (リポジトリ) から
      const dirs = [this.o.assetsDir && join(this.o.assetsDir, 'kit'), this.o.kitDir].filter((x): x is string => !!x);
      for (const d of dirs) {
        data = await readFile(join(d, m[1])).catch(() => undefined);
        if (data) break;
      }
      if (!data) return undefined;
      if (data.length < 4 * 1024 * 1024) this.kitFiles.set(m[1], data);
    }
    const type = { webp: 'image/webp', json: 'application/json; charset=utf-8', zip: 'application/zip', py: 'text/plain; charset=utf-8', js: 'text/javascript; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', ttf: 'font/ttf' }[m[2]]!;
    return { data, type };
  }

  framesData() {
    return {
      default: DEFAULT_FRAME,
      base: this.o.assetsBaseUrl + '/kit/frames/',
      frames: [...this.frames.values()],
      icon_size: [ICON_SIZE, ICON_SIZE],
      kit: this.o.assetsBaseUrl + '/kit/' + KIT_ZIP,
      // スペースのブラウザから直接読む用 (build-kit.sh が ASSETS_ROOT/kit に置く)
      font: this.o.assetsBaseUrl + '/kit/ShipporiMinchoB1-ExtraBold.ttf',
      script: this.o.assetsBaseUrl + '/kit/license.js',
      readme: this.o.assetsBaseUrl + '/kit/README.md',
    };
  }
}

/** キットの zip の名前 (版を入れて不変にする) */
export const KIT_ZIP = 'soldout-kit-0.5.0.zip';

/** 名前の決まり (Party と同じ: 1〜20字、空白と @ # / \ < > は不可) */
export function checkOwnerName(name: unknown): string {
  if (typeof name !== 'string' || !/^[^\s@#/\\<>]{1,20}$/u.test(name)) {
    throw new GameError('店主名は1〜20字で、空白と @ # / \\ < > は使えません');
  }
  if (sjisLength(name) > 40) throw new GameError('店主名が長すぎます');
  return name;
}
