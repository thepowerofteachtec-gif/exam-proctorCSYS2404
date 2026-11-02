// Convert a QTI file (Canvas quiz export) into this system's exam format.
//
// Usage:
//   node import-qti.js <your-file.zip|.xml> [output.json]
//
// - Accepts a Canvas QTI export .zip (the file you download from Canvas) or a
//   single QTI .xml file.
// - Supports QTI 1.2 (Canvas Classic Quizzes) and QTI 2.x (New Quizzes).
// - Imports multiple-choice and true/false questions. Other types (essay,
//   short answer, multiple-answer, etc.) are listed and skipped, since this
//   system scores single-answer questions.
// - Writes config/exam.json by default (your old one is backed up first).

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_',
  textNodeName: '#text', trimValues: true, parseTagValue: false, isArray: () => false
});
const arr = x => x == null ? [] : (Array.isArray(x) ? x : [x]);
const letters = 'abcdefghijklmnopqrstuvwxyz';

// Pull readable text out of a QTI node that may hold HTML, CDATA, or nested text.
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return clean(node);
  if (typeof node === 'number') return String(node);
  if (node['#text'] != null) return clean(String(node['#text']));
  // mattext / material wrappers
  if (node.mattext != null) return arr(node.mattext).map(textOf).join(' ');
  if (node.material != null) return arr(node.material).map(textOf).join(' ');
  return '';
}
function clean(s) {
  return String(s)
    .replace(/<\/?(p|div|br|span)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

// ---------- QTI 1.2 (Canvas Classic) ----------
function parseItem12(item) {
  const meta = {};
  for (const f of arr(item.itemmetadata?.qtimetadata?.qtimetadatafield))
    meta[textOf(f.fieldlabel)] = textOf(f.fieldentry);
  const qtype = meta.question_type || '';
  const points = parseFloat(meta.points_possible) || 1;

  const pres = item.presentation || {};
  const text = textOf(pres.material) || textOf(pres);
  const lid = arr(pres.response_lid)[0] || pres.response_lid;
  if (!lid) return { skip: true, reason: qtype || 'no choices' };
  const labels = arr(lid.render_choice?.response_label);
  if (!labels.length) return { skip: true, reason: qtype || 'no choices' };

  // map QTI option ident -> our letter id
  const identToLetter = {};
  const options = labels.map((lab, i) => {
    const id = letters[i];
    identToLetter[String(lab['@_ident'])] = id;
    return { id, text: textOf(lab.material) || textOf(lab) };
  });

  // correct answer: the respcondition whose setvar sets the score, its varequal ident
  let correctIdent = null;
  const conds = arr(item.resprocessing?.respcondition);
  for (const c of conds) {
    const setvars = arr(c.setvar);
    const scored = setvars.some(sv => parseFloat(textOf(sv)) > 0 || /100/.test(textOf(sv)));
    const veq = arr(c.conditionvar?.varequal);
    if (scored && veq.length) { correctIdent = textOf(veq[0]); break; }
    if (!correctIdent && veq.length && setvars.length) correctIdent = textOf(veq[0]);
  }
  const correct = identToLetter[String(correctIdent)];

  const isTF = /true_false/.test(qtype) ||
    (options.length === 2 && options.every(o => /^(true|false)$/i.test(o.text)));
  if (!/multiple_choice|true_false/.test(qtype) && !(qtype === '' && options.length >= 2 && correct)) {
    if (!correct) return { skip: true, reason: qtype || 'unsupported' };
  }
  if (!correct) return { skip: true, reason: (qtype || 'unknown') + ' (no correct answer found)' };

  return { type: isTF ? 'true_false' : 'mcq', points, text, options, correct };
}

// ---------- QTI 2.x (New Quizzes) ----------
function parseItem2x(ai) {
  const rd = arr(ai.responseDeclaration)[0] || ai.responseDeclaration;
  const correctVal = rd ? textOf(rd.correctResponse?.value) : null;
  const body = ai.itemBody || {};
  const ci = arr(body.choiceInteraction)[0] || body.choiceInteraction;
  if (!ci) return { skip: true, reason: 'no choiceInteraction' };
  const choices = arr(ci.simpleChoice);
  if (!choices.length) return { skip: true, reason: 'no choices' };
  const identToLetter = {};
  const options = choices.map((c, i) => {
    const id = letters[i];
    identToLetter[String(c['@_identifier'])] = id;
    return { id, text: textOf(c) };
  });
  const correct = identToLetter[String(correctVal)];
  const text = textOf(ci.prompt) || textOf(body);
  if (!correct) return { skip: true, reason: 'no correct answer' };
  const isTF = options.length === 2 && options.every(o => /^(true|false)$/i.test(o.text));
  return { type: isTF ? 'true_false' : 'mcq', points: 1, text, options, correct };
}

function collectXml(input) {
  const files = [];
  if (input.toLowerCase().endsWith('.zip') || input.toLowerCase().endsWith('.imscc')) {
    const zip = new AdmZip(input);
    for (const e of zip.getEntries()) {
      if (e.entryName.toLowerCase().endsWith('.xml')) files.push(zip.readAsText(e));
    }
  } else {
    files.push(fs.readFileSync(input, 'utf8'));
  }
  return files;
}

function main() {
  const input = process.argv[2];
  const output = process.argv[3] || path.join(__dirname, 'config', 'exam.json');
  if (!input || !fs.existsSync(input)) {
    console.error('Usage: node import-qti.js <your-file.zip|.xml> [output.json]');
    console.error('The input file was not found.');
    process.exit(1);
  }

  const questions = [];
  const skipped = [];
  let title = 'Imported Exam';

  for (const xml of collectXml(input)) {
    let doc;
    try { doc = parser.parse(xml); } catch { continue; }

    // QTI 1.2
    const interop = doc.questestinterop;
    if (interop) {
      const assessments = arr(interop.assessment);
      for (const a of assessments) {
        if (a['@_title']) title = a['@_title'];
        const sections = arr(a.section).length ? arr(a.section) : [a];
        const items = sections.flatMap(s => arr(s.item));
        for (const it of items) {
          const q = parseItem12(it);
          if (q.skip) skipped.push((it['@_title'] || 'item') + ' — ' + q.reason);
          else questions.push(q);
        }
      }
      // items directly under interop (some exports)
      for (const it of arr(interop.item)) {
        const q = parseItem12(it);
        if (q.skip) skipped.push((it['@_title'] || 'item') + ' — ' + q.reason); else questions.push(q);
      }
    }

    // QTI 2.x single item per file
    if (doc.assessmentItem) {
      if (doc.assessmentItem['@_title']) title = title === 'Imported Exam' ? doc.assessmentItem['@_title'] : title;
      const q = parseItem2x(doc.assessmentItem);
      if (q.skip) skipped.push((doc.assessmentItem['@_title'] || 'item') + ' — ' + q.reason); else questions.push(q);
    }
    // QTI 2.x test title
    if (doc.assessmentTest?.['@_title']) title = doc.assessmentTest['@_title'];
  }

  if (!questions.length) {
    console.error('\nNo multiple-choice or true/false questions could be read from that file.');
    if (skipped.length) console.error('Items found but skipped:\n  - ' + skipped.join('\n  - '));
    console.error('\nIf you expected questions here, send me the file and I will adapt the importer.');
    process.exit(2);
  }

  const exam = {
    id: 'imported-' + Date.now(),
    title,
    durationMinutes: 45,
    shuffleQuestions: true,
    shuffleOptions: true,
    passphrase: '',
    instructions: 'Activity during this exam is logged for academic integrity. Please stay on this page and complete the exam on your own. The exam submits automatically when time runs out.',
    questions: questions.map((q, i) => ({ id: 'q' + (i + 1), type: q.type, points: q.points, text: q.text, options: q.options, correct: q.correct }))
  };

  // back up any existing output file
  if (fs.existsSync(output)) {
    const bak = output.replace(/\.json$/, '') + '.backup-' + Date.now() + '.json';
    fs.copyFileSync(output, bak);
    console.log('Backed up existing file to ' + path.basename(bak));
  }
  fs.writeFileSync(output, JSON.stringify(exam, null, 2));

  console.log(`\nImported ${questions.length} question(s) into ${path.relative(__dirname, output)}`);
  console.log(`  Title: ${title}`);
  console.log(`  Multiple choice: ${questions.filter(q => q.type === 'mcq').length}`);
  console.log(`  True/false: ${questions.filter(q => q.type === 'true_false').length}`);
  if (skipped.length) {
    console.log(`\n${skipped.length} item(s) were skipped (not single-answer questions):`);
    skipped.forEach(s => console.log('  - ' + s));
  }
  console.log('\nReview the file, set durationMinutes, then run the system as usual.');
}

main();
