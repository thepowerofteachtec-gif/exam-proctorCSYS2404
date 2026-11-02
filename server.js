const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./src/db');
const examMod = require('./src/exam');
const risk = require('./src/risk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const INSTRUCTOR_PW = process.env.INSTRUCTOR_PW || 'changeme-pilot';

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

const now = () => Date.now();
const clientIp = req => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
const newToken = () => crypto.randomBytes(24).toString('hex');
const slugId = s => String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').slice(0, 60);

// Turn any browser's user-agent string into a short human label for the dashboard,
// so you can see what each student is using regardless of browser.
function parseUA(ua = '') {
  ua = ua || '';
  let b = 'Unknown browser';
  if (/Edg\//.test(ua)) b = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) b = 'Opera';
  else if (/SamsungBrowser/.test(ua)) b = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) b = 'Firefox';
  else if (/CriOS/.test(ua)) b = 'Chrome';
  else if (/Chrome\//.test(ua)) b = 'Chrome';
  else if (/Safari\//.test(ua)) b = 'Safari';
  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? `${b} on ${os}` : b;
}

function getAttemptByToken(token) {
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  return db.prepare('SELECT * FROM attempts WHERE id = ?').get(s.attempt_id);
}
function durationMs(student) {
  return (examMod.exam.durationMinutes + (student.extra_minutes || 0)) * 60 * 1000;
}

// Create or resume an attempt from a plain name + student-id entry.
function startAttempt({ studentId, name, email, ip, ua }) {
  let student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    db.prepare('INSERT INTO students (id, name, email) VALUES (?, ?, ?)').run(studentId, name || studentId, email || null);
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  } else if (name && student.name !== name) {
    db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, studentId);
  }
  let attempt = db.prepare('SELECT * FROM attempts WHERE student_id = ? AND exam_id = ?').get(studentId, examMod.exam.id);
  if (attempt && attempt.status === 'submitted') {
    if (!examMod.exam.allowRetakes) return { done: true };
    // Practice retake: reset this attempt to a fresh one (new shuffle, clean slate).
    const order = examMod.buildOrder();
    const started = now();
    db.prepare(`UPDATE attempts SET status='in_progress', started_at=?, deadline=?, submitted_at=NULL,
      submit_reason=NULL, question_order=?, answers='{}', flags='[]', timings='{}', current_q=0,
      score=NULL, max_score=NULL, risk_score=0, last_seen=? WHERE id=?`)
      .run(started, started + durationMs(student), JSON.stringify(order), started, attempt.id);
    db.prepare('DELETE FROM events WHERE attempt_id = ?').run(attempt.id);
    attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
  }

  if (!attempt) {
    const order = examMod.buildOrder();
    const started = now();
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO attempts
      (id, student_id, exam_id, started_at, deadline, question_order, first_ip, last_ip, user_agent, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, studentId, examMod.exam.id, started, started + durationMs(student),
      JSON.stringify(order), ip, ip, ua, started);
    attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id);
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, attempt_id, created_at, ip) VALUES (?, ?, ?, ?)').run(token, attempt.id, now(), ip);
  return { done: false, token };
}

// ---- Student entry (name + id, optional class passphrase) ----
app.post('/start', (req, res) => {
  const name = (req.body.name || '').trim();
  const sid = (req.body.student_id || '').trim();
  const pass = (req.body.passphrase || '').trim();
  if (!name || !sid) return res.status(400).json({ error: 'Please enter your name and student ID.' });
  if (examMod.exam.passphrase && pass !== examMod.exam.passphrase)
    return res.status(401).json({ error: 'That exam password is not correct. Check with your instructor.' });
  const studentId = slugId(sid);
  if (!studentId) return res.status(400).json({ error: 'That student ID is not valid.' });
  const r = startAttempt({ studentId, name, ip: clientIp(req), ua: req.headers['user-agent'] || '' });
  if (r.done) return res.json({ done: true });
  res.json({ token: r.token });
});

// Page-exit beacon: sendBeacon posts here when a student backgrounds or closes
// the tab. Works in every modern browser even as the page unloads, when a live
// socket message might not get out. Keeps your monitoring complete regardless of browser.
app.post('/beacon', (req, res) => {
  const { token, type, qid } = req.body || {};
  const a = getAttemptByToken(token);
  if (a && a.status !== 'submitted' && (type === 'tab_blur' || type === 'page_hide')) {
    recordEvent(a, 'tab_blur', { via: 'beacon', kind: type }, qid);
  }
  res.status(204).end();
});

// Reliable submit over plain HTTP (does not depend on the live connection).
// Carries the student's answers as a safety net, then grades and returns the result.
app.post('/submit', (req, res) => {
  const { token, answers } = req.body || {};
  const a = getAttemptByToken(token);
  if (!a) return res.status(401).json({ error: 'Session expired.' });
  if (a.status === 'submitted') {
    return res.json({ done: true, allowRetakes: !!examMod.exam.allowRetakes,
      ...(examMod.exam.showScore ? { score: a.score, max: a.max_score } : {}) });
  }
  if (answers && typeof answers === 'object') {
    const cur = JSON.parse(a.answers);
    for (const [qid, val] of Object.entries(answers)) if (examMod.byId.has(qid)) cur[qid] = val;
    db.prepare('UPDATE attempts SET answers = ? WHERE id = ?').run(JSON.stringify(cur), a.id);
  }
  finalizeAttempt(a.id, 'student');
  const fresh = getAttemptByToken(token);
  const payload = { allowRetakes: !!examMod.exam.allowRetakes };
  if (examMod.exam.showScore && fresh) { payload.score = fresh.score; payload.max = fresh.max_score; }
  res.json(payload);
  pushOverview();
});

app.get('/config', (_, res) => res.json({
  title: examMod.exam.title,
  needsPassphrase: !!examMod.exam.passphrase,
  durationMinutes: examMod.exam.durationMinutes,
  totalQuestions: examMod.questionCount(),
  instructions: examMod.exam.instructions,
  isPractice: !!examMod.exam.allowRetakes
}));

// ---- Exam data for the student client ----
app.get('/api/exam', (req, res) => {
  const attempt = getAttemptByToken(req.query.s);
  if (!attempt) return res.status(401).json({ error: 'Session expired.' });
  if (attempt.status === 'submitted') return res.json({ submitted: true });
  const order = JSON.parse(attempt.question_order);
  res.json({
    examTitle: examMod.exam.title,
    instructions: examMod.exam.instructions,
    questions: examMod.publicView(order),
    answers: JSON.parse(attempt.answers),
    currentQ: attempt.current_q,
    deadline: attempt.deadline,
    serverTime: now()
  });
});

// ---- Instructor auth ----
const instructorTokens = new Set([process.env.INSTRUCTOR_TOKEN || 'dev-instructor']);
app.post('/api/instructor/login', (req, res) => {
  if (req.body.password !== INSTRUCTOR_PW) return res.status(401).json({ error: 'Wrong password.' });
  const t = newToken(); instructorTokens.add(t); res.json({ token: t });
});
function requireInstructor(req, res, next) {
  const t = req.query.t || req.headers['x-instructor'];
  if (!instructorTokens.has(t)) return res.status(401).json({ error: 'Not authorized.' });
  next();
}

app.get('/api/instructor/overview', requireInstructor, (_, res) => res.json(buildOverview()));
app.get('/api/instructor/attempt/:id', requireInstructor, (req, res) => {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(a.student_id);
  const events = db.prepare("SELECT ts, type, qid, detail, weight FROM events WHERE attempt_id = ? AND type != 'answer' ORDER BY ts").all(a.id);
  const review = buildReview(a);
  res.json({
    attempt: serializeAttempt(a, student),
    review,
    pattern: performancePattern(review),
    events: events.map(e => ({ ...e, label: risk.label(e.type) }))
  });
});
app.post('/api/instructor/force-submit/:id', requireInstructor, (req, res) => {
  finalizeAttempt(req.params.id, 'instructor'); res.json({ ok: true }); pushOverview();
});

// ---- Results export (replaces Canvas grade passback) ----
app.get('/api/instructor/export.csv', requireInstructor, (_, res) => {
  const rows = db.prepare('SELECT * FROM attempts WHERE exam_id = ? ORDER BY student_id').all(examMod.exam.id);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Student ID', 'Name', 'Status', 'Score', 'Max', 'Percent', 'Risk score', 'Flags', 'Started', 'Submitted'];
  const lines = [head.map(esc).join(',')];
  for (const a of rows) {
    const st = db.prepare('SELECT * FROM students WHERE id = ?').get(a.student_id);
    const flags = JSON.parse(a.flags || '[]');
    const flagText = flags.map(f => f.label).join('; ');
    const pct = a.max_score ? Math.round(a.score / a.max_score * 100) + '%' : '';
    lines.push([a.student_id, st?.name || '', a.status, a.score ?? '', a.max_score ?? '', pct, a.risk_score,
      flagText, new Date(a.started_at).toISOString(), a.submitted_at ? new Date(a.submitted_at).toISOString() : '']
      .map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="exam-results-${examMod.exam.id}.csv"`);
  res.send(lines.join('\r\n'));
});

// One row per student per question: their answer, the correct answer, right/wrong, time.
app.get('/api/instructor/responses.csv', requireInstructor, (_, res) => {
  const rows = db.prepare('SELECT * FROM attempts WHERE exam_id = ? ORDER BY student_id').all(examMod.exam.id);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Student ID', 'Name', 'Q#', 'Question', 'Their answer', 'Correct answer', 'Result', 'Time (s)'];
  const lines = [head.map(esc).join(',')];
  for (const a of rows) {
    const st = db.prepare('SELECT * FROM students WHERE id = ?').get(a.student_id);
    for (const r of buildReview(a)) {
      lines.push([a.student_id, st?.name || '', r.index, r.text,
        r.answered ? r.studentAnswer : '(blank)', r.correctAnswer,
        !r.answered ? 'unanswered' : r.correct ? 'correct' : 'incorrect',
        r.timeMs ? (r.timeMs / 1000).toFixed(1) : ''].map(esc).join(','));
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="exam-responses-${examMod.exam.id}.csv"`);
  res.send(lines.join('\r\n'));
});

// Printable per-student report (open in browser, then Print → Save as PDF).
app.get('/api/instructor/report/:id', requireInstructor, (req, res) => {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).send('Not found');
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(a.student_id);
  const review = buildReview(a);
  const pat = performancePattern(review);
  const flags = JSON.parse(a.flags || '[]');
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const secs = ms => ms ? (ms / 1000).toFixed(1) + 's' : '—';
  const sims = flags.filter(f => f.type === 'answer_similarity');
  const rows = review.map(r => `<tr class="${!r.answered ? 'u' : r.correct ? 'c' : 'x'}">
    <td>${r.index}</td><td>${esc(r.text)}</td>
    <td>${r.answered ? esc(r.studentAnswer) : '<i>blank</i>'}</td>
    <td>${esc(r.correctAnswer)}</td>
    <td class="res">${!r.answered ? 'unanswered' : r.correct ? '✓ correct' : '✗ incorrect'}</td>
    <td>${secs(r.timeMs)}</td></tr>`).join('');
  const flagRows = flags.length ? flags.map(f =>
    `<li><b>${esc(f.label)}</b> <span class="t">${new Date(f.ts).toLocaleString()}</span></li>`).join('') : '<li>No flags raised.</li>';
  res.send(`<!doctype html><meta charset=utf-8><title>Report — ${esc(st?.name || a.student_id)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1.2rem;color:#111;line-height:1.5}
  h1{margin:0 0 .2rem;font-size:1.5rem}.sub{color:#555;margin-bottom:1.5rem}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin:1.2rem 0}
  .box{border:1px solid #ddd;border-radius:8px;padding:.8rem}.box .n{font-size:1.5rem;font-weight:700}.box .l{font-size:.75rem;color:#666;text-transform:uppercase;letter-spacing:.03em}
  table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.9rem}
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #eee;vertical-align:top}
  th{font-size:.72rem;text-transform:uppercase;color:#666;letter-spacing:.03em}
  tr.c .res{color:#187d3a}tr.x .res{color:#c0392b}tr.u{color:#999}
  .seq{font-family:ui-monospace,monospace;letter-spacing:.15em;word-break:break-all}
  ul{padding-left:1.1rem}.t{color:#888;font-size:.8rem}
  .sim{background:#fff5f5;border:1px solid #f0c0c0;border-radius:8px;padding:.7rem 1rem;margin:.5rem 0}
  .note{color:#666;font-size:.82rem;border-top:1px solid #eee;margin-top:2rem;padding-top:1rem}
  @media print{.noprint{display:none}body{margin:0}}
</style>
<button class="noprint" onclick="print()" style="float:right;padding:.5rem 1rem">Print / Save as PDF</button>
<h1>${esc(st?.name || a.student_id)}</h1>
<div class="sub">Student ID: ${esc(a.student_id)} · ${esc(examMod.exam.title)} · ${a.status === 'submitted' ? 'Submitted ' + new Date(a.submitted_at).toLocaleString() : 'In progress'}</div>
<div class="grid">
  <div class="box"><div class="n">${a.score ?? '—'}/${a.max_score ?? '—'}</div><div class="l">Score</div></div>
  <div class="box"><div class="n">${pat.accuracy}%</div><div class="l">Accuracy</div></div>
  <div class="box"><div class="n">${secs(pat.avgTimeMs)}</div><div class="l">Avg / question</div></div>
  <div class="box"><div class="n">${a.risk_score}</div><div class="l">Risk score</div></div>
</div>
<p><b>Answer pattern:</b> <span class="seq">${pat.sequence.replace(/C/g,'✓').replace(/X/g,'✗').replace(/·/g,'·')}</span>
&nbsp; (${pat.correct} correct of ${pat.answered} answered${pat.fastCorrect ? `, ${pat.fastCorrect} correct in under 5s` : ''})</p>
${sims.length ? `<div class="sim"><b>Similar answers to another student.</b> ${sims.map(s => esc(s.label) + (s.detail ? ` (${s.detail.sameWrong} identical wrong answers of ${s.detail.total} shared)` : '')).join('; ')}</div>` : ''}
<h3>Per-question detail</h3>
<table><thead><tr><th>#</th><th>Question</th><th>Their answer</th><th>Correct answer</th><th>Result</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
<h3>Integrity flags (${flags.length})</h3><ul>${flagRows}</ul>
<p class="note">Flags are behavioral signals for your review, not proof of misconduct. Weigh them under your institution's academic-integrity process.</p>`);
});

// Pages
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'start.html')));
app.get('/exam', (_, res) => res.sendFile(path.join(__dirname, 'public', 'exam.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

function serializeAttempt(a, student) {
  return {
    id: a.id, studentId: a.student_id, name: student?.name || a.student_id,
    status: a.status, startedAt: a.started_at, deadline: a.deadline,
    submittedAt: a.submitted_at, submitReason: a.submit_reason,
    currentQ: a.current_q, riskScore: a.risk_score, score: a.score, maxScore: a.max_score,
    flags: JSON.parse(a.flags || '[]'), lastSeen: a.last_seen, firstIp: a.first_ip, lastIp: a.last_ip,
    browser: parseUA(a.user_agent),
    connected: liveConnected.has(a.id),
    answered: Object.keys(JSON.parse(a.answers || '{}')).length,
    totalQ: JSON.parse(a.question_order).length
  };
}
// Per-question breakdown for the instructor (includes correct answers — instructor-only).
function buildReview(attempt) {
  const order = JSON.parse(attempt.question_order);
  const answers = JSON.parse(attempt.answers);
  const timings = JSON.parse(attempt.timings || '{}');
  return order.map((o, i) => {
    const q = examMod.byId.get(o.qid);
    const optText = id => { const opt = q.options.find(x => x.id === id); return opt ? opt.text : null; };
    const chosen = answers[q.id];
    return {
      index: i + 1, qid: q.id, text: q.text, points: q.points || 1,
      answered: chosen != null,
      studentAnswerId: chosen || null,
      studentAnswer: chosen != null ? optText(chosen) : null,
      correctAnswerId: q.correct,
      correctAnswer: optText(q.correct),
      correct: chosen != null && chosen === q.correct,
      timeMs: timings[q.id] || 0
    };
  });
}

// Summarize how well / how fast a student answered.
function performancePattern(review) {
  const answered = review.filter(r => r.answered);
  const correct = answered.filter(r => r.correct);
  const times = answered.map(r => r.timeMs).filter(t => t > 0);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const fastCorrect = correct.filter(r => r.timeMs > 0 && r.timeMs < 5000).length;
  return {
    answered: answered.length, total: review.length, correct: correct.length,
    accuracy: answered.length ? Math.round(correct.length / answered.length * 100) : 0,
    avgTimeMs: avg,
    fastCorrect,
    sequence: review.map(r => !r.answered ? '·' : (r.correct ? 'C' : 'X')).join('')
  };
}

function buildOverview() {
  const rows = db.prepare('SELECT * FROM attempts WHERE exam_id = ? ORDER BY risk_score DESC, started_at').all(examMod.exam.id);
  const list = rows.map(a => serializeAttempt(a, db.prepare('SELECT * FROM students WHERE id = ?').get(a.student_id)));
  return {
    examTitle: examMod.exam.title, totalQ: examMod.questionCount(),
    stats: {
      inProgress: list.filter(x => x.status === 'in_progress').length,
      submitted: list.filter(x => x.status === 'submitted').length,
      flagged: list.filter(x => x.riskScore >= 10).length
    },
    students: list
  };
}

// ---- live socket layer ----
const liveConnected = new Map();
function pushOverview() { io.to('instructors').emit('overview', buildOverview()); }
function recordEvent(attempt, type, detail, qid) {
  const w = risk.weightFor(type, detail);
  db.prepare('INSERT INTO events (attempt_id, ts, type, qid, detail, weight) VALUES (?, ?, ?, ?, ?, ?)')
    .run(attempt.id, now(), type, qid || null, detail ? JSON.stringify(detail).slice(0, 500) : null, w);
  if (w > 0) {
    const flags = JSON.parse(attempt.flags || '[]');
    flags.push({ ts: now(), type, label: risk.label(type), weight: w });
    const newScore = (attempt.risk_score || 0) + w;
    db.prepare('UPDATE attempts SET flags = ?, risk_score = ? WHERE id = ?').run(JSON.stringify(flags), newScore, attempt.id);
    attempt.flags = JSON.stringify(flags);   // keep in-memory copy current so a second
    attempt.risk_score = newScore;           // flag in the same handler doesn't clobber this one
    io.to('instructors').emit('flag', { attemptId: attempt.id, type, label: risk.label(type), weight: w, riskScore: newScore, ts: now() });
  }
}
io.on('connection', socket => {
  socket.on('instructor:join', ({ token }) => {
    if (!instructorTokens.has(token)) return socket.emit('denied');
    socket.join('instructors'); socket.emit('overview', buildOverview());
  });
  let attempt = null;
  socket.on('student:join', ({ token, client }) => {
    attempt = getAttemptByToken(token);
    if (!attempt || attempt.status === 'submitted') return socket.emit('ended');
    if (client?.ua) db.prepare('UPDATE attempts SET user_agent = ? WHERE id = ?').run(client.ua, attempt.id);
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
    const existing = liveConnected.get(attempt.id);
    // Only a genuinely concurrent connection from a DIFFERENT network is treated as a
    // second device. A reconnect from the same network (dropped wifi, phone switching
    // tabs, flaky home internet) just takes over the slot silently — no false alarm.
    if (existing && existing.socketId !== socket.id && existing.ip && ip && existing.ip !== ip) {
      recordEvent(attempt, 'second_session', { from: existing.ip, to: ip });
    }
    liveConnected.set(attempt.id, { socketId: socket.id, ip, ts: now() });
    db.prepare('UPDATE attempts SET last_seen = ?, active_session = ? WHERE id = ?').run(now(), socket.id, attempt.id);
    if (ip && attempt.last_ip && ip !== attempt.last_ip) {
      recordEvent(attempt, 'ip_change', { from: attempt.last_ip, to: ip });
      db.prepare('UPDATE attempts SET last_ip = ? WHERE id = ?').run(ip, attempt.id);
    }
    pushOverview();
  });
  socket.on('student:event', ({ type, qid, detail }) => {
    if (!attempt) return;
    const allowed = ['tab_blur', 'fullscreen_exit', 'paste', 'copy', 'devtools', 'rapid_answer', 'idle_then_burst', 'resize_small'];
    if (!allowed.includes(type)) return;
    attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
    if (!attempt || attempt.status === 'submitted') return;
    recordEvent(attempt, type, detail, qid);
  });
  socket.on('student:answer', ({ token, qid, value, currentQ }) => {
    const a = getAttemptByToken(token);
    if (!a || a.status === 'submitted') return;
    const answers = JSON.parse(a.answers); answers[qid] = value;
    db.prepare('UPDATE attempts SET answers = ?, current_q = ?, last_seen = ? WHERE id = ?')
      .run(JSON.stringify(answers), currentQ ?? a.current_q, now(), a.id);
    // log the answer with time + correctness so order and timing can be reconstructed
    const def = examMod.byId.get(qid);
    const correct = def ? (value === def.correct) : null;
    db.prepare('INSERT INTO events (attempt_id, ts, type, qid, detail, weight) VALUES (?, ?, ?, ?, ?, 0)')
      .run(a.id, now(), 'answer', qid, JSON.stringify({ value, correct }));
    io.to('instructors').emit('progress', { attemptId: a.id, answered: Object.keys(answers).length, currentQ });
  });

  // active time spent per question, sent as the student leaves each question
  socket.on('student:timing', ({ token, qid, deltaMs }) => {
    const a = getAttemptByToken(token);
    if (!a || a.status === 'submitted') return;
    const d = Math.max(0, Math.min(Number(deltaMs) || 0, 1000 * 60 * 30));
    const timings = JSON.parse(a.timings || '{}');
    timings[qid] = (timings[qid] || 0) + d;
    db.prepare('UPDATE attempts SET timings = ? WHERE id = ?').run(JSON.stringify(timings), a.id);
  });
  socket.on('student:submit', ({ token }) => {
    const a = getAttemptByToken(token);
    if (a && a.status !== 'submitted') finalizeAttempt(a.id, 'student');
    const fresh = getAttemptByToken(token);
    const payload = { allowRetakes: !!examMod.exam.allowRetakes };
    if (examMod.exam.showScore && fresh) { payload.score = fresh.score; payload.max = fresh.max_score; }
    socket.emit('submitted', payload); pushOverview();
  });
  socket.on('student:heartbeat', ({ token }) => {
    const a = getAttemptByToken(token);
    if (a) db.prepare('UPDATE attempts SET last_seen = ? WHERE id = ?').run(now(), a.id);
  });
  socket.on('disconnect', () => {
    if (attempt && liveConnected.get(attempt.id)?.socketId === socket.id) { liveConnected.delete(attempt.id); pushOverview(); }
  });
});

function finalizeAttempt(attemptId, reason) {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  if (!a || a.status === 'submitted') return;
  const { score, max } = examMod.grade(JSON.parse(a.answers), JSON.parse(a.question_order));
  db.prepare('UPDATE attempts SET status = ?, submitted_at = ?, submit_reason = ?, score = ?, max_score = ? WHERE id = ?')
    .run('submitted', now(), reason, score, max, attemptId);
  // "answering well, very fast" pattern: several correct answers each under 5s.
  const pat = performancePattern(buildReview(db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId)));
  if (pat.fastCorrect >= 5) {
    const cur = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    const flags = JSON.parse(cur.flags || '[]');
    if (!flags.some(f => f.type === 'fast_correct')) {
      flags.push({ ts: now(), type: 'fast_correct', label: `${pat.fastCorrect} correct answers given very fast`, weight: 4 });
      db.prepare('UPDATE attempts SET flags = ?, risk_score = ? WHERE id = ?').run(JSON.stringify(flags), (cur.risk_score || 0) + 4, attemptId);
    }
  }
  runCrossCheck();
}
function runCrossCheck() {
  const subs = db.prepare("SELECT id, student_id, answers FROM attempts WHERE exam_id = ? AND status = 'submitted'").all(examMod.exam.id);
  for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) {
    const A = JSON.parse(subs[i].answers), B = JSON.parse(subs[j].answers);
    const qids = new Set([...Object.keys(A), ...Object.keys(B)]);
    let total = 0, sameWrong = 0;
    for (const q of qids) {
      if (A[q] == null || B[q] == null) continue; total++;
      if (A[q] === B[q]) { const def = examMod.byId.get(q); if (def && A[q] !== def.correct) sameWrong++; }
    }
    if (total >= 5 && sameWrong >= Math.max(3, Math.ceil(total * 0.4))) {
      tagSimilarity(subs[i].id, { with: subs[j].student_id, sameWrong, total });
      tagSimilarity(subs[j].id, { with: subs[i].student_id, sameWrong, total });
    }
  }
  pushOverview();
}
function tagSimilarity(attemptId, detail) {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  const flags = JSON.parse(a.flags || '[]');
  if (flags.some(f => f.type === 'answer_similarity' && f.detail?.with === detail.with)) return;
  flags.push({ ts: now(), type: 'answer_similarity', label: `Shared answer pattern with ${detail.with}`, weight: 8, detail });
  db.prepare('UPDATE attempts SET flags = ?, risk_score = ? WHERE id = ?').run(JSON.stringify(flags), (a.risk_score || 0) + 8, attemptId);
}

setInterval(() => {
  const due = db.prepare("SELECT id FROM attempts WHERE status = 'in_progress' AND deadline < ?").all(now());
  for (const r of due) finalizeAttempt(r.id, 'time_expired');
  if (due.length) pushOverview();
}, 5000);

if (require.main === module) server.listen(PORT, () => console.log(`Standalone exam site running on http://localhost:${PORT}`));
module.exports = { app, server, io, finalizeAttempt, buildOverview };
