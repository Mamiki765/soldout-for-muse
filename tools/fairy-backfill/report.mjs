// SOLD OUT for Muse — 保存済みの職・商人ポイントを読み取り専用で試算する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { DEFAULT_CONFIG } from '../../dist/src/config.js';
import { fastestSkillSeconds, planFairyBackfill } from '../../dist/src/engine/fairy-backfill.js';
import { readFairyBackfillInput } from '../../dist/src/fairy-backfill-input.js';

const [file, ...options] = process.argv.slice(2);
if (!file || file === '--help' || options.length % 2 || options.some((x, i) => i % 2 === 0 && x !== '--backup')) {
  console.error('使い方: npm run fairy-backfill -- 保存.sqlite [--backup 11期.sqlite --backup 13期.sqlite]');
  process.exit(file === '--help' ? 0 : 2);
}
const current = readFairyBackfillInput(file);
const backups = options.filter((_, i) => i % 2 === 1).map((path) => readFairyBackfillInput(path).world);
console.log(JSON.stringify({
  as_of: current.world.lasttime,
  fastest_skill_seconds: fastestSkillSeconds(),
  shops: planFairyBackfill(current.world, (id) => current.salesTax.get(id) ?? 0n, DEFAULT_CONFIG, backups),
}, null, 2));
