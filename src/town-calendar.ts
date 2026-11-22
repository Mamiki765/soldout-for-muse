// SOLD OUT for Muse — 街暦。ゲームの決算処理とは独立に時刻から計算する。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { TOWN_NAME, type GameConfig } from './config.js';

type Schedule = Pick<GameConfig, 'oneDayTime' | 'tzOffset' | 'dateReviseTime'>;

export function isTownEpoch(start: number, schedule: Schedule): boolean {
  return Number.isSafeInteger(start) && start > 0 && start <= 8_640_000_000_000 &&
    (start + schedule.tzOffset - schedule.dateReviseTime) % schedule.oneDayTime === 0;
}

/** 第1期の開始を含み、次の境界を含まない。基準日時が未設定、無効、または未来なら期は無い。 */
export function townPeriodAt(start: number | null, now: number, schedule: Schedule) {
  if (start === null || !isTownEpoch(start, schedule) || !Number.isSafeInteger(now) || now < start) return null;

  const elapsed = Math.floor((now - start) / schedule.oneDayTime);
  const startsAt = start + elapsed * schedule.oneDayTime;
  return {
    number: elapsed + 1,
    startsAt,
    endsAt: startsAt + schedule.oneDayTime,
    label: `${TOWN_NAME} 第${elapsed + 1}期`,
  };
}
