# Writing your exam questions

Open `config/exam.json` and edit it. Here is what each part means.

## Top of the file
```
"id": "midsem-pilot-2026",        a short code for this exam (no spaces)
"title": "Mid-Semester Examination",
"durationMinutes": 45,            total time allowed
"shuffleQuestions": true,         each student gets questions in a different order
"shuffleOptions": true,           each student gets the answer choices in a different order
"passphrase": "",                 optional word students type to enter; "" means none
"instructions": "....",           shown on the start screen and top of the exam
```

## Each question
Multiple choice:
```
{
  "id": "q1",                     unique, no spaces (q1, q2, q3 ...)
  "type": "mcq",
  "points": 1,
  "text": "Your question goes here?",
  "options": [
    {"id":"a","text":"First choice"},
    {"id":"b","text":"Second choice"},
    {"id":"c","text":"Third choice"},
    {"id":"d","text":"Fourth choice"}
  ],
  "correct": "b"                  the id of the right choice
}
```

True / false:
```
{
  "id": "q3",
  "type": "true_false",
  "points": 1,
  "text": "Your statement goes here.",
  "options": [{"id":"t","text":"True"},{"id":"f","text":"False"}],
  "correct": "t"
}
```

Rules that keep students from seeing answers:
- The `"correct"` field never leaves the server. Students only ever receive the question
  text and the choices — never which one is right.
- Keep every `id` unique. Separate each question with a comma; no comma after the last one.
- After editing, you can check the file is valid by running `npm start`; if the file has a
  typo the server will say so on startup.

Tip: because options are shuffled per student, don't write choices like "Both A and B" —
"A" and "B" won't be in the same place for everyone. Use "Both of the above" sparingly or
avoid it.
