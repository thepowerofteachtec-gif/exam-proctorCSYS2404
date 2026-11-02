# Running a practice quiz (students log in directly — no Canvas)

The practice quiz is separate from your real exam and keeps its own data, so you can run it
freely without touching anything for the real exam.

## What's different about practice mode
- Students can **retake** it as many times as they like.
- They **see their score** right after submitting.
- It uses `config/practice.json` and its own database (`data/practice.db`).

## Run it
1. In a terminal in the project folder, type:  `npm run practice`
   (The real exam still runs with `npm start` — they don't interfere.)
2. It starts on `http://localhost:3000`.
3. Give students the link:
   - **Same room / same wifi:** they can use your computer's address, or
   - **Anywhere:** start the cloudflared tunnel exactly as for the real exam
     (`cloudflared tunnel --url http://localhost:3000`) and share the
     `https://...trycloudflare.com` link by email or your class chat.
4. Students open the link, type their **name and student ID**, and take the quiz. No Canvas,
   no password to log in. (You can set an optional class password in `config/practice.json`
   via `passphrase` if you want to limit it to your class.)
5. Watch them live and open reports at your link + `/dashboard`
   (password = your `INSTRUCTOR_PW`, or `changeme-pilot` if you haven't set one).

## Make it your own
Edit `config/practice.json` the same way as the real exam (see WRITING-QUESTIONS.md). The
sample questions are about how the quiz interface works, which doubles as a good warm-up so
students know what to expect on exam day. Replace them with real content any time.

To turn retakes or the score display off, set `"allowRetakes"` or `"showScore"` to `false`.
