/* =========================================================================
   STUDENT APP

   Two kinds of deck a student can study:
   - "own"     decks the student created themselves (content + progress
               live together on the same card object, as before)
   - "library" decks the teacher created. Content lives once, centrally,
               in data.libraryDecks. Each student's progress on a library
               deck (stars, scores, deep-learn stage) lives separately in
               student.libraryLinks, keyed by card id — so editing the
               deck never wipes anyone's progress, and students never
               affect each other's stats on a shared deck.

   Everywhere in the study engine, a "ref" is { type: 'own'|'library', id }
   identifying which deck a card belongs to.
   ========================================================================= */

let studentId = null;
let data = null;          // full payload: { students: {...}, libraryDecks: [...] }
let student = null;       // data.students[studentId]
let currentDeckRef = null;
let isNewDeck = true;
let editingDeck = null;
let session = null;       // active study/deep-learn round, see startStudyRound()
let timerInterval = null;
let toastTimeout = null;

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', () => {
  if (data) Storage.saveAll(data); // best-effort sync save on tab close
});

async function init() {
  studentId = new URLSearchParams(window.location.search).get('id');
  if (!studentId) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('no-id-screen').style.display = 'flex';
    return;
  }

  const loaded = await Storage.loadAll();
  data = loaded.data;
  student = Storage.ensureStudent(data, studentId);
  autoCloseStaleSession();

  document.getElementById('student-id-label').textContent = 'ID: ' + studentId;
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  setupNav();
  setupSessionButton();
  setupModalDismiss();
  updateSessionUI();
  if (student.activeSession) startTimerTick();

  renderDecksView();
  await persist(); // write back any auto-close / new-student record
}

function autoCloseStaleSession() {
  if (!student.activeSession) return;
  const startedMs = new Date(student.activeSession.startedAt).getTime();
  const hoursOpen = (Date.now() - startedMs) / 3600000;
  if (hoursOpen > CONFIG.SESSION_AUTO_CLOSE_HOURS) {
    finalizeSession(true);
  }
}

/* ---------------------------------------------------------------------- */
/* Persistence helpers                                                    */
/* ---------------------------------------------------------------------- */

async function persist() {
  try { await Storage.saveAll(data); } catch (e) { console.warn('Save failed', e); }
}

/* ---------------------------------------------------------------------- */
/* Deck / progress abstraction (own decks + library decks)                */
/* ---------------------------------------------------------------------- */

function getOwnDeck(id) { return student.decks.find(d => d.id === id) || null; }
function getLibraryDeck(id) { return (data.libraryDecks || []).find(d => d.id === id) || null; }

function getLibraryLink(libraryDeckId, createIfMissing) {
  let link = student.libraryLinks.find(l => l.libraryDeckId === libraryDeckId);
  if (!link && createIfMissing) {
    link = { libraryDeckId, addedAt: Utils.nowIso(), progress: {} };
    student.libraryLinks.push(link);
  }
  return link || null;
}

// Live, mutable progress object for a card under a given ref. For "own"
// decks this IS the card object itself. For "library" decks it's an entry
// in the student's own libraryLinks (auto-created on first touch).
function getProgress(ref, cardId) {
  if (ref.type === 'own') {
    const deck = getOwnDeck(ref.id);
    return deck ? deck.cards.find(c => c.id === cardId) || null : null;
  }
  const link = getLibraryLink(ref.id, true);
  if (!link.progress[cardId]) link.progress[cardId] = Utils.defaultProgress();
  return link.progress[cardId];
}

// Read-only { term, definition } for a card under a given ref.
function getContent(ref, cardId) {
  const deck = ref.type === 'own' ? getOwnDeck(ref.id) : getLibraryDeck(ref.id);
  const card = deck && deck.cards.find(c => c.id === cardId);
  return card ? { term: card.term, definition: card.definition, image: card.image || null } : null;
}

// Merged view for rendering/studying: content + this student's progress + ref.
function mergedCard(ref, cardId) {
  const content = getContent(ref, cardId);
  if (!content) return null;
  const progress = getProgress(ref, cardId);
  if (!progress) return null;
  return { id: cardId, term: content.term, definition: content.definition, image: content.image, ...progress, ref };
}

// { id, title, isLibrary, ref, cardIds }
function getDeckView(ref) {
  const deck = ref.type === 'own' ? getOwnDeck(ref.id) : getLibraryDeck(ref.id);
  if (!deck) return null;
  return { id: deck.id, title: deck.title, isLibrary: ref.type === 'library', ref, cardIds: deck.cards.map(c => c.id) };
}

function getDeckCards(ref) {
  const view = getDeckView(ref);
  if (!view) return [];
  return view.cardIds.map(id => mergedCard(ref, id)).filter(Boolean);
}

/* ---------------------------------------------------------------------- */
/* Navigation / view helpers                                              */
/* ---------------------------------------------------------------------- */

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.nav === 'decks') renderDecksView();
    });
  });
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setTopbarTitle(text) {
  document.getElementById('topbar-title').textContent = text;
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
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------------------------------------------------------------- */
/* Session (start / end / timer)                                          */
/* ---------------------------------------------------------------------- */

function setupSessionButton() {
  document.getElementById('session-toggle-btn').addEventListener('click', async () => {
    if (student.activeSession) {
      finalizeSession(false);
      stopTimerTick();
      await persist();
      updateSessionUI();
      showToast('Session saved to your log.');
    } else {
      student.activeSession = { startedAt: Utils.nowIso(), cardsStudied: 0 };
      await persist();
      startTimerTick();
      updateSessionUI();
      showToast('Session started — good luck!');
    }
  });
}

function ensureSessionActive() {
  if (!student.activeSession) {
    student.activeSession = { startedAt: Utils.nowIso(), cardsStudied: 0 };
    startTimerTick();
    updateSessionUI();
    showToast('Session started automatically so your tutor can see your progress.');
  }
}

function finalizeSession(autoClosed) {
  if (!student.activeSession) return;
  const s = student.activeSession;
  const endedAt = Utils.nowIso();
  const durationSeconds = Math.round((new Date(endedAt) - new Date(s.startedAt)) / 1000);
  student.sessionLogs.push({
    id: Utils.genId('log'),
    startedAt: s.startedAt,
    endedAt,
    durationSeconds,
    cardsStudied: s.cardsStudied,
    autoClosed: Boolean(autoClosed)
  });
  student.activeSession = null;
}

function updateSessionUI() {
  const btn = document.getElementById('session-toggle-btn');
  const timer = document.getElementById('session-timer');
  if (student.activeSession) {
    btn.textContent = 'End session';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    timer.classList.add('live');
  } else {
    btn.textContent = 'Start session';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-danger');
    timer.classList.remove('live');
    timer.textContent = '';
  }
}

function startTimerTick() {
  stopTimerTick();
  timerInterval = setInterval(() => {
    if (!student.activeSession) return;
    const secs = Math.round((Date.now() - new Date(student.activeSession.startedAt)) / 1000);
    document.getElementById('session-timer').textContent =
      `${Utils.formatDuration(secs)} · ${student.activeSession.cardsStudied} card${student.activeSession.cardsStudied === 1 ? '' : 's'}`;
  }, 1000);
}

function stopTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

/* ---------------------------------------------------------------------- */
/* Decks view                                                              */
/* ---------------------------------------------------------------------- */

function deckStats(ref) {
  const cards = getDeckCards(ref);
  const total = cards.length || 1;
  let green = 0, orange = 0, red = 0, neu = 0, starred = 0;
  cards.forEach(c => {
    const s = Utils.cardStatus(c);
    if (s === 'green') green++; else if (s === 'orange') orange++; else if (s === 'red') red++; else neu++;
    if (c.starred) starred++;
  });
  return {
    starred,
    count: cards.length,
    pctGreen: green / total * 100,
    pctOrange: orange / total * 100,
    pctRed: red / total * 100,
    pctNew: neu / total * 100
  };
}

function buildDeckTileInner(title, stats, badgeHtml) {
  return `
    ${badgeHtml || ''}
    <h3>${Utils.escapeHtml(title)}</h3>
    <div class="deck-meta"><span>${stats.count} cards</span><span>★ ${stats.starred}</span></div>
    <div class="mastery-bar">
      <span style="width:${stats.pctGreen}%; background:var(--green);"></span>
      <span style="width:${stats.pctOrange}%; background:var(--orange);"></span>
      <span style="width:${stats.pctRed}%; background:var(--red);"></span>
      <span style="width:${stats.pctNew}%; background:var(--grey-tint);"></span>
    </div>`;
}

function renderDecksView() {
  session = null;
  currentDeckRef = null;
  showView('view-decks');
  setTopbarTitle('Your decks');

  document.getElementById('decks-empty-hint').style.display = student.decks.length === 0 ? 'block' : 'none';

  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';
  student.decks.forEach(deck => {
    const ref = { type: 'own', id: deck.id };
    const tile = document.createElement('div');
    tile.className = 'deck-tile';
    tile.innerHTML = buildDeckTileInner(deck.title, deckStats(ref));
    tile.addEventListener('click', () => openDeckDetail(ref));
    grid.appendChild(tile);
  });

  const newTile = document.createElement('button');
  newTile.className = 'deck-tile deck-tile-new';
  newTile.textContent = '+ New deck';
  newTile.addEventListener('click', () => openDeckEditor(null));
  grid.appendChild(newTile);

  renderLibrarySection();
}

function renderLibrarySection() {
  const section = document.getElementById('library-decks-section');
  if (!section) return;
  const libraryDecks = data.libraryDecks || [];
  if (libraryDecks.length === 0) { section.innerHTML = ''; return; }

  section.innerHTML = `
    <h3 class="mt-lg">📚 Library decks</h3>
    <p class="muted">Decks your tutor has set up for you. Add one to start studying it — if your tutor updates it later, you'll see the changes automatically.</p>
    <div class="deck-grid" id="library-deck-grid"></div>
  `;
  const grid = document.getElementById('library-deck-grid');

  libraryDecks.forEach(deck => {
    const ref = { type: 'library', id: deck.id };
    const linked = Boolean(getLibraryLink(deck.id, false));
    const tile = document.createElement('div');
    tile.className = 'deck-tile';
    if (linked) {
      tile.innerHTML = buildDeckTileInner(deck.title, deckStats(ref), '<span class="badge badge-purple" style="margin-bottom:8px;">Library</span>');
      tile.addEventListener('click', () => openDeckDetail(ref));
    } else {
      tile.innerHTML = `
        <span class="badge badge-purple" style="margin-bottom:8px;">Library</span>
        <h3>${Utils.escapeHtml(deck.title)}</h3>
        <div class="deck-meta"><span>${deck.cards.length} cards</span></div>
        <button class="btn btn-secondary btn-block mt-md" data-add-lib="${deck.id}">+ Add to my decks</button>
      `;
    }
    grid.appendChild(tile);
  });

  grid.querySelectorAll('[data-add-lib]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.addLib;
      getLibraryLink(id, true);
      await persist();
      openDeckDetail({ type: 'library', id });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Deck editor (create / edit) — own decks only, library decks are         */
/* managed by the teacher.                                                */
/* ---------------------------------------------------------------------- */

function openDeckEditor(deckId) {
  isNewDeck = !deckId;
  if (deckId) {
    const original = student.decks.find(d => d.id === deckId);
    editingDeck = JSON.parse(JSON.stringify(original));
  } else {
    editingDeck = { id: Utils.genId('deck'), title: '', createdAt: Utils.nowIso(), cards: [] };
  }
  renderDeckEditor();
}

function renderDeckEditor() {
  showView('view-deck-editor');
  setTopbarTitle(isNewDeck ? 'New deck' : 'Edit deck');
  const view = document.getElementById('view-deck-editor');
  view.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="editor-back-btn">← Back</button>
    <h1 class="mt-md">${isNewDeck ? 'New deck' : 'Edit deck'}</h1>

    <div class="field">
      <label>Deck title</label>
      <input type="text" id="editor-title" value="${Utils.escapeHtml(editingDeck.title)}" placeholder="e.g. Mechanics — Forces" />
    </div>

    <div class="field">
      <label>Paste terms &amp; definitions — one per line: Term, then a Tab, then Definition</label>
      <textarea id="editor-paste" placeholder="Newton's First Law&#9;An object stays at rest or moves uniformly unless acted on by a resultant force"></textarea>
      <div class="row mt-sm">
        <button class="btn btn-secondary btn-sm" id="editor-import-btn">Add pasted cards</button>
        <button class="btn btn-ghost btn-sm" id="editor-add-blank-btn">+ Add card manually</button>
      </div>
    </div>

    <div class="field">
      <label id="editor-card-count-label">Cards (${editingDeck.cards.length})</label>
      <div id="editor-card-list"></div>
    </div>

    <div class="modal-actions" style="justify-content:flex-start;">
      <button class="btn btn-primary" id="editor-save-btn">Save deck</button>
      <button class="btn btn-ghost" id="editor-cancel-btn">Cancel</button>
      ${!isNewDeck ? '<button class="btn btn-danger" id="editor-delete-btn">Delete deck</button>' : ''}
    </div>
  `;

  renderEditorCardList();

  document.getElementById('editor-back-btn').addEventListener('click', renderDecksView);
  document.getElementById('editor-cancel-btn').addEventListener('click', renderDecksView);
  document.getElementById('editor-import-btn').addEventListener('click', handleEditorImport);
  document.getElementById('editor-add-blank-btn').addEventListener('click', () => {
    editingDeck.cards.push(Utils.newCard('', ''));
    renderEditorCardList();
  });
  document.getElementById('editor-save-btn').addEventListener('click', handleEditorSave);
  const delBtn = document.getElementById('editor-delete-btn');
  if (delBtn) delBtn.addEventListener('click', handleEditorDelete);
}

function renderEditorCardList() {
  const list = document.getElementById('editor-card-list');
  document.getElementById('editor-card-count-label').textContent = `Cards (${editingDeck.cards.length})`;

  if (editingDeck.cards.length === 0) {
    list.innerHTML = '<p class="muted">No cards yet — paste some text above or add manually.</p>';
    return;
  }
  list.innerHTML = '';
  editingDeck.cards.forEach((card, i) => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `
      <div style="flex:1;"><input type="text" data-i="${i}" data-field="term" value="${Utils.escapeHtml(card.term)}" placeholder="Term" /></div>
      <div style="flex:1;"><input type="text" data-i="${i}" data-field="definition" value="${Utils.escapeHtml(card.definition)}" placeholder="Definition" /></div>
      <button class="btn-icon btn-ghost" data-del="${i}" title="Delete card">✕</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.i, 10);
      editingDeck.cards[i][e.target.dataset.field] = e.target.value;
    });
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      editingDeck.cards.splice(parseInt(e.target.dataset.del, 10), 1);
      renderEditorCardList();
    });
  });
}

function handleEditorImport() {
  const textarea = document.getElementById('editor-paste');
  const { cards, skipped } = Utils.parsePastedDeck(textarea.value);
  if (cards.length === 0) {
    showToast('No valid lines found — make sure each line has a Tab between term and definition.');
    return;
  }
  editingDeck.cards.push(...cards);
  textarea.value = '';
  renderEditorCardList();
  showToast(`Added ${cards.length} card${cards.length === 1 ? '' : 's'}.${skipped ? ' Skipped ' + skipped + ' line(s).' : ''}`);
}

async function handleEditorSave() {
  const title = document.getElementById('editor-title').value.trim();
  if (!title) { showToast('Please give the deck a title.'); return; }
  editingDeck.title = title;
  editingDeck.cards = editingDeck.cards.filter(c => c.term.trim() || c.definition.trim());

  if (isNewDeck) {
    student.decks.push(editingDeck);
  } else {
    const idx = student.decks.findIndex(d => d.id === editingDeck.id);
    student.decks[idx] = editingDeck;
  }
  await persist();
  showToast('Deck saved.');
  renderDecksView();
}

async function handleEditorDelete() {
  if (!confirm("Delete this deck and all its cards? This can't be undone.")) return;
  student.decks = student.decks.filter(d => d.id !== editingDeck.id);
  await persist();
  showToast('Deck deleted.');
  renderDecksView();
}

/* ---------------------------------------------------------------------- */
/* Deck detail (browse / star / launch study)                             */
/* ---------------------------------------------------------------------- */

let deckFilter = 'all'; // 'all' | 'starred' | 'needs' — which group is currently shown in deck detail

function openDeckDetail(ref) {
  currentDeckRef = ref;
  deckFilter = 'all';
  renderDeckDetail();
}

function renderDeckDetail() {
  const ref = currentDeckRef;
  const view = getDeckView(ref);
  if (!view) { renderDecksView(); return; }
  showView('view-deck-detail');
  setTopbarTitle(view.title);

  const cards = getDeckCards(ref);
  const starredCards = cards.filter(c => c.starred);
  const needsCards = cards.filter(c => Utils.cardStatus(c) === 'red');
  const filterMap = { all: cards, starred: starredCards, needs: needsCards };
  const filterHeadings = { all: 'All cards', starred: 'Starred cards', needs: 'Cards needing practice' };
  if (!filterMap[deckFilter]) deckFilter = 'all';
  const activeCards = filterMap[deckFilter];

  const detailView = document.getElementById('view-deck-detail');
  detailView.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="detail-back-btn">← All decks</button>
    <div class="row-between mt-md" style="flex-wrap:wrap; gap:10px;">
      <div>
        <h1 style="display:inline;">${Utils.escapeHtml(view.title)}</h1>
        ${view.isLibrary ? ' <span class="badge badge-purple">Library</span>' : ''}
        ${view.isLibrary ? '<p class="muted" style="margin:6px 0 0;">Managed by your tutor — your stars and scores are your own.</p>' : ''}
      </div>
      <div class="row gap-sm">
        ${view.isLibrary
          ? '<button class="btn btn-ghost btn-sm" id="detail-remove-lib-btn">Remove from my decks</button>'
          : '<button class="btn btn-secondary btn-sm" id="detail-edit-btn">Edit deck</button>'}
      </div>
    </div>

    <div class="row gap-sm mt-md" style="flex-wrap:wrap;">
      <button class="btn ${deckFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-filter="all">All (${cards.length})</button>
      <button class="btn ${deckFilter === 'starred' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-filter="starred">Starred (${starredCards.length})</button>
      <button class="btn ${deckFilter === 'needs' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-filter="needs">Needs practice (${needsCards.length})</button>
    </div>

    <div class="row gap-sm mt-sm" style="flex-wrap:wrap;">
      <button class="btn btn-primary" id="open-flashcards-btn" ${activeCards.length === 0 ? 'disabled' : ''}>📇 Flashcards</button>
      <button class="btn btn-purple" id="open-deep-learn-btn">🧠 Deep Learn</button>
    </div>

    <h3 class="mt-lg">${filterHeadings[deckFilter]}</h3>
    <div id="detail-card-list"></div>
  `;

  const list = document.getElementById('detail-card-list');
  if (activeCards.length === 0) {
    const msg = deckFilter === 'starred' ? 'Star some cards below to see them collected here.'
      : deckFilter === 'needs' ? "Nothing needs practice right now — nice work!"
      : (view.isLibrary ? 'Ask your tutor to add some cards to it.' : 'Edit the deck to paste in some terms and definitions.');
    list.innerHTML = `<div class="empty-state"><h3>No cards here</h3><p>${msg}</p></div>`;
  } else {
    list.innerHTML = '';
    activeCards.forEach(card => {
      const status = Utils.cardStatus(card);
      const row = document.createElement('div');
      row.className = 'card-row';
      row.innerHTML = `
        <span class="dot dot-${status}" title="${status}"></span>
        ${card.image ? `<img src="${Utils.escapeHtml(card.image)}" alt="" style="width:36px; height:36px; object-fit:cover; border-radius:6px; flex-shrink:0;" onerror="this.style.display='none'" />` : ''}
        <span class="term">${Utils.escapeHtml(card.term)}</span>
        <span class="definition">${Utils.escapeHtml(card.definition)}</span>
        <button class="star-btn ${card.starred ? 'starred' : ''}" data-card="${card.id}" title="Star">★</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const progress = getProgress(ref, btn.dataset.card);
        progress.starred = !progress.starred;
        await persist();
        renderDeckDetail();
      });
    });
  }

  document.getElementById('detail-back-btn').addEventListener('click', renderDecksView);
  const editBtn = document.getElementById('detail-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => openDeckEditor(ref.id));
  const removeBtn = document.getElementById('detail-remove-lib-btn');
  if (removeBtn) removeBtn.addEventListener('click', async () => {
    if (!confirm("Remove this deck from your list? Your progress on it will be lost, but it stays available in the library if you want to add it again.")) return;
    student.libraryLinks = student.libraryLinks.filter(l => l.libraryDeckId !== ref.id);
    await persist();
    renderDecksView();
  });

  detailView.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      deckFilter = btn.dataset.filter;
      renderDeckDetail();
    });
  });

  document.getElementById('open-flashcards-btn').addEventListener('click', () =>
    startStudyRound(activeCards.map(c => ({ ref: c.ref, cardId: c.id })), deckFilter, { type: 'study', returnTo: 'deckDetail' }));
  document.getElementById('open-deep-learn-btn').addEventListener('click', () => {
    deepLearnFilter = 'new';
    renderDeepLearnHome();
  });
}

/* ---------------------------------------------------------------------- */
/* Study engine (shared by Study mode + all Deep Learn flows)             */
/* `session.items` is an array of { ref, cardId } so a single round can   */
/* mix cards from several decks (own and/or library) at once.            */
/* ---------------------------------------------------------------------- */

let shufflePreference = false; // remembered across rounds for this visit; Quizlet-style toggle

function startStudyRound(items, subtype, opts) {
  if (!items || items.length === 0) { showToast('No cards in this group yet.'); return; }
  ensureSessionActive();
  persist();
  session = {
    type: opts.type,
    subtype,
    returnTo: opts.returnTo,
    orderedItems: items.slice(), // the deck's natural order, never mutated
    items: [],                   // current working order (history + remaining)
    shuffleOn: shufflePreference,
    index: 0,
    wrongItems: [],
    flipped: false
  };
  applyOrderToRemaining();
  showView('view-study');
  setTopbarTitle(session.type === 'deepLearn' ? 'Deep Learn' : 'Studying');
  renderStudyCard();
}

// Keeps already-answered cards exactly where they were (history shouldn't
// jump around) and reorders only the cards not yet seen: in original deck
// order if shuffle is off, or freshly shuffled if it's on.
function applyOrderToRemaining() {
  const itemKey = it => `${it.ref.type}:${it.ref.id}:${it.cardId}`;
  const seenSlice = session.items.slice(0, session.index);
  const seenKeys = new Set(seenSlice.map(itemKey));
  const notSeenInOrder = session.orderedItems.filter(it => !seenKeys.has(itemKey(it)));
  const remaining = session.shuffleOn ? Utils.shuffle(notSeenInOrder) : notSeenInOrder;
  session.items = [...seenSlice, ...remaining];
}

function toggleShuffle() {
  session.shuffleOn = !session.shuffleOn;
  shufflePreference = session.shuffleOn;
  applyOrderToRemaining();
  renderStudyCard();
}

function renderStudyCard() {
  if (session.index >= session.items.length) { finishStudyRound(); return; }

  const { ref, cardId } = session.items[session.index];
  const card = mergedCard(ref, cardId);
  if (!card) { session.index++; renderStudyCard(); return; }
  const isDeep = session.type === 'deepLearn';
  const view = document.getElementById('view-study');

  view.innerHTML = `
    <div class="study-wrap">
      <div class="study-progress">
        <div class="row-between" style="margin-bottom:6px;">
          <span></span>
          <button class="btn ${session.shuffleOn ? 'btn-purple' : 'btn-secondary'} btn-sm" id="shuffle-toggle-btn" title="Shuffle remaining cards">🔀 Shuffle: ${session.shuffleOn ? 'On' : 'Off'}</button>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${(session.index / session.items.length * 100)}%; ${isDeep ? 'background:var(--purple);' : ''}"></div></div>
        <div class="progress-label"><span>Card ${session.index + 1} of ${session.items.length}</span><span>${session.wrongItems.length} to review again</span></div>
      </div>
      <div class="flip-hint">Tap the card to flip it</div>
      <div class="flashcard-scene">
        <div class="flashcard ${session.flipped ? 'flipped' : ''} ${isDeep ? 'deep' : ''}" id="flip-card">
          <div class="flashcard-face flashcard-front">
            <span class="face-label">Term</span>
            <span class="face-text">${Utils.escapeHtml(card.term)}</span>
          </div>
          <div class="flashcard-face flashcard-back">
            <span class="face-label">Definition</span>
            ${card.image ? `<img src="${Utils.escapeHtml(card.image)}" alt="" style="max-width:100%; max-height:150px; object-fit:contain; border-radius:8px; margin-bottom:14px;" onerror="this.style.display='none'" />` : ''}
            <span class="face-text">${Utils.escapeHtml(card.definition)}</span>
          </div>
        </div>
      </div>
      <div class="study-actions">
        <button class="btn btn-danger btn-lg" id="mark-wrong-btn">Still learning</button>
        <button class="btn btn-success btn-lg" id="mark-right-btn">Got it</button>
      </div>
      <button class="star-toggle-inline ${card.starred ? 'starred' : ''}" id="study-star-btn">★ ${card.starred ? 'Starred' : 'Star this one'}</button>
    </div>
    <div class="row" style="justify-content:center; margin-top:18px;">
      <button class="btn btn-ghost btn-sm" id="end-round-btn">End round early</button>
    </div>
  `;

  document.getElementById('shuffle-toggle-btn').addEventListener('click', toggleShuffle);
  document.getElementById('flip-card').addEventListener('click', () => {
    session.flipped = !session.flipped;
    renderStudyCard();
  });
  document.getElementById('mark-wrong-btn').addEventListener('click', () => answerCard(false));
  document.getElementById('mark-right-btn').addEventListener('click', () => answerCard(true));
  document.getElementById('study-star-btn').addEventListener('click', async () => {
    const progress = getProgress(ref, cardId);
    progress.starred = !progress.starred;
    await persist();
    renderStudyCard();
  });
  document.getElementById('end-round-btn').addEventListener('click', () => {
    if (confirm('End this round early? Your progress so far is already saved.')) finishStudyRound();
  });
}

async function answerCard(correct) {
  const { ref, cardId } = session.items[session.index];
  const progress = getProgress(ref, cardId);

  progress.timesSeen++;
  progress.lastSeenAt = Utils.nowIso();
  if (correct) {
    progress.timesCorrect++;
    progress.correctStreak++;
    progress.lastResult = 'correct';
  } else {
    progress.correctStreak = 0;
    progress.lastResult = 'incorrect';
    session.wrongItems.push({ ref, cardId });
  }

  if (session.type === 'deepLearn') {
    applyDeepLearnResult(progress, correct);
  }

  if (student.activeSession) student.activeSession.cardsStudied++;
  await persist();

  session.index++;
  session.flipped = false;
  renderStudyCard();
}

// Day-based spaced repetition: 1, 2, 4, 7, 10, 14, 21, 28 days, then it
// keeps repeating every 28 days forever (no graduation). A wrong answer
// always resets straight back to the 1-day stage.
function applyDeepLearnResult(progress, correct) {
  const dl = progress.deepLearn;
  if (!dl.addedAt) dl.addedAt = Utils.nowIso(); // first-ever exposure to this card in Deep Learn
  dl.lastReviewedAt = Utils.nowIso();
  dl.inDeepLearn = true;
  if (correct) {
    dl.nextReviewAt = Utils.nextReviewIso(dl.stage); // interval for the stage just passed
    dl.stage = Math.min(dl.stage + 1, Utils.DEEP_LEARN_INTERVALS_DAYS.length - 1);
  } else {
    dl.stage = 0;
    dl.nextReviewAt = Utils.nextReviewIso(0);
  }
}

function finishStudyRound() {
  const seen = session.index;                  // cards actually answered
  const wrong = session.wrongItems.length;      // subset of seen
  const correct = seen - wrong;
  const notSeen = session.items.length - seen;  // only > 0 if ended early

  showView('view-summary');
  setTopbarTitle('Round complete');
  const view = document.getElementById('view-summary');
  view.innerHTML = `
    <div class="summary-box">
      <h1>Round complete 🎉</h1>
      <div class="summary-stat-row">
        <div class="summary-stat"><div class="num" style="color:var(--green)">${correct}</div><div class="lbl">Got it</div></div>
        <div class="summary-stat"><div class="num" style="color:var(--red)">${wrong}</div><div class="lbl">Still learning</div></div>
        ${notSeen > 0 ? `<div class="summary-stat"><div class="num" style="color:var(--text-faint)">${notSeen}</div><div class="lbl">Not seen</div></div>` : ''}
      </div>
      <div class="summary-actions">
        ${wrong > 0 ? `<button class="btn btn-primary btn-block" id="review-wrong-btn">Review the ${wrong} you got wrong</button>` : ''}
        <button class="btn btn-secondary btn-block" id="summary-done-btn">Done for now</button>
      </div>
      ${wrong > 0 ? '<p class="muted mt-md">If you skip this, those cards are saved and you can come back to them any time.</p>' : ''}
    </div>
  `;

  if (wrong > 0) {
    document.getElementById('review-wrong-btn').addEventListener('click', () => {
      const { type, returnTo, wrongItems } = session;
      session = {
        type, subtype: 'retry', returnTo,
        orderedItems: wrongItems.slice(),
        items: [],
        shuffleOn: shufflePreference,
        index: 0, wrongItems: [], flipped: false
      };
      applyOrderToRemaining();
      showView('view-study');
      renderStudyCard();
    });
  }
  document.getElementById('summary-done-btn').addEventListener('click', () => {
    const returnTo = session.returnTo;
    const deckRef = currentDeckRef;
    session = null;
    if (returnTo === 'deepLearnHome') renderDeepLearnHome();
    else openDeckDetail(deckRef);
  });
}

/* ---------------------------------------------------------------------- */
/* Deep Learn — a mode entered from within a single deck. Cards are        */
/* reviewed on a day-based spaced schedule (see Utils.DEEP_LEARN_INTERVALS_DAYS). */
/* ---------------------------------------------------------------------- */

// Slices a deck's cards into the 5 boxes shown on the Deep Learn page.
// "all" is every card, deliberately overlapping with the rest — the other
// four are independent lenses on the same schedule data, not a strict
// partition, since a card can genuinely be true for more than one (e.g.
// reviewed today AND next due tomorrow).
function deepLearnBuckets(ref) {
  const cards = getDeckCards(ref);
  const todayKey = Utils.todayKey();
  const tomorrowKey = Utils.dateKeyOffset(1);
  const twoDaysKey = Utils.dateKeyOffset(2);

  const today = cards.filter(c => {
    const reviewedToday = Utils.dateKeyFromIso(c.deepLearn.lastReviewedAt) === todayKey;
    const learntToday = Utils.dateKeyFromIso(c.deepLearn.addedAt) === todayKey;
    return reviewedToday || learntToday;
  });
  const tomorrow = cards.filter(c => Utils.dateKeyFromIso(c.deepLearn.nextReviewAt) === tomorrowKey);
  const twoDays = cards.filter(c => Utils.dateKeyFromIso(c.deepLearn.nextReviewAt) === twoDaysKey);
  // Everything else: never started, overdue, due today (not yet reviewed), or 3+ days out.
  const later = cards.filter(c => {
    const key = Utils.dateKeyFromIso(c.deepLearn.nextReviewAt);
    return key !== tomorrowKey && key !== twoDaysKey;
  });

  return { all: cards, today, tomorrow, twoDays, later };
}

let deepLearnFilter = 'all'; // 'all' | 'today' | 'tomorrow' | 'twoDays' | 'later'

function renderDeepLearnHome() {
  session = null;
  const ref = currentDeckRef;
  const view = getDeckView(ref);
  if (!view) { renderDecksView(); return; }
  showView('view-deep-learn');
  setTopbarTitle(`Deep Learn — ${view.title}`);

  const buckets = deepLearnBuckets(ref);
  if (!['all', 'today', 'tomorrow', 'twoDays', 'later'].includes(deepLearnFilter)) deepLearnFilter = 'all';

  const bucketHeadings = {
    all: 'All cards', today: 'Reviewed or learnt today', tomorrow: 'Due tomorrow',
    twoDays: 'Due in two days', later: 'Due later'
  };
  const emptyMessages = {
    all: 'This deck has no cards yet.',
    today: "You haven't reviewed or learnt anything from this deck yet today.",
    tomorrow: 'Nothing scheduled for tomorrow.',
    twoDays: 'Nothing scheduled for two days from now.',
    later: 'Nothing scheduled further out right now.'
  };
  const activeList = buckets[deepLearnFilter];
  const actionVerb = deepLearnFilter === 'all' ? 'Study' : 'Review';

  const dlView = document.getElementById('view-deep-learn');
  dlView.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="dl-back-btn">← ${Utils.escapeHtml(view.title)}</button>
    <h1 class="mt-md">Deep Learn</h1>
    <p class="muted">Cards are reviewed on a spaced schedule — 1, 2, 4, 7, 10, 14, 21 days, then every 28 days from there. Getting one wrong resets it back to 1 day.</p>

    <div class="row gap-sm mt-md" style="flex-wrap:wrap;">
      <button class="btn ${deepLearnFilter === 'all' ? 'btn-purple' : 'btn-secondary'} btn-sm" data-dl-filter="all">All (${buckets.all.length})</button>
      <button class="btn ${deepLearnFilter === 'today' ? 'btn-purple' : 'btn-secondary'} btn-sm" data-dl-filter="today">Today (${buckets.today.length})</button>
      <button class="btn ${deepLearnFilter === 'tomorrow' ? 'btn-purple' : 'btn-secondary'} btn-sm" data-dl-filter="tomorrow">Review tomorrow (${buckets.tomorrow.length})</button>
      <button class="btn ${deepLearnFilter === 'twoDays' ? 'btn-purple' : 'btn-secondary'} btn-sm" data-dl-filter="twoDays">Review in two days (${buckets.twoDays.length})</button>
      <button class="btn ${deepLearnFilter === 'later' ? 'btn-purple' : 'btn-secondary'} btn-sm" data-dl-filter="later">Review later (${buckets.later.length})</button>
    </div>

    <h3 class="mt-lg">${bucketHeadings[deepLearnFilter]}</h3>
    <div id="dl-card-list"></div>
    ${activeList.length > 0 ? `<button class="btn btn-purple btn-block mt-lg" id="dl-start-btn">${actionVerb} ${activeList.length === 1 ? 'this card' : `these ${activeList.length} cards`}</button>` : ''}
  `;

  const listEl = document.getElementById('dl-card-list');
  if (activeList.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><h3>No cards here</h3><p>${emptyMessages[deepLearnFilter]}</p></div>`;
  } else {
    listEl.innerHTML = activeList.map(c => `
      <div class="card-row">
        ${c.image ? `<img src="${Utils.escapeHtml(c.image)}" alt="" style="width:36px; height:36px; object-fit:cover; border-radius:6px; flex-shrink:0;" onerror="this.style.display='none'" />` : ''}
        <span class="term">${Utils.escapeHtml(c.term)}</span>
        <span class="definition">${Utils.escapeHtml(c.definition)}</span>
      </div>
    `).join('');
  }

  document.getElementById('dl-back-btn').addEventListener('click', () => openDeckDetail(ref));
  dlView.querySelectorAll('[data-dl-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      deepLearnFilter = btn.dataset.dlFilter;
      renderDeepLearnHome();
    });
  });
  const startBtn = document.getElementById('dl-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () =>
      startStudyRound(activeList.map(c => ({ ref: c.ref, cardId: c.id })), deepLearnFilter, { type: 'deepLearn', returnTo: 'deepLearnHome' }));
  }
}
