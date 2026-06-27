/* =========================================================================
   UTILS — shared helpers used by both the student and teacher apps.
   ========================================================================= */

const Utils = (() => {

  function genId(prefix, len = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return prefix ? `${prefix}_${id}` : id;
  }

  function nowIso() { return new Date().toISOString(); }

  function todayKey() { return dateKeyFromDate(new Date()); }

  function dateKeyFromDate(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function dateKeyFromIso(iso) {
    return iso ? dateKeyFromDate(new Date(iso)) : null;
  }

  // Date key for "today + N days" (N can be 0).
  function dateKeyOffset(daysFromToday) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return dateKeyFromDate(d);
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ---- Deep learn spaced-repetition schedule ----
  // Stage index -> days until next review, counted from the review that
  // just happened. After the last stage, it keeps repeating every 28 days
  // forever (no "graduation" — cards stay in rotation indefinitely).
  // Getting a card wrong resets it straight back to stage 0 (1 day).
  const DEEP_LEARN_INTERVALS_DAYS = [1, 2, 4, 7, 10, 14, 21, 28];

  function nextReviewIso(stage) {
    const idx = Math.min(stage, DEEP_LEARN_INTERVALS_DAYS.length - 1);
    const days = DEEP_LEARN_INTERVALS_DAYS[idx];
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  // ---- Mastery status used for colour-coding (teacher table + student dots) ----
  // 'new'      -> never studied (grey)
  // 'red'      -> got it wrong last time
  // 'orange'   -> got it right last time, but not on a streak yet
  // 'green'    -> got it right multiple times in a row, most recently
  function cardStatus(card) {
    if (!card.lastResult) return 'new';
    if (card.lastResult === 'incorrect') return 'red';
    return card.correctStreak >= 2 ? 'green' : 'orange';
  }

  function newCard(term, definition) {
    return {
      id: genId('card'),
      term,
      definition,
      starred: false,
      timesSeen: 0,
      timesCorrect: 0,
      correctStreak: 0,
      lastResult: null,
      lastSeenAt: null,
      deepLearn: {
        inDeepLearn: false,
        learned: false,
        stage: 0,
        nextReviewAt: null,
        addedAt: null,
        lastReviewedAt: null
      }
    };
  }

  // Same shape as newCard's progress fields, minus term/definition — used
  // for a student's per-card progress on a library deck (content lives
  // separately in the library deck itself).
  function defaultProgress() {
    return {
      starred: false,
      timesSeen: 0,
      timesCorrect: 0,
      correctStreak: 0,
      lastResult: null,
      lastSeenAt: null,
      deepLearn: {
        inDeepLearn: false,
        learned: false,
        stage: 0,
        nextReviewAt: null,
        addedAt: null,
        lastReviewedAt: null
      }
    };
  }

  // Parses pasted "Term<TAB>Definition" lines (one pair per line).
  // Returns { cards, skipped } — skipped = lines that had no tab character.
  function parsePastedDeck(text) {
    const lines = text.split(/\r?\n/);
    const cards = [];
    let skipped = 0;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, ''); // trim trailing whitespace only
      if (!line.trim()) continue;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) { skipped++; continue; }
      const term = line.slice(0, tabIdx).trim();
      const definition = line.slice(tabIdx + 1).trim();
      if (term && definition) {
        cards.push(newCard(term, definition));
      } else {
        skipped++;
      }
    }
    return { cards, skipped };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return {
    genId, nowIso, todayKey, dateKeyFromIso, dateKeyOffset, formatDuration, formatDate, formatDateTime, formatTime,
    nextReviewIso, cardStatus, newCard, defaultProgress, parsePastedDeck, escapeHtml, shuffle,
    DEEP_LEARN_INTERVALS_DAYS
  };
})();
