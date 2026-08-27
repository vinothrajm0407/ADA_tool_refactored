import { PLATFORM_URL } from '../config/constants.js'

// Module-level token cache — set once on auth, cleared on logout.
// This mirrors how apiFetch in the web app always has the token available
// from sessionStorage, except here we cache in memory after reading from
// chrome.storage.local on popup mount.
let _token = null

export function setToken(token) {
  _token = token
}

export function clearToken() {
  _token = null
}

/**
 * Drop-in equivalent of src/utils/api.js from the web app.
 * Differences:
 *   - Prepends PLATFORM_URL (extension is cross-origin, cannot use relative paths)
 *   - Reads token from module cache (set via setToken) instead of sessionStorage
 */
export function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) }
  if (_token) headers['Authorization'] = `Bearer ${_token}`
  return fetch(`${PLATFORM_URL}${path}`, { ...opts, headers })
}
