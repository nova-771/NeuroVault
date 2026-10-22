/* Timeline (activity and "Where I was"). Extracted from design/vault-notes-mockups.html (R20).
   Build M: the knowledge graph was removed (decided 2026-10-17, "kinda of a gimmick"); the page is mockup R42's, and its
   Note history card is drawn by render-modules.js. */
'use strict';
/* Build M (mockup R42, locked 2026-10-17 · "milestones as rows, activity by day"): the Note history card on top, then the
   milestones as rows (no box in a box), then the activity grouped by day like Timer → History, every column a fixed slot
   (the time, what happened, one 28px action). The head chip is gone: the sidebar shows the filters. */
function viewHistory() {
  // R9: the status bar's "Was doing" trail, kept in full here as "Where I was" (newest first)
  const visits = (S.visits || []).map((x, i) => ({ id: 'visit-' + i, time: agoText(x.at), range: 'Today', type: 'Where I was', title: x.label, desc: i === S.visits.length - 1 ? 'Where you are now' : 'You were here', visit: i, icon: x.icon })).reverse();
  const list = [...visits, ...D.events].filter(e => (S.range === 'All' || e.range === S.range) && (S.type === 'All' || e.type === S.type));
  const order = ['Today', 'Yesterday', 'This week', 'Earlier'], days = [];
  list.forEach(e => { let d = days.find(x => x.k === e.range); if (!d) days.push(d = { k: e.range, list: [] }); d.list.push(e); });
  days.sort((a, b) => (order.indexOf(a.k) + 1 || 9) - (order.indexOf(b.k) + 1 || 9));
  const act = e => e.restoreId != null && !e.restored ? `<button class="btn btn--secondary btn--sm" data-act="${e.restoreAct || 'att-restore'}" data-v="${e.restoreId}" title="Put ${esc(e.file || 'it')} back where it was">Restore</button>`   // Build M · QC 88
    : e.photoRestoreId != null && !e.restored ? `<button class="btn btn--secondary btn--sm" data-act="photo-restore" data-v="${e.photoRestoreId}" title="Show ${esc(e.file || 'the original')} in the note again">Restore</button>`   // Build V · R59: an edited photo
    : e.visit != null ? (e.visit === S.visits.length - 1 ? '<span class="tl-slot"></span>' : `<button class="btn btn--secondary btn--sm" data-act="visit" data-v="${e.visit}">Go back</button>`)
    : D.notes.find(n => n.id === e.noteId) ? `<button class="btn btn--secondary btn--sm" data-act="note" data-v="${e.noteId}">Open note</button>` : '<span class="tl-slot"></span>';
  const feed = UI.state === 'loading' ? '<div class="bm-none"><div class="skel" style="height:60px"></div></div>'
    : !list.length ? `<div class="bm-none">${D.events.length || visits.length ? 'Nothing for this filter. <button class="btn btn--secondary btn--sm" data-act="bm-clear">Show everything</button>' : 'No activity yet. Edits, restores and new notes show here.'}</div>`
    : days.map(d => `<div class="day-head"><span class="list-item-title">${esc(d.k)}</span><span class="card-sub num">${d.list.length}</span></div>${d.list.map(e => `<div class="feed-item${e.visit != null ? ' feed-item--visit' : ''}"${e.noteId ? ` data-note="${esc(e.noteId)}"` : ''}><span class="feed-time num">${esc(e.time)}</span>
      <div class="tl-what"><div class="tl-type">${e.visit != null ? ic(e.icon) : ''}${esc(e.type)}</div><div class="feed-title">${esc(e.title)}</div><div class="feed-desc">${esc(e.desc)}</div></div>${act(e)}</div>`).join('')}`).join('');
  const filt = [S.range, S.type].filter(x => x !== 'All');
  const feedCard = `<section class="card bm-card" aria-label="Activity">${bmHead('<h2 class="bm-card-title">Activity</h2>', `${list.length} event${list.length === 1 ? '' : 's'}${filt.length ? ' · ' + esc(filt.join(' · ')) : ''}`)}<div class="tl-feed feed" id="timeline-feed-container">${feed}</div></section>`;
  return `<section class="view bm-tlview" id="main-view-history"><div class="view-inner"><div class="view-head"><div><h1 class="view-title">Activity timeline</h1><p class="view-sub">Your notes' history, milestones and where you were, across the vault.</p></div></div>
    ${bmHistCard()}${milestoneCard()}${feedCard}</div></section>`;
}
// The milestones as rows. On the sample vault, the Q3 plan; on a real vault, the check-ins saved during timed sessions ("What did you just finish?")
function milestoneCard() {
  if (!VAULT.live) {
    const ms = [['M1 · Schema lock', 'Done', 'success', 'Vault CRDT sync core', 'Q3 Roadmap Draft'], ['M2 · Auth audit', 'In progress', 'accent', 'OAuth2 and PKCE rotation', 'API auth notes'], ['M3 · Accessibility QA', 'Upcoming', 'neutral', 'OpenDyslexic UI release', 'Meeting notes — design sync']];
    return `<section class="card bm-card" aria-label="Q3 milestones">${bmHead('<h2 class="bm-card-title">Q3 milestones</h2>', `${ms.filter(m => m[1] === 'Done').length} of ${ms.length} done`)}
      <div class="tl-mrows">${ms.map(m => `<div class="tl-mrow"><span class="chip chip--${m[2]}">${m[1]}</span><div><div class="tl-mrow-title">${esc(m[3])}</div><div class="tl-mrow-sub">${esc(m[0])} · Linked: ${esc(m[4])}</div></div></div>`).join('')}</div></section>`;
  }
  const rows = D.sessions.flatMap(s => s.milestones.map(m => ({ s, m }))).slice(0, 6);
  return `<section class="card bm-card" aria-label="Milestones">${bmHead('<h2 class="bm-card-title">Milestones</h2>', rows.length ? `${rows.length} latest check-in${rows.length === 1 ? '' : 's'}` : '')}
    ${rows.length ? `<div class="tl-mrows">${rows.map(({ s, m }) => `<div class="tl-mrow"><span class="chip chip--neutral num">${esc(bmWhen(s.start_time).replace(/ \d\d:\d\d$/, ''))}</span><div><div class="tl-mrow-title">${esc(m.note)}</div><div class="tl-mrow-sub"><span class="proj-color-${s.color}"><span class="proj-dot"></span></span> ${esc(s.project_name)} · ${fmtDur(m.elapsed_seconds || 0)} into the session</div></div></div>`).join('')}</div>`
      : '<div class="bm-none">No milestones yet. What you note at a check-in during a timed session shows here.</div>'}</section>`;
}
