import test from 'node:test';
import assert from 'node:assert/strict';
import { runApproval, decisionComment } from '../src/decision.js';
import { copilotLogin } from '../src/copilot.js';

function scenario({ filename = 'README.md', reviews } = {}) {
  const writes = [];
  const pr = { state: 'open', draft: false, additions: 1, deletions: 0, changed_files: 1,
    head: { sha: 'head' }, base: { sha: 'base' } };
  const positive = { id: 10, user: { login: copilotLogin, type: 'Bot' }, state: 'COMMENTED',
    body: '### 🟢 Approval recommended', commit_id: 'head', submitted_at: '2026-09-30T22:00:00Z' };
  const api = {
    async request(path, method = 'GET', body) {
      if (method === 'POST') { writes.push({ path, body }); return { id: writes.length + 20 }; }
      return pr;
    },
    async list(path) { return path.endsWith('/files') ? [{ filename }] : reviews ?? [positive]; },
  };
  return { writes, run: options => runApproval({ api, repository: 'owner/repo', number: 2, ...options }) };
}

test('successful approval posts a decision comment by default after the review', async () => {
  const s = scenario();
  const result = await s.run();
  assert.equal(result.approved, true);
  assert.equal(s.writes[0].body.event, 'APPROVE');
  assert.equal(s.writes[1].path, '/repos/owner/repo/issues/2/comments');
  assert.match(s.writes[1].body.body, /gha-approval: approved/);
  assert.match(s.writes[1].body.body, /head/);
  assert.equal(result.decisionCommentId, 22);
});

test('blocked decisions post their reasons without submitting an approving review', async () => {
  for (const options of [{ filename: '.github/copilot-instructions.md' }, { reviews: [] }]) {
    const s = scenario(options);
    const result = await s.run();
    assert.equal(result.eligible, false);
    assert.equal(s.writes.length, 1);
    assert.match(s.writes[0].path, /\/comments$/);
    assert.match(s.writes[0].body.body, /gha-approval: blocked/);
    assert.match(s.writes[0].body.body, options.reviews ? /does not explicitly recommend approval/ : /Blocked path/);
  }
});

test('comment opt-out works for approved and blocked PRs', async () => {
  const approved = scenario();
  assert.equal((await approved.run({ postComment: false })).approved, true);
  assert.equal(approved.writes.length, 1);
  const blocked = scenario({ reviews: [] });
  assert.equal((await blocked.run({ postComment: false })).approved, false);
  assert.equal(blocked.writes.length, 0);
});

test('first-review-only rejection posts an explanation without submitting an approval', async () => {
  const s = scenario({ reviews: [
    { id: 9, user: { login: copilotLogin, type: 'Bot' }, state: 'DISMISSED', body: '',
      commit_id: 'old', submitted_at: '2026-09-29T22:00:00Z' },
    { id: 10, user: { login: copilotLogin, type: 'Bot' }, state: 'COMMENTED', body: '### 🟢 Approval recommended',
      commit_id: 'head', submitted_at: '2026-09-30T22:00:00Z' },
  ] });
  const result = await s.run({ firstReviewOnly: true });
  assert.equal(result.eligible, false);
  assert.equal(result.approved, false);
  assert.equal(s.writes.length, 1);
  assert.match(s.writes[0].path, /\/comments$/);
  assert.match(s.writes[0].body.body, /gha-approval: blocked/);
  assert.match(s.writes[0].body.body, /first-review-only.*more than one review/);
});

test('dry runs never submit reviews or decision comments', async () => {
  for (const options of [{}, { reviews: [] }]) {
    const s = scenario(options);
    await s.run({ dryRun: true });
    assert.equal(s.writes.length, 0);
  }
});

test('skipped duplicate approvals have a distinct comment status', async () => {
  const s = scenario({ reviews: [
    { id: 10, user: { login: copilotLogin, type: 'Bot' }, state: 'COMMENTED', body: '### 🟢 Approval recommended',
      commit_id: 'head', submitted_at: '2026-09-30T22:00:00Z' },
    { id: 11, user: { login: 'github-actions[bot]', type: 'Bot' }, state: 'APPROVED', body: '<!-- gha-approval -->', commit_id: 'head' },
  ] });
  assert.equal((await s.run()).approved, false);
  assert.equal(s.writes.length, 1);
  assert.match(s.writes[0].body.body, /gha-approval: approval skipped/);
  assert.match(s.writes[0].body.body, /already exists/);
});

test('untrusted reason text is escaped and large reason lists are bounded', () => {
  const body = decisionComment({ approved: false, eligible: false, headSha: 'head',
    reasons: Array.from({ length: 30 }, () => 'Blocked path: </pre><img src=x>') });
  assert.match(body, /&lt;\/pre&gt;&lt;img src=x&gt;/);
  assert.equal(body.includes('<img src=x>'), false);
  assert.match(body, /Showing 20 of 30 reasons/);
});

test('invalid comment configuration fails before any API writes', async () => {
  const s = scenario();
  await assert.rejects(s.run({ postComment: 'false' }), /must be true or false/);
  assert.equal(s.writes.length, 0);
});
