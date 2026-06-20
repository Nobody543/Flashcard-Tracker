/* =========================================================================
   TEACHER APP
   Student real names are stored ONLY in this browser's localStorage —
   never written to the shared JSONBin data. The shared data only ever
   contains anonymous student IDs.
   ========================================================================= */

let data = null;
let localNames = {};
let selectedStudentId = null;
let teacherActiveTab = 'sessions'; // 'sessions' | 'status'
let toastTimeout = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadLocalNames();
  setupModalDismiss();
  if (sessionStorage.getItem('teacher_unlocked') === 'true') {
    await showTeacherApp();
  } else {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'flex';
    setupLock();
  }
}

function setupLock() {
  document.getElementById('pin-unlock-btn').addEventListener('click', async () => {
    const val = document.getElementById('pin-input').value;
    if (val === CONFIG.TEACHER_PIN) {
      sessionStorage.setItem('teacher_unlocked', 'true');
      document.getElementById('lock-screen').style.display = 'none';
      await showTeacherApp();
    } else {
      document.getElementById('pin-error').style.display = 'block';
    }
  });
  document.getElementById('pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pin-unlock-btn').click();
  });
}

async function showTeacherApp() {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('lock-screen').style.display = 'none';
  const loaded = await Storage.loadAll();
  data = loaded.data;
  document.getElementById('app').style.display = 'flex';
  document.getElementById('add-student-btn').addEventListener('click', addStudent);
  document.getElementById('refresh-btn').addEventListener('click', refreshData);
  renderStudentList();
  renderDashboardEmpty();
  if (!Storage.isConfigured()) {
    showToast('Set up JSONBin in js/config.js to sync data across your own devices and your student\'s device.');
  }
}

async function refreshData() {
  const loaded = await Storage.loadAll();
  data = loaded.data;
  renderStudentList();
  if (selectedStudentId && data.students[selectedStudentId]) renderDashboard();
  showToast('Refreshed.');
}

/* ---------------------------------------------------------------------- */
/* Local name storage (teacher's browser only)                            */
/* ---------------------------------------------------------------------- */

function loadLocalNames() {
  try { localNames = JSON.parse(localStorage.getItem('teacher_student_names') || '{}'); }
  catch (e) { localNames = {}; }
}
function saveLocalNames() {
  localStorage.setItem('teacher_student_names', JSON.stringify(localNames));
}

/* ---------------------------------------------------------------------- */
/* Persistence / small UI helpers                                         */
/* ---------------------------------------------------------------------- */

async function persist() {
  try { await Storage.saveAll(data); } catch (e) { console.warn('Save failed', e); }
}

function setupModalDismiss() {
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3600);
}
function studentLink(id) {
  return `${window.location.origin}${window.location.pathname.replace('teacher.html', 'student.html')}?id=${id}`;
}

/* ---------------------------------------------------------------------- */
/* Student list / add / rename / delete                                   */
/* ---------------------------------------------------------------------- */

function renderStudentList() {
  const list = document.getElementById('student-list');
  const ids = Object.keys(data.students);
  list.innerHTML = '';
  if (ids.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:0 8px; font-size:13px;">No students yet — add one below.</p>';
    return;
  }
  ids.forEach(id => {
    const name = localNames[id];
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (id === selectedStudentId ? ' active' : '');
    btn.textContent = name || 'Unnamed student';
    if (!name) btn.style.fontStyle = 'italic';
    btn.addEventListener('click', () => selectStudent(id));
    list.appendChild(btn);
  });
}

async function addStudent() {
  const newId = Utils.genId('s', 8);
  Storage.ensureStudent(data, newId);
  await persist();
  renderStudentList();
  openNamePrompt(newId, true);
}

function openNamePrompt(studentId, isNew) {
  const link = studentLink(studentId);
  openModal(`
    <h2>${isNew ? 'New student added' : 'Rename student'}</h2>
    <div class="field">
      <label>Name — stored only in your browser, never sent anywhere</label>
      <input type="text" id="name-input" value="${Utils.escapeHtml(localNames[studentId] || '')}" placeholder="e.g. Alex P." />
    </div>
    ${isNew ? `
    <div class="field">
      <label>Their personal link — send this to them</label>
      <input type="text" id="link-display" value="${link}" readonly />
      <button class="btn btn-secondary btn-sm mt-sm" id="copy-link-btn">Copy link</button>
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" id="name-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="name-save-btn">Save</button>
    </div>
  `);
  if (isNew) {
    document.getElementById('copy-link-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(link).then(() => showToast('Link copied.'));
    });
  }
  document.getElementById('name-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('name-save-btn').addEventListener('click', () => {
    const val = document.getElementById('name-input').value.trim();
    if (val) localNames[studentId] = val; else delete localNames[studentId];
    saveLocalNames();
    closeModal();
    renderStudentList();
    if (selectedStudentId === studentId) renderDashboard();
  });
}

function selectStudent(id) {
  selectedStudentId = id;
  teacherActiveTab = 'sessions';
  renderStudentList();
  renderDashboard();
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */

function renderDashboardEmpty() {
  document.getElementById('dashboard-area').innerHTML = `
    <div class="empty-state">
      <h3>Select a student</h3>
      <p>Choose a student on the left, or add a new one to get started.</p>
    </div>`;
}

function renderDashboard() {
  const student = data.students[selectedStudentId];
  if (!student) { renderDashboardEmpty(); return; }
  const name = localNames[selectedStudentId] || 'Unnamed student';
  const totalSeconds = student.sessionLogs.reduce((sum, l) => sum + l.durationSeconds, 0);
  const totalCards = student.sessionLogs.reduce((sum, l) => sum + l.cardsStudied, 0);

  const area = document.getElementById('dashboard-area');
  area.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap; gap:10px;">
      <div>
        <h1>${Utils.escapeHtml(name)}</h1>
        <p class="mono faint" style="margin:0;">${selectedStudentId}</p>
      </div>
      <div class="row gap-sm">
        <button class="btn btn-secondary btn-sm" id="rename-btn">Rename</button>
        <button class="btn btn-secondary btn-sm" id="copy-link-btn2">Copy link</button>
        <button class="btn btn-danger btn-sm" id="delete-student-btn">Delete data</button>
      </div>
    </div>
    ${student.activeSession ? `<div class="badge badge-green mt-sm">● Session in progress — started ${Utils.formatTime(student.activeSession.startedAt)}</div>` : ''}
    <div class="dl-stat-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="dl-stat-card" style="background:var(--blue-tint);"><div class="num" style="color:var(--blue-dark);">${Utils.formatDuration(totalSeconds)}</div><div class="lbl" style="color:var(--blue-dark);">Total time</div></div>
      <div class="dl-stat-card" style="background:var(--blue-tint);"><div class="num" style="color:var(--blue-dark);">${student.sessionLogs.length}</div><div class="lbl" style="color:var(--blue-dark);">Sessions</div></div>
      <div class="dl-stat-card" style="background:var(--blue-tint);"><div class="num" style="color:var(--blue-dark);">${totalCards}</div><div class="lbl" style="color:var(--blue-dark);">Cards studied</div></div>
      <div class="dl-stat-card" style="background:var(--blue-tint);"><div class="num" style="color:var(--blue-dark);">${student.decks.length}</div><div class="lbl" style="color:var(--blue-dark);">Decks</div></div>
    </div>

    <div class="row gap-sm mt-lg">
      <button class="btn ${teacherActiveTab === 'sessions' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="tab-sessions-btn">Session log</button>
      <button class="btn ${teacherActiveTab === 'status' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="tab-status-btn">Flashcard status</button>
    </div>
    <div id="tab-content" class="mt-md"></div>
  `;

  document.getElementById('rename-btn').addEventListener('click', () => openNamePrompt(selectedStudentId, false));
  document.getElementById('copy-link-btn2').addEventListener('click', () =>
    navigator.clipboard.writeText(studentLink(selectedStudentId)).then(() => showToast('Link copied.')));
  document.getElementById('delete-student-btn').addEventListener('click', async () => {
    if (!confirm(`Permanently delete all flashcard data for "${name}"? This can't be undone.`)) return;
    delete data.students[selectedStudentId];
    delete localNames[selectedStudentId];
    saveLocalNames();
    await persist();
    selectedStudentId = null;
    renderStudentList();
    renderDashboardEmpty();
  });
  document.getElementById('tab-sessions-btn').addEventListener('click', () => { teacherActiveTab = 'sessions'; renderDashboard(); });
  document.getElementById('tab-status-btn').addEventListener('click', () => { teacherActiveTab = 'status'; renderDashboard(); });

  if (teacherActiveTab === 'sessions') renderSessionLogTab(student);
  else renderStatusTab(student);
}

function renderSessionLogTab(student) {
  const container = document.getElementById('tab-content');
  if (student.sessionLogs.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No sessions logged yet</h3><p>This fills in once they press "Start session" / "End session" on their own device.</p></div>';
    return;
  }
  const rows = student.sessionLogs.slice().reverse().map(log => `
    <tr>
      <td>${Utils.formatDate(log.startedAt)}</td>
      <td>${Utils.formatTime(log.startedAt)} – ${Utils.formatTime(log.endedAt)}</td>
      <td>${Utils.formatDuration(log.durationSeconds)}</td>
      <td>${log.cardsStudied}</td>
      <td>${log.autoClosed ? '<span class="badge badge-orange">Auto-closed</span>' : ''}</td>
    </tr>
  `).join('');
  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Duration</th><th>Cards studied</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderStatusTab(student) {
  const container = document.getElementById('tab-content');
  if (student.decks.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No decks yet</h3><p>Nothing to show until they create a deck.</p></div>';
    return;
  }
  const labelMap = { green: 'Mastered', orange: 'Recently correct', red: 'Needs practice', new: 'Not studied yet' };
  let html = '';
  student.decks.forEach((deck, di) => {
    const rows = deck.cards.map((card, ci) => {
      const status = Utils.cardStatus(card);
      return `
        <tr>
          <td>${ci + 1}</td>
          <td>${Utils.escapeHtml(card.term)}</td>
          <td class="muted">${Utils.escapeHtml(card.definition)}</td>
          <td><span class="badge badge-${status}">${labelMap[status]}</span></td>
          <td>${card.timesSeen}</td>
          <td>${card.timesCorrect}</td>
          <td>${Utils.formatDate(card.lastSeenAt)}</td>
          <td>${card.starred ? '★' : ''}</td>
        </tr>`;
    }).join('');
    html += `
      <div class="deck-section-title"><h3>Deck ${di + 1} — ${Utils.escapeHtml(deck.title)}</h3><span class="muted">(${deck.cards.length} cards)</span></div>
      <table>
        <thead><tr><th>#</th><th>Term</th><th>Definition</th><th>Status</th><th>Seen</th><th>Correct</th><th>Last seen</th><th>★</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">No cards in this deck.</td></tr>'}</tbody>
      </table>
    `;
  });
  container.innerHTML = html;
}
