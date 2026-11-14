// SOLD OUT for Muse — 保存 (SQLite)。原作の data.cgi / log-s*.cgi / bbslog / chatlog に相当する。
// 街の状態は 1 つの JSON として保存し、出来事・掲示板・井戸端は通し番号付きの表に追記する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { MAX_ITEM } from './data/catalog.js';
import { newWorld, type LogEntry, type World } from './engine/types.js';

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

  loadWorld(now: number): World {
    const row = this.db.prepare('SELECT json FROM world WHERE id = 1').get() as { json: string } | undefined;
    if (!row) return newWorld(now, MAX_ITEM);
    const w = JSON.parse(row.json) as World;
    // 商品が増えた場合に備えて配列の長さを合わせる
    while (w.wholestore.length < MAX_ITEM) w.wholestore.push(0);
    for (const s of w.shops) {
      while (s.item.length < MAX_ITEM) s.item.push(0);
      s.status = 1;
    }
    return w;
  }

  /** 街の状態と、このリクエストで増えた出来事をまとめて保存する */
  saveWorld(w: World, newLogs: LogEntry[], now: number, logKeepSeconds: number): void {
    const json = JSON.stringify({ ...w, shops: w.shops.filter((s) => s.status) }, (k, v) =>
      k === 'point' || k === 'status' ? undefined : v,
    );
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO world(id,json,saved_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, saved_at=excluded.saved_at').run(json, now);
      const ins = this.db.prepare('INSERT INTO logs(time,mode,from_id,to_id,msg) VALUES(?,?,?,?,?)');
      for (const l of newLogs) ins.run(l.time, l.mode, l.from, l.to, l.msg);
      if (newLogs.length) this.db.prepare('DELETE FROM logs WHERE time < ?').run(now - logKeepSeconds);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * 最近の出来事。原作 ReadLog と同じく「その店の記録 (from=店id)」と「街全体 (from=0)」を返す。
   * scope='me' なら店の記録だけ、'town' なら街全体だけ。新しい順。
   */
  readLogs(shopId: number, opts: { since?: number; limit: number; scope?: 'me' | 'town' | 'all'; mode?: number }): StoredLog[] {
    const where: string[] = ['id > ?'];
    const args: (number | string)[] = [opts.since ?? 0];
    const scope = opts.scope ?? 'all';
    if (scope === 'me') { where.push('from_id = ?'); args.push(shopId); }
    else if (scope === 'town') where.push('from_id = 0');
    else { where.push('(from_id = ? OR from_id = 0)'); args.push(shopId); }
    if (opts.mode !== undefined) { where.push('mode = ?'); args.push(opts.mode); }
    args.push(opts.limit);
    const rows = this.db
      .prepare(`SELECT id,time,mode,from_id,to_id,msg FROM logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...args) as { id: number; time: number; mode: number; from_id: number; to_id: number; msg: string }[];
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

  /** Muse Party でつながった店か */
  isPartyShop(shopId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM party_links WHERE shop_id = ? LIMIT 1').get(shopId);
  }

  unlinkPartyShop(shopId: number): void {
    this.db.prepare('DELETE FROM party_links WHERE shop_id = ?').run(shopId);
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

  lastPostId(board: 'bbs' | 'chat'): number {
    const row = this.db.prepare('SELECT MAX(id) AS m FROM posts WHERE board = ?').get(board) as { m: number | null };
    return row.m ?? 0;
  }
}
