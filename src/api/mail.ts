// SOLD OUT for Muse — 店主の郵便箱 (1.0.0)。店主どうしの長めの手紙 (DM)。
// 原作の郵便 (商品・代金の送付) は使わず、相談・提案を個別に送るための場所として作り直したもの。
// 掲示板 = 街全体への呼びかけ、郵便箱 = 個別の相談、買い取り募集 = 実際の取引。
// 宛先・差出人は店主ID (som) で持つので、Party の人は建て直しても同じ郵便箱のまま。
// 送っても持ち時間は減らず、不在閉店も延びない (掲示板と同じ)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { Game } from '../engine/game.js';
import { GameError } from '../engine/game.js';
import type { Owner, Store } from '../store.js';

/** 件名・本文の長さ (文字) */
export const MAIL_SUBJECT_MAX = 40;
export const MAIL_BODY_MAX = 800;
/** 保存しない会話は、最後の手紙からこの秒数で消える */
export const MAIL_KEEP_SECONDS = 30 * 86400;
/** 保存 (keep) できる会話の数 (1人あたり) */
export const MAIL_KEEP_MAX = 20;
/** 送る上限: 24時間に送れる通数・新しい会話の数、続けて送るときの間隔 (秒) */
export const MAIL_PER_DAY = 30;
export const MAIL_NEW_PER_DAY = 10;
export const MAIL_INTERVAL = 20;
/** 受け取りを止められる相手の数 */
export const MAIL_BLOCK_MAX = 100;

export interface MailThread {
  id: number;
  subject: string;
  /** 始めた側と受けた側 */
  a_som: string;
  b_som: string;
  created_at: number;
  last_at: number;
}

export interface MailMessage {
  id: number;
  thread_id: number;
  from_som: string;
  to_som: string;
  /** 送ったときの店名 (相手が閉店・改名しても読めるように) */
  from_shop: string;
  time: number;
  body: string;
  read_at: number | null;
}

/** 件名の制御文字・改行を除く。本文は改行だけ残す */
function cleanSubject(s: unknown): string {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanBody(s: unknown): string {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}
const len = (s: string) => [...s].length;

export class MailBox {
  constructor(private readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, a_som TEXT NOT NULL, b_som TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mail_threads_a ON mail_threads(a_som, last_at);
      CREATE INDEX IF NOT EXISTS mail_threads_b ON mail_threads(b_som, last_at);
      CREATE INDEX IF NOT EXISTS mail_threads_last ON mail_threads(last_at);
      CREATE TABLE IF NOT EXISTS mail (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, from_som TEXT NOT NULL, to_som TEXT NOT NULL,
        from_shop TEXT NOT NULL, time INTEGER NOT NULL, body TEXT NOT NULL, read_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS mail_thread ON mail(thread_id, id);
      CREATE INDEX IF NOT EXISTS mail_to_unread ON mail(to_som, read_at);
      CREATE INDEX IF NOT EXISTS mail_from_time ON mail(from_som, time);
      CREATE TABLE IF NOT EXISTS mail_keeps (thread_id INTEGER NOT NULL, som TEXT NOT NULL, PRIMARY KEY (thread_id, som));
      CREATE TABLE IF NOT EXISTS mail_blocks (som TEXT NOT NULL, blocked TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (som, blocked));
    `);
  }

  private get db() {
    return this.store.db;
  }

  /** 期限切れの会話を消す (どちらかが保存していれば残す) */
  sweep(now: number): void {
    const old = 'SELECT id FROM mail_threads WHERE last_at < ? AND id NOT IN (SELECT thread_id FROM mail_keeps)';
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM mail WHERE thread_id IN (${old})`).run(now - MAIL_KEEP_SECONDS);
      this.db.prepare(`DELETE FROM mail_threads WHERE id IN (${old})`).run(now - MAIL_KEEP_SECONDS);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** 未読 (自分あて・まだ開いていない)。期限切れで消える前のものだけ数える (peek は消さずに読むだけなので) */
  unread(som: string, now: number): { count: number; latest: number; from: string[] } {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.from_shop FROM mail m JOIN mail_threads t ON t.id = m.thread_id
         WHERE m.to_som = ? AND m.read_at IS NULL
           AND (t.last_at >= ? OR t.id IN (SELECT thread_id FROM mail_keeps))
           AND m.from_som NOT IN (SELECT blocked FROM mail_blocks WHERE som = ?)
         ORDER BY m.id`,
      )
      .all(som, now - MAIL_KEEP_SECONDS, som) as { id: number; from_shop: string }[];
    const from = [...new Set(rows.map((r) => r.from_shop))];
    return { count: rows.length, latest: rows.length ? rows[rows.length - 1].id : 0, from };
  }

  /** 宛先を探す: som (som0003) / 営業中の店名 / 店主名 (1人に決まるときだけ) */
  resolve(g: Game, to: unknown): Owner {
    const key = String(to ?? '').trim();
    if (!key) throw new GameError('宛先 (to) に店主ID (som0003 など) か店名を入れてください');
    const open = (ow: Owner | undefined) => (ow && ow.shop_id !== null && g.shopById(ow.shop_id) ? ow : undefined);
    if (/^som\d+$/i.test(key)) {
      const ow = this.store.ownerBySom(key.toLowerCase());
      if (!ow) throw new GameError(`その店主ID (${key}) の店主はいません`);
      if (!open(ow)) throw new GameError(`${key} の店主は今お店を開いていません`);
      return ow;
    }
    const shop = g.shops.find((s) => s.shopname === key);
    if (shop) {
      const ow = this.store.ownerByShop(shop.id);
      if (ow) return ow;
    }
    const byName = this.store.ownersByName(key).filter((o) => open(o));
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) throw new GameError(`「${key}」という店主が${byName.length}人います。店主ID (${byName.map((o) => o.som).join(' / ')}) で指定してください`);
    throw new GameError(`「${key}」というお店・店主は見つかりません (GET /api/v1/owners で店主ID を確かめられます)`);
  }

  isBlocked(som: string, from: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM mail_blocks WHERE som = ? AND blocked = ?').get(som, from);
  }

  /** 送る上限 (連投・1日の通数・新しい会話の数) */
  private checkLimits(som: string, body: string, isNew: boolean, now: number): void {
    const last = this.db.prepare('SELECT time, body FROM mail WHERE from_som = ? ORDER BY id DESC LIMIT 1').get(som) as { time: number; body: string } | undefined;
    if (last && last.time > now - 15 * 60 && last.body === body) throw new GameError('同じ手紙を続けては送れません');
    if (last && now - last.time < MAIL_INTERVAL) throw new GameError(`続けて送るときは${MAIL_INTERVAL}秒あけてください。あと${MAIL_INTERVAL - (now - last.time)}秒`);
    const day = this.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE from_som = ? AND time > ?').get(som, now - 86400) as { n: number };
    if (day.n >= MAIL_PER_DAY) throw new GameError(`郵便は24時間に${MAIL_PER_DAY}通までです`);
    if (isNew) {
      const nw = this.db.prepare('SELECT COUNT(*) AS n FROM mail_threads WHERE a_som = ? AND created_at > ?').get(som, now - 86400) as { n: number };
      if (nw.n >= MAIL_NEW_PER_DAY) throw new GameError(`新しい郵便 (会話) は24時間に${MAIL_NEW_PER_DAY}件までです。返信は別に数えます`);
    }
  }

  private checkBody(raw: unknown): string {
    const body = cleanBody(raw);
    if (!body) throw new GameError('本文 (text) がありません');
    if (len(body) > MAIL_BODY_MAX) throw new GameError(`本文は${MAIL_BODY_MAX}文字までです (今${len(body)}文字)`);
    return body;
  }

  /** 新しい会話を始める */
  send(me: Owner, myShop: string, to: Owner, subjectRaw: unknown, bodyRaw: unknown, now: number): { thread: number; id: number } {
    if (to.som === me.som) throw new GameError('自分には送れません');
    const subject = cleanSubject(subjectRaw);
    if (!subject) throw new GameError('件名 (subject) がありません');
    if (len(subject) > MAIL_SUBJECT_MAX) throw new GameError(`件名は${MAIL_SUBJECT_MAX}文字までです (今${len(subject)}文字)`);
    const body = this.checkBody(bodyRaw);
    if (this.isBlocked(to.som, me.som)) throw new GameError('この相手には送れません');
    this.checkLimits(me.som, body, true, now);
    this.db.exec('BEGIN');
    try {
      const t = this.db.prepare('INSERT INTO mail_threads(subject,a_som,b_som,created_at,last_at) VALUES(?,?,?,?,?)').run(subject, me.som, to.som, now, now);
      const thread = Number(t.lastInsertRowid);
      const m = this.db.prepare('INSERT INTO mail(thread_id,from_som,to_som,from_shop,time,body) VALUES(?,?,?,?,?,?)').run(thread, me.som, to.som, myShop, now, body);
      this.db.exec('COMMIT');
      return { thread, id: Number(m.lastInsertRowid) };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** 会話 (自分が入っているものだけ) */
  thread(som: string, id: number, now: number): MailThread {
    const t = this.db.prepare('SELECT * FROM mail_threads WHERE id = ?').get(id) as MailThread | undefined;
    if (!t || (t.a_som !== som && t.b_som !== som) || (t.last_at < now - MAIL_KEEP_SECONDS && !this.keptBy(t.id).length)) {
      throw new GameError(`郵便 #${id} はありません (30日たって消えたか、番号違い)`);
    }
    return t;
  }

  /** 同じ会話に返信する */
  reply(me: Owner, myShop: string, threadId: number, bodyRaw: unknown, now: number, keep = false): { thread: number; id: number; to: string } {
    const t = this.thread(me.som, threadId, now);
    const to = t.a_som === me.som ? t.b_som : t.a_som;
    const body = this.checkBody(bodyRaw);
    if (this.isBlocked(to, me.som)) throw new GameError('この相手には送れません');
    this.checkLimits(me.som, body, false, now);
    // 返信と保存はいっしょに確定する (保存が上限で断られたら返信も送らない)
    if (keep) this.checkKeepRoom(me.som, t.id);
    this.db.exec('BEGIN');
    try {
      const m = this.db.prepare('INSERT INTO mail(thread_id,from_som,to_som,from_shop,time,body) VALUES(?,?,?,?,?,?)').run(t.id, me.som, to, myShop, now, body);
      this.db.prepare('UPDATE mail_threads SET last_at = ? WHERE id = ?').run(now, t.id);
      if (keep) this.db.prepare('INSERT OR IGNORE INTO mail_keeps(thread_id, som) VALUES(?,?)').run(t.id, me.som);
      this.db.exec('COMMIT');
      return { thread: t.id, id: Number(m.lastInsertRowid), to };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  messages(threadId: number): MailMessage[] {
    return this.db.prepare('SELECT * FROM mail WHERE thread_id = ? ORDER BY id').all(threadId) as unknown as MailMessage[];
  }

  /** 開いたら、自分あての手紙を既読にする */
  markRead(som: string, threadId: number, now: number): number {
    const r = this.db.prepare('UPDATE mail SET read_at = ? WHERE thread_id = ? AND to_som = ? AND read_at IS NULL').run(now, threadId, som);
    return Number(r.changes);
  }

  keptBy(threadId: number): string[] {
    return (this.db.prepare('SELECT som FROM mail_keeps WHERE thread_id = ?').all(threadId) as { som: string }[]).map((r) => r.som);
  }

  setKeep(som: string, threadId: number, on: boolean, now: number): void {
    this.thread(som, threadId, now);
    if (!on) {
      this.db.prepare('DELETE FROM mail_keeps WHERE thread_id = ? AND som = ?').run(threadId, som);
      return;
    }
    this.checkKeepRoom(som, threadId);
    this.db.prepare('INSERT OR IGNORE INTO mail_keeps(thread_id, som) VALUES(?,?)').run(threadId, som);
  }

  /** 保存の上限 (すでに保存している会話ならそのまま通す) */
  private checkKeepRoom(som: string, threadId: number): void {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM mail_keeps WHERE som = ?').get(som) as { n: number };
    if (n.n >= MAIL_KEEP_MAX && !this.keptBy(threadId).includes(som)) throw new GameError(`保存できる会話は${MAIL_KEEP_MAX}件までです。いらないものの保存を外してください`);
  }

  /** 自分が入っている会話 (新しい順)。止めた相手からの会話は出さない */
  list(som: string, now: number, limit: number) {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM mail m WHERE m.thread_id = t.id AND m.to_som = ? AND m.read_at IS NULL) AS unread,
                (SELECT COUNT(*) FROM mail m WHERE m.thread_id = t.id) AS count,
                EXISTS (SELECT 1 FROM mail_keeps k WHERE k.thread_id = t.id AND k.som = ?) AS kept_me,
                EXISTS (SELECT 1 FROM mail_keeps k WHERE k.thread_id = t.id) AS kept_any
         FROM mail_threads t
         WHERE (t.a_som = ? OR t.b_som = ?)
           AND (t.last_at >= ? OR t.id IN (SELECT thread_id FROM mail_keeps))
           AND (CASE WHEN t.a_som = ? THEN t.b_som ELSE t.a_som END) NOT IN (SELECT blocked FROM mail_blocks WHERE som = ?)
         ORDER BY t.last_at DESC, t.id DESC LIMIT ?`,
      )
      .all(som, som, som, som, now - MAIL_KEEP_SECONDS, som, som, limit) as unknown as (MailThread & { unread: number; count: number; kept_me: number; kept_any: number })[];
    return rows;
  }

  block(som: string, target: string, on: boolean, now: number): void {
    if (!on) {
      this.db.prepare('DELETE FROM mail_blocks WHERE som = ? AND blocked = ?').run(som, target);
      return;
    }
    if (target === som) throw new GameError('自分は止められません');
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM mail_blocks WHERE som = ?').get(som) as { n: number };
    if (n.n >= MAIL_BLOCK_MAX) throw new GameError(`受け取りを止められるのは${MAIL_BLOCK_MAX}人までです`);
    this.db.prepare('INSERT OR IGNORE INTO mail_blocks(som, blocked, created_at) VALUES(?,?,?)').run(som, target, now);
  }

  blocks(som: string): string[] {
    return (this.db.prepare('SELECT blocked FROM mail_blocks WHERE som = ? ORDER BY created_at').all(som) as { blocked: string }[]).map((r) => r.blocked);
  }
}

// ---------------------------------------------------------------------------
// 返事の形 (JSON と短いテキスト)

export interface MailPeer {
  som: string;
  name: string;
  shop: string | null;
}

export function peerOf(g: Game, store: Store, som: string): MailPeer {
  const ow = store.ownerBySom(som);
  const dt = ow && ow.shop_id !== null ? g.shopById(ow.shop_id) : undefined;
  return { som, name: ow?.display_name ?? '', shop: dt?.shopname ?? null };
}

const peerLabel = (p: MailPeer) => `${p.shop ?? '(閉店中)'} ${p.name ? `${p.name} ` : ''}${p.som}`;

export function mailListData(g: Game, box: MailBox, store: Store, som: string, now: number, limit: number) {
  const u = box.unread(som, now);
  const threads = box.list(som, now, limit).map((t) => {
    const other = t.a_som === som ? t.b_som : t.a_som;
    return {
      id: t.id,
      subject: t.subject,
      with: peerOf(g, store, other),
      started_by_me: t.a_som === som,
      count: t.count,
      unread: t.unread,
      last_at: t.last_at,
      kept: !!t.kept_me,
      /** どちらも保存していなければ、この時刻に消える */
      expires_at: t.kept_any ? null : t.last_at + MAIL_KEEP_SECONDS,
    };
  });
  return { unread: u.count, unread_from: u.from, threads };
}

export function mailListText(d: ReturnType<typeof mailListData>, jst: (t: number) => string): string {
  const lines = [`郵便箱 未読${d.unread}件` + (d.unread_from.length ? ` (差出人: ${d.unread_from.join(', ')})` : '')];
  for (const t of d.threads) {
    lines.push(
      `${t.unread ? '●' : '　'}#${t.id} ${t.subject} | ${peerLabel(t.with)} | ${t.count}通${t.unread ? ` うち未読${t.unread}` : ''} | 最後 ${jst(t.last_at)}` +
        (t.kept ? ' | 保存' : t.expires_at ? ` | ${jst(t.expires_at)}に消える` : ''),
    );
  }
  if (!d.threads.length) lines.push('郵便はありません');
  lines.push('読む: GET /api/v1/mail/番号 (開くと既読) / 新しく送る: POST /api/v1/mail {"to":"som0003 か店名","subject":"件名","text":"本文"}');
  return lines.join('\n') + '\n';
}

export function mailThreadData(g: Game, box: MailBox, store: Store, som: string, t: MailThread, newlyRead: number) {
  const other = t.a_som === som ? t.b_som : t.a_som;
  const kept = box.keptBy(t.id);
  return {
    id: t.id,
    subject: t.subject,
    with: peerOf(g, store, other),
    kept: kept.includes(som),
    expires_at: kept.length ? null : t.last_at + MAIL_KEEP_SECONDS,
    /** この GET で既読にした通数 */
    read_now: newlyRead,
    messages: box.messages(t.id).map((m) => ({ id: m.id, from: m.from_som, from_shop: m.from_shop, mine: m.from_som === som, time: m.time, text: m.body, read: m.read_at !== null })),
  };
}

export function mailThreadText(d: ReturnType<typeof mailThreadData>, jst: (t: number) => string): string {
  const lines = [`郵便 #${d.id} 件名: ${d.subject}`, `相手: ${peerLabel(d.with)}` + (d.kept ? ' | 保存中' : d.expires_at ? ` | ${jst(d.expires_at)}に消える (保存: POST /api/v1/mail/${d.id} {"keep":true})` : '')];
  for (const m of d.messages) {
    lines.push(`--- ${jst(m.time)} ${m.mine ? 'あなた' : m.from_shop}${m.mine ? (m.read ? ' (相手は読みました)' : ' (相手はまだ読んでいません)') : ''}`);
    lines.push(m.text);
  }
  lines.push('---', `返信: POST /api/v1/mail/${d.id} {"text":"本文"}`);
  return lines.join('\n') + '\n';
}
