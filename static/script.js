/* ============================================================
   KSP Crime Intelligence System — script.js
   All API calls, dynamic UI, chat, FIR upload, cases, dashboard
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let currentOfficer  = null;
let currentTab      = 'chat';
let extractedProfile = null;   // holds dry_run FIR extraction result
let chartsInitialised = false;
let chartInstances  = {};      // keyed by canvas id

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Toasts ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => el.remove(), 400); }, duration);
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body = null, isFormData = false) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body && !isFormData) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body; // FormData — browser sets multipart headers automatically
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

// ── Tab navigation ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.tab-panel').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));

  if (tab === 'cases')     loadCases();
  if (tab === 'profile')   loadProfile();
  if (tab === 'dashboard') loadDashboard();
}

$$('.nav-item').forEach(el => {
  el.addEventListener('click', () => switchTab(el.dataset.tab));
});

// ── Login ─────────────────────────────────────────────────────────────────────
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const badge    = $('badge-input').value.trim();
  const password = $('password-input').value;
  const btn      = $('login-btn');
  const btnText  = $('login-btn-text');
  const errEl    = $('login-error');

  if (!badge || !password) { errEl.textContent = 'Enter badge number and password.'; return; }

  btn.disabled  = true;
  btnText.innerHTML = '<span class="spinner"></span>';
  errEl.textContent = '';

  try {
    const data = await api('POST', '/api/login', { badge_number: badge, password });
    currentOfficer = data.officer;
    showApp();
    toast(`Welcome, ${currentOfficer.name}!`, 'success');
  } catch (err) {
    errEl.textContent = err.error || 'Login failed. Check your credentials.';
  } finally {
    btn.disabled  = false;
    btnText.textContent = 'Login to System';
  }
});

function showApp() {
  $('login-overlay').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('sidebar-name').textContent  = currentOfficer.name;
  $('sidebar-badge').textContent = currentOfficer.badge_number;
}

function showLogin() {
  $('app').classList.add('hidden');
  $('login-overlay').classList.remove('hidden');
  $('badge-input').value    = '';
  $('password-input').value = '';
  $('login-error').textContent = '';
}

$('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  currentOfficer = null;
  chartsInitialised = false;
  showLogin();
  toast('Logged out.', 'info');
});

// ── Check session on load ─────────────────────────────────────────────────────
(async () => {
  try {
    const data = await api('GET', '/api/officers/me');
    currentOfficer = data;
    showApp();
  } catch (_) {
    /* Not logged in — show login screen (already visible by default) */
  }
})();

// ── ═══════════════════════════ CHAT ═════════════════════════════════════════ //

const chatMessages = $('chat-messages');

// Sample queries click
$$('.sample-q').forEach(el => {
  el.addEventListener('click', () => {
    $('chat-input').value = el.dataset.q;
    sendChat();
  });
});

$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendChat(); });

function appendMsg(role, content, extras = {}) {
  const welcome = $('chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? '👮' : '🤖';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content;
  body.appendChild(bubble);

  // SQL & rows toggles for AI messages
  if (role === 'ai' && extras.sql_used) {
    const toggleRow = document.createElement('div');
    toggleRow.style.display = 'flex';
    toggleRow.style.gap = '6px';
    toggleRow.style.flexWrap = 'wrap';

    const sqlToggle = document.createElement('span');
    sqlToggle.className = 'sql-toggle';
    sqlToggle.innerHTML = '🔍 SQL used';

    const sqlBlock = document.createElement('pre');
    sqlBlock.className = 'sql-block';
    sqlBlock.textContent = extras.sql_used;
    sqlToggle.addEventListener('click', () => sqlBlock.classList.toggle('visible'));

    toggleRow.appendChild(sqlToggle);

    if (extras.matched_rows && extras.matched_rows.length) {
      const rowToggle = document.createElement('span');
      rowToggle.className = 'sql-toggle';
      rowToggle.innerHTML = `📋 ${extras.matched_rows.length} row(s)`;

      const rowBlock = document.createElement('pre');
      rowBlock.className = 'rows-block';
      rowBlock.textContent = JSON.stringify(extras.matched_rows, null, 2);
      rowToggle.addEventListener('click', () => rowBlock.classList.toggle('visible'));

      toggleRow.appendChild(rowToggle);
      body.appendChild(toggleRow);
      body.appendChild(sqlBlock);
      body.appendChild(rowBlock);
    } else {
      body.appendChild(toggleRow);
      body.appendChild(sqlBlock);
    }
  }

  if (role === 'user') { div.appendChild(body); div.appendChild(avatar); }
  else                  { div.appendChild(avatar); div.appendChild(body); }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'chat-typing msg ai';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
    <span style="font-size:0.78rem;color:var(--text-muted)">Thinking…</span>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
  const el = $('typing-indicator');
  if (el) el.remove();
}

async function sendChat() {
  const input = $('chat-input');
  const sendBtn = $('chat-send');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  sendBtn.disabled = true;

  appendMsg('user', question);
  showTyping();

  try {
    const data = await api('POST', '/api/chat', { question });
    removeTyping();
    appendMsg('ai', data.answer, { sql_used: data.sql_used, matched_rows: data.matched_rows });
  } catch (err) {
    removeTyping();
    appendMsg('ai', `⚠️ ${err.error || 'Something went wrong. Is the Gemini API key configured?'}`);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ── ═══════════════════════ FIR UPLOAD ═══════════════════════════════════════ //

// Drag-and-drop
const dropZone = $('drop-zone');
['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

$('choose-file-btn').addEventListener('click', () => $('fir-file-input').click());
$('fir-file-input').addEventListener('change', e => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
  $('file-name-display').textContent = `📎 ${file.name}`;
  $('fir-file-input')._selectedFile = file;
}

// Extract from text paste (PRIMARY)
$('extract-text-btn').addEventListener('click', () => {
  const text = $('fir-text-input').value.trim();
  if (!text) { toast('Please paste some FIR text first.', 'error'); return; }
  extractFIR(null, text);
});

// Extract from file (bonus OCR path)
$('extract-file-btn').addEventListener('click', () => {
  const file = $('fir-file-input')._selectedFile || ($('fir-file-input').files[0]);
  if (!file) { toast('Please choose a file first.', 'error'); return; }
  extractFIR(file, null);
});

async function extractFIR(file, rawText) {
  const btn1 = $('extract-text-btn');
  const btn2 = $('extract-file-btn');
  btn1.disabled = btn2.disabled = true;
  btn1.innerHTML = '<span class="spinner"></span> Extracting…';

  try {
    let data;
    if (rawText) {
      const form = new FormData();
      form.append('raw_text', rawText);
      data = await api('POST', '/api/upload-fir', form, true);
    } else {
      const form = new FormData();
      form.append('file', file);
      data = await api('POST', '/api/upload-fir', form, true);
    }

    extractedProfile = data.profile;
    populateReviewForm(data.profile, data.extraction_notes);
    $('profile-review').classList.remove('hidden');
    $('profile-review').scrollIntoView({ behavior: 'smooth' });
    toast('Profile extracted. Review and confirm to save.', 'success');

  } catch (err) {
    const msg = err.error || 'Extraction failed.';
    toast(msg, 'error', 6000);
    if (err.fallback_hint) toast(`Tip: ${err.fallback_hint}`, 'info', 5000);
  } finally {
    btn1.disabled = btn2.disabled = false;
    btn1.textContent = '🧠 Extract Profile with AI';
  }
}

function populateReviewForm(profile, notes) {
  const c = profile.accused || profile.criminal || {};
  const cas = profile.case || {};

  $('rev-name').value          = c.AccusedName || c.name || '';
  $('rev-aliases').value       = c.aliases || '';
  $('rev-description').value   = c.description || '';
  $('rev-location').value      = c.last_known_location || '';
  setSelectValue('rev-crime-type', (cas.CrimeHeadName || c.crime_type || '').toLowerCase());
  setSelectValue('rev-status',     c.status || 'wanted');

  $('rev-case-number').value      = cas.CaseNo || cas.case_number || '';
  $('rev-case-date').value        = cas.IncidentFromDate || cas.date || '';
  $('rev-case-location').value    = cas.location || '';
  $('rev-case-description').value = cas.BriefFacts || cas.description || '';

  const notesEl = $('extraction-notes');
  const noteText = profile.extraction_notes || notes;
  if (noteText) {
    notesEl.textContent = `⚠️ Extraction notes: ${noteText}`;
    notesEl.classList.remove('hidden');
  } else {
    notesEl.classList.add('hidden');
  }
}

function setSelectValue(id, value) {
  const sel = $(id);
  if (!value) return;
  const valLower = value.toLowerCase();
  for (let opt of sel.options) {
    if (opt.value.toLowerCase() === valLower) { sel.value = opt.value; return; }
  }
}

$('confirm-save-btn').addEventListener('click', async () => {
  if (!extractedProfile) return;

  const profile = {
    accused: {
      AccusedName:         $('rev-name').value.trim(),
      aliases:             $('rev-aliases').value.trim() || null,
      description:         $('rev-description').value.trim(),
      last_known_location: $('rev-location').value.trim(),
      status:              $('rev-status').value,
    },
    case: {
      CaseNo:          $('rev-case-number').value.trim() || null,
      CrimeHeadName:   $('rev-crime-type').value,
      location:        $('rev-case-location').value.trim(),
      IncidentFromDate:$('rev-case-date').value || null,
      BriefFacts:      $('rev-case-description').value.trim(),
    },
    victim: extractedProfile.victim || {},
    complainant: extractedProfile.complainant || {}
  };

  const btn = $('confirm-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const res = await api('POST', '/api/upload-fir/confirm', { profile });
    toast(`✓ Saved — Accused #${res.accused_id}, Case #${res.case_master_id}`, 'success', 5000);
    $('profile-review').classList.add('hidden');
    $('fir-text-input').value = '';
    $('file-name-display').textContent = '';
    extractedProfile = null;
  } catch (err) {
    toast(err.error || 'Save failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Confirm & Save Profile';
  }
});

$('discard-btn').addEventListener('click', () => {
  $('profile-review').classList.add('hidden');
  extractedProfile = null;
  toast('Profile discarded.', 'info');
});

// ── ═══════════════════════ CASES ════════════════════════════════════════════ //

let selectedCaseId = null;

async function loadCases() {
  const list   = $('cases-list');
  const status = $('filter-status').value;
  const crime  = $('filter-crime').value;

  list.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Loading…</div>';
  $('case-detail').classList.remove('visible');

  try {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (crime)  params.append('crime_type', crime);
    const data  = await api('GET', `/api/cases?${params}`);

    if (!data.cases.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div><p>No cases found.</p></div>';
      return;
    }

    list.innerHTML = '';
    data.cases.forEach(c => list.appendChild(buildCaseRow(c)));
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.error || 'Failed to load cases.'}</p></div>`;
  }
}

function buildCaseRow(c) {
  const div = document.createElement('div');
  div.className = 'case-row';
  div.dataset.id = c.id;

  const badge  = c.status === 'solved'
    ? `<span class="badge badge-solved">✓ Solved</span>`
    : `<span class="badge badge-open">● Open</span>`;

  const crimeBadge = `<span class="crime-type-badge">${fmt(c.crime_type)}</span>`;

  div.innerHTML = `
    <div>
      <div class="case-number">${c.case_number || `#${c.id}`}</div>
      ${crimeBadge}
    </div>
    <div class="case-info">
      <div class="case-title">${c.criminal_name ? `${c.criminal_name} — ` : ''}${c.location || 'Unknown location'}</div>
      <div class="case-meta">📅 ${c.date || 'Date unknown'}</div>
    </div>
    ${badge}
    <span class="case-chevron">›</span>
  `;

  div.addEventListener('click', () => openCase(c.id, div));
  return div;
}

async function openCase(caseId, rowEl) {
  // Deselect previous
  $$('.case-row.selected').forEach(el => el.classList.remove('selected'));
  if (rowEl) rowEl.classList.add('selected');
  selectedCaseId = caseId;

  const detailEl      = $('case-detail');
  const detailContent = $('case-detail-content');
  const similarEl     = $('similar-cases-content');
  const stepsEl       = $('next-steps-content');
  const solversEl     = $('solvers-content');

  detailEl.classList.add('visible');
  detailContent.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';
  similarEl.innerHTML  = '<div class="loading-placeholder"><span class="spinner"></span> Analyzing similar cases…</div>';
  stepsEl.innerHTML    = '<div class="loading-placeholder"><span class="spinner"></span> Generating AI suggestions…</div>';
  solversEl.innerHTML  = '<div class="loading-placeholder"><span class="spinner"></span></div>';

  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Load all four sections in parallel
  const [caseData, similarData, stepsData, solversData] = await Promise.allSettled([
    api('GET', `/api/cases/${caseId}`),
    api('GET', `/api/similar-cases/${caseId}`),
    api('GET', `/api/suggest-next-steps/${caseId}`),
    api('GET', `/api/similar-solvers/${caseId}`),
  ]);

  // Case detail
  if (caseData.status === 'fulfilled') {
    renderCaseDetail(detailContent, caseData.value);
  } else {
    detailContent.innerHTML = `<p class="empty-state">⚠️ ${caseData.reason?.error || 'Failed to load'}</p>`;
  }

  // Similar cases
  if (similarData.status === 'fulfilled') {
    renderSimilarCases(similarEl, similarData.value.similar_cases);
  } else {
    similarEl.innerHTML = '<div class="empty-state"><p>Could not compute similar cases.</p></div>';
  }

  // Next steps
  if (stepsData.status === 'fulfilled') {
    const steps = stepsData.value;
    stepsEl.innerHTML = '';
    const pre = document.createElement('div');
    pre.className = 'next-steps-content';
    pre.textContent = steps.suggestions;
    stepsEl.appendChild(pre);
    if (steps.based_on_cases?.length) {
      const note = document.createElement('p');
      note.style.cssText = 'font-size:0.72rem;color:var(--text-muted);margin-top:8px';
      note.textContent = `Based on resolved cases: #${steps.based_on_cases.join(', #')}`;
      stepsEl.appendChild(note);
    }
  } else {
    stepsEl.innerHTML = '<div class="empty-state"><p>Could not generate suggestions.</p></div>';
  }

  // Solvers (Phase 2)
  if (solversData.status === 'fulfilled') {
    renderSolvers(solversEl, solversData.value.officers, caseId);
  } else {
    solversEl.innerHTML = '<div class="empty-state"><p>No expert officers found.</p></div>';
  }
}

function renderCaseDetail(el, c) {
  const badge    = c.status === 'solved' ? `<span class="badge badge-solved">✓ Solved</span>` : `<span class="badge badge-open">● Open</span>`;
  const confFlag = c.confidence_flag === 'ai_extracted' ? `<span class="badge badge-ai">🤖 AI Extracted</span>` : `<span class="badge badge-verified">✓ Verified</span>`;

  let officersHtml = '';
  if (c.officers?.length) {
    officersHtml = c.officers.map(o => `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:var(--bg-card);border:1px solid var(--glass-border);border-radius:20px;font-size:0.74rem;margin:3px">
        👮 ${o.name} <span style="color:var(--text-muted)">(${o.role})</span>
      </span>`).join('');
  } else {
    officersHtml = '<span style="color:var(--text-muted);font-size:0.8rem">No officers assigned</span>';
  }

  el.innerHTML = `
    <div class="detail-header">
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:var(--blue-bright);font-weight:600">${c.case_number || `Case #${c.id}`}</div>
        <div class="badges" style="margin-top:6px">
          ${badge}
          <span class="crime-type-badge">${fmt(c.crime_type)}</span>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="detail-section">
        <div class="detail-label">📍 Location</div>
        <div class="detail-value">${c.location || '—'}</div>
      </div>
      <div class="detail-section">
        <div class="detail-label">📅 Date</div>
        <div class="detail-value">${c.date || '—'}</div>
      </div>
      ${c.criminal_name ? `
      <div class="detail-section">
        <div class="detail-label">🧑 Linked Criminal</div>
        <div class="detail-value">${c.criminal_name} <span class="badge badge-${c.criminal_status}">${c.criminal_status || ''}</span></div>
      </div>` : ''}
    </div>

    <div class="detail-section" style="margin-bottom:12px">
      <div class="detail-label">📝 Description</div>
      <div class="detail-value" style="line-height:1.6">${c.description || '—'}</div>
    </div>

    ${c.resolution_notes ? `
    <div class="detail-section" style="margin-bottom:12px;padding:12px;background:var(--green-dim);border:1px solid rgba(0,230,118,0.2);border-radius:8px">
      <div class="detail-label" style="color:var(--green)">✓ Resolution Notes</div>
      <div class="detail-value" style="font-size:0.84rem">${c.resolution_notes}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">👮 Assigned Officers</div>
      <div style="margin-top:6px">${officersHtml}</div>
    </div>

    <div class="divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="markSolved(${c.id})" ${c.status === 'solved' ? 'disabled' : ''}>✓ Mark Solved</button>
    </div>
  `;
}

function renderSimilarCases(el, cases) {
  if (!cases?.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No similar cases found in the database.</p></div>';
    return;
  }
  el.innerHTML = '';
  cases.forEach(c => {
    const score = c.match_score;
    const color = score >= 0.6 ? 'var(--red)' : score >= 0.4 ? 'var(--orange)' : 'var(--text-secondary)';
    const statusBadge = c.status === 'solved'
      ? `<span class="badge badge-solved" style="font-size:0.62rem">Solved</span>`
      : `<span class="badge badge-open" style="font-size:0.62rem">Open</span>`;

    const card = document.createElement('div');
    card.className = 'similar-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div class="match-score-ring" style="border-color:${color};color:${color}">
        ${Math.round(score * 100)}%
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.74rem;color:var(--blue-bright)">${c.case_number || `#${c.case_id}`}</span>
          ${statusBadge}
          <span class="crime-type-badge">${fmt(c.crime_type)}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary)">📍 ${c.location || '—'} &bull; 📅 ${c.date || '—'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">🔗 ${c.why}</div>
      </div>
      <button class="btn-secondary" style="font-size:0.72rem;padding:5px 10px" onclick="openCase(${c.case_id})">View →</button>
    `;
    el.appendChild(card);
  });
}

function renderSolvers(el, officers, caseId) {
  if (!officers?.length) {
    el.innerHTML = '<div class="empty-state"><p>No other officers have solved similar cases yet.</p></div>';
    return;
  }
  el.innerHTML = '';
  officers.forEach(o => {
    const card = document.createElement('div');
    card.className = 'solver-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div class="solver-avatar">👮</div>
      <div class="solver-info">
        <div class="solver-name">${o.name}</div>
        <div class="solver-meta">${o.badge_number} &bull; ${o.station} &bull; ${o.cases_solved_count} solved</div>
      </div>
      <button class="btn-help" onclick="requestHelp(${o.id}, ${caseId})">🤝 Request Help</button>
    `;
    el.appendChild(card);
  });
}

async function requestHelp(officerId, caseId) {
  try {
    await api('POST', '/api/request-help', { officer_id: officerId, case_id: caseId, message: 'Requesting assistance on similar case' });
    toast('Help request sent! Officer will be notified.', 'success');
  } catch (err) {
    toast(err.error || 'Request failed.', 'error');
  }
}

async function markSolved(caseId) {
  const notes = prompt('Enter resolution notes (optional):') ?? '';
  try {
    await api('PUT', `/api/cases/${caseId}`, { status: 'solved', resolution_notes: notes });
    toast('Case marked as solved!', 'success');
    loadCases();
  } catch (err) {
    toast(err.error || 'Update failed.', 'error');
  }
}

$('filter-status').addEventListener('change', loadCases);
$('filter-crime').addEventListener('change', loadCases);
$('refresh-cases-btn').addEventListener('click', loadCases);

// ── ═══════════════════════ PROFILE ══════════════════════════════════════════ //

async function loadProfile() {
  const body = $('profile-body');
  body.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Loading…</div>';

  try {
    const data = await api('GET', '/api/officers/me');
    const cases = data.cases || [];
    const solved = cases.filter(c => c.status === 'solved').length;
    const open   = cases.filter(c => c.status === 'open').length;

    body.innerHTML = `
      <div class="profile-header-card">
        <div class="profile-avatar">👮</div>
        <div class="profile-info">
          <div class="profile-name">${data.name}</div>
          <div class="profile-badge">Badge: ${data.badge_number}</div>
          <div class="profile-station">📍 ${data.station || 'Unassigned'}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num">${data.cases_solved_count || solved}</div>
          <div class="stat-label">Cases Solved</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${open}</div>
          <div class="stat-label">Open Cases</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${cases.length}</div>
          <div class="stat-label">Total Assigned</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📁 Assigned Cases</div>
        ${cases.length ? cases.map(c => `
          <div class="case-row" style="cursor:pointer" onclick="switchTab('cases')">
            <div>
              <div class="case-number">${c.case_number || `#${c.id}`}</div>
              <span class="crime-type-badge">${fmt(c.crime_type)}</span>
            </div>
            <div class="case-info">
              <div class="case-title">${c.location || '—'}</div>
              <div class="case-meta">📅 ${c.date || '—'} &bull; Role: <b>${c.role}</b></div>
            </div>
            ${c.status === 'solved' ? `<span class="badge badge-solved">Solved</span>` : `<span class="badge badge-open">Open</span>`}
          </div>
        `).join('') : '<div class="empty-state"><p>No cases assigned yet.</p></div>'}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.error || 'Failed to load profile.'}</p></div>`;
  }
}

// ── ═══════════════════════ DASHBOARD ════════════════════════════════════════ //

const CHART_COLORS = [
  '#4da6ff','#ffd700','#00e676','#ff5252','#ffab40',
  '#b39ddb','#80cbc4','#ef9a9a','#f48fb1','#a5d6a7'
];

async function loadDashboard() {
  if (chartsInitialised) return;

  try {
    const data = await api('GET', '/api/stats');

    buildChart('chart-crime-dist', 'doughnut', {
      labels: data.crime_distribution.map(d => fmt(d.crime_type)),
      datasets: [{
        data:            data.crime_distribution.map(d => d.count),
        backgroundColor: CHART_COLORS,
        borderColor:     'rgba(255,255,255,0.05)',
        borderWidth:     1,
      }],
    }, { plugins: { legend: { position: 'right', labels: { color: '#8a94a8', font: { size: 11 } } } } });

    const statusColors = { open: '#ff5252', solved: '#00e676' };
    buildChart('chart-status', 'pie', {
      labels: data.status_distribution.map(d => d.status),
      datasets: [{
        data:            data.status_distribution.map(d => d.count),
        backgroundColor: data.status_distribution.map(d => statusColors[d.status] || '#4da6ff'),
        borderColor:     'rgba(255,255,255,0.05)',
        borderWidth:     1,
      }],
    });

    buildChart('chart-station', 'bar', {
      labels: data.station_stats.map(d => d.station),
      datasets: [
        { label: 'Total',  data: data.station_stats.map(d => d.total_cases), backgroundColor: 'rgba(77,166,255,0.5)',  borderColor: '#4da6ff', borderWidth: 1 },
        { label: 'Solved', data: data.station_stats.map(d => d.solved),      backgroundColor: 'rgba(0,230,118,0.5)',   borderColor: '#00e676', borderWidth: 1 },
      ],
    }, { indexAxis: 'x', scales: { y: { beginAtZero: true, ticks: { color: '#8a94a8' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8a94a8', maxRotation: 30 }, grid: { display: false } } } });

    if (data.monthly_cases.length) {
      buildChart('chart-monthly', 'line', {
        labels: data.monthly_cases.map(d => d.month),
        datasets: [{
          label: 'Cases',
          data: data.monthly_cases.map(d => d.count),
          borderColor: '#4da6ff',
          backgroundColor: 'rgba(77,166,255,0.12)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#4da6ff',
        }],
      }, { scales: { y: { beginAtZero: true, ticks: { color: '#8a94a8' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8a94a8' }, grid: { display: false } } } });
    }

    chartsInitialised = true;
  } catch (err) {
    toast(`Dashboard: ${err.error || 'Failed to load stats'}`, 'error');
  }
}

function buildChart(canvasId, type, data, extraOptions = {}) {
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

  const ctx = $(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: '#8a94a8', font: { size: 11, family: 'Inter' } },
          ...((extraOptions.plugins?.legend) || {}),
        },
        ...extraOptions.plugins,
      },
      ...extraOptions,
    },
  });
}

// ── Utility ────────────────────────────────────────────────────────────────────
function fmt(str) {
  if (!str) return '—';
  return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
