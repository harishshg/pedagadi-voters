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
    // the voter's own name only (for the "Name only" search switch); alt_en lists the name's words first
    const nw = (v.name_en || '').split(/\s+/).filter(Boolean);
    v._teN = teNorm(v.name);
    v._enN = nw.map(phon).join(' ') + ' ' + phon(v.name_en || '') +
             (v.alt_en ? ' ' + v.alt_en.split(/\s+/).slice(0, nw.length).map(phon).join(' ') : '');
  });

  // ---------- state ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
  };
  const marks = new Set(LS.get('pv_marks', []));
  const notes = LS.get('pv_notes', {});
  // phone numbers travel with the notes, under the key "t:<voter id>" (comma-separated 10-digit numbers),
  // so they sync with the sync code like notes do and need no change to the Firestore rules
  const telKey = id => 't:' + id;
  const phonesOf = id => (notes[telKey(id)] || '').split(',').filter(Boolean);
  // dead / duplicate also travel with the notes, under "s:<voter id>": 'dead', 'dup' or 'dup:<id of the other entry>'
  const stKey = id => 's:' + id;
  const statusOf = id => { const r = notes[stKey(id)]; if (!r) return null; const [k, of] = r.split(':'); return k === 'dead' || k === 'dup' ? { k, of: of && of !== id ? of : '' } : null; };
  const isGone = id => !!statusOf(id);
  const fmtPhone = p => p.length === 10 ? p.slice(0, 5) + ' ' + p.slice(5) : p;
  // "+91 98765-43210", "098765 43210" → "9876543210"; '' if it is not a 10-digit Indian number
  const normPhone = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d[0] === '0') d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : ''; };
  // family groups made by the user: { gid: { name, v: { voterId: true } } } (synced with the sync code)
  const FAM = LS.get('pv_fam', {});
  Object.values(FAM).forEach(g => { g.t = g.t || 'family'; g.v = g.v || {}; g.s = g.s || {}; g.x = g.x || {}; });
  const saveFam = () => LS.set('pv_fam', FAM);
  const saved = LS.get('pv_state', {});
  const S = Object.assign({ q: '', ward: 0, caste: 'all', rel: 'all', sort: 'serial', view: 'list', surname: '', group: '', gtype: 'all', snf: 'all', snsort: 'count', cgrp: '', fgrp: '', marked: false, gsort: 'name', nameOnly: false, frev: 'all', fsel: [], phone: 'all', vst: 'all', age: 'all' }, saved, { q: '' });
  if (S.view === 'family' && S.gtype === 'caste') S.view = 'caste';  // the old combined Groups tab
  if (saved.group) { if (((LS.get('pv_fam', {})[saved.group]) || {}).t === 'caste') S.cgrp = saved.group; else S.fgrp = saved.group; }
  // the Family filter: '' any, 'none' not in a family, 'sel' = one of the families in S.fsel (an old single family id becomes a selection)
  if (!Array.isArray(S.fsel)) S.fsel = [];
  if (S.fgrp && S.fgrp !== 'none' && S.fgrp !== 'sel') { S.fsel = [S.fgrp]; S.fgrp = 'sel'; }
  S.rel = 'all'; S.marked = false;  // relation and "only marked" filters were removed from the panel
  const isGroupView = () => S.view === 'family' || S.view === 'caste';
  const saveState = () => LS.set('pv_state', { ward: S.ward, caste: S.caste, rel: S.rel, sort: S.sort, view: S.view, surname: S.surname, cgrp: S.cgrp, fgrp: S.fgrp, marked: S.marked, gsort: S.gsort, snf: S.snf, snsort: S.snsort, nameOnly: S.nameOnly, frev: S.frev, fsel: S.fsel, phone: S.phone, age: S.age });
  // surname index: standard spelling -> { te, en, n }
  const SURNAMES = new Map();
  V.forEach(v => { if (!v.surname) return; const s = SURNAMES.get(v.surname) || { te: v.surname, en: v.surname_en, n: 0 }; s.n++; SURNAMES.set(v.surname, s); });
  if (S.surname && !SURNAMES.has(S.surname)) S.surname = '';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // age filter: 'all', 'unk' (age not in the roll), or 'lo-hi' with either end optional ('60-' = 60 and over)
  const ageRange = a => { const [lo, hi] = String(a).split('-').map(x => x === '' || x == null ? null : +x); return [lo, hi]; };
  const ageTest = a => {
    if (a === 'unk') return age => age === '' || age == null;
    const [lo, hi] = ageRange(a);
    return age => age !== '' && age != null && (lo == null || age >= lo) && (hi == null || age <= hi);
  };
  const ageLbl = a => { if (a === 'unk') return 'Age not known'; const [lo, hi] = ageRange(a);
    return lo != null && hi != null ? `Age ${lo}–${hi}` : lo != null ? `Age ${lo}+` : `Age up to ${hi}`; };
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
    if (S.phone !== 'all') list = list.filter(v => !!notes[telKey(v.id)] === (S.phone === 'has'));
    if (S.age !== 'all') { const ok = ageTest(S.age); list = list.filter(v => ok(v.age)); }
    if (S.vst !== 'all') list = list.filter(v => { const st = statusOf(v.id); return S.vst === 'ok' ? !st : S.vst === 'gone' ? !!st : !!st && st.k === S.vst; });
    if (S.marked && S.view !== 'marked') list = list.filter(v => marks.has(v.id));
    // caste group / family: a group id, or 'none' = not in any group of that kind
    if (S.fgrp === 'sel') { S.fsel = S.fsel.filter(gid => FAM[gid]); if (!S.fsel.length) S.fgrp = ''; }
    if (S.fgrp === 'sel' && S.view !== 'family') {
      const m = new Set(); S.fsel.forEach(gid => gMembers(gid).forEach((_, id) => m.add(id)));
      list = list.filter(v => m.has(v.id));
    }
    [['cgrp', 'caste'], ['fgrp', 'family']].forEach(([k, t]) => {
      const val = S[k]; if (!val || val === 'sel' || S.view === t) return;   // the Families / Castes tab itself ignores its own filter
      if (val === 'none') { const inAny = new Set(); Object.keys(FAM).forEach(gid => { if (gType(gid) === t) gMembers(gid).forEach((_, id) => inAny.add(id)); }); list = list.filter(v => !inAny.has(v.id)); }
      else if (FAM[val]) { const m = gMembers(val); list = list.filter(v => m.has(v.id)); }
      else S[k] = '';
    });
    if (raw) {
      const toks = raw.split(/\s+/).filter(Boolean);
      // a phone number typed any way ("98765 43210", "+91-98765-43210", "098765…", or just part of it)
      // matches the voter's saved numbers, in both search modes
      let pd = /^[+\d\s().-]+$/.test(raw) ? raw.replace(/\D/g, '') : '';
      if (pd.length > 10 && pd.startsWith('91')) pd = pd.slice(2); else if (pd.length === 11 && pd[0] === '0') pd = pd.slice(1);
      const phoneHit = pd.length >= 4 ? v => phonesOf(v.id).some(p => p.includes(pd)) : () => false;
      if (S.nameOnly) list = list.filter(v => phoneHit(v) || toks.every(t => {
        if (isTelugu(t)) return v._teN.includes(teNorm(t));
        const p = phon(t);
        return p && v._enN.includes(p);
      }));
      else list = list.filter(v => phoneHit(v) || toks.every(t => {
        if (isTelugu(t)) return v._te.includes(teNorm(t));
        const tl = t.toLowerCase();
        if (/^\d+$/.test(t)) return String(v.serial) === t ||v._house.startsWith(tl) || v._house.split(/[-/]/).includes(tl) || v.epic.toLowerCase().includes(tl);
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

  // the caste groups and family a voter is in, as a small line on the tile
  function grpLine(v) {
    const c = [], f = [];
    Object.keys(FAM).forEach(gid => { if (inGroup(gid, v.id)) (gType(gid) === 'caste' ? c : f).push(esc(famName(gid))); });
    if (!c.length && !f.length) return '';
    return `<div class="grp">${c.length ? `<span class="g-c">🏷️ ${c.join(', ')}</span>` : ''}${f.length ? `<span class="g-f">👪 ${f.join(', ')}</span>` : ''}</div>`;
  }

  function cardHTML(v) {
    const st = statusOf(v.id);
    return `<button class="card${st ? ' gone' : ''}" data-id="${v.id}">
      ${photo(v)}
      <div class="body">
        <div class="nm-row"><div class="nm">${hl(v.name || '(name not in list)', S.q)}</div>${wardPill(v)}</div>
        <div class="en">${esc(v.name_en)}</div>
        <div class="rel">${esc(v.relation)}: ${hl(v.relation_name || '—', S.nameOnly ? '' : S.q)}</div>
        ${grpLine(v)}
        <div class="meta"><span>House <b>${esc(v.house_no || '—')}</b></span>
          <span class="tag ${casteCls(v.caste)}">${casteLbl(v.caste)}</span>${notes[telKey(v.id)] ? `<span class="has-ph" title="Has a phone number">📞 ${phonesOf(v.id).length > 1 ? phonesOf(v.id).length : ''}</span>` : ''}${stTag(v.id)}</div>
      </div>
      <span class="sn">#${v.serial}</span>
      ${marks.has(v.id) ? '<span class="markdot" title="Marked"></span>' : ''}
    </button>`;
  }

  const stTag = id => { const st = statusOf(id); return st ? `<span class="tag st-${st.k}">${st.k === 'dead' ? '✝ Dead' : '⧉ Duplicate'}</span>` : ''; };
  function houseHTML(g) {
    const [w, h] = g.key.split('|');
    return `<div class="house"><div class="house-h" data-hk="${esc(g.key)}"><span>Ward ${w} · House ${esc(h)}</span><small>${g.items.length} voter${g.items.length > 1 ? 's' : ''}</small></div>
      ${g.items.map(v => `<button class="member${isGone(v.id) ? ' gone' : ''}" data-id="${v.id}">${photo(v)}<div class="m-body"><div class="nm-row"><div class="nm">${hl(v.name || '—', S.q)}</div>${wardPill(v)}${marks.has(v.id) ? '<span class="tag star" style="background:var(--mark)">★</span>' : ''}${stTag(v.id)}</div>
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
      const allG = t === 'family' ? famGroups(t, true) : [];
      groups = famGroups(t);
      const nDone = allG.filter(g => isReviewed(g.gid)).length;
      const revTab = (k, l, n) => `<button class="${S.frev === k ? 'on' : ''}" data-frev="${k}">${l}<b>${n}</b></button>`;
      const revBar = t === 'family' && allG.length ? `<div class="sn-tabs">${revTab('todo', 'Not reviewed', allG.length - nDone)}${revTab('done', 'Reviewed', nDone)}${revTab('all', 'All', allG.length)}</div>
        <div class="sn-progress" title="${Math.round(nDone / allG.length * 100)}% of families reviewed"><i style="width:${Math.round(nDone / allG.length * 100)}%"></i></div>` : '';
      const nv = new Set(groups.flatMap(g => g.items.map(v => v.id))).size, any = Object.keys(FAM).some(gid => gType(gid) === t);
      $('#summary').textContent = `${groups.length} ${groups.length === 1 ? T.label.toLowerCase() : T.plural.toLowerCase()} · ${nv.toLocaleString()} voters`;
      const auto = t === 'family' ? autoFamPlan().length : 0;
      listEl.innerHTML = (auto ? `<div class="g-new"><button class="btn primary" data-new="${t}">＋ New ${T.label.toLowerCase()}</button>
          <button class="btn" data-auto-fam>🏠 From houses (${auto})</button></div>`
        : `<button class="btn primary w100 fam-new" data-new="${t}">＋ New ${T.label.toLowerCase()}</button>`) +
        (t === 'family' && any ? (() => {
          const inFam = new Set(); Object.keys(FAM).forEach(gid => { if (gType(gid) === 'family') gMembers(gid).forEach((_, id) => inFam.add(id)); });
          const n = V.filter(v => !inFam.has(v.id) && (!S.ward || v.ward === S.ward)).length;
          return `<button class="nofam-link" data-nofam>👤 <span>${n ? `<b>${n.toLocaleString()}</b> voter${n === 1 ? ' is' : 's are'} not in any family${S.ward ? ` in Ward ${S.ward}` : ''}` : `Every voter${S.ward ? ` in Ward ${S.ward}` : ''} is in a family`}</span>${n ? '<em>See them ›</em>' : ''}</button>`;
        })() : '') +
        (t === 'family' && multiFamily().length ? `<button class="dup-warn" data-fix-dups>⚠ ${multiFamily().length} voter${multiFamily().length === 1 ? ' is' : 's are'} in more than one family. <b>Fix ›</b></button>` : '') + revBar +
        (groups.length ? '' : `<div class="empty">${any && t === 'family' && S.frev === 'todo' && !S.q.trim() ? '🎉 Every family is reviewed.' : any && t === 'family' && S.frev === 'done' && !S.q.trim() ? 'No family is reviewed yet.<br>Open a family, check its members and tap “Mark reviewed”.' : any ? `No ${T.label.toLowerCase()} matches.` : t === 'caste'
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
    if (S.caste !== 'all') $('#moreFilters').open = true;   // never hide a filter that is on
    chips($('#casteChips'), [['all', 'All'], ['BC', 'BC'], ['SC', 'SC'], ['ST', 'ST'], ['Not specified', 'Not specified']], S.caste, v => { S.caste = v; update(); });
    chips($('#statusChips'), [['all', 'Any'], ['ok', 'Active'], ['dead', '✝ Dead'], ['dup', '⧉ Duplicate'], ['gone', 'Dead or duplicate']], S.vst, v => { S.vst = v; update(); });
    // quick ranges in one scrolling row; the slider shows (and sets) any range
    const AGES = [['all', 'Any'], ['18-25', '18–25'], ['26-35', '26–35'], ['36-45', '36–45'], ['46-59', '46–59'], ['60-', '60+'], ['unk', 'Not known']];
    chips($('#ageChips'), AGES, AGES.some(([v]) => v === S.age) ? S.age : '', v => { S.age = v; update(); });
    paintAge();
    chips($('#phoneChips'), [['all', 'Any'], ['has', '📞 Has a number'], ['none', 'No number']], S.phone, v => { S.phone = v; update(); });
    chips($('#sortChips'), [['serial', 'Serial no.'], ['name', 'Name (A–Z)'], ['surname', 'Surname (A–Z)'], ['house', 'House no.']], S.sort, v => { S.sort = v; update(); });
    document.querySelectorAll('#viewSeg button[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    // Houses and Marked live in the More menu; the More button shows which one is open
    const mb = $('#moreBtn'), inMore = S.view === 'house' || S.view === 'marked';
    mb.classList.toggle('on', inMore);
    mb.firstChild.textContent = S.view === 'house' ? 'Houses' : S.view === 'marked' ? 'Marked' : 'More';
    const fc = S.view === 'surnames' ? (S.snf !== 'all') + (S.snsort !== 'count')
      : (S.caste !== 'all') + (S.age !== 'all') + (S.phone !== 'all') + (S.vst !== 'all') + (S.rel !== 'all') + !!S.surname + !!(S.cgrp && S.view !== 'caste') + !!(S.fgrp && S.view !== 'family') + (S.marked && S.view !== 'marked');
    $('#filterCount').textContent = fc ? fc : '';
    // surname dropdown + active filter chips
    const sn = S.surname && SURNAMES.get(S.surname);
    const sb = $('#surnameSelect');
    sb.innerHTML = `<span>${sn ? `${esc(sn.te)} · ${esc(sn.en)} (${sn.n})` : 'All surnames'}</span>`;
    sb.classList.toggle('on', !!sn);
    $('#surnameClear').hidden = !sn;
    const af = [];
    if (S.view !== 'surnames') {
      if (S.cgrp && S.view !== 'caste') af.push(`<button class="af" data-clear="cgrp">${S.cgrp === 'none' ? 'Not in a caste' : esc(gLabel(S.cgrp))} <b>×</b></button>`);
      if (S.fgrp === 'none' && S.view !== 'family') af.push(`<button class="af" data-clear="fgrp">Not in a family <b>×</b></button>`);
      if (S.fgrp === 'sel' && S.view !== 'family') af.push(...(S.fsel.length <= 2
        ? S.fsel.map(gid => `<button class="af" data-ffrm="${gid}">👪 ${esc(famName(gid))} <b>×</b></button>`)
        : [`<button class="af" data-clear="fgrp">👪 ${S.fsel.length} families <b>×</b></button>`]));
      if (S.marked && S.view !== 'marked') af.push(`<button class="af" data-clear="marked">★ Marked only <b>×</b></button>`);
    }
    if (sn && S.view !== 'surnames') af.push(`<button class="af" data-clear="surname">${esc(sn.te)} · ${esc(sn.en)} <b>×</b></button>`);
    if (S.caste !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="caste">Category: ${esc(casteLbl(S.caste) === '—' ? 'Not specified' : S.caste)} <b>×</b></button>`);
    if (S.age !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="age">${ageLbl(S.age)} <b>×</b></button>`);
    if (S.phone !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="phone">${S.phone === 'has' ? '📞 Has a number' : 'No phone number'} <b>×</b></button>`);
    if (S.vst !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="vst">${{ ok: 'Active only', dead: '✝ Dead', dup: '⧉ Duplicate', gone: 'Dead or duplicate' }[S.vst]} <b>×</b></button>`);
    if (S.rel !== 'all' && S.view !== 'surnames') af.push(`<button class="af" data-clear="rel">${esc(S.rel)} <b>×</b></button>`);
    if (S.sort !== 'serial' && (S.view === 'list' || S.view === 'marked')) af.push(`<button class="af" data-clear="sort">Sorted by ${{ name: 'name', surname: 'surname', house: 'house no.' }[S.sort] || S.sort} <b>×</b></button>`);
    if (S.ward) af.unshift(`<button class="af" data-clear="ward">Ward ${S.ward} <b>×</b></button>`);
    if (af.length > 1) af.unshift(`<button class="af clear-all" data-clear="all">Clear all</button>`);
    $('#activeFilters').innerHTML = af.length ? `<span class="af-lbl">Filters:</span>${af.join('')}` : '';
    $('#activeFilters').hidden = !af.length;
  }
  $('#activeFilters').onclick = e => {
    const r = e.target.closest('[data-ffrm]'); if (r) { ffToggle(r.dataset.ffrm, false); return; }
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const k = b.dataset.clear;
    if (k === 'all') { Object.assign(S, { ward: 0, age: 'all', phone: 'all', vst: 'all', caste: 'all', rel: 'all', sort: 'serial', surname: '', cgrp: '', fgrp: '', fsel: [], marked: false }); update(); return; }
    if (k === 'ward') { S.ward = 0; update(); return; }
    if (k === 'sort') { S.sort = 'serial'; update(); return; }
    if (k === 'fgrp') S.fsel = []; S[k] = k === 'marked' ? false : ['surname', 'cgrp', 'fgrp'].includes(k) ? '' : 'all'; update();
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
  const nameOnlyBtn = $('#nameOnly');
  const drawNameOnly = () => {
    nameOnlyBtn.classList.toggle('on', S.nameOnly);
    nameOnlyBtn.setAttribute('aria-pressed', S.nameOnly);
    q.placeholder = S.nameOnly ? 'Search voter name only…' : 'Name, father/husband, house no, EPIC, serial…';
  };
  nameOnlyBtn.onclick = () => { S.nameOnly = !S.nameOnly; drawNameOnly(); saveState(); render(); toast(S.nameOnly ? 'Searching voter names only' : 'Searching all details'); };
  drawNameOnly();
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
    if (el._onClose) { const f = el._onClose; el._onClose = null; f(); }
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
  $('#filterBtn').onclick = () => { drawFilterSheet(); if (S.caste !== 'all') $('#moreFilters').open = true; openSheet('#filterSheet'); };
  $('#closeFilters').onclick = () => closeTop();
  // age slider: two handles on one track, 18 to 100 (100 = no upper limit)
  const AGE_MIN = 18, AGE_MAX = 100;
  function paintAge(lo, hi) {
    if (lo == null) { const [a, b] = S.age === 'all' || S.age === 'unk' ? [null, null] : ageRange(S.age); lo = a == null ? AGE_MIN : a; hi = b == null ? AGE_MAX : b;
      $('#ageLo').value = lo; $('#ageHi').value = hi; }
    const pct = x => (x - AGE_MIN) / (AGE_MAX - AGE_MIN) * 100;
    $('#ageFill').style.left = pct(lo) + '%'; $('#ageFill').style.right = (100 - pct(hi)) + '%';
    $('#ageLo').style.zIndex = lo > AGE_MAX - 10 ? 3 : 1;   // so the left handle can still be pulled back when both sit at the right end
    $('#ageVal').textContent = S.age === 'unk' && lo === AGE_MIN && hi === AGE_MAX ? 'Not known'
      : lo === AGE_MIN && hi === AGE_MAX ? 'Any' : hi === AGE_MAX ? `${lo}+` : lo === AGE_MIN ? `up to ${hi}` : `${lo}–${hi}`;
  }
  // while a handle is dragged, a big number floats above it
  const ageTip = $('#ageTip');
  function showAgeTip(inp) {
    const x = +inp.value, pct = (x - AGE_MIN) / (AGE_MAX - AGE_MIN) * 100;
    ageTip.textContent = x === AGE_MAX ? '100+' : x; ageTip.style.left = pct + '%'; ageTip.hidden = false;
  }
  const hideAgeTip = () => { ageTip.hidden = true; };
  ['#ageLo', '#ageHi'].forEach(id => { const el = $(id);
    el.addEventListener('pointerdown', () => showAgeTip(el));
    ['pointerup', 'pointercancel', 'change', 'blur'].forEach(ev => el.addEventListener(ev, hideAgeTip));
  });
  let ageT = 0;
  ['#ageLo', '#ageHi'].forEach(id => $(id).oninput = e => {
    let lo = +$('#ageLo').value, hi = +$('#ageHi').value;
    if (lo > hi) { if (e.target.id === 'ageLo') lo = hi; else hi = lo; $('#ageLo').value = lo; $('#ageHi').value = hi; }
    if (S.age === 'unk') S.age = 'all';
    paintAge(lo, hi); showAgeTip(e.target);
    clearTimeout(ageT); ageT = setTimeout(() => {
      S.age = lo === AGE_MIN && hi === AGE_MAX ? 'all' : `${lo === AGE_MIN ? '' : lo}-${hi === AGE_MAX ? '' : hi}`;
      saveState(); drawChips(); render(); if (selecting) drawSelBar();
    }, 150);
  });
  $('#resetFilters').onclick = () => {
    if (S.view === 'surnames') { S.snf = 'all'; S.snsort = 'count'; }
    else Object.assign(S, { caste: 'all', age: 'all', phone: 'all', vst: 'all', rel: 'all', sort: 'serial', surname: '', cgrp: '', fgrp: '', fsel: [], marked: false, gsort: 'name' });
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
    const fs = S.fgrp === 'sel' ? S.fsel.filter(gid => FAM[gid]) : [];
    $('#fsFamily').innerHTML = fams.length && v !== 'family' ? `<h3>Family</h3><div class="chips wrap">
        <button class="chip ${!S.fgrp ? 'on' : ''}" data-fk="fgrp" data-fv="">Any</button>
        <button class="chip ${S.fgrp === 'none' ? 'on' : ''}" data-fk="fgrp" data-fv="none">Not in a family</button>
        <button class="chip ${fs.length ? 'on' : ''}" data-ffpick>👪 ${fs.length ? `${fs.length} chosen · Change` : `Choose families (${fams.length})`}</button></div>
      ${fs.length ? `<div class="chips wrap ff-sel">${fs.map(gid => `<button class="chip on" data-ffrm="${gid}">${esc(famName(gid))} <b>×</b></button>`).join('')}</div>` : ''}` : '';
    $('#fsSort').hidden = !(v === 'list' || v === 'marked');
    const n = isSn || isG || v === 'house' ? groups.length : current.length;
    const what = isSn ? 'surname' : isG ? GT[v].label.toLowerCase() : v === 'house' ? 'house' : 'voter';
    $('#closeFilters').textContent = `Show ${n.toLocaleString()} ${n === 1 ? what : what === 'family' ? 'families' : what + 's'}`;
  }
  $('#filterSheet').addEventListener('click', e => {
    if (e.target.closest('[data-ffpick]')) { showFamFilter(); return; }
    const r = e.target.closest('[data-ffrm]'); if (r) { ffToggle(r.dataset.ffrm, false); return; }
    const b = e.target.closest('[data-fk]'); if (!b) return;
    const k = b.dataset.fk, val = b.dataset.fv;
    if (k === 'fgrp') S.fsel = [];
    if (k === 'marked') S.marked = val === '1'; else S[k] = val;
    update();
  });

  // ---------- family picker for the Family filter (choose many) ----------
  function ffToggle(gid, on) {
    const set = new Set(S.fgrp === 'sel' ? S.fsel : []);
    on ? set.add(gid) : set.delete(gid);
    S.fsel = [...set]; S.fgrp = S.fsel.length ? 'sel' : '';
    update(); if (!$('#famFilterSheet').hidden) drawFamFilter();
  }
  function drawFamFilter() {
    const raw = $('#ffQ').value.trim().toLowerCase(), p = phon(raw), sel = new Set(S.fgrp === 'sel' ? S.fsel : []);
    const all = Object.keys(FAM).filter(gid => gType(gid) === 'family');
    const items = all.filter(gid => { const n = famName(gid).toLowerCase(); return !raw || n.includes(raw) || (p && n.split(/\s+/).map(phon).join(' ').includes(p)); })
      .sort((a, b) => sel.has(b) - sel.has(a) || famName(a).localeCompare(famName(b)));
    $('#ffN').textContent = sel.size ? `${sel.size} chosen · ${current.length.toLocaleString()} voters` : `${all.length} families · tap to choose`;
    $('#ffClear').hidden = !sel.size;
    $('#ffList').innerHTML = items.length ? items.map(gid => `<button class="opt ff-opt ${sel.has(gid) ? 'sel' : ''}" role="option" aria-selected="${sel.has(gid)}" data-ff="${gid}">
        <span class="ff-box">${sel.has(gid) ? '✓' : ''}</span><div class="o-main"><div class="o-te">${esc(famName(gid))}${isReviewed(gid) ? ' <em class="rev-tag">✓ Reviewed</em>' : ''}</div></div>
        <span class="o-n">${gMembers(gid).size}</span></button>`).join('') : '<div class="empty">No family matches.</div>';
    $('#ffDone').textContent = sel.size ? `Show ${current.length.toLocaleString()} voters` : 'Done';
  }
  function showFamFilter() { $('#ffQ').value = ''; drawFamFilter(); openSheet('#famFilterSheet'); $('#ffList').scrollTop = 0; }
  $('#ffList').addEventListener('click', e => { const b = e.target.closest('[data-ff]'); if (b) ffToggle(b.dataset.ff, !b.classList.contains('sel')); });
  $('#ffQ').addEventListener('input', drawFamFilter);
  $('#ffClear').onclick = () => { S.fsel = []; S.fgrp = ''; update(); drawFamFilter(); };
  $('#ffDone').onclick = () => closeTop();

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
    return `<p class="who">${t === 'm' ? '★ Marked' : id.startsWith('t:') ? '📞 Number saved' : id.startsWith('s:') ? (statusOf(id.slice(2)) || {}).k === 'dead' ? '✝ Marked dead' : '⧉ Marked duplicate' : '✎ Note'} by <b>${esc(by)}</b>${w.t ? ' · ' + ago(w.t) : ''}</p>`;
  }
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 1800); }
  function textOf(v) {
    return `${v.name} (${v.name_en}) – Ward ${v.ward}\n${v.relation}: ${v.relation_name} (${v.relation_name_en})\nWard ${v.ward} · Serial ${v.serial} · House ${v.house_no || '—'}\nEPIC: ${v.epic}\nAC list: 31-${v.ac_part}-${v.ac_serial}${phonesOf(v.id).length ? '\nPhone: ' + phonesOf(v.id).map(fmtPhone).join(', ') : ''}`;
  }
  // ---------- voter slips (image or text, shared to WhatsApp) ----------
  const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 3.9 3.5 1.5.6 2 .7 2.8.6.4-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z"/></svg>';
  const SLIP_HEAD = 'Pedagadi Gram Panchayat Elections 2026';
  const slipLine = v => `*${v.name || v.name_en}*${v.name && v.name_en ? ` (${v.name_en})` : ''}\n${v.relation}: ${v.relation_name || '—'}${v.relation_name_en ? ` (${v.relation_name_en})` : ''}\nWard ${v.ward} · Serial No. *${v.serial}* · House ${v.house_no || '—'}\nEPIC: ${v.epic || '—'}${v.age ? ` · Age ${v.age}` : ''}`;
  function slipText(vs, title) {
    return `🗳️ *Voter slip${vs.length > 1 ? 's' : ''}* – ${SLIP_HEAD}${title ? `\n👪 ${title} (${vs.length} voters)` : ''}\n\n`
      + vs.map((v, i) => (vs.length > 1 ? `${i + 1}. ` : '') + slipLine(v)).join('\n\n');
  }
  const SLIP_FONT = '"Noto Sans Telugu","Kohinoor Telugu","Telugu Sangam MN","Nirmala UI",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const loadImg = src => new Promise(res => {
    const im = new Image(), t = setTimeout(() => res(null), 5000);
    im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); };
    im.src = src;
  });
  // one PNG laid out like the ward PDF: page header, then a box per voter (1 column for one voter, 2 for more)
  const CASTE_TE = { SC: 'షె.కు.', ST: 'షె.తె.', BC: 'వె.త.' };
  const REL_TE = { Father: 'తండ్రి పేరు', Husband: 'భర్త పేరు', Mother: 'తల్లి పేరు', Wife: 'భార్య పేరు' };
  async function slipImage(vs, title, part) {
    try { await document.fonts.ready; } catch { }
    const cols = vs.length > 1 ? 2 : 1, rows = Math.ceil(vs.length / cols);
    const S = cols === 1 ? 6 : 4;                      // canvas pixels per PDF point
    const BW = 174, BH = 70, G = 2, M = 6, HEAD = title ? 54 : 46;
    const W0 = M * 2 + cols * BW + (cols - 1) * G;
    // footer dates in small type: one line when they fit (a phone's Telugu font may be wider), otherwise two
    const FL = 5.5, FN = 6, mc = document.createElement('canvas').getContext('2d');
    const dw = (lab, num) => { mc.font = `400 ${FL}px ${SLIP_FONT}`; let w = mc.measureText(lab).width; mc.font = `700 ${FN}px "Times New Roman",Times,serif`; return w + mc.measureText(num).width; };
    const lw = dw('వయస్సు లెక్కింపు తేదీ : ', '01-01-2026'), fw = dw('ప్రచురణ తేదీ : ', '15-04-2026');
    const two = lw + fw + 8 > W0 - 2 * M - 2, FOOT = two ? 18 : 11;
    const W = W0, H = M + HEAD + rows * (BH + G) - G + FOOT + M;
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
    const c = cv.getContext('2d'); c.scale(S, S);
    const TE = (w, px) => c.font = `${w} ${px}px ${SLIP_FONT}`;
    const NUM = px => c.font = `700 ${px}px "Times New Roman",Times,serif`;
    const fit = (s, max) => { s = String(s ?? ''); if (c.measureText(s).width <= max) return s; while (s && c.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; };
    const put = (s, x, y, max = 999, align = 'left') => { c.textAlign = align; c.fillText(fit(s, max), x, y); return c.measureText(fit(s, max)).width; };
    // runs of [font-setter, text] drawn one after another; returns the end x
    const runs = (list, x, y) => { list.forEach(([f, t]) => { f(); c.textAlign = 'left'; c.fillText(t, x, y); x += c.measureText(t).width; }); return x; };
    const wards = [...new Set(vs.map(v => v.ward))].sort((a, b) => a - b), mixed = wards.length > 1;
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#000'; c.lineWidth = 0.6; c.strokeRect(M - 2, M - 2, W - 2 * M + 4, H - 2 * M + 4);
    c.fillStyle = '#000'; c.textBaseline = 'alphabetic';
    const mid = W / 2;
    // the title shrinks to fit the narrow single-voter slip instead of being cut off
    const T1 = 'పెదగాడి గ్రామ పంచాయతీ ఓటర్ల జాబితా - 2026'; TE(700, 9.5); const t1w = c.measureText(T1).width, t1max = W - 2 * M - 2;
    TE(700, t1w > t1max ? 9.5 * t1max / t1w : 9.5); put(T1, mid, M + 10, 999, 'center');
    TE(700, 8); put('పెందుర్తి శాసనసభ నియోజకవర్గము', mid, M + 20, W - 2 * M, 'center');
    const L = M + 1, R = W - M - 1;
    TE(400, 8.5); runs([[() => TE(400, 8.5), 'గ్రామ పంచాయతీ : '], [() => TE(700, 8.5), 'పెదగాడి']], L, M + 32);
    runs([[() => TE(400, 8.5), 'మండలము : '], [() => TE(700, 8.5), 'పెందుర్తి']], L, M + 42);
    const wardTxt = wards.join(', ');
    TE(400, 8.5); let w1 = c.measureText('వార్డు నెంబరు : ').width; NUM(9); w1 += c.measureText(wardTxt).width;
    runs([[() => TE(400, 8.5), 'వార్డు నెంబరు : '], [() => NUM(9), wardTxt]], R - w1, M + 32);
    TE(400, 8.5); let w2 = c.measureText('జిల్లా : ').width; TE(700, 8.5); w2 += c.measureText('విశాఖపట్నం').width;
    runs([[() => TE(400, 8.5), 'జిల్లా : '], [() => TE(700, 8.5), 'విశాఖపట్నం']], R - w2, M + 42);
    if (title) { TE(700, 7); c.fillStyle = '#1f4e79'; put(`${title} · ${vs.length} ఓటర్లు${part ? ` · ${part}` : ''}`, mid, M + 51, W - 2 * M, 'center'); c.fillStyle = '#000'; }
    const photos = await Promise.all(vs.map(v => v.photo ? loadImg('photos/' + v.photo) : null));
    vs.forEach((v, i) => {
      const x = M + (i % cols) * (BW + G), y = M + HEAD + Math.floor(i / cols) * (BH + G);
      c.lineWidth = 0.6; c.strokeStyle = '#000'; c.strokeRect(x, y, BW, BH);
      const lx = x + 3, vx = x + 45;
      // top line: serial no. in a small box, AC list ref on the right
      TE(400, 6.2); let ex = runs([[() => TE(400, 6.2), 'గ్రా.పం.ఓ.జా.వ.సం . ']], lx, y + 9);
      NUM(7.5); const sw = Math.max(c.measureText(String(v.serial)).width + 6, 13);
      c.lineWidth = 0.6; c.strokeRect(ex, y + 2.3, sw, 9); c.textAlign = 'center'; c.fillText(String(v.serial), ex + sw / 2, y + 9.4);
      if (mixed) { TE(700, 6); c.textAlign = 'left'; c.fillText(`వార్డు ${v.ward}`, ex + sw + 3, y + 9); }
      TE(400, 6.2); let aw = c.measureText('అ.ఓ.జా.వ.సం .').width; NUM(6.8); const ac = `${31} - ${v.ac_part} - ${v.ac_serial}`; aw += c.measureText(ac).width;
      runs([[() => TE(400, 6.2), 'అ.ఓ.జా.వ.సం .'], [() => NUM(6.8), ac]], x + BW - 2 - aw, y + 9);
      // photo on the right
      const px = x + 132, py = y + 26, pw = 40, ph = 41, im = photos[i];
      c.fillStyle = '#f3f4f6'; c.fillRect(px, py, pw, ph); c.fillStyle = '#000';
      if (im) { c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip(); const s = Math.max(pw / im.width, ph / im.height), iw = im.width * s, ih = im.height * s; c.drawImage(im, px + (pw - iw) / 2, py + (ph - ih) / 2, iw, ih); c.restore(); }
      const vmax = x + 130 - vx;
      TE(400, 6.2); c.textAlign = 'left';
      c.fillText('ఓటరు పేరు', lx, y + 21); put(': ' + (v.name || v.name_en || ''), vx, y + 21, x + BW - 3 - vx);
      c.fillText(REL_TE[v.relation] || 'ఇతరులు', lx, y + 34); put(': ' + (v.relation_name || v.relation_name_en || ''), vx, y + 34, vmax);
      c.fillText('ఇంటి సంఖ్య', lx, y + 48);
      runs([[() => TE(700, 6.2), ': '], [() => NUM(6.8), v.house_no || '--']], vx, y + 48);
      TE(400, 6.2); c.fillText('కులము :', x + 78, y + 48);
      TE(700, 6.8); c.fillText(CASTE_TE[v.caste] || '--', x + 107, y + 48);
      runs([[() => TE(400, 6.2), 'ఓటరు ఐడి. కార్డు నెం. : '], [() => NUM(6.8), v.epic || '--']], lx, y + 64);
      // English name under the Telugu one, small and grey, so it can be read by anyone
      if (v.name_en) { c.fillStyle = '#555'; NUM(0); c.font = `italic 5px system-ui,sans-serif`; put(v.name_en, vx + 3, y + 27, vmax - 3); c.fillStyle = '#000'; }
    });
    // the two dates in small type; on one line when they fit, otherwise the second goes below
    const fy = H - M - 2;
    runs([[() => TE(400, FL), 'వయస్సు లెక్కింపు తేదీ : '], [() => NUM(FN), '01-01-2026']], L, two ? fy - 7 : fy);
    runs([[() => TE(400, FL), 'ప్రచురణ తేదీ : '], [() => NUM(FN), '15-04-2026']], R - fw, fy);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  const slipFileName = (vs, title, part) => (title ? title.replace(/[^\wఀ-౿ -]+/g, '').trim().replace(/\s+/g, '-') + '-voter-slips' : `voter-slip-${vs[0].epic || vs[0].id}`) + (part ? `-${part.replace(/\D+/g, '-').replace(/^-|-$/g, '')}` : '') + '.png';
  const SLIPS_PER_IMAGE = 12;
  const famSlipVoters = gid => [...gMembers(gid).keys()].map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
  // open the slip sheet for one voter or a family; title = family name (or '' for one voter)
  async function showSlips(vs, title = '') {
    vs = vs.filter(Boolean);
    // family / house slips leave out voters marked dead or duplicate
    const left = vs.length > 1 ? vs.filter(v => isGone(v.id)).length : 0;
    if (left) vs = vs.filter(v => !isGone(v.id));
    if (!vs.length) { toast('No voters to share (all are marked dead or duplicate)'); return; }
    const token = {}; $('#slipSheet')._token = token;
    $('#slipTitle').textContent = vs.length > 1 ? 'Voter slips' : 'Voter slip';
    $('#slipSub').textContent = (title ? `${title} · ${vs.length} voter${vs.length === 1 ? '' : 's'}${vs.length > SLIPS_PER_IMAGE ? ` · ${Math.ceil(vs.length / SLIPS_PER_IMAGE)} images` : ''}` : `${vs[0].name_en} · Ward ${vs[0].ward} · Serial ${vs[0].serial}`)
      + (left ? ` · ${left} dead / duplicate left out` : '') + (vs.length === 1 && isGone(vs[0].id) ? ` · marked ${statusOf(vs[0].id).k === 'dead' ? 'dead' : 'duplicate'}` : '');
    const prev = $('#slipPrev'), imgBtn = $('#slipImg');
    prev.innerHTML = '<p class="hint" style="margin:8px">Making the slip…</p>'; imgBtn.disabled = true;
    const slipTxt = slipText(vs, title);
    // what the WhatsApp text buttons send: the slip details, or your own message ({name} = the voter's name)
    const msgFor = v => {
      if (LS.get('pv_msgmode', 'slip') !== 'msg') return slipTxt;
      const nm = v ? firstName(v) : vs.length === 1 ? firstName(vs[0]) : '';
      return (LS.get('pv_msg', 'Hi {name}') || '').replace(/\{name\}/gi, nm).replace(/[ \t]+([,.!])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
    };
    const drawMsg = () => {
      const m = LS.get('pv_msgmode', 'slip');
      $('#msgMode').querySelectorAll('[data-mm]').forEach(b => b.classList.toggle('on', b.dataset.mm === m));
      $('#msgTxt').hidden = $('#msgHint').hidden = m !== 'msg';
    };
    $('#msgTxt').value = LS.get('pv_msg', 'Hi {name}');
    $('#msgTxt').oninput = () => LS.set('pv_msg', $('#msgTxt').value);
    $('#msgMode').onclick = e => { const b = e.target.closest('[data-mm]'); if (!b) return; LS.set('pv_msgmode', b.dataset.mm); drawMsg(); if (b.dataset.mm === 'msg') $('#msgTxt').focus(); };
    drawMsg();
    // WhatsApp text: to anyone, or straight to a saved number of these voters
    const byNum = new Map(vs.flatMap(v => phonesOf(v.id).map(p => [p, v]))), nums = [...byNum.entries()].slice(0, 6);
    $('#slipTo').className = 'slip-to';
    $('#slipTo').innerHTML = nums.map(([p, v]) => `<button type="button" class="btn wa-out" data-wa-to="${p}">Text to ${esc(fmtPhone(p))}${vs.length > 1 ? ` <small>(${esc(firstName(v))})</small>` : ''}</button>`).join('');
    $('#slipTo').querySelectorAll('[data-wa-to]').forEach(b => b.onclick = () => window.open(`https://wa.me/91${b.dataset.waTo}?text=${encodeURIComponent(msgFor(byNum.get(b.dataset.waTo)))}`, '_blank'));
    $('#slipTxt').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(msgFor()), '_blank');
    $('#slipClose').onclick = () => closeTop();
    if (!raise('#slipSheet')) openSheet('#slipSheet');
    $('#slipSheet')._onClose = () => stopVoice(true);
    drawVoice();
    $('#slipSheet .sheet').scrollTop = 0;
    // build the images now, so the share button works straight away when tapped
    const parts = [];
    for (let i = 0; i < vs.length; i += SLIPS_PER_IMAGE) parts.push(vs.slice(i, i + SLIPS_PER_IMAGE));
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts.length > 1 ? `part ${i + 1} of ${parts.length}` : '';
      const blob = await slipImage(parts[i], title, part);
      if ($('#slipSheet')._token !== token) return;  // another slip was opened meanwhile
      if (!blob) continue;
      files.push(new File([blob], slipFileName(parts[i], title, part), { type: 'image/png' }));
    }
    if (!files.length) { prev.innerHTML = '<p class="hint" style="margin:8px">Could not make the image. Send as text instead.</p>'; return; }
    (prev._urls || []).forEach(u => URL.revokeObjectURL(u));
    prev._urls = files.map(f => URL.createObjectURL(f));
    prev.innerHTML = prev._urls.map(u => `<img src="${u}" alt="Voter slip preview">`).join('');
    const canFiles = !!(navigator.canShare && navigator.canShare({ files }));
    imgBtn.disabled = false;
    imgBtn.querySelector('span').textContent = canFiles ? `Share slip${vs.length > 1 ? 's' : ''} image${files.length > 1 ? 's' : ''}` : `Download slip image${files.length > 1 ? 's' : ''}`;
    $('#slipHint').textContent = canFiles ? 'Tap the green button, then choose WhatsApp and the person to send it to.'
      : 'This browser can’t share images directly. Download the image, then attach it in WhatsApp — or send the slip as text.';
    imgBtn.onclick = async () => {
      if (canFiles) {
        try { await navigator.share({ files, title: title ? `${title} – voter slips` : `Voter slip – ${vs[0].name_en}` }); }
        catch (e) { if (e && e.name !== 'AbortError') toast('Sharing failed. Try “Send as text”.'); }
        return;
      }
      files.forEach((f, i) => { const a = document.createElement('a'); a.href = prev._urls[i]; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
      toast(files.length > 1 ? 'Images saved. Attach them in WhatsApp.' : 'Image saved. Attach it in WhatsApp.');
    };
  }
  // ---------- voice message: record once on this device, share it to WhatsApp with the slips ----------
  // kept in IndexedDB (too big for localStorage); never synced
  const idb = (mode, fn) => new Promise((res, rej) => {
    let rq; try { rq = indexedDB.open('pv', 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => { const tx = rq.result.transaction('kv', mode), r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
  });
  const VOICE_MAX = 180;   // seconds
  const voice = { rec: null, loaded: false, data: null, url: '', timer: 0, t0: 0, discard: false };
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  async function loadVoice() {
    if (voice.loaded) return;
    try { voice.data = await idb('readonly', st => st.get('voice')) || null; } catch { voice.data = null; }
    voice.loaded = true; setVoiceUrl();
  }
  function setVoiceUrl() { if (voice.url) URL.revokeObjectURL(voice.url); voice.url = voice.data ? URL.createObjectURL(voice.data.blob) : ''; }
  // WhatsApp plays .wav, .m4a and .ogg; Chrome records only WebM, so that is turned into a small mono WAV
  async function toWav(blob) {
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    try {
      const src = await ac.decodeAudioData(await blob.arrayBuffer());
      const rate = 16000, len = Math.ceil(src.duration * rate);
      const off = new OfflineAudioContext(1, len, rate), n = off.createBufferSource();
      n.buffer = src; n.connect(off.destination); n.start();
      const pcm = (await off.startRendering()).getChannelData(0);
      const buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
      const w = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
      d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); d.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
      return { blob: new Blob([buf], { type: 'audio/wav' }), ext: 'wav', dur: src.duration };
    } finally { ac.close && ac.close(); }
  }
  async function startVoice() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser can’t record audio'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('Microphone not allowed. Allow it in the browser settings.'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : {}), chunks = [];
    voice.rec = rec; voice.discard = false; voice.t0 = Date.now();
    rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); clearInterval(voice.timer); voice.rec = null;
      if (voice.discard || !chunks.length) { drawVoice(); return; }
      $('#voiceBox').innerHTML = '<p class="hint">Saving…</p>';
      const raw = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), dur = (Date.now() - voice.t0) / 1000;
      let out;
      if (/webm/.test(raw.type)) { try { out = await toWav(raw); } catch { out = { blob: raw, ext: 'weba', dur }; } }
      else out = { blob: raw, ext: /mp4|aac/.test(raw.type) ? 'm4a' : 'ogg', dur };
      if (dur < 1) { toast('Too short. Hold on a little longer.'); drawVoice(); return; }
      voice.data = { blob: out.blob, ext: out.ext, dur: out.dur || dur, t: Date.now() }; setVoiceUrl();
      try { await idb('readwrite', st => st.put(voice.data, 'voice')); } catch { toast('Could not save it for later; share it now'); }
      drawVoice(); toast('Voice message ready');
    };
    rec.start(1000);
    voice.timer = setInterval(() => {
      const s = (Date.now() - voice.t0) / 1000, el = $('#vcTime');
      if (el) el.textContent = `${mmss(s)} / ${mmss(VOICE_MAX)}`;
      if (s >= VOICE_MAX) stopVoice();
    }, 250);
    drawVoice();
  }
  function stopVoice(discard) { if (voice.rec && voice.rec.state !== 'inactive') { voice.discard = !!discard; voice.rec.stop(); } }
  async function shareVoice() {
    const v = voice.data; if (!v) return;
    const f = new File([v.blob], `voice-message.${v.ext}`, { type: v.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: 'Voice message' }); }
      catch (e) { if (e && e.name !== 'AbortError') toast('Sharing failed'); }
      return;
    }
    const a = document.createElement('a'); a.href = voice.url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    toast('Saved. Attach it in WhatsApp.');
  }
  async function drawVoice() {
    const box = $('#voiceBox'); await loadVoice();
    const mic = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>';
    if (voice.rec) {
      box.innerHTML = `<h3 class="vc-h">Voice message</h3><div class="vc-rec"><span class="vc-dot"></span><b>Recording</b><span id="vcTime" class="vc-time">${mmss((Date.now() - voice.t0) / 1000)} / ${mmss(VOICE_MAX)}</span></div>
        <div class="vc-row"><button type="button" class="btn" id="vcCancel">Cancel</button><button type="button" class="btn primary" id="vcStop">■ Stop</button></div>`;
      $('#vcStop').onclick = () => stopVoice(); $('#vcCancel').onclick = () => stopVoice(true); return;
    }
    if (!voice.data) {
      box.innerHTML = `<h3 class="vc-h">Voice message</h3><button type="button" class="btn w100 vc-big" id="vcRec">${mic}<span>Record a voice message</span></button>
        <p class="hint">Record once (up to 3 minutes) and send it to anyone on WhatsApp. It stays on this device for next time.</p>`;
      $('#vcRec').onclick = startVoice; return;
    }
    const v = voice.data, canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([v.blob], 'voice-message.' + v.ext, { type: v.blob.type })] }));
    box.innerHTML = `<h3 class="vc-h">Voice message <small>${mmss(v.dur)} · recorded ${esc(ago(v.t))}</small></h3>
      <audio controls preload="metadata" src="${voice.url}"></audio>
      <button type="button" class="btn wa-out w100 vc-big" id="vcShare">${WA_ICON}<span>${canShare ? 'Share' : 'Download'} voice message</span></button>
      <div class="vc-row"><button type="button" class="btn" id="vcAgain">${mic}<span>Record again</span></button><button type="button" class="btn danger" id="vcDel">Delete</button></div>
      <p class="hint">${canShare ? 'Tap “Share voice message”, then choose WhatsApp and the person. Send the slip first, then the voice message.' : 'This browser can’t share audio directly. Download it, then attach it in WhatsApp.'}</p>`;
    $('#vcShare').onclick = shareVoice;
    $('#vcAgain').onclick = startVoice;
    $('#vcDel').onclick = async () => {
      if (!await askSure({ title: 'Delete the voice message?', body: 'It is removed from this device. You can record a new one any time.', ok: 'Delete', danger: true })) return;
      voice.data = null; setVoiceUrl(); try { await idb('readwrite', st => st.delete('voice')); } catch { }
      drawVoice();
    };
  }
  // ---------- dead / duplicate ----------
  function setStatus(id, val) {
    if (val) notes[stKey(id)] = val; else delete notes[stKey(id)];
    LS.set('pv_notes', notes); cloud.put('n', stKey(id), val || null);
    const c = listEl.querySelector(`[data-id="${id}"]`);
    if (c && c.classList.contains('card')) c.outerHTML = cardHTML(byId.get(id)); else if (c) render();
    if (S.vst !== 'all') render();
  }
  // likely other entries of the same person: same name (Telugu or English) or same EPIC, best first
  function dupCandidates(v) {
    const n = phon(v.name_en || ''), te = teNorm(v.name || ''), rn = phon(v.relation_name_en || ''), ep = (v.epic || '').toUpperCase();
    return V.filter(x => x.id !== v.id && ((n && phon(x.name_en || '') === n) || (te && teNorm(x.name || '') === te) || (ep && (x.epic || '').toUpperCase() === ep)))
      .map(x => ({ x, sc: ((x.epic || '').toUpperCase() === ep ? 4 : 0) + (rn && phon(x.relation_name_en || '') === rn ? 2 : 0) + (x.house_no && x.house_no === v.house_no ? 1 : 0) + (x.ward === v.ward ? 0.5 : 0) }))
      .sort((a, b) => b.sc - a.sc || a.x.ward - b.x.ward || a.x.serial - b.x.serial).slice(0, 12).map(e => e.x);
  }
  function showDupPick(id) {
    const v = byId.get(id), sug = dupCandidates(v);
    const row = x => `<button class="member${isGone(x.id) ? ' gone' : ''}" data-dp="${x.id}">${photo(x)}<div class="m-body"><div class="nm-row"><div class="nm">${esc(x.name || '—')}</div>${wardPill(x)}${stTag(x.id)}</div>
      <div class="en">${esc(x.name_en)} · ${esc(x.relation)}: ${esc(x.relation_name_en || '—')} · #${x.serial} · House ${esc(x.house_no || '—')} · ${esc(x.epic)}</div></div></button>`;
    const draw = q => {
      q = q.trim(); let list = sug;
      if (q) {
        const toks = q.split(/\s+/);
        list = V.filter(x => x.id !== id && toks.every(t => isTelugu(t) ? x._te.includes(teNorm(t)) : /^\d+$/.test(t) ? String(x.serial) === t || x._house.startsWith(t) : x._en.includes(phon(t)) || x.epic.toLowerCase().includes(t.toLowerCase()))).slice(0, 30);
      }
      $('#dpList').innerHTML = list.length ? `<div class="house">${list.map(row).join('')}</div>` : `<p class="hint">${q ? 'No voter matches.' : 'No voter with the same name was found. Search for the other entry above, or mark it without one.'}</p>`;
      $('#dpHead').textContent = q ? 'Search results' : sug.length ? 'Same name in the roll' : '';
    };
    $('#dpWho').innerHTML = `${esc(v.name)} · ${esc(v.name_en)} · Ward ${v.ward} #${v.serial} · ${esc(v.epic)}`;
    const qi = $('#dpQ'); qi.value = ''; qi.oninput = () => draw(qi.value); draw('');
    $('#dpList').onclick = e => { const b = e.target.closest('[data-dp]'); if (!b) return; setStatus(id, 'dup:' + b.dataset.dp); closeTop(); showDetail(id, true); toast('Marked as duplicate'); };
    $('#dpNone').onclick = () => { setStatus(id, 'dup'); closeTop(); showDetail(id, true); toast('Marked as duplicate'); };
    $('#dpCancel').onclick = () => closeTop();
    openSheet('#dupSheet');
  }
  // ---------- phone numbers ----------
  function setPhones(id, list) {
    const val = [...new Set(list)].slice(0, 5).join(',');
    if (val) notes[telKey(id)] = val; else delete notes[telKey(id)];
    LS.set('pv_notes', notes); cloud.put('n', telKey(id), val || null);
    const c = listEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`); if (c) { c.outerHTML = cardHTML(byId.get(id)); paintSel(); }
  }
  function drawPhones(id) {
    const v = byId.get(id), list = phonesOf(id);
    $('#phWho').innerHTML = `${esc(v.name)} · ${esc(v.name_en)} · Ward ${v.ward} #${v.serial}`;
    // removing asks right in the row: "Remove this number?  Keep / Remove"
    const ask = $('#phList')._ask;
    $('#phList').innerHTML = list.length ? `<div class="house">${list.map(p => p === ask
      ? `<div class="ph-item ask"><span>Remove <b>${fmtPhone(p)}</b>?</span><span class="ph-btns"><button class="btn" data-ph-keep>Keep</button><button class="btn danger" data-ph-yes="${p}">Remove</button></span></div>`
      : `<div class="ph-item"><a href="tel:+91${p}">📞 ${fmtPhone(p)}</a>
        <button class="ph-rm" data-ph-rm="${p}" aria-label="Remove ${fmtPhone(p)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>Remove</button></div>`).join('')}</div>` : '<p class="hint">No number saved yet.</p>';
    $('#phHint').textContent = cloud.code ? 'Numbers are shared with everyone who uses your sync code.' : 'Numbers are saved on this device only. Turn on sync to share them.';
    $('#phForm').hidden = list.length >= 5;
  }
  function showPhones(id) {
    const inp = $('#phInput'), warn = $('#phWarn');
    inp.value = ''; warn.hidden = true;
    drawPhones(id);
    $('#phList')._ask = '';
    $('#phList').onclick = e => {
      const rm = e.target.closest('[data-ph-rm]'); if (rm) { $('#phList')._ask = rm.dataset.phRm; drawPhones(id); return; }
      if (e.target.closest('[data-ph-keep]')) { $('#phList')._ask = ''; drawPhones(id); return; }
      const yes = e.target.closest('[data-ph-yes]'); if (!yes) return;
      $('#phList')._ask = '';
      setPhones(id, phonesOf(id).filter(p => p !== yes.dataset.phYes)); drawPhones(id); toast(`${fmtPhone(yes.dataset.phYes)} removed`);
    };
    inp.oninput = () => { warn.hidden = true; };
    $('#phForm').onsubmit = e => {
      e.preventDefault();
      const p = normPhone(inp.value);
      if (!p) { warn.textContent = 'Enter a 10-digit mobile number, e.g. 98765 43210.'; warn.hidden = false; inp.focus(); return; }
      if (phonesOf(id).includes(p)) { warn.textContent = 'This number is already saved.'; warn.hidden = false; return; }
      const other = V.find(x => x.id !== id && phonesOf(x.id).includes(p));
      setPhones(id, [...phonesOf(id), p]); inp.value = ''; drawPhones(id);
      toast(other ? `Saved. The same number is also on ${other.name_en || other.name}` : 'Number saved');
    };
    $('#phDone').onclick = () => closeTop();
    $('#phoneSheet')._onClose = () => refreshDetailFam();
    openSheet('#phoneSheet');
    setTimeout(() => inp.focus(), 120);
  }
  // a contact card (.vcf) for the phone's Contacts app; its website field links back to this voter's profile (…/#v=<id>)
  const profileLink = id => APP_URL + '#v=' + encodeURIComponent(id);
  async function saveContact(v) {
    const vc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const name = v.name_en || v.name || 'Voter';
    const card = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vc(name)}`, (() => { const sn = v.surname_en && name.endsWith(' ' + v.surname_en) ? v.surname_en : ''; return `N:${vc(sn)};${vc(sn ? name.slice(0, -sn.length - 1) : name)};;;`; })(),
      ...phonesOf(v.id).map(p => `TEL;TYPE=CELL:+91${p}`),
      `URL:${profileLink(v.id)}`,
      `NOTE:${vc(`${v.name ? v.name + ' · ' : ''}Pedagadi Ward ${v.ward}, serial ${v.serial}, house ${v.house_no || '—'}, EPIC ${v.epic}. Voter profile: ${profileLink(v.id)}`)}`,
      'END:VCARD'].join('\r\n') + '\r\n';
    const fname = name.replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '_') + '.vcf';
    const file = new File([card], fname, { type: 'text/vcard' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Contact card downloaded. Open it to add to Contacts');
  }
  function showDetail(id, replace) {
    const v = byId.get(id); if (!v) return;
    $('#detailSheet')._vid = id;
    const fam = (households.get(v.hkey) || []).filter(x => x.id !== v.id);
    const marked = marks.has(v.id);
    const myFams = Object.keys(FAM).filter(gid => gType(gid) === 'family' && inGroup(gid, v.id) && gMembers(gid).size > 1);
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
        <dt>Status</dt><dd class="fam-dd st-dd">${(() => {
          const st = statusOf(v.id), of = st && st.of && byId.get(st.of);
          if (!st) return `<button class="fam-chip add" id="dDead">✝ Mark as dead</button><button class="fam-chip add" id="dDup">⧉ Mark as duplicate</button>`;
          return `${stTag(v.id)}${of ? `<button class="linkish" data-dup-of="${of.id}">of #${of.serial} ${esc(of.name_en || of.name)}${of.ward !== v.ward ? ` (Ward ${of.ward})` : ''}</button>` : ''}<button class="fam-chip" id="dStUndo">Undo</button>
            <small>${whoLine('n', stKey(v.id)).replace(/<\/?p[^>]*>/g, '')}</small>`;
        })()}</dd>
        <dt>Phone</dt><dd class="ph-dd">${phonesOf(v.id).map(p => `<span class="ph-row"><a class="ph-call" href="tel:+91${p}">📞 ${fmtPhone(p)}</a><a class="ph-wa" href="https://wa.me/91${p}" target="_blank" rel="noopener" aria-label="WhatsApp ${fmtPhone(p)}">WhatsApp</a></span>`).join('')}
          <button class="fam-chip add" id="dPhone">${phonesOf(v.id).length ? '✎ Edit numbers' : '＋ Add phone number'}</button>${phonesOf(v.id).length ? '<button class="fam-chip add" id="dContact">👤 Save to phone contacts</button>' : ''}${notes[telKey(v.id)] ? `<small>${whoLine('n', telKey(v.id)).replace(/<\/?p[^>]*>/g, '')}</small>` : ''}</dd>
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
      <button class="btn wa w100 wa-slip" id="dSlip">${WA_ICON}<span>Share voter slip on WhatsApp</span></button>
      ${myFams.length ? myFams.map(gid => `<button class="btn wa-out w100 wa-slip" data-fam-slip="${gid}">${WA_ICON}<span>Share slips of family “${esc(famName(gid))}” (${gMembers(gid).size})</span></button>`).join('') : ''}
      ${marked ? whoLine('m', v.id) : ''}
      <textarea class="note" id="dNote" placeholder="${cloud.code ? 'Note (synced with your sync code)' : 'Private note (saved on this phone only)'}">${esc(notes[v.id] || '')}</textarea>
      ${notes[v.id] ? whoLine('n', v.id) : ''}
      ${fam.length ? `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 4px;text-transform:uppercase">Same house (${fam.length})<button class="slip-link" id="dHouseSlip">📲 Share all ${fam.length + 1} slips</button></h3>
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
    $('#dSlip').onclick = () => showSlips([v]);
    const onB = (sel, fn) => { const b = $('#detail').querySelector(sel); if (b) b.onclick = fn; };
    onB('#dDead', async () => {
      if (!await askSure({ title: `Mark ${v.name_en || v.name} as dead?`, ok: 'Mark as dead', danger: true,
        body: `<p>The voter stays in the list with a <b>✝ Dead</b> tag${cloud.code ? ', for everyone using your sync code' : ''}. Their slip is left out when sharing family or house slips. You can undo this.</p>` })) return;
      setStatus(v.id, 'dead'); showDetail(v.id, true); toast('Marked as dead');
    });
    onB('#dDup', () => showDupPick(v.id));
    onB('#dStUndo', () => { setStatus(v.id, ''); showDetail(v.id, true); toast('Status removed'); });
    $('#detail').querySelectorAll('[data-dup-of]').forEach(b => b.onclick = () => { showDetail(b.dataset.dupOf, true); $('#detailSheet .sheet').scrollTop = 0; });
    $('#detail').querySelectorAll('[data-fam-slip]').forEach(b => b.onclick = () => showSlips(famSlipVoters(b.dataset.famSlip), famName(b.dataset.famSlip)));
    if ($('#dHouseSlip')) $('#dHouseSlip').onclick = () => showSlips([v, ...fam].sort((a, b) => a.serial - b.serial), `House ${v.house_no || '—'}, Ward ${v.ward}`);
    $('#dFam').onclick = () => showFamPick(v.id);
    $('#dPhone').onclick = () => showPhones(v.id);
    onB('#dContact', () => saveContact(v));
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
    if (e.target.closest('[data-auto-fam]')) { autoFamilies(); return; }
    if (e.target.closest('[data-fix-dups]')) { showDupFix(); return; }
    if (e.target.closest('[data-nofam]')) { S.fgrp = 'none'; S.view = 'list'; update(); return; }
    const fr = e.target.closest('[data-frev]'); if (fr) { S.frev = fr.dataset.frev; saveState(); render(); if (selecting) drawSelBar(); return; }
    const sf = e.target.closest('[data-snf]'); if (sf) { S.snf = sf.dataset.snf; saveState(); render(); if (selecting) drawSelBar(); return; }
    const ss = e.target.closest('[data-snsort]'); if (ss) { S.snsort = ss.dataset.snsort; saveState(); render(); return; }
    const sr = e.target.closest('[data-sn]');
    if (sr) { if (pressed) { pressed = false; return; } if (selecting) toggleSel(sr.dataset.sn); else showSurname(sr.dataset.sn); return; }
    const gl = e.target.closest('[data-fam-list]'); if (gl) { showGroupInList(gl.dataset.famList); return; }
    const f = e.target.closest('[data-fam-open]'); if (f) { showFam(f.dataset.famOpen); return; }
    // while selecting, tapping a house / family heading selects (or unselects) everyone in it
    const hd = selecting && e.target.closest('[data-hk], [data-gk]');
    if (hd) {
      const g = groups.find(x => hd.dataset.gk ? x.gid === hd.dataset.gk : x.key === hd.dataset.hk); if (!g) return;
      const ids = g.items.map(v => v.id), all = ids.every(id => sel.has(id));
      ids.forEach(id => all ? sel.delete(id) : sel.add(id)); paintSel(); drawSelBar(); return;
    }
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
    $('#selMark').disabled = $('#selGroup').disabled = $('#selShare').disabled = !sel.size;
    $('#selMark').hidden = $('#selShare').hidden = S.view === 'surnames';
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
    pressed = false;   // a long-press on a phone may end without a click; never let it swallow the next tap
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
  // share slips (image or WhatsApp text) of the selected voters, in roll order
  $('#selShare').onclick = () => {
    const vs = [...sel].map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
    if (vs.length) showSlips(vs, vs.length > 1 ? 'Selected voters' : '');
  };
  // search box for the group pickers: filters the group rows (and surname chips) as you type; kept while the sheet redraws
  let fpQ = '';
  const fpSearchHTML = n => n ? `<div class="fp-search"><input type="search" class="fp-q" placeholder="Search ${n} families and castes…" value="${esc(fpQ)}" autocomplete="off" enterkeyhint="search"></div>` : '';
  function wireFpSearch(box, refocus) {
    const inp = box.querySelector('.fp-q'); if (!inp) return;
    const apply = () => {
      fpQ = inp.value; const toks = fpQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let any = false;
      box.querySelectorAll('[data-g], [data-bg], [data-gs]').forEach(el => {
        const name = famName(el.dataset.g || el.dataset.bg || el.dataset.gs).toLowerCase();
        const hit = toks.every(t => name.includes(t)); el.style.display = hit ? '' : 'none';
        if (hit && !el.dataset.gs) any = true;
      });
      let none = box.querySelector('.fp-none');
      if (!none) { none = document.createElement('p'); none.className = 'hint fp-none'; box.querySelector('.fp-list')?.after(none); }
      none.hidden = any || !toks.length; none.textContent = `No family or caste matches “${fpQ.trim()}”. Tap “New family” to make it.`;
    };
    inp.oninput = apply; apply();
    if (refocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  // add the selected voters to a group
  function showBulkPick(again) {
    const ids = [...sel], n = ids.length;
    if (!again) fpQ = '';
    const focused = again && document.activeElement && document.activeElement.classList.contains('fp-q');
    const list = Object.keys(FAM).sort((a, b) => gType(a).localeCompare(gType(b)) || famName(a).localeCompare(famName(b)));
    $('#famPick').innerHTML = `<h2>Add ${n} voter${n === 1 ? '' : 's'} to a group</h2>
      <div class="d-actions"><button class="btn primary" id="bpNewF">＋ New family</button><button class="btn primary" id="bpNewC">＋ New caste</button></div>
      ${fpSearchHTML(list.length)}
      ${list.length ? `<h3>Your groups</h3><div class="picker-list fp-list">${list.map(gid => {
        const inN = ids.filter(id => inGroup(gid, id)).length, all = inN === n;
        return `<button class="opt ${all ? 'sel' : ''}" data-bg="${gid}"><div class="o-main"><div class="o-te">${all ? '✓ ' : ''}${esc(gLabel(gid))}</div>
          <div class="o-en">${GT[gType(gid)].label} · ${inN ? `${inN} of ${n} already in` : `${gMembers(gid).size} voters`}</div></div><span class="o-n">${all ? 'Remove' : `Add ${n - inN}`}</span></button>`;
      }).join('')}</div>` : '<p class="hint">No groups yet. Make one above.</p>'}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    wireFpSearch(box, focused);
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelector('#bpNewF').onclick = () => bulkNew('family');
    box.querySelector('#bpNewC').onclick = () => bulkNew('caste');
    box.querySelectorAll('[data-bg]').forEach(b => b.onclick = async () => {
      const gid = b.dataset.bg, all = ids.every(id => inGroup(gid, id));
      if (all) { if (!await askSure({ title: `Remove from ${famName(gid)}?`, body: `<p>Take the ${n} selected voter${n === 1 ? '' : 's'} out of <b>${esc(famName(gid))}</b>. The voters themselves are not deleted.</p>`, ok: 'Remove', danger: true })) return; gRemoveMany(gid, ids); toast(`Removed ${n} from ${famName(gid)}`); showBulkPick(true); return; }
      const added = gAddMany(gid, ids);
      toast(`Added ${added} to ${famName(gid)}${lastMoved ? ` (${lastMoved} moved from another family)` : ''}`); leaveSelect();
    });
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  // ---------- "are you sure?" in an in-app sheet; resolves true / false, after the sheet's history entry is gone ----------
  function askSure({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
    return new Promise(resolve => {
      const sh = $('#askSheet'), yes = $('#askYes');
      $('#askTitle').textContent = title; $('#askBody').innerHTML = body; $('#askBody').hidden = !body;
      yes.textContent = ok; $('#askNo').textContent = cancel;
      yes.classList.toggle('primary', !danger); yes.classList.toggle('danger-fill', danger);
      let done = false; const finish = v => { if (!done) { done = true; resolve(v); } };
      sh._onClose = () => finish(false);
      $('#askNo').onclick = () => closeTop();
      yes.onclick = () => {
        sh._onClose = null;
        const after = () => { removeEventListener('popstate', after); clearTimeout(tm); finish(true); };
        const tm = setTimeout(after, 500); addEventListener('popstate', after);
        closeTop();
      };
      openSheet('#askSheet'); setTimeout(() => yes.focus(), 120);
    });
  }

  // ---------- naming a family or caste (an in-app sheet instead of the browser's prompt box) ----------
  // resolves with the name, or null if the sheet was closed; waits for the sheet's history entry to go first
  // t = 'family' / 'caste' checks for names already used; t = null for other names (device, sync list)
  function askName({ title, sub = '', label = 'Name', value = '', ok = 'Create', cancel = 'Cancel', t = 'family', except = '', sugg = [], hint = '', placeholder = '', optional = false, max = 40 }) {
    return new Promise(resolve => {
      const sh = $('#nameSheet'), inp = $('#nmInput');
      $('#nmTitle').textContent = title; $('#nmSub').innerHTML = sub; $('#nmSub').hidden = !sub;
      $('#nmLabel').textContent = label; $('#nmOk').textContent = ok;
      inp.maxLength = max; inp.value = value; inp.placeholder = placeholder || (t ? `e.g. ${GT[t].eg}` : '');
      $('#nmCancel').textContent = cancel;
      const taken = new Map(Object.keys(FAM).filter(gid => t && gid !== except && gType(gid) === t).map(gid => [famName(gid).toLowerCase(), gid]));
      const list = [...new Set(sugg.filter(x => x && (!taken.has(x.toLowerCase()) || x === value)))].slice(0, 6);   // names already used are left out
      $('#nmSugg').innerHTML = (list.length ? `<div class="nm-label">Suggestions</div><div class="chips wrap">${list.map(x => `<button type="button" class="chip" data-nm="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : '') +
        (hint ? `<p class="hint">${hint}</p>` : '');
      const check = () => {
        const v = inp.value.trim(), dup = v && taken.get(v.toLowerCase());
        $('#nmCount').textContent = `${inp.value.length}/${max}`;
        $('#nmWarn').hidden = !dup; if (dup) $('#nmWarn').textContent = `A ${GT[t].label.toLowerCase()} called “${famName(dup)}” already exists. Pick a different name so you can tell them apart.`;
        $('#nmOk').disabled = (!v && !optional) || !!dup || (except && v === famName(except));
        $('#nmSugg').querySelectorAll('[data-nm]').forEach(b => b.classList.toggle('on', b.dataset.nm === v));
      };
      inp.oninput = check;
      $('#nmSugg').onclick = e => { const b = e.target.closest('[data-nm]'); if (b) { inp.value = b.dataset.nm; check(); inp.focus(); } };
      let done = false;
      const finish = v => { if (done) return; done = true; resolve(v); };
      sh._onClose = () => finish(null);
      $('#nmCancel').onclick = () => closeTop();
      $('#nmForm').onsubmit = e => {
        e.preventDefault(); if ($('#nmOk').disabled) return;
        const v = inp.value.trim().slice(0, max);
        sh._onClose = null;
        const after = () => { removeEventListener('popstate', after); clearTimeout(tm); finish(v); };
        const tm = setTimeout(after, 500); addEventListener('popstate', after);
        closeTop();
      };
      check(); openSheet('#nameSheet');
      setTimeout(() => { inp.focus(); inp.select(); }, 120);
    });
  }
  // name ideas for a family made from these voters: their surname, then surname + the eldest member's name
  function famSuggestions(vs) {
    vs = vs.filter(Boolean); if (!vs.length) return [];
    const c = new Map(); vs.forEach(v => { const k = v.surname_en; if (k) c.set(k, (c.get(k) || 0) + 1); });
    const sns = [...c.keys()].sort((a, b) => c.get(b) - c.get(a)), old = eldestOf(vs);
    return sns.length ? [sns[0], `${sns[0]} (${firstName(old)})`, `${sns[0]} family`, ...sns.slice(1, 3)] : [`House ${old.house_no}`];
  }
  const pickFree = (list, t) => { const taken = new Set(Object.keys(FAM).filter(g => gType(g) === t).map(g => famName(g).toLowerCase())); return list.find(n => !taken.has(n.toLowerCase())) || ''; };
  async function bulkNew(t) {
    const ids = [...sel], vs = ids.map(id => byId.get(id)), sg = t === 'family' ? famSuggestions(vs) : [];
    const name = await askName({ title: `New ${GT[t].label.toLowerCase()}`, sub: `With the ${ids.length} selected voter${ids.length === 1 ? '' : 's'}`, t, sugg: sg, value: pickFree(sg, t) });
    if (!name) return;
    const gid = famNew(name, t);
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
  function famChanged() { saveFam(); rerenderKeep(); refreshDetailFam(); drawChips(); }
  function famNew(name, t) { const gid = rid(); FAM[gid] = { name, t, v: {}, s: {}, x: {} }; cloud.put('G', gid, name); cloud.put('T', gid, t); famChanged(); return gid; }
  // field: 'v' voter, 's' surname, 'x' taken out
  function gSet(gid, field, key, on) {
    const g = FAM[gid]; if (!g) return;
    if (on) g[field][key] = true; else delete g[field][key];
    cloud.put(field.toUpperCase(), gid + '|' + key, on || null);
  }
  // many at once: one redraw at the end
  // a voter belongs to one family: adding them to a family takes them out of any other family (castes are not affected)
  const familiesOf = (vid, except) => Object.keys(FAM).filter(o => o !== except && gType(o) === 'family' && inGroup(o, vid));
  function leaveOtherFamilies(gid, vid) {
    if (gType(gid) !== 'family') return [];
    const v = byId.get(vid);
    return familiesOf(vid, gid).map(o => { gSet(o, 'v', vid, false); if (v && v.surname && FAM[o].s[v.surname]) gSet(o, 'x', vid, true); return o; });
  }
  let lastMoved = 0;
  function gAddMany(gid, ids) {
    let n = 0; lastMoved = 0;
    ids.forEach(vid => { if (inGroup(gid, vid)) return; n++; if (leaveOtherFamilies(gid, vid).length) lastMoved++; gSet(gid, 'x', vid, false); const v = byId.get(vid); if (!(v && v.surname && FAM[gid].s[v.surname])) gSet(gid, 'v', vid, true); });
    famChanged(); return n;
  }
  function gRemoveMany(gid, ids) {
    ids.forEach(vid => { const v = byId.get(vid); gSet(gid, 'v', vid, false); if (v && v.surname && FAM[gid].s[v.surname]) gSet(gid, 'x', vid, true); });
    famChanged();
  }
  function gAddVoter(gid, vid) { const from = leaveOtherFamilies(gid, vid).map(famName); gSet(gid, 'x', vid, false); const v = byId.get(vid); if (!(v && v.surname && FAM[gid].s[v.surname])) gSet(gid, 'v', vid, true); famChanged(); return from; }
  // toast text for adding one voter: says where they moved from
  const addedMsg = (gid, from) => from.length ? `Moved from ${from.join(', ')} to ${famName(gid)}` : `Added to ${famName(gid)}`;
  function gRemoveVoter(gid, vid) {
    const v = byId.get(vid), g = FAM[gid];
    gSet(gid, 'v', vid, false);
    if (v && v.surname && g.s[v.surname]) gSet(gid, 'x', vid, true);  // came in through the surname: keep them out
    famChanged();
  }
  function gSurname(gid, sk, on) {
    gSurnameRaw(gid, sk, on);
    // a whole surname added to a family: people already in another family stay there
    if (on && gType(gid) === 'family') V.forEach(v => { if (v.surname === sk && familiesOf(v.id, gid).length) gSet(gid, 'x', v.id, true); });
    famChanged();
  }
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
    box.querySelector('#snNewC').onclick = async () => {
      const name = await askName({ title: 'New caste', sub: `Everyone with the surname <b>${esc(sn.en)}</b> (${sn.n}) will be in it.`, t: 'caste' }); if (!name) return;
      const gid = famNew(name, 'caste'), moved = setCaste(sk, gid); famChanged(); toast(moved.length ? `${sn.en} moved from ${moved.join(', ')} to ${famName(gid)}` : `${sn.en} → ${famName(gid)}`); showSurname(sk, true);
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
    box.querySelector('#bsNew').onclick = async () => {
      const name = await askName({ title: 'New caste', sub: `With the ${n} selected surname${n === 1 ? '' : 's'}`, t: 'caste' }); if (!name) return;
      const gid = famNew(name, 'caste'); ks.forEach(k => setCaste(k, gid)); famChanged();
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
  async function famCreate(t, firstVoter) {
    const v = firstVoter && byId.get(firstVoter);
    // a family for one voter: suggest names from them and the people in their house
    const sg = t === 'family' && v ? famSuggestions([v, ...(households.get(v.hkey) || []).filter(y => y.surname === v.surname)]) : [];
    const name = await askName({ title: `New ${GT[t].label.toLowerCase()}`, t, sugg: sg, value: pickFree(sg, t),
      sub: v ? `Starting with <b>${esc(v.name_en || v.name)}</b>` : '',
      hint: t === 'family' ? 'After creating it, add people from the suggestions or by selecting them in the list.' : 'After creating it, add surnames to it from the Surnames tab.' });
    if (!name) return null;
    const gid = famNew(name, t);
    if (v) gAddVoter(gid, v.id);
    showFam(gid);
    return gid;
  }

  // families made from houses: every house with 3 or more voters who are not in a family yet.
  // The id comes from the ward and house number, so two devices on one sync code make the same family, not two.
  function autoFamPlan() {
    const inFam = new Set();
    Object.keys(FAM).forEach(gid => { if (gType(gid) === 'family') gMembers(gid).forEach((_, id) => inFam.add(id)); });
    const used = new Set(), plan = [];
    [...households.entries()].filter(([k, vs]) => vs[0].house_no)
      .sort((a, b) => a[1][0].ward - b[1][0].ward || natural(a[1][0].house_no, b[1][0].house_no))
      .forEach(([k, vs]) => {
        const free = vs.filter(v => !inFam.has(v.id));
        if (free.length < 3) return;
        const base = 'h' + vs[0].ward + '-' + vs[0].house_no.replace(/[^A-Za-z0-9]/g, '_');
        let gid = base, i = 2; while (used.has(gid)) gid = base + '-' + i++;
        used.add(gid);
        if (!FAM[gid]) plan.push({ gid, vs: free });
      });
    return plan;
  }
  const eldestOf = vs => vs.reduce((a, b) => (+b.age || 0) > (+a.age || 0) ? b : a, vs[0]);  // no ages: the first in the roll
  function firstName(v) {
    const sn = (v.surname_en || '').toLowerCase(), w = (v.name_en || '').split(/\s+/).filter(x => x && x.toLowerCase() !== sn);
    return w.join(' ') || v.name_en || v.name;
  }
  function autoFamName(vs, taken) {
    const c = new Map(); vs.forEach(v => { const k = v.surname_en || v.surname; if (k) c.set(k, (c.get(k) || 0) + 1); });
    const old = eldestOf(vs), top = Math.max(0, ...c.values());
    const sn = top ? ((old.surname_en || old.surname) && c.get(old.surname_en || old.surname) === top ? (old.surname_en || old.surname) : [...c.keys()].find(k => c.get(k) === top)) : '';
    const tries = sn ? [sn, `${sn} (${firstName(old)})`, `${sn} (${firstName(old)}, ${old.house_no})`] : [`House ${old.house_no}`, `House ${old.house_no}, Ward ${old.ward}`];
    let name = tries.find(n => !taken.has(n.toLowerCase())) || tries[tries.length - 1], i = 2;
    while (taken.has(name.toLowerCase())) name = `${tries[tries.length - 1]} ${i++}`;
    name = name.slice(0, 40); taken.add(name.toLowerCase()); return name;
  }
  async function autoFamilies() {
    const plan = autoFamPlan();
    if (!plan.length) { toast('Every house with 3 or more voters already has a family'); return; }
    const n = plan.reduce((a, p) => a + p.vs.length, 0);
    if (!await askSure({ title: `Make ${plan.length} families?`, ok: `Make ${plan.length} families`,
      body: `<p>One family for each house with 3 or more voters who are not in a family yet: <b>${n.toLocaleString()} voters</b>.</p>
        <ul><li>Each is named after the house's surname.</li><li>If that name is already used, the eldest member's name is added, e.g. “Gotivada (Polamma)”.</li><li>You can rename, edit or delete any of them later.</li></ul>
        ${cloud.code ? '<p>Everyone using your sync code will see them.</p>' : ''}` })) return;
    const taken = new Set(Object.keys(FAM).filter(gid => gType(gid) === 'family').map(gid => famName(gid).toLowerCase()));
    cloud.many(() => plan.forEach(p => {
      const name = autoFamName(p.vs, taken);
      FAM[p.gid] = { name, t: 'family', v: {}, s: {}, x: {} }; cloud.put('G', p.gid, name); cloud.put('T', p.gid, 'family');
      p.vs.forEach(v => gSet(p.gid, 'v', v.id, true));
    }));
    famChanged(); toast(`${plan.length} families made from houses`);
  }

  // the Groups tab
  const isReviewed = gid => FAM[gid] && typeof FAM[gid].r === 'string';
  function setReviewed(gid, on) {
    const g = FAM[gid]; if (!g) return;
    if (on) g.r = cloud.myName || ''; else delete g.r;
    cloud.put('R', gid, on ? g.r : null); famChanged();
  }
  function famGroups(t, allReview) {
    return famGroupsAll(t).filter(g => allReview || t !== 'family' || S.frev === 'all' || (S.frev === 'done') === isReviewed(g.gid));
  }
  function famGroupsAll(t) {
    const filtering = S.q.trim() || S.ward || S.caste !== 'all' || S.age !== 'all' || S.phone !== 'all' || S.rel !== 'all' || S.surname || (S.cgrp && t !== 'caste') || (S.fgrp && t !== 'family') || S.marked;
    const ok = new Set(current.map(v => v.id));
    return Object.keys(FAM).filter(gid => gType(gid) === t).map(gid => {
      const all = [...gMembers(gid).keys()];
      const items = all.filter(id => ok.has(id)).map(id => byId.get(id)).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
      return { gid, name: famName(gid), t: gType(gid), items, total: all.length };
    }).filter(g => g.items.length || !filtering).sort(S.gsort === 'size' ? (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
  }
  function famHTML(g) {
    const show = g.items.slice(0, 5), more = g.items.length - show.length, sn = Object.keys(FAM[g.gid].s || {});
    return `<div class="house fam"><div class="house-h" data-gk="${g.gid}"><span>${GT[g.t].icon} ${esc(g.name)}${g.t === 'family' && isReviewed(g.gid) ? ' <em class="rev-tag">✓ Reviewed</em>' : ''}</span><small>${g.items.length.toLocaleString()} voter${g.items.length === 1 ? '' : 's'}</small>
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
  function showGroupInList(gid) { if (gType(gid) === 'caste') S.cgrp = gid; else { S.fgrp = 'sel'; S.fsel = [gid]; } S.view = 'list'; closeTop(open.length); update(); }

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

  // voters in two or more families (from before families were one per voter, or made on two devices at once)
  function multiFamily() {
    const c = new Map();
    Object.keys(FAM).forEach(gid => { if (gType(gid) === 'family') gMembers(gid).forEach((_, id) => c.set(id, (c.get(id) || 0) + 1)); });
    return [...c].filter(([, n]) => n > 1).map(([id]) => byId.get(id)).filter(Boolean).sort((a, b) => a.ward - b.ward || a.serial - b.serial);
  }
  function showDupFix(again) {
    const list = multiFamily();
    $('#famPick').innerHTML = `<h2>One family per voter</h2>
      <p class="fam-sub">${list.length ? `${list.length} voter${list.length === 1 ? ' is' : 's are'} in more than one family. Tap the family each one belongs to; they are taken out of the others.` : '🎉 Every voter is in one family at most.'}</p>
      ${list.length ? `<div class="house">${list.slice(0, 100).map(v => `<div class="dup-row"><button class="member" data-open="${v.id}">${photo(v)}<div class="m-body"><div class="nm-row"><div class="nm">${esc(v.name || '—')}</div>${wardPill(v)}</div>
        <div class="en">${esc(v.name_en)} · House ${esc(v.house_no || '—')}</div></div></button>
        <div class="fam-dd">${familiesOf(v.id).map(gid => `<button class="fam-chip add" data-keep="${gid}" data-vid="${v.id}">Keep in ${esc(famName(gid))}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    box.querySelector('#fpClose').onclick = () => closeTop();
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => showDetail(b.dataset.open));
    box.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => {
      const gid = b.dataset.keep, from = leaveOtherFamilies(gid, b.dataset.vid); famChanged();
      toast(`Kept in ${famName(gid)}, taken out of ${from.map(famName).join(', ')}`); showDupFix(true);
    });
    if (!again && !raise('#famPickSheet')) openSheet('#famPickSheet');
  }
  // the next family still to review, in the order the Families tab shows them
  function nextUnreviewed(gid) {
    const order = famGroupsAll('family').map(g => g.gid), i = order.indexOf(gid);
    return [...order.slice(i + 1), ...order.slice(0, Math.max(i, 0))].find(id => id !== gid && !isReviewed(id)) || '';
  }
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
      ${t === 'family' ? (isReviewed(gid)
        ? `<div class="rev-box done"><span>✓ Reviewed${g.r ? ' by ' + esc(g.r) : ''}</span><button class="btn" id="fUnrev">Undo</button>${nextUnreviewed(gid) ? '<button class="btn primary" id="fNext">Next ›</button>' : ''}</div>`
        : `<div class="rev-box"><span>Not reviewed yet. Check the members, add or remove people, then mark it.</span><button class="btn primary" id="fRev">✓ Mark reviewed</button></div>`) : ''}
      ${t === 'family' && mem.length ? `<button class="btn wa w100 wa-slip" id="fSlip">${WA_ICON}<span>Share ${mem.length === 1 ? 'voter slip' : `all ${mem.length} voter slips`} on WhatsApp</span></button>` : ''}
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
      ${sug.length ? `<div class="house">${sug.map(e => row(e.v, `<span class="why">${esc(e.why.join(' · '))}</span>${familiesOf(e.v.id, gid).length ? ` · <b>in ${esc(familiesOf(e.v.id, gid).map(famName).join(', '))}</b>` : ''}`,
        `<button class="fam-act add" data-add="${e.v.id}" aria-label="Add ${esc(e.v.name_en)}">＋</button>`)).join('')}</div>`
        : `<p class="hint">${mem.length ? 'No more suggestions.' : 'Add one voter first, and the app will suggest their relatives.'}</p>`}
      <p class="hint">Suggestions come from the same house and from the father / husband names in the roll, so check them before adding.</p>` : ''}
      <div class="sheet-actions"><button class="btn primary" id="fClose">Close</button></div>`;
    const box = $('#fam');
    box.querySelector('#fClose').onclick = () => closeTop();
    box.querySelector('#fShow').onclick = () => showGroupInList(gid);
    const on = (id, fn) => { const b = box.querySelector(id); if (b) b.onclick = fn; };
    on('#fSlip', () => showSlips(mem, famName(gid)));
    on('#fRev', () => { setReviewed(gid, true); showFam(gid, true); toast('Family marked reviewed'); });
    on('#fUnrev', () => { setReviewed(gid, false); showFam(gid, true); });
    on('#fNext', () => { const n = nextUnreviewed(gid); if (n) { showFam(n, true); $('#famSheet').scrollTop = 0; } });
    if (box.querySelector('#fShow2')) box.querySelector('#fShow2').onclick = () => showGroupInList(gid);
    box.querySelector('#fRename').onclick = async () => {
      const n = await askName({ title: `Rename ${GT[t].label.toLowerCase()}`, value: g.name, ok: 'Save', t, except: gid,
        sugg: t === 'family' ? famSuggestions([...gMembers(gid).keys()].map(id => byId.get(id))) : [] });
      if (!n || !FAM[gid]) return;
      g.name = n; cloud.put('G', gid, g.name); famChanged(); showFam(gid, true);
    };
    box.querySelector('#fDelete').onclick = async () => {
      const nm = gMembers(gid).size;
      if (!await askSure({ title: `Delete “${famName(gid)}”?`, ok: 'Delete', danger: true,
        body: `<p>This ${GT[t].label.toLowerCase()} and its list of ${nm} voter${nm === 1 ? '' : 's'} are removed${cloud.code ? ' for everyone using your sync code' : ''}. The voters themselves are not deleted.</p>` }) || !FAM[gid]) return;
      delete FAM[gid]; cloud.put('G', gid, null); if (S.cgrp === gid) S.cgrp = ''; S.fsel = S.fsel.filter(x => x !== gid); if (S.fgrp === 'sel' && !S.fsel.length) S.fgrp = ''; famChanged(); closeTop(); toast('Group deleted');
    };
    box.querySelector('#fAddSn').onclick = () => openSurnamePicker(gid);
    box.querySelectorAll('[data-sn-rm]').forEach(b => b.onclick = () => { gSurname(gid, b.dataset.snRm, false); showFam(gid, true); });
    box.querySelectorAll('[data-sn-add]').forEach(b => b.onclick = () => { gSurname(gid, b.dataset.snAdd, true); toast('Surname added'); showFam(gid, true); });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { gRemoveVoter(gid, b.dataset.rm); showFam(gid, true); });
    box.querySelectorAll('[data-readd]').forEach(b => b.onclick = () => { const from = gAddVoter(gid, b.dataset.readd); if (from.length) toast(addedMsg(gid, from)); showFam(gid, true); });
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { toast(addedMsg(gid, gAddVoter(gid, b.dataset.add))); showFam(gid, true); });
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => showDetail(b.dataset.open));
    if (!replace && !raise('#famSheet')) openSheet('#famSheet');
  }
  // "Add to group" from a voter's details
  function showFamPick(vid, again) {
    const v = byId.get(vid), sk = v.surname, sn = sk && SURNAMES.get(sk);
    if (!again) fpQ = '';
    const focused = again && document.activeElement && document.activeElement.classList.contains('fp-q');
    const list = Object.keys(FAM).sort((a, b) => gType(a).localeCompare(gType(b)) || famName(a).localeCompare(famName(b)));
    const curFam = familiesOf(vid);
    const rowP = gid => { const on = inGroup(gid, vid), mv = !on && gType(gid) === 'family' && curFam.length; return `<button class="opt ${on ? 'sel' : ''}" data-g="${gid}">
      <div class="o-main"><div class="o-te">${on ? '✓ ' : ''}${esc(gLabel(gid))}</div><div class="o-en">${GT[gType(gid)].label} · ${gMembers(gid).size} voters</div></div><span class="o-n">${on ? 'Remove' : mv ? 'Move here' : 'Add'}</span></button>`; };
    $('#famPick').innerHTML = `<h2>Add to group</h2><p class="fam-sub">${esc(v.name)} · ${esc(v.name_en)}</p>
      ${curFam.length ? `<p class="hint">A voter can be in one family only. Choosing another family moves them out of ${esc(curFam.map(famName).join(', '))}.</p>` : ''}
      <div class="d-actions"><button class="btn primary" id="fpNewF">＋ New family</button><button class="btn primary" id="fpNewC">＋ New caste</button></div>
      ${fpSearchHTML(list.length)}
      ${list.length ? `<h3>Add this person</h3><div class="picker-list fp-list">${list.map(rowP).join('')}</div>` : ''}
      ${list.length && sn ? `<h3>Add everyone named ${esc(sn.en)} (${sn.n})</h3><div class="fam-dd">${list.map(gid => FAM[gid].s[sk]
        ? `<button class="fam-chip" data-gs="${gid}">✓ ${esc(gLabel(gid))}</button>` : `<button class="fam-chip add" data-gs="${gid}">＋ ${esc(gLabel(gid))}</button>`).join('')}</div>
        <p class="hint">Adds the whole surname to the group, including people added to the roll later.</p>` : ''}
      <div class="sheet-actions"><button class="btn" id="fpClose">Done</button></div>`;
    const box = $('#famPick');
    wireFpSearch(box, focused);
    box.querySelector('#fpClose').onclick = () => closeTop();
    // the name sheet opens on top; the new group then opens over this list, and Back comes back to it
    box.querySelector('#fpNewF').onclick = () => famCreate('family', vid);
    box.querySelector('#fpNewC').onclick = () => famCreate('caste', vid);
    box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      const gid = b.dataset.g, on = !inGroup(gid, vid);
      if (on) toast(addedMsg(gid, gAddVoter(gid, vid))); else { gRemoveVoter(gid, vid); toast(`Removed from ${famName(gid)}`); }
      showFamPick(vid, true);
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
  // ---------- print: the whole list on screen (not just the cards loaded so far), or the selected voters ----------
  // photos are on by default; a choice saved before that (v < 2) only keeps its other settings
  const prSaved = LS.get('pv_print', {}); if (prSaved.v !== 2) delete prSaved.photos;
  const PR = Object.assign({ photos: true, phones: true, what: 'all', layout: 'slips' }, prSaved);
  const prArea = $('#printArea');
  const prVoterRows = (vs, o, start = 0) => vs.map((v, i) => {
    const st = statusOf(v.id), ph = o.phones ? phonesOf(v.id).map(fmtPhone).join(', ') : '';
    return `<tr${st ? ' class="gone"' : ''}><td class="n">${start + i + 1}</td><td class="n">${v.ward}</td><td class="n">${v.serial}</td>
      ${o.photos ? `<td>${v.photo ? `<img src="photos/${esc(v.photo)}" alt="">` : ''}</td>` : ''}
      <td class="nm">${esc(v.name || '—')}${marks.has(v.id) ? ' ★' : ''}<div class="en">${esc(v.name_en)}</div></td>
      <td>${esc(v.relation)}: ${esc(v.relation_name || '—')}<div class="en">${esc(v.relation_name_en || '')}</div></td>
      <td>${esc(v.house_no || '—')}</td><td class="n">${esc(v.age || '')}</td><td>${esc(casteLbl(v.caste))}</td><td>${esc(v.epic || '')}</td>
      ${o.phones ? `<td>${esc(ph)}</td>` : ''}<td>${st ? (st.k === 'dead' ? 'Dead' : 'Duplicate') : ''}</td></tr>`;
  }).join('');
  const prVoterHead = o => `<thead><tr><th>#</th><th>Ward</th><th>Sr.</th>${o.photos ? '<th>Photo</th>' : ''}<th>Name</th><th>Father / Husband</th><th>House</th><th>Age</th><th>Cat.</th><th>EPIC</th>${o.phones ? '<th>Phone</th>' : ''}<th>Status</th></tr></thead>`;
  // a box per voter, laid out like the ward PDF and the shared slip image
  const prSlip = (v, o, mixed) => {
    const st = statusOf(v.id), ph = o.phones ? phonesOf(v.id).map(fmtPhone).join(', ') : '';
    return `<div class="ps${st ? ' gone' : ''}">
      <div class="ps-top"><span>గ్రా.పం.ఓ.జా.వ.సం . <b class="ps-sn">${v.serial}</b>${mixed ? ` <b>వార్డు ${v.ward}</b>` : ''}${marks.has(v.id) ? ' ★' : ''}${st ? ` <b class="ps-st">${st.k === 'dead' ? '✝ Dead' : '⧉ Duplicate'}</b>` : ''}</span>
        <span>అ.ఓ.జా.వ.సం .<b class="ps-num">31 - ${esc(v.ac_part)} - ${esc(v.ac_serial)}</b></span></div>
      <div class="ps-mid"><div class="ps-info">
        <div class="ps-r"><span class="ps-l">ఓటరు పేరు</span><span class="ps-v">: <b class="ps-nm">${esc(v.name || v.name_en || '')}</b><i>${esc(v.name_en || '')}</i></span></div>
        <div class="ps-r"><span class="ps-l">${REL_TE[v.relation] || 'ఇతరులు'}</span><span class="ps-v">: ${esc(v.relation_name || v.relation_name_en || '')}</span></div>
        <div class="ps-r"><span class="ps-l">ఇంటి సంఖ్య</span><span class="ps-v">: <b class="ps-num">${esc(v.house_no || '--')}</b><span class="ps-cat">కులము : <b>${CASTE_TE[v.caste] || '--'}</b></span></span></div>
        <div class="ps-r ps-one">ఓటరు ఐడి. కార్డు నెం. : <b class="ps-num">${esc(v.epic || '--')}</b></div>
        ${v.age || ph ? `<div class="ps-r ps-one">${v.age ? `వయస్సు : <b class="ps-num">${esc(v.age)}</b>` : ''}${ph ? `<span class="ps-cat">📞 <b class="ps-num">${esc(ph)}</b></span>` : ''}</div>` : ''}
      </div>${o.photos ? `<div class="ps-ph">${v.photo ? `<img src="photos/${esc(v.photo)}" alt="">` : ''}</div>` : ''}</div></div>`;
  };
  const prHeadTe = wards => `<div class="ps-head"><div class="ps-t1">పెదగాడి గ్రామ పంచాయతీ ఓటర్ల జాబితా - 2026</div><div class="ps-t2">పెందుర్తి శాసనసభ నియోజకవర్గము</div>
    <div class="ps-hrow"><span>గ్రామ పంచాయతీ : <b>పెదగాడి</b></span><span>వార్డు నెంబరు : <b class="ps-num">${wards.join(', ')}</b></span></div>
    <div class="ps-hrow"><span>మండలము : <b>పెందుర్తి</b></span><span>జిల్లా : <b>విశాఖపట్నం</b></span></div></div>`;
  // what the print would cover, for the sheet's labels: { n, label }
  function prScope(what) {
    if (what === 'sel') return { n: sel.size, label: S.view === 'surnames' ? 'surnames' : 'voters' };
    if (S.view === 'surnames') return { n: groups.length, label: 'surnames' };
    if (isGroupView()) return { n: groups.length, label: GT[S.view].plural.toLowerCase() };
    if (S.view === 'house') return { n: groups.length, label: 'households' };
    return { n: current.length, label: 'voters' };
  }
  function buildPrint(o) {
    const what = o.what === 'sel' && sel.size ? 'sel' : 'all';
    const filt = [S.q.trim() && `Search: “${S.q.trim()}”`, S.surname && `Surname: ${(SURNAMES.get(S.surname) || {}).en || S.surname}`,
      S.caste !== 'all' && `Category: ${S.caste}`, S.phone !== 'all' && (S.phone === 'has' ? 'Has phone' : 'No phone'),
      S.age !== 'all' && ageLbl(S.age), S.vst !== 'all' && `Status: ${S.vst}`].filter(Boolean).join(' · ');
    const title = what === 'sel' ? `Selected ${S.view === 'surnames' ? 'surnames' : 'voters'} (${sel.size})` : $('#summary').textContent;
    let body;
    if (S.view === 'surnames') {
      const rows = what === 'sel' ? snRows(true).filter(r => sel.has(r.k)) : groups;
      body = `<table class="pr-t"><thead><tr><th>#</th><th>Surname</th><th>English</th><th>Voters</th><th>Wards</th><th>Caste</th></tr></thead><tbody>${rows.map((r, i) =>
        `<tr><td class="n">${i + 1}</td><td>${esc(r.te)}</td><td>${esc(r.en)}</td><td class="n">${r.n}</td><td>${Object.keys(r.w || {}).sort((a, b) => a - b).map(w => `W${w}: ${r.w[w]}`).join(', ')}</td><td>${esc(r.castes.map(famName).join(', '))}</td></tr>`).join('')}</tbody></table>`;
    } else if (what === 'sel' || !(isGroupView() || S.view === 'house')) {
      const vs = what === 'sel' ? [...sel].map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.ward - b.ward || a.serial - b.serial) : current;
      if (o.layout === 'slips') { const ws = [...new Set(vs.map(v => v.ward))].sort((a, b) => a - b); body = prHeadTe(ws) + `<div class="ps-grid">${vs.map(v => prSlip(v, o, ws.length > 1)).join('')}</div>`; }
      else body = `<table class="pr-t">${prVoterHead(o)}<tbody>${prVoterRows(vs, o)}</tbody></table>`;
    } else if (o.layout === 'slips') {
      const ws = [...new Set(groups.flatMap(g => g.items.map(v => v.ward)))].sort((a, b) => a - b);
      body = prHeadTe(ws) + groups.map(g => {
        const head = S.view === 'house' ? (([w, h]) => `Ward ${w} · House ${esc(h)}`)(g.key.split('|')) : `${esc(g.name)}`;
        return `<div class="ps-g"><div class="ps-gh">${head} — ${g.items.length} voter${g.items.length === 1 ? '' : 's'}</div><div class="ps-grid">${g.items.map(v => prSlip(v, o, ws.length > 1)).join('')}</div></div>`;
      }).join('');
    } else {
      const cols = 10 + (o.photos ? 1 : 0) + (o.phones ? 1 : 0); let k = 0;
      body = `<table class="pr-t">${prVoterHead(o)}<tbody>${groups.map(g => {
        const head = S.view === 'house' ? (([w, h]) => `Ward ${w} · House ${esc(h)}`)(g.key.split('|')) : `${esc(g.name)}`;
        const rows = prVoterRows(g.items, o, k); k += g.items.length;
        return `<tr class="pr-g"><td colspan="${cols}">${head} — ${g.items.length} voter${g.items.length === 1 ? '' : 's'}</td></tr>${rows}`;
      }).join('')}</tbody></table>`;
    }
    prArea.innerHTML = `<h1 class="pr-h">Pedagadi Voters 2026 · ${esc(title)}</h1>
      <p class="pr-meta">${filt ? esc(filt) + ' · ' : ''}Printed ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>${body}`;
  }
  // wait for photos so they are not blank on paper
  const prImgs = () => Promise.all([...prArea.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 8000); })));
  function drawPrintSheet() {
    const hasSel = sel.size > 0, isSn = S.view === 'surnames';
    if (!hasSel) PR.what = 'all';
    const a = prScope('all'), s = prScope('sel');
    $('#prWhatBox').hidden = !hasSel;
    chips($('#prWhat'), [['all', `All shown (${a.n.toLocaleString()})`], ['sel', `Selected (${s.n.toLocaleString()})`]], PR.what, v => { PR.what = v; drawPrintSheet(); });
    $('#prOptBox').hidden = $('#prLayBox').hidden = isSn;
    chips($('#prLay'), [['slips', '🪪 Slips (like the roll)'], ['table', '☰ Table rows']], PR.layout, v => { PR.layout = v; drawPrintSheet(); });
    $('#prOpts').innerHTML = [['photos', '🖼 Photos'], ['phones', '📞 Phone numbers']].map(([k, l]) => `<button class="chip ${PR[k] ? 'on' : ''}" data-k="${k}" aria-pressed="${!!PR[k]}">${PR[k] ? '✓ ' : ''}${l}</button>`).join('');
    const c = prScope(PR.what);
    $('#prSub').textContent = `${c.n.toLocaleString()} ${c.label}${S.ward ? ' · Ward ' + S.ward : ''}`;
    $('#prGo').disabled = !c.n;
  }
  $('#prOpts').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; PR[b.dataset.k] = !PR[b.dataset.k]; drawPrintSheet(); };
  $('#printBtn').onclick = () => { if (!selecting) sel.clear(); PR.what = sel.size ? 'sel' : 'all'; drawPrintSheet(); openSheet('#printSheet'); };
  $('#prCancel').onclick = () => closeTop();
  $('#prGo').onclick = async () => {
    LS.set('pv_print', { v: 2, photos: PR.photos, phones: PR.phones, layout: PR.layout });
    buildPrint(PR); closeTop();
    if (PR.photos && S.view !== 'surnames') { toast('Getting photos ready…'); await prImgs(); }
    setTimeout(() => { prArea._ours = true; window.print(); }, 300);   // let the sheet close first
  };
  // the browser's own Print (Ctrl+P) also gets the full list, not just the cards loaded so far
  window.addEventListener('beforeprint', () => { if (!prArea._ours) buildPrint({ photos: false, phones: PR.phones, what: 'all', layout: 'table' }); });
  window.addEventListener('afterprint', () => { prArea._ours = false; prArea.innerHTML = ''; });

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
      if (type === 'G' && val === null) Object.keys(this.q).forEach(k => { if (/^[TRVSX]:/.test(k) && k.slice(2).split('|')[0] === id) delete this.q[k]; });
      this.q[type + ':' + id] = val; if (!this.hold) LS.set('pv_sync_q', this.q);
      if (type === 'm' || type === 'n') {
        if (val === null) delete this.who[type + ':' + id]; else this.who[type + ':' + id] = { by: this.myName, d: this.dev, t: Date.now() };
        LS.set('pv_who', this.who);
      }
      clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), type === 'n' ? 1200 : 300);
      drawSyncDot();
    },
    // many changes at once: save the queue once at the end
    many(fn) { this.hold = true; try { fn(); } finally { this.hold = false; if (this.code) { LS.set('pv_sync_q', this.q); clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 300); drawSyncDot(); } } },
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
          if ('GTRVSX'.includes(t)) {
            const [gid, key] = id.split('|'), gf = body.fields.g.mapValue.fields;
            if (t === 'G' && val === null) return [path(['g', gid])];
            const grp = gf[gid] || (gf[gid] = { mapValue: { fields: { v: F(), s: F(), x: F() } } });
            if (t === 'R') { if (val !== null) grp.mapValue.fields.r = { stringValue: String(val) }; return [path(['g', gid, 'r'])]; }
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
        if (gf.r && typeof gf.r.stringValue === 'string') g[gid].r = gf.r.stringValue;
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
        const t = k[0]; if (!'GTRVSX'.includes(t)) return;
        const [gid, key] = k.slice(2).split('|');
        if (t === 'G' && val === null) { delete g[gid]; return; }
        const grp = g[gid] = g[gid] || { name: '', t: 'family', v: {}, s: {}, x: {} };
        if (t === 'G') grp.name = val; else if (t === 'T') grp.t = val;
        else if (t === 'R') { if (val === null) delete grp.r; else grp.r = val; }
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
  async function askDevName(force) {
    if (cloud.devName && !force) return;
    const v = await askName({ title: 'Name this device', t: null, label: 'Device name', value: cloud.devName, max: 30, ok: 'Save', cancel: force ? 'Cancel' : 'Skip',
      sub: 'Others using the same sync code see this name next to the voters you mark, and in the list of devices online.', placeholder: 'e.g. Ravi’s phone',
      optional: false });
    if (v) cloud.setDevName(v);
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
      if (!await askSure({ title: `Open ${cloud.nameOf(c) || c}?`, ok: 'Open',
        body: `<p>Marks, notes and phone numbers on this device will be replaced by the ones saved under <b>${esc(c)}</b>.</p>` })) return;
      b.disabled = true;
      if (await cloud.switchTo(c)) toast(`Switched to ${cloud.nameOf(c) || c} · ${marks.size} marked`);
      drawSync();
    });
    const rename = async c => {
      const v = await askName({ title: cloud.nameOf(c) ? 'Rename this list' : 'Name this list', t: null, label: 'List name', value: cloud.nameOf(c), ok: 'Save', optional: true,
        sub: `Sync code <b>${esc(c)}</b>. Everyone using it sees this name. Leave it empty to remove the name.`, placeholder: 'e.g. Family, Ward 3 team' });
      if (v !== null && v !== cloud.nameOf(c) && await cloud.rename(c, v)) toast(v ? 'Name saved' : 'Name removed');
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
        await askDevName();
        await cloud.join(c);
        // claim the new code for this device, so only it can name the list
        const v = await askName({ title: 'Sync is on', t: null, label: 'Name this list (optional)', ok: 'Save', cancel: 'Skip', optional: true,
          sub: `Your sync code is <b>${esc(c)}</b>. A name helps you tell your lists apart. Only this device can change it.`, placeholder: 'e.g. Family, Ward 3 team',
          sugg: ['Family', 'Ward 1 team', 'Office'] });
        await cloud.rename(c, v || '');
        cloud.remember(c);
        toast(cloud.err ? 'Saved here, will sync when online' : 'Sync is on');
        drawSync();
      };
      $('#syJoin').onclick = async () => {
        const c = cleanCode($('#syCode').value);
        if (!validCode(c)) { toast('Code looks like PDG-XXXX-XXXX'); return; }
        await askDevName();
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
    $('#syDev').onclick = () => askDevName(true).then(() => { drawSync(); cloud.sync(); });
    $('#syCopy').onclick = async () => { try { await navigator.clipboard.writeText(cloud.code); toast('Code copied'); } catch { toast(cloud.code); } };
    $('#syShare').onclick = async () => {
      const text = `Pedagadi Voters sync code: ${cloud.code}\nOpen this link to sync marks:`;
      if (navigator.share) { try { await navigator.share({ title: 'Sync code', text, url: syncLink() }); } catch { } }
      else { try { await navigator.clipboard.writeText(text + ' ' + syncLink()); toast('Copied'); } catch { } }
    };
    $('#syOff').onclick = async () => {
      if (!await askSure({ title: 'Stop syncing on this device?', ok: 'Stop syncing', danger: true,
        body: '<p>Your marks, notes and numbers stay on this device and in the cloud. Changes made here will no longer reach other devices. You can join the code again later.</p>' })) return;
      cloud.leave(); drawSync(); toast('Sync turned off');
    };
  }
  $('#syncBtn').onclick = () => { drawSync(); openSheet('#syncSheet'); if (cloud.code) cloud.sync(); };
  $('#syClose').onclick = () => closeTop();
  // a shared link like …/#sync=PDG-XXXX-XXXX joins that list
  const hashCode = cleanCode((location.hash.match(/sync=([^&]+)/) || [])[1]);
  if (hashCode) {
    history.replaceState(null, '', location.pathname + location.search);
    if (hashCode !== cloud.code && cloud.ready && validCode(hashCode))
      askSure({ title: 'Join this sync code?', ok: 'Join', cancel: 'Not now',
        body: `<p>Sync marks, notes and phone numbers with <b>${esc(hashCode)}</b>.${cloud.code ? ` This replaces your current code <b>${esc(cloud.code)}</b>.` : ''}</p>` })
        .then(ok => ok && askDevName().then(() => cloud.join(hashCode)).then(() => toast(cloud.err ? 'Will sync when online' : 'Joined. Marks synced')));
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
  // a profile link like …/#v=1-3 (saved in a phone contact) opens that voter
  const openFromHash = () => {
    const m = location.hash.match(/(?:^#|&)v=([^&]+)/); if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const id = decodeURIComponent(m[1]);
    if (byId.has(id)) showDetail(id); else toast('Voter not found');
  };
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
  // new versions: check whenever the app comes back to the screen; when one is installed, reload
  // straight away if nothing is open, otherwise offer an "Update" button
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const check = () => reg.update().catch(() => { });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadSW) return;
      if (!open.length && !selecting && !(voice && voice.rec)) { location.reload(); return; }
      const b = $('#updBar'); b.hidden = false; b.onclick = () => location.reload();
    });
  }
})();
