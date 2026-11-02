# Putting the system online with Render (always-on, no laptop)

This runs the exam system in the cloud so it's reachable 24/7 at one permanent web
address, with your laptop switched off. Good for letting students do the practice quiz on
their own time, and for the real exam without babysitting a machine.

Cost: about $7/month for the always-on service, plus ~$0.25/month for the results disk. You
can suspend or delete the service after your exams to stop charges.

You need two free accounts: GitHub (to hold the code) and Render (to run it). This is the
unfamiliar part if you haven't done it before — budget 30 minutes, or 15 with a technical
colleague. After the first time, changes are quick.

## Step 1 — Put the code on GitHub
1. Create a free account at github.com.
2. Make a new repository (call it `exam-proctor`), set it to Private.
3. Upload this whole project folder to it. The simplest no-tools way: on the new repo page,
   choose "uploading an existing file" and drag in the project files. (If you use Git, push
   the folder as usual.)

## Step 2 — Prepare your questions first
Before deploying, put your real questions in `config/exam.json` (import your QTI file or edit
it — see IMPORT-QTI.md / WRITING-QUESTIONS.md) and commit them, so the deployed site has your
exam. For a practice phase, you can deploy with the practice questions in `config/exam.json`
first, then swap in the real exam later.

## Step 3 — Deploy on Render
1. Create a free account at render.com and connect your GitHub.
2. Click **New +  ->  Blueprint**.
3. Pick your `exam-proctor` repository. Render reads the included `render.yaml` and sets up
   the service, the always-on plan, and the results disk automatically.
4. It will ask you to enter **INSTRUCTOR_PW** — type a strong dashboard password.
5. Click **Apply** / **Create**. Wait a few minutes for the first build.
6. Render gives you a permanent address like `https://exam-proctor.onrender.com`.

## Step 4 — Use it
- Students: send them that address. They open it, enter name + student ID, take the exam.
- You: open that address + `/dashboard`, sign in with your INSTRUCTOR_PW, monitor live and
  download results.

No cloudflared, no tunnel, no laptop. The address stays the same every time.

## Changing questions later
Edit `config/exam.json` in your GitHub repo (or re-upload it). Render redeploys automatically
within a minute. The results disk is kept across redeploys, so data is safe.

## Stopping charges after exams
In Render, suspend or delete the service when your exam period is over. Re-create it from the
Blueprint next time you need it.
