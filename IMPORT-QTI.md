# Using your Canvas QTI file

If you already have your quiz in Canvas, you don't need to retype it. Export it from Canvas
as QTI and import it here.

## 1. Export from Canvas
In your Canvas course: **Settings → Export Course Content → Quiz** (or, for a single classic
quiz, use the quiz's **Export** option). Canvas gives you a `.zip` file. Save it.

## 2. Import it into this system
Put the `.zip` somewhere easy, then in a terminal in the project folder run:

```
node import-qti.js path/to/your-file.zip
```

For example, if the file is on your Desktop:
- Mac:     `node import-qti.js ~/Desktop/quiz-export.zip`
- Windows: `node import-qti.js C:\Users\You\Desktop\quiz-export.zip`

This reads your questions and writes them into `config/exam.json` (your previous file is backed
up first, so nothing is lost). It prints how many questions it imported and lists any it had to
skip.

To import into the **practice** quiz instead of the real exam:
```
node import-qti.js path/to/your-file.zip config/practice.json
```

## What imports
- **Multiple choice** and **true/false** questions, with their points and correct answers.
- Both Canvas formats are supported (Classic Quizzes = QTI 1.2, New Quizzes = QTI 2.x).

## What doesn't
Questions this system can't auto-score — essays, short answer, file upload, and
multiple-answer (select-all) questions — are skipped and listed by name so you know what was
left out. You can add or adjust any question by editing `config/exam.json` afterwards
(see WRITING-QUESTIONS.md).

## After importing
Open `config/exam.json`, set `durationMinutes`, add a `passphrase` if you want one, and check
the questions look right. Then run the system as usual (`npm start`). If something in your file
didn't import cleanly, send me the file and I'll adjust the importer to match it.
