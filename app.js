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
  const S = Object.assign({ q: '', ward: 0, caste: 'all', rel: 'all', sort: 'serial', view: 'list', surname: '' }, saved, { q: '' });
  const saveState = () => LS.set('pv_state', { ward: S.ward, caste: S.caste, rel: S.rel, sort: S.sort, view: S.view, surname: S.surname });
  // surname index: standard spelling -> { te, en, n }
  const SURNAMES = new Map();
  V.forEach(v => { if (!v.surname) return; const s = SURNAMES.get(v.surname) || { te: v.surname, en: v.surname_en, n: 0 }; s.n++; SURNAMES.set(v.surname, s); });
  if (S.surname && !SURNAMES.has(S.surname)) S.surname = '';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const casteCls = c => c === 'Not specified' ? 'NS' : c;
  const casteLbl = c => c === 'Not specified' ? '—' : c;
  const wardPill = v => `<span class="wpill">Ward ${v.ward}</span>`;
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
    if (S.surname) list = list.filter(v => v.surname === S.surname);
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
    else if (S.sort === 'surname') s.sort((a, b) => (a.surname_en || '~').localeCompare(b.surname_en || '~') || a.name_en.localeCompare(b.name_en));
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
        <div class="nm-row"><div class="nm">${hl(v.name || '(name not in list)', S.q)}</div>${wardPill(v)}</div>
        <div class="en">${esc(v.name_en)}</div>
        <div class="rel">${esc(v.relation)}: ${hl(v.relation_name || '—', S.q)}</div>
        <div class="meta"><span>House <b>${esc(v.house_no || '—')}</b></span>
          <span class="tag ${casteCls(v.caste)}">${casteLbl(v.caste)}</span></div>
      </div>
      <span class="sn">#${v.serial}</span>
      ${marks.has(v.id) ? '<span class="markdot" title="Marked"></span>' : ''}
    </button>`;
  }

  function houseHTML(g) {
    const [w, h] = g.key.split('|');
    return `<div class="house"><div class="house-h"><span>Ward ${w} · House ${esc(h)}</span><small>${g.items.length} voter${g.items.length > 1 ? 's' : ''}</small></div>
      ${g.items.map(v => `<button class="member" data-id="${v.id}">${photo(v)}<div class="m-body"><div class="nm-row"><div class="nm">${hl(v.name || '—', S.q)}</div>${wardPill(v)}${marks.has(v.id) ? '<span class="tag star" style="background:var(--mark)">★</span>' : ''}</div>
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
    chips($('#sortChips'), [['serial', 'Serial no.'], ['name', 'Name (A–Z)'], ['surname', 'Surname (A–Z)'], ['house', 'House no.']], S.sort, v => { S.sort = v; update(); });
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    const fc = (S.caste !== 'all') + (S.rel !== 'all') + !!S.surname;
    $('#filterCount').textContent = fc ? fc : '';
    // surname dropdown + active filter chips
    const sn = S.surname && SURNAMES.get(S.surname);
    const sb = $('#surnameSelect');
    sb.innerHTML = `<span>${sn ? `${esc(sn.te)} · ${esc(sn.en)} (${sn.n})` : 'All surnames'}</span>`;
    sb.classList.toggle('on', !!sn);
    $('#surnameClear').hidden = !sn;
    const af = [];
    if (sn) af.push(`<button class="af" data-clear="surname">${esc(sn.te)} · ${esc(sn.en)} <b>×</b></button>`);
    if (S.caste !== 'all') af.push(`<button class="af" data-clear="caste">${esc(S.caste)} <b>×</b></button>`);
    if (S.rel !== 'all') af.push(`<button class="af" data-clear="rel">${esc(S.rel)} <b>×</b></button>`);
    $('#activeFilters').innerHTML = af.join('');
  }
  $('#activeFilters').onclick = e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const k = b.dataset.clear; S[k] = k === 'surname' ? '' : 'all'; update();
  };
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
  // each open sheet owns one history entry, so the phone's Back button closes the top sheet
  let ownPops = 0;
  function hideTop() {
    const el = open.pop(); if (!el) return;
    el.hidden = true;
    if (!open.length) document.body.style.overflow = '';
  }
  function closeTop(n = 1) {
    n = Math.min(n, open.length); if (!n) return;
    for (let i = 0; i < n; i++) hideTop();
    ownPops++; history.go(-n);
  }
  window.addEventListener('popstate', () => { if (ownPops) { ownPops--; return; } hideTop(); });
  document.querySelectorAll('.sheet-backdrop').forEach(bd => bd.addEventListener('click', e => { if (e.target === bd) closeTop(); }));
  // close (×) button in the top corner + swipe down to close, for every sheet
  document.querySelectorAll('.sheet').forEach(sh => {
    const g = sh.querySelector('.grab');
    const top = document.createElement('div'); top.className = 'sheet-top';
    top.innerHTML = '<div class="grab"></div><button class="sheet-x" aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z" transform="translate(.6 0)"/></svg></button>';
    g ? g.replaceWith(top) : sh.prepend(top);
    top.querySelector('.sheet-x').onclick = () => closeTop();
    let y0 = 0, dy = 0, t0 = 0, drag = false, ok = false;
    // a drag only closes the sheet when nothing under the finger is scrolled down
    const atTop = el => { for (; el && el !== sh.parentNode; el = el.parentNode) if (el.scrollTop > 0) return false; return true; };
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { ok = false; return; }
      ok = top.contains(e.target) || atTop(e.target);
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); drag = false;
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (!ok) return;
      const d = e.touches[0].clientY - y0;
      if (!drag) { if (d > 8) { drag = true; sh.style.transition = 'none'; } else if (d < -4) { ok = false; return; } else return; }
      dy = Math.max(0, d - 8);
      sh.style.transform = `translateY(${dy}px)`;
      e.preventDefault();
    }, { passive: false });
    const end = () => {
      if (!drag) return; drag = false;
      const fast = dy > 40 && dy / (Date.now() - t0) > 0.5;
      sh.style.transition = 'transform .2s ease-out';
      if (dy > Math.min(140, sh.offsetHeight * 0.25) || fast) {
        sh.style.transform = 'translateY(100%)';
        setTimeout(() => { closeTop(); sh.style.transition = ''; sh.style.transform = ''; }, 180);
      } else { sh.style.transform = ''; setTimeout(() => { sh.style.transition = ''; }, 200); }
    };
    sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
  });
  $('#filterBtn').onclick = () => openSheet('#filterSheet');
  $('#closeFilters').onclick = () => closeTop();
  $('#resetFilters').onclick = () => { S.caste = 'all'; S.rel = 'all'; S.sort = 'serial'; S.surname = ''; update(); };

  // ---------- surname picker (searchable dropdown) ----------
  let pickSort = 'count';
  function drawSurnameList() {
    const raw = $('#surnameQ').value.trim();
    const counts = new Map();
    // counts follow the ward chosen on the main screen
    V.forEach(v => { if (v.surname && (!S.ward || v.ward === S.ward)) counts.set(v.surname, (counts.get(v.surname) || 0) + 1); });
    let items = [...counts.entries()].map(([k, n]) => ({ k, n, te: SURNAMES.get(k).te, en: SURNAMES.get(k).en }));
    if (raw) {
      const te = isTelugu(raw), p = phon(raw);
      items = items.filter(s => te ? teNorm(s.te).includes(teNorm(raw)) : phon(s.en).includes(p));
    }
    items.sort(pickSort === 'az' ? (a, b) => a.en.localeCompare(b.en) : (a, b) => b.n - a.n || a.en.localeCompare(b.en));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const all = raw ? '' : `<button class="opt ${!S.surname ? 'sel' : ''}" data-s=""><div class="o-main"><div class="o-te">All surnames</div><div class="o-en">${counts.size} surnames${S.ward ? ' in Ward ' + S.ward : ''}</div></div><span class="o-n">${total}</span></button>`;
    $('#surnameList').innerHTML = all + (items.length ? items.map(s =>
      `<button class="opt ${s.k === S.surname ? 'sel' : ''}" data-s="${esc(s.k)}" role="option"><div class="o-main"><div class="o-te">${esc(s.te)}</div><div class="o-en">${esc(s.en)}</div></div><span class="o-n">${s.n}</span></button>`).join('')
      : '<div class="empty">No surname matches.</div>');
  }
  function openSurnamePicker() {
    $('#surnameQ').value = '';
    const drawSort = () => chips($('#surnameSort'), [['count', 'Most voters'], ['az', 'A–Z']], pickSort, v => { pickSort = v; drawSort(); drawSurnameList(); });
    drawSort();
    drawSurnameList();
    openSheet('#surnameSheet');
    $('#surnameList').scrollTop = 0;
  }
  $('#surnameSelect').onclick = openSurnamePicker;
  $('#surnameClear').onclick = () => { S.surname = ''; update(); };
  $('#surnameQ').addEventListener('input', drawSurnameList);
  $('#surnameList').onclick = e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    S.surname = b.dataset.s;
    // close the picker (and the filters sheet under it) and show the results
    closeTop(open.length);
    update();
  };

  // ---------- detail ----------
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 1800); }
  function textOf(v) {
    return `${v.name} (${v.name_en}) – Ward ${v.ward}\n${v.relation}: ${v.relation_name} (${v.relation_name_en})\nWard ${v.ward} · Serial ${v.serial} · House ${v.house_no || '—'}\nEPIC: ${v.epic}\nAC list: 31-${v.ac_part}-${v.ac_serial}`;
  }
  function showDetail(id, replace) {
    const v = byId.get(id); if (!v) return;
    const fam = (households.get(v.hkey) || []).filter(x => x.id !== v.id);
    const marked = marks.has(v.id);
    $('#detail').innerHTML = `
      <div class="d-top">${photo(v)}
        <div><div class="nm">${esc(v.name || '(name not in list)')}</div><div class="en">${esc(v.name_en)}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${wardPill(v)}<span class="tag ${casteCls(v.caste)}">${casteLbl(v.caste)}</span></div></div></div>
      <dl class="fields">
        <dt>${esc(v.relation)}</dt><dd>${esc(v.relation_name || '—')}<small>${esc(v.relation_name_en)}</small></dd>
        <dt>Ward</dt><dd>${v.ward}</dd>
        <dt>Serial no.</dt><dd>${v.serial}</dd>
        <dt>Surname</dt><dd>${v.surname ? `${esc(v.surname)} · ${esc(v.surname_en)}<small><button class="linkish" id="dSurname">See all ${SURNAMES.get(v.surname).n} ${esc(v.surname_en)} voters</button></small>` : '—'}</dd>
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
      <textarea class="note" id="dNote" placeholder="${cloud.code ? 'Note (synced with your sync code)' : 'Private note (saved on this phone only)'}">${esc(notes[v.id] || '')}</textarea>
      ${fam.length ? `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 4px;text-transform:uppercase">Same house (${fam.length})</h3>
        <div class="house">${fam.map(x => `<button class="member" data-fam="${x.id}">${photo(x)}<div class="m-body"><div class="nm-row"><div class="nm">${esc(x.name || '—')}</div>${wardPill(x)}</div>
        <div class="en">${esc(x.name_en)} · ${esc(x.relation)}: ${esc(x.relation_name_en || '—')} · #${x.serial}</div></div></button>`).join('')}</div>` : ''}
      <div class="sheet-actions"><button class="btn primary" id="dClose">Close</button></div>`;
    $('#dClose').onclick = () => closeTop();
    $('#dMark').onclick = () => {
      marks.has(v.id) ? marks.delete(v.id) : marks.add(v.id);
      LS.set('pv_marks', [...marks]); cloud.put('m', v.id, marks.has(v.id) || null); showDetail(v.id, true); toast(marks.has(v.id) ? 'Marked' : 'Unmarked');
      if (S.view !== 'house') { const c = listEl.querySelector(`[data-id="${v.id}"]`); if (c) c.outerHTML = cardHTML(v); }
    };
    $('#dCopy').onclick = async () => { try { await navigator.clipboard.writeText(textOf(v)); toast('Copied'); } catch { toast('Copy not available'); } };
    $('#dShare').onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: v.name_en, text: textOf(v) }); } catch { } }
      else { try { await navigator.clipboard.writeText(textOf(v)); toast('Copied (share not supported)'); } catch { } }
    };
    $('#dNote').oninput = e => { const val = e.target.value.trim(); if (val) notes[v.id] = val; else delete notes[v.id]; LS.set('pv_notes', notes); cloud.put('n', v.id, notes[v.id] || null); };
    $('#detail').querySelectorAll('[data-fam]').forEach(b => b.onclick = () => { showDetail(b.dataset.fam, true); $('#detailSheet .sheet').scrollTop = 0; });
    if ($('#dSurname')) $('#dSurname').onclick = () => {
      S.surname = v.surname; S.ward = 0; if (S.view === 'marked') S.view = 'list';
      q.value = ''; S.q = ''; $('#clearQ').hidden = true;
      closeTop(open.length); update();
    };
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
      <p class="photo-status" style="font-size:13px;margin-top:14px">${photoStatusText()}</p>
      <p style="font-size:12px;color:var(--muted);margin-top:8px">Source: SEC Andhra Pradesh Gram Panchayat electoral roll 2026, published 15-04-2026, age reference date 01-01-2026. ${cloud.code ? 'Marks and notes sync across devices that use your sync code.' : 'Marks and notes are stored only on this device. Tap the cloud button to sync them across devices.'}</p>
      <div class="sheet-actions"><button class="btn primary" id="sClose">Close</button></div>`;
    $('#sClose').onclick = () => closeTop();
    $('#stats').querySelectorAll('tr[data-ward]').forEach(tr => tr.onclick = () => { S.ward = +tr.dataset.ward; S.view = 'list'; closeTop(); update(); });
    openSheet('#statsSheet');
  };

  // ---------- share & install ----------
  const APP_URL = 'https://harishshg.github.io/pedagadi-voters/';
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const inAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|; wv\)/i.test(ua);
  const iosNotSafari = isIOS && (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) || inAppBrowser);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferredPrompt = null;

  async function doInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') toast('Installing…');
    renderInstallBox();
  }
  function renderInstallBox() {
    const box = $('#installBox');
    const share = '<span class="kbd">Share ⬆︎</span>';
    if (isStandalone()) { box.innerHTML = '✓ <b>Installed.</b> You are using the app.'; return; }
    if (deferredPrompt) {
      box.innerHTML = `<b>Install on this device</b><div>Adds an app icon to your home screen. Works offline.</div><button class="btn primary" id="ibDo">Install app</button>`;
      $('#ibDo').onclick = doInstall; return;
    }
    if (iosNotSafari) {
      box.innerHTML = `<b>Open in Safari to install</b><ol><li>Tap <b>Copy link</b> below</li><li>Open <b>Safari</b> and paste the link</li><li>Tap ${share} → <b>Add to Home Screen</b></li></ol>`; return;
    }
    if (isIOS) {
      box.innerHTML = `<b>Install on iPhone / iPad</b><ol><li>Tap ${share} at the bottom of Safari</li><li>Scroll down, tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>`; return;
    }
    if (isAndroid) {
      box.innerHTML = `<b>Install on Android</b><ol>${inAppBrowser ? '<li>Tap ⋮ → <b>Open in Chrome</b></li>' : ''}<li>Tap <span class="kbd">⋮</span> at the top right of Chrome</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li></ol>`; return;
    }
    box.innerHTML = `<b>Install on computer</b><div>In Chrome or Edge, click the install icon at the right end of the address bar. On a phone, scan the QR code below.</div>`;
  }
  function openShare() { renderInstallBox(); $('#appLink').textContent = APP_URL; updatePhotoUI(); openSheet('#shareSheet'); }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (!$('#shareSheet').hidden) renderInstallBox(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('App installed'); });
  $('#shareAppBtn').onclick = openShare;
  $('#shClose').onclick = () => closeTop();
  const shareText = 'Pedagadi voter list app – open and tap Install / Add to Home Screen:';
  $('#shShare').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Pedagadi Voters 2026', text: shareText, url: APP_URL }); } catch { } }
    else { try { await navigator.clipboard.writeText(APP_URL); toast('Link copied'); } catch { toast(APP_URL); } }
  };
  $('#shCopy').onclick = async () => { try { await navigator.clipboard.writeText(APP_URL); toast('Link copied'); } catch { toast(APP_URL); } };
  $('#shWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + APP_URL), '_blank');
  // ---------- cloud sync of marks + notes (Firebase Firestore, REST) ----------
  // Devices that use the same sync code share one document: lists/<code> { m: {id: true}, n: {id: "note"} }
  const FIREBASE = { apiKey: 'AIzaSyBeWCjXWcZqS9C_hxuLTW_lKljXutuY4gU', projectId: 'voter-list-552ea', host: 'https://firestore.googleapis.com' };
  const cloud = {
    code: LS.get('pv_sync_code', ''), q: LS.get('pv_sync_q', {}), last: LS.get('pv_sync_last', 0),
    busy: false, err: '', timer: 0, hist: LS.get('pv_sync_hist', []),
    get ready() { return !!(FIREBASE.apiKey && FIREBASE.projectId); },
    url(extra = '') {
      return `${FIREBASE.host}/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/lists/${encodeURIComponent(this.code)}?key=${FIREBASE.apiKey}${extra}`;
    },
    // record a change; value null = remove. Changes wait in a queue (kept offline) until sent.
    put(type, id, val) {
      if (!this.code) return;
      this.q[type + ':' + id] = val; LS.set('pv_sync_q', this.q);
      clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), type === 'n' ? 1200 : 300);
      drawSyncDot();
    },
    async flush() {
      const keys = Object.keys(this.q);
      for (let i = 0; i < keys.length; i += 80) {
        const part = keys.slice(i, i + 80), sent = {};
        const body = { fields: { m: { mapValue: { fields: {} } }, n: { mapValue: { fields: {} } } } };
        const mask = part.map(k => {
          const [t, id] = [k[0], k.slice(2)], val = this.q[k]; sent[k] = val;
          if (val !== null) body.fields[t].mapValue.fields[id] = t === 'm' ? { booleanValue: true } : { stringValue: String(val) };
          return 'updateMask.fieldPaths=' + encodeURIComponent(`${t}.\`${id}\``);
        });
        const r = await fetch(this.url('&' + mask.join('&')), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('save ' + r.status);
        part.forEach(k => { if (this.q[k] === sent[k]) delete this.q[k]; });
        LS.set('pv_sync_q', this.q);
      }
    },
    async pull() {
      const r = await fetch(this.url(), { cache: 'no-store' });
      if (r.status === 404) return { m: {}, n: {} };
      if (!r.ok) throw new Error('load ' + r.status);
      const f = (await r.json()).fields || {};
      return { m: (f.m && f.m.mapValue.fields) || {}, n: (f.n && f.n.mapValue.fields) || {} };
    },
    async sync() {
      if (!this.code || !this.ready || this.busy) return;
      if (!navigator.onLine) { this.err = 'offline'; drawSyncDot(); return; }
      this.busy = true; drawSyncDot();
      try {
        await this.flush();
        this.apply(await this.pull());
        this.last = Date.now(); LS.set('pv_sync_last', this.last); this.err = '';
        this.remember(this.code);
      } catch (e) { this.err = navigator.onLine ? 'error' : 'offline'; }
      this.busy = false; drawSyncDot();
      if (Object.keys(this.q).length && !this.err) this.sync();
    },
    // make this device's marks and notes match the cloud copy (plus changes not yet sent)
    apply(d) {
      // the cloud copy wins, except for changes still waiting to be sent
      const m = new Set(Object.keys(d.m).filter(id => d.m[id].booleanValue)), n = {};
      Object.keys(d.n).forEach(id => { if (d.n[id].stringValue) n[id] = d.n[id].stringValue; });
      Object.entries(this.q).forEach(([k, val]) => {
        const id = k.slice(2);
        if (k[0] === 'm') val ? m.add(id) : m.delete(id); else if (val) n[id] = val; else delete n[id];
      });
      const changed = m.size !== marks.size || [...m].some(id => !marks.has(id));
      marks.clear(); m.forEach(id => marks.add(id)); LS.set('pv_marks', [...marks]);
      const editing = document.activeElement && document.activeElement.id === 'dNote';
      if (!editing) { Object.keys(notes).forEach(k => delete notes[k]); Object.assign(notes, n); LS.set('pv_notes', notes); }
      if (changed) refreshMarks();
    },
    // codes used on this device, newest first
    remember(c) {
      if (!c) return;
      this.hist = [{ code: c, t: Date.now() }].concat(this.hist.filter(h => h.code !== c)).slice(0, 12);
      LS.set('pv_sync_hist', this.hist);
    },
    forget(c) { this.hist = this.hist.filter(h => h.code !== c); LS.set('pv_sync_hist', this.hist); },
    // open a recent code: this device's marks are replaced by that list's cloud copy (not merged)
    async switchTo(c) {
      if (!navigator.onLine) { toast('Connect to the internet to switch codes'); return false; }
      if (this.busy) return false;
      this.busy = true; drawSyncDot();
      const old = this.code;
      // unsent changes still go to the list they were made in, then they are dropped from this device
      if (old && Object.keys(this.q).length) { try { await this.flush(); } catch { } }
      try {
        this.code = c;
        const d = await this.pull();
        this.q = {}; LS.set('pv_sync_q', {}); LS.set('pv_sync_code', c);
        const dn = $('#dNote'); if (dn) dn.blur();
        this.apply(d);
        if (old) this.remember(old);
        this.remember(c);
        this.last = Date.now(); LS.set('pv_sync_last', this.last); this.err = '';
        this.busy = false; drawSyncDot(); render();
        return true;
      } catch {
        this.code = old; this.busy = false; drawSyncDot();
        toast('Could not load that code. Try again.'); return false;
      }
    },
    join(code) {
      this.code = code; LS.set('pv_sync_code', code);
      // add this device's existing marks and notes to the shared list
      marks.forEach(id => this.q['m:' + id] = true);
      Object.entries(notes).forEach(([id, val]) => this.q['n:' + id] = val);
      LS.set('pv_sync_q', this.q);
      return this.sync();
    },
    leave() { this.remember(this.code); this.code = ''; this.q = {}; this.err = ''; LS.set('pv_sync_code', ''); LS.set('pv_sync_q', {}); drawSyncDot(); }
  };
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode = () => { const a = crypto.getRandomValues(new Uint8Array(8)); return 'PDG-' + [...a].map((x, i) => (i === 4 ? '-' : '') + CODE_CHARS[x % CODE_CHARS.length]).join(''); };
  // accepts "pdg 5pwy dmbb", "PDG-5PWY-DMBB" or just "5PWYDMBB"
  const cleanCode = s => {
    let c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length === 8) c = 'PDG' + c;
    return /^PDG[A-Z0-9]{8}$/.test(c) ? `PDG-${c.slice(3, 7)}-${c.slice(7)}` : c;
  };
  const validCode = c => /^PDG-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c);
  const syncLink = () => APP_URL + '#sync=' + cloud.code;

  // update the stars on cards already on screen, without losing the scroll position
  function refreshMarks() {
    if (S.view === 'marked') { render(); return; }
    listEl.querySelectorAll('.card[data-id]').forEach(c => { c.outerHTML = cardHTML(byId.get(c.dataset.id)); });
    listEl.querySelectorAll('.member[data-id]').forEach(b => {
      const row = b.querySelector('.nm-row'), star = row.querySelector('.star'), on = marks.has(b.dataset.id);
      if (on && !star) row.insertAdjacentHTML('beforeend', '<span class="tag star" style="background:var(--mark)">★</span>');
      if (!on && star) star.remove();
    });
  }
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleDateString();
  }
  function drawSyncDot() {
    const b = $('#syncBtn'); if (!b) return;
    const st = !cloud.code ? 'off' : cloud.busy ? 'busy' : cloud.err ? 'err' : Object.keys(cloud.q).length ? 'busy' : 'ok';
    b.dataset.st = st;
    if (!$('#syncSheet').hidden) drawSync();
  }
  function drawSync() {
    const box = $('#syncBody');
    if (!cloud.ready) {
      box.innerHTML = `<p>Sync isn't set up yet. The app owner needs to add the Firebase settings.</p>`; return;
    }
    const recent = cloud.hist.filter(h => h.code !== cloud.code);
    const recentHTML = recent.length ? `<h3>Recent codes on this device</h3>
      <div class="recent">${recent.map(h => `<div class="rc-row"><button class="rc-open" data-code="${esc(h.code)}"><b>${esc(h.code)}</b><small>Last used ${ago(h.t)}</small></button>
        <button class="rc-x" data-forget="${esc(h.code)}" aria-label="Remove ${esc(h.code)} from this list">×</button></div>`).join('')}</div>
      <p class="hint">Opening a recent code replaces the marks and notes on this device with that code's saved copy.</p>` : '';
    const bindRecent = () => box.querySelectorAll('.rc-open').forEach(b => b.onclick = async () => {
      const c = b.dataset.code;
      if (!confirm(`Open ${c}?\nMarks and notes on this device will be replaced by the ones saved under ${c}.`)) return;
      b.disabled = true;
      if (await cloud.switchTo(c)) toast(`Switched to ${c} · ${marks.size} marked`);
      drawSync();
    });
    box.onclick = e => { const x = e.target.closest('[data-forget]'); if (x) { cloud.forget(x.dataset.forget); drawSync(); } };
    if (!cloud.code) {
      box.innerHTML = `<p class="sync-lead">Marks and notes are saved on this device only. Turn on sync to see the same marks on all your devices.</p>
        <button class="btn primary w100" id="syNew">Create a sync code</button>
        <div class="sync-or">or, if you already have a code</div>
        <div class="sync-join"><input id="syCode" placeholder="PDG-XXXX-XXXX" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn" id="syJoin">Join</button></div>
        <p class="hint">Anyone who has your code can see and change these marks and notes. Share it only with people you trust.</p>${recentHTML}`;
      bindRecent();
      $('#syNew').onclick = async () => { await cloud.join(newCode()); toast(cloud.err ? 'Saved here, will sync when online' : 'Sync is on'); };
      $('#syJoin').onclick = async () => {
        const c = cleanCode($('#syCode').value);
        if (!validCode(c)) { toast('Code looks like PDG-XXXX-XXXX'); return; }
        await cloud.join(c); toast(cloud.err ? 'Could not reach the server, will retry' : 'Joined. Marks synced');
      };
      return;
    }
    const pend = Object.keys(cloud.q).length;
    const status = cloud.busy ? 'Syncing…' : cloud.err === 'offline' ? `Offline. ${pend} change${pend === 1 ? '' : 's'} will sync when you're back online.`
      : cloud.err ? 'Could not sync. Will try again.' : pend ? `${pend} change${pend === 1 ? '' : 's'} waiting…` : cloud.last ? `✓ Synced ${ago(cloud.last)} · ${marks.size} marked` : 'Not synced yet';
    box.innerHTML = `<p class="sync-lead">Sync is on. Use this code on your other devices, or open the link there.</p>
      <div class="sync-code">${esc(cloud.code)}</div>
      <p class="sync-status">${status}</p>
      <div class="share-actions">
        <button class="btn primary wide" id="syShare">Share code / link</button>
        <button class="btn" id="syNow">Sync now</button>
        <button class="btn" id="syCopy">Copy code</button>
      </div>
      <p class="hint">Changes sync automatically when you mark someone, open the app, or come back to it. Anyone who has this code can see and change the marks.</p>
      ${recentHTML}
      <button class="btn ghost w100 danger" id="syOff">Stop syncing on this device</button>`;
    bindRecent();
    $('#syNow').onclick = () => cloud.sync();
    $('#syCopy').onclick = async () => { try { await navigator.clipboard.writeText(cloud.code); toast('Code copied'); } catch { toast(cloud.code); } };
    $('#syShare').onclick = async () => {
      const text = `Pedagadi Voters sync code: ${cloud.code}\nOpen this link to sync marks:`;
      if (navigator.share) { try { await navigator.share({ title: 'Sync code', text, url: syncLink() }); } catch { } }
      else { try { await navigator.clipboard.writeText(text + ' ' + syncLink()); toast('Copied'); } catch { } }
    };
    $('#syOff').onclick = () => { if (confirm('Stop syncing on this device? Your marks stay on this device and in the cloud.')) { cloud.leave(); drawSync(); toast('Sync turned off'); } };
  }
  $('#syncBtn').onclick = () => { drawSync(); openSheet('#syncSheet'); if (cloud.code) cloud.sync(); };
  $('#syClose').onclick = () => closeTop();
  // a shared link like …/#sync=PDG-XXXX-XXXX joins that list
  const hashCode = cleanCode((location.hash.match(/sync=([^&]+)/) || [])[1]);
  if (hashCode) {
    history.replaceState(null, '', location.pathname + location.search);
    if (hashCode !== cloud.code && cloud.ready && validCode(hashCode) &&
        confirm(`Sync marks with code ${hashCode}?${cloud.code ? '\nThis replaces your current code ' + cloud.code + '.' : ''}`))
      cloud.join(hashCode).then(() => toast(cloud.err ? 'Will sync when online' : 'Joined. Marks synced'));
  }
  drawSyncDot();
  cloud.sync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.sync(); });
  window.addEventListener('online', () => cloud.sync());
  setInterval(() => { if (document.visibilityState === 'visible') cloud.sync(); }, 60000);
  // ---------- download all photos in the background (for fast scrolling + offline) ----------
  const PHOTO_CACHE = 'pv-photos';
  const photoState = { done: 0, total: V.filter(v => v.photo).length, running: false, finished: false };
  const pbar = $('#photoBar');
  function photoStatusText() {
    if (!('caches' in window)) return 'Offline photos not supported in this browser.';
    if (photoState.finished) return `✓ All ${photoState.total.toLocaleString()} photos saved for offline use.`;
    return `Saving photos for offline use: ${photoState.done.toLocaleString()} / ${photoState.total.toLocaleString()}`;
  }
  function updatePhotoUI() {
    const pct = photoState.total ? photoState.done / photoState.total * 100 : 0;
    pbar.hidden = !photoState.running;
    pbar.firstElementChild.style.width = pct + '%';
    document.querySelectorAll('.photo-status').forEach(el => el.textContent = photoStatusText());
  }
  async function cacheAllPhotos() {
    if (!('caches' in window) || photoState.running || !location.protocol.startsWith('http')) return;
    photoState.running = true;
    try {
      const cache = await caches.open(PHOTO_CACHE);
      const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
      const todo = [];
      V.forEach(v => {
        if (!v.photo) return;
        const u = new URL('photos/' + v.photo, location.href);
        if (have.has(u.pathname)) photoState.done++; else todo.push(u.href);
      });
      updatePhotoUI();
      let i = 0, fails = 0;
      const worker = async () => {
        while (i < todo.length) {
          const url = todo[i++];
          try { const r = await fetch(url); if (r.ok) { await cache.put(url, r); photoState.done++; } else fails++; }
          catch { fails++; }
          if (photoState.done % 25 === 0) updatePhotoUI();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      photoState.finished = photoState.done >= photoState.total;
      if (todo.length && photoState.finished) toast('All photos saved for offline use');
    } catch { }
    photoState.running = false;
    updatePhotoUI();
  }
  // start shortly after the list has rendered; retry when the connection comes back
  window.addEventListener('load', () => setTimeout(cacheAllPhotos, 1500));
  window.addEventListener('online', () => { if (!photoState.finished) cacheAllPhotos(); });

  drawChips(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
