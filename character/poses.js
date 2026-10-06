// Realistic sprite character for Desk Buddy.
// Full-body frames live in this folder on a shared 320x400 canvas (feet at the bottom,
// standing figure 320px tall). Each pose = list of frames, played in a loop at `fps`.
// Missing poses fall back to a close match (e.g. drink -> remind -> idle).
const seq = (name, nums) => nums.map(n => `${name}${n}.png`);
window.CHARACTER = {
  height: 262,                 // on-screen height of the 400px canvas (figure ≈ 210px)
  poses: {
    idle:    ['idle.png'],
    happy:   ['happy.png'],
    walk:    ['walk1.png', 'walk2.png'],
    remind:  ['remind1.png', 'remind2.png'],
    cheer:   ['cheer1.png', 'cheer2.png'],
    // full-body reminder animations from your pose sheets
    drink:   seq('drink',   [3, 4, 5, 6, 7]),        // walks in with bottle, points, drinks, thumbs up
    snack:   seq('snack',   [3, 4, 5, 6, 7]),        // biscuit, bite, chew, thumbs up, shows it
    meal:    seq('meal',    [2, 3, 4, 5, 6, 7]),     // carries plate, eats, smiles, points at plate
    eyes:    seq('eyes',    [2, 3, 4, 5, 6, 7]),     // shades eyes, looks left / right / up, thumbs up
    posture: seq('posture', [2, 3, 4, 5, 6, 7]),     // slouch -> straighten -> hands on hips -> proud
    wrist:   seq('wrist',   [2, 3, 4, 5, 6, 7]),     // hands up, wrist rolls, fingers wide, thumbs up
    stretch: seq('stretch', [2, 3, 4, 5, 6, 7]),     // arms up, overhead, lean left / right, relax
    breathe: seq('breathe', [2, 3, 4, 5, 6, 7]),     // hands on chest, inhale, hold, exhale, thumbs up
  },
  fps: { walk: 3, remind: 1.4, cheer: 2.4, drink: 1.1, snack: 1.1, meal: 1.0, eyes: 1.0,
         posture: 1.1, wrist: 1.5, stretch: 1.0, breathe: 0.75 },

  // Upper-body clips (from the first pose sheet) for the actions without full-body frames yet.
  // During those reminders he pops up from behind the card; 'sleep' is used while you're away.
  peekHeight: 130,
  peek: {
    wave:   { frames: [2, 3, 4, 5, 6, 7], fps: 1.6 },
    sleepy: { frames: [2, 3, 4, 5, 7],    fps: 0.9 },
    sleep:  { frames: [2, 3],             fps: 0.5 },
  },
};
