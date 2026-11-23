// SOLD OUT for Muse — 保存 (SQLite)。原作の data.cgi / log-s*.cgi / bbslog / chatlog に相当する。
// 街の状態は 1 つの JSON として保存し、出来事・掲示板・井戸端は通し番号付きの表に追記する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { MAX_ITEM } from './data/catalog.js';
import { DEFAULT_CONFIG } from './config.js';
import { newWorld, type LogEntry, type World } from './engine/types.js';
import type { PeriodPriceRow } from './engine/prices.js';
import { splitJob } from './engine/jobs.js';
import { isTownEpoch, townPeriodAt } from './town-calendar.js';

const TOWN_EPOCH_SETTING = 'town_epoch';

export interface StoredLog extends LogEntry {
  id: number;
}

/** 目安箱の案 */
export interface Suggestion {
  id: number;
  time: number;
  shop_id: number;
  shopname: string;
  /** feature=追加実装 / bug=不具合 / balance=調整 / other=その他 */
  category: string;
  text: string;
  /** open=未読 / seen=読んだ / accepted=採用 / done=実装済み / rejected=見送り */
  status: string;
  reply: string;
  updated_at: number;
}

export const SUGGESTION_STATUS = ['open', 'seen', 'accepted', 'done', 'rejected'] as const;
export const SUGGESTION_CATEGORY = ['feature', 'bug', 'balance', 'other'] as const;

/** 店主 (人ごと)。som は表向きの番号で、閉店・建て直しでも変わらない */
export interface Owner {
  som: string;
  num: number;
  party_owner_id: string | null;
  /** 今の店 (閉店中は null) */
  shop_id: number | null;
  display_name: string;
  /** party = Party の名前を写す / local = SOLD OUT で決める (Party を通さない店) */
  name_source: string;
  icon_file: string | null;
  card_file: string | null;
  /** Muse が書いた分 (通り名・枠・alt) と、描いたときの値 (drawn) */
  card_json: string | null;
  rev: number;
  /** som を渡した時刻 = 許可年月日 */
  created_at: number;
  updated_at: number;
}

export interface StoredAsset {
  seq: number;
  file: string;
  som: string;
  kind: 'icon' | 'card';
  w: number;
  h: number;
  bytes: number;
  created_at: number;
  replaced_at: number | null;
  removed_at: number | null;
}

/** 'som0001'。1万人目からは自然に5桁 */
export function somId(num: number): string {
  return 'som' + String(num).padStart(4, '0');
}

/** 掲示板・井戸端の書き込み */
export interface BoardPost {
  id: number;
  board: 'bbs' | 'chat';
  time: number;
  shop_id: number;
  shopname: string;
  msg: string;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newToken(prefix: string): string {
  return prefix + randomBytes(24).toString('base64url');
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, saved_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (
        token_hash TEXT PRIMARY KEY, shop_id INTEGER NOT NULL, hint TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tokens_shop ON tokens(shop_id);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, mode INTEGER NOT NULL,
        from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, msg TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS logs_from ON logs(from_id, id);
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, time INTEGER NOT NULL,
        shop_id INTEGER NOT NULL, shopname TEXT NOT NULL, msg TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS posts_board ON posts(board, id);
      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, shop_id INTEGER NOT NULL, shopname TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', reply TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS suggestions_shop ON suggestions(shop_id, id);
      CREATE TABLE IF NOT EXISTS party_links (
        owner_id TEXT PRIMARY KEY, shop_id INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS view_links (
        key_hash TEXT PRIMARY KEY, shop_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, kind TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS owners (
        som TEXT PRIMARY KEY, num INTEGER NOT NULL UNIQUE, party_owner_id TEXT UNIQUE, shop_id INTEGER,
        display_name TEXT NOT NULL DEFAULT '', name_source TEXT NOT NULL DEFAULT 'local',
        icon_file TEXT, card_file TEXT, card_json TEXT, rev INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS owners_shop ON owners(shop_id);
      CREATE INDEX IF NOT EXISTS owners_rev ON owners(rev);
      CREATE TABLE IF NOT EXISTS owner_tax_totals (
        som TEXT PRIMARY KEY REFERENCES owners(som),
        sales INTEGER NOT NULL CHECK (typeof(sales) = 'integer'),
        deposit INTEGER NOT NULL CHECK (typeof(deposit) = 'integer')
      );
      CREATE TABLE IF NOT EXISTS assets (
        seq INTEGER PRIMARY KEY, file TEXT NOT NULL UNIQUE, som TEXT NOT NULL, kind TEXT NOT NULL,
        w INTEGER NOT NULL, h INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
        replaced_at INTEGER, replaced_seq INTEGER, removed_at INTEGER, removed_seq INTEGER
      );
      CREATE INDEX IF NOT EXISTS assets_som ON assets(som);
      CREATE INDEX IF NOT EXISTS assets_removed_seq ON assets(removed_seq);
      CREATE INDEX IF NOT EXISTS assets_replaced_seq ON assets(replaced_seq);
      CREATE TABLE IF NOT EXISTS market_history (
        at INTEGER NOT NULL, item INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (item, at)
      );
      CREATE INDEX IF NOT EXISTS market_history_at ON market_history(at);
    `);
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string | undefined): void {
    if (value === undefined) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  townEpoch(): number | null {
    const start = Number(this.getSetting(TOWN_EPOCH_SETTING));
    return isTownEpoch(start, DEFAULT_CONFIG) ? start : null;
  }

  setTownEpoch(start: number, onlyIfUnset = false): void {
    if (!isTownEpoch(start, DEFAULT_CONFIG)) throw new Error('第1期の開始には決算境界のUnix秒を指定してください');
    if (onlyIfUnset) {
      this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
        .run(TOWN_EPOCH_SETTING, String(start));
    } else {
      this.setSetting(TOWN_EPOCH_SETTING, String(start));
    }
  }

  townPeriod(now: number): ReturnType<typeof townPeriodAt> {
    return townPeriodAt(this.townEpoch(), now, DEFAULT_CONFIG);
  }

  taxTrackingStartedAt(): number | null {
    const row = this.db.prepare("SELECT json_extract(json, '$.taxTrackingStartedAt') AS started FROM world WHERE id = 1")
      .get() as { started: number | null } | undefined;
    return row?.started ?? null;
  }

  /** 街の保存と同じトランザクション (saveWorld の extra) で、閉店の後処理より前に呼ぶ */
  addTaxTotals(deltas: ReadonlyMap<number, { sales: bigint; deposit: bigint }>): void {
    const add = this.db.prepare(`
      INSERT INTO owner_tax_totals (som, sales, deposit)
      SELECT som, ?, ? FROM owners WHERE shop_id = ?
      ON CONFLICT(som) DO UPDATE SET sales = sales + excluded.sales, deposit = deposit + excluded.deposit
    `);
    for (const [shopId, { sales, deposit }] of deltas) {
      if (add.run(sales, deposit, shopId).changes !== 1) {
        throw new Error(`納税を記録する店主を特定できません (店id: ${shopId})`);
      }
    }
  }

  /** 既知のsomなら、納税履歴のない店主や閉店済みの店主も取得できる */
  ownerTaxTotals(som: string): { sales: bigint; deposit: bigint; total: bigint } | undefined {
    const get = this.db.prepare(`
      SELECT COALESCE(t.sales, 0) AS sales, COALESCE(t.deposit, 0) AS deposit
      FROM owners o LEFT JOIN owner_tax_totals t ON t.som = o.som WHERE o.som = ?
    `);
    get.setReadBigInts(true);
    const row = get.get(som) as { sales: bigint; deposit: bigint } | undefined;
    return row && { ...row, total: row.sales + row.deposit };
  }

  loadWorld(now: number): World {
    const row = this.db.prepare('SELECT json FROM world WHERE id = 1').get() as { json: string } | undefined;
    if (!row) return newWorld(now, MAX_ITEM);
    const w = JSON.parse(row.json) as World;
    // 商品が増えた場合に備えて配列の長さを合わせる
    while (w.wholestore.length < MAX_ITEM) w.wholestore.push(0);
    for (const s of w.shops) {
      while (s.item.length < MAX_ITEM) s.item.push(0);
      s.status = 1;
      // 1.3.0 道具屋・武器屋・防具屋・山師を13職の職コードに分ける (熟練のいちばん高い本・地図の職へ。ボーナスは同じ)
      splitJob(s);
    }
    return w;
  }

  /** 街の状態と、このリクエストで増えた出来事をまとめて保存する */
  saveWorld(w: World, newLogs: LogEntry[], now: number, logKeepSeconds: number, extra?: () => void): void {
    const json = JSON.stringify({ ...w, shops: w.shops.filter((s) => s.status) }, (k, v) =>
      k === 'point' || k === 'status' ? undefined : v,
    );
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO world(id,json,saved_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, saved_at=excluded.saved_at').run(json, now);
      const ins = this.db.prepare('INSERT INTO logs(time,mode,from_id,to_id,msg) VALUES(?,?,?,?,?)');
      for (const l of newLogs) ins.run(l.time, l.mode, l.from, l.to, l.msg);
      if (newLogs.length) this.db.prepare('DELETE FROM logs WHERE time < ?').run(now - logKeepSeconds);
      // 街と同じときに確定させたいもの (開店のトークン・Party のつながりなど)
      extra?.();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * 決算ごとの値動き (engine/prices.ts) を書き、新しいほうから keep 期ぶんだけ残す。
   * 街の保存と同じトランザクションの中で呼ぶ (saveWorld の extra)
   */
  addPriceRows(rows: PeriodPriceRow[], keep: number): void {
    if (!rows.length) return;
    const ins = this.db.prepare('INSERT OR REPLACE INTO market_history(at,item,json) VALUES(?,?,?)');
    for (const r of rows) ins.run(r.at, r.item, JSON.stringify(r));
    this.db
      .prepare('DELETE FROM market_history WHERE at < (SELECT MIN(at) FROM (SELECT DISTINCT at FROM market_history ORDER BY at DESC LIMIT ?))')
      .run(keep);
  }

  /** 1品の値動き。新しい順に n 期ぶん */
  priceHistory(item: number, n: number): PeriodPriceRow[] {
    const rows = this.db.prepare('SELECT json FROM market_history WHERE item = ? ORDER BY at DESC LIMIT ?').all(item, n) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as PeriodPriceRow);
  }

  /** いちばん新しい決算の記録 (品番 → 行)。まだ無ければ空 */
  lastPeriodPrices(): Map<number, PeriodPriceRow> {
    const rows = this.db.prepare('SELECT json FROM market_history WHERE at = (SELECT MAX(at) FROM market_history)').all() as { json: string }[];
    return new Map(rows.map((r) => {
      const row = JSON.parse(r.json) as PeriodPriceRow;
      return [row.item, row];
    }));
  }

  /**
   * 最近の出来事。原作 ReadLog と同じく「その店の記録 (from=店id)」と「街全体 (from=0)」を返す。
   * scope='me' なら店の記録だけ、'town' なら街全体だけ。新しい順。
   */
  readLogs(shopId: number, opts: { since?: number; limit: number; scope?: 'me' | 'town' | 'all'; mode?: number; prefix?: string; fromTime?: number; contains?: string[] }): StoredLog[] {
    const where: string[] = ['id > ?'];
    const args: (number | string)[] = [opts.since ?? 0];
    const scope = opts.scope ?? 'all';
    if (scope === 'me') { where.push('from_id = ?'); args.push(shopId); }
    else if (scope === 'town') where.push('from_id = 0');
    else { where.push('(from_id = ? OR from_id = 0)'); args.push(shopId); }
    if (opts.mode !== undefined) { where.push('mode = ?'); args.push(opts.mode); }
    if (opts.fromTime !== undefined) { where.push('time >= ?'); args.push(opts.fromTime); }
    if (opts.prefix !== undefined) { where.push("substr(msg, 1, ?) = ?"); args.push(opts.prefix.length, opts.prefix); }
    // どれかの文字列を含む (instr は LIKE と違って % _ を特別扱いしない)
    if (opts.contains?.length) { where.push('(' + opts.contains.map(() => 'instr(msg, ?) > 0').join(' OR ') + ')'); args.push(...opts.contains); }
    args.push(opts.limit);
    const rows = this.db
      .prepare(`SELECT id,time,mode,from_id,to_id,msg FROM logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...args) as { id: number; time: number; mode: number; from_id: number; to_id: number; msg: string }[];
    return rows.map((r) => ({ id: r.id, time: r.time, mode: r.mode, from: r.from_id, to: r.to_id, msg: r.msg }));
  }

  /**
   * 未読の出来事を古い順に limit 件。自分の記録と街の記録で既読の位置が別 (sinceMe / sinceTown)。
   * 古い順に取るので、返した最後の id までは (その scope の) 全部を返したことになり、既読の位置をそこまで進められる (監査 A07)
   */
  readUnreadLogs(shopId: number, sinceMe: number, sinceTown: number, scope: 'me' | 'town' | 'all', limit: number): StoredLog[] {
    const where = scope === 'me' ? 'from_id = ? AND id > ?' : scope === 'town' ? 'from_id = 0 AND id > ?' : '((from_id = ? AND id > ?) OR (from_id = 0 AND id > ?))';
    const args = scope === 'me' ? [shopId, sinceMe] : scope === 'town' ? [sinceTown] : [shopId, sinceMe, sinceTown];
    const rows = this.db
      .prepare(`SELECT id,time,mode,from_id,to_id,msg FROM logs WHERE ${where} ORDER BY id ASC LIMIT ?`)
      .all(...args, limit) as { id: number; time: number; mode: number; from_id: number; to_id: number; msg: string }[];
    return rows.map((r) => ({ id: r.id, time: r.time, mode: r.mode, from: r.from_id, to: r.to_id, msg: r.msg }));
  }

  lastLogId(shopId: number): number {
    const row = this.db.prepare('SELECT MAX(id) AS m FROM logs WHERE from_id = ? OR from_id = 0').get(shopId) as { m: number | null };
    return row.m ?? 0;
  }

  countLogsSince(shopId: number, since: number, scope: 'me' | 'town'): number {
    const sql = scope === 'me'
      ? 'SELECT COUNT(*) AS c FROM logs WHERE id > ? AND from_id = ?'
      : 'SELECT COUNT(*) AS c FROM logs WHERE id > ? AND from_id = 0';
    const row = (scope === 'me' ? this.db.prepare(sql).get(since, shopId) : this.db.prepare(sql).get(since)) as { c: number };
    return row.c;
  }

  // ---- トークン ----

  addToken(shopId: number, token: string, now: number): void {
    this.db.prepare('INSERT INTO tokens(token_hash,shop_id,hint,created_at) VALUES(?,?,?,?)').run(sha256(token), shopId, token.slice(0, 8), now);
  }

  shopIdByToken(token: string): number | undefined {
    const row = this.db.prepare('SELECT shop_id FROM tokens WHERE token_hash = ?').get(sha256(token)) as { shop_id: number } | undefined;
    return row?.shop_id;
  }

  /** 店のトークンを1本に差し替える (前のものは全部消す)。1つのトランザクションで */
  replaceTokens(shopId: number, token: string, now: number): void {
    this.db.exec('BEGIN');
    try {
      this.deleteTokensOf(shopId);
      this.addToken(shopId, token, now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  deleteTokensOf(shopId: number): void {
    this.db.prepare('DELETE FROM tokens WHERE shop_id = ?').run(shopId);
  }

  // ---- 目安箱 ----

  addSuggestion(shopId: number, shopname: string, category: string, text: string, now: number): number {
    const r = this.db
      .prepare('INSERT INTO suggestions(time,shop_id,shopname,category,text,updated_at) VALUES(?,?,?,?,?,?)')
      .run(now, shopId, shopname, category, text, now);
    return Number(r.lastInsertRowid);
  }

  countSuggestionsSince(shopId: number, since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM suggestions WHERE shop_id = ? AND time >= ?').get(shopId, since) as { c: number }).c;
  }

  suggestionsOf(shopId: number, limit: number): Suggestion[] {
    return this.db.prepare('SELECT * FROM suggestions WHERE shop_id = ? ORDER BY id DESC LIMIT ?').all(shopId, limit) as unknown as Suggestion[];
  }

  /** 返事や状態が、seen より後に変わった自分の案の数 */
  countSuggestionUpdates(shopId: number, seen: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM suggestions WHERE shop_id = ? AND updated_at > ? AND updated_at > time').get(shopId, seen) as { c: number }).c;
  }

  listSuggestions(opts: { status?: string; category?: string; since?: number; limit: number }): Suggestion[] {
    const where = ['id > ?'];
    const args: (string | number)[] = [opts.since ?? 0];
    if (opts.status && opts.status !== 'all') { where.push('status = ?'); args.push(opts.status); }
    if (opts.category) { where.push('category = ?'); args.push(opts.category); }
    args.push(opts.limit);
    return this.db.prepare(`SELECT * FROM suggestions WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ?`).all(...args) as unknown as Suggestion[];
  }

  /** 未対応 (open) の案の数・そのうちの不具合の数・いちばん新しい案 (件数に上限なし) */
  openSuggestionSummary(): { open: number; bugs: number; latest: Suggestion | undefined } {
    const c = this.db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN category = 'bug' THEN 1 ELSE 0 END) AS b FROM suggestions WHERE status = 'open'").get() as { n: number; b: number | null };
    const latest = this.db.prepare("SELECT * FROM suggestions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as unknown as Suggestion | undefined;
    return { open: c.n, bugs: c.b ?? 0, latest };
  }

  getSuggestion(id: number): Suggestion | undefined {
    return this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as unknown as Suggestion | undefined;
  }

  updateSuggestion(id: number, status: string, reply: string, now: number): void {
    this.db.prepare('UPDATE suggestions SET status = ?, reply = ?, updated_at = ? WHERE id = ?').run(status, reply, now, id);
  }

  countSuggestionsByStatus(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS c FROM suggestions GROUP BY status').all() as { status: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.c]));
  }

  // ---- Muse Party の人 (owner_id) とお店の対応 ----

  shopIdByPartyOwner(ownerId: string): number | undefined {
    const row = this.db.prepare('SELECT shop_id FROM party_links WHERE owner_id = ?').get(ownerId) as { shop_id: number } | undefined;
    return row?.shop_id;
  }

  linkPartyOwner(ownerId: string, shopId: number, now: number): void {
    this.db.prepare('INSERT INTO party_links(owner_id,shop_id,created_at) VALUES(?,?,?)').run(ownerId, shopId, now);
  }

  partyOwnerOfShop(shopId: number): string | undefined {
    const row = this.db.prepare('SELECT owner_id FROM party_links WHERE shop_id = ?').get(shopId) as { owner_id: string } | undefined;
    return row?.owner_id;
  }

  /** 店の固定合鍵 (vk_) を確かめる。期限のある見学用リンクは使わない */
  shopIdByFixedViewKey(key: string): number | undefined {
    const row = this.db.prepare("SELECT shop_id FROM view_links WHERE key_hash = ? AND kind = 'fixed'").get(sha256(key)) as { shop_id: number } | undefined;
    return row?.shop_id;
  }

  /** Muse Party でつながった店か */
  isPartyShop(shopId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM party_links WHERE shop_id = ? LIMIT 1').get(shopId);
  }

  unlinkPartyShop(shopId: number): void {
    this.db.prepare('DELETE FROM party_links WHERE shop_id = ?').run(shopId);
  }

  // ---- 店主 (som ID・店主名・アイコン・許可証)。人ごとに1行で、閉店・建て直しでも残る ----

  /** 店主の公開情報が変わるたびに進める通し番号 (GET /owners?since_rev= のため) */
  private nextRev(): number {
    const n = Number(this.getSetting('owners_rev') ?? 0) + 1;
    this.setSetting('owners_rev', String(n));
    return n;
  }

  ownersRev(): number {
    return Number(this.getSetting('owners_rev') ?? 0);
  }

  /** 新しい som を渡す。番号は通し (欠番も再利用しない) */
  createOwner(o: { partyOwnerId?: string; shopId: number | null; name: string; nameSource: 'party' | 'local'; now: number }): Owner {
    const row = this.db.prepare('SELECT MAX(num) AS m FROM owners').get() as { m: number | null };
    const num = (row.m ?? 0) + 1;
    const som = somId(num);
    this.db
      .prepare('INSERT INTO owners(som,num,party_owner_id,shop_id,display_name,name_source,rev,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(som, num, o.partyOwnerId ?? null, o.shopId, o.name, o.nameSource, this.nextRev(), o.now, o.now);
    return this.ownerBySom(som)!;
  }

  ownerBySom(som: string): Owner | undefined {
    return this.db.prepare('SELECT * FROM owners WHERE som = ?').get(som) as Owner | undefined;
  }

  ownerByShop(shopId: number): Owner | undefined {
    return this.db.prepare('SELECT * FROM owners WHERE shop_id = ?').get(shopId) as Owner | undefined;
  }

  ownerByParty(ownerId: string): Owner | undefined {
    return this.db.prepare('SELECT * FROM owners WHERE party_owner_id = ?').get(ownerId) as Owner | undefined;
  }

  ownersByName(name: string): Owner[] {
    return this.db.prepare('SELECT * FROM owners WHERE display_name = ? ORDER BY num').all(name) as unknown as Owner[];
  }

  /** 公開情報が since より後に変わった店主 (since=0 なら全員) */
  ownersSince(since: number): Owner[] {
    return this.db.prepare('SELECT * FROM owners WHERE rev > ? ORDER BY num').all(since) as unknown as Owner[];
  }

  /** 店主の欄を書き換えて rev を進める */
  /** 中身は owners の外 (店名など) で変わったとき、差分に出すため rev だけ進める */
  touchOwner(som: string, now: number): void {
    this.db.prepare('UPDATE owners SET rev = ?, updated_at = ? WHERE som = ?').run(this.nextRev(), now, som);
  }

  updateOwner(som: string, f: Partial<Pick<Owner, 'shop_id' | 'display_name' | 'name_source' | 'icon_file' | 'card_file' | 'card_json'>>, now: number): void {
    const keys = Object.keys(f) as (keyof typeof f)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE owners SET ${sets}, rev = ?, updated_at = ? WHERE som = ?`).run(...keys.map((k) => f[k] ?? null), this.nextRev(), now, som);
  }

  // ---- 画像 (アイコン・許可証)。ファイル名は不変。差し替えた古いものは後で消す ----

  /** その店主の次の画像の番号 (som ごとに 1 から。消した番号も使い回さない) */
  nextAssetNo(som: string): number {
    // 取り消した予約があっても戻らないよう、行の数ではなく店主ごとの数え上げで配る
    const key = 'asset_no_' + som;
    const used = Number(this.getSetting(key) ?? 0);
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM assets WHERE som = ?').get(som) as { c: number };
    const n = Math.max(used, row.c) + 1;
    this.setSetting(key, String(n));
    return n;
  }

  /** 追加と削除で共通の通し番号 (差分のカーソル)。どちらも必ずこれまでより大きい番号になる */
  private nextAssetSeq(): number {
    const n = this.assetsCursor() + 1;
    this.setSetting('assets_seq', String(n));
    return n;
  }

  addAsset(a: { file: string; som: string; kind: 'icon' | 'card'; w: number; h: number; bytes: number; now: number }): number {
    const seq = this.nextAssetSeq();
    this.db.prepare('INSERT INTO assets(seq,file,som,kind,w,h,bytes,created_at) VALUES(?,?,?,?,?,?,?,?)').run(seq, a.file, a.som, a.kind, a.w, a.h, a.bytes, a.now);
    return seq;
  }

  /** 使い終わった印を付ける (すぐには消さない。消すのは sweepAssets) */
  markAssetReplaced(file: string, now: number): void {
    // 差分のカーソルも進める (外した・差し替えた時点で、スペースは店主の今の画像を読み直す。ファイルを消すのは1日後)
    if (this.db.prepare('SELECT 1 FROM assets WHERE file = ? AND replaced_at IS NULL').get(file)) {
      this.db.prepare('UPDATE assets SET replaced_at = ?, replaced_seq = ? WHERE file = ?').run(now, this.nextAssetSeq(), file);
    }
  }

  /** since の後に「使い終わった」印が付いた画像の持ち主 */
  assetsReplacedSince(since: number): string[] {
    return (this.db.prepare('SELECT DISTINCT som FROM assets WHERE replaced_seq > ?').all(since) as { som: string }[]).map((r) => r.som);
  }

  /** 差し替えから keep 秒たったもの (と運営が下げたもの) を消した扱いにして、消すファイル名を返す */
  sweepAssets(now: number, keep: number): string[] {
    const rows = this.db.prepare('SELECT file FROM assets WHERE removed_at IS NULL AND replaced_at IS NOT NULL AND replaced_at <= ?').all(now - keep) as { file: string }[];
    for (const r of rows) this.removeAsset(r.file, now);
    return rows.map((r) => r.file);
  }

  /** 消した扱いにする。差分一覧に「消えた」と出すため、そのときの通し番号を removed_seq に入れる */
  removeAsset(file: string, now: number): void {
    const row = this.assetByFile(file);
    if (!row || row.removed_at !== null) return;
    this.db.prepare('UPDATE assets SET removed_at = ?, removed_seq = ? WHERE file = ?').run(now, this.nextAssetSeq(), file);
  }

  /** 差分のカーソル (追加・削除のどちらでも進む) */
  assetsCursor(): number {
    return Number(this.getSetting('assets_seq') ?? 0);
  }

  assetsAddedSince(since: number): StoredAsset[] {
    return this.db.prepare('SELECT * FROM assets WHERE seq > ? AND removed_at IS NULL ORDER BY seq').all(since) as unknown as StoredAsset[];
  }

  assetsRemovedSince(since: number): string[] {
    return (this.db.prepare('SELECT file FROM assets WHERE removed_seq > ? AND seq <= ? ORDER BY removed_seq').all(since, since) as { file: string }[]).map((r) => r.file);
  }

  assetByFile(file: string): StoredAsset | undefined {
    return this.db.prepare('SELECT * FROM assets WHERE file = ?').get(file) as StoredAsset | undefined;
  }

  /** 運営向け: 最近の画像 */
  recentAssets(limit: number): StoredAsset[] {
    return this.db.prepare('SELECT * FROM assets ORDER BY seq DESC LIMIT ?').all(limit) as unknown as StoredAsset[];
  }

  /** その店主が今日 (since 以降) 上げた数 */
  countAssetsSince(som: string, kind: string, since: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM assets WHERE som = ? AND kind = ? AND created_at >= ?').get(som, kind, since) as { c: number };
    return row.c;
  }

  // ---- 見学用リンク (人間が店長室を見るための鍵) ----

  addViewKey(shopId: number, key: string, expiresAt: number, kind: 'link' | 'fixed'): void {
    if (kind === 'fixed') this.db.prepare("DELETE FROM view_links WHERE shop_id = ? AND kind = 'fixed'").run(shopId);
    this.db.prepare('INSERT INTO view_links(key_hash,shop_id,expires_at,kind) VALUES(?,?,?,?)').run(sha256(key), shopId, expiresAt, kind);
  }

  /**
   * 見学用の鍵を確かめる。期限切れはここで消す。
   * 30分のリンクも期限内なら何度でも開ける (チャットアプリのリンクプレビューが先に開いても、本人が開けるように)
   */
  takeViewKey(key: string, now: number): number | undefined {
    const h = sha256(key);
    const row = this.db.prepare('SELECT shop_id, expires_at, kind FROM view_links WHERE key_hash = ?').get(h) as
      | { shop_id: number; expires_at: number; kind: string }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < now) {
      this.db.prepare('DELETE FROM view_links WHERE key_hash = ?').run(h);
      return undefined;
    }
    return row.shop_id;
  }

  deleteViewKeysOf(shopId: number): void {
    this.db.prepare('DELETE FROM view_links WHERE shop_id = ?').run(shopId);
  }

  // ---- 掲示板・井戸端 ----

  addPost(p: Omit<BoardPost, 'id'>, keep: number): number {
    const r = this.db.prepare('INSERT INTO posts(board,time,shop_id,shopname,msg) VALUES(?,?,?,?,?)').run(p.board, p.time, p.shop_id, p.shopname, p.msg);
    // 原作と同じく、掲示板は最新 keep 件だけ残す
    this.db.prepare('DELETE FROM posts WHERE board = ? AND id <= (SELECT id FROM posts WHERE board = ? ORDER BY id DESC LIMIT 1 OFFSET ?)').run(p.board, p.board, keep);
    return Number(r.lastInsertRowid);
  }

  readPosts(board: 'bbs' | 'chat', since: number, limit: number): BoardPost[] {
    return this.db
      .prepare('SELECT id,board,time,shop_id,shopname,msg FROM posts WHERE board = ? AND id > ? ORDER BY id DESC LIMIT ?')
      .all(board, since, limit) as unknown as BoardPost[];
  }

  /** since より後の書き込みを古い順に limit 件 (未読を取りこぼさずに既読を進めるため。監査 A07) */
  readPostsAfter(board: 'bbs' | 'chat', since: number, limit: number): BoardPost[] {
    return this.db
      .prepare('SELECT id,board,time,shop_id,shopname,msg FROM posts WHERE board = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(board, since, limit) as unknown as BoardPost[];
  }

  lastPostId(board: 'bbs' | 'chat'): number {
    const row = this.db.prepare('SELECT MAX(id) AS m FROM posts WHERE board = ?').get(board) as { m: number | null };
    return row.m ?? 0;
  }
}
