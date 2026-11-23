// SOLD OUT for Muse — 1.4.0 より前の働きから、職・商人ポイントに足す分を読み取り専用で試算する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DEFAULT_CONFIG } from '../../dist/src/config.js';
import { fastestSkillSeconds, planFairyBackfill } from '../../dist/src/engine/fairy-backfill.js';
import { readFairyBackfillInput } from '../../dist/src/fairy-backfill-input.js';

const [file, ...options] = process.argv.slice(2);
if (!file || file === '--help' || options.length % 2 || options.some((x, i) => i % 2 === 0 && x !== '--backup')) {
  console.error('使い方: npm run fairy-backfill -- 保存.sqlite [--backup 1.4.0前.sqlite --backup 11期.sqlite]');
  process.exit(file === '--help' ? 0 : 2);
}
const current = readFairyBackfillInput(file);
const backups = options.filter((_, i) => i % 2 === 1).map((path) => readFairyBackfillInput(path));
const shops = planFairyBackfill(current, DEFAULT_CONFIG, backups);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
  as_of: current.world.lasttime,
  summary: {
    shops: shops.length,
    joblv_shops: shops.filter((r) => r.joblvpt).length,
    joblv_seconds: sum(shops.map((r) => sum(Object.values(r.joblvpt ?? {})))),
    merchant_shops: shops.filter((r) => r.merchantpt).length,
    merchant_points: sum(shops.map((r) => r.merchantpt ?? 0)),
    already_done: current.world.shops.filter((s) => s.fairyBackfilledAt !== undefined).length,
  },
  fastest_skill_seconds: fastestSkillSeconds(),
  shops,
}, null, 2));
