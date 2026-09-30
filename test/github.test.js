import test from 'node:test';
import assert from 'node:assert/strict';
import { githubClient } from '../src/github.js';

test('REST pagination includes files beyond the first page', async () => {
  const paths = [];
  const api = githubClient('test-token', 'https://api.github.com', async (url, options) => {
    paths.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, status: 200, json: async () => new URL(url).searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  });
  assert.equal((await api.list('/files')).length, 101);
  assert.equal(paths.length, 2);
});

test('API failures never return partial success', async () => {
  const api = githubClient('secret-token', undefined, async () => ({ ok: false, status: 403 }));
  await assert.rejects(api.list('/files'), /failed \(403\)/);
  assert.throws(() => githubClient(''), /required/);
});
