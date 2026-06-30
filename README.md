# Flashcard Tracker

A Quizlet-style flashcard site for tutoring, with a teacher dashboard that
tracks how long your student studies and how they're doing on every card.

## What's inside

```
flashcard-tracker/
  index.html        Simple landing page (links to teacher.html; students use their own link)
  student.html       The student-facing app
  teacher.html        Your PIN-protected dashboard
  css/styles.css       All styling
  js/config.js          ← edit this: JSONBin keys + your PIN
  js/storage.js          Data layer (JSONBin + localStorage fallback)
  js/utils.js              Shared helpers (id gen, dates, spaced-repetition timing)
  js/student-app.js          Student app logic
  js/teacher-app.js           Teacher dashboard logic
```

## 1. One-time setup (5 minutes)

**A. Cross-device sync (so you can see their progress from your own laptop/phone):**

1. Create a free account at **https://jsonbin.io**
2. Click **Create Bin**, paste this as the content, and save:
   ```json
   { "students": {} }
   ```
3. Copy the **Bin ID** (shown in the bin's URL) and your **X-Master-Key** (Account → API Keys).
4. Open `js/config.js` and paste them in:
   ```js
   JSONBIN_BIN_ID: 'paste-your-bin-id-here',
   JSONBIN_API_KEY: 'paste-your-x-master-key-here',
   ```

If you skip this, the site still works, but data only lives in the browser
it was created in — you wouldn't be able to see your student's progress
from your own device.

**B. Set your teacher PIN:**

In `js/config.js`, change:
```js
TEACHER_PIN: '1234',
```
to something only you know.

**C. Host it:**

Upload the whole `flashcard-tracker` folder anywhere that serves static
files (same place as your tutoring site, GitHub Pages, Netlify, etc.).

## 2. Adding your student

1. Go to `teacher.html`, enter your PIN.
2. Click **+ Add student**. This generates an anonymous ID and a personal
   link like `student.html?id=ab12cd34`.
3. Give that student a name — **this name is only ever saved in your own
   browser's local storage**, never sent to JSONBin or anywhere else. The
   shared data only ever contains the anonymous ID, so if anyone else got
   access to your JSONBin bin, they wouldn't see any names.
4. Copy the link and send it to your student. That link is their permanent
   way back into their own flashcards — there's no separate login.

If you ever open the teacher dashboard on a different browser/device, the
student will show up as "Unnamed student" until you name them there too
(the data is the same, just the label is local).

## 3. How decks work

There are two kinds of deck:

- **My decks (student-created)** — the student pastes in `Term [Tab] Definition`
  per line, or adds cards one at a time, fully under their own control.
- **Library decks (teacher-created)** — you create these from **Manage library**
  in the teacher dashboard. Every student can see and add them. If you edit
  a library deck's cards later, every student studying it sees the update
  immediately — but each student's own stars and scores on it are kept
  separate, so editing content never wipes anyone's progress, and two
  students on the same deck never affect each other's stats.

On the student side, library decks show up in a separate "📚 Library decks"
section underneath their own decks, with an **Add to my decks** button.
Once added, a library deck behaves just like normal for studying (browse,
star, Study mode, Deep Learn) — the only difference is they can't edit its
content, and they get a "Remove from my decks" option instead of "Edit deck"
(this only removes their own link + progress; the deck stays in the library
for everyone else).

## 4. How the rest of the student side works
  all cards, just the starred ones, or just the ones currently marked
  "needs practice" (got wrong last time). At the end of a round, if they
  got any wrong, they're offered an immediate re-test of just those — if
  they decline, those cards are still saved and they can come back to them
  later via "Needs practice".
- **Deep Learn** — a simple spaced-repetition mode:
  - They pick how many *new* cards to learn today (can increase the target
    later in the day, but not decrease it).
  - New cards are reviewed again after roughly 20 minutes, then 2 hours,
    6 hours, 1 day, 3 days, then 7 days — get one wrong at any point and it
    resets to the start of that cycle. After a correct answer at the final
    stage, a card "graduates" and moves into **Previously learnt**, which
    they can recap any time without affecting the schedule.
- **Sessions** — a "Start session" / "End session" button in the top bar.
  If they start studying without pressing it, a session starts
  automatically, so all study time is captured even if they forget. If a
  browser is closed mid-session, it auto-closes itself after 4 hours (you
  can change this in `config.js`) so it doesn't get stuck open forever.

## 5. How the teacher dashboard works

**Manage library** (top of the sidebar) is where you create/edit/delete
shared decks — paste import works the same way as on the student side.
Click any existing library deck to edit it; changes go out to every student
using it as soon as you save.

For each student you can see:
- **Session log** — every session with date, time, duration, and how many
  cards were covered (and whether it auto-closed, which is worth a quick
  follow-up question if it happens a lot).
- **Flashcard status** — every card in every deck, colour-coded:
  - 🟢 **Mastered** — correct multiple times in a row, most recently
  - 🟠 **Recently correct** — right last time, but not yet on a streak
  - 🔴 **Needs practice** — wrong last time they saw it
  - grey **Not studied yet**

## Limitations worth knowing about

- Data is stored as one JSON blob per use of this app. If you and your
  student are both actively using the site at the exact same moment, the
  last save wins — for one tutor and a handful of students this is a very
  low risk, but it's not built for many simultaneous users.
- JSONBin's free tier has request limits — fine for normal tutoring use,
  but worth knowing if you scale this up to many students.
- The PIN is a basic deterrent, not real security — anyone with the PIN
  (or who finds it in the page source if you're not careful sharing files)
  can see all students' data. Don't store anything more sensitive than
  study progress here.

## Possible future additions

- A "story" / mock-exam mode that pulls from multiple decks at once
- Export a student's progress to CSV
- Weekly digest of session logs

Let me know if you'd like any of these or want the deep-learn intervals
tuned differently.

# Images for flashcards

Drop any images you want to use on flashcards into this folder (or
subfolders inside it), then reference them by their path relative to the
repo root when creating/editing a card in the teacher dashboard's Manage
library section — for example:

```
images/cellwall.png
images/biology/mitochondria.jpg
```

You can either:

1. **Paste import with a 3rd column** — add a second Tab after the
   definition, followed by the image path:
   ```
   Cell wall<TAB>Rigid outer layer<TAB>images/cellwall.png
   ```
2. **Type it directly** into the "Image path" field on an individual card
   row in the deck editor — a small preview thumbnail will show up once
   the path is valid.

Images are stored as ordinary files in this repo (not inside the JSON
data), so they don't bloat your JSONBin storage and load just as fast as
any other file on your site.

This folder only matters for **library decks** (the ones you create as
the teacher) — student-created decks don't currently support images.
