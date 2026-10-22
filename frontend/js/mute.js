/* ==== Build N · QC 71: one global mute for the tests (?mute=1 or ?check=1) ====
   Feedback: "do we have a headless browser making my chime noise? its jaring". ?mute=1 used to silence only read-aloud; the timer's
   chime (render-timer.js), ambient sounds (render-widgets.js), sound previews, voice clips and Windows voices still sounded during
   check sweeps. Loaded before every other script, so nothing can make a sound first:
   - Web Audio: every AudioContext's destination is a gain of 0 in front of the speakers, so whatever is connected to it plays
     (timings, events and tests work) but nothing reaches them.
   - <audio> / <video> and new Audio(): muted at volume 0 when they play (and on any play event, caught first), whatever a script
     sets the volume to.
   - Windows voices (speechSynthesis): every utterance speaks at volume 0, so its word boundary events still come.
   NV_MUTE keeps a note of each, for the check that nothing is audible. The real app (no ?mute / ?check) is untouched. */
'use strict';
const NV_MUTE = (() => {
  const q = new URLSearchParams(location.search), mutedHere = x => x.get('mute') === '1' || x.get('check') === '1';
  let up = false; try { up = window.parent !== window && mutedHere(new URLSearchParams(parent.location.search)); } catch (e) { /* another origin */ }
  const on = mutedHere(q) || up;   // a test page that loads the app in a frame (tests/editor-behaviour.html?mute=1) mutes it too
  const M = { on, ctxs: [], media: [], speech: [] };
  if (!on) return M;
  const AC0 = window.AudioContext || window.webkitAudioContext;
  if (AC0) {
    const dest = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination').get;
    class MutedAudioContext extends AC0 {
      constructor(...a) { super(...a); const g = super.createGain(); g.gain.value = 0; g.connect(dest.call(this)); this.nvMuteGain = g; M.ctxs.push(this); }
      get destination() { return this.nvMuteGain; }
    }
    window.AudioContext = MutedAudioContext; if (window.webkitAudioContext) window.webkitAudioContext = MutedAudioContext;
  }
  const vol = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume'), muted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  const hush = el => { muted.set.call(el, true); vol.set.call(el, 0); if (!M.media.includes(el)) M.media.push(el); };
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', { configurable: true, get() { return vol.get.call(this); }, set() { vol.set.call(this, 0); } });
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', { configurable: true, get() { return muted.get.call(this); }, set() { muted.set.call(this, true); } });
  const play0 = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { hush(this); return play0.apply(this, arguments); };
  ['loadstart', 'play', 'playing', 'volumechange'].forEach(k => document.addEventListener(k, e => { if (e.target instanceof HTMLMediaElement && (!muted.get.call(e.target) || vol.get.call(e.target))) hush(e.target); }, true));
  if ('speechSynthesis' in window) {
    const speak0 = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = u => { try { u.volume = 0; } catch (e) { /* read-only: leave it */ } M.speech.push(u); return speak0(u); };
  }
  return M;
})();
// Anything that could be heard now: an AudioContext whose output isn't at 0, a media element playing with sound, a voice speaking aloud
function nvAudible() {
  if (!NV_MUTE.on) return [];
  const out = [];
  NV_MUTE.ctxs.forEach((c, i) => { if (c.state !== 'closed' && c.nvMuteGain.gain.value !== 0) out.push(`AudioContext ${i} at gain ${c.nvMuteGain.gain.value}`); });
  document.querySelectorAll('audio, video').forEach(el => { if (!el.paused && (!el.muted || el.volume)) out.push(`<${el.tagName.toLowerCase()}> playing at ${el.volume}`); });
  NV_MUTE.media.forEach(el => { if (!el.paused && (!el.muted || el.volume)) out.push(`new Audio playing at ${el.volume}`); });
  NV_MUTE.speech.forEach(u => { if (u.volume !== 0) out.push(`a voice at ${u.volume}`); });
  return out;
}
/* ==== end Build N · QC 71 ==== */
