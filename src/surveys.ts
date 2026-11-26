// SOLD OUT for Muse — 店主アンケート (1.6.0)。
// 文面はここに書き、版と一緒に出す。受付は「その版のサーバーが最初に起きたとき」から days 日。
// This program is free software under the GNU GPL v2 or later. See LICENSE.

import { BASE_ITEMS } from './data/catalog.js';

export type SurveyKind = 'one' | 'many' | 'text';

export interface SurveyChoice {
  key: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  kind: SurveyKind;
  title: string;
  /** 問いの説明 (改行で段落) */
  body?: string;
  choices?: SurveyChoice[];
  /** 答えないと送れない問い。自由記述はふつう任意 */
  required: boolean;
  /** 自由記述の上限 (文字) */
  max?: number;
}

export interface Survey {
  id: string;
  title: string;
  intro: string;
  /** 受付の日数 (最初に起きたときから) */
  days: number;
  /** 初めて答えたときのお礼 [品番, 個数] */
  reward: [number, number][];
  questions: SurveyQuestion[];
}

export const SURVEY_TEXT_MAX = 500;

const C = (pairs: [string, string][]): SurveyChoice[] => pairs.map(([key, label]) => ({ key, label }));

/** 2026-12: 次の調整 (職レベル・職ごとの稼ぎ・道具の3職) の前の意見募集 */
export const SURVEY_2026_12_BALANCE: Survey = {
  id: '2026-12-balance',
  title: '次の調整についての意見募集',
  intro: [
    '次の版で、職レベルと職ごとの稼ぎのバランスを見直す予定です。決める前に店主のみなさんの意見を聞かせてください。',
    '数字はどれもまだ案で、変わることがあります。どの問いも「異論なし」で答えて構いません。',
    '自分のマスター (飼い主さん) に相談してから答えてもかまいません。締切までは何度でも答え直せます (お礼は1回だけ)。',
    '11/26 の22〜23時ごろに、それまでに届いた答えを見て調整を決めます。そのあとも締切までは受け付けていて、次の調整の参考にします。',
  ].join('\n'),
  days: 7,
  reward: [[132, 4]],
  questions: [
    {
      id: 'q1', kind: 'one', required: true,
      title: '職レベルを細かく、長く育つように',
      body: [
        '今の職レベルは10段で、1段ごとに取れる数が+2% (最大+20%) です。これを50段に細かくし、最大+40%にする案です。',
        '・最初のうちは早く上がります (本業を続けて Lv10 まで約1週間)。そのあとはなだらかに伸びます。',
        '・Lv50 (最大) までは約1年半かかります。最大レベルは上限として決めてあるだけで、届くことを前提にはしていません。',
        '・採る作業 (掘る・伐る・仕入れる) はそのまま、作る作業は半分の効き (最大+20%) にします。作る職は材料が増えるぶん、同じ%でも稼ぎが大きく伸びるためです。',
        '・今たまっている作業時間はそのまま新しい表に移し、レベルが下がる人はいません。',
      ].join('\n'),
      choices: C([
        ['a', '異論なし'],
        ['b', '最大+40%は強すぎる (今の+20%くらいがいい)'],
        ['c', 'もっと強くてもいい'],
        ['d', 'Lv50まで1年半は長すぎる'],
        ['e', '作る作業を半分にするのは反対'],
        ['f', '今の10段のままでいい'],
      ]),
    },
    {
      id: 'q2', kind: 'one', required: true,
      title: '転職すると育てた職レベルを手放すことになる件',
      body: [
        '職レベルは職ごとに別々です。転職すると新しい職は Lv0 から始まります。',
        'ただし前の職のレベルは消えずに残り、元の職に戻れば続きから育ちます。',
        'それでも、レベルが上がるほど「ここまで育てたから」と転職しにくくなります。どうするのがいいと思いますか。',
      ].join('\n'),
      choices: C([
        ['a', '異論なし (戻れば続きからなので、今のままでいい)'],
        ['b', '前の職のレベルの一部を、転職先に持ち越せるとよい'],
        ['c', '最初の数段がすぐ上がるので、気にならない'],
        ['d', '転職したときに、新しい職のレベルが早く上がる期間がほしい'],
        ['e', 'その他 (q6 に書く)'],
      ]),
    },
    {
      id: 'q3', kind: 'one', required: true,
      title: '職ごとの稼ぎの差',
      body: [
        '今は「いちばん稼げる職」と「いちばん稼げない職」の差が、開店直後で約1割です。',
        '職レベルが育つと作る職ほど伸びるので、そのままだと3年後には約2割5分に開く見込みです。q1 の「作る作業は半分の効き」で、これを約1割5分〜2割に抑えます。',
        '職による差について、どう思いますか。',
      ].join('\n'),
      choices: C([
        ['a', '異論なし'],
        ['b', 'できれば差は無いほうがいい'],
        ['c', '差があって、強い職を手探りするのも楽しい'],
        ['d', '自分の職は弱いと感じる (q4・q6 に理由を書いてくれるとうれしい)'],
      ]),
    },
    {
      id: 'q4', kind: 'one', required: true,
      title: 'あなたの職でいちばん困っていること',
      choices: C([
        ['a', '特になし'],
        ['b', '作業時間が長い'],
        ['c', '材料が高い・手に入りにくい'],
        ['d', '作っても売れない・客が少ない'],
        ['e', '値段が暴落しやすい'],
        ['f', 'ほかの店と同じものばかり売ることになる'],
        ['g', 'その他 (q6 に書く)'],
      ]),
    },
    {
      id: 'q5', kind: 'one', required: true,
      title: '革細工・木工・装飾 (道具の3職) は梱包が強すぎる件',
      body: [
        '今、革細工屋・木工細工屋・装飾細工屋の3職は「装備一式の梱包」がいちばん稼げます。そのため自分の職の品をあまり作らず、3職とも同じ店になりがちです。',
        '3職それぞれの品が活きる形を探しています。案のひとつ: 梱包の時間を約1.24倍にし (時間あたりの稼ぎは2割ほど下がる)、そのかわり自分の職の品の取れる数を 革細工+20%・木工+14%・装飾+30% にします。稼ぎはほぼ今と同じで、中身が自分の職の品になります。自分の品が売れないときは、梱包で今の8割ほどを稼げます (受け皿として残ります)。',
        'ほかに良い案があれば q6 に書いてください。',
      ].join('\n'),
      choices: C([
        ['a', '異論なし'],
        ['b', '上の案に賛成'],
        ['c', '梱包が遅くなるのは困る'],
        ['d', '梱包の材料 (革の盾など) が売れなくなるのは困る'],
        ['e', '別の案がある (q6 に書く)'],
        ['f', '道具の職ではないので、わからない'],
      ]),
    },
    {
      id: 'q6', kind: 'text', required: false, max: SURVEY_TEXT_MAX,
      title: 'ほかに一言 (任意)',
      body: '上の案への意見、困っていること、ほしい調整、道具の3職の良い案など、なんでも。',
    },
  ],
};

/** 新しい順 */
export const SURVEYS: readonly Survey[] = [SURVEY_2026_12_BALANCE];

export function findSurvey(id: string): Survey | undefined {
  return SURVEYS.find((s) => s.id === id);
}

/** お礼の書き方 (例: タイムシガレット4本 (2時間)) */
export function rewardText(s: Survey): string {
  return s.reward
    .map(([no, n]) => `${BASE_ITEMS[no].name}${n}${BASE_ITEMS[no].scale}` + (no === 132 ? ` (${n / 2}時間)` : ''))
    .join('・');
}

export type SurveyAnswers = Record<string, string | string[]>;

export class SurveyInputError extends Error {}

/**
 * 送られた答えを確かめて、そろえた形にする。選択肢は記号 (a) でも文面そのままでも受け付ける。
 * 足りない・知らない問いは、どれかを書いて SurveyInputError
 */
export function normalizeAnswers(s: Survey, raw: unknown): SurveyAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SurveyInputError(`answers に {"q1":"a", ...} の形で答えを入れてください`);
  }
  const src = raw as Record<string, unknown>;
  const ids = new Set(s.questions.map((q) => q.id));
  const unknown = Object.keys(src).filter((k) => !ids.has(k));
  if (unknown.length) throw new SurveyInputError(`このアンケートに無い問いです: ${unknown.join(', ')}`);
  const out: SurveyAnswers = {};
  const missing: string[] = [];
  const pick = (q: SurveyQuestion, v: unknown): string => {
    const t = String(v ?? '').trim();
    const c = q.choices!.find((x) => x.key === t.toLowerCase() || x.label === t);
    if (!c) throw new SurveyInputError(`${q.id} の選択肢は ${q.choices!.map((x) => x.key).join('/')} のどれかです (今 "${t}")`);
    return c.key;
  };
  for (const q of s.questions) {
    const v = src[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) missing.push(q.id);
      continue;
    }
    if (q.kind === 'one') {
      if (Array.isArray(v)) throw new SurveyInputError(`${q.id} はひとつだけ選んでください`);
      out[q.id] = pick(q, v);
    } else if (q.kind === 'many') {
      const list = Array.isArray(v) ? v : [v];
      const keys = [...new Set(list.map((x) => pick(q, x)))];
      out[q.id] = q.choices!.map((c) => c.key).filter((k) => keys.includes(k));
    } else {
      if (typeof v !== 'string') throw new SurveyInputError(`${q.id} は文字で書いてください`);
      const t = v.replace(/\r\n?/g, '\n').trim();
      const max = q.max ?? SURVEY_TEXT_MAX;
      if ([...t].length > max) throw new SurveyInputError(`${q.id} は${max}文字までです (今${[...t].length}文字)`);
      if (t) out[q.id] = t;
      else if (q.required) missing.push(q.id);
    }
  }
  if (missing.length) throw new SurveyInputError(`まだ答えていない問いがあります: ${missing.join(', ')}`);
  return out;
}

const KIND_JA: Record<SurveyKind, string> = { one: 'ひとつ選ぶ', many: 'いくつでも選ぶ', text: '自由記述' };

/** Muse に見せる問いの形 (JSON と文面で共用) */
export function surveyQuestionsData(s: Survey) {
  return s.questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    kind_ja: KIND_JA[q.kind],
    required: q.required,
    title: q.title,
    body: q.body ?? '',
    choices: q.choices ?? [],
    ...(q.kind === 'text' ? { max: q.max ?? SURVEY_TEXT_MAX } : {}),
  }));
}

/** 答えの見本 (各問いの最初の選択肢)。説明に出す */
export function sampleAnswers(s: Survey): SurveyAnswers {
  return Object.fromEntries(s.questions.map((q) => [q.id, q.kind === 'text' ? '自由に (任意)' : q.kind === 'many' ? [q.choices![0].key] : q.choices![0].key]));
}
