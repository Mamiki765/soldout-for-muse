// SOLD OUT for Muse — 観戦画面の街の地図 (1.2.0)。
// サーバーがページに埋め込んだ JSON (#town-data: 区画と店の様子) から、town-gen.js で同じ街を組み立てて描く。
// 地面・建物は tiles.js の canvas、押せる区画・看板・地名は上に重ねた div。
// This program is free software under the GNU GPL v2 or later. See LICENSE.
(function (root) {
  'use strict';
  const T = root.TownGen;
  // このファイルは <site>/view/town/static/view.js。リンクはサイトの根から (/soldout のような前置きがあっても同じ)
  const SITE = new URL('../../../', document.currentScript.src);
  const link = (p) => new URL(p.replace(/^\//, ''), SITE).href;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const yen = (n) => '￥' + Number(n).toLocaleString('ja-JP');
  const PHONE = () => innerWidth <= 640;

  /** ページに埋め込まれた街を組み立てる */
  function load(id) {
    const el = document.getElementById(id || 'town-data');
    if (!el) return null;
    const d = JSON.parse(el.textContent);
    const town = T.restoreTown(d.opts, d.districts, d.homes);
    town.focus = d.focus ?? null;
    return town;
  }

  const districtOf = (town, lot) => town.districts.find((d) => d.id === lot.district);
  const shortName = (d) => (d.center ? '中央' : d.name ? `${d.no}区 ${d.name}` : `第${d.no}区`);
  const addr = (town, lot) => T.addressForms(town, lot);

  /** 区画の中身 */
  function lotInfo(town, lot) {
    if (lot.kind === 'public') {
      const d = districtOf(town, lot);
      return { type: 'public', title: lot.publicName, sub: lot.publicKind === 'plot' ? '将来の公共施設の予定地' : d.center ? '中央の公共施設' : '地区の目印' };
    }
    if (lot.state === 'vacant') return { type: 'npc', title: '空き区画', sub: 'NPC の家 (新しい店や引っ越しで入れる)' };
    if (lot.state === 'held') return { type: 'held', title: '空き家', sub: '閉店した店の区画 (しばらくそのまま。期限が過ぎたら空き区画に戻る)' };
    const s = town.shops.get(lot.holder);
    return { type: s?.resting ? 'resting' : 'open', title: s?.shop ?? '', sub: s?.owner ?? '', shop: s };
  }

  /**
   * 上から見た地図。districts の範囲 (と外側の大通り) を描く。scale は 1チップの px。
   * opt: { districts, scale, labels, signs, highlight, res }
   */
  function renderTop(town, opt) {
    const o = { districts: town.districts, scale: 16, labels: true, highlight: null, res: 1, signs: true, ...opt };
    const bb = T.bounds(town, o.districts);
    const x1 = bb.x, y1 = bb.y, W = bb.w, H = bb.h, s = o.scale;
    const el = document.createElement('div');
    el.className = 'top-map';
    el.style.width = W * s + 'px';
    el.style.height = H * s + 'px';
    el.style.setProperty('--chip', s + 'px');
    // canvas は大きすぎないように (一辺 8192px まで)
    const cap = Math.min(4096 / W, 4096 / H); // 大きすぎる canvas はスマホで重く、動かすたびに引っかかる
    const density = Math.min(cap, s * o.res);
    const cv = document.createElement('canvas');
    cv.className = 'tiles';
    cv.width = Math.round(W * density);
    cv.height = Math.round(H * density);
    cv.style.width = W * s + 'px';
    cv.style.height = H * s + 'px';
    root.Tiles.paint(cv.getContext('2d'), T.chunksFor(town, o.districts), density, x1, y1, W, H);
    el.appendChild(cv);
    const px = (v, base) => (v - base) * s + 'px';
    for (const d of o.districts) {
      for (const l of d.lots) {
        const div = document.createElement('div');
        const info = lotInfo(town, l);
        div.className = 'lot t-' + info.type + (o.highlight === l.id ? ' hl' : '');
        div.dataset.lot = l.id;
        div.style.left = px(l.x, x1);
        div.style.top = px(l.y, y1);
        div.style.width = l.w * s + 'px';
        div.style.height = l.h * s + 'px';
        if (o.signs && (info.type === 'open' || info.type === 'resting' || info.type === 'held')) {
          const txt = info.type === 'held' ? '空き家' : info.type === 'resting' ? '休業' : s >= 10 ? esc(info.title) : '';
          div.innerHTML = `<div class="sign ${l.front === 'down' ? 'down' : 'up'}">${txt}</div>`;
        } else if (o.signs && s >= 10 && l.kind === 'public' && !['fountain', 'park', 'garden', 'market', 'plot', 'bigpark'].includes(l.publicKind) && !(d.center && l.col % 2 === 1 && ['hall', 'guild', 'tree'].includes(l.publicKind))) {
          div.innerHTML = `<div class="sign pub up">${esc(l.publicName)}</div>`;
        } else if (o.signs && s >= 10 && l.publicKind === 'market' && l.row === 2 && (l.col === 1 || l.col === d.cols - 2)) {
          div.innerHTML = `<div class="sign pub up">${esc(l.publicName)}</div>`;
        }
        el.appendChild(div);
      }
      if (o.labels) {
        // 引いたときは地区の真ん中に大きく。目印の名前 (小さな字) は中央だけ
        const lab = document.createElement('div');
        lab.className = 'dlabel' + (d.center ? ' center' : '');
        lab.style.left = px(d.x0 + d.w / 2, x1);
        lab.style.top = px(d.y0 + d.h / 2, y1);
        lab.innerHTML = `<b>${esc(T.districtLabel(d))}</b>${d.center ? `<span>${esc(d.landmark.name)}</span>` : ''}`;
        // 寄ったときも見える地名の札 (北の大通りの上)
        const plate = document.createElement('div');
        plate.className = 'dplate' + (d.center ? ' center' : '');
        plate.style.left = px(d.x0 + d.w / 2, x1);
        plate.style.top = px(d.y0 - town.opts.avenue / 2, y1);
        plate.textContent = T.districtLabel(d);
        el.appendChild(plate);
        el.appendChild(lab);
      }
    }
    return el;
  }

  // ---------------------------------------------------------------------------
  // 街の地図のページ (/view/town)

  function page(host, town) {
    const q = new URLSearchParams(location.search);
    const ds = town.districts.filter((d) => d.center !== 'east');
    const shops = [...town.lots.values()].filter((l) => l.kind === 'shop' && l.state === 'occupied').length;
    host.innerHTML = `●街の地図 <small>(${shops}店・${town.districts.length - 2}地区＋中央)</small>
      <span class="town-find">住所で探す <input id="town-q" placeholder="1区2-4" size="8"> <button id="town-go" type="button">探す</button> <span id="town-miss" class="town-miss"></span></span>
      <div class="town-dsel" id="town-dsel"><a href="?" data-all="1">[全景]</a>${ds.map((d) => `<a href="?d=${d.no}" data-d="${d.id}">[${esc(shortName(d))}]</a>`).join('')}</div>
      <div class="town-win" id="town-win"><div class="zb"><button type="button" id="town-zin" aria-label="寄る">＋</button><button type="button" id="town-zout" aria-label="引く">－</button></div><div class="town-card" id="town-card"></div><div class="hint">ドラッグで動かす・ホイール／二本指で寄る引く・店を押すと札</div></div>
      <div id="town-list"></div>`;
    const win = host.querySelector('#town-win'), card = host.querySelector('#town-card'), listEl = host.querySelector('#town-list');
    const BASE = 16, b = T.bounds(town);
    const map = renderTop(town, { scale: BASE, labels: true, res: 2 });
    win.prepend(map);
    let zoom = 1, tx = 0, ty = 0, sel = null;
    // 動かすだけなら transform だけを変える (地名の大きさの変数は寄る引くときだけ。変えると地図の中の全部の札の描き直しになる)
    let lastZoom = 0;
    const apply = () => {
      map.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${zoom})`;
      if (zoom !== lastZoom) {
        lastZoom = zoom;
        map.classList.toggle('show-dlabels', zoom < 0.55);
        map.style.setProperty('--lz', String(Math.min(4, 0.9 / zoom)));
      }
      place();
    };
    const centerOn = (x, y, z) => { if (z) zoom = z; tx = win.clientWidth / 2 - x * zoom; ty = win.clientHeight / 2 - y * zoom; apply(); };
    const all = () => centerOn((b.w * BASE) / 2, (b.h * BASE) / 2, Math.min(win.clientWidth / (b.w * BASE), win.clientHeight / (b.h * BASE)) * 0.96);
    const mark = (d) => host.querySelectorAll('#town-dsel a').forEach((a) => a.classList.toggle('on', d ? a.dataset.d === (d.center ? town.districts[0].id : d.id) : !!a.dataset.all));
    const goD = (d) => {
      const z = Math.min(1, Math.min(win.clientWidth / ((d.w + 6) * BASE), win.clientHeight / ((d.h + 6) * BASE)));
      centerOn((d.x0 - b.x + d.w / 2) * BASE, (d.y0 - b.y + d.h / 2) * BASE, z);
      mark(d);
      list(d);
    };
    // スマホは札が下から出るので、店を画面の上寄りに
    const lotC = (l) => ({ x: (l.x - b.x + l.w / 2) * BASE, y: (l.y - b.y + l.h / 2) * BASE + (PHONE() ? win.clientHeight * 0.22 : 0) });
    const unhl = () => map.querySelectorAll('.lot.hl').forEach((x) => x.classList.remove('hl'));
    function show(id) {
      sel = id;
      unhl();
      map.querySelector(`.lot[data-lot="${id}"]`)?.classList.add('hl');
      const lot = town.lots.get(id), info = lotInfo(town, lot);
      let h = '<button type="button" class="x" id="town-x" aria-label="閉じる">×</button>';
      if (info.shop) {
        const s = info.shop, look = T.lookOf(s), a = addr(town, lot), c = T.homeColors(s.som, s.roof, s.door);
        h += `<div class="sn">${esc(s.shop)}${s.resting ? ' <small>改装中</small>' : ''}</div><div>${esc(s.owner)}${s.job ? ` 【${esc(s.job)}】` : ''}${s.rank ? ` <small>${s.rank}位</small>` : ''}</div>
          <div><span class="lbl">住所</span><b>${esc(a.short)}</b> <small>${esc(a.heading)}</small></div>
          <div><span class="lbl">店構え</span>${s.size} (棚${s.shelves}) <span class="lbl">屋根</span><i class="sw" style="background:${look.roof}"></i>${esc(T.ROOFS[c.roof - 1].name)} <span class="lbl">入口</span><i class="sw" style="background:${look.door}"></i>${esc(T.DOORS[c.door - 1].name)}</div>
          ${s.goods && s.goods.length ? `<ul>${s.goods.map((g) => `<li>${esc(g.name)} ${yen(g.price)} ×${g.stock}</li>`).join('')}</ul>` : '<ul><li>(棚は空)</li></ul>'}
          <div class="acts"><a href="${link('view/owner/' + encodeURIComponent(s.som))}">[店主ページ]</a> <a href="#" id="town-dl">[この地区の一覧]</a></div>`;
      } else {
        h += `<div class="sn">${esc(info.title)}</div><div>${esc(info.sub)}</div>${lot.kind === 'shop' ? `<div><span class="lbl">住所</span>${esc(addr(town, lot).short)}</div>` : ''}`;
      }
      card.innerHTML = h;
      card.classList.add('open');
      card.querySelector('#town-x').onclick = () => { card.classList.remove('open'); sel = null; unhl(); };
      card.querySelector('#town-dl')?.addEventListener('click', (e) => { e.preventDefault(); list(districtOf(town, lot)); listEl.scrollIntoView({ behavior: 'smooth' }); });
      place();
    }
    function place() {
      if (!sel || !card.classList.contains('open') || PHONE()) return;
      const c = lotC(town.lots.get(sel)), x = tx + c.x * zoom, y = ty + c.y * zoom;
      const right = x + 110 * zoom + card.offsetWidth < win.clientWidth - 50;
      card.style.left = Math.max(8, right ? x + 110 * zoom : x - 110 * zoom - card.offsetWidth) + 'px';
      card.style.top = Math.max(8, Math.min(win.clientHeight - card.offsetHeight - 8, y - card.offsetHeight / 2)) + 'px';
    }
    const focus = (l, z) => { const c = lotC(l); centerOn(c.x, c.y, z); show(l.id); };
    // 地区の一覧 (地図が見づらいとき・探したいとき)
    function list(d) {
      const ls = d.lots.filter((l) => l.kind === 'shop').sort((x, y) => x.row - y.row || x.number - y.number);
      if (!ls.length) { listEl.innerHTML = ''; return; }
      listEl.innerHTML = `●${esc(d.center ? d.name : addr(town, ls[0]).heading)}のお店<br><table><tr><td>住所</td><td>店</td><td>店主</td><td>職業</td><td>店構え</td></tr>${ls.map((l) => {
        const i = lotInfo(town, l), s = i.shop;
        const nm = s ? `<a href="#" data-lot="${l.id}">${esc(s.shop)}</a>${s.resting ? ' (改装中)' : ''}` : `<span class="town-dim">${esc(i.title)}</span>`;
        return `<tr><td class="nw">${esc(addr(town, l).short)}</td><td>${nm}</td><td>${s ? `<a href="${link('view/owner/' + encodeURIComponent(s.som))}">${esc(s.owner)}</a>` : ''}</td><td>${esc(s?.job ?? '')}</td><td>${s ? `${s.size} (棚${s.shelves})` : ''}</td></tr>`;
      }).join('')}</table><small>店の名前を押すと地図がその店へ。</small>`;
      listEl.querySelectorAll('a[data-lot]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); focus(town.lots.get(Number(a.dataset.lot)), Math.max(zoom, 0.9)); win.scrollIntoView({ behavior: 'smooth' }); }));
    }
    host.querySelector('#town-dsel').onclick = (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.all) { all(); mark(null); listEl.innerHTML = ''; history.replaceState(null, '', '?'); return; }
      const d = town.districts.find((x) => x.id === a.dataset.d);
      goD(d);
      history.replaceState(null, '', '?d=' + d.no);
    };
    const find = () => {
      const l = T.lotByAddress(town, host.querySelector('#town-q').value);
      host.querySelector('#town-miss').textContent = l ? '' : 'その住所はありません (例 1区2-4)';
      if (l) focus(l, 1);
    };
    host.querySelector('#town-go').onclick = find;
    host.querySelector('#town-q').onkeydown = (e) => { if (e.key === 'Enter') find(); };
    // ドラッグ・ホイール・ピンチ (1.2.1 で作り直し)
    // ・指やマウスの本数が変わるたびに、その時点の位置を起点に取り直す (ピンチのあと1本で動かしても跳ばない)
    // ・ピンチは2本の指の中心を軸に寄る引く、中心が動けば一緒に動く
    // ・押してから 6px 以上動いたらドラッグ扱いで、離しても札は開かない
    // ・描き直しは 1フレームに1回、地図は窓の外へ行き過ぎない
    let g = null, moved = 0, downLot = null, frame = 0;
    const pts = new Map();
    const center = () => { let x = 0, y = 0; for (const p of pts.values()) { x += p.x; y += p.y; } return { x: x / pts.size, y: y / pts.size }; };
    const spread = () => { const [p1, p2] = [...pts.values()]; return p2 ? Math.hypot(p1.x - p2.x, p1.y - p2.y) : 0; };
    const local = (p) => { const r = win.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
    const anchor = () => { g = pts.size ? { c: center(), d: spread(), tx, ty, z: zoom } : null; };
    const clamp = () => {
      // 地図の端が窓の内側に少なくとも 80px 残るように
      const mw = b.w * BASE * zoom, mh = b.h * BASE * zoom, k = 80;
      tx = Math.min(win.clientWidth - k, Math.max(k - mw, tx));
      ty = Math.min(win.clientHeight - k, Math.max(k - mh, ty));
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; clamp(); apply(); }); };
    const zoomAt = (cx, cy, f) => { const nz = Math.max(0.12, Math.min(2.2, zoom * f)); tx = cx - ((cx - tx) * nz) / zoom; ty = cy - ((cy - ty) * nz) / zoom; zoom = nz; later(); };
    win.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.town-card,.zb')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 押した区画は pointerdown で覚える (capture のあとの click は窓に向くため)
      if (!pts.size) { downLot = e.target.closest('.top-map > .lot'); moved = 0; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (pts.size >= 2) moved = Infinity; // つまんだら、離したあとに札は開かない
      anchor();
      try { win.setPointerCapture(e.pointerId); } catch { /* 合成のイベントなど */ }
      win.classList.add('grabbing');
      e.preventDefault();
    });
    win.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!g || !p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      moved = Math.max(moved, Math.hypot(p.x - p.sx, p.y - p.sy));
      // 1本のときは 6px 動くまでは動かさない (押しただけで地図が揺れない)。越えたら押した所から指について来る
      if (pts.size === 1 && moved < 6) return;
      const c = center();
      if (pts.size >= 2 && g.d > 0) {
        // 起点のときの中心の下にあった地図の点を、今の中心の下へ
        const nz = Math.max(0.12, Math.min(2.2, (g.z * spread()) / g.d));
        const c0 = local(g.c), c1 = local(c);
        tx = c1.x - ((c0.x - g.tx) * nz) / g.z;
        ty = c1.y - ((c0.y - g.ty) * nz) / g.z;
        zoom = nz;
      } else {
        tx = g.tx + c.x - g.c.x;
        ty = g.ty + c.y - g.c.y;
      }
      later();
    });
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      anchor();
      if (!pts.size) win.classList.remove('grabbing');
    };
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', up);
    win.addEventListener('lostpointercapture', up);
    // ホイール: マウスの位置を軸に寄る引く (トラックパッドのつまむ操作は ctrl 付きで届くので、量に合わせてなめらかに)
    win.addEventListener('wheel', (e) => {
      if (e.target.closest('.town-card') || e.deltaY === 0) return;
      e.preventDefault();
      const l = local({ x: e.clientX, y: e.clientY });
      zoomAt(l.x, l.y, e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    host.querySelector('#town-zin').onclick = () => zoomAt(win.clientWidth / 2, win.clientHeight / 2, 1.3);
    host.querySelector('#town-zout').onclick = () => zoomAt(win.clientWidth / 2, win.clientHeight / 2, 1 / 1.3);
    win.addEventListener('click', (e) => { if (moved >= 6 || e.target.closest('.town-card,.zb')) return; const l = downLot || e.target.closest('.top-map > .lot'); if (l) show(Number(l.dataset.lot)); });
    addEventListener('resize', place);
    // 開いたとき: ?lot= (区画) か ?at= (住所) ならその店、?d= ならその地区 (0 = 中央)、なければ全景 (スマホは中央)
    const at = (q.get('lot') && town.lots.get(Number(q.get('lot')))) || (q.get('at') && T.lotByAddress(town, q.get('at')));
    const dq = q.get('d');
    const dd = dq === null ? null : dq === '0' ? town.districts[0] : town.districts.find((x) => !x.center && x.no === Number(dq));
    if (at) { focus(at, 1); list(districtOf(town, at)); mark(districtOf(town, at)); }
    else if (dd) goD(dd);
    else if (PHONE()) goD(town.districts[0]);
    else { all(); mark(null); }
  }

  // ---------------------------------------------------------------------------
  // 小さな地図

  /** トップの小窓: 街全体。押すと街の地図のその地区へ */
  function mini(host, town, maxH) {
    const b = T.bounds(town);
    const sc = Math.min((host.clientWidth || 600) / b.w, (maxH || 300) / b.h);
    const m = renderTop(town, { scale: sc, labels: true, signs: false, res: 2 });
    m.classList.add('show-dlabels');
    m.style.setProperty('--lz', '0.32');
    host.style.height = b.h * sc + 'px';
    host.style.width = b.w * sc + 'px';
    host.appendChild(m);
    host.onclick = (e) => {
      const l = e.target.closest('.lot');
      const d = l && districtOf(town, town.lots.get(Number(l.dataset.lot)));
      location.href = link('view/town' + (d ? '?d=' + (d.center ? 0 : d.no) : ''));
    };
  }

  /** 店主ページ・店長室の「お店のまわり」: その店の地区だけ、店を真ん中に。押すと街の地図のその店へ */
  function around(host, town, som) {
    const lot = [...town.lots.values()].find((l) => l.holder === som && l.state === 'occupied');
    if (!lot) { host.remove(); return; }
    const d = districtOf(town, lot);
    const sc = 7, m = renderTop(town, { districts: [d], scale: sc, labels: false, highlight: lot.id, res: 3 });
    host.appendChild(m);
    const bb = T.bounds(town, [d]);
    // 地区が枠より小さければ枠を縮める (右に余白を残さない)
    if (bb.w * sc < host.clientWidth) host.style.width = bb.w * sc + 'px';
    if (bb.h * sc < host.clientHeight) host.style.height = bb.h * sc + 'px';
    const cx = (lot.x - bb.x + lot.w / 2) * sc, cy = (lot.y - bb.y + lot.h / 2) * sc;
    m.style.left = Math.min(0, Math.max(host.clientWidth - bb.w * sc, host.clientWidth / 2 - cx)) + 'px';
    m.style.top = Math.min(0, Math.max(host.clientHeight - bb.h * sc, host.clientHeight / 2 - cy)) + 'px';
    host.onclick = () => (location.href = link('view/town?lot=' + lot.id));
  }

  // ---------------------------------------------------------------------------
  // 色の見本 (/view/town/colors)。たてが屋根・よこが入口

  function colors(host, sizeSel, faceSel) {
    const base = T.PALETTES[0];
    const draw = () => {
      const size = sizeSel?.value || 'M', face = faceSel?.value || 'down';
      const w = T.HOME[size], sc = size === 'L' ? 10 : size === 'M' ? 14 : 22;
      let h = '<table class="town-colors"><tr><td></td>' + T.DOORS.map((c, i) => `<td>入口${i + 1}<br>${esc(c.name)}</td>`).join('') + '</tr>';
      T.ROOFS.forEach((r, ri) => {
        h += `<tr><td>屋根${ri + 1}<br>${esc(r.name)}</td>` + T.DOORS.map((_, di) => `<td><canvas data-r="${ri}" data-d="${di}" width="${(w + 1) * sc}" height="${(w + 1) * sc}"></canvas></td>`).join('') + '</tr>';
      });
      host.innerHTML = h + '</table>';
      host.querySelectorAll('canvas').forEach((c) => {
        const g = c.getContext('2d');
        g.fillStyle = '#b5b08c';
        g.fillRect(0, 0, c.width, c.height);
        const pal = { ...base, roof: T.ROOFS[Number(c.dataset.r)].hex, door: T.DOORS[Number(c.dataset.d)].hex };
        root.Tiles.building(g, { kind: 'shop', size, x: 0.5, y: 0.5, w, h: w, palette: pal, door: face }, sc, 0, 0);
      });
    };
    root.Tiles.withAssets(() => {
      draw();
      sizeSel?.addEventListener('change', draw);
      faceSel?.addEventListener('change', draw);
    });
  }

  /** ページの #town-* の場所に描く。town-data が無ければ何もしない */
  function boot() {
    const town = load();
    if (!town) return;
    root.Tiles.withAssets(() => {
      const p = document.getElementById('town-page');
      if (p) page(p, town);
      const m = document.getElementById('town-mini');
      if (m) mini(m, town, 300);
      document.querySelectorAll('[data-town-around]').forEach((el) => around(el, town, el.dataset.townAround));
    });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();

  root.TownView = { load, lotInfo, renderTop, page, mini, around, colors };
})(globalThis);
