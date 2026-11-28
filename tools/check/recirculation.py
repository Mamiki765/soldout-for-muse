# 素材の市場還流の下調べ (読み取り専用)。VM で: cd ~/apps/soldout && git fetch -q origin claude/project-thread-edpw5h && git show FETCH_HEAD:tools/check/recirculation.py | sudo python3 -
import sqlite3, json, glob, os, re, time
from collections import Counter
S = sorted(glob.glob(os.path.expanduser("~/apps/soldout/data/soldout.sqlite")) + glob.glob("/home/*/apps/soldout*/data/soldout.sqlite"))[0]
ROOT = os.path.dirname(os.path.dirname(S))
D = json.load(open(os.path.join(ROOT, "src/data/items.json")))
IT = {i["no"]: i for i in D["items"] if i.get("code")}
db = sqlite3.connect(f"file:{S}?mode=ro", uri=True)
w = json.loads(db.execute("SELECT json FROM world WHERE id=1").fetchone()[0])
allshops = w["shops"]
shops = [s for s in allshops if not s.get("rest")]  # 上限の計算に使う店 (営業中)
N = len(shops)
ws = w.get("wholestore") or []
print(f"店(保存分) {len(allshops)} 営業中 {N} 人口 {w.get('people')} イベント {list((w.get('events') or {}).keys())}")

# 素材 = 作り方の材料になる品 (道具の枠は除く)。キット (本執筆10・修行37・解体39) だけの材料は別の印
KIT = {10, 37, 39}
cons = {}
for t in IT.values():
    for u in t.get("uses") or []:
        for l in u.get("use") or []:
            if l.get("count", 0) > 0 and l.get("proba", 0) > 0 and l["item_no"] != t["no"]:
                cons.setdefault(l["item_no"], set()).add(t["no"])
mats = [n for n in sorted(IT) if n in cons and not IT[n].get("uses")]

def has(s, n):
    it = s.get("item") or []
    return it[n-1] if len(it) >= n else 0

held_orders = Counter()
for o in w.get("orders") or []:
    held_orders[o["item"]] += o["count"] - o["left"]

# 直近24時間の仕入れ (ログの文: 「市場より品名をN単位@￥…にて仕入ました」「店名より品名をN単位@￥…」)
since = int(time.time()) - 86400
name2no = {t["name"]: n for n, t in IT.items()}
buy_mkt, buy_shop, buy_mkt_n, buy_shop_n = Counter(), Counter(), Counter(), Counter()
pat = re.compile(r"^(.*?)より(.+?)を(\d+)\D{0,4}@￥(\d+)\(計￥\d+\)にて仕入")
for (msg,) in db.execute("SELECT msg FROM logs WHERE time >= ? AND mode = 0 AND msg LIKE '%にて仕入%'", (since,)):
    m = pat.match(msg)
    if not m or m.group(2) not in name2no: continue
    n = name2no[m.group(2)]; c = int(m.group(3))
    if m.group(1) == "市場": buy_mkt[n] += c; buy_mkt_n[n] += 1
    else: buy_shop[n] += c; buy_shop_n[n] += 1

print("品番\t品名\tplus\tキットだけ\t上限\t手持ち\t募集預かり\t手持ち÷上限\t市場在庫\t空き\t前期売上数(全店)\t24h市場から買った数(回)\t24h店から買った数(回)\t持つ店\t棚に並べた店\t24h湧く量(期待)")
for n in mats:
    t = IT[n]
    cap = -t["wslimit"] if t["wslimit"] < 0 else int(t["wslimit"] * N + 0.99)
    held = sum(has(s, n) for s in shops)
    ho = held_orders[n]
    mk = ws[n-1] if len(ws) >= n else 0
    sold = sum((s.get("itemyesterday") or {}).get(str(n), 0) for s in shops)
    owners = sum(1 for s in shops if has(s, n))
    shelf = sum(1 for s in shops if n in (s.get("showcase") or [])[: s.get("showcasecount", 0)])
    kit = "○" if cons[n] <= KIT else ""
    ratio = (held + ho) / cap if cap else 0
    flow = int(0.75 * 86400 / t["plus"] * w["people"] / (100000 / ((max(50, N) + (N - 1) - 1) * 0.2 + 1))) if t["plus"] > 0 else 0
    print(f"{n}\t{t['name']}\t{t['plus']}\t{kit}\t{cap}\t{held}\t{ho}\t{ratio:.2f}\t{mk}\t{max(0, cap-held-ho-mk)}\t{sold}\t{buy_mkt[n]}({buy_mkt_n[n]})\t{buy_shop[n]}({buy_shop_n[n]})\t{owners}\t{shelf}\t{flow}")

# 薬草: だれが持っているか (職別)、多く持つ店、市場で買った店
print("--- 薬草 (品番1)")
byjob = Counter()
for s in shops:
    if has(s, 1): byjob[s.get("job", "")] += has(s, 1)
print("職別の手持ち", dict(byjob.most_common()))
print("職別の店数", dict(Counter(s.get("job", "") for s in shops).most_common()))
print("手持ちの多い店", [(s["id"], s.get("job", ""), has(s, 1)) for s in sorted(shops, key=lambda s: -has(s, 1))[:10]])
print("所持上限", IT[1]["limit"], "上限いっぱいの店", sum(1 for s in shops if has(s, 1) >= IT[1]["limit"]))
