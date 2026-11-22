// SOLD OUT for Muse — 街の地図と住所 (1.2.0)。
// 1店1区画 (192px)。住所は店主 (som) につく。閉店すると空き家として猶予を残し、猶予中に開き直せば同じ区画に戻る。
// 区画の並び・地区の形は public/town/town-gen.js (観戦画面と共用) が種と地区数だけで決める。
// 保存するのは「どの som がどの区画にいるか」と色・券・次に使えるまでの時刻だけ (town_homes)。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { Store } from '../store.js';
import { GameError } from '../engine/game.js';
import { townGen, type HomeInput, type Lot, type Town, type TownGen } from './gen.js';

/** 本番の街の形。種は固定 (変えると全員の区画の形が変わる) */
export const TOWN_OPTS = { seed: 20261122, center: 'public', names: 'a' } as const;
/** 閉店してから空き家として区画を残す日数 */
export const HOLD_DAYS = 14;
/** 街ができたとき・初めて店を開いたときの、無料の引っ越し・色変えの期限 (日) */
export const FREE_DAYS = 7;
/** 店用ペンキ・転居許可証の品番 */
export const PAINT_ITEM = 133;
export const MOVE_ITEM = 134;
/** 使う時間 (秒) */
export const PAINT_TIME = 3600;
export const MOVE_TIME = 6 * 3600;
/** 次に使えるまでの期数 */
export const PAINT_WAIT_PERIODS = 1;
export const MOVE_WAIT_PERIODS = 6;

export interface HomeRow {
  som: string;
  lot: number;
  state: 'occupied' | 'held';
  since: number;
  hold_until: number | null;
  roof: number | null;
  door: number | null;
  free_move_until: number;
  free_paint_until: number;
  move_ready_at: number;
  paint_ready_at: number;
}

/** 店の今の様子 (描くときと JSON に入れるもの)。App が店と店主から作る */
export interface ShopInfo {
  shelves: number;
  resting: boolean;
  shop: string;
  owner: string;
  job: string;
}

const COLS = 'som, lot, state, since, hold_until, roof, door, free_move_until, free_paint_until, move_ready_at, paint_ready_at';

export class TownService {
  readonly gen: TownGen;

  constructor(
    private readonly store: Store,
    /** 1期の秒数 (次に使えるまでの計算) */
    private readonly periodSeconds: number,
    gen?: TownGen,
  ) {
    this.gen = gen ?? townGen();
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS town_homes (
        som TEXT PRIMARY KEY,
        lot INTEGER NOT NULL UNIQUE,
        state TEXT NOT NULL,
        since INTEGER NOT NULL,
        hold_until INTEGER,
        roof INTEGER,
        door INTEGER,
        free_move_until INTEGER NOT NULL DEFAULT 0,
        free_paint_until INTEGER NOT NULL DEFAULT 0,
        move_ready_at INTEGER NOT NULL DEFAULT 0,
        paint_ready_at INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // 保存

  /** 開いている地区の数 (中央の2つを含む)。0 なら街はまだ無い */
  get districts(): number {
    return Number(this.store.getSetting('town_districts') ?? 0);
  }

  private setDistricts(n: number): void {
    if (n !== this.districts) this.store.setSetting('town_districts', String(n));
  }

  homes(): HomeRow[] {
    return this.store.db.prepare(`SELECT ${COLS} FROM town_homes ORDER BY lot`).all() as unknown as HomeRow[];
  }

  home(som: string): HomeRow | undefined {
    return this.store.db.prepare(`SELECT ${COLS} FROM town_homes WHERE som = ?`).get(som) as unknown as HomeRow | undefined;
  }

  private insertHome(h: HomeRow): void {
    this.store.db
      .prepare(`INSERT INTO town_homes (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(h.som, h.lot, h.state, h.since, h.hold_until, h.roof, h.door, h.free_move_until, h.free_paint_until, h.move_ready_at, h.paint_ready_at);
  }

  /** ブロック (郵便の受け取り拒否) の組。どちら向きでも隣・向かいにしない */
  blocks(): Set<string> {
    try {
      const rows = this.store.db.prepare('SELECT som, blocked FROM mail_blocks').all() as { som: string; blocked: string }[];
      return new Set(rows.map((r) => r.som + '>' + r.blocked));
    } catch {
      return new Set();
    }
  }

  // ---------------------------------------------------------------------------
  // 街の組み立て

  /** 保存してある街を組み立てる。info を渡すと店の大きさ・名前も入る (描画・まわり用) */
  build(info?: (som: string) => ShopInfo | undefined, now?: number): Town {
    const homes: HomeInput[] = [];
    for (const h of this.homes()) {
      // 猶予切れの空き家は NPC の家に戻ったものとして扱う (行は次に書くときに消す)
      if (h.state === 'held' && now !== undefined && (h.hold_until ?? 0) <= now) continue;
      const s = info?.(h.som);
      homes.push({ som: h.som, lot: h.lot, state: h.state, shelves: s?.shelves ?? 1, roof: h.roof, door: h.door, resting: s?.resting ?? false, hold_until: h.hold_until, shop: s?.shop ?? null, owner: s?.owner ?? null, job: s?.job ?? null });
    }
    return this.gen.restoreTown({ ...TOWN_OPTS }, Math.max(this.districts, 2), homes);
  }

  /** 猶予の切れた空き家を消す (NPC の家に戻す) */
  expire(now: number): number {
    return Number(this.store.db.prepare("DELETE FROM town_homes WHERE state = 'held' AND hold_until <= ?").run(now).changes);
  }

  /**
   * 街を初めて作る: 今いる店をまとめて置く (ブロックを避けてランダム、各地区8割まで)。
   * もう街があれば何もしない。全員に1週間の無料の引っ越し・色変えを付ける
   */
  init(soms: string[], now: number): number {
    if (this.districts) return 0;
    const town = this.gen.createTown({ ...TOWN_OPTS });
    this.gen.openDistrict(town);
    this.gen.openDistrict(town);
    const list = [...new Set(soms)].sort().map((som) => ({ som, size: 'S', wishes: [] as string[] }));
    if (list.length) this.gen.placeInitial(town, list, this.blocks());
    const free = now + FREE_DAYS * 86400;
    this.store.db.exec('BEGIN');
    try {
      for (const s of list) {
        const lot = town.shops.get(s.som)?.lot;
        if (!lot) throw new Error('初めの配置で区画が決まらない店があります: ' + s.som);
        this.insertHome({ som: s.som, lot, state: 'occupied', since: now, hold_until: null, roof: null, door: null, free_move_until: free, free_paint_until: free, move_ready_at: 0, paint_ready_at: 0 });
      }
      this.setDistricts(town.districts.length);
      this.store.db.exec('COMMIT');
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
    return list.length;
  }

  /**
   * 開店したとき (開店と同じトランザクションの中で呼ぶ)。猶予中の空き家があればそこへ戻る。
   * 新しい店は空いている区画へ (空きが少なければ地区を開く)。初めての店には1週間の無料券
   */
  onOpen(som: string, now: number): Lot | undefined {
    if (!this.districts) return undefined;
    this.expire(now);
    const had = this.home(som);
    if (had) {
      if (had.state === 'held') this.store.db.prepare("UPDATE town_homes SET state = 'occupied', hold_until = NULL WHERE som = ?").run(som);
      return this.build().lots.get(had.lot);
    }
    const town = this.build(undefined, now);
    const lot = this.gen.addShop(town, { som, size: 'S', wishes: [] }, this.blocks());
    const free = now + FREE_DAYS * 86400;
    this.insertHome({ som, lot: lot.id, state: 'occupied', since: now, hold_until: null, roof: null, door: null, free_move_until: free, free_paint_until: free, move_ready_at: 0, paint_ready_at: 0 });
    this.setDistricts(town.districts.length);
    return lot;
  }

  /** 閉店したとき: 区画は空き家として猶予を残す */
  onClosed(som: string, now: number): void {
    this.store.db.prepare("UPDATE town_homes SET state = 'held', hold_until = ? WHERE som = ? AND state = 'occupied'").run(now + HOLD_DAYS * 86400, som);
  }

  // ---------------------------------------------------------------------------
  // 引っ越し・色変え (行動。確かめる側と書く側を分け、書くのは街の保存と同じトランザクション)

  /** 引っ越し先を確かめる。to は "1区2-4" / "第1区2丁目4番地" か区画の番号 */
  checkMove(som: string, to: string, now: number): { lot: Lot; free: boolean; from: Lot } {
    const h = this.mine(som);
    const free = h.free_move_until > now;
    if (!free && h.move_ready_at > now) throw new GameError(`次に引っ越せるのは ${fmt(h.move_ready_at)} からです`);
    const town = this.build(undefined, now);
    const lot = /^\d+$/.test(to.trim()) ? town.lots.get(Number(to)) ?? null : this.gen.lotByAddress(town, to);
    if (!lot || lot.kind !== 'shop') throw new GameError(`「${to}」という住所の区画はありません (例 "1区2-4"。空きは GET /api/v1/town/around?scope=district)`);
    if (lot.id === h.lot) throw new GameError('今の住所と同じです');
    if (lot.reserved) throw new GameError('その区画は予約されています');
    if (lot.state === 'held') throw new GameError('その区画は空き家 (閉店した店の猶予中) なので入れません');
    if (lot.state !== 'vacant') throw new GameError('その区画にはもうお店があります');
    // ブロックの相手の隣・向かいは「予約」として静かに断る
    if (this.gen.conflicts(town, lot, som, this.blocks())) throw new GameError('その区画は予約されています');
    return { lot, free, from: town.lots.get(h.lot)! };
  }

  /** 引っ越しを書く (街の保存の中で) */
  writeMove(som: string, lot: number, free: boolean, now: number): void {
    this.expire(now);
    const set = free ? 'free_move_until = 0' : `move_ready_at = ${now + MOVE_WAIT_PERIODS * this.periodSeconds}`;
    this.store.db.prepare(`UPDATE town_homes SET lot = ?, since = ?, ${set} WHERE som = ?`).run(lot, now, som);
  }

  /** 色を確かめる。roof/door は 1〜8 (null は今のまま) */
  checkPaint(som: string, roof: number | null, door: number | null, now: number): { free: boolean; roof: number; door: number } {
    const h = this.mine(som);
    if (roof === null && door === null) throw new GameError('roof (屋根) か door (入口) を 1〜8 で指定してください。見本は GET /api/v1/town/colors');
    for (const [k, v] of [['roof', roof], ['door', door]] as const) {
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 8)) throw new GameError(`${k} は 1〜8 で指定してください`);
    }
    const free = h.free_paint_until > now;
    if (!free && h.paint_ready_at > now) throw new GameError(`次に色を変えられるのは ${fmt(h.paint_ready_at)} からです`);
    const cur = this.gen.homeColors(som, h.roof, h.door);
    const next = { roof: roof ?? cur.roof, door: door ?? cur.door };
    if (next.roof === cur.roof && next.door === cur.door) throw new GameError('今と同じ色です');
    return { free, ...next };
  }

  writePaint(som: string, roof: number, door: number, free: boolean, now: number): void {
    const set = free ? 'free_paint_until = 0' : `paint_ready_at = ${now + PAINT_WAIT_PERIODS * this.periodSeconds}`;
    this.store.db.prepare(`UPDATE town_homes SET roof = ?, door = ?, ${set} WHERE som = ?`).run(roof, door, som);
  }

  private mine(som: string): HomeRow {
    const h = this.home(som);
    if (!h || h.state !== 'occupied') throw new GameError('まだ街に住所がありません (少し待ってからもう一度)');
    return h;
  }

  // ---------------------------------------------------------------------------
  // 読む

  /** 自分の住所・色・券 (GET /api/v1/town/home) */
  homeData(town: Town, som: string, now: number) {
    const h = this.home(som);
    const lot = h && town.lots.get(h.lot);
    if (!h || !lot) return null;
    const a = this.gen.addressForms(town, lot);
    const c = this.gen.homeColors(som, h.roof, h.door);
    const d = town.districts.find((x) => x.id === lot.district)!;
    const nb = (id: number | null | undefined) => (id ? this.lotBrief(town, town.lots.get(id)!) : null);
    return {
      address: a.short,
      address_long: a.long,
      district: { no: d.no, name: d.name || null, heading: a.heading },
      street: d.alleys[lot.row < 2 ? 0 : 1]?.name ?? null,
      lot: a.data,
      home_size: lot.size,
      colors: { roof: { no: c.roof, name: this.gen.ROOFS[c.roof - 1].name }, door: { no: c.door, name: this.gen.DOORS[c.door - 1].name }, chosen: h.roof !== null || h.door !== null },
      neighbors: { left: nb(lot.links?.left), right: nb(lot.links?.right), front: nb(lot.links?.front) },
      free_move_until: h.free_move_until > now ? h.free_move_until : null,
      free_paint_until: h.free_paint_until > now ? h.free_paint_until : null,
      move_ready_at: h.move_ready_at > now ? h.move_ready_at : null,
      paint_ready_at: h.paint_ready_at > now ? h.paint_ready_at : null,
    };
  }

  /** 区画1つの短い説明 (まわり・お隣) */
  lotBrief(town: Town, l: Lot) {
    const s = l.holder && l.state !== 'vacant' ? town.shops.get(l.holder) : undefined;
    const state = l.kind === 'public' ? 'landmark' : l.reserved ? 'reserved' : l.state === 'vacant' ? 'vacant' : l.state === 'held' ? 'empty_house' : s?.resting ? 'resting' : 'open';
    return {
      address: l.kind === 'shop' ? this.gen.addressForms(town, l).short : null,
      state,
      som: state === 'open' || state === 'resting' ? l.holder : null,
      shop: l.kind === 'public' ? l.publicName ?? null : state === 'open' || state === 'resting' ? (s?.shop as string | null) ?? null : null,
      home_size: state === 'open' || state === 'resting' ? l.size : null,
    };
  }

  /** まわり: 同じ通りの両側 (street) か地区ぜんぶ (district)。空き区画 (vacant) が引っ越し先の候補 */
  around(town: Town, som: string, scope: 'street' | 'district') {
    const h = this.home(som);
    const lot = h && town.lots.get(h.lot);
    if (!lot) return null;
    const d = town.districts.find((x) => x.id === lot.district)!;
    const lots = d.lots
      .filter((l) => scope === 'district' || l.street === lot.street)
      .map((l) => ({ ...this.lotBrief(town, l), side: l.front === 'down' ? 'north' : 'south', street: d.alleys[l.row < 2 ? 0 : 1]?.name ?? null, here: l.id === lot.id || undefined }));
    return { scope, district: { no: d.no, name: d.name || null }, here: this.gen.addressForms(town, lot).short, lots };
  }

  /** 街ぜんぶの空き区画の数と、空きのある地区 (引っ越し先を探す入口) */
  vacancies(town: Town) {
    return town.districts
      .filter((d) => !d.center)
      .map((d) => ({
        no: d.no,
        name: d.name || null,
        vacant: d.lots
          .filter((l) => l.kind === 'shop' && l.state === 'vacant' && !l.reserved)
          .sort((a, b) => (a.row < 2 ? 1 : 2) - (b.row < 2 ? 1 : 2) || a.number - b.number)
          .map((l) => this.gen.addressForms(town, l).short),
      }));
  }
}

function fmt(t: number): string {
  const d = new Date((t + 9 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
