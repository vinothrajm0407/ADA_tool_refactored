import { describe, it, expect } from 'vitest';
import { compareRows } from './LoginComparePanel';

describe('compareRows', () => {
  it('splits pages into both / only logged in / only signed out', () => {
    const signedOut = [
      { normalized_url: 'a/', url: 'https://a/' },
      { normalized_url: 'a/account', url: 'https://a/account' },   // redirected to login when signed out
      { normalized_url: 'a/signin', url: 'https://a/signin' },
    ];
    const loggedIn = [
      { normalized_url: 'a/', url: 'https://a/', section: 'before_login' },
      { normalized_url: 'a/account', url: 'https://a/account', section: 'after_login' },
      { normalized_url: 'a/orders', url: 'https://a/orders', section: 'after_login' },
      { normalized_url: 'a/login', url: 'https://a/login', section: 'before_login' },   // its login page, scanned signed out
    ];
    const g = Object.fromEntries(['both', 'logged_in', 'signed_out'].map((k) => [k, compareRows(signedOut, loggedIn, 'https://a/login/').filter((r) => r.group === k).map((r) => r.url)]));
    expect(g.both).toEqual(['https://a/']);
    expect(g.logged_in).toEqual(['https://a/account', 'https://a/orders']);
    expect(g.signed_out).toEqual(['https://a/login', 'https://a/signin']);
  });
});
