/* Sample notes copied verbatim from design/vault-notes-mockups.html (R20, commit be1769b) by a script:
   BASE_NOTES, BASE_TASKS, task t-7's steps and the stress profile's generated notes (7–40). */
const MOCK_BASE_NOTES = [
  { id: 'note-1', title: 'Q3 Roadmap Draft', category: 'Planning', tags: ['roadmap', 'q3', 'planning'], md:
`## Overview
Consolidate core vault synchronisation and dyslexia-first **Word/Docs-style Markdown** editing across desktop and mobile clients before the Q3 milestone freeze.
Beta readers will recieve the build on Friday; we hope the new themes effect how quite the page feels to there eyes.
## Open questions
- Should offline conflict resolution favour local snapshots or CRDT merges?
- How can we stop the JSON block parser rendering \`[object Object]\` when AST nodes are empty?
## Next steps
{{tasks}}
Finalise schema migration scripts with Engineering during Tuesday's design sync and reference [[API auth notes]].` },
  { id: 'note-2', title: 'API auth notes', category: 'Engineering', tags: ['api', 'auth', 'oauth2', 'security'], md:
`## Overview
Token rotation for the Vault Sync API uses short-lived access tokens (15m) paired with HTTP-only refresh tokens.
## Open questions
- Rate-limiting threshold per workspace key during bulk imports.
- Hardware security key support for encrypted vaults.
## Next steps
{{tasks}}
Update endpoint documentation for [[Q3 Roadmap Draft]].` },
  { id: 'note-3', title: 'Meeting notes — design sync', category: 'Meetings', tags: ['design', 'sync', 'accessibility', 'opendyslexic'], md:
`## Overview
Reviewed warm paper colour contrast and confirmed OpenDyslexic as the default reading and editing typeface, plus a low-glare dark mode.
> Muted grey text is too faint on paper; raise it to meet AA.
## Open questions
- Should the right outline sidebar remember its open/closed state per view?
## Next steps
{{tasks}}
See [[Q3 Roadmap Draft]] for milestone dates.` },
  { id: 'note-4', title: 'Reading list — accessibility research', category: 'Planning', tags: ['research', 'accessibility'], md:
`## Papers
1. Font choice and reading speed for dyslexic readers
2. Line length and comprehension on screens
3. Contrast preferences: off-white vs pure white
## Notes
Line length around 60–75 characters keeps reading comfortable. Links to [[Meeting notes — design sync]].` },
  { id: 'note-5', title: 'Sync conflict post-mortem', category: 'Engineering', tags: ['sync', 'incident'], md:
`## What happened
Two devices edited *the same note* offline; the last write won and a task list was lost.
## Fix
{{tasks}}
### Follow-up
Add a conflict banner that shows both versions. Related: [[API auth notes]].` },
  { id: 'note-6', title: '1:1 with Maya — 9 Oct', category: 'Meetings', tags: ['1-1'], md:
`## Agenda
- Graph view performance with 500+ nodes
- Hiring for the mobile client
## Actions
{{tasks}}` },
];
const MOCK_BASE_TASKS = [
  { id: 't-1', noteId: 'note-1', title: 'Fix [object Object] serialisation in empty AST block parser', priority: 'High', due: 'Today', done: false },
  { id: 't-2', noteId: 'note-1', title: 'Lock Q3 roadmap milestone deliverables with product leads', priority: 'Medium', due: 'Upcoming', done: false },
  { id: 't-3', noteId: 'note-2', title: 'Audit OAuth2 PKCE refresh token rotation window (15m)', priority: 'High', due: 'Today', done: false },
  { id: 't-4', noteId: 'note-2', title: 'Configure rate-limiting headers for bulk vault imports', priority: 'Medium', due: 'Upcoming', done: true },
  { id: 't-5', noteId: 'note-3', title: 'Verify OpenDyslexic contrast ratios in dark mode', priority: 'Low', due: 'Upcoming', done: true },
  { id: 't-6', noteId: 'note-3', title: 'Export dark and paper tokens to the engineering repo', priority: 'Medium', due: 'Today', done: false },
  { id: 't-7', noteId: 'note-5', title: 'Keep both versions when two devices edit offline', priority: 'High', due: 'Upcoming', done: false },
  { id: 't-8', noteId: 'note-6', title: 'Profile graph view with 500 nodes', priority: 'Low', due: 'Upcoming', done: false },
];
const MOCK_T7_STEPS = [{ t: 'Edit the same test note on two devices', m: 10, done: true }, { t: 'Write down which version won', m: 3, done: false }, { t: 'Sketch the "both versions" banner', m: 5, done: false }, { t: 'Share the sketch in #sync', m: 2, done: false }];
const MOCK_STRESS_TOPICS = ['Customer interview synthesis: onboarding friction for first-time vault users migrating from other apps', 'Weekly sync', 'Bug bash', 'Design critique', 'Release checklist', 'Retro', 'Spec', 'Ideas'];
const MOCK_STRESS_NOTES = Array.from({ length: 34 }, (_, k) => { const i = k + 7; return { id: 'note-' + i, title: `${MOCK_STRESS_TOPICS[i % MOCK_STRESS_TOPICS.length]} ${i}`, md: `## Summary\nNote ${i} body.\n{{tasks}}` }; });
