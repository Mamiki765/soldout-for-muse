// SOLD OUT for Muse — 妖精ポイントの試算用に保存ファイルを読み取る。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FairyBackfillSnapshot } from './engine/fairy-backfill.js';
import type { World } from './engine/types.js';

function parseWorld(json: string): World {
  const world = JSON.parse(json) as World;
  if (!Array.isArray(world?.shops) || !Number.isSafeInteger(world.lasttime)) throw new Error('保存データの街と店を読み取れません');
  return world;
}

export function readFairyBackfillInput(file: string): FairyBackfillSnapshot {
  const sales = new Map<number, bigint>();
  const deposit = new Map<number, bigint>();
  const snapshot = (world: World): FairyBackfillSnapshot => ({
    world,
    salesTax: (id) => sales.get(id) ?? 0n,
    depositTax: (id) => deposit.get(id) ?? 0n,
  });
  if (extname(file).toLowerCase() === '.json') {
    return snapshot(parseWorld(readFileSync(file, 'utf8')));
  }
  // 通常の Store はスキーマを書き換えるので、試算では読み取り専用で開く。
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('BEGIN');
    const row = db.prepare('SELECT json FROM world WHERE id = 1').get() as { json: string } | undefined;
    if (!row) throw new Error(`${file} に街の保存データがありません`);
    const world = parseWorld(row.json);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('owner_tax_totals', 'owners')").all();
    if (tables.length === 2) {
      const query = db.prepare('SELECT o.shop_id, t.sales, t.deposit FROM owners o JOIN owner_tax_totals t ON t.som = o.som WHERE o.shop_id IS NOT NULL');
      query.setReadBigInts(true);
      for (const t of query.all() as { shop_id: bigint; sales: bigint; deposit: bigint }[]) {
        sales.set(Number(t.shop_id), t.sales);
        deposit.set(Number(t.shop_id), t.deposit);
      }
    }
    db.exec('COMMIT');
    return snapshot(world);
  } finally {
    db.close();
  }
}
