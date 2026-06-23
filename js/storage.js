/* =========================================================================
   STORAGE
   Single source of truth is one JSON "bin" on JSONBin.io shaped like:
   { "students": { "<studentId>": { decks, deepLearnSettings, sessionLogs,
                                     activeSession } } }

   Every load fetches the whole bin; every save writes the whole bin back.
   This is simple and fine for one tutor with a handful of students, but it
   means two simultaneous writes (e.g. student studying while teacher has
   the dashboard open) could clobber each other. For this use-case that risk
   is low, but worth knowing about.

   If JSONBin isn't configured (see config.js), everything still works
   using localStorage only, on that one device/browser.
   ========================================================================= */

const Storage = (() => {
  const LOCAL_KEY = 'flashcard_tracker_data_v1';

  function emptyData() {
    return { students: {}, publishedDecks: [] };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : emptyData();
    } catch (e) {
      console.warn('Could not read local data, starting fresh.', e);
      return emptyData();
    }
  }

  function saveLocal(data) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not write local data.', e);
    }
  }

  function isConfigured() {
    return Boolean(
      CONFIG.JSONBIN_BIN_ID &&
      CONFIG.JSONBIN_API_KEY &&
      CONFIG.JSONBIN_BIN_ID !== 'YOUR_BIN_ID_HERE' &&
      CONFIG.JSONBIN_API_KEY !== 'YOUR_API_KEY_HERE'
    );
  }

  async function fetchRemote() {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${CONFIG.JSONBIN_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': CONFIG.JSONBIN_API_KEY }
    });
    if (!res.ok) throw new Error('JSONBin fetch failed: ' + res.status);
    const json = await res.json();
    return json.record || emptyData();
  }

  async function saveRemote(data) {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${CONFIG.JSONBIN_BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': CONFIG.JSONBIN_API_KEY
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('JSONBin save failed: ' + res.status);
    return true;
  }

  // Loads the freshest data available. Always also returns a `synced` flag
  // so the UI can show a small "offline / not synced" indicator if needed.
  async function loadAll() {
    if (isConfigured()) {
      try {
        const remote = await fetchRemote();
        saveLocal(remote);
        return { data: remote, synced: true };
      } catch (e) {
        console.warn('Falling back to local data (could not reach JSONBin):', e);
      }
    }
    return { data: loadLocal(), synced: false };
  }

  async function saveAll(data) {
    saveLocal(data);
    if (isConfigured()) {
      try {
        await saveRemote(data);
        return true;
      } catch (e) {
        console.warn('Remote save failed, kept locally only:', e);
        return false;
      }
    }
    return true;
  }

  function ensureStudent(data, studentId) {
    if (!data.students[studentId]) {
      data.students[studentId] = {
        name: null, // will be set by teacher in the dashboard
        decks: [],
        deepLearnSettings: { dailyNewCardTarget: null, dateKey: null, introducedToday: 0 },
        sessionLogs: [],
        activeSession: null
      };
    }
    return data.students[studentId];
  }

  return { loadAll, saveAll, isConfigured, ensureStudent, emptyData };
})();
