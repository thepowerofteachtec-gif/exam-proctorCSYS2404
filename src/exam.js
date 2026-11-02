// Loads the exam definition and builds per-student randomized views.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXAM_PATH = process.env.EXAM_FILE || path.join(__dirname, '..', 'config', 'exam.json');
let exam = JSON.parse(fs.readFileSync(EXAM_PATH, 'utf8'));
const byId = new Map(exam.questions.map(q => [q.id, q]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Order is generated once per attempt and stored, so a refresh never reshuffles.
// If questionsPerAttempt is set, each attempt gets a random subset of that size.
function buildOrder() {
  let qs = exam.questions.slice();
  const pick = exam.questionsPerAttempt;
  if (exam.shuffleQuestions || (pick && pick < qs.length)) qs = shuffle(qs);
  if (pick && pick < qs.length) qs = qs.slice(0, pick);
  return qs.map(q => ({
    qid: q.id,
    options: (exam.shuffleOptions && q.type !== 'true_false')
      ? shuffle(q.options.map(o => o.id))
      : q.options.map(o => o.id)
  }));
}

// What the browser is allowed to see: no correct answers, ever.
function publicView(order) {
  return order.map((o, i) => {
    const q = byId.get(o.qid);
    return {
      index: i,
      id: q.id,
      type: q.type,
      text: q.text,
      points: q.points || 1,
      options: o.options.map(id => ({ id, text: q.options.find(x => x.id === id).text }))
    };
  });
}

// Grade over the attempt's own question set (order) when given, else all questions.
function grade(answers, order) {
  const qids = order ? order.map(o => o.qid) : exam.questions.map(q => q.id);
  let score = 0, max = 0;
  for (const qid of qids) {
    const q = byId.get(qid);
    if (!q) continue;
    const pts = q.points || 1;
    max += pts;
    if (answers[qid] && answers[qid] === q.correct) score += pts;
  }
  return { score, max };
}

// How many questions a student actually sits.
function questionCount() {
  const pick = exam.questionsPerAttempt;
  return (pick && pick < exam.questions.length) ? pick : exam.questions.length;
}

module.exports = { get exam() { return exam; }, byId, buildOrder, publicView, grade, questionCount };
