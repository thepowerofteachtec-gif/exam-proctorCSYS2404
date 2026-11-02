# Standalone Proctored Exam Site

A self-contained exam website. Students click a plain link in Canvas, land on the site,
enter their name and student ID, and take a proctored multiple-choice exam. You watch every
attempt live and download results as a spreadsheet when it's done.

There is **no Canvas integration to set up** — the Canvas "link" is just an ordinary hyperlink
pointing at this site. Nothing to register, no keys, no admin access.

## What the student does
1. Clicks the exam link in Canvas.
2. Types their full name and student ID, then clicks **Start exam**.
3. Takes the exam (looks like a Canvas quiz: question list, timer, autosave, submit).
That's the whole student experience.

## What you do
- Watch the live dashboard at `/dashboard` (connection status, progress, risk score per student).
- Click any student for their full flag list and activity log; force-submit if needed.
- When finished, click **Download results (CSV)** to get every score and flag in a spreadsheet,
  then enter the grades into Canvas yourself.

## What is monitored (browser activity, runs silently)
Leaving the exam tab/window, pasting text (incl. large pastes — the clearest sign of outside
help or AI), copying, exiting fullscreen, opening developer tools, a second device on the same
attempt, network changes, suspiciously fast answers, and — after submission — students who share
the same wrong answers. Each raises a weighted flag on your dashboard. **Flags are evidence for
your review, never automatic accusations.** No tool can prove AI use; these behavioral signals
are what you weigh under your integrity process.

The exam states that activity is logged (required disclosure under Jamaica's Data Protection Act
and university policy), but the interface never reveals *what* is detected, so the deterrent value
holds. Keep that notice in place.

## Run it

### Try it on your own computer first
1. Install Node.js 22+ from nodejs.org.
2. Unzip this folder, open a terminal inside it, run `npm install`.
3. Run `npm start`, then open `http://localhost:3000` (take the exam) and
   `http://localhost:3000/dashboard` (password: `changeme-pilot`) in two tabs.

### Put it online for the real exam (free, no hosting account)
Same temporary-link method as before:
1. Rename `.env.example` to `.env`, set a real `INSTRUCTOR_PW`.
2. Download `cloudflared` (free Cloudflare tool) into this folder.
3. `npm start` in one terminal; in a second terminal run
   `cloudflared tunnel --url http://localhost:3000` (Mac: `./cloudflared ...`).
4. Copy the `https://...trycloudflare.com` link it prints.
5. In Canvas, add that link as a normal hyperlink / button named **"Access Exam"**. Done.
6. Open the same link + `/dashboard` in your browser to monitor.
Keep your laptop awake and online during the exam. The link changes each run, so paste a fresh
one into Canvas on exam day.

## Your exam
Edit `config/exam.json`: set `title`, `durationMinutes`, your `questions`, and optionally a
`passphrase` (a word you tell the class; leave `""` for no password). Set `shuffleQuestions` /
`shuffleOptions` to `true` to give each student a different order.

## Accommodations
Set `extra_minutes` for a student in the `students` table to grant extra time.

## Honest limits
- Students self-identify by typing a name and ID, so this trusts them not to impersonate. The
  optional passphrase stops the link being shared outside the class but not one student sitting
  for another. For higher assurance you'd move to the Canvas-login (LTI) version.
- Browser monitoring can't see a second phone or a person in the room. It raises the cost of
  cheating; it doesn't eliminate it.
- Results live in `data/exam.db` on the machine running it. Back up or export before deleting.

## Files
```
server.js             Express + Socket.io server, grading, auto-submit, CSV export
src/db.js             SQLite schema (built-in node:sqlite)
src/exam.js           Loads exam, per-student shuffle, grading, answer-free view
src/risk.js           Proctoring event weights and labels
config/exam.json      Your exam
public/start.html     Student entry (name + ID)
public/exam.html      Exam UI + silent monitoring
public/dashboard.html Live instructor dashboard + CSV export
```

## Works the same across browsers
Monitoring does not depend on any one browser's quirks:
- Live data travels over a connection that automatically falls back from WebSocket to ordinary
  HTTP when a browser or network blocks sockets, so the dashboard stays live everywhere.
- "Left the page" is detected three ways (visibility change, window blur, and a sendBeacon on
  page-hide) so tab switches, phone backgrounding, and tab closes are all caught — on Chrome,
  Safari, Firefox, Edge, Samsung Internet, and mobile browsers alike.
- Fullscreen-exit detection includes the vendor-prefixed names Safari and older browsers use.
- The developer-tools check runs on desktop only (it would false-positive on phone toolbars).
- The dashboard shows each student's **browser and device** and a **last-seen** time, so you can
  see at a glance what everyone is on and whether they're currently active.

## Seeing how students answered, and reporting

While the exam runs and after it ends, click any student on the dashboard to see:
- **Per-question answers** — what they chose on each question, next to the correct answer,
  with a ✓ or ✗ and the time they spent on that question.
- **Performance pattern** — accuracy, average time per question, how many they got correct in
  under five seconds, and a ✓/✗ strip across the whole exam. A run of fast correct answers is
  flagged ("answering well, very fast") as something to look at.
- **Answer similarity** — if a student shares many of the same *wrong* answers with another
  student, both are flagged with the other's name and the count of shared wrong answers.

Reports and exports (all instructor-only; students never see any of this):
- **Open full report** — a clean, printable per-student page (score, per-question breakdown,
  timing, flags, similarity). Use your browser's Print → Save as PDF to keep or share it.
- **Download all responses (CSV)** — one row per student per question (their answer, the correct
  answer, right/wrong, time) for analysis in Excel.
- **Download results (CSV)** (top of dashboard) — one row per student (score, percent, risk,
  flags) to enter grades into Canvas.
