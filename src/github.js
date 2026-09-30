export function githubClient(token, apiUrl = 'https://api.github.com', fetcher = fetch) {
  if (!token) throw new Error('github-token is required.');
  async function request(path, method = 'GET', body) {
    const response = await fetcher(`${apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'gha-approval',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed (${response.status}).`);
    return response.status === 204 ? undefined : response.json();
  }
  async function list(path) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await request(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Expected a paginated GitHub API array.');
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error('Pagination limit exceeded; refusing incomplete data.');
  }
  return { request, list };
}
