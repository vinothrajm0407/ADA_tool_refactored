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
    const err = new Error('token_expired');
    err.status = 401;
    throw err;
  }

  return res;
}
