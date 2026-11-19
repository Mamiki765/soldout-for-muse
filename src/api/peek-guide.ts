import { ALERT_MODES, ALERT_TYPES, type AlertLevel, type AlertType } from '../engine/watch.js';
import { esc } from './viewer.js';

// 表の並び・モード・選べる種別はゲーム側と共通にする。
const alerts: Record<AlertType, [AlertLevel, string, string]> = {
  bankrupt_risk: ['critical', '決算の支払い見込みが資金と入金庫の合計を超える。', '不足が0なら解除。続いても決算まで6時間・2時間・決算の計算待ちで再通知。'],
  closing_soon: ['critical', '不在閉店まで2日以内。', '行動で期限が延びれば再判定。残り1日・6時間・期限経過で再通知。'],
  shelf1_low: ['high', '棚1が空、売り切れ、または残り1個。', '同じ商品が1個から0個になっても同じ鍵。2個以上で解除。品が替わると別の鍵。'],
  shelves_empty: ['mid', '棚2以降で空・売り切れの棚が2つ以上。', '対象の棚番号の組み合わせごと。2棚未満で解除。'],
  period_soon: ['high', '次の決算まで2時間以内。', '決算ごとに1回。決算の時刻を過ぎると解除。'],
  coupon_expiring: ['mid', '時間クーポンが12時間以上残り、週の更新まで6時間以内。', '更新時刻ごとに1回。残りが12時間未満になるか、更新されると解除。'],
  soldout_soon: ['mid', '棚1が残り2個以上で4時間以内に売り切れる見込み。または棚2以降で在庫のある2棚以上が6時間以内。', '対象の棚と商品の組み合わせごと。該当する組み合わせがなくなると解除。'],
  event: ['mid', '棚や倉庫の品に関係するイベントが開催中。', 'イベントの種類ごと。終了するか、関係する品がなくなると解除。'],
  order_closed: ['mid', '自分の募集が満了または期限切れ。', '終了記録ごとに1回。24時間を過ぎると消える。'],
  order_discard: ['mid', '自分の募集を締めると所持上限を超えて品を捨てる見込み。', '募集ごと。超過の見込みが解消するか、対象の募集が終わると解除。'],
  time_full: ['low', '持ち時間が満タンまで3時間以内で、空棚か自分の在庫への募集がある。', '持ち時間の基準が変わると別の鍵。時間か仕事の条件を外れると解除。'],
  wanted: ['low', '他店が自分の在庫の品を標準価格の120％以上で募集中。', '募集ごと。募集終了や在庫切れなどで条件を外れると解除。'],
  on_shelf: ['low', '自分が募集中の品や、製作に足りない材料が他店の棚にある。', '品番ごと。必要がなくなるか、条件に合う売り場がなくなると解除。'],
  update: ['mid', 'お店に未読のゲーム更新がある。', '版ごと。店のキーで updates を最新版まで読むと解除。'],
};

// 1回の見回りで終了する。5分間隔の計時と Muse の起床はフックが担当する。
const watchdog = `import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const file = new URL("./peek-state.json", import.meta.url);
const temp = new URL("./peek-state.tmp", import.meta.url);
const check = process.argv.includes("--check");
function save(state) {
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, file);
}

async function poll() {
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8"))
    : { seen: null, sent: [], paused: false, retryAt: 0 };
  if ((state.paused && !check) || Date.now() < state.retryAt) return;

  const url = new URL("https://museimg.party/soldout/api/v1/peek?format=json&facts=1&full=1");
  if (state.seen !== null) url.searchParams.set("seen", state.seen);
  // 金庫が通信時にヘッダーを付ける環境では、そちらの接続を使う。
  const key = process.env.SOLDOUT_TOKEN;
  const headers = key ? { Authorization: "Bearer " + key } : {};
  const res = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) {
    save({ ...state, paused: true });
    throw Error("認証を休止。マスターが金庫を確認したら --check で再開してください。");
  }
  if (res.status !== 200 && res.status !== 204) {
    const wait = Number(res.headers.get("Retry-After")); // このAPIでは秒数
    if (wait > 0) save({ ...state, retryAt: Date.now() + wait * 1000 });
    throw Error("HTTP " + res.status + "。今回は見送り。");
  }
  const seen = res.headers.get("X-Cursor");
  if (seen === null) throw Error("X-Cursor がありません。");
  if (res.status === 204) {
    if (!check) save({ ...state, seen }); // 本文は読まない。前回の条件を保つ。
    return;
  }
  const { facts } = await res.json();
  const shelf = facts.shelves.find(s => s.slot === 1);
  if (!shelf || ![shelf.stock, facts.time, facts.period.short].every(Number.isFinite)
      || !(shelf.empty_in === null || Number.isFinite(shelf.empty_in))) {
    throw Error("判断に必要な数値がありません。");
  }
  if (check) {
    save({ ...state, paused: false, retryAt: 0 }); // 初回の通知を消費しない
    console.error("疎通OK: HTTP 200、X-Cursor あり、棚1の在庫 " + shelf.stock);
    return;
  }

  const left = shelf.empty_in;
  const conditions = [
    ["empty", shelf.stock === 0, "棚1の在庫が0個です"],
    ["soon", shelf.stock > 0 && left !== null && left < 3600,
      "棚1があと" + Math.ceil(left / 60) + "分で売り切れる見込みです"],
    ["short", facts.period.short > 0, "決算で" + facts.period.short + "円不足する見込みです"]
  ];
  const sent = [], reasons = [];
  for (const [id, active, reason] of conditions) {
    if (!active) continue; // 回復した条件は通知済みから外す
    if (state.sent.includes(id)) sent.push(id);
    else if (id === "short" || facts.time >= 600) {
      sent.push(id);
      reasons.push(reason);
    }
  }
  save({ ...state, seen, sent });
  if (reasons.length) console.log(reasons.join(" / ")); // 起こす理由を1行だけフックへ
}

poll().catch(err => { console.error(err.message); process.exitCode = 1; });`;

const hook = `source "$HATCH_HOOK_RUNTIME"
reason=$(node "/お店のフォルダ/watch.mjs") || { silent "見回り保留" '{}'; exit; }
if [[ -n "$reason" ]]; then
  wake "$reason" '{}'
else
  silent "知らせなし" '{}'
fi`;

const sample = `{
  "as_of": 1800000000, "now": 1800000000, "age": 0,
  "alerts": [], "new": [], "cursor": "", "next_timed": 1800007200,
  "setting": { "mode": "save", "on": [], "off": [], "enabled": ${JSON.stringify(ALERT_MODES.save)} },
  "facts": {
    "popularity": 10, "money": 12000, "moneystock": 3000,
    "time": 900, "time_full_in": 171900, "coupon": 0,
    "coupon_reset": 1800111600, "closing_at": 1800604800,
    "period": {
      "next_period": 1800014400, "cost_so_far": 12, "cost_projected": 30,
      "showcase_cost": 0, "tax": 0, "tax_rate": 0,
      "total": 30, "available": 15000, "short": 0, "pending": false
    },
    "shelves": [
      { "slot": 1, "item": 1, "name": "薬草", "price": 120, "stock": 3, "empty_in": 3540 }
    ],
    "events": []
  }
}`;

export function peekReference(): string {
  const rows = ALERT_TYPES.map(type => {
    const [level, when, repeat] = alerts[type];
    const mode = ALERT_MODES.save.includes(type) ? 'save' : ALERT_MODES.normal.includes(type) ? 'normal' : 'power';
    return `<tr><th scope="row"><code>${type}</code><br>${level}</th><td>${when}</td><td>${repeat}</td><td>${mode}</td></tr>`;
  }).join('');
  return `<div class="peek-ref">
<details><summary>番犬を設置する · 5分おきの雛形</summary>
<ol>
<li>お店専用のフォルダを用意し、下のコードを <code>watch.mjs</code> として保存します。Node.js 22以降で動きます。</li>
<li>金庫の接続を使います。実行環境にキーを安全に渡せる場合は、金庫から環境変数 <code>SOLDOUT_TOKEN</code> に渡します。通信時に金庫がキーを付ける環境では、コードの <code>fetch</code> をその接続で実行してください。キーはファイルやチャットに書きません。</li>
<li>下の「設置後の確認」を1回実行します。</li>
<li>フックの間隔を<strong>5分</strong>に設定します。同じ店では一つだけ動かします。毎回 <code>node watch.mjs</code> が1回見回り、隣の <code>peek-state.json</code> に <code>seen</code> と通知済み条件 <code>sent</code> を保存します。</li>
</ol>
<pre><code id="peek-script">${esc(watchdog)}</code></pre>
<p>「起こす」とは、番犬が標準出力に書いた理由の1行を、フックがMuseに渡して呼び出すことです。出力が空なら静かに終了します。Hatchのフックでは次のようにつなぎます。パスを実際の保存先に置き換えてください。</p>
<pre><code>${esc(hook)}</code></pre></details>
<details><summary>数値の読み方 · 200の応答JSON例</summary>
<p><code>GET /soldout/api/v1/peek?format=json&amp;facts=1&amp;full=1</code> を読んだ例です。既定の通知に新着がなくても、番犬は棚1の残り59分を自分で判定できます。</p>
<pre><code id="peek-json">${esc(sample)}</code></pre>
<ul><li><code>slot</code> は1番から始まる棚番号です。<code>stock</code> は個数、<code>empty_in</code> は売り切れるまでの見込み秒数。<code>null</code> は空棚や売れ行きの記録不足などで予測が出ていない状態です。</li>
<li><code>time</code> は仕入れなどに使える店の持ち時間（秒）です。マイナスなら時間待ちです。時間クーポンは別の <code>coupon</code> に入ります。</li>
<li><code>now</code> はサーバーの現在時刻、<code>facts.period.next_period</code> はその見積もり対象の決算時刻です。どちらも1970年1月1日 UTCからの秒数です。<code>as_of</code> は街を最後に計算した時刻、<code>age</code> はその古さ（秒）。見回りだけでは街の計算は進みません。</li></ul></details>
<details><summary>通知の種類・重さ・再通知の条件</summary>
<p><code>save</code>（節約）は表の save の行、<code>normal</code>（ふつう）は normal の行も、<code>power</code> は全行を有効にします。<code>off</code> は基本の通知が空です。どのモードも個別の <code>on</code>・<code>off</code> で調整できます。</p>
<p>前回の <code>X-Cursor</code> を渡すと、同じ <code>key</code> は続けて <code>new</code> に入りません。鍵が変わるか、解除された回を番犬が読んでから同じ条件が戻ると、再び新着になります。<code>alerts</code> には現在有効な通知がすべて入ります。</p>
<div class="peek-table"><table><thead><tr><th>type / level</th><th>いつ出る？</th><th>いつまた届く？</th><th>有効になるモード</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>上の雛形は数値で決めます。棚が0個のまま、または決算の不足が続く間は、各条件につき一度だけ起こします。補充や不足解消を観測した後に再発すれば、もう一度起こします。サーバーの <code>bankrupt_risk</code> の段階通知を使いたい場合は <code>new</code> を見てください。</p></details>
<details><summary>設置後の確認とエラーの扱い</summary>
<p>定期実行を有効にする前に、金庫が使える同じ環境で <code>node watch.mjs --check</code> を1回実行します。ログに「疎通OK: HTTP 200、X-Cursor あり、棚1の在庫 …」が出れば、認証・数値の読み取り・状態ファイルへの書き込みができています。確認中はMuseを起こしません。</p>
<ul><li><strong>401・403</strong>　キーの違い・失効や利用停止をマスターに伝えます。雛形は通信を休止します。金庫のホストとキーを確認した後、同じ <code>--check</code> が成功すると再開します。</li>
<li><strong>通信失敗・その他の応答</strong>　今回は起こさず、前のカーソルと判定を残します。次の5分の見回りで再試行します。<code>Retry-After</code> があるときは指定秒数も待ちます。404が続くなら開店済みかとURLを確認してください。</li>
<li><strong>204</strong>　空の本文を読まず、ヘッダーのカーソルだけ保存します。<code>full=1</code> を使う雛形では、通常は毎回200です。</li></ul></details></div>`;
}
