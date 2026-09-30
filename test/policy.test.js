import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGlob, evaluatePolicy } from '../src/policy.js';

const pr = { state: 'open', draft: false, additions: 500, deletions: 499, changed_files: 1 };
const files = [{ filename: 'src/main.js', status: 'modified' }];

test('line threshold is strict and includes deletions', () => {
  assert.equal(evaluatePolicy(pr, files).eligible, true);
  assert.equal(evaluatePolicy({ ...pr, deletions: 500 }, files).eligible, false);
});

test('instruction additions, deletions and both sides of renames are blocked', () => {
  for (const path of ['.github/copilot-instructions.md', '.github/instructions/a/b.instructions.md',
    '.github/skills/code-review/SKILL.md', '.github/agents/reviewer.agent.md', '.github/prompts/review.prompt.md',
    'AGENTS.md', 'src/CLAUDE.md']) {
    for (const status of ['added', 'removed', 'modified']) {
      assert.equal(evaluatePolicy(pr, [{ filename: path, status }]).eligible, false);
    }
    assert.equal(evaluatePolicy(pr, [{ filename: 'doc.md', status: 'renamed', previous_filename: path }]).eligible, false);
    assert.equal(evaluatePolicy(pr, [{ filename: path, status: 'renamed', previous_filename: 'doc.md' }]).eligible, false);
  }
});

test('allowlist alone, denylist alone, and combined lists', () => {
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['src/**'] }).eligible, true);
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['docs/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, files, { denylist: ['src/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, files, { allowlist: ['src/**'], denylist: ['**/main.js'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ filename: '.github/copilot-instructions.md' }], { allowlist: ['**'] }).eligible, false);
});

test('every changed path and the old name must be allowed', () => {
  assert.equal(evaluatePolicy({ ...pr, changed_files: 2 }, [...files, { filename: 'secret.txt' }], { allowlist: ['src/**'] }).eligible, false);
  assert.equal(evaluatePolicy(pr, [{ filename: 'src/main.js', status: 'renamed', previous_filename: 'secret.txt' }], { allowlist: ['src/**'] }).eligible, false);
});

test('incomplete metadata, draft and closed PRs fail closed', () => {
  for (const override of [{ changed_files: 2 }, { additions: undefined }, { deletions: -1 }, { draft: true }, { state: 'closed' }]) {
    assert.equal(evaluatePolicy({ ...pr, ...override }, files).eligible, false);
  }
  assert.equal(evaluatePolicy(pr, [{ filename: 'src/main.js', status: 'renamed' }]).eligible, false);
});

test('glob semantics and invalid configuration', () => {
  assert.ok(compileGlob('**/AGENTS.md').test('AGENTS.md'));
  assert.ok(compileGlob('src/**/*.js').test('src/main.js'));
  assert.ok(compileGlob('src/**/*.js').test('src/deep/main.js'));
  assert.equal(compileGlob('src/*.js').test('src/deep/main.js'), false);
  assert.ok(compileGlob('file?.txt').test('file1.txt'));
  for (const glob of ['!src/**', '../src/**', '/src/**', 'src/{a,b}']) assert.throws(() => compileGlob(glob));
  for (const limit of [0, -1, NaN, 1.2, '1000']) assert.throws(() => evaluatePolicy(pr, files, { maxChangedLines: limit }));
});
