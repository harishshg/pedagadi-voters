(() => {
  'use strict';
  const K = window.VOTER_KEYS;
  const V = window.VOTER_ROWS.map(r => {
    const o = {}; K.forEach((k, i) => o[k] = r[i]);
    o.id = o.ward + '-' + o.serial;
    // voters with no house number in the roll are kept as their own group, not merged together
    o.hkey = o.ward + '|' + (o.house_no || '— (not listed, #' + o.serial + ')');
    return o;
  });
  const byId = new Map(V.map(v => [v.id, v]));
  const households = new Map();
  V.forEach(v => { if (!households.has(v.hkey)) households.set(v.hkey, []); households.get(v.hkey).push(v); });

  // ---------- search normalisation ----------
  const isTelugu = s => /[ఀ-౿]/.test(s);
  const teNorm = s => s.replace(/([ా-ౌం])\1+/g, '$1').replace(/[‌‍\s]+/g, ' ').trim();
  const phon = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/ksh/g, 'ks').replace(/x/g, 'ks').replace(/chh/g, 'c').replace(/ch/g, 'c')
    .replace(/sh/g, 's').replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/ph/g, 'p')
    .replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/jh/g, 'j').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/(.)\1+/g, '$1');
  V.forEach(v => {
    v._te = teNorm(v.name + ' ' + v.relation_name);
    v._en = [v.name_en, v.relation_name_en].join(' ').split(/\s+/).map(phon).join(' ') + ' ' +
            phon(v.name_en) + ' ' + phon(v.relation_name_en);
    v._house = (v.house_no || '').toLowerCase();
  });

  // ---------- state ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
  };
  const marks = new Set(LS.get('pv_marks', []));
  const notes = LS.get('pv_notes', {});
  const saved = LS.get('pv_state', {});
  const S = Object.assign({ q: '', ward: 0, caste: 'all', rel: 'all', sort: 'serial', view: 'list' }, saved, { q: '' });
  const saveState = () => LS.set('pv_state', { ward: S.ward, caste: S.caste, rel: S.rel, sort: S.sort, view: S.view });

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const casteCls = c => c === 'Not specified' ? 'NS' : c;
  const casteLbl = c => c === 'Not specified' ? '—' : c;
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const photo = (v, cls = '') => v.photo
    ? `<img src="photos/${esc(v.photo)}" alt="" loading="lazy" decoding="async" class="${cls}">`
    : `<div class="ph ${cls}"></div>`;

  // ---------- filtering ----------
  function filtered() {
    const raw = S.q.trim();
    let list = V;
    if (S.view === 'marked') list = list.filter(v => marks.has(v.id));
    if (S.ward) list = list.filter(v => v.ward === S.ward);
    if (S.caste !== 'all') list = list.filter(v => v.caste === S.caste);
    if (S.rel !== 'all') list = list.filter(v => v.relation === S.rel);
    if (raw) {
      const toks = raw.split(/\s+/).filter(Boolean);
      list = list.filter(v => toks.every(t => {
        if (isTelugu(t)) return v._te.includes(teNorm(t));
        const tl = t.toLowerCase();
        if (/^\d+$/.test(t)) return String(v.serial) === t || v._house.startsWith(tl) || v._house.split(/[-/]/).includes(tl) || v.epic.toLowerCase().includes(tl);
        if (/\d/.test(t)) return v._house.includes(tl) || v.epic.toLowerCase().includes(tl);
        const p = phon(t);
        return p && (v._en.includes(p) || v.epic.toLowerCase().includes(tl));
      }));
    }
    const s = [...list];
    if (S.sort === 'name') s.sort((a, b) => a.name_en.localeCompare(b.name_en));
    else if (S.sort === 'house') s.sort((a, b) => a.ward - b.ward || natural(a.house_no, b.house_no) || a.serial - b.serial);
    else s.sort((a, b) => a.serial - b.serial);
    return s;
  }

  // ---------- rendering ----------
  const listEl = $('#list');
  let current = [], shown = 0, groups = [];
  const PAGE = 40;

  function hl(text, q) {
    text = esc(text);
    if (!q) return text;
    const toks = q.trim().split(/\s+/).filter(t => isTelugu(t) && t.length > 0);
    toks.forEach(t => { const tt = esc(teNorm(t)); if (tt) text = text.split(tt).join(`<mark>${tt}</mark>`); });
    return text;
  }

  function cardHTML(v) {
    return `<button class="card" data-id="${v.id}">
      ${photo(v)}
      <div class="body">
        <div class="nm">${hl(v.name || '(name not in list)', S.q)}</div>
        <div class="en">${esc(v.name_en)}</div>
        <div class="rel">${esc(v.relation)}: ${hl(v.relation_name || '—', S.q)}</div>
        <div class="meta"><span>Ward <b>${v.ward}</b></span><span>House <b>${esc(v.house_no || '—')}</b></span>
          <span class="tag ${casteCls(v.caste)}">${casteLbl(v.caste)}</span></div>
      </div>
      <span class="sn">#${v.serial}</span>
      ${marks.has(v.id) ? '<span class="markdot" title="Marked"></span>' : ''}
    </button>`;
  }

  function houseHTML(g) {
    const [w, h] = g.key.split('|');
    return `<div class="house"><div class="house-h"><span>Ward ${w} · House ${esc(h)}</span><small>${g.items.length} voter${g.items.length > 1 ? 's' : ''}</small></div>
      ${g.items.map(v => `<button class="member" data-id="${v.id}">${photo(v)}<div><div class="nm">${hl(v.name || '—', S.q)} ${marks.has(v.id) ? '<span class="tag" style="background:var(--mark)">★</span>' : ''}</div>
      <div class="en">${esc(v.name_en)} · ${esc(v.relation)}: ${esc(v.relation_name_en || '—')} · #${v.serial}</div></div></button>`).join('')}</div>`;
  }

  function render() {
    current = filtered();
    shown = 0; listEl.innerHTML = '';
    const isHouse = S.view === 'house';
    if (isHouse) {
      const m = new Map();
      current.forEach(v => { if (!m.has(v.hkey)) m.set(v.hkey, []); m.get(v.hkey).push(v); });
      groups = [...m.entries()].map(([key, items]) => ({ key, items: items.sort((a, b) => a.serial - b.serial) }))
        .sort((a, b) => a.items[0].ward - b.items[0].ward || natural(a.key.split('|')[1], b.key.split('|')[1]));
    }
    const n = current.length;
    const where = S.ward ? `Ward ${S.ward}` : 'All wards';
    $('#summary').textContent = isHouse
      ? `${groups.length.toLocaleString()} households · ${n.toLocaleString()} voters · ${where}`
      : `${n.toLocaleString()} voter${n === 1 ? '' : 's'} · ${where}${S.view === 'marked' ? ' · marked only' : ''}`;
    if (!n) {
      listEl.innerHTML = `<div class="empty">${S.view === 'marked' ? 'No marked voters yet.<br>Open a voter and tap “Mark”.' : 'No voters match your search.'}</div>`;
      return;
    }
    more();
  }

  function more() {
    const isHouse = S.view === 'house';
    const src = isHouse ? groups : current;
    if (shown >= src.length) return;
    const chunk = src.slice(shown, shown + (isHouse ? 15 : PAGE));
    listEl.insertAdjacentHTML('beforeend', chunk.map(isHouse ? houseHTML : cardHTML).join(''));
    shown += chunk.length;
  }
  new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px' }).observe($('#sentinel'));

  // ---------- chips ----------
  function chips(el, items, val, onPick) {
    el.innerHTML = items.map(([v, l]) => `<button class="chip ${v === val ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
    el.onclick = e => { const b = e.target.closest('.chip'); if (!b) return; onPick(b.dataset.v); };
  }
  function drawChips() {
    const wards = [[0, 'All wards']].concat([...Array(10)].map((_, i) => [i + 1, `Ward ${i + 1}`]));
    chips($('#wardChips'), wards, S.ward, v => { S.ward = +v; update(); });
    chips($('#casteChips'), [['all', 'All'], ['BC', 'BC'], ['SC', 'SC'], ['ST', 'ST'], ['Not specified', 'Not specified']], S.caste, v => { S.caste = v; update(); });
    chips($('#relChips'), [['all', 'All'], ['Father', 'Father (తండ్రి)'], ['Husband', 'Husband (భర్త)'], ['Mother', 'Mother (తల్లి)'], ['Not stated', 'Not stated']], S.rel, v => { S.rel = v; update(); });
    chips($('#sortChips'), [['serial', 'Serial no.'], ['name', 'Name (A–Z)'], ['house', 'House no.']], S.sort, v => { S.sort = v; update(); });
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    const fc = (S.caste !== 'all') + (S.rel !== 'all');
    $('#filterCount').textContent = fc ? fc : '';
  }
  function update() { saveState(); drawChips(); render(); window.scrollTo({ top: 0 }); }
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => { S.view = b.dataset.view; update(); });

  // ---------- search input ----------
  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    $('#clearQ').hidden = !q.value;
    clearTimeout(t); t = setTimeout(() => { S.q = q.value; render(); }, 120);
  });
  $('#clearQ').onclick = () => { q.value = ''; S.q = ''; $('#clearQ').hidden = true; render(); q.focus(); };

  // ---------- sheets (with back-button support) ----------
  const open = [];
  function openSheet(id) {
    const el = $(id); el.hidden = false; open.push(el);
    history.pushState({ sheet: id }, '');
    document.body.style.overflow = 'hidden';
  }
  function closeTop(fromPop) {
    const el = open.pop(); if (!el) return;
    el.hidden = true;
    if (!open.length) document.body.style.overflow = '';
    if (!fromPop) history.back();
  }
  window.addEventListener('popstate', () => { if (open.length) closeTop(true); });
  document.querySelectorAll('.sheet-backdrop').forEach(bd => bd.addEventListener('click', e => { if (e.target === bd) closeTop(); }));
  $('#filterBtn').onclick = () => openSheet('#filterSheet');
  $('#closeFilters').onclick = () => closeTop();
  $('#resetFilters').onclick = () => { S.caste = 'all'; S.rel = 'all'; S.sort = 'serial'; update(); };

  // ---------- detail ----------
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 1800); }
  function textOf(v) {
    return `${v.name} (${v.name_en})\n${v.relation}: ${v.relation_name} (${v.relation_name_en})\nWard ${v.ward} · Serial ${v.serial} · House ${v.house_no || '—'}\nEPIC: ${v.epic}\nAC list: 31-${v.ac_part}-${v.ac_serial}`;
  }
  function showDetail(id, replace) {
    const v = byId.get(id); if (!v) return;
    const fam = (households.get(v.hkey) || []).filter(x => x.id !== v.id);
    const marked = marks.has(v.id);
    $('#detail').innerHTML = `
      <div class="d-top">${photo(v)}
        <div><div class="nm">${esc(v.name || '(name not in list)')}</div><div class="en">${esc(v.name_en)}</div>
        <div style="margin-top:6px"><span class="tag ${casteCls(v.caste)}">${casteLbl(v.caste)}</span></div></div></div>
      <dl class="fields">
        <dt>${esc(v.relation)}</dt><dd>${esc(v.relation_name || '—')}<small>${esc(v.relation_name_en)}</small></dd>
        <dt>Ward</dt><dd>${v.ward}</dd>
        <dt>Serial no.</dt><dd>${v.serial}</dd>
        <dt>House no.</dt><dd>${esc(v.house_no || '—')}</dd>
        <dt>EPIC no.</dt><dd>${esc(v.epic)}</dd>
        <dt>Caste</dt><dd>${esc(v.caste)}</dd>
        <dt>AC list ref</dt><dd>31-${v.ac_part}-${v.ac_serial}</dd>
        <dt>Source</dt><dd>Ward ${v.ward} PDF, page ${v.page}</dd>
      </dl>
      <div class="d-actions">
        <button class="btn ${marked ? 'mark-on' : ''}" id="dMark">${marked ? '★ Marked' : '☆ Mark'}</button>
        <button class="btn" id="dCopy">Copy</button>
        <button class="btn" id="dShare">Share</button>
      </div>
      <textarea class="note" id="dNote" placeholder="Private note (saved on this phone only)">${esc(notes[v.id] || '')}</textarea>
      ${fam.length ? `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 4px;text-transform:uppercase">Same house (${fam.length})</h3>
        <div class="house">${fam.map(x => `<button class="member" data-fam="${x.id}">${photo(x)}<div><div class="nm">${esc(x.name || '—')}</div>
        <div class="en">${esc(x.name_en)} · ${esc(x.relation)}: ${esc(x.relation_name_en || '—')} · #${x.serial}</div></div></button>`).join('')}</div>` : ''}
      <div class="sheet-actions"><button class="btn primary" id="dClose">Close</button></div>`;
    $('#dClose').onclick = () => closeTop();
    $('#dMark').onclick = () => {
      marks.has(v.id) ? marks.delete(v.id) : marks.add(v.id);
      LS.set('pv_marks', [...marks]); showDetail(v.id, true); toast(marks.has(v.id) ? 'Marked' : 'Unmarked');
      if (S.view !== 'house') { const c = listEl.querySelector(`[data-id="${v.id}"]`); if (c) c.outerHTML = cardHTML(v); }
    };
    $('#dCopy').onclick = async () => { try { await navigator.clipboard.writeText(textOf(v)); toast('Copied'); } catch { toast('Copy not available'); } };
    $('#dShare').onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: v.name_en, text: textOf(v) }); } catch { } }
      else { try { await navigator.clipboard.writeText(textOf(v)); toast('Copied (share not supported)'); } catch { } }
    };
    $('#dNote').oninput = e => { const val = e.target.value.trim(); if (val) notes[v.id] = val; else delete notes[v.id]; LS.set('pv_notes', notes); };
    $('#detail').querySelectorAll('[data-fam]').forEach(b => b.onclick = () => { showDetail(b.dataset.fam, true); $('#detailSheet .sheet').scrollTop = 0; });
    if (!replace) openSheet('#detailSheet');
  }
  listEl.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) showDetail(b.dataset.id); });

  // ---------- stats ----------
  const COLORS = { BC: 'var(--bc)', SC: 'var(--sc)', ST: 'var(--st)', 'Not specified': 'var(--ns)' };
  function bar(c, total) {
    return `<div class="bar">${Object.keys(COLORS).map(k => c[k] ? `<i style="width:${c[k] / total * 100}%;background:${COLORS[k]}"></i>` : '').join('')}</div>`;
  }
  function count(arr, f) { const c = {}; arr.forEach(v => c[f(v)] = (c[f(v)] || 0) + 1); return c; }
  $('#statsBtn').onclick = () => {
    const c = count(V, v => v.caste), r = count(V, v => v.relation);
    const rows = [...Array(10)].map((_, i) => {
      const w = V.filter(v => v.ward === i + 1), cc = count(w, v => v.caste);
      return `<tr data-ward="${i + 1}"><td>Ward ${i + 1}</td><td>${w.length}</td><td>${new Set(w.map(v => v.hkey)).size}</td><td>${cc.BC || 0}</td><td>${cc.SC || 0}</td><td>${cc.ST || 0}</td><td>${cc['Not specified'] || 0}</td></tr>`;
    }).join('');
    $('#stats').innerHTML = `<h2>Pedagadi at a glance</h2>
      <div class="stat-grid">
        <div class="stat"><b>${V.length.toLocaleString()}</b><span>Voters</span></div>
        <div class="stat"><b>${households.size.toLocaleString()}</b><span>Households</span></div>
        <div class="stat"><b>${marks.size}</b><span>Marked</span></div>
      </div>
      <h3>Caste category</h3>${bar(c, V.length)}
      <div class="legend">${Object.keys(COLORS).map(k => `<span><i style="background:${COLORS[k]}"></i>${k} ${c[k] || 0} (${((c[k] || 0) / V.length * 100).toFixed(1)}%)</span>`).join('')}</div>
      <h3>Relation listed</h3>
      <div class="legend"><span>Father ${r.Father || 0}</span><span>Husband ${r.Husband || 0}</span><span>Mother ${r.Mother || 0}</span><span>Not stated ${r['Not stated'] || 0}</span></div>
      <h3>By ward (tap a row to open)</h3>
      <table class="st"><thead><tr><th>Ward</th><th>Voters</th><th>Houses</th><th>BC</th><th>SC</th><th>ST</th><th>—</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td>Total</td><td>${V.length}</td><td>${households.size}</td><td>${c.BC || 0}</td><td>${c.SC || 0}</td><td>${c.ST || 0}</td><td>${c['Not specified'] || 0}</td></tr></tbody></table>
      <p style="font-size:12px;color:var(--muted);margin-top:14px">Source: SEC Andhra Pradesh Gram Panchayat electoral roll 2026, published 15-04-2026, age reference date 01-01-2026. Marks and notes are stored only on this device.</p>
      <div class="sheet-actions"><button class="btn primary" id="sClose">Close</button></div>`;
    $('#sClose').onclick = () => closeTop();
    $('#stats').querySelectorAll('tr[data-ward]').forEach(tr => tr.onclick = () => { S.ward = +tr.dataset.ward; S.view = 'list'; closeTop(); update(); });
    openSheet('#statsSheet');
  };

  drawChips(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
