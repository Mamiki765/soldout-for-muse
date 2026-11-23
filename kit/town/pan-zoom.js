// SOLD OUT for Muse — キットの地図専用ドラッグ・ピンチ (GPL v2 or later).
// canvas を描き直さず、地図全体を CSS transform だけで動かす。
(function (root) {
  'use strict';
  function create(win, layer, onTap) {
    const pointers = new Map();
    let zoom = 1, tx = 0, ty = 0, frame = 0, gesture = null, moved = false, downTarget = null;

    const local = (x, y) => {
      const r = win.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    const center = () => {
      let x = 0, y = 0;
      for (const p of pointers.values()) { x += p.x; y += p.y; }
      return { x: x / pointers.size, y: y / pointers.size };
    };
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    function anchor() {
      gesture = pointers.size ? { c: center(), d: spread(), tx, ty, z: zoom } : null;
    }
    function clamp() {
      // 地図が窓から消えないよう、上下左右に少なくとも80pxを残す。
      const w = layer.offsetWidth * zoom, h = layer.offsetHeight * zoom, k = 80;
      tx = Math.min(win.clientWidth - k, Math.max(k - w, tx));
      ty = Math.min(win.clientHeight - k, Math.max(k - h, ty));
    }
    function paint() {
      frame = 0;
      clamp();
      layer.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + zoom + ')';
      layer.classList.toggle('zoomed-out', zoom < 0.55);
      layer.style.setProperty('--label-zoom', String(Math.min(4, 0.9 / zoom)));
    }
    const later = () => { if (!frame) frame = requestAnimationFrame(paint); };
    function zoomAt(x, y, factor) {
      const next = Math.max(0.12, Math.min(2.2, zoom * factor));
      tx = x - (x - tx) * next / zoom;
      ty = y - (y - ty) * next / zoom;
      zoom = next;
      later();
    }
    function fit() {
      const w = layer.offsetWidth, h = layer.offsetHeight;
      if (!w || !h) return;
      zoom = Math.max(0.12, Math.min(2.2, 0.95 * Math.min(win.clientWidth / w, win.clientHeight / h)));
      tx = (win.clientWidth - w * zoom) / 2;
      ty = (win.clientHeight - h * zoom) / 2;
      later();
    }

    win.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,.town-popup') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (!pointers.size) { moved = false; downTarget = e.target; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (pointers.size >= 2) moved = true; // ピンチ後はタップ扱いしない
      anchor();
      try { win.setPointerCapture(e.pointerId); } catch { /* capture 不可の環境 */ }
      win.classList.add('dragging');
      e.preventDefault();
    });
    win.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p || !gesture) return;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) >= 6) moved = true;
      if (pointers.size === 1 && !moved) return; // 6px 未満は地図を動かさない
      const c = center();
      if (pointers.size >= 2 && gesture.d > 0) {
        const next = Math.max(0.12, Math.min(2.2, gesture.z * spread() / gesture.d));
        const before = local(gesture.c.x, gesture.c.y), after = local(c.x, c.y);
        tx = after.x - (before.x - gesture.tx) * next / gesture.z;
        ty = after.y - (before.y - gesture.ty) * next / gesture.z;
        zoom = next;
      } else {
        tx = gesture.tx + c.x - gesture.c.x;
        ty = gesture.ty + c.y - gesture.c.y;
      }
      later();
    });
    function up(e) {
      if (!pointers.has(e.pointerId)) return;
      const last = pointers.size === 1;
      pointers.delete(e.pointerId);
      anchor(); // 指の本数が変わったら起点を取り直す
      if (!pointers.size) {
        win.classList.remove('dragging');
        if (last && !moved && downTarget) onTap(downTarget);
        downTarget = null;
      }
    }
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', (e) => { moved = true; up(e); });
    win.addEventListener('lostpointercapture', up);
    win.addEventListener('wheel', (e) => {
      if (e.target.closest('button,.town-popup') || !e.deltaY) return;
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    return { fit, zoomAt, get zoom() { return zoom; } };
  }
  root.TownPanZoom = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
