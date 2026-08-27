/**
 * Unit tests for src/utils/api.js
 *
 * api.js exports only: apiFetch
 * Token is read from sessionStorage key 'ada_auth' as JSON { token: "..." }
 *
 * Covers:
 *  - apiFetch: attaches Bearer token when token is present in sessionStorage
 *  - apiFetch: no Authorization header when sessionStorage is empty
 *  - apiFetch: fires ada:auth-expired CustomEvent on 401
 *  - apiFetch: throws error with status=401 on 401 response
 *  - apiFetch: returns Response on non-401 status
 *  - apiFetch: does not throw on 403, 404, 500
 *  - apiFetch: merges caller-provided headers with auth header
 *  - apiFetch: does not mutate the original opts object
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from './api.js';

// ── Session storage mock ──────────────────────────────────────────────────────

const _store = {};
const mockSessionStorage = {
  getItem:    (k) => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
  clear:      () => { Object.keys(_store).forEach(k => delete _store[k]); },
};

function storeToken(token) {
  mockSessionStorage.setItem('ada_auth', JSON.stringify({ token }));
}

function clearToken() {
  mockSessionStorage.clear();
}

beforeEach(() => {
  clearToken();
  vi.stubGlobal('sessionStorage', mockSessionStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(status = 200) {
  return Promise.resolve({
    status,
    ok:   status >= 200 && status < 300,
    json: () => Promise.resolve({}),
    headers: new Headers(),
  });
}

// ── apiFetch ──────────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('calls fetch with the provided URL', async () => {
    fetchMock.mockReturnValue(makeResponse(200));
    await apiFetch('/api/history');
    expect(fetchMock).toHaveBeenCalledWith('/api/history', expect.any(Object));
  });

  it('attaches Authorization header when token is in sessionStorage', async () => {
    storeToken('my-jwt-token');
    fetchMock.mockReturnValue(makeResponse(200));
    await apiFetch('/api/history');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('does not attach Authorization header when no token is stored', async () => {
    fetchMock.mockReturnValue(makeResponse(200));
    await apiFetch('/api/history');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('returns the Response object on a 200', async () => {
    fetchMock.mockReturnValue(makeResponse(200));
    const res = await apiFetch('/api/history');
    expect(res.status).toBe(200);
  });

  it('returns the Response object on a 403 (does not throw)', async () => {
    fetchMock.mockReturnValue(makeResponse(403));
    const res = await apiFetch('/api/something');
    expect(res.status).toBe(403);
  });

  it('returns the Response object on a 500 (does not throw)', async () => {
    fetchMock.mockReturnValue(makeResponse(500));
    const res = await apiFetch('/api/something');
    expect(res.status).toBe(500);
  });

  it('throws an error on 401 response', async () => {
    fetchMock.mockReturnValue(makeResponse(401));
    await expect(apiFetch('/api/history')).rejects.toThrow('token_expired');
  });

  it('thrown error on 401 has status property equal to 401', async () => {
    fetchMock.mockReturnValue(makeResponse(401));
    let err = null;
    try {
      await apiFetch('/api/history');
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.status).toBe(401);
  });

  it('dispatches ada:auth-expired CustomEvent on 401', async () => {
    fetchMock.mockReturnValue(makeResponse(401));
    const eventSpy = vi.fn();
    window.addEventListener('ada:auth-expired', eventSpy);
    try {
      await apiFetch('/api/history');
    } catch {
      // expected throw
    }
    expect(eventSpy).toHaveBeenCalledOnce();
    window.removeEventListener('ada:auth-expired', eventSpy);
  });

  it('does not dispatch ada:auth-expired on 403', async () => {
    fetchMock.mockReturnValue(makeResponse(403));
    const eventSpy = vi.fn();
    window.addEventListener('ada:auth-expired', eventSpy);
    await apiFetch('/api/history');
    expect(eventSpy).not.toHaveBeenCalled();
    window.removeEventListener('ada:auth-expired', eventSpy);
  });

  it('passes method and body from opts to fetch', async () => {
    storeToken('tok');
    fetchMock.mockReturnValue(makeResponse(200));
    await apiFetch('/api/scan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: 'https://example.com' }),
    });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toContain('example.com');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('merges caller headers with the auth header', async () => {
    storeToken('tok');
    fetchMock.mockReturnValue(makeResponse(200));
    await apiFetch('/api/scan', {
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
    });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Custom']).toBe('yes');
    expect(opts.headers['Authorization']).toBe('Bearer tok');
  });

  it('does not mutate the original opts.headers object', async () => {
    storeToken('tok');
    fetchMock.mockReturnValue(makeResponse(200));
    const callerHeaders = { 'Content-Type': 'application/json' };
    await apiFetch('/api/scan', { headers: callerHeaders });
    expect(callerHeaders['Authorization']).toBeUndefined();
  });

  it('handles corrupt sessionStorage JSON without throwing', async () => {
    mockSessionStorage.setItem('ada_auth', 'not-valid-json');
    fetchMock.mockReturnValue(makeResponse(200));
    const res = await apiFetch('/api/history');
    // Should not throw; no auth header attached
    expect(res.status).toBe(200);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });
});
