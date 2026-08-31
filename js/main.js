// Entry point: two ways in. Play mode deals hand after hand and grades you;
// the analyzer takes one exact spot and reads it to the bone.

import { initPlay } from './play.js';
import { initAnalyzer } from './analyzer.js';

const MODE_KEY = 'runout.mode';

function setMode(mode) {
  document.body.dataset.mode = mode;
  document.querySelector('#play-root').hidden = mode !== 'play';
  document.querySelector('#analyzer-root').hidden = mode !== 'analyze';
  for (const button of document.querySelectorAll('[data-mode-btn]')) {
    button.classList.toggle('active', button.dataset.modeBtn === mode);
  }
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* fine */
  }
}

for (const button of document.querySelectorAll('[data-mode-btn]')) {
  button.addEventListener('click', () => setMode(button.dataset.modeBtn));
}

initPlay(document.querySelector('#play-root'));
initAnalyzer(document.querySelector('#analyzer-root'));

let mode = 'play';
try {
  mode = localStorage.getItem(MODE_KEY) || 'play';
} catch {
  /* default stands */
}
// A shared spot link always opens in the analyzer, whatever the last mode was.
if (location.hash.startsWith('#s=')) mode = 'analyze';
setMode(mode);
