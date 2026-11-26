// 店主アンケート (1.6.0) の受付期間・Muse 向けの文面・管理用の集計。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import type { Store, SurveyAnswerRow } from '../store.js';
import { SURVEYS, rewardText, sampleAnswers, surveyQuestionsData, type Survey, type SurveyAnswers } from '../surveys.js';
import { jst } from './views.js';

const OPEN_KEY = (id: string) => 'survey_open:' + id;
const CLOSE_KEY = (id: string) => 'survey_close:' + id;

/** その版のサーバーが最初に起きたときを受付の始まりにする (起動時に呼ぶ。あとから足したアンケートもここで始まる) */
export function openSurveys(store: Store, now: number): void {
  for (const s of SURVEYS) if (store.getSetting(OPEN_KEY(s.id)) === undefined) store.setSetting(OPEN_KEY(s.id), String(now));
}

export interface SurveyWindow {
  opened_at: number;
  closes_at: number;
  open: boolean;
}

export function surveyWindow(store: Store, s: Survey, now: number): SurveyWindow {
  const opened = Number(store.getSetting(OPEN_KEY(s.id)) ?? now);
  const override = store.getSetting(CLOSE_KEY(s.id));
  const closes = override !== undefined ? Number(override) : opened + s.days * 86400;
  return { opened_at: opened, closes_at: closes, open: now >= opened && now < closes };
}

/** 締切を変える (管理用)。now から days 日後、または今すぐ (days = 0) */
export function setSurveyClose(store: Store, s: Survey, closesAt: number): void {
  store.setSetting(CLOSE_KEY(s.id), String(closesAt));
}

const parse = (r: SurveyAnswerRow | undefined): SurveyAnswers | null => (r ? (JSON.parse(r.answers) as SurveyAnswers) : null);

// ---------------------------------------------------------------------------
// Muse 向け

export function surveyListData(store: Store, som: string | null, now: number) {
  return SURVEYS.map((s) => {
    const w = surveyWindow(store, s, now);
    const mine = som ? store.surveyAnswer(s.id, som) : undefined;
    return { id: s.id, title: s.title, open: w.open, closes_at: w.closes_at, reward: rewardText(s), answered: !!mine, answered_at: mine?.updated_at ?? null };
  });
}

export function surveyListText(list: ReturnType<typeof surveyListData>): string {
  if (!list.length) return 'いまアンケートはありません\n';
  return list.map((x) =>
    `${x.id} 「${x.title}」 ${x.open ? `受付中 ${jst(x.closes_at)}まで` : '締め切りました'} ${x.answered ? '(回答済み)' : x.open ? `(答えると${x.reward})` : ''} GET /api/v1/surveys/${x.id}`,
  ).join('\n') + '\n';
}

export function surveyDetailData(store: Store, s: Survey, som: string | null, now: number) {
  const w = surveyWindow(store, s, now);
  const mine = som ? store.surveyAnswer(s.id, som) : undefined;
  return {
    id: s.id,
    title: s.title,
    intro: s.intro,
    open: w.open,
    closes_at: w.closes_at,
    reward: rewardText(s),
    questions: surveyQuestionsData(s),
    answered: !!mine,
    my_answers: parse(mine),
    how_to_answer: `POST /api/v1/surveys/${s.id} ${JSON.stringify({ answers: sampleAnswers(s) })}`,
  };
}

export function surveyDetailText(d: ReturnType<typeof surveyDetailData>): string {
  const lines = [
    `アンケート「${d.title}」 ${d.open ? `受付中 ${jst(d.closes_at)}まで` : '締め切りました'}${d.open ? ` (初めて答えると${d.reward})` : ''}`,
    d.intro,
    '',
  ];
  for (const q of d.questions) {
    lines.push(`${q.id} [${q.kind_ja}${q.required ? '' : '・任意'}${q.kind === 'text' ? `・${q.max}文字まで` : ''}] ${q.title}`);
    if (q.body) lines.push(...q.body.split('\n').map((x) => '  ' + x));
    for (const c of q.choices) lines.push(`  ${c.key}. ${c.label}`);
    const mine = d.my_answers?.[q.id];
    if (mine !== undefined) lines.push(`  → あなたの答え: ${Array.isArray(mine) ? mine.join(',') : mine}`);
    lines.push('');
  }
  if (d.open) {
    lines.push('答え方 (選択肢は記号で。自由記述は任意):', d.how_to_answer);
    if (d.answered) lines.push('回答済みです。締切までは同じ形で送り直すと答えを直せます (お礼は1回だけ)');
  }
  return lines.join('\n') + '\n';
}

/** digest に出す行: 受付中で、まだ答えていないアンケート */
export function surveyDigestLines(store: Store, som: string | null, now: number): string[] {
  if (!som) return [];
  return SURVEYS.flatMap((s) => {
    const w = surveyWindow(store, s, now);
    if (!w.open || store.surveyAnswer(s.id, som)) return [];
    return [`アンケート受付中「${s.title}」${jst(w.closes_at)}まで (答えると${rewardText(s)}) GET /api/v1/surveys/${s.id}`];
  });
}

// ---------------------------------------------------------------------------
// 管理用の集計

export function surveyTallyData(store: Store, s: Survey, now: number) {
  const rows = store.surveyAnswers(s.id);
  const w = surveyWindow(store, s, now);
  const answers = rows.map((r) => ({ row: r, a: parse(r)! }));
  const jobOf = (r: SurveyAnswerRow) => r.job || '無職';
  const questions = s.questions.map((q) => {
    if (q.kind === 'text') {
      return {
        id: q.id, kind: q.kind, title: q.title,
        texts: answers.filter((x) => typeof x.a[q.id] === 'string').map((x) => ({ som: x.row.som, shop: x.row.shopname, job: jobOf(x.row), text: x.a[q.id] as string })),
      };
    }
    const counts = new Map<string, number>(q.choices!.map((c) => [c.key, 0]));
    const byJob: Record<string, Record<string, number>> = {};
    let answered = 0;
    for (const x of answers) {
      const v = x.a[q.id];
      if (v === undefined) continue;
      answered++;
      for (const k of Array.isArray(v) ? v : [v]) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const j = (byJob[jobOf(x.row)] ??= {});
        j[k] = (j[k] ?? 0) + 1;
      }
    }
    const label = (k: string) => q.choices!.find((c) => c.key === k)?.label ?? '(今は無い選択肢)';
    return {
      id: q.id, kind: q.kind, title: q.title, answered,
      choices: [...counts].map(([key, n]) => ({ key, label: label(key), n, pct: answered ? Math.round((n * 1000) / answered) / 10 : 0 })),
      by_job: byJob,
    };
  });
  return { id: s.id, title: s.title, open: w.open, opened_at: w.opened_at, closes_at: w.closes_at, respondents: rows.length, questions };
}

export function surveyTallyText(d: ReturnType<typeof surveyTallyData>): string {
  const lines = [`${d.id} 「${d.title}」 ${d.open ? '受付中' : '締切'} ${jst(d.opened_at)}〜${jst(d.closes_at)} 回答${d.respondents}店`, ''];
  for (const q of d.questions) {
    if (q.texts) {
      lines.push(`${q.id} ${q.title} (${q.texts.length}件)`);
      for (const t of q.texts) lines.push(`  [${t.som} ${t.shop} ${t.job}] ${t.text.replace(/\n/g, ' / ')}`);
    } else {
      lines.push(`${q.id} ${q.title} (${q.answered ?? 0}店)`);
      for (const c of q.choices ?? []) lines.push(`  ${c.key}. ${c.n}票 ${c.pct}% ${c.label}`);
      const jobs = Object.entries(q.by_job ?? {}).sort(([a], [b]) => a.localeCompare(b, 'ja'));
      if (jobs.length) lines.push('  職ごと: ' + jobs.map(([j, m]) => `${j} ${Object.entries(m).sort().map(([k, n]) => k + n).join(' ')}`).join(' / '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 表計算ソフトで式として読まれないよう、= + - @ などで始まる値には ' を前に付けてから囲む */
const csvCell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

/** 1店1行の CSV (表計算ソフトで開く用) */
export function surveyCsv(store: Store, s: Survey): string {
  const head = ['som', 'shop', 'job', 'first_at', 'updated_at', ...s.questions.map((q) => q.id)];
  const rows = store.surveyAnswers(s.id).map((r) => {
    const a = parse(r)!;
    return [r.som, r.shopname, r.job || '無職', jst(r.first_at), jst(r.updated_at), ...s.questions.map((q) => {
      const v = a[q.id];
      return v === undefined ? '' : Array.isArray(v) ? v.join(' ') : v;
    })];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
