/* =========================================================================
   TEACHER APP

   Two things a teacher manages here:
   - Students: per-student dashboard (session log + flashcard status)
   - Library:  decks the teacher owns and every student can browse/add.
               Editing a library deck updates it for every student
               instantly; each student's stars/scores on it stay their own
               (stored in that student's libraryLinks, not on the deck).
   ========================================================================= */

let data = null;
let selectedStudentId = null;
let viewMode = 'empty';          // 'empty' | 'student' | 'library'
let teacherActiveTab = 'sessions'; // 'sessions' | 'status'
let isNewLibDeck = true;
let editingLibDeck = null;
let toastTimeout = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
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
  document.getElementById('library-nav-btn').addEventListener('click', openLibrary);
  renderStudentList();
  renderDashboardEmpty();
  if (!Storage.isConfigured()) {
    showToast("Set up JSONBin in js/config.js to sync data across your own devices and your student's device.");
  }
}

async function refreshData() {
  const loaded = await Storage.loadAll();
  data = loaded.data;
  renderStudentList();
  if (viewMode === 'student' && selectedStudentId && data.students[selectedStudentId]) renderDashboard();
  else if (viewMode === 'library') renderLibraryManager();
  showToast('Refreshed.');
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
function openModal(html, wide) {
  document.getElementById('modal-content').classList.toggle('modal-wide', Boolean(wide));
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').classList.remove('modal-wide');
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
    const name = data.students[id].name;
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (viewMode === 'student' && id === selectedStudentId ? ' active' : '');
    btn.textContent = name || 'Unnamed student';
    if (!name) btn.style.fontStyle = 'italic';
    btn.addEventListener('click', () => selectStudent(id));
    list.appendChild(btn);
  });
}

async function addStudent() {
  const newId = Utils.genId('s', 8);
  const student = Storage.ensureStudent(data, newId);
  student.name = null;
  await persist();
  renderStudentList();
  openNamePrompt(newId, true);
}

function openNamePrompt(studentId, isNew) {
  const link = studentLink(studentId);
  openModal(`
    <h2>${isNew ? 'New student added' : 'Rename student'}</h2>
    <div class="field">
      <label>Name</label>
      <input type="text" id="name-input" value="${Utils.escapeHtml(data.students[studentId].name || '')}" placeholder="e.g. Alex P." />
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
  document.getElementById('name-save-btn').addEventListener('click', async () => {
    const val = document.getElementById('name-input').value.trim();
    data.students[studentId].name = val || null;
    await persist();
    closeModal();
    renderStudentList();
    if (selectedStudentId === studentId) renderDashboard();
  });
}

function selectStudent(id) {
  viewMode = 'student';
  selectedStudentId = id;
  teacherActiveTab = 'sessions';
  statusDeckFilter = null;
  document.getElementById('library-nav-btn').classList.remove('active');
  renderStudentList();
  renderDashboard();
}

/* ---------------------------------------------------------------------- */
/* Per-student dashboard                                                  */
/* ---------------------------------------------------------------------- */

function renderDashboardEmpty() {
  viewMode = 'empty';
  document.getElementById('dashboard-area').innerHTML = `
    <div class="empty-state">
      <h3>Select a student</h3>
      <p>Choose a student on the left, add a new one, or manage your deck library above.</p>
    </div>`;
}

function renderDashboard() {
  const student = data.students[selectedStudentId];
  if (!student) { renderDashboardEmpty(); return; }
  const name = student.name || 'Unnamed student';
  const totalSeconds = student.sessionLogs.reduce((sum, l) => sum + l.durationSeconds, 0);
  const totalCards = student.sessionLogs.reduce((sum, l) => sum + l.cardsStudied, 0);
  const deckCount = student.decks.length + (student.libraryLinks ? student.libraryLinks.length : 0);

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
      <div class="dl-stat-card" style="background:var(--blue-tint);"><div class="num" style="color:var(--blue-dark);">${deckCount}</div><div class="lbl" style="color:var(--blue-dark);">Decks</div></div>
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

// Builds one merged { title, isLibrary, cards } section per deck the
// student is using — own decks AND any library decks they've added —
// so the status table shows everything in one place.
function buildStatusSections(student) {
  const ownSections = student.decks.map(d => ({ id: 'own:' + d.id, title: d.title, isLibrary: false, cards: d.cards }));
  const libSections = (student.libraryLinks || []).map(link => {
    const libDeck = (data.libraryDecks || []).find(d => d.id === link.libraryDeckId);
    if (!libDeck) return null;
    const cards = libDeck.cards.map(c => {
      const progress = link.progress[c.id] || Utils.defaultProgress();
      return { id: c.id, term: c.term, definition: c.definition, image: c.image || null, ...progress };
    });
    return { id: 'lib:' + libDeck.id, title: libDeck.title, isLibrary: true, cards };
  }).filter(Boolean);
  return [...ownSections, ...libSections];
}

let statusDeckFilter = null; // which deck's table is shown; reset when switching students

function renderStatusTab(student) {
  const container = document.getElementById('tab-content');
  const sections = buildStatusSections(student);
  if (sections.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No decks yet</h3><p>Nothing to show until they create or add a deck.</p></div>';
    return;
  }

  if (!statusDeckFilter || !sections.some(s => s.id === statusDeckFilter)) {
    statusDeckFilter = sections[0].id;
  }
  const activeSection = sections.find(s => s.id === statusDeckFilter);
  const labelMap = { green: 'Mastered', orange: 'Recently correct', red: 'Needs practice', new: 'Not studied yet' };

  const filterBarHtml = sections.map(s => `
    <button class="btn ${s.id === statusDeckFilter ? 'btn-primary' : 'btn-secondary'} btn-sm" data-status-deck="${s.id}">
      ${Utils.escapeHtml(s.title)}${s.isLibrary ? ' 📚' : ''} (${s.cards.length})
    </button>
  `).join('');

  const rows = activeSection.cards.map((card, ci) => {
    const status = Utils.cardStatus(card);
    return `
      <tr>
        <td>${ci + 1}</td>
        <td>${Utils.escapeHtml(card.term)}${card.image ? ' 🖼️' : ''}</td>
        <td class="muted">${Utils.escapeHtml(card.definition)}</td>
        <td><span class="badge badge-${status}">${labelMap[status]}</span></td>
        <td>${card.timesSeen}</td>
        <td>${card.timesCorrect}</td>
        <td>${Utils.formatDate(card.lastSeenAt)}</td>
        <td>${card.starred ? '★' : ''}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="row gap-sm" style="flex-wrap:wrap;">${filterBarHtml}</div>
    <div class="deck-section-title mt-md">
      <h3>${Utils.escapeHtml(activeSection.title)}</h3>
      ${activeSection.isLibrary ? '<span class="badge badge-purple">Library</span>' : ''}
      <span class="muted">(${activeSection.cards.length} cards)</span>
    </div>
    <table>
      <thead><tr><th>#</th><th>Term</th><th>Definition</th><th>Status</th><th>Seen</th><th>Correct</th><th>Last seen</th><th>★</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="muted">No cards in this deck.</td></tr>'}</tbody>
    </table>
  `;

  container.querySelectorAll('[data-status-deck]').forEach(btn => {
    btn.addEventListener('click', () => {
      statusDeckFilter = btn.dataset.statusDeck;
      renderStatusTab(student);
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Library — decks the teacher owns, shared with every student            */
/* ---------------------------------------------------------------------- */

function openLibrary() {
  viewMode = 'library';
  selectedStudentId = null;
  renderStudentList();
  renderLibraryManager();
}

function renderLibraryManager() {
  document.getElementById('library-nav-btn').classList.add('active');

  const area = document.getElementById('dashboard-area');
  area.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap; gap:10px;">
      <h1>Deck library</h1>
      <button class="btn btn-primary btn-sm" id="new-lib-deck-btn">+ New deck</button>
    </div>
    <p class="muted">Decks here are visible to every student. Editing one updates it for everyone studying it instantly — their own stars and scores stay theirs.</p>
    <div class="deck-grid" id="library-deck-grid" style="margin-top:18px;"></div>
  `;

  const grid = document.getElementById('library-deck-grid');
  const decks = data.libraryDecks || [];

  decks.forEach(deck => {
    const usedByCount = Object.values(data.students).filter(s =>
      (s.libraryLinks || []).some(l => l.libraryDeckId === deck.id)
    ).length;
    const tile = document.createElement('div');
    tile.className = 'deck-tile';
    tile.innerHTML = `
      <h3>${Utils.escapeHtml(deck.title)}</h3>
      <div class="deck-meta"><span>${deck.cards.length} cards</span><span>${usedByCount} student${usedByCount === 1 ? '' : 's'} using it</span></div>
    `;
    tile.addEventListener('click', () => openLibraryDeckEditor(deck.id));
    grid.appendChild(tile);
  });

  const newTile = document.createElement('button');
  newTile.className = 'deck-tile deck-tile-new';
  newTile.textContent = '+ New deck';
  newTile.addEventListener('click', () => openLibraryDeckEditor(null));
  grid.appendChild(newTile);

  if (decks.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = 'No library decks yet — create your first one above.';
    area.insertBefore(hint, document.getElementById('library-deck-grid'));
  }

  document.getElementById('new-lib-deck-btn').addEventListener('click', () => openLibraryDeckEditor(null));
}

function openLibraryDeckEditor(deckId) {
  isNewLibDeck = !deckId;
  if (deckId) {
    const original = data.libraryDecks.find(d => d.id === deckId);
    editingLibDeck = JSON.parse(JSON.stringify(original));
  } else {
    editingLibDeck = { id: Utils.genId('libdeck'), title: '', createdAt: Utils.nowIso(), cards: [] };
  }
  renderLibraryDeckEditorModal();
}

function renderLibraryDeckEditorModal() {
  openModal(`
    <h2>${isNewLibDeck ? 'New library deck' : 'Edit library deck'}</h2>
    <div class="field">
      <label>Deck title</label>
      <input type="text" id="lib-editor-title" value="${Utils.escapeHtml(editingLibDeck.title)}" placeholder="e.g. Mechanics — Forces" />
    </div>
    <div class="field">
      <label>Paste terms &amp; definitions — one per line: Term, then a Tab, then Definition</label>
      <p class="muted" style="margin:-4px 0 8px; font-size:13px;">Optionally add a second Tab followed by an image path (e.g. an image you've uploaded to an <span class="mono">images/</span> folder in your repo) to attach a picture to that card.</p>
      <textarea id="lib-editor-paste" placeholder="Newton's First Law&#9;An object stays at rest or moves uniformly unless acted on by a resultant force&#10;Mitochondria&#9;Produces energy for the cell&#9;images/mitochondria.png"></textarea>
      <div class="row mt-sm">
        <button class="btn btn-secondary btn-sm" id="lib-editor-import-btn">Add pasted cards</button>
        <button class="btn btn-ghost btn-sm" id="lib-editor-add-blank-btn">+ Add card manually</button>
      </div>
    </div>
    <div class="field">
      <label id="lib-editor-card-count-label">Cards (${editingLibDeck.cards.length})</label>
      <div id="lib-editor-card-list"></div>
    </div>
    <div class="modal-actions" style="justify-content:flex-start;">
      <button class="btn btn-primary" id="lib-editor-save-btn">Save deck</button>
      <button class="btn btn-ghost" id="lib-editor-cancel-btn">Cancel</button>
      ${!isNewLibDeck ? '<button class="btn btn-danger" id="lib-editor-delete-btn">Delete deck</button>' : ''}
    </div>
  `, true);

  renderLibEditorCardList();

  document.getElementById('lib-editor-cancel-btn').addEventListener('click', closeLibraryEditor);
  document.getElementById('lib-editor-import-btn').addEventListener('click', handleLibEditorImport);
  document.getElementById('lib-editor-add-blank-btn').addEventListener('click', () => {
    editingLibDeck.cards.push({ id: Utils.genId('card'), term: '', definition: '', image: null });
    renderLibEditorCardList();
  });
  document.getElementById('lib-editor-save-btn').addEventListener('click', handleLibEditorSave);
  const delBtn = document.getElementById('lib-editor-delete-btn');
  if (delBtn) delBtn.addEventListener('click', handleLibEditorDelete);
}

function closeLibraryEditor() {
  closeModal();
  renderLibraryManager();
}

function renderLibEditorCardList() {
  const list = document.getElementById('lib-editor-card-list');
  document.getElementById('lib-editor-card-count-label').textContent = `Cards (${editingLibDeck.cards.length})`;

  if (editingLibDeck.cards.length === 0) {
    list.innerHTML = '<p class="muted">No cards yet — paste some text above or add manually.</p>';
    return;
  }
  list.innerHTML = '';
  editingLibDeck.cards.forEach((card, i) => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.style.alignItems = 'flex-start';
    row.innerHTML = `
      <div style="flex:1;">
        <input type="text" data-i="${i}" data-field="term" value="${Utils.escapeHtml(card.term)}" placeholder="Term" />
      </div>
      <div style="flex:1;">
        <input type="text" data-i="${i}" data-field="definition" value="${Utils.escapeHtml(card.definition)}" placeholder="Definition" />
      </div>
      <div style="flex:1;">
        <input type="text" data-i="${i}" data-field="image" value="${Utils.escapeHtml(card.image || '')}" placeholder="Image path (optional), e.g. images/cell.png" />
        ${card.image ? `<img src="${Utils.escapeHtml(card.image)}" alt="" style="display:block; max-width:60px; max-height:60px; object-fit:cover; border-radius:6px; margin-top:6px;" onerror="this.style.display='none'" />` : ''}
      </div>
      <button class="btn-icon btn-ghost" data-del="${i}" title="Delete card">✕</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.i, 10);
      const field = e.target.dataset.field;
      editingLibDeck.cards[i][field] = field === 'image' ? (e.target.value.trim() || null) : e.target.value;
    });
    // Refresh thumbnails when the image field loses focus, rather than on every keystroke
    if (inp.dataset.field === 'image') {
      inp.addEventListener('blur', renderLibEditorCardList);
    }
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      editingLibDeck.cards.splice(parseInt(e.target.dataset.del, 10), 1);
      renderLibEditorCardList();
    });
  });
}

function handleLibEditorImport() {
  const textarea = document.getElementById('lib-editor-paste');
  const { cards, skipped } = Utils.parsePastedLibraryDeck(textarea.value);
  if (cards.length === 0) {
    showToast('No valid lines found — make sure each line has a Tab between term and definition.');
    return;
  }
  editingLibDeck.cards.push(...cards);
  textarea.value = '';
  renderLibEditorCardList();
  showToast(`Added ${cards.length} card${cards.length === 1 ? '' : 's'}.${skipped ? ' Skipped ' + skipped + ' line(s).' : ''}`);
}

async function handleLibEditorSave() {
  const title = document.getElementById('lib-editor-title').value.trim();
  if (!title) { showToast('Please give the deck a title.'); return; }
  editingLibDeck.title = title;
  editingLibDeck.cards = editingLibDeck.cards.filter(c => c.term.trim() || c.definition.trim());
  editingLibDeck.updatedAt = Utils.nowIso();

  if (!data.libraryDecks) data.libraryDecks = [];
  if (isNewLibDeck) {
    data.libraryDecks.push(editingLibDeck);
  } else {
    const idx = data.libraryDecks.findIndex(d => d.id === editingLibDeck.id);
    data.libraryDecks[idx] = editingLibDeck;
  }
  await persist();
  showToast('Library deck saved — every student studying it will see the update.');
  closeLibraryEditor();
}

async function handleLibEditorDelete() {
  if (!confirm("Delete this library deck for everyone? Students who added it will lose it (and their progress on it). This can't be undone.")) return;
  data.libraryDecks = data.libraryDecks.filter(d => d.id !== editingLibDeck.id);
  Object.values(data.students).forEach(s => {
    if (s.libraryLinks) s.libraryLinks = s.libraryLinks.filter(l => l.libraryDeckId !== editingLibDeck.id);
  });
  await persist();
  showToast('Library deck deleted.');
  closeLibraryEditor();
}
