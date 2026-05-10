/* ═══════════════════════════════════════════════════════════
   NANOTABLE — script.js
   Ayesha's frontend logic
   Connects to Sanabil's Flask API (app.py) — same endpoint
   names, same JSON shapes, no backend changes needed.
   ═══════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let currentUser      = null;   // { id, name }
let currentTableId   = null;
let currentTableName = '';
let isLoginMode      = true;
let currentColumns   = [];     // columns of active table
let currentTableData = null;   // last full data response
let activeFilter     = null;   // { col, val }
let sortState        = { col: null, dir: 'asc' };
let allTables        = [];
let currentView      = 'data'; // 'data' | 'analytics'

/* Persisted preferences (localStorage only — no sensitive data) */
let pinnedTables = new Set(JSON.parse(localStorage.getItem('nt_pinned') || '[]'));
let tableEmojis  = JSON.parse(localStorage.getItem('nt_emojis')  || '{}');

const AVATAR_COLORS = ['av-violet','av-teal','av-rose','av-amber','av-sky'];
const EMOJIS = [
  '📄','📊','📅','✅','💰','📚','🏋️','🧠','🌱','🎯',
  '💡','🗂️','🔬','🎵','🍕','✈️','🏠','👥','📈','🔧',
  '🎨','📝','⭐','🚀','💎','🔐','📌','🗓️','🌍','🧩',
  '🏦','🛒','🍎','🎮','🏆','💼','🌙','🔥','⚡','🎁',
];


/* ─────────────────────────────────────────────
   SESSION PERSISTENCE
   Saves user object to sessionStorage so switching
   browser tabs doesn't log the user out. Uses
   sessionStorage (not localStorage) so it clears
   when the browser is fully closed — safer than
   storing credentials long-term.
───────────────────────────────────────────── */
function saveSession(user) {
  sessionStorage.setItem('nt_session', JSON.stringify(user));
}

function loadSession() {
  const raw = sessionStorage.getItem('nt_session');
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  sessionStorage.removeItem('nt_session');
}

/* Auto-restore session on page load */
(function restoreSession() {
  const saved = loadSession();
  if (saved) {
    currentUser = saved;
    // Show app immediately — don't force re-login
    window.addEventListener('DOMContentLoaded', () => showApp(true));
  }
})();


/* ─────────────────────────────────────────────
   TOAST NOTIFICATIONS
───────────────────────────────────────────── */
function showToast(msg, type = 'success', duration = 2800) {
  const icons = { success: '✓', error: '✗', info: '◉', warning: '⚠' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '◉'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.28s ease forwards';
    setTimeout(() => toast.remove(), 280);
  }, duration);
}


/* ─────────────────────────────────────────────
   AUTH
───────────────────────────────────────────── */
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-title').innerText          = isLoginMode ? 'Welcome back'         : 'Create account';
  document.getElementById('auth-subtitle').innerText       = isLoginMode ? 'Sign in to your workspace' : 'Start building your data workspace';
  document.getElementById('name-group').style.display      = isLoginMode ? 'none'   : 'block';
  document.getElementById('auth-btn').innerText            = isLoginMode ? 'Sign In' : 'Register';
  document.getElementById('auth-toggle').innerText         = isLoginMode
    ? "Don't have an account? Register"
    : 'Already have an account? Sign In';
}

async function handleAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name     = document.getElementById('auth-name').value.trim();

  if (!email || !password) { showToast('Please fill in all fields', 'error'); return; }

  const btn = document.getElementById('auth-btn');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;

  const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
  /* Exact JSON shapes that Sanabil's app.py expects */
  const body = isLoginMode
    ? { email, password }
    : { name, email, password };

  try {
    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok) {
      currentUser = {
        id:   data.user_id,
        name: name || email.split('@')[0],
      };
      saveSession(currentUser);
      showApp();
    } else {
      showToast(data.message || 'Authentication failed', 'error');
    }
  } catch (e) {
    showToast('Could not reach server. Is Flask running?', 'error');
  }

  btn.innerHTML = isLoginMode ? 'Sign In' : 'Register';
  btn.disabled  = false;
}

function logout() {
  clearSession();
  location.reload();
}


/* ─────────────────────────────────────────────
   APP INIT
───────────────────────────────────────────── */
function showApp(fromRestore = false) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'flex';

  const initial    = (currentUser.name || 'U')[0].toUpperCase();
  const colorClass = AVATAR_COLORS[initial.charCodeAt(0) % AVATAR_COLORS.length];
  const av         = document.getElementById('user-avatar');
  av.textContent   = initial;
  av.className     = `user-avatar ${colorClass}`;

  document.getElementById('user-display').textContent = currentUser.name;

  if (fromRestore) {
    showToast(`Welcome back, ${currentUser.name}`, 'info');
  }

  loadSidebar();
}


/* ─────────────────────────────────────────────
   SIDEBAR
───────────────────────────────────────────── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

async function loadSidebar() {
  try {
    /* GET /tables?user_id=1 — Sanabil's endpoint */
    const res = await fetch(`/tables?user_id=${currentUser.id}`);
    allTables  = await res.json();
    renderSidebar(allTables);
  } catch (e) {
    showToast('Failed to load tables', 'error');
  }
}

function renderSidebar(tables) {
  const pinned   = tables.filter(t =>  pinnedTables.has(t.table_id));
  const unpinned = tables.filter(t => !pinnedTables.has(t.table_id));

  const pinnedEl   = document.getElementById('pinned-tables');
  const unpinnedEl = document.getElementById('sidebar-tables');

  pinnedEl.innerHTML   = pinned.length
    ? pinned.map(buildTableLinkHTML).join('')
    : `<div style="padding:5px 10px; font-size:11px; color:var(--text-muted);">No pinned tables</div>`;

  unpinnedEl.innerHTML = unpinned.length
    ? unpinned.map(buildTableLinkHTML).join('')
    : `<div style="padding:5px 10px; font-size:11px; color:var(--text-muted);">No tables yet.</div>`;
}

function buildTableLinkHTML(t) {
  const emoji    = tableEmojis[t.table_id] || '📄';
  const isPinned = pinnedTables.has(t.table_id);
  const isActive = currentTableId == t.table_id;
  /* Sanitize name for inline onclick — replace single quotes */
  const safeName = (t.table_name || '').replace(/'/g, "\\'");
  return `
    <div class="table-link ${isActive ? 'active' : ''}" id="tlink-${t.table_id}"
         onclick="loadTable(${t.table_id}, '${safeName}')">
      <div class="table-link-left">
        <span class="table-emoji">${emoji}</span>
        <div class="table-link-info sidebar-text">
          <div class="table-link-name-text">
            ${t.table_name}${isPinned ? '<span class="pin-badge">📌</span>' : ''}
          </div>
        </div>
      </div>
      <div class="table-link-actions">
        <button class="tbl-action-btn ${isPinned ? 'pin-active' : ''}"
                onclick="event.stopPropagation(); togglePin(${t.table_id})"
                title="${isPinned ? 'Unpin' : 'Pin'}">📌</button>
        <button class="tbl-action-btn danger"
                onclick="event.stopPropagation(); deleteTable(${t.table_id})"
                title="Delete">🗑</button>
      </div>
    </div>`;
}

function filterSidebar(query) {
  if (!query.trim()) { renderSidebar(allTables); return; }
  const q        = query.toLowerCase();
  const filtered = allTables.filter(t => t.table_name.toLowerCase().includes(q));
  renderSidebar(filtered);
}

function togglePin(tableId) {
  if (pinnedTables.has(tableId)) {
    pinnedTables.delete(tableId);
    showToast('Table unpinned', 'info');
  } else {
    pinnedTables.add(tableId);
    showToast('Table pinned', 'info');
  }
  localStorage.setItem('nt_pinned', JSON.stringify([...pinnedTables]));
  renderSidebar(allTables);
}


/* ─────────────────────────────────────────────
   TABLE CRUD
───────────────────────────────────────────── */
/* Quick-select emojis shown in the create-table modal */
const CREATE_EMOJIS = ['📄','📊','💰','📚','✅','🏋️','🎯','🗓️','📈','🌱','🎨','🏠','👥','🔧','🚀','💡'];
let createTableSelectedEmoji = '📄';

function createNewTable() {
  /* Reset state */
  createTableSelectedEmoji = '📄';
  document.getElementById('new-table-name').value = '';

  /* Render emoji quick-pick row */
  document.getElementById('create-table-emoji-row').innerHTML =
    CREATE_EMOJIS.map(e => `
      <span class="emoji-opt ${e === createTableSelectedEmoji ? 'selected' : ''}"
            style="font-size:18px; padding:5px 7px;"
            onclick="pickCreateEmoji('${e}')">${e}</span>`
    ).join('');

  document.getElementById('create-table-modal').classList.add('open');
  /* Focus the name input after modal opens */
  setTimeout(() => document.getElementById('new-table-name').focus(), 80);
}

function pickCreateEmoji(emoji) {
  createTableSelectedEmoji = emoji;
  /* Re-render to show selected state */
  document.querySelectorAll('#create-table-emoji-row .emoji-opt').forEach(el => {
    el.classList.toggle('selected', el.textContent === emoji);
  });
}

async function submitCreateTable() {
  const name = (document.getElementById('new-table-name').value || '').trim();
  if (!name) { showToast('Enter a table name', 'error'); return; }

  closeModal('create-table-modal');

  /* POST /tables — Sanabil's endpoint */
  const res  = await fetch('/tables', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ user_id: currentUser.id, table_name: name }),
  });
  const data = await res.json();

  /* Save chosen emoji for this new table */
  tableEmojis[data.table_id] = createTableSelectedEmoji;
  localStorage.setItem('nt_emojis', JSON.stringify(tableEmojis));

  await loadSidebar();
  loadTable(data.table_id, name);
  showToast(`Table "${name}" created`, 'success');
}

async function loadTable(id, name) {
  currentTableId   = id;
  currentTableName = name;
  activeFilter     = null;
  sortState        = { col: null, dir: 'asc' };
  currentView      = 'data';

  /* Reset filter/sort UI */
  document.getElementById('filter-badge').style.display   = 'none';
  document.getElementById('sort-indicator').style.display = 'none';
  document.getElementById('filter-col').value = '';
  document.getElementById('filter-val').value = '';

  /* Show table view, hide empty */
  document.getElementById('empty-view').style.display  = 'none';
  document.getElementById('table-view').style.display  = 'flex';

  /* Reset to data tab */
  switchView('data');

  document.getElementById('view-table-name').innerText      = name;
  document.getElementById('view-table-emoji').textContent   = tableEmojis[id] || '📄';
  document.getElementById('stat-updated').textContent       = 'now';

  /* Highlight active sidebar link */
  document.querySelectorAll('.table-link').forEach(el => el.classList.remove('active'));
  const link = document.getElementById(`tlink-${id}`);
  if (link) link.classList.add('active');

  showSkeletonLoader();
  await fetchTableData();
}

function showSkeletonLoader() {
  document.getElementById('data-body').innerHTML = [1,2,3].map(() => `
    <tr class="skeleton-row">
      <td style="border:1px solid var(--border);padding:10px;background:var(--bg2);">
        <div class="skeleton-cell" style="width:24px;"></div></td>
      <td style="border:1px solid var(--border);padding:10px;">
        <div class="skeleton-cell"></div></td>
      <td style="border:1px solid var(--border);padding:10px;">
        <div class="skeleton-cell" style="width:55%;"></div></td>
      <td style="border:1px solid var(--border);padding:10px;background:var(--bg2);">
        <div class="skeleton-cell" style="width:38px;"></div></td>
    </tr>`).join('');
}

async function fetchTableData() {
  /* Build URL — append filter params if active */
  let url = `/tables/${currentTableId}/data`;
  if (activeFilter) {
    const colMeta = currentColumns.find(c => c.column_name === activeFilter.col);
    const op = activeFilter.op || ((colMeta && colMeta.data_type === 'TEXT') ? 'contains' : '=');
    url += `?column=${encodeURIComponent(activeFilter.col)}&value=${encodeURIComponent(activeFilter.val)}&op=${encodeURIComponent(op)}`;
  }

  /* GET /tables/{id}/data — Sanabil's endpoint */
  const res  = await fetch(url);
  const data = await res.json();

  currentColumns   = data.columns;
  currentTableData = data;

  renderTable(data);
  updateFilterColumns(data.columns);
  updateAnalyticsColumnPickers(data.columns);
  updateAggBar(data);

  document.getElementById('stat-rows').textContent = data.rows.length;
  document.getElementById('stat-cols').textContent = data.columns.length;
}

async function refreshTable() {
  await fetchTableData();
  showToast('Refreshed', 'info');
}

async function renameTable(newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed || trimmed === currentTableName) return;

  /* PUT /tables/{id} — Sanabil's endpoint */
  await fetch(`/tables/${currentTableId}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ table_name: trimmed }),
  });
  currentTableName = trimmed;
  await loadSidebar();
  showToast('Table renamed', 'success');
}

async function deleteTable(id) {
  if (!confirm('Delete this table and all its data? This cannot be undone.')) return;

  /* DELETE /tables/{id} — Sanabil's endpoint */
  await fetch(`/tables/${id}`, { method: 'DELETE' });

  if (currentTableId === id) {
    currentTableId = null;
    document.getElementById('table-view').style.display = 'none';
    document.getElementById('empty-view').style.display = 'flex';
  }
  await loadSidebar();
  showToast('Table deleted', 'info');
}


/* ─────────────────────────────────────────────
   RENDER TABLE
───────────────────────────────────────────── */
function renderTable(data) {
  /* Apply client-side sort before rendering */
  let rows = [...data.rows];
  if (sortState.col) {
    rows.sort((a, b) => {
      const va = a.values[sortState.col] ?? '';
      const vb = b.values[sortState.col] ?? '';
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortState.dir === 'asc' ? cmp : -cmp;
    });
  }

  const head = document.getElementById('data-head');
  const body = document.getElementById('data-body');

  /* Header row */
  head.innerHTML = `
    <tr>
      <th class="th-id">#</th>
      ${data.columns.map(c => `
        <th>
          <div class="col-header" onclick="sortByColumn('${c.column_name.replace(/'/g,"\\'")}')">
            <span class="col-name-text">${c.column_name}</span>
            <span class="col-type-tag">${c.data_type}</span>
            <span class="col-sort-btn ${sortState.col === c.column_name ? 'active' : ''}" >
              ${sortState.col === c.column_name ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
            <span class="col-del-btn"
                  onclick="event.stopPropagation(); deleteCol(${c.column_id})"
                  title="Delete column">×</span>
          </div>
        </th>`).join('')}
      <th class="th-actions">Actions</th>
    </tr>`;

  /* Empty state */
  if (rows.length === 0) {
    body.innerHTML = `
      <tr class="empty-row">
        <td colspan="${data.columns.length + 2}">
          No rows yet — click "+ New Row" to add one
        </td>
      </tr>`;
    return;
  }

  /*
    Row numbering: we use a visual counter (1, 2, 3…) not the DB row_id.
    This means if you delete row 3 out of 1-2-3-4-5, the display becomes
    1-2-3-4 — exactly what was requested.
    The actual row_id is still passed to delete/duplicate functions.
  */
  body.innerHTML = rows.map((row, visualIndex) => `
    <tr>
      <td class="td-id">${visualIndex + 1}</td>
      ${data.columns.map(c => {
        const raw = row.values[c.column_name];
        const val = raw !== null && raw !== undefined ? raw : '';
        return `<td>
          <div class="editable" contenteditable="true"
               onblur="updateCell(${row.row_id}, ${c.column_id}, this.innerText)"
               data-original="${String(val).replace(/"/g,'&quot;')}"
          >${val}</div>
        </td>`;
      }).join('')}
      <td class="td-actions">
        <div class="row-actions">
          <button class="btn btn-ghost btn-icon" style="font-size:12px;"
                  onclick="duplicateRow(${row.row_id})" title="Duplicate row">⧉</button>
          <button class="btn btn-danger btn-icon" style="font-size:12px;"
                  onclick="deleteRow(${row.row_id})" title="Delete row">✕</button>
        </div>
      </td>
    </tr>`).join('');
}


/* ─────────────────────────────────────────────
   SORT
───────────────────────────────────────────── */
function sortByColumn(colName) {
  if (sortState.col === colName) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.col = colName;
    sortState.dir = 'asc';
  }
  const ind = document.getElementById('sort-indicator');
  ind.style.display = 'flex';
  document.getElementById('sort-indicator-text').textContent =
    `${colName} ${sortState.dir === 'asc' ? '↑' : '↓'}`;
  renderTable(currentTableData);
  showToast(`Sorted by ${colName} (${sortState.dir})`, 'info');
}

function clearSort() {
  sortState = { col: null, dir: 'asc' };
  document.getElementById('sort-indicator').style.display = 'none';
  renderTable(currentTableData);
}


/* ─────────────────────────────────────────────
   FILTER
───────────────────────────────────────────── */
function updateFilterColumns(cols) {
  const sel = document.getElementById('filter-col');
  sel.innerHTML = '<option value="">— column —</option>' +
    cols.map(c => `<option value="${c.column_name}">${c.column_name}</option>`).join('');
}

async function applyFilter() {
  const col = document.getElementById('filter-col').value;
  const val = document.getElementById('filter-val').value.trim();
  if (!col || !val) { showToast('Select a column and enter a value', 'error'); return; }

  const op = document.getElementById('filter-op').value;
  activeFilter = { col, val, op };
  const badge  = document.getElementById('filter-badge');
  badge.style.display = 'flex';
  document.getElementById('filter-badge-text').textContent = `${col} ${op} "${val}"`;

  await fetchTableData();
  showToast(`Filtered: ${col} ${op} "${val}"`, 'info');
}

async function clearFilter() {
  activeFilter = null;
  document.getElementById('filter-badge').style.display = 'none';
  document.getElementById('filter-col').value = '';
  document.getElementById('filter-op').value = 'contains';
  document.getElementById('filter-val').value = '';
  await fetchTableData();
}


/* ─────────────────────────────────────────────
   COLUMNS
───────────────────────────────────────────── */
async function addColumn() {
  const name = document.getElementById('new-col-name').value.trim();
  const type = document.getElementById('new-col-type').value;
  if (!name) { showToast('Enter a column name', 'error'); return; }

  /* POST /columns — Sanabil's endpoint — exact JSON shape */
  await fetch('/columns', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ table_id: currentTableId, column_name: name, data_type: type }),
  });

  document.getElementById('new-col-name').value = '';
  await fetchTableData();
  showToast(`Column "${name}" added`, 'success');
}

async function deleteCol(columnId) {
  if (!confirm('Delete this column and all its stored data? This cannot be undone.')) return;

  /* DELETE /columns/{id} — Sanabil's endpoint */
  const res = await fetch(`/columns/${columnId}`, { method: 'DELETE' });
  if (res.ok) {
    await fetchTableData();
    showToast('Column deleted', 'info');
  } else {
    showToast('Failed to delete column', 'error');
  }
}


/* ─────────────────────────────────────────────
   ROWS
───────────────────────────────────────────── */
function openAddRowModal() {
  if (!currentColumns || currentColumns.length === 0) {
    showToast('Add at least one column first', 'error');
    return;
  }

  document.getElementById('modal-fields').innerHTML = currentColumns.map(col => {
    let inputHTML;
    if (col.data_type === 'BOOLEAN') {
      inputHTML = `
        <select id="mf-${col.column_id}">
          <option value="true">True</option>
          <option value="false">False</option>
        </select>`;
    } else if (col.data_type === 'DATE') {
      inputHTML = `<input type="date" id="mf-${col.column_id}">`;
    } else if (col.data_type === 'NUMBER') {
      inputHTML = `<input type="number" id="mf-${col.column_id}" step="any" placeholder="0">`;
    } else {
      inputHTML = `<input type="text" id="mf-${col.column_id}" placeholder="${col.column_name}">`;
    }
    return `
      <div class="modal-field">
        <label class="field-label">
          ${col.column_name}
          <span style="color:var(--text-muted); font-size:8px; margin-left:4px;">
            ${col.data_type}
          </span>
        </label>
        ${inputHTML}
      </div>`;
  }).join('');

  document.getElementById('row-modal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

async function submitRow() {
  const values = {};
  for (const col of currentColumns) {
    const el = document.getElementById(`mf-${col.column_id}`);
    if (!el) continue;
    let val = el.value;
    if (col.data_type === 'NUMBER')  val = parseFloat(val) || 0;
    if (col.data_type === 'BOOLEAN') val = val === 'true';
    values[col.column_name] = val;
  }

  /* POST /rows/full — Sanabil's endpoint — exact JSON shape */
  const res = await fetch('/rows/full', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ table_id: currentTableId, values }),
  });

  if (res.ok) {
    closeModal('row-modal');
    await fetchTableData();
    showToast('Row added', 'success');
  } else {
    showToast('Error inserting row — check data types', 'error');
  }
}

/* Compatibility alias — Sanabil's frontend calls this */
async function addFullRowQuickly() { openAddRowModal(); }

async function duplicateRow(rowId) {
  const row = currentTableData.rows.find(r => r.row_id === rowId);
  if (!row) return;

  /* POST /rows/full — same endpoint */
  const res = await fetch('/rows/full', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ table_id: currentTableId, values: row.values }),
  });

  if (res.ok) {
    await fetchTableData();
    showToast('Row duplicated', 'success');
  } else {
    showToast('Failed to duplicate row', 'error');
  }
}

async function updateCell(rid, cid, val) {
  /* Don't fire if nothing changed */
  const el = event.target;
  if (el && el.dataset.original === String(val)) return;

  /* POST /cells — Sanabil's endpoint — exact JSON shape */
  await fetch('/cells', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ row_id: rid, column_id: cid, value: val }),
  });

  if (el) el.dataset.original = String(val);
  showToast('Saved', 'success', 1500);

  /* Refresh agg bar silently after edit */
  await fetchTableData();
}

async function deleteRow(id) {
  /* DELETE /rows/{id} — Sanabil's endpoint */
  await fetch(`/rows/${id}`, { method: 'DELETE' });
  await fetchTableData();
  showToast('Row deleted', 'info');
}


/* ─────────────────────────────────────────────
   AGGREGATION SUMMARY BAR
   Shows below the table for all NUMBER columns.
   Calculates: Sum, Avg, Min, Max, Count
───────────────────────────────────────────── */
function updateAggBar(data) {
  const bar     = document.getElementById('agg-bar');
  const numCols = data.columns.filter(c => c.data_type === 'NUMBER');

  if (numCols.length === 0 || data.rows.length === 0) {
    bar.classList.remove('visible');
    bar.innerHTML = '';
    return;
  }

  let chips = '';

  for (const col of numCols) {
    const vals = data.rows
      .map(r => {
        const v = r.values[col.column_name];
        return v !== null && v !== undefined && v !== '' ? parseFloat(v) : null;
      })
      .filter(v => v !== null && !isNaN(v));

    if (vals.length === 0) continue;

    const sum   = vals.reduce((a, b) => a + b, 0);
    const avg   = sum / vals.length;
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    const count = vals.length;

    const fmt = n => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

    chips += `
      <span class="agg-chip sum"  title="${col.column_name} sum">
        <span class="agg-label">${col.column_name} Σ</span>
        <span class="agg-val">${fmt(sum)}</span>
      </span>
      <span class="agg-chip avg"  title="${col.column_name} average">
        <span class="agg-label">avg</span>
        <span class="agg-val">${fmt(avg)}</span>
      </span>
      <span class="agg-chip min"  title="${col.column_name} minimum">
        <span class="agg-label">min</span>
        <span class="agg-val">${fmt(min)}</span>
      </span>
      <span class="agg-chip max"  title="${col.column_name} maximum">
        <span class="agg-label">max</span>
        <span class="agg-val">${fmt(max)}</span>
      </span>
      <span class="agg-chip count" title="${col.column_name} count">
        <span class="agg-label">n</span>
        <span class="agg-val">${count}</span>
      </span>`;

    /* Divider between multiple number columns */
    chips += `<span style="width:1px; height:18px; background:var(--border2); margin:0 4px; flex-shrink:0;"></span>`;
  }

  if (chips) {
    bar.innerHTML = chips;
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}


/* ─────────────────────────────────────────────
   VIEW SWITCHING (Data ↔ Analytics)
───────────────────────────────────────────── */
function switchView(view) {
  currentView = view;
  document.getElementById('tab-data').classList.toggle('active',      view === 'data');
  document.getElementById('tab-analytics').classList.toggle('active', view === 'analytics');

  const dataEl      = document.getElementById('data-subview');
  const analyticsEl = document.getElementById('analytics-subview');

  if (view === 'data') {
    dataEl.style.display      = 'flex';
    analyticsEl.style.display = 'none';
  } else {
    dataEl.style.display            = 'none';
    analyticsEl.style.display       = 'flex';
    analyticsEl.style.flexDirection = 'column';
    if (currentTableData) buildAnalytics();
  }
}


/* ─────────────────────────────────────────────
   ANALYTICS PANEL
   Auto-detects DATE and NUMBER columns.
   User can override via the dropdowns.
   Shows: summary cards + bar chart + monthly table.
───────────────────────────────────────────── */
function updateAnalyticsColumnPickers(cols) {
  const dateSel  = document.getElementById('analytics-date-col');
  const valueSel = document.getElementById('analytics-value-col');
  dateSel.innerHTML  = '<option value="">— auto-detect —</option>' +
    cols.filter(c => c.data_type === 'DATE')
        .map(c => `<option value="${c.column_name}">${c.column_name}</option>`).join('');
  valueSel.innerHTML = '<option value="">— auto-detect —</option>' +
    cols.filter(c => c.data_type === 'NUMBER')
        .map(c => `<option value="${c.column_name}">${c.column_name}</option>`).join('');
}

/* ─────────────────────────────────────────────
   ANALYTICS
───────────────────────────────────────────── */

/* Safe date → "YYYY-MM".
   Handles ALL formats Flask/psycopg2 can send:
   - "2025-04-15"
   - "2025-04-15T00:00:00"
   - "Thu, 16 Apr 2026 00:00:00 GMT"   ← actual psycopg2 output
   Returns null for anything unparseable. */
function parseYearMonth(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();

  // Format: "2025-04-15" or "2025-04-15T00:00:00..."
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);

  // Format: "Thu, 16 Apr 2026 00:00:00 GMT" — parse via Date object
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/* "2025-04" → Date object built with explicit ints — no timezone shift */
function ymToDate(ym) {
  const p = ym.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, 1);
}

/* Format a number nicely, never more than 2 decimals */
function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildAnalytics() {
  if (!currentTableData) return;
  const data = currentTableData;

  /* ── 1. Resolve which columns to use ── */
  const pickedDate  = document.getElementById('analytics-date-col').value;
  const pickedValue = document.getElementById('analytics-value-col').value;

  const dateCols  = data.columns.filter(c => c.data_type === 'DATE');
  const numCols   = data.columns.filter(c => c.data_type === 'NUMBER');

  const dateColName  = pickedDate  || (dateCols[0]  || {}).column_name || null;
  const valueColName = pickedValue || (numCols[0]   || {}).column_name || null;

  // countMode: we have a date column but no number column (e.g. reading tracker)
  const countMode = !!dateColName && !valueColName;

  /* ── 2. Summary cards ── */
  const cardsEl = document.getElementById('summary-cards');
  cardsEl.innerHTML = '';

  if (data.rows.length === 0) {
    cardsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No rows yet.</p>';
  } else if (numCols.length === 0 && countMode) {
    // count-mode summary
    const valid  = data.rows.filter(r => parseYearMonth(r.values[dateColName]));
    const months = new Set(valid.map(r => parseYearMonth(r.values[dateColName])));
    cardsEl.innerHTML = `
      <div class="summary-card accent-purple">
        <div class="sc-label">Total Entries</div>
        <div class="sc-val">${valid.length}</div>
        <div class="sc-sub">rows with a valid date</div>
      </div>
      <div class="summary-card accent-teal">
        <div class="sc-label">Active Months</div>
        <div class="sc-val">${months.size}</div>
        <div class="sc-sub">months with data</div>
      </div>`;
  } else if (numCols.length === 0) {
    cardsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Add a NUMBER column to see aggregations.</p>';
  } else {
    const accents = ['accent-purple','accent-teal','accent-amber','accent-rose'];
    numCols.forEach((col, i) => {
      const vals = data.rows
        .map(r => parseFloat(r.values[col.column_name]))
        .filter(v => !isNaN(v));
      if (!vals.length) return;
      const sum = vals.reduce((a,b) => a+b, 0);
      const avg = sum / vals.length;
      cardsEl.innerHTML += `
        <div class="summary-card ${accents[i % accents.length]}">
          <div class="sc-label">${col.column_name}</div>
          <div class="sc-val">${fmtNum(sum)}</div>
          <div class="sc-sub">Total &nbsp;·&nbsp; avg ${fmtNum(avg)}</div>
        </div>`;
    });
  }

  /* ── 3. Monthly aggregation ── */
  const barsEl  = document.getElementById('monthly-bars');
  const tbodyEl = document.getElementById('monthly-tbody');
  const theadEl = document.getElementById('monthly-thead');
  const titleEl = document.getElementById('chart-title');

  if (!dateColName) {
    barsEl.innerHTML  = '<p style="color:var(--text-muted);font-size:12px;padding:8px;">No DATE column — add one to see the monthly chart.</p>';
    tbodyEl.innerHTML = '<tr><td style="text-align:center;color:var(--text-muted);padding:24px;">No date column.</td></tr>';
    theadEl.innerHTML = '<tr><th>Month</th><th>—</th></tr>';
    return;
  }

  /* Aggregate */
  const monthly = {};   // "YYYY-MM" → array of numbers (or 1s in countMode)
  for (const row of data.rows) {
    const ym = parseYearMonth(row.values[dateColName]);
    if (!ym) continue;

    if (countMode) {
      monthly[ym] = (monthly[ym] || []);
      monthly[ym].push(1);
    } else {
      const v = parseFloat(row.values[valueColName]);
      if (isNaN(v)) continue;
      monthly[ym] = (monthly[ym] || []);
      monthly[ym].push(v);
    }
  }

  const keys = Object.keys(monthly).sort();

  if (!keys.length) {
    barsEl.innerHTML  = '<p style="color:var(--text-muted);font-size:12px;padding:8px;">No valid dates found in rows.</p>';
    tbodyEl.innerHTML = '<tr><td style="text-align:center;color:var(--text-muted);padding:24px;">No data.</td></tr>';
    theadEl.innerHTML = countMode
      ? '<tr><th>Month</th><th>Count</th></tr>'
      : '<tr><th>Month</th><th>Total</th><th>Avg</th><th>Count</th><th>Min</th><th>Max</th></tr>';
    return;
  }

  const stats = keys.map(ym => {
    const vals  = monthly[ym];
    const total = vals.reduce((a,b) => a+b, 0);
    return {
      ym,
      total,
      avg:   total / vals.length,
      count: vals.length,
      min:   Math.min(...vals),
      max:   Math.max(...vals),
    };
  });

  const maxTotal = Math.max(...stats.map(s => s.total));
  const BAR_H    = 100;   // px — max bar height, fixed so tooltip is never clipped

  /* Bar chart */
  titleEl.textContent = countMode
    ? `Entries per month — grouped by ${dateColName}`
    : `${valueColName} by month — grouped by ${dateColName}`;

  barsEl.innerHTML = stats.map(s => {
    const h     = maxTotal > 0 ? Math.max(4, Math.round((s.total / maxTotal) * BAR_H)) : 4;
    const d     = ymToDate(s.ym);
    const lbl   = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const tip   = countMode ? `${s.count} entries` : fmtNum(s.total);
    return `<div class="month-bar-wrap">
      <div class="month-bar" style="height:${h}px;" data-val="${tip}"></div>
      <div class="month-label">${lbl}</div>
    </div>`;
  }).join('');

  /* Table */
  theadEl.innerHTML = countMode
    ? '<tr><th>Month</th><th>Count</th></tr>'
    : '<tr><th>Month</th><th>Total</th><th>Avg</th><th>Count</th><th>Min</th><th>Max</th></tr>';

  tbodyEl.innerHTML = stats.map(s => {
    const lbl = ymToDate(s.ym).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (countMode) return `<tr><td>${lbl}</td><td>${s.count}</td></tr>`;
    return `<tr>
      <td>${lbl}</td>
      <td>${fmtNum(s.total)}</td>
      <td>${fmtNum(s.avg)}</td>
      <td>${s.count}</td>
      <td>${fmtNum(s.min)}</td>
      <td>${fmtNum(s.max)}</td>
    </tr>`;
  }).join('');
}



/* ─────────────────────────────────────────────
   EMOJI PICKER
───────────────────────────────────────────── */
function openEmojiPicker() {
  const current = tableEmojis[currentTableId] || '📄';
  document.getElementById('emoji-grid').innerHTML = EMOJIS.map(e => `
    <div class="emoji-opt ${e === current ? 'selected' : ''}"
         onclick="selectEmoji('${e}')">${e}</div>`).join('');
  document.getElementById('emoji-modal').classList.add('open');
}

function selectEmoji(emoji) {
  tableEmojis[currentTableId] = emoji;
  localStorage.setItem('nt_emojis', JSON.stringify(tableEmojis));
  document.getElementById('view-table-emoji').textContent = emoji;
  closeModal('emoji-modal');
  renderSidebar(allTables);
  showToast('Icon updated', 'success');
}


/* ─────────────────────────────────────────────
   EXPORT TO CSV
───────────────────────────────────────────── */
function exportCSV() {
  if (!currentTableData || currentTableData.rows.length === 0) {
    showToast('No data to export', 'error'); return;
  }

  const cols   = currentTableData.columns.map(c => c.column_name);
  const header = ['#', ...cols].join(',');

  const csvRows = currentTableData.rows.map((row, i) =>
    [i + 1, ...cols.map(c => {
      const val = row.values[c] ?? '';
      return `"${String(val).replace(/"/g, '""')}"`;
    })].join(',')
  );

  const csv  = [header, ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${currentTableName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported as CSV', 'success');
}


/* ─────────────────────────────────────────────
   KEYBOARD SHORTCUTS
───────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  /* Enter on auth screen submits */
  if (e.key === 'Enter') {
    const authVisible = document.getElementById('auth-screen').style.display !== 'none';
    if (authVisible) { handleAuth(); return; }
  }

  /* Escape closes any open modal */
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }

  /* Ctrl/Cmd + N = new table */
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    if (currentUser) createNewTable();
  }
});

/* Click outside modal to close */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});


/* ─────────────────────────────────────────────
   DOM READY — restore session if available
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadSession();
  if (saved) {
    currentUser = saved;
    showApp(true);
  }
});