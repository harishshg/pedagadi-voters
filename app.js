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
            phon(v.name_en) + ' ' + phon(v.relation_name_en) +
            (v.alt_en ? ' ' + v.alt_en.split(/\s+/).map(phon).join(' ') : '');   // older spellings still match
    v._house = (v.house_no || '').toLowerCase();
  });

  // ---------- state ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
  };
  const marks = new Set(LS.get('pv_marks', []));
  const notes = LS.get('pv_notes', {});
  // family groups made by the user: { gid: { name, v: { voterId: true } } } (synced with the sync code)
  const FAM = LS.get('pv_fam', {});
  Object.values(FAM).forEach(g => { g.t = g.t || 'family'; g.v = g.v || {}; g.s = g.s || {}; g.x = g.x || {}; });
  const saveFam = () => LS.set('pv_fam', FAM);
  const saved = LS.get('pv_state', {});
  const S = Object.assign({ q: '', ward: 0, caste: 'all', rel: 'all', sort: 'serial', view: 'list', surname: '', group: '', gtype: 'all', snf: 'all', snsort: 'count', cgrp: '', fgrp: '', marked: false, gsort: 'name' }, saved, { q: '' });
  if (S.view === 'family' && S.gtype === 'caste') S.view = 'caste';  // the old combined Groups tab
  if (saved.group) { if (((LS.get('pv_fam', {})[saved.group]) || {}).t === 'caste') S.cgrp = saved.group; else S.fgrp = saved.group; }
  const isGroupView = () => S.view === 'family' || S.view === 'caste';
  const saveState = () => LS.set('pv_state', { ward: S.ward, caste: S.caste, rel: S.rel, sort: S.sort, view: S.view, surname: S.surname, cgrp: S.cgrp, fgrp: S.fgrp, marked: S.marked, gsort: S.gsort, snf: S.snf, snsort: S.snsort });
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
    if (S.marked && S.view !== 'marked') list = list.filter(v => marks.has(v.id));
    // caste group / family: a group id, or 'none' = not in any group of that kind
    [['cgrp', 'caste'], ['fgrp', 'family']].forEach(([k, t]) => {
      const val = S[k]; if (!val) return;
      if (val === 'none') { const inAny = new Set(); Object.keys(FAM).forEach(gid => { if (gType(gid) === t) gMembers(gid).forEach((_, id) => inAny.add(id)); }); list = list.filter(v => !inAny.has(v.id)); }
      else if (FAM[val]) { const m = gMembers(val); list = list.filter(v => m.has(v.id)); }
      else S[k] = '';
    });
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

  function render() { renderList(); if (!$('#filterSheet').hidden) drawFilterSheet(); }
  function renderList() {
    current = filtered();
    shown = 0; listEl.innerHTML = '';
    const isHouse = S.view === 'house';
    if (S.view === 'surnames') {
      groups = snRows();
      const castes = Object.keys(FAM).filter(gid => gType(gid) === 'caste').sort((a, b) => famName(a).localeCompare(famName(b)));
      const all = snRows(true), none = all.filter(r => !r.castes.length).length, inCaste = all.length - none;
      $('#summary').textContent = `${groups.length} surname${groups.length === 1 ? '' : 's'}${S.ward ? ' in Ward ' + S.ward : ''}`;
      const chip = (k, l) => `<button class="chip ${S.snf === k ? 'on' : ''}" data-snf="${k}">${l}</button>`;
      const tab = (k, l, n) => `<button class="${S.snf === k || (k === 'any' && FAM[S.snf]) ? 'on' : ''}" data-snf="${k}">${l}<b>${n}</b></button>`;
      const pct = all.length ? Math.round(inCaste / all.length * 100) : 0;
      listEl.innerHTML = `<div class="sn-tabs">${tab('none', 'Not assigned', none)}${tab('any', 'Assigned', inCaste)}${tab('all', 'All', all.length)}</div>
        <div class="sn-progress" title="${pct}% of surnames have a caste"><i style="width:${pct}%"></i></div>
        ${(S.snf === 'any' || FAM[S.snf]) && castes.length ? `<div class="chips wrap g-types">${chip('any', 'Every caste')}${castes.map(gid => chip(gid, `🏷️ ${esc(famName(gid))} ${all.filter(r => r.castes.includes(gid)).length}`)).join('')}</div>` : ''}
        <div class="sn-tools"><span>Sort:</span>${[['count', 'Most voters'], ['az', 'A–Z']].map(([k, l]) => `<button class="chip ${S.snsort === k ? 'on' : ''}" data-snsort="${k}">${l}</button>`).join('')}
        <button class="chip" data-new="caste">＋ New caste</button></div>` +
        (groups.length ? '' : `<div class="empty">${S.snf === 'none' && !S.q.trim() ? '🎉 Every surname has a caste.' : S.snf === 'any' && !S.q.trim() ? 'No surname has a caste yet.<br>Open “Not assigned”, select surnames and tap “Set caste”.' : 'No surname matches.'}</div>`);
      more(); return;
    }
    if (isGroupView()) {
      const t = S.view, T = GT[t];
      groups = famGroups(t);
      const nv = new Set(groups.flatMap(g => g.items.map(v => v.id))).size, any = Object.keys(FAM).some(gid => gType(gid) === t);
      $('#summary').textContent = `${groups.length} ${groups.length === 1 ? T.label.toLowerCase() : T.plural.toLowerCase()} · ${nv.toLocaleString()} voters`;
      listEl.innerHTML = `<button class="btn primary w100 fam-new" data-new="${t}">＋ New ${T.label.toLowerCase()}</button>` +
        (groups.length ? '' : `<div class="empty">${any ? `No ${T.label.toLowerCase()} matches.` : t === 'caste'
          ? 'No castes yet.<br>Tap “New caste”, or go to <b>Surnames</b>, select surnames and tap “Set caste”.'
          : 'No families yet.<br>Tap “New family”, or open a voter and tap “Add to group”.'}</div>`);
      more(); return;
    }
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
    const isHouse = S.view === 'house', isFam = isGroupView(), isSn = S.view === 'surnames';
    const src = isHouse || isFam || isSn ? groups : current;
    if (shown >= src.length) return;
    const chunk = src.slice(shown, shown + (isSn ? 60 : isHouse || isFam ? 15 : PAGE));
    listEl.insertAdjacentHTML('beforeend', chunk.map(isSn ? snHTML : isFam ? famHTML : isHouse ? houseHTML : cardHTML).join(''));
    shown += chunk.length;
    paintSel();
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
    document.querySelectorAll('#viewSeg button[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    // Houses and Marked live in the More menu; the More button shows which one is open
    const mb = $('#moreBtn'), inMore = S.view === 'house' || S.view === 'marked';
    mb.classList.toggle('on', inMore);
    mb.firstChild.textContent = S.view === 'house' ? 'Houses' : S.view === 'marked' ? 'Marked' : 'More';
    const fc = S.view === 'surnames' ? (S.snf !== 'all') + (S.snsort !== 'count')
      : (S.caste !== 'all') + (S.rel !== 'all') + !!S.surname + !!S.cgrp + !!S.fgrp + (S.marked && S.view !== 'marked');
    $('#filterCount').textContent = fc ? fc : '';
    // surname dropdown + active filter chips
    const sn = S.surname && SURNAMES.get(S.surname);
    const sb = $('#surnameSelect');
    sb.innerHTML = `<span>${sn ? `${esc(sn.te)} · ${esc(sn.en)} (${sn.n})` : 'All surnames'}</span>`;
    sb.classList.toggle('on', !!sn);
    $('#surnameClear').hidden = !sn;
    const af = [];
    if (S.view !== 'surnames') {
      if (S.cgrp) af.push(`<button class="af" data-clear="cgrp">${S.cgrp === 'none' ? 'Not in a caste' : esc(gLabel(S.cgrp))} <b>×</b></button>`);
      if (S.fgrp) af.push(`<button class="af" data-clear="fgrp">${S.fgrp === 'none' ? 'Not in a family' : esc(gLabel(S.fgrp))} <b>×</b></button>`);
      if (S.marked && S.view !== 'marked') af.push(`<button class="af" data-clear="marked">★ Marked only <b>×</b></button>`);
    }
    if (sn && S.view !== 'surnames') af.push(`<button class="af" data-clear="surname">${esc(sn.te)} · ${esc(sn.en)} <b>×</b></button>`);
    if (S.caste !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="caste">${esc(S.caste)} <b>×</b></button>`);
    if (S.rel !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="rel">${esc(S.rel)} <b>×</b></button>`);
    $('#activeFilters').innerHTML = af.join('');
  }
  $('#activeFilters').onclick = e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const k = b.dataset.clear; S[k] = k === 'marked' ? false : ['surname', 'cgrp', 'fgrp'].includes(k) ? '' : 'all'; update();
  };
  function update() { saveState(); drawChips(); render(); window.scrollTo({ top: 0 }); if (selecting) drawSelBar(); }
  const setView = v => { if (selecting) leaveSelect(); S.view = v; update(); };
  document.querySelectorAll('#viewSeg button[data-view]').forEach(b => b.onclick = () => { setView(b.dataset.view); b.scrollIntoView({ inline: 'nearest', block: 'nearest' }); });
  const moreMenu = $('#moreMenu');
  function toggleMore(show) {
    show = show ?? moreMenu.hidden;
    if (show) {
      $('#mmMarkedN').textContent = marks.size || '';
      moreMenu.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
      const r = $('#moreBtn').getBoundingClientRect();
      moreMenu.style.top = (r.bottom + 6) + 'px'; moreMenu.style.right = Math.max(8, innerWidth - r.right) + 'px';
    }
    moreMenu.hidden = !show; $('#moreBtn').setAttribute('aria-expanded', show);
  }
  $('#moreBtn').onclick = e => { e.stopPropagation(); toggleMore(); };
  moreMenu.addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { toggleMore(false); setView(b.dataset.view); } });
  document.addEventListener('click', e => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) toggleMore(false); });
  window.addEventListener('scroll', () => { if (!moreMenu.hidden) toggleMore(false); }, { passive: true });

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
    el.style.zIndex = 50 + open.length;  // the newest sheet is always on top
    history.pushState({ sheet: id }, '');
    document.body.style.overflow = 'hidden';
  }
  // if a sheet is already open further down, close the ones above it instead of opening it twice
  function raise(id) { const i = open.indexOf($(id)); if (i < 0) return false; closeTop(open.length - 1 - i); return true; }
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
  window.addEventListener('popstate', () => { if (ownPops) { ownPops--; return; } if (open.length) hideTop(); else if (selecting) exitSelect(); });
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
  $('#filterBtn').onclick = () => { drawFilterSheet(); openSheet('#filterSheet'); };
  $('#closeFilters').onclick = () => closeTop();
  $('#resetFilters').onclick = () => {
    if (S.view === 'surnames') { S.snf = 'all'; S.snsort = 'count'; }
    else Object.assign(S, { caste: 'all', rel: 'all', sort: 'serial', surname: '', cgrp: '', fgrp: '', marked: false, gsort: 'name' });
    update();
  };
  // the sheet only shows what makes sense on the open tab
  const chipRow = (k, items, val) => `<div class="chips wrap">${items.map(([v, l]) => `<button class="chip ${String(v) === String(val) ? 'on' : ''}" data-fk="${k}" data-fv="${esc(v)}">${l}</button>`).join('')}</div>`;
  function drawFilterSheet() {
    const v = S.view, isSn = v === 'surnames', isG = isGroupView();
    const castes = Object.keys(FAM).filter(gid => gType(gid) === 'caste').sort((a, b) => famName(a).localeCompare(famName(b)));
    const fams = Object.keys(FAM).filter(gid => gType(gid) === 'family').sort((a, b) => famName(a).localeCompare(famName(b)));
    $('#fsTitle').textContent = isSn ? 'Surnames: filter & sort' : isG ? `${GT[v].plural}: filter & sort` : v === 'house' ? 'Houses: filters' : 'Filters & sort';
    $('#fsVoters').hidden = isSn;
    $('#fsSurnames').innerHTML = isSn ? `<h3>Show</h3>${chipRow('snf', [['none', 'Not assigned'], ['any', 'Assigned'], ['all', 'All']], S.snf)}
      ${castes.length ? `<h3>In caste</h3>${chipRow('snf', castes.map(gid => [gid, '🏷️ ' + esc(famName(gid))]), S.snf)}` : ''}
      <h3>Sort by</h3>${chipRow('snsort', [['count', 'Most voters'], ['az', 'A–Z']], S.snsort)}
      <p class="hint">Use the ward chips at the top to see one ward’s surnames.</p>` : '';
    $('#fsGroupSort').innerHTML = isG ? `<h3>Sort ${GT[v].plural.toLowerCase()} by</h3>${chipRow('gsort', [['name', 'Name (A–Z)'], ['size', 'Most voters']], S.gsort)}
      <p class="hint">The filters below narrow down the people shown in each ${GT[v].label.toLowerCase()}.</p>` : '';
    $('#fsCaste').innerHTML = castes.length && v !== 'caste' ? `<h3>Caste group</h3>${chipRow('cgrp', [['', 'Any'], ['none', 'Not in a caste'], ...castes.map(gid => [gid, '🏷️ ' + esc(famName(gid))])], S.cgrp)}` : '';
    $('#fsFamily').innerHTML = fams.length && v !== 'family' ? `<h3>Family</h3>${chipRow('fgrp', [['', 'Any'], ['none', 'Not in a family'], ...fams.map(gid => [gid, '👪 ' + esc(famName(gid))])], S.fgrp)}` : '';
    $('#fsMarked').innerHTML = v === 'marked' ? '' : `<h3>Marked</h3>${chipRow('marked', [['', 'Everyone'], ['1', `★ Only marked (${marks.size})`]], S.marked ? '1' : '')}`;
    $('#fsSort').hidden = !(v === 'list' || v === 'marked');
    const n = isSn || isG || v === 'house' ? groups.length : current.length;
    const what = isSn ? 'surname' : isG ? GT[v].label.toLowerCase() : v === 'house' ? 'house' : 'voter';
    $('#closeFilters').textContent = `Show ${n.toLocaleString()} ${n === 1 ? what : what === 'family' ? 'families' : what + 's'}`;
  }
  $('#filterSheet').addEventListener('click', e => {
    const b = e.target.closest('[data-fk]'); if (!b) return;
    const k = b.dataset.fk, val = b.dataset.fv;
    if (k === 'marked') S.marked = val === '1'; else S[k] = val;
    update();
  });

  // ---------- surname picker (searchable dropdown) ----------
  let pickSort = 'count', pickFor = '';  // pickFor = group id when choosing surnames for a group
  function drawSurnameList() {
    const raw = $('#surnameQ').value.trim();
    const counts = new Map(), forG = pickFor && FAM[pickFor];
    // counts follow the ward chosen on the main screen (whole village when adding to a group)
    V.forEach(v => { if (v.surname && (forG || !S.ward || v.ward === S.ward)) counts.set(v.surname, (counts.get(v.surname) || 0) + 1); });
    let items = [...counts.entries()].map(([k, n]) => ({ k, n, te: SURNAMES.get(k).te, en: SURNAMES.get(k).en }));
    if (raw) {
      const te = isTelugu(raw), p = phon(raw);
      items = items.filter(s => te ? teNorm(s.te).includes(teNorm(raw)) : phon(s.en).includes(p));
    }
    items.sort(pickSort === 'az' ? (a, b) => a.en.localeCompare(b.en) : (a, b) => b.n - a.n || a.en.localeCompare(b.en));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (forG) {
      $('#surnameList').innerHTML = items.length ? items.map(s => { const on = !!forG.s[s.k];
        return `<button class="opt ${on ? 'sel' : ''}" data-s="${esc(s.k)}"><div class="o-main"><div class="o-te">${on ? '✓ ' : ''}${esc(s.te)}</div><div class="o-en">${esc(s.en)}</div></div><span class="o-n">${s.n}</span></button>`; }).join('')
        : '<div class="empty">No surname matches.</div>';
      return;
    }
    const all = raw ? '' : `<button class="opt ${!S.surname ? 'sel' : ''}" data-s=""><div class="o-main"><div class="o-te">All surnames</div><div class="o-en">${counts.size} surnames${S.ward ? ' in Ward ' + S.ward : ''}</div></div><span class="o-n">${total}</span></button>`;
    $('#surnameList').innerHTML = all + (items.length ? items.map(s =>
      `<button class="opt ${s.k === S.surname ? 'sel' : ''}" data-s="${esc(s.k)}" role="option"><div class="o-main"><div class="o-te">${esc(s.te)}</div><div class="o-en">${esc(s.en)}</div></div><span class="o-n">${s.n}</span></button>`).join('')
      : '<div class="empty">No surname matches.</div>');
  }
  function openSurnamePicker(gid) {
    pickFor = typeof gid === 'string' ? gid : '';
    $('#surnameSheet h2').textContent = pickFor ? `Add surnames to ${famName(pickFor)}` : 'Choose surname';
    $('#surnameQ').value = '';
    const drawSort = () => chips($('#surnameSort'), [['count', 'Most voters'], ['az', 'A–Z']], pickSort, v => { pickSort = v; drawSort(); drawSurnameList(); });
    drawSort();
    drawSurnameList();
    openSheet('#surnameSheet');
    $('#surnameList').scrollTop = 0;
  }
  $('#surnameSelect').onclick = () => openSurnamePicker();
  $('#surnameClear').onclick = () => { S.surname = ''; update(); };
  $('#surnameQ').addEventListener('input', drawSurnameList);
  $('#surnameList').onclick = e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (pickFor && FAM[pickFor]) {
      // choosing surnames for a group: toggle, stay open so several can be picked
      const on = !FAM[pickFor].s[b.dataset.s]; gSurname(pickFor, b.dataset.s, on);
      toast(on ? 'Surname added' : 'Surname removed'); drawSurnameList(); showFam(pickFor, true); return;
    }
    S.surname = b.dataset.s;
    // close the picker (and the filters sheet under it) and show the results
    closeTop(open.length);
    update();
  };

  // ---------- detail ----------
  // "★ Marked by Ravi's phone · 2 h ago" (only for synced lists)
  function whoLine(t, id) {
    const w = cloud.code && cloud.who[t + ':' + id]; if (!w || !w.by) return '';
    const by = w.d === cloud.dev ? 'you (this device)' : w.by;
    return `<p class="who">${t === 'm' ? '★ Marked' : '✎ Note'} by <b>${esc(by)}</b>${w.t ? ' · ' + ago(w.t) : ''}</p>`;
  }
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 1800); }
  function textOf(v) {
    return `${v.name} (${v.name_en}) – Ward ${v.ward}\n${v.relation}: ${v.relation_name} (${v.relation_name_en})\nWard ${v.ward} · Serial ${v.serial} · House ${v.house_no || '—'}\nEPIC: ${v.epic}\nAC list: 31-${v.ac_part}-${v.ac_serial}`;
  }
  function showDetail(id, replace) {
    const v = byId.get(id); if (!v) return;
    $('#detailSheet')._vid = id;
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
        <dt>Groups</dt><dd class="fam-dd">${Object.keys(FAM).filter(gid => inGroup(gid, v.id)).map(gid => `<button class="fam-chip" data-fam-open="${gid}">${esc(gLabel(gid))}</button>`).join('')}<button class="fam-chip add" id="dFam">＋ Add to group</button></dd>
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
      ${marked ? whoLine('m', v.id) : ''}
      <textarea class="note" id="dNote" placeholder="${cloud.code ? 'Note (synced with your sync code)' : 'Private note (saved on this phone only)'}">${esc(notes[v.id] || '')}</textarea>
      ${notes[v.id] ? whoLine('n', v.id) : ''}
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
    $('#dFam').onclick = () => showFamPick(v.id);
    $('#detail').querySelectorAll('[data-fam-open]').forEach(b => b.onclick = () => showFam(b.dataset.famOpen));
    $('#detail').querySelectorAll('[data-fam]').forEach(b => b.onclick = () => { showDetail(b.dataset.fam, true); $('#detailSheet .sheet').scrollTop = 0; });
    if ($('#dSurname')) $('#dSurname').onclick = () => {
      S.surname = v.surname; S.ward = 0; if (S.view === 'marked') S.view = 'list';
      q.value = ''; S.q = ''; $('#clearQ').hidden = true;
      closeTop(open.length); update();
    };
    if (!replace && !raise('#detailSheet')) openSheet('#detailSheet');
  }
  listEl.addEventListener('click', e => {
    const nw = e.target.closest('[data-new]'); if (nw) { famCreate(nw.dataset.new); return; }
    const sf = e.target.closest('[data-snf]'); if (sf) { S.snf = sf.dataset.snf; saveState(); render(); if (selecting) drawSelBar(); return; }
    const ss = e.target.closest('[data-snsort]'); if (ss) { S.snsort = ss.dataset.snsort; saveState(); render(); return; }
    const sr = e.target.closest('[data-sn]');
    if (sr) { if (pressed) { pressed = false; return; } if (selecting) toggleSel(sr.dataset.sn); else showSurname(sr.dataset.sn); return; }
    const gl = e.target.closest('[data-fam-list]'); if (gl) { showGroupInList(gl.dataset.famList); return; }
    const f = e.target.closest('[data-fam-open]'); if (f) { showFam(f.dataset.famOpen); return; }
    const b = e.target.closest('[data-id]'); if (!b) return;
    if (pressed) { pressed = false; return; }  // the click that ends a long-press
    if (selecting) toggleSel(b.dataset.id); else showDetail(b.dataset.id);
  });

  // ---------- multi-select: tap "Select" or long-press a voter, then act on all of them ----------
  const sel = new Set(); let selecting = false, pressed = false, pressT = 0, pressXY = null;
  function paintSel() {
    listEl.classList.toggle('selecting', selecting);
    if (!selecting) { listEl.querySelectorAll('.picked').forEach(el => el.classList.remove('picked')); return; }
    const k = selKey();
    listEl.querySelectorAll(`[data-${k}]`).forEach(el => el.classList.toggle('picked', sel.has(el.dataset[k])));
  }
  // in the Surnames tab you select surnames, everywhere else voters
  const selKey = () => S.view === 'surnames' ? 'sn' : 'id';
  function drawSelBar() {
    const bar = $('#selBar'); bar.hidden = !selecting;
    document.body.classList.toggle('has-selbar', selecting);
    $('#selN').innerHTML = `${sel.size}<span> selected</span>`;
    $('#selMark').disabled = $('#selGroup').disabled = !sel.size;
    $('#selMark').hidden = S.view === 'surnames';
    $('#selGroup').textContent = S.view === 'surnames' ? '🏷️ Set caste' : '＋ Group';
    const all = visibleIds();
    $('#selAll').textContent = all.length && all.every(id => sel.has(id)) ? 'Clear' : `All ${all.length.toLocaleString()}`;
    $('#selectBtn').hidden = selecting;
  }
  // the voters on screen right now (after search and filters)
  function visibleIds() {
    if (S.view === 'surnames') return groups.map(r => r.k);
    if (isGroupView()) return [...new Set(groups.flatMap(g => g.items.map(v => v.id)))];
    return current.map(v => v.id);
  }
  function enterSelect(first) {
    if (!selecting) { selecting = true; history.pushState({ select: 1 }, ''); }
    if (first) sel.add(first);
    paintSel(); drawSelBar();
  }
  function exitSelect() { selecting = false; sel.clear(); paintSel(); drawSelBar(); }
  // leave select mode from a button: go back over its history entry (and any sheets on top)
  function leaveSelect() { const n = open.length; for (let i = 0; i < n; i++) hideTop(); exitSelect(); ownPops++; history.go(-(n + 1)); }
  function toggleSel(id) {
    sel.has(id) ? sel.delete(id) : sel.add(id);
    listEl.querySelectorAll(`[data-${selKey()}="${CSS.escape(id)}"]`).forEach(el => el.classList.toggle('picked', sel.has(id)));
    drawSelBar();
  }
  listEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-id], [data-sn]'); if (!b || selecting) return;
    pressXY = [e.clientX, e.clientY];
    pressT = setTimeout(() => { pressed = true; if (navigator.vibrate) navigator.vibrate(15); enterSelect(b.dataset.sn || b.dataset.id); }, 500);
  });
  const cancelPress = e => { if (pressT && (!e || !pressXY || e.type !== 'pointermove' || Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 10)) { clearTimeout(pressT); pressT = 0; } };
  ['pointerup', 'pointercancel', 'pointermove'].forEach(t => listEl.addEventListener(t, cancelPress));
  listEl.addEventListener('contextmenu', e => { if (e.target.closest('[data-id]')) e.preventDefault(); });
  $('#selectBtn').onclick = () => enterSelect();
  $('#selX').onclick = () => leaveSelect();
  $('#selAll').onclick = () => {
    const all = visibleIds();
    if (all.length && all.every(id => sel.has(id))) sel.clear(); else all.forEach(id => sel.add(id));
    paintSel(); drawSelBar();
  };
  $('#selMark').onclick = () => {
    const ids = [...sel], on = !ids.every(id => marks.has(id));
    ids.forEach(id => { if (on) marks.add(id); else marks.delete(id); cloud.put('m', id, on || null); });
    LS.set('pv_marks', [...marks]); refreshMarks(); paintSel();
    toast(`${on ? 'Marked' : 'Unmarked'} ${ids.length}`);
  };
  $('#selGroup').onclick = () => S.view === 'surnames' ? showBulkSnPick() : showBulkPick();
  // add the selected voters to a group
  function showBulkPick(again) {
    const ids = [...sel], n = ids.length;
    const list = Object.keys(FAM).sort((a, b) => gType(a).localeCompare(gType(b)) || famName(a).localeCompare(famName(b)));
    $('#famPick').innerHTML = `<h2>Add ${n} voter${n === 1 ? '' : 's'} to a group</h2>
      <div class="d-actions"><button class="btn primary" id="bpNewF">＋ New family</button><button class="btn primary" id="bpNewC">＋ New caste</button></div>
      ${list.length ? `<h3>Your groups</h3><div class="picker-list fp-list">${list.map(gid => {
        const inN = ids.filter(id => inGroup(gid, id)).length, all = inN === n;
        return `<button class="opt ${all ? 'sel' : ''}" data-bg="${gid}"><div class="o-main"><div class="o-te">${all ? '✓ ' : ''}${esc(gLabel(gid))}</div>
          <div class="o-en">${GT[gType(gid)].label} · ${inN ? `${inN} of ${n} already in` : `${gMembers(gid).size} voters`}</div></div><span class="o-n">${all ? 'Remove' : `Add ${n - inN}`}</span></button>`;
      }).join('')}</div>` : '<p class="hint">No groups yet. Make one above.</p>'}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelector('#bpNewF').onclick = () => bulkNew('family');
    box.querySelector('#bpNewC').onclick = () => bulkNew('caste');
    box.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => {
      const gid = b.dataset.bg, all = ids.every(id => inGroup(gid, id));
      if (all) { if (!confirm(`Remove these ${n} from ${famName(gid)}?`)) return; gRemoveMany(gid, ids); toast(`Removed ${n} from ${famName(gid)}`); showBulkPick(true); return; }
      const added = gAddMany(gid, ids);
      toast(`Added ${added} to ${famName(gid)}`); leaveSelect();
    });
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  function bulkNew(t) {
    const ids = [...sel];
    const name = prompt(`Name of the new ${GT[t].label.toLowerCase()} group for these ${ids.length} voters (e.g. ${GT[t].eg}):`, '');
    if (!name || !name.trim()) return;
    const gid = famNew(name.trim().slice(0, 40), t);
    gAddMany(gid, ids);
    toast(`Made ${famName(gid)} with ${ids.length} voters`); leaveSelect();
  }

  // ---------- groups: families and castes ----------
  // A group = voters added one by one (v) + everyone with one of its surnames (s) − voters taken out (x).
  const rid = () => [...crypto.getRandomValues(new Uint8Array(5))].map(b => b.toString(16).padStart(2, '0')).join('');
  const GT = { family: { icon: '👪', label: 'Family', plural: 'Families', eg: 'Gotivada family, Ravi’s relatives' },
               caste: { icon: '🏷️', label: 'Caste', plural: 'Castes', eg: 'Kapu, Yadava, Velama' } };
  const gType = gid => (FAM[gid] && GT[FAM[gid].t]) ? FAM[gid].t : 'family';
  const famName = gid => (FAM[gid] && FAM[gid].name) || 'Unnamed group';
  const gLabel = gid => `${GT[gType(gid)].icon} ${famName(gid)}`;
  // voter ids of a group, and why each one is in it
  function gMembers(gid) {
    const g = FAM[gid], out = new Map(); if (!g) return out;
    Object.keys(g.s || {}).forEach(sk => V.forEach(v => { if (v.surname === sk && !(g.x || {})[v.id]) out.set(v.id, 'surname'); }));
    Object.keys(g.v || {}).forEach(id => { if (byId.has(id)) out.set(id, 'added'); });
    return out;
  }
  const inGroup = (gid, vid) => { const g = FAM[gid]; if (!g) return false; const v = byId.get(vid);
    return !!(g.v[vid] || (v && v.surname && g.s[v.surname] && !g.x[vid])); };
  // redraw the list but stay where the user was (load as many rows as before, keep the scroll position)
  function rerenderKeep() { const y = scrollY, n = shown; render(); for (let i = 0; i < 40 && shown < n; i++) { const b = shown; more(); if (shown === b) break; } scrollTo(0, y); }
  function famChanged() { saveFam(); if (isGroupView() || S.view === 'surnames' || S.cgrp || S.fgrp) rerenderKeep(); refreshDetailFam(); drawChips(); }
  function famNew(name, t) { const gid = rid(); FAM[gid] = { name, t, v: {}, s: {}, x: {} }; cloud.put('G', gid, name); cloud.put('T', gid, t); famChanged(); return gid; }
  // field: 'v' voter, 's' surname, 'x' taken out
  function gSet(gid, field, key, on) {
    const g = FAM[gid]; if (!g) return;
    if (on) g[field][key] = true; else delete g[field][key];
    cloud.put(field.toUpperCase(), gid + '|' + key, on || null);
  }
  // many at once: one redraw at the end
  function gAddMany(gid, ids) {
    let n = 0;
    ids.forEach(vid => { if (inGroup(gid, vid)) return; n++; gSet(gid, 'x', vid, false); const v = byId.get(vid); if (!(v && v.surname && FAM[gid].s[v.surname])) gSet(gid, 'v', vid, true); });
    famChanged(); return n;
  }
  function gRemoveMany(gid, ids) {
    ids.forEach(vid => { const v = byId.get(vid); gSet(gid, 'v', vid, false); if (v && v.surname && FAM[gid].s[v.surname]) gSet(gid, 'x', vid, true); });
    famChanged();
  }
  function gAddVoter(gid, vid) { gSet(gid, 'x', vid, false); const v = byId.get(vid); if (!(v && v.surname && FAM[gid].s[v.surname])) gSet(gid, 'v', vid, true); famChanged(); }
  function gRemoveVoter(gid, vid) {
    const v = byId.get(vid), g = FAM[gid];
    gSet(gid, 'v', vid, false);
    if (v && v.surname && g.s[v.surname]) gSet(gid, 'x', vid, true);  // came in through the surname: keep them out
    famChanged();
  }
  function gSurname(gid, sk, on) { gSurnameRaw(gid, sk, on); famChanged(); }
  function gSurnameRaw(gid, sk, on) {
    gSet(gid, 's', sk, on);
    // clear per-person exceptions for that surname
    V.forEach(v => { if (v.surname === sk) { if (FAM[gid].x[v.id]) gSet(gid, 'x', v.id, false); if (on && FAM[gid].v[v.id]) gSet(gid, 'v', v.id, false); } });
  }
  // a surname belongs to one caste: putting it in a caste takes it out of any other caste group
  function setCaste(sk, gid) {
    const moved = [];
    Object.keys(FAM).forEach(o => { if (o !== gid && gType(o) === 'caste' && FAM[o].s[sk]) { gSurnameRaw(o, sk, false); moved.push(famName(o)); } });
    if (gid && !FAM[gid].s[sk]) gSurnameRaw(gid, sk, true);
    return moved;
  }
  const castesOf = sk => Object.keys(FAM).filter(gid => gType(gid) === 'caste' && FAM[gid].s[sk]);

  // ---------- Surnames tab ----------
  function snRows(ignoreFilter) {
    const raw = S.q.trim(), te = isTelugu(raw), p = phon(raw), counts = new Map(), wards = new Map();
    V.forEach(v => {
      if (!v.surname || (S.ward && v.ward !== S.ward)) return;
      counts.set(v.surname, (counts.get(v.surname) || 0) + 1);
      const w = wards.get(v.surname) || {}; w[v.ward] = (w[v.ward] || 0) + 1; wards.set(v.surname, w);
    });
    let rows = [...counts.entries()].map(([k, n]) => ({ k, n, te: SURNAMES.get(k).te, en: SURNAMES.get(k).en, w: wards.get(k), castes: castesOf(k) }));
    if (ignoreFilter) return rows;
    if (raw) rows = rows.filter(r => te ? teNorm(r.te).includes(teNorm(raw)) : phon(r.en).includes(p));
    if (S.snf === 'none') rows = rows.filter(r => !r.castes.length);
    else if (S.snf === 'any') rows = rows.filter(r => r.castes.length);
    else if (S.snf !== 'all') { if (FAM[S.snf]) rows = rows.filter(r => r.castes.includes(S.snf)); else S.snf = 'all'; }
    rows.sort(S.snsort === 'az' ? (a, b) => a.en.localeCompare(b.en) : (a, b) => b.n - a.n || a.en.localeCompare(b.en));
    return rows;
  }
  function snHTML(r) {
    const wl = Object.keys(r.w).sort((a, b) => a - b).map(w => `W${w}`).join(' ');
    return `<button class="sn-row" data-sn="${esc(r.k)}"><div class="sn-main"><div class="sn-te">${esc(r.te)}</div><div class="sn-en">${esc(r.en)} · <span>${wl}</span></div>
      ${r.castes.length ? `<div class="sn-tags">${r.castes.map(gid => `<span class="sn-tag">🏷️ ${esc(famName(gid))}</span>`).join('')}</div>` : ''}</div><span class="sn-n">${r.n}</span></button>`;
  }
  // one surname: see its voters, choose its caste
  function showSurname(sk, again) {
    const sn = SURNAMES.get(sk); if (!sn) return;
    const castes = Object.keys(FAM).filter(gid => gType(gid) === 'caste').sort((a, b) => famName(a).localeCompare(famName(b)));
    const fams = Object.keys(FAM).filter(gid => gType(gid) === 'family' && FAM[gid].s[sk]);
    const wards = {}; V.forEach(v => { if (v.surname === sk) wards[v.ward] = (wards[v.ward] || 0) + 1; });
    $('#famPick').innerHTML = `<h2>${esc(sn.te)} · ${esc(sn.en)}</h2>
      <p class="fam-sub">${sn.n} voters · ${Object.keys(wards).sort((a, b) => a - b).map(w => `W${w}: ${wards[w]}`).join(', ')}</p>
      <button class="btn primary w100" id="snSee">See the ${sn.n} voters</button>
      <h3>Caste</h3>
      <div class="fam-dd">${castes.map(gid => FAM[gid].s[sk] ? `<button class="fam-chip on" data-sc="${gid}">✓ 🏷️ ${esc(famName(gid))}</button>` : `<button class="fam-chip" data-sc="${gid}">🏷️ ${esc(famName(gid))}</button>`).join('')}
        <button class="fam-chip add" id="snNewC">＋ New caste</button></div>
      <p class="hint">${castes.length ? 'Tap a caste to put everyone with this surname in it. A surname can be in one caste; tap the ticked one to take it out. You can still take out or add single people from the caste screen.' : 'Make a caste group first.'}</p>
      ${fams.length ? `<h3>Also in families</h3><div class="fam-dd">${fams.map(gid => `<button class="fam-chip" data-fo="${gid}">👪 ${esc(famName(gid))}</button>`).join('')}</div>` : ''}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelector('#snSee').onclick = () => { S.surname = sk; S.view = 'list'; S.ward = 0; q.value = ''; S.q = ''; $('#clearQ').hidden = true; closeTop(open.length); update(); };
    box.querySelector('#snNewC').onclick = () => {
      const name = prompt('Name of the caste group (e.g. Kapu, Yadava, Velama):', ''); if (!name || !name.trim()) return;
      const gid = famNew(name.trim().slice(0, 40), 'caste'), moved = setCaste(sk, gid); famChanged(); toast(moved.length ? `${sn.en} moved from ${moved.join(', ')} to ${famName(gid)}` : `${sn.en} → ${famName(gid)}`); showSurname(sk, true);
    };
    box.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => {
      const gid = b.dataset.sc;
      if (FAM[gid].s[sk]) { gSurnameRaw(gid, sk, false); famChanged(); toast(`${sn.en} taken out of ${famName(gid)}`); }
      else { const moved = setCaste(sk, gid); famChanged(); toast(moved.length ? `${sn.en} moved from ${moved.join(', ')} to ${famName(gid)}` : `${sn.en} → ${famName(gid)}`); }
      showSurname(sk, true);
    });
    box.querySelectorAll('[data-fo]').forEach(b => b.onclick = () => showFam(b.dataset.fo));
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  // several surnames at once → one caste
  function showBulkSnPick(again) {
    const ks = [...sel], n = ks.length;
    const castes = Object.keys(FAM).filter(gid => gType(gid) === 'caste').sort((a, b) => famName(a).localeCompare(famName(b)));
    $('#famPick').innerHTML = `<h2>Set caste for ${n} surname${n === 1 ? '' : 's'}</h2>
      <p class="fam-sub">${ks.slice(0, 8).map(k => esc(SURNAMES.get(k).en)).join(', ')}${n > 8 ? ` +${n - 8} more` : ''}</p>
      <button class="btn primary w100" id="bsNew">＋ New caste with these surnames</button>
      ${castes.length ? `<h3>Your castes</h3><div class="picker-list fp-list">${castes.map(gid => {
        const inN = ks.filter(k => FAM[gid].s[k]).length, all = inN === n;
        return `<button class="opt ${all ? 'sel' : ''}" data-bc="${gid}"><div class="o-main"><div class="o-te">${all ? '✓ ' : ''}🏷️ ${esc(famName(gid))}</div>
          <div class="o-en">${Object.keys(FAM[gid].s).length} surname${Object.keys(FAM[gid].s).length === 1 ? '' : 's'} · ${gMembers(gid).size} voters${inN ? ` · ${inN} of these already in` : ''}</div></div><span class="o-n">${all ? 'Take out' : 'Set'}</span></button>`;
      }).join('')}</div>` : ''}
      <button class="btn w100" id="bsNone" style="margin-top:10px">Remove these from every caste</button>
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelector('#bsNew').onclick = () => {
      const name = prompt(`Name of the caste group for these ${n} surnames (e.g. Kapu, Yadava):`, ''); if (!name || !name.trim()) return;
      const gid = famNew(name.trim().slice(0, 40), 'caste'); ks.forEach(k => setCaste(k, gid)); famChanged();
      toast(`${famName(gid)}: ${n} surnames`); leaveSelect();
    };
    box.querySelector('#bsNone').onclick = () => { ks.forEach(k => setCaste(k, '')); famChanged(); toast(`${n} surnames taken out of castes`); leaveSelect(); };
    box.querySelectorAll('[data-bc]').forEach(b => b.onclick = () => {
      const gid = b.dataset.bc, all = ks.every(k => FAM[gid].s[k]);
      if (all) { ks.forEach(k => gSurnameRaw(gid, k, false)); famChanged(); toast(`${n} surnames taken out of ${famName(gid)}`); showBulkSnPick(true); return; }
      let moved = 0; ks.forEach(k => { if (setCaste(k, gid).length) moved++; }); famChanged();
      toast(`${n} surnames → ${famName(gid)}${moved ? ` (${moved} moved from another caste)` : ''}`); leaveSelect();
    });
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  function famCreate(t, firstVoter) {
    const v = firstVoter && byId.get(firstVoter);
    const def = t === 'family' && v ? `${v.surname_en || v.name_en.split(' ').pop()} family` : '';
    const name = prompt(`Name of the ${GT[t].label.toLowerCase()} group (e.g. ${GT[t].eg}):`, def);
    if (!name || !name.trim()) return null;
    const gid = famNew(name.trim().slice(0, 40), t);
    if (v) gAddVoter(gid, v.id);
    showFam(gid);
    return gid;
  }

  // the Groups tab
  function famGroups(t) {
    const filtering = S.q.trim() || S.ward || S.caste !== 'all' || S.rel !== 'all' || S.surname || S.cgrp || S.fgrp || S.marked;
    const ok = new Set(current.map(v => v.id));
    return Object.keys(FAM).filter(gid => gType(gid) === t).map(gid => {
      const all = [...gMembers(gid).keys()];
      const items = all.filter(id => ok.has(id)).map(id => byId.get(id)).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
      return { gid, name: famName(gid), t: gType(gid), items, total: all.length };
    }).filter(g => g.items.length || !filtering).sort(S.gsort === 'size' ? (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
  }
  function famHTML(g) {
    const show = g.items.slice(0, 5), more = g.items.length - show.length, sn = Object.keys(FAM[g.gid].s || {});
    return `<div class="house fam"><div class="house-h"><span>${GT[g.t].icon} ${esc(g.name)}</span><small>${g.items.length.toLocaleString()} voter${g.items.length === 1 ? '' : 's'}</small>
      <button class="fam-open" data-fam-open="${g.gid}" aria-label="Open ${esc(g.name)}">Open ›</button></div>
      ${sn.length ? `<div class="g-sn">Surnames: ${sn.slice(0, 6).map(k => esc(SURNAMES.get(k) ? SURNAMES.get(k).en : k)).join(', ')}${sn.length > 6 ? ` +${sn.length - 6}` : ''}</div>` : ''}
      ${show.length ? show.map(memberHTML).join('') : '<div class="fam-empty">No voters yet. Tap <b>Open</b> to add people or surnames.</div>'}
      ${more > 0 ? `<button class="g-more" data-fam-list="${g.gid}">Show all ${g.items.length.toLocaleString()} in the voter list ›</button>` : ''}</div>`;
  }
  function memberHTML(v) {
    return `<button class="member" data-id="${v.id}">${photo(v)}<div class="m-body"><div class="nm-row"><div class="nm">${hl(v.name || '—', S.q)}</div>${wardPill(v)}${marks.has(v.id) ? '<span class="tag star" style="background:var(--mark)">★</span>' : ''}</div>
      <div class="en">${esc(v.name_en)} · ${esc(v.relation)}: ${esc(v.relation_name_en || '—')} · #${v.serial}</div></div></button>`;
  }
  // show a group's voters in the normal voter list (with all the usual filters and sorting)
  function showGroupInList(gid) { if (gType(gid) === 'caste') S.cgrp = gid; else S.fgrp = gid; S.view = 'list'; closeTop(open.length); update(); }

  // likely relatives for a family: same house, father/husband named in the roll, children/wives who name them
  const byName = new Map(), byRel = new Map();
  V.forEach(v => {
    const a = teNorm(v.name), b = teNorm(v.relation_name);
    if (a) { if (!byName.has(a)) byName.set(a, []); byName.get(a).push(v); }
    if (b) { if (!byRel.has(b)) byRel.set(b, []); byRel.get(b).push(v); }
  });
  function suggest(gid, mem) {
    const seen = new Map();
    // name links (father / husband / child) count more than living at the same address; a shared surname adds a little
    const add = (y, why, w, x) => {
      if (mem.has(y.id)) return;
      const e = seen.get(y.id) || { v: y, why: [], n: 0 }; e.n += w + (x.surname && y.surname === x.surname ? 1 : 0);
      if (e.why.length < 2 && !e.why.includes(why)) e.why.push(why); seen.set(y.id, e);
    };
    const near = (x, y) => y.ward === x.ward || (x.surname && y.surname === x.surname);
    [...mem.keys()].slice(0, 200).map(id => byId.get(id)).forEach(x => {
      const who = x.name_en || x.name;
      (households.get(x.hkey) || []).forEach(y => add(y, `Same house as ${who}`, 1, x));
      (byRel.get(teNorm(x.name)) || []).forEach(y => { if (near(x, y)) add(y, `${y.relation === 'Husband' ? 'Wife' : 'Child'} of ${who}`, 3, x); });
      if (x.relation_name) (byName.get(teNorm(x.relation_name)) || []).forEach(y => { if (near(x, y)) add(y, `${x.relation === 'Not stated' ? 'Relative' : x.relation} of ${who}`, 3, x); });
    });
    return [...seen.values()].sort((a, b) => b.n - a.n || a.v.ward - b.v.ward || a.v.serial - b.v.serial).slice(0, 30);
  }
  // surnames of the group's members that are not in the group yet
  function suggestSurnames(gid, mem) {
    const g = FAM[gid], c = new Map();
    [...mem.keys()].forEach(id => { const v = byId.get(id); if (v.surname && !g.s[v.surname]) c.set(v.surname, (c.get(v.surname) || 0) + 1); });
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
  }
  const snLabel = k => { const s = SURNAMES.get(k); return s ? `${s.te} · ${s.en}` : k; };

  function showFam(gid, replace) {
    if (!FAM[gid]) { toast('This group was deleted'); return; }
    const g = FAM[gid], t = gType(gid); $('#famSheet')._gid = gid;
    const memMap = gMembers(gid);
    const mem = [...memMap.keys()].map(id => byId.get(id)).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
    const wards = {}; mem.forEach(v => wards[v.ward] = (wards[v.ward] || 0) + 1);
    const sn = Object.keys(g.s), xs = Object.keys(g.x).map(id => byId.get(id)).filter(Boolean);
    const sug = t === 'family' ? suggest(gid, memMap) : [];
    const sugSn = suggestSurnames(gid, memMap);
    const LIMIT = 60;
    const row = (v, extra, btn) => `<div class="fam-row"><button class="member" data-open="${v.id}">${photo(v)}<div class="m-body"><div class="nm-row"><div class="nm">${esc(v.name || '—')}</div>${wardPill(v)}</div>
      <div class="en">${esc(v.name_en)} · ${extra}</div></div></button>${btn}</div>`;
    $('#fam').innerHTML = `<h2>${GT[t].icon} ${esc(famName(gid))}</h2>
      <p class="fam-sub">${GT[t].label} group · ${mem.length.toLocaleString()} voter${mem.length === 1 ? '' : 's'}${mem.length ? ' · ' + Object.keys(wards).sort((a, b) => a - b).map(w => `W${w}: ${wards[w]}`).join(', ') : ''}</p>
      <div class="d-actions"><button class="btn" id="fShow">Show in list</button><button class="btn" id="fRename">Rename</button><button class="btn danger" id="fDelete">Delete</button></div>
      <h3>Surnames in this group</h3>
      <div class="fam-dd">${sn.map(k => `<span class="fam-chip sn">${esc(snLabel(k))} <small>${SURNAMES.get(k) ? SURNAMES.get(k).n : ''}</small><button data-sn-rm="${esc(k)}" aria-label="Remove surname">×</button></span>`).join('')}
        <button class="fam-chip add" id="fAddSn">＋ Add surname</button></div>
      <p class="hint">${sn.length ? 'Everyone with these surnames is in the group.' : 'Add a surname to include everyone with it — useful for castes.'}</p>
      ${sugSn.length ? `<div class="fam-dd sugg">${sugSn.map(k => `<button class="fam-chip add" data-sn-add="${esc(k)}">＋ ${esc(snLabel(k))} (${SURNAMES.get(k) ? SURNAMES.get(k).n : ''})</button>`).join('')}</div><p class="hint">Surnames of people already in the group.</p>` : ''}
      <h3>Members (${mem.length.toLocaleString()})</h3>
      ${mem.length ? `<div class="house">${mem.slice(0, LIMIT).map(v => row(v, `${memMap.get(v.id) === 'surname' ? '<span class="why">via surname</span> · ' : ''}${esc(v.relation)}: ${esc(v.relation_name_en || '—')}`,
        `<button class="fam-act rm" data-rm="${v.id}" aria-label="Take ${esc(v.name_en)} out">×</button>`)).join('')}</div>
        ${mem.length > LIMIT ? `<button class="btn w100" id="fShow2" style="margin-top:8px">Show all ${mem.length.toLocaleString()} in the voter list</button>` : ''}`
        : '<p class="hint">No voters yet. Add a surname above, or open any voter and tap “Add to group”.</p>'}
      ${xs.length ? `<h3>Taken out (${xs.length})</h3><div class="house">${xs.map(v => row(v, 'has a group surname but is not in the group', `<button class="fam-act add" data-readd="${v.id}" aria-label="Put back">＋</button>`)).join('')}</div>` : ''}
      ${t === 'family' ? `<h3>Suggested relatives</h3>
      ${sug.length ? `<div class="house">${sug.map(e => row(e.v, `<span class="why">${esc(e.why.join(' · '))}</span>`,
        `<button class="fam-act add" data-add="${e.v.id}" aria-label="Add ${esc(e.v.name_en)}">＋</button>`)).join('')}</div>`
        : `<p class="hint">${mem.length ? 'No more suggestions.' : 'Add one voter first, and the app will suggest their relatives.'}</p>`}
      <p class="hint">Suggestions come from the same house and from the father / husband names in the roll, so check them before adding.</p>` : ''}
      <div class="sheet-actions"><button class="btn primary" id="fClose">Close</button></div>`;
    const box = $('#fam');
    box.querySelector('#fClose').onclick = () => closeTop();
    box.querySelector('#fShow').onclick = () => showGroupInList(gid);
    if (box.querySelector('#fShow2')) box.querySelector('#fShow2').onclick = () => showGroupInList(gid);
    box.querySelector('#fRename').onclick = () => {
      const n = prompt('New name for this group:', g.name); if (!n || !n.trim()) return;
      g.name = n.trim().slice(0, 40); cloud.put('G', gid, g.name); famChanged(); showFam(gid, true);
    };
    box.querySelector('#fDelete').onclick = () => {
      if (!confirm(`Delete the group "${famName(gid)}"? The voters are not deleted.`)) return;
      delete FAM[gid]; cloud.put('G', gid, null); if (S.cgrp === gid) S.cgrp = ''; if (S.fgrp === gid) S.fgrp = ''; famChanged(); closeTop(); toast('Group deleted');
    };
    box.querySelector('#fAddSn').onclick = () => openSurnamePicker(gid);
    box.querySelectorAll('[data-sn-rm]').forEach(b => b.onclick = () => { gSurname(gid, b.dataset.snRm, false); showFam(gid, true); });
    box.querySelectorAll('[data-sn-add]').forEach(b => b.onclick = () => { gSurname(gid, b.dataset.snAdd, true); toast('Surname added'); showFam(gid, true); });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { gRemoveVoter(gid, b.dataset.rm); showFam(gid, true); });
    box.querySelectorAll('[data-readd]').forEach(b => b.onclick = () => { gAddVoter(gid, b.dataset.readd); showFam(gid, true); });
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { gAddVoter(gid, b.dataset.add); toast('Added'); showFam(gid, true); });
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => showDetail(b.dataset.open));
    if (!replace && !raise('#famSheet')) openSheet('#famSheet');
  }
  // "Add to group" from a voter's details
  function showFamPick(vid, again) {
    const v = byId.get(vid), sk = v.surname, sn = sk && SURNAMES.get(sk);
    const list = Object.keys(FAM).sort((a, b) => gType(a).localeCompare(gType(b)) || famName(a).localeCompare(famName(b)));
    const rowP = gid => { const on = inGroup(gid, vid); return `<button class="opt ${on ? 'sel' : ''}" data-g="${gid}">
      <div class="o-main"><div class="o-te">${on ? '✓ ' : ''}${esc(gLabel(gid))}</div><div class="o-en">${GT[gType(gid)].label} · ${gMembers(gid).size} voters</div></div><span class="o-n">${on ? 'Remove' : 'Add'}</span></button>`; };
    $('#famPick').innerHTML = `<h2>Add to group</h2><p class="fam-sub">${esc(v.name)} · ${esc(v.name_en)}</p>
      <div class="d-actions"><button class="btn primary" id="fpNewF">＋ New family</button><button class="btn primary" id="fpNewC">＋ New caste</button></div>
      ${list.length ? `<h3>Add this person</h3><div class="picker-list fp-list">${list.map(rowP).join('')}</div>` : ''}
      ${list.length && sn ? `<h3>Add everyone named ${esc(sn.en)} (${sn.n})</h3><div class="fam-dd">${list.map(gid => FAM[gid].s[sk]
        ? `<button class="fam-chip" data-gs="${gid}">✓ ${esc(gLabel(gid))}</button>` : `<button class="fam-chip add" data-gs="${gid}">＋ ${esc(gLabel(gid))}</button>`).join('')}</div>
        <p class="hint">Adds the whole surname to the group, including people added to the roll later.</p>` : ''}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelector('#fpNewF').onclick = () => { closeTop(); setTimeout(() => famCreate('family', vid), 60); };
    box.querySelector('#fpNewC').onclick = () => { closeTop(); setTimeout(() => famCreate('caste', vid), 60); };
    box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      const gid = b.dataset.g, on = !inGroup(gid, vid);
      on ? gAddVoter(gid, vid) : gRemoveVoter(gid, vid);
      toast(on ? `Added to ${famName(gid)}` : `Removed from ${famName(gid)}`); showFamPick(vid, true);
    });
    box.querySelectorAll('[data-gs]').forEach(b => b.onclick = () => {
      const gid = b.dataset.gs, on = !FAM[gid].s[sk];
      gSurname(gid, sk, on); toast(on ? `All ${sn.en} added to ${famName(gid)}` : `${sn.en} removed from ${famName(gid)}`); showFamPick(vid, true);
    });
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  // keep the voter details up to date when a group changes underneath it
  const refreshDetailFam = () => { const d = $('#detailSheet'); if (!d.hidden && d._vid) showDetail(d._vid, true); };

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
    owners: LS.get('pv_owner', {}), meta: { name: '', owner: '' }, online: 0, others: [],
    // who marked / wrote each note: { 'm:1-5': { by, d, t } } (honour system: each device names itself)
    who: LS.get('pv_who', {}), devName: LS.get('pv_devname', ''),
    get myName() { return this.devName || `${isIOS ? 'iPhone' : isAndroid ? 'Android phone' : 'Computer'} ${this.dev.slice(0, 4)}`; },
    setDevName(v) { this.devName = String(v || '').trim().slice(0, 30); LS.set('pv_devname', this.devName); },
    // random id for this device, used only to count devices that are online
    dev: LS.get('pv_dev', '') || (() => { const d = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join(''); LS.set('pv_dev', d); return d; })(),
    get ready() { return !!(FIREBASE.apiKey && FIREBASE.projectId); },
    url(extra = '', code = this.code) {
      return `${FIREBASE.host}/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/lists/${encodeURIComponent(code)}?key=${FIREBASE.apiKey}${extra}`;
    },
    // record a change; value null = remove. Changes wait in a queue (kept offline) until sent.
    put(type, id, val) {
      if (!this.code) return;
      // deleting a family group drops any member changes for it that are still waiting
      if (type === 'G' && val === null) Object.keys(this.q).forEach(k => { if (/^[TVSX]:/.test(k) && k.slice(2).split('|')[0] === id) delete this.q[k]; });
      this.q[type + ':' + id] = val; LS.set('pv_sync_q', this.q);
      if (type === 'm' || type === 'n') {
        if (val === null) delete this.who[type + ':' + id]; else this.who[type + ':' + id] = { by: this.myName, d: this.dev, t: Date.now() };
        LS.set('pv_who', this.who);
      }
      clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), type === 'n' ? 1200 : 300);
      drawSyncDot();
    },
    async flush() {
      const keys = Object.keys(this.q);
      for (let i = 0; i < keys.length; i += 80) {
        const part = keys.slice(i, i + 80), sent = {};
        const F = () => ({ mapValue: { fields: {} } });
        const body = { fields: { m: F(), n: F(), mb: F(), nb: F(), g: F() } };
        const path = parts => 'updateMask.fieldPaths=' + encodeURIComponent(parts.map((x, i) => i % 2 ? '`' + x + '`' : x).join('.'));
        const mask = part.flatMap(k => {
          const [t, id] = [k[0], k.slice(2)], val = this.q[k]; sent[k] = val;
          // groups: g.<gid>.name, g.<gid>.t, and g.<gid>.v / .s / .x .<key> (voters, surnames, taken out)
          if ('GTVSX'.includes(t)) {
            const [gid, key] = id.split('|'), gf = body.fields.g.mapValue.fields;
            if (t === 'G' && val === null) return [path(['g', gid])];
            const grp = gf[gid] || (gf[gid] = { mapValue: { fields: { v: F(), s: F(), x: F() } } });
            if (t === 'G' || t === 'T') { const f = t === 'G' ? 'name' : 't'; grp.mapValue.fields[f] = { stringValue: String(val) }; return [path(['g', gid, f])]; }
            const f = t.toLowerCase();
            if (val !== null) grp.mapValue.fields[f].mapValue.fields[key] = { booleanValue: true };
            return [path(['g', gid, f, key])];
          }
          if (val !== null) {
            body.fields[t].mapValue.fields[id] = t === 'm' ? { booleanValue: true } : { stringValue: String(val) };
            const w = this.who[k] || { by: this.myName, d: this.dev, t: Date.now() };
            body.fields[t + 'b'].mapValue.fields[id] = { mapValue: { fields: { by: { stringValue: w.by }, d: { stringValue: w.d }, t: { integerValue: String(w.t) } } } };
          }
          return [`${t}.\`${id}\``, `${t}b.\`${id}\``].map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f));
        });
        const r = await fetch(this.url('&' + mask.join('&')), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('save ' + r.status);
        part.forEach(k => { if (this.q[k] === sent[k]) delete this.q[k]; });
        LS.set('pv_sync_q', this.q);
      }
    },
    async pull(code = this.code) {
      const r = await fetch(this.url('', code), { cache: 'no-store' });
      if (r.status === 404) return { m: {}, n: {}, name: '', owner: '', p: {}, who: {}, g: {} };
      if (!r.ok) throw new Error('load ' + r.status);
      return this.parse(await r.json());
    },
    parse(doc) {
      const f = doc.fields || {};
      const str = k => (f[k] && f[k].stringValue) || '';
      const p = {}; Object.entries((f.p && f.p.mapValue.fields) || {}).forEach(([k, v]) => {
        const g = (v.mapValue && v.mapValue.fields) || {};
        p[k] = v.mapValue ? { t: +((g.t && g.t.integerValue) || 0), nm: (g.nm && g.nm.stringValue) || '' } : { t: +(v.integerValue || 0), nm: '' };
      });
      const who = {};
      ['m', 'n'].forEach(t => Object.entries((f[t + 'b'] && f[t + 'b'].mapValue.fields) || {}).forEach(([id, v]) => {
        const g = (v.mapValue && v.mapValue.fields) || {};
        who[t + ':' + id] = { by: (g.by && g.by.stringValue) || '', d: (g.d && g.d.stringValue) || '', t: +((g.t && g.t.integerValue) || 0) };
      }));
      const g = {};
      Object.entries((f.g && f.g.mapValue.fields) || {}).forEach(([gid, x]) => {
        const gf = (x.mapValue && x.mapValue.fields) || {};
        const set = k => { const o = {}; Object.entries((gf[k] && gf[k].mapValue && gf[k].mapValue.fields) || {}).forEach(([id, b]) => { if (b.booleanValue) o[id] = true; }); return o; };
        g[gid] = { name: (gf.name && gf.name.stringValue) || '', t: (gf.t && gf.t.stringValue) || 'family', v: set('v'), s: set('s'), x: set('x') };
      });
      return { m: (f.m && f.m.mapValue.fields) || {}, n: (f.n && f.n.mapValue.fields) || {}, name: str('name'), owner: str('owner'), p, who, g };
    },
    // "I'm here": write this device's last-seen time and read the list back in the same request.
    // Entries older than 10 minutes are removed along the way.
    async beat() {
      const now = Date.now(), stale = Object.keys(this.p || {}).filter(k => k !== this.dev && now - this.p[k].t > 600000);
      const mask = [this.dev, ...stale].map(k => 'updateMask.fieldPaths=' + encodeURIComponent(`p.\`${k}\``)).join('&');
      const r = await fetch(this.url('&' + mask), { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { p: { mapValue: { fields: { [this.dev]: { mapValue: { fields: { t: { integerValue: String(now) }, nm: { stringValue: this.myName } } } } } } } } }) });
      if (!r.ok) return this.pull();  // e.g. rules not updated yet: still sync marks
      return this.parse(await r.json());
    },
    // tell a list this device has gone (closing the app, switching codes); best effort
    bye(code = this.code) {
      if (!code || !this.ready) return;
      try {
        fetch(this.url('&updateMask.fieldPaths=' + encodeURIComponent(`p.\`${this.dev}\``), code), { method: 'PATCH', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { p: { mapValue: { fields: {} } } } }) }).catch(() => { });
      } catch { }
    },
    async sync() {
      if (!this.code || !this.ready || this.busy) return;
      if (!navigator.onLine) { this.err = 'offline'; drawSyncDot(); return; }
      this.busy = true; drawSyncDot();
      try {
        await this.flush();
        this.apply(document.visibilityState === 'visible' ? await this.beat() : await this.pull());
        this.last = Date.now(); LS.set('pv_sync_last', this.last); this.err = '';
        this.remember(this.code);
      } catch (e) { this.err = navigator.onLine ? 'error' : 'offline'; }
      this.busy = false; drawSyncDot();
      if (Object.keys(this.q).length && !this.err) this.sync();
    },
    // make this device's marks and notes match the cloud copy (plus changes not yet sent)
    apply(d) {
      this.meta = { name: d.name, owner: d.owner };
      // devices seen in the last 2.5 minutes (each open app checks in every minute)
      this.p = d.p || {}; const now = Date.now();
      const live = Object.entries(this.p).filter(([k, v]) => k !== this.dev && now - v.t < 150000);
      this.others = live.map(([k, v]) => v.nm || 'Device ' + k.slice(0, 4));
      this.online = live.length + 1;  // this device + the others
      // attribution from the cloud, except for this device's changes not yet sent
      const who = Object.assign({}, d.who || {}); Object.keys(this.q).forEach(k => { if (this.who[k]) who[k] = this.who[k]; else delete who[k]; });
      this.who = who; LS.set('pv_who', who);
      const h = this.hist.find(h => h.code === this.code);
      if (h && h.name !== d.name) { h.name = d.name; LS.set('pv_sync_hist', this.hist); }
      // the cloud copy wins, except for changes still waiting to be sent
      const m = new Set(Object.keys(d.m).filter(id => d.m[id].booleanValue)), n = {};
      Object.keys(d.n).forEach(id => { if (d.n[id].stringValue) n[id] = d.n[id].stringValue; });
      Object.entries(this.q).forEach(([k, val]) => {
        const id = k.slice(2);
        if (k[0] === 'm') val ? m.add(id) : m.delete(id); else if (k[0] === 'n') { if (val) n[id] = val; else delete n[id]; }
      });
      const changed = m.size !== marks.size || [...m].some(id => !marks.has(id));
      marks.clear(); m.forEach(id => marks.add(id)); LS.set('pv_marks', [...marks]);
      const editing = document.activeElement && document.activeElement.id === 'dNote';
      if (!editing) { Object.keys(notes).forEach(k => delete notes[k]); Object.assign(notes, n); LS.set('pv_notes', notes); }
      if (changed) refreshMarks();
      // family groups: cloud copy + changes still waiting to be sent
      const g = JSON.parse(JSON.stringify(d.g || {}));
      Object.entries(this.q).forEach(([k, val]) => {
        const t = k[0]; if (!'GTVSX'.includes(t)) return;
        const [gid, key] = k.slice(2).split('|');
        if (t === 'G' && val === null) { delete g[gid]; return; }
        const grp = g[gid] = g[gid] || { name: '', t: 'family', v: {}, s: {}, x: {} };
        if (t === 'G') grp.name = val; else if (t === 'T') grp.t = val;
        else { const f = t.toLowerCase(); if (val) grp[f][key] = true; else delete grp[f][key]; }
      });
      if (JSON.stringify(g) !== JSON.stringify(FAM)) {
        Object.keys(FAM).forEach(k => delete FAM[k]); Object.assign(FAM, g); saveFam();
        if (isGroupView() || S.view === 'surnames' || S.cgrp || S.fgrp) rerenderKeep();
        drawChips();
        if (!$('#famSheet').hidden && $('#famSheet')._gid) { if (FAM[$('#famSheet')._gid]) showFam($('#famSheet')._gid, true); }
      }
    },
    // codes used on this device, newest first
    remember(c) {
      if (!c) return;
      const name = c === this.code ? this.meta.name : this.nameOf(c);
      this.hist = [{ code: c, t: Date.now(), name }].concat(this.hist.filter(h => h.code !== c)).slice(0, 12);
      LS.set('pv_sync_hist', this.hist);
    },
    // each list's name is stored in the cloud; only the device that created the code can change it
    nameOf(c) { if (c === this.code && this.meta.name) return this.meta.name; const h = this.hist.find(h => h.code === c); return (h && h.name) || ''; },
    // this device can rename: it holds the creator secret, or the list has no owner yet (made before names existed)
    canRename(c) { return !!this.owners[c] || (c === this.code && !this.meta.owner); },
    async rename(c, name) {
      name = String(name || '').trim().slice(0, 40);
      if (!navigator.onLine) { toast('Connect to the internet to rename'); return false; }
      try {
        const doc = await this.pull(c);
        let o = this.owners[c] || null;
        if (doc.owner && o) {
          // a previous rename may have been saved without the reply arriving: then the new secret is the valid one
          if (o.next && await sha256(o.next) === doc.owner) o = { cur: o.next };
          else if (!o.cur || await sha256(o.cur) !== doc.owner) o = null;
        }
        if (doc.owner && !o) { toast('Only the person who created this code can rename it'); return false; }
        const next = randomSecret();
        this.owners[c] = { cur: o ? o.cur : '', next }; LS.set('pv_owner', this.owners);
        const fields = { name: { stringValue: name }, owner: { stringValue: await sha256(next) } }, mask = ['name', 'owner'];
        if (doc.owner) { fields.key = { stringValue: o.cur }; mask.push('key'); }
        const r = await fetch(this.url('&' + mask.map(k => 'updateMask.fieldPaths=' + k).join('&'), c),
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!r.ok) { toast(r.status === 403 ? 'Only the person who created this code can rename it' : 'Could not rename. Try again.'); return false; }
        this.owners[c] = { cur: next }; LS.set('pv_owner', this.owners);
        if (c === this.code) this.meta = { name, owner: fields.owner.stringValue };
        const h = this.hist.find(h => h.code === c); if (h) { h.name = name; LS.set('pv_sync_hist', this.hist); }
        return true;
      } catch { toast('Could not rename. Try again.'); return false; }
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
        const d = await this.beat();
        if (old) this.bye(old);
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
      Object.entries(FAM).forEach(([gid, g]) => {
        this.q['G:' + gid] = g.name; this.q['T:' + gid] = g.t || 'family';
        ['v', 's', 'x'].forEach(f => Object.keys(g[f] || {}).forEach(k => this.q[f.toUpperCase() + ':' + gid + '|' + k] = true));
      });
      LS.set('pv_sync_q', this.q);
      return this.sync();
    },
    leave() { this.bye(); this.online = 0; this.others = []; this.remember(this.code); this.code = ''; this.q = {}; this.err = ''; LS.set('pv_sync_code', ''); LS.set('pv_sync_q', {}); drawSyncDot(); }
  };
  const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const randomSecret = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  // ask once for a device name, so others see who marked (e.g. "Ravi's phone")
  function askDevName(force) {
    if (cloud.devName && !force) return;
    const v = prompt('Name this device so others can see who marked a voter (e.g. Ravi\'s phone):', cloud.devName);
    if (v !== null && v.trim()) cloud.setDevName(v);
  }
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
    const n = cloud.code && cloud.online > 1 ? cloud.online : 0;
    let badge = b.querySelector('.sync-n'); if (!badge) { badge = document.createElement('b'); badge.className = 'sync-n'; b.appendChild(badge); }
    badge.textContent = n || ''; badge.hidden = !n;
    b.setAttribute('aria-label', 'Sync marks across devices' + (n ? ` (${n} devices online)` : ''));
    if (!$('#syncSheet').hidden) drawSync();
  }
  function drawSync() {
    const box = $('#syncBody');
    if (!cloud.ready) {
      box.innerHTML = `<p>Sync isn't set up yet. The app owner needs to add the Firebase settings.</p>`; return;
    }
    const recent = cloud.hist.filter(h => h.code !== cloud.code);
    const recentHTML = recent.length ? `<h3>Recent codes on this device</h3>
      <div class="recent">${recent.map(h => `<div class="rc-row"><button class="rc-open" data-code="${esc(h.code)}">${h.name
        ? `<b class="rc-name">${esc(h.name)}</b><small><span class="rc-code">${esc(h.code)}</span> · last used ${ago(h.t)}</small>`
        : `<b>${esc(h.code)}</b><small>Last used ${ago(h.t)}</small>`}</button>
        ${cloud.owners[h.code] ? `<button class="rc-x rc-ed" data-rename="${esc(h.code)}" aria-label="Rename ${esc(h.code)}">✎</button>` : ''}
        <button class="rc-x" data-forget="${esc(h.code)}" aria-label="Remove ${esc(h.code)} from this list">×</button></div>`).join('')}</div>
      <p class="hint">Opening a recent code replaces the marks and notes on this device with that code's saved copy.</p>` : '';
    const bindRecent = () => box.querySelectorAll('.rc-open').forEach(b => b.onclick = async () => {
      const c = b.dataset.code, label = cloud.nameOf(c) ? `"${cloud.nameOf(c)}" (${c})` : c;
      if (!confirm(`Open ${label}?\nMarks and notes on this device will be replaced by the ones saved under this code.`)) return;
      b.disabled = true;
      if (await cloud.switchTo(c)) toast(`Switched to ${cloud.nameOf(c) || c} · ${marks.size} marked`);
      drawSync();
    });
    const rename = async c => {
      const v = prompt(`Name for ${c} (e.g. Family, Ward 3 team):`, cloud.nameOf(c));
      if (v !== null && await cloud.rename(c, v)) toast(v.trim() ? 'Name saved' : 'Name removed');
      drawSync();
    };
    box.onclick = e => {
      const x = e.target.closest('[data-forget]'); if (x) { cloud.forget(x.dataset.forget); drawSync(); return; }
      const r = e.target.closest('[data-rename]'); if (r) rename(r.dataset.rename);
    };
    if (!cloud.code) {
      box.innerHTML = `<p class="sync-lead">Marks and notes are saved on this device only. Turn on sync to see the same marks on all your devices.</p>
        <button class="btn primary w100" id="syNew">Create a sync code</button>
        <div class="sync-or">or, if you already have a code</div>
        <div class="sync-join"><input id="syCode" placeholder="PDG-XXXX-XXXX" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn" id="syJoin">Join</button></div>
        <p class="hint">Anyone who has your code can see and change these marks and notes. Share it only with people you trust.</p>${recentHTML}`;
      bindRecent();
      $('#syNew').onclick = async () => {
        const c = newCode();
        askDevName();
        await cloud.join(c);
        // claim the new code for this device, so only it can name the list
        const v = prompt('Sync is on. Give this list a name (optional), e.g. Family or Ward 3 team:', '');
        await cloud.rename(c, v || '');
        cloud.remember(c);
        toast(cloud.err ? 'Saved here, will sync when online' : 'Sync is on');
        drawSync();
      };
      $('#syJoin').onclick = async () => {
        const c = cleanCode($('#syCode').value);
        if (!validCode(c)) { toast('Code looks like PDG-XXXX-XXXX'); return; }
        askDevName();
        await cloud.join(c); toast(cloud.err ? 'Could not reach the server, will retry' : 'Joined. Marks synced');
      };
      return;
    }
    const pend = Object.keys(cloud.q).length;
    const status = cloud.busy ? 'Syncing…' : cloud.err === 'offline' ? `Offline. ${pend} change${pend === 1 ? '' : 's'} will sync when you're back online.`
      : cloud.err ? 'Could not sync. Will try again.' : pend ? `${pend} change${pend === 1 ? '' : 's'} waiting…` : cloud.last ? `✓ Synced ${ago(cloud.last)} · ${marks.size} marked` : 'Not synced yet';
    box.innerHTML = `<p class="sync-lead">Sync is on. Use this code on your other devices, or open the link there.</p>
      ${cloud.canRename(cloud.code)
        ? `<button class="sync-name ${cloud.nameOf(cloud.code) ? '' : 'empty'}" data-rename="${esc(cloud.code)}">${cloud.nameOf(cloud.code) ? esc(cloud.nameOf(cloud.code)) : 'Add a name for this list'} <span>✎</span></button>`
        : cloud.nameOf(cloud.code) ? `<div class="sync-name">${esc(cloud.nameOf(cloud.code))}</div>` : ''}
      <div class="sync-code">${esc(cloud.code)}</div>
      <p class="sync-status">${status}</p>
      ${cloud.online ? `<div class="sync-online"><p><i></i>${cloud.online === 1 ? 'Only this device is online now' : `${cloud.online} devices online now`}</p>
        ${cloud.others.length ? `<p class="who-list">${['You', ...cloud.others].map(esc).join(' · ')}</p>` : ''}</div>` : ''}
      <button class="dev-name" id="syDev">This device: <b>${esc(cloud.myName)}</b> <span>✎</span></button>
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
    $('#syDev').onclick = () => { askDevName(true); drawSync(); cloud.sync(); };
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
      (askDevName(), cloud.join(hashCode)).then(() => toast(cloud.err ? 'Will sync when online' : 'Joined. Marks synced'));
  }
  drawSyncDot();
  cloud.sync();
  // check in again shortly after start: a sign-off sent by the page before a reload can arrive late
  setTimeout(() => cloud.sync(), 6000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.sync(); else cloud.bye(); });
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
