# 掘り出し物 (1.9.0) が出ない理由を見る (読み取り専用)。VM で:
# cd ~/apps/soldout && git fetch -q origin claude/project-thread-edpw5h && git show FETCH_HEAD:tools/check/resale.py | sudo python3 -
import sqlite3, json, glob, os, time
S = sorted(glob.glob(os.path.expanduser("~/apps/soldout/data/soldout.sqlite")) + glob.glob("/home/*/apps/soldout*/data/soldout.sqlite"))[0]
ROOT = os.path.dirname(os.path.dirname(S))
D = json.load(open(os.path.join(ROOT, "src/data/items.json")))
IT = {i["no"]: i for i in D["items"] if i.get("code")}
db = sqlite3.connect(f"file:{S}?mode=ro", uri=True)
row = db.execute("SELECT json, saved_at FROM world WHERE id=1").fetchone()
w = json.loads(row[0])
shops = w["shops"]; N = len(shops); k = max(50, N) / 50
ws = w.get("wholestore") or []
r = w.get("resale")
print(f"保存 {time.strftime('%m/%d %H:%M', time.localtime(row[1]))} 店 {N} k {k:.2f} define {D.get('define', {}).get('resalerate')}")
print("resale の記録:", "無し (一度も戻っていない)" if r is None else json.dumps(r, ensure_ascii=False)[:1500])
# 対象の品 (resale.ts の resaleItems と同じ)
s = set()
for t in IT.values():
    for u in t.get("uses") or []:
        for l in u.get("use") or []:
            if l.get("count", 0) > 0 and l.get("proba", 0) > 0 and l["item_no"] != t["no"]: s.add(l["item_no"])
        if t.get("type") == 9:
            for l in u.get("get") or []: s.add(l["item_no"])
s = [n for n in sorted(s) if n in IT and not IT[n].get("uses") and IT[n].get("pricehalf")]
print("品番\t品名\t客に売れた数(今期/前期,全店)\t棚に並べた店\t市場在庫\t線(pricebase×k)\t線まで")
for n in s:
    t = IT[n]
    td = sum((x.get("itemtoday") or {}).get(str(n), 0) for x in shops)
    yd = sum((x.get("itemyesterday") or {}).get(str(n), 0) for x in shops)
    shelf = sum(1 for x in shops if n in (x.get("showcase") or [])[: x.get("showcasecount", 0)])
    mk = ws[n-1] if len(ws) >= n else 0
    line = t["pricebase"] * k
    print(f"{n}\t{t['name']}\t{td}/{yd}\t{shelf}\t{mk}\t{line:.0f}\t{int(line) - mk}")
