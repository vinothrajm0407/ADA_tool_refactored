import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CRAWL_ID_KEY = 'ada_crawl_id';
const AUTH_KEY     = 'ada_auth';
const POST_AUTH_REDIRECT_KEY = 'ada_post_auth_redirect';
const REDUCED_MOTION_KEY = 'ada-tool-reduced-motion';

const PAGE_TO_PATH = {
  landing:              '/',
  login:                '/login',
  signup:               '/signup',
  'verify-email':       '/verify-email',
  'forgot-password':    '/forgot-password',
  'reset-password':     '/reset-password',
  dashboard:            '/dashboard',
  'new-scan':           '/new-scan',
  'scan-history':       '/scan-history',
  'crawl-results':      '/crawl-results',
  'crawl-schedules':    '/crawl-schedules',
  'executive-summary':  '/executive-summary',
  alerts:               '/alerts',
  'keyboard-test':      '/keyboard-test',   // legacy route — kept for backward compat
  'assistive-test':     '/assistive-test',
  'assistive-results':  '/assistive-results',
  'wcag-reference':     '/wcag-reference',
  integrations:         '/integrations',
  settings:             '/settings',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page])
);

function pageFromPath(pathname) {
  return PATH_TO_PAGE[pathname] ?? 'landing';
}

function getInitialPage() {
  try {
    const params = new URLSearchParams(window.location.search);
    const extPage = params.get('_ext_page');
    if (extPage && PAGE_TO_PATH[extPage]) return extPage;
  } catch {}
  return pageFromPath(window.location.pathname);
}

function readStoredCrawlId() {
  try { return sessionStorage.getItem(CRAWL_ID_KEY) || null; } catch { return null; }
}

function readStoredPostAuthRedirect() {
  try { return sessionStorage.getItem(POST_AUTH_REDIRECT_KEY) || null; } catch { return null; }
}

function readStoredAuth() {
  // Extension auth handoff: _ext_auth param carries {token, user} JSON from the popup.
  // Read it synchronously before first render so we never flash the login screen.
  try {
    const params = new URLSearchParams(window.location.search);
    const extAuth = params.get('_ext_auth');
    if (extAuth) {
      const parsed = JSON.parse(decodeURIComponent(extAuth));
      if (parsed.token && parsed.user) {
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch {}

  try {
    const raw = localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);
    if (!raw) return { user: null, token: null };
    return JSON.parse(raw);
  } catch {
    return { user: null, token: null };
  }
}

export const AppContext = createContext({
  dark: false,
  setDark: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
  activePage: 'landing',
  navigate: () => {},
  crawlId: null,
  setCrawlId: () => {},
  clearCrawlId: () => {},
  postAuthRedirect: null,
  setPostAuthRedirect: () => {},
  sidebarOpen: true,
  setSidebarOpen: () => {},
  scanHistoryId: null,
  setScanHistoryId: () => {},
  wcagCriterionId: null,
  setWcagCriterionId: () => {},
  pendingAssistiveUrl: '',
  setPendingAssistiveUrl: () => {},
  pendingAssistiveModule: null,
  setPendingAssistiveModule: () => {},
  pendingScanHistoryTab: null,
  setPendingScanHistoryTab: () => {},
  assistiveResult: null,
  setAssistiveResult: () => {},
  scanSessions: [],
  activeScanSessionId: null,
  setActiveScanSessionId: () => {},
  createScanSession: () => {},
  createDraftScanSession: () => {},
  updateScanSession: () => {},
  closeScanSession: () => {},
  updateSessionAutoFix: () => {},
  updateSessionAssistive: () => {},
  user: null,
  token: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function AppProvider({ children }) {
  // Light-only app — no dark mode. `dark`/`setDark` stay in context as an
  // always-false, no-op pair so any not-yet-updated consumer keeps working.
  const dark = false;
  const setDark = useCallback(() => {}, []);

  const [reducedMotion, setReducedMotion] = useState(() => {
    try { return localStorage.getItem(REDUCED_MOTION_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', reducedMotion ? 'true' : 'false');
    try { localStorage.setItem(REDUCED_MOTION_KEY, String(reducedMotion)); } catch {}
  }, [reducedMotion]);

  const [activePage, setActivePage] = useState(getInitialPage);
  const [crawlId, setCrawlIdState] = useState(readStoredCrawlId);
  const [postAuthRedirect, setPostAuthRedirectState] = useState(readStoredPostAuthRedirect);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scanHistoryId, setScanHistoryId] = useState(null);
  const [wcagCriterionId, setWcagCriterionId] = useState(null);
  const [pendingAssistiveUrl, setPendingAssistiveUrl] = useState('');
  const [pendingAssistiveModule, setPendingAssistiveModule] = useState(null);
  const [pendingScanHistoryTab, setPendingScanHistoryTab] = useState(null);
  const [assistiveResult, setAssistiveResult] = useState(null);

  // Scan sessions — lives here (not inside NewScanPage) specifically so a scan's
  // results and any in-progress Auto-Fix runs survive navigating to another
  // sidebar section and back, instead of being destroyed when the page unmounts.
  const [scanSessions, setScanSessions] = useState([]);
  const [activeScanSessionId, setActiveScanSessionIdState] = useState(null);

  const setActiveScanSessionId = useCallback((id) => {
    setActiveScanSessionIdState(id);
  }, []);

  const createScanSession = useCallback((url, includeBestPractices) => {
    const id = (crypto.randomUUID && crypto.randomUUID()) || `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = {
      id, url, includeBestPractices,
      phase: 'scanning', result: null, error: '',
      autoFixState: {},
      assistiveState: {},
    };
    setScanSessions(prev => [...prev, session]);
    setActiveScanSessionIdState(id);
    return id;
  }, []);

  // An empty, not-yet-run tab — lets someone open several "new scan" tabs at
  // once (each keeping its own typed-but-unsubmitted URL) instead of there
  // only ever being one shared blank compose form. Converts in place into a
  // real running session (via updateScanSession) once its scan actually starts.
  const createDraftScanSession = useCallback(() => {
    const id = (crypto.randomUUID && crypto.randomUUID()) || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = {
      id, url: '', includeBestPractices: false,
      phase: 'draft', result: null, error: '',
      autoFixState: {},
      assistiveState: {},
    };
    setScanSessions(prev => [...prev, session]);
    setActiveScanSessionIdState(id);
    return id;
  }, []);

  const updateScanSession = useCallback((id, updater) => {
    setScanSessions(prev => prev.map(s => {
      if (s.id !== id) return s;
      const patch = typeof updater === 'function' ? updater(s) : updater;
      return { ...s, ...patch };
    }));
  }, []);

  const closeScanSession = useCallback((id) => {
    setScanSessions(prev => prev.filter(s => s.id !== id));
    setActiveScanSessionIdState(prev => (prev === id ? null : prev));
  }, []);

  // Per-violation Auto-Fix state (idle/running/done + result), keyed by rule id +
  // a hash of the element's HTML — same node-signature idea the backend uses for
  // dedup. Backed by context (not component useState) so an in-flight fetch's
  // state update still lands even if the component that started it has unmounted.
  const updateSessionAutoFix = useCallback((sessionId, fixKey, updater) => {
    setScanSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const prevFix = s.autoFixState[fixKey];
      const patch = typeof updater === 'function' ? updater(prevFix) : updater;
      return { ...s, autoFixState: { ...s.autoFixState, [fixKey]: patch } };
    }));
  }, []);

  // Inline "Run Assistive Test" results, keyed by module id — same reasoning
  // as autoFixState: lives here so results/in-flight state survive navigation.
  // Passing undefined/null as the patch removes that module's card entirely.
  const updateSessionAssistive = useCallback((sessionId, moduleId, updater) => {
    setScanSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const prevState = s.assistiveState[moduleId];
      const patch = typeof updater === 'function' ? updater(prevState) : updater;
      const nextAssistiveState = { ...s.assistiveState };
      if (patch == null) delete nextAssistiveState[moduleId];
      else nextAssistiveState[moduleId] = patch;
      return { ...s, assistiveState: nextAssistiveState };
    }));
  }, []);

  const stored = readStoredAuth();
  const [user, setUser] = useState(stored.user);
  const [token, setToken] = useState(stored.token);

  const login = useCallback((userData, tokenValue, remember) => {
    setUser(userData);
    setToken(tokenValue);
    const payload = JSON.stringify({ user: userData, token: tokenValue });
    try {
      if (remember) {
        localStorage.setItem(AUTH_KEY, payload);
        sessionStorage.removeItem(AUTH_KEY);
      } else {
        sessionStorage.setItem(AUTH_KEY, payload);
        localStorage.removeItem(AUTH_KEY);
      }
    } catch {}
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    try {
      sessionStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_KEY);
    } catch {}
  }, []);

  function setCrawlId(id) {
    try {
      if (id) sessionStorage.setItem(CRAWL_ID_KEY, id);
      else sessionStorage.removeItem(CRAWL_ID_KEY);
    } catch {}
    setCrawlIdState(id);
  }

  function clearCrawlId() {
    setCrawlId(null);
  }

  function setPostAuthRedirect(page) {
    try {
      if (page) sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, page);
      else sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    } catch {}
    setPostAuthRedirectState(page);
  }

  function navigate(page) {
    const path = PAGE_TO_PATH[page] ?? '/';
    window.history.pushState({ page }, '', path);
    setActivePage(page);
    setScanHistoryId(null);
    if (page !== 'wcag-reference') setWcagCriterionId(null);
  }

  // Clean up extension handoff params from the URL so they're not visible or bookmarked.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('_ext_auth')) {
      const targetPage = params.get('_ext_page') ?? 'scan-history';
      const cleanPath  = PAGE_TO_PATH[targetPage] ?? '/scan-history';
      window.history.replaceState({ page: targetPage }, '', cleanPath);
    }
  }, []);

  // Deep link from a Slack/Teams report ("View Report" button): ?crawlId=X or ?scanId=X.
  // Safe to run pre-auth — state set here survives the SPA's own login flow.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedCrawlId = params.get('crawlId');
    const linkedScanId  = params.get('scanId');
    if (linkedCrawlId) {
      setCrawlId(linkedCrawlId);
      setActivePage('crawl-results');
      window.history.replaceState({ page: 'crawl-results' }, '', '/crawl-results');
    } else if (linkedScanId) {
      setScanHistoryId(linkedScanId);
      setActivePage('scan-history');
      window.history.replaceState({ page: 'scan-history' }, '', '/scan-history');
    }
  }, []);

  useEffect(() => {
    function handlePopState(event) {
      const page = event.state?.page ?? pageFromPath(window.location.pathname);
      setActivePage(page);
      setScanHistoryId(null);
    }
    window.addEventListener('popstate', handlePopState);
    const initialPage = pageFromPath(window.location.pathname);
    window.history.replaceState({ page: initialPage }, '', window.location.pathname);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      setUser(null);
      setToken(null);
      try { sessionStorage.removeItem(AUTH_KEY); } catch {}
      setActivePage('login');
      window.history.pushState({ page: 'login' }, '', '/login');
    }
    window.addEventListener('ada:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('ada:auth-expired', handleAuthExpired);
  }, []);

  return (
    <AppContext.Provider
      value={{
        dark,
        setDark,
        reducedMotion,
        setReducedMotion,
        activePage,
        navigate,
        crawlId,
        setCrawlId,
        clearCrawlId,
        postAuthRedirect,
        setPostAuthRedirect,
        sidebarOpen,
        setSidebarOpen,
        scanHistoryId,
        setScanHistoryId,
        wcagCriterionId,
        setWcagCriterionId,
        pendingAssistiveUrl,
        setPendingAssistiveUrl,
        pendingAssistiveModule,
        setPendingAssistiveModule,
        pendingScanHistoryTab,
        setPendingScanHistoryTab,
        assistiveResult,
        setAssistiveResult,
        scanSessions,
        activeScanSessionId,
        setActiveScanSessionId,
        createScanSession,
        createDraftScanSession,
        updateScanSession,
        closeScanSession,
        updateSessionAutoFix,
        updateSessionAssistive,
        user,
        token,
        isAuthenticated: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
