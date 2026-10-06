# Nudge Buddy 💧

A mini cartoon Krishna that walks along the bottom of your screen, tracks your screen time,
and gently reminds you to drink water, rest your eyes, stretch, walk and sleep.

## Run it

1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:

```bash
npm install        # one time, ~300 MB (mostly Electron)
npm start          # normal mode
npm run demo       # demo mode: everything 30x faster, great for testing / showing off
```

The first time it opens, a **setup window** asks for your name, the hours the companion should be on screen,
how often each reminder comes, meal and bedtime times, and a few other conditions. After you press
**Save & start**, the buddy says hi, then hides. A water-drop icon stays in the tray.
He only comes out when a reminder is due (timed from the moment you saved), asks you, and leaves again
in under a minute (45 s by default). No answer counts as a snooze: he asks again later.
Your answers are saved, so it starts straight away next time. Change them any time from the tray: **Settings…**
(or open the app again while it's running, or run `npm run setup`).

## What it does

| Feature | How |
|---|---|
| Screen-time tracking | Uses the OS idle timer — it only knows *whether* you used the keyboard/mouse, never *what* you typed |
| User states | ACTIVE → IDLE (2 min no input) → AWAY (5 min, or screen locked) |
| Break detection | Away for 5+ min counts as a break: session timer resets, break reminders are cancelled, buddy says "Welcome back" |
| 10 reminders | 💧 Water 45m · 👀 Eye rest 20m · 🧍 Posture 30m · ✋ Hands/wrists 40m · 🙆 Stretch 60m · 🌬️ Deep breaths 75m · 🚶 Walk 90m · 🍎 Snack 150m · 🍛 Lunch (1–3 PM) & dinner (8–10 PM) · 🌙 Bedtime after 11 PM |
| Personal | Every message uses the name you enter in the setup window |
| Reminder hours | Reminders run only between your start and end time on the days you pick (night shifts across midnight work too). Timers restart at your start time each day. Meal and bedtime reminders still pop up at their own times |
| Reset | Tray → Reset: restart reminder timers from now · reset today's stats · reset everything and set up again. The setup window also has **Reset to defaults** |
| Smart delivery | Hidden until a reminder is due; timers pause while you're away or the screen is locked; one card at a time, short gap between cards, snooze time is up to you |
| Mini-Krishna animations | Walks around, drinks from a steel bottle, eats a biscuit, holds a lunch plate, shades eyes, hands on hips for posture, rolls wrists, breathes, yawns, sleeps when you're away, cheers when you tap yes |
| Mood | Gets a sweat drop when you're behind on water, droopy eyes when your session runs past 90 min |
| Stats | Click the buddy: today's screen time, session times, counts for all 10 habits, water glasses (goal 8), quick + water / + snack buttons |
| Tray menu | Show stats, log a glass, pause 30m / 1h / 3h, try any reminder now, hide buddy, start at login, quit |
| Saved data | `desk-buddy-stats.json` in the app's user-data folder, last 30 days |

## Customize

- Name, companion hours and days, each reminder's on/off + interval, lunch / dinner / bedtime times,
  idle and break thresholds, snooze length, water goal, start at login: all in the setup window
  (saved as `desk-buddy-settings.json` in the app's user-data folder, `%APPDATA%\Nudge Buddy` on Windows)
- Reminder messages: the `CATALOG` and `MEAL_TEXT` lists at the top of `main.js`
- Skin / hair / jeans colours: CSS variables and gradients at the top of `index.html`

## Make an installer

```bash
npm run dist       # .dmg on Mac, .exe on Windows, AppImage on Linux (in the dist/ folder)
```

On Windows you get two files in `dist/`:
- `Nudge Buddy Setup 1.3.1.exe`: an installer with Start-menu and desktop shortcuts
- `NudgeBuddy-Portable-1.3.1.exe`: a single file you double-click to run, no install needed

If you build from VS Code's terminal and it fails with "Cannot find module 'electron'", run
`$env:ELECTRON_RUN_AS_NODE=$null` (PowerShell) first.

## Notes

- Works best on Windows and macOS. On Linux, clicking the buddy may not work on some desktops
  (click-through limitation) — use the tray menu instead.
- On macOS the app hides its Dock icon; quit it from the menu-bar drop icon.

## Realistic character (your 3D figurine)

The `character/` folder holds Mini-Krishna cut out from your animated image: idle (hands on hips),
happy, 2 walking frames with the clear bottle, 2 "reminder" frames reaching out, and 2 thumbs-up frames.
`character/poses.js` maps them to the app's poses. Delete the `character/` folder to go back to the drawn cartoon.

### Add more poses
Make new images of the same figurine (same AI tool you used), on a plain background, full body, feet visible.
Cut the background out (e.g. remove.bg), save as PNG, put them in `character/` and add a line in `poses.js`:

    drink: ['drink1.png', 'drink2.png'],

Pose names: drink, snack, meal, eyes, posture, wrist, stretch, breathe, wave, sleepy, sleep.

### Reminder animations
Full-body animations cut from your pose sheets (`character/<pose><n>.png`, 320x400 canvas, feet at the bottom):
drink, snack, meal, eyes, posture, wrist, stretch, breathe — 5–6 frames each, played next to the reminder card.
Walk and bedtime use the earlier upper-body clips (`character/peek/`): he pops up over the card.
When you're away he dozes off, peeking over the bottom edge of the screen.
Frame lists and speeds are in `character/poses.js`. To upgrade walk / bedtime / sleep later, add full-body frames
named e.g. `wave2.png … wave7.png` and list them under `poses` (then remove them from `peek`).
