/* =========================================================================
   STUDENT APP
   ========================================================================= */

let studentId = null;
let data = null;        // full payload: { students: { ... } }
let student = null;     // data.students[studentId]
let currentDeckId = null;
let isNewDeck = true;
let editingDeck = null;
let session = null;     // active study/deep-learn round, see startStudyRound()
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
/* Navigation / view helpers                                              */
/* ---------------------------------------------------------------------- */

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.nav === 'decks') renderDecksView();
      if (btn.dataset.nav === 'deepLearn') renderDeepLearnHome();
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

function deckStats(deck) {
  const total = deck.cards.length || 1;
  let green = 0, orange = 0, red = 0, neu = 0, starred = 0;
  deck.cards.forEach(c => {
    const s = Utils.cardStatus(c);
    if (s === 'green') green++; else if (s === 'orange') orange++; else if (s === 'red') red++; else neu++;
    if (c.starred) starred++;
  });
  return {
    starred,
    pctGreen: green / total * 100,
    pctOrange: orange / total * 100,
    pctRed: red / total * 100,
    pctNew: neu / total * 100
  };
}

function renderDecksView() {
  session = null;
  currentDeckId = null;
  showView('view-decks');
  setTopbarTitle('Your decks');

  document.getElementById('decks-empty-hint').style.display = student.decks.length === 0 ? 'block' : 'none';

  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';
  student.decks.forEach(deck => {
    const stats = deckStats(deck);
    const tile = document.createElement('div');
    tile.className = 'deck-tile';
    tile.innerHTML = `
      <h3>${Utils.escapeHtml(deck.title)}</h3>
      <div class="deck-meta"><span>${deck.cards.length} cards</span><span>★ ${stats.starred}</span></div>
      <div class="mastery-bar">
        <span style="width:${stats.pctGreen}%; background:var(--green);"></span>
        <span style="width:${stats.pctOrange}%; background:var(--orange);"></span>
        <span style="width:${stats.pctRed}%; background:var(--red);"></span>
        <span style="width:${stats.pctNew}%; background:var(--grey-tint);"></span>
      </div>`;
    tile.addEventListener('click', () => openDeckDetail(deck.id));
    grid.appendChild(tile);
  });

  const newTile = document.createElement('button');
  newTile.className = 'deck-tile deck-tile-new';
  newTile.textContent = '+ New deck';
  newTile.addEventListener('click', () => openDeckEditor(null));
  grid.appendChild(newTile);

  // Show published decks if any exist
  if (data.publishedDecks && data.publishedDecks.length > 0) {
    const pubSection = document.getElementById('published-decks-section');
    if (pubSection) {
      pubSection.innerHTML = '';
      const h3 = document.createElement('h3');
      h3.textContent = 'Published decks';
      h3.className = 'mt-lg';
      pubSection.appendChild(h3);
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Import any of these shared decks to your own collection.';
      pubSection.appendChild(p);
      const pubGrid = document.createElement('div');
      pubGrid.className = 'deck-grid';
      data.publishedDecks.forEach(pubDeck => {
        const alreadyImported = student.decks.some(d => d.id === pubDeck.id);
        const tile = document.createElement('div');
        tile.className = 'deck-tile';
        tile.innerHTML = `
          <h3>${Utils.escapeHtml(pubDeck.title)}</h3>
          <div class="deck-meta"><span>${pubDeck.cards.length} cards</span></div>
          <button class="btn btn-secondary btn-block mt-md" data-pub-id="${pubDeck.id}" ${alreadyImported ? 'disabled' : ''}>
            ${alreadyImported ? '✓ Imported' : 'Import deck'}
          </button>
        `;
        pubGrid.appendChild(tile);
      });
      pubSection.appendChild(pubGrid);
      pubGrid.querySelectorAll('[data-pub-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pubId = btn.dataset.pubId;
          const pubDeck = data.publishedDecks.find(d => d.id === pubId);
          if (!pubDeck) return;
          const imported = { id: pubDeck.id, title: pubDeck.title, createdAt: Utils.nowIso(), cards: JSON.parse(JSON.stringify(pubDeck.cards)) };
          student.decks.push(imported);
          await persist();
          renderDecksView();
          showToast(`Imported "${pubDeck.title}"`);
        });
      });
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Deck editor (create / edit)                                            */
/* ---------------------------------------------------------------------- */

function openDeckEditor(deckId) {
  isNewDeck = !deckId;
  if (deckId) {
    const original = student.decks.find(d => d.id === deckId);
    editingDeck = JSON.parse(JSON.stringify(original));
  } else {
    editingDeck = { id: Utils.genId('deck'), title: '', createdAt: Utils.nowIso(), cards: [] };
  }
  showView('view-deck-editor');
  setTopbarTitle(isNewDeck ? 'New deck' : 'Edit deck');
  renderDeckEditor();
}

function renderDeckEditor() {
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

function openDeckDetail(deckId) {
  currentDeckId = deckId;
  showView('view-deck-detail');
  const deck = student.decks.find(d => d.id === deckId);
  setTopbarTitle(deck.title);
  renderDeckDetail();
}

function renderDeckDetail() {
  const deck = student.decks.find(d => d.id === currentDeckId);
  const view = document.getElementById('view-deck-detail');
  const needsPractice = deck.cards.filter(c => Utils.cardStatus(c) === 'red').length;
  const starredCount = deck.cards.filter(c => c.starred).length;

  view.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="detail-back-btn">← All decks</button>
    <div class="row-between mt-md">
      <h1>${Utils.escapeHtml(deck.title)}</h1>
      <button class="btn btn-secondary btn-sm" id="detail-edit-btn">Edit deck</button>
    </div>
    <div class="row gap-sm mt-sm" style="flex-wrap:wrap;">
      <button class="btn btn-primary" id="study-all-btn" ${deck.cards.length === 0 ? 'disabled' : ''}>Study all (${deck.cards.length})</button>
      <button class="btn btn-secondary" id="study-starred-btn" ${starredCount === 0 ? 'disabled' : ''}>Study starred (${starredCount})</button>
      <button class="btn btn-secondary" id="study-needs-btn" ${needsPractice === 0 ? 'disabled' : ''}>Needs practice (${needsPractice})</button>
    </div>
    <h3 class="mt-lg">All cards</h3>
    <div id="detail-card-list"></div>
  `;

  const list = document.getElementById('detail-card-list');
  if (deck.cards.length === 0) {
    list.innerHTML = '<div class="empty-state"><h3>No cards in this deck yet</h3><p>Edit the deck to paste in some terms and definitions.</p></div>';
  } else {
    list.innerHTML = '';
    deck.cards.forEach(card => {
      const status = Utils.cardStatus(card);
      const row = document.createElement('div');
      row.className = 'card-row';
      row.innerHTML = `
        <span class="dot dot-${status}" title="${status}"></span>
        <span class="term">${Utils.escapeHtml(card.term)}</span>
        <span class="definition">${Utils.escapeHtml(card.definition)}</span>
        <button class="star-btn ${card.starred ? 'starred' : ''}" data-card="${card.id}" title="Star">★</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = deck.cards.find(c => c.id === btn.dataset.card);
        card.starred = !card.starred;
        await persist();
        renderDeckDetail();
      });
    });
  }

  document.getElementById('detail-back-btn').addEventListener('click', renderDecksView);
  document.getElementById('detail-edit-btn').addEventListener('click', () => openDeckEditor(deck.id));
  document.getElementById('study-all-btn').addEventListener('click', () =>
    startStudyRound(deck.cards.map(c => c.id), 'all', { type: 'study', returnTo: 'deckDetail' }));
  document.getElementById('study-starred-btn').addEventListener('click', () =>
    startStudyRound(deck.cards.filter(c => c.starred).map(c => c.id), 'starred', { type: 'study', returnTo: 'deckDetail' }));
  document.getElementById('study-needs-btn').addEventListener('click', () =>
    startStudyRound(deck.cards.filter(c => Utils.cardStatus(c) === 'red').map(c => c.id), 'needs', { type: 'study', returnTo: 'deckDetail' }));
}

/* ---------------------------------------------------------------------- */
/* Study engine (shared by Study mode + all Deep Learn flows)             */
/* ---------------------------------------------------------------------- */

function findCardById(cardId) {
  for (const deck of student.decks) {
    const card = deck.cards.find(c => c.id === cardId);
    if (card) return { card, deck };
  }
  return null;
}

function startStudyRound(cardIds, subtype, opts) {
  if (!cardIds || cardIds.length === 0) { showToast('No cards in this group yet.'); return; }
  ensureSessionActive();
  persist();
  session = {
    type: opts.type,
    subtype,
    returnTo: opts.returnTo,
    deepLearnAction: opts.deepLearnAction || null,
    cardIds: Utils.shuffle(cardIds),
    index: 0,
    wrongIds: [],
    flipped: false
  };
  showView('view-study');
  setTopbarTitle(session.type.startsWith('deepLearn') ? 'Deep Learn' : 'Studying');
  renderStudyCard();
}

function renderStudyCard() {
  if (session.index >= session.cardIds.length) { finishStudyRound(); return; }

  const cardId = session.cardIds[session.index];
  const found = findCardById(cardId);
  if (!found) { session.index++; renderStudyCard(); return; }
  const { card } = found;
  const isDeep = session.type.startsWith('deepLearn');
  const view = document.getElementById('view-study');

  view.innerHTML = `
    <div class="study-wrap">
      <div class="study-progress">
        <div class="progress-track"><div class="progress-fill" style="width:${(session.index / session.cardIds.length * 100)}%; ${isDeep ? 'background:var(--purple);' : ''}"></div></div>
        <div class="progress-label"><span>Card ${session.index + 1} of ${session.cardIds.length}</span><span>${session.wrongIds.length} to review again</span></div>
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

  document.getElementById('flip-card').addEventListener('click', () => {
    session.flipped = !session.flipped;
    renderStudyCard();
  });
  document.getElementById('mark-wrong-btn').addEventListener('click', () => answerCard(false));
  document.getElementById('mark-right-btn').addEventListener('click', () => answerCard(true));
  document.getElementById('study-star-btn').addEventListener('click', async () => {
    card.starred = !card.starred;
    await persist();
    renderStudyCard();
  });
  document.getElementById('end-round-btn').addEventListener('click', () => {
    if (confirm('End this round early? Your progress so far is already saved.')) finishStudyRound();
  });
}

async function answerCard(correct) {
  const cardId = session.cardIds[session.index];
  const { card } = findCardById(cardId);

  card.timesSeen++;
  card.lastSeenAt = Utils.nowIso();
  if (correct) {
    card.timesCorrect++;
    card.correctStreak++;
    card.lastResult = 'correct';
  } else {
    card.correctStreak = 0;
    card.lastResult = 'incorrect';
    session.wrongIds.push(cardId);
  }

  if (session.type.startsWith('deepLearn') && session.deepLearnAction !== 'recap') {
    applyDeepLearnResult(card, correct);
  }

  if (student.activeSession) student.activeSession.cardsStudied++;
  await persist();

  session.index++;
  session.flipped = false;
  renderStudyCard();
}

function applyDeepLearnResult(card, correct) {
  const dl = card.deepLearn;
  dl.lastReviewedAt = Utils.nowIso();
  if (correct) {
    const nextStage = dl.stage + 1;
    if (nextStage >= Utils.DEEP_LEARN_GRADUATE_STAGE) {
      dl.learned = true;
      dl.inDeepLearn = false;
      dl.nextReviewAt = null;
    } else {
      dl.stage = nextStage;
      dl.nextReviewAt = Utils.nextReviewIso(nextStage);
    }
  } else {
    dl.stage = 0;
    dl.nextReviewAt = Utils.nextReviewIso(0);
  }
}

function finishStudyRound() {
  const total = session.cardIds.length;
  const wrong = session.wrongIds.length;
  const correct = total - wrong;

  showView('view-summary');
  setTopbarTitle('Round complete');
  const view = document.getElementById('view-summary');
  view.innerHTML = `
    <div class="summary-box">
      <h1>Round complete 🎉</h1>
      <div class="summary-stat-row">
        <div class="summary-stat"><div class="num" style="color:var(--green)">${correct}</div><div class="lbl">Got it</div></div>
        <div class="summary-stat"><div class="num" style="color:var(--red)">${wrong}</div><div class="lbl">Still learning</div></div>
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
      const { type, deepLearnAction, returnTo, wrongIds } = session;
      session = { type, subtype: 'retry', returnTo, deepLearnAction, cardIds: Utils.shuffle(wrongIds), index: 0, wrongIds: [], flipped: false };
      showView('view-study');
      renderStudyCard();
    });
  }
  document.getElementById('summary-done-btn').addEventListener('click', () => {
    const returnTo = session.returnTo;
    session = null;
    if (returnTo === 'deepLearn') renderDeepLearnHome();
    else renderDeckDetail();
  });
}

/* ---------------------------------------------------------------------- */
/* Deep Learn home                                                        */
/* ---------------------------------------------------------------------- */

function ensureDeepLearnDay() {
  const today = Utils.todayKey();
  if (student.deepLearnSettings.dateKey !== today) {
    student.deepLearnSettings.dateKey = today;
    student.deepLearnSettings.introducedToday = 0;
  }
}

function renderDeepLearnHome() {
  session = null;
  ensureDeepLearnDay();
  showView('view-deep-learn');
  setTopbarTitle('Deep Learn');

  const allCards = student.decks.flatMap(d => d.cards);
  const notStarted = allCards.filter(c => !c.deepLearn.inDeepLearn && !c.deepLearn.learned);
  const dueNow = allCards.filter(c => c.deepLearn.inDeepLearn && !c.deepLearn.learned && c.deepLearn.nextReviewAt && new Date(c.deepLearn.nextReviewAt) <= new Date());
  const learned = allCards.filter(c => c.deepLearn.learned);

  const target = student.deepLearnSettings.dailyNewCardTarget;
  const introduced = student.deepLearnSettings.introducedToday || 0;
  const remainingToday = target ? Math.max(0, target - introduced) : 0;
  const availableNew = Math.min(remainingToday, notStarted.length);

  const view = document.getElementById('view-deep-learn');
  view.innerHTML = `
    <h1>Deep Learn</h1>
    <p class="muted">Learn a handful of new cards each day, then come back throughout the day to lock them in.</p>

    <div class="dl-stat-grid">
      <div class="dl-stat-card"><div class="num">${introduced}${target ? '/' + target : ''}</div><div class="lbl">New today</div></div>
      <div class="dl-stat-card"><div class="num">${dueNow.length}</div><div class="lbl">Due now</div></div>
      <div class="dl-stat-card"><div class="num">${learned.length}</div><div class="lbl">Learned</div></div>
    </div>

    <div class="dl-action-list">
      <div class="dl-action">
        <div>
          <div class="ti">Learn new cards</div>
          <div class="sub">${target ? `${availableNew} ready to introduce today` : "Set how many you'd like to learn today"}</div>
        </div>
        <div class="row gap-sm">
          ${target ? `<button class="btn btn-ghost btn-sm" id="increase-target-btn">+ Add more today</button>` : ''}
          <button class="btn btn-purple" id="learn-new-btn" ${(target && availableNew === 0) ? 'disabled' : ''}>${target ? 'Start' : 'Set up'}</button>
        </div>
      </div>
      <div class="dl-action">
        <div>
          <div class="ti">Review due cards</div>
          <div class="sub">${dueNow.length} card${dueNow.length === 1 ? '' : 's'} ready right now</div>
        </div>
        <button class="btn btn-purple" id="review-due-btn" ${dueNow.length === 0 ? 'disabled' : ''}>Start</button>
      </div>
      <div class="dl-action">
        <div>
          <div class="ti">Review previously learnt</div>
          <div class="sub">${learned.length} card${learned.length === 1 ? '' : 's'} learnt so far — recap any time</div>
        </div>
        <button class="btn btn-secondary" id="review-learned-btn" ${learned.length === 0 ? 'disabled' : ''}>Start</button>
      </div>
    </div>
  `;

  document.getElementById('learn-new-btn').addEventListener('click', () => {
    if (!target) { promptDailyTarget(true); return; }
    const pool = Utils.shuffle(notStarted).slice(0, availableNew).map(c => c.id);
    pool.forEach(id => {
      const { card } = findCardById(id);
      card.deepLearn.inDeepLearn = true;
      card.deepLearn.addedAt = Utils.nowIso();
      card.deepLearn.stage = 0;
      card.deepLearn.nextReviewAt = Utils.nowIso();
    });
    student.deepLearnSettings.introducedToday = introduced + pool.length;
    persist();
    startStudyRound(pool, 'new', { type: 'deepLearnNew', returnTo: 'deepLearn' });
  });

  const incBtn = document.getElementById('increase-target-btn');
  if (incBtn) incBtn.addEventListener('click', () => promptDailyTarget(false));

  document.getElementById('review-due-btn').addEventListener('click', () =>
    startStudyRound(dueNow.map(c => c.id), 'due', { type: 'deepLearnDue', returnTo: 'deepLearn' }));
  document.getElementById('review-learned-btn').addEventListener('click', () =>
    startStudyRound(learned.map(c => c.id), 'recap', { type: 'deepLearnReview', returnTo: 'deepLearn', deepLearnAction: 'recap' }));
}

function promptDailyTarget(isFirstTime) {
  const current = student.deepLearnSettings.dailyNewCardTarget;
  const suggestion = isFirstTime ? 10 : (current || 10) + 5;
  openModal(`
    <h2>${isFirstTime ? 'How many new cards today?' : "Add more cards to today's goal"}</h2>
    <p class="muted">${isFirstTime ? "You can always add more later in the day." : `Currently learning ${current} new cards today.`}</p>
    <div class="field">
      <label>${isFirstTime ? 'New cards today' : "New total for today"}</label>
      <input type="number" id="target-input" min="1" max="200" value="${suggestion}" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="target-cancel-btn">Cancel</button>
      <button class="btn btn-purple" id="target-confirm-btn">Confirm</button>
    </div>
  `);
  document.getElementById('target-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('target-confirm-btn').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('target-input').value, 10);
    if (!val || val < 1) { showToast('Enter a number of at least 1.'); return; }
    if (!isFirstTime && current && val < current) { showToast(`Can't go below today's current target of ${current}.`); return; }
    student.deepLearnSettings.dailyNewCardTarget = val;
    await persist();
    closeModal();
    renderDeepLearnHome();
  });
}
