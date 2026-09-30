// What leaves the app with an admin URL: analytics and the error tracker both
// see page URLs, and the users search puts a customer's phone in `?q=`.
import { describe, expect, it } from 'vitest';
import { stripAdminQuery } from './admin-url';

const ORIGIN = 'https://shop.example';

describe('stripAdminQuery', () => {
  it.each([
    [`${ORIGIN}/admin-panel?page=2`, `${ORIGIN}/admin-panel`],
    [
      `${ORIGIN}/admin-panel/users?q=09121234567#top`,
      `${ORIGIN}/admin-panel/users#top`,
    ],
    ['/admin-panel/users?q=09121234567', '/admin-panel/users'],
    ['/admin-panel/users?q=0912&_rsc=1#top', '/admin-panel/users#top'],
  ])('strips the query from the admin URL %s', (url, expected) => {
    expect(stripAdminQuery(url)).toBe(expected);
  });

  it.each([
    [`${ORIGIN}/shop?q=0912`],
    ['/shop?q=0912'],
    [`${ORIGIN}/admin-panel-archive?q=0912`],
    ['/admin-panelx?q=0912'],
    // Protocol-relative: another host, not a path on this site.
    ['//elsewhere.example/admin-panel?q=0912'],
    ['admin-panel?q=0912'],
    ['not a url'],
    [''],
  ])('leaves %s alone', (url) => {
    expect(stripAdminQuery(url)).toBe(url);
  });

  it('counts an absolute URL as ours only at the origin it is given', () => {
    const elsewhere = 'https://elsewhere.example/admin-panel?q=1';

    expect(stripAdminQuery(elsewhere, ORIGIN)).toBe(elsewhere);
    expect(stripAdminQuery(`${ORIGIN}/admin-panel?q=1`, ORIGIN)).toBe(
      `${ORIGIN}/admin-panel`,
    );
    // With no origin (the error tracker), every absolute URL it holds is ours.
    expect(stripAdminQuery(elsewhere)).toBe(
      'https://elsewhere.example/admin-panel',
    );
  });
});
