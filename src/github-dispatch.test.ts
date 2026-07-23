import test from 'node:test';
import assert from 'node:assert/strict';
import { triggerNewEpisodesWorkflow } from './github-dispatch.js';

function fakeFetch(status: number, capture?: (url: string, init: RequestInit) => void) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

test('returns ok on 204 and posts to the correct endpoint with ref master', async () => {
  let seenUrl = '';
  let seenInit: RequestInit = {};
  const result = await triggerNewEpisodesWorkflow(
    'tok_abc',
    fakeFetch(204, (url, init) => {
      seenUrl = url;
      seenInit = init;
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(
    seenUrl,
    'https://api.github.com/repos/jbennygold/transcript-app/actions/workflows/new-episodes.yml/dispatches',
  );
  assert.equal(seenInit.method, 'POST');
  const headers = seenInit.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok_abc');
  assert.equal(headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(JSON.parse(String(seenInit.body)), { ref: 'master' });
});

test('returns not-ok on a non-204 status', async () => {
  const result = await triggerNewEpisodesWorkflow('tok_bad', fakeFetch(401));
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
