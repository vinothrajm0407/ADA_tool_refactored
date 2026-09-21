const AUTH_KEY = 'ada_auth';

function getToken() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw).token ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('ada:auth-expired'));
    // Callers generally do `catch(err => setError(err.message || ...))` — a
    // friendly message here (rather than an internal code) is what briefly
    // shows if that redirect hasn't unmounted the page yet.
    const err = new Error('Your session has expired. Redirecting to login…');
    err.status = 401;
    err.code = 'token_expired';
    throw err;
  }

  return res;
}
