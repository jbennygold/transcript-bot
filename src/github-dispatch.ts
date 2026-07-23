const DISPATCH_URL =
  'https://api.github.com/repos/jbennygold/transcript-app/actions/workflows/new-episodes.yml/dispatches';

export interface DispatchResult {
  ok: boolean;
  status: number;
}

/**
 * Trigger the "Check New Episodes" GitHub Action via workflow_dispatch.
 * Success is HTTP 204 No Content. `fetchFn` is injectable for testing.
 */
export async function triggerNewEpisodesWorkflow(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DispatchResult> {
  const res = await fetchFn(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'transcript-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'master' }),
  });
  return { ok: res.status === 204, status: res.status };
}
