// Pins the pager every paged list shares (the shop, admin products, admin
// orders): page links the caller builds, a current-page marker, and plain text
// instead of a link at either end. A server component; it renders as-is here.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatNumber } from '@/lib/format';
import { Pagination } from './pagination';

afterEach(cleanup);

const hrefFor = (page: number) => `/list?page=${page}`;
const pager = (page: number, totalPages: number) => (
  <Pagination
    page={page}
    totalPages={totalPages}
    hrefFor={hrefFor}
    label="صفحات فهرست"
    event="list-pagination"
  />
);
const pageLink = (n: number) =>
  screen.getByRole('link', { name: `صفحه ${formatNumber(n)}` });

describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(pager(1, 1));
    expect(container.innerHTML).toBe('');
  });

  it('links each page in the window, marks the current one and steps both ways', () => {
    render(pager(2, 3));

    expect(
      screen.getByRole('navigation', { name: 'صفحات فهرست' }),
    ).toBeTruthy();
    expect(pageLink(1).getAttribute('href')).toBe('/list?page=1');
    expect(pageLink(3).getAttribute('href')).toBe('/list?page=3');
    expect(pageLink(2).getAttribute('aria-current')).toBe('page');
    expect(pageLink(3).getAttribute('aria-current')).toBeNull();

    const previous = screen.getByRole('link', { name: 'صفحه قبل' });
    const next = screen.getByRole('link', { name: 'صفحه بعد' });
    expect(previous.getAttribute('href')).toBe('/list?page=1');
    expect(next.getAttribute('href')).toBe('/list?page=3');

    expect(previous.getAttribute('data-umami-event')).toBe(
      'list-pagination-prev',
    );
    expect(pageLink(1).getAttribute('data-umami-event')).toBe(
      'list-pagination-page',
    );
    expect(next.getAttribute('data-umami-event')).toBe('list-pagination-next');
  });

  it('links back when the URL points past a single page of results', () => {
    // 1 to 20 matches plus `?page=2`: the empty-page message needs a way back.
    render(pager(2, 1));

    expect(pageLink(1).getAttribute('href')).toBe('/list?page=1');
    expect(pageLink(1).getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'صفحه قبل' }).getAttribute('href'),
    ).toBe('/list?page=1');
    expect(screen.queryByRole('link', { name: 'صفحه بعد' })).toBeNull();
  });

  it('steps back to the last real page from far past the end', () => {
    render(pager(999, 3));

    // Not 998, which does not exist either.
    expect(
      screen.getByRole('link', { name: 'صفحه قبل' }).getAttribute('href'),
    ).toBe('/list?page=3');
    expect(pageLink(3).getAttribute('aria-current')).toBeNull();
  });

  it('renders nothing when nothing matched, whatever the page', () => {
    const { container } = render(pager(4, 0));
    expect(container.innerHTML).toBe('');
  });

  it('offers no step past either end', () => {
    const { rerender } = render(pager(1, 3));
    expect(screen.queryByRole('link', { name: 'صفحه قبل' })).toBeNull();
    expect(screen.getByRole('link', { name: 'صفحه بعد' })).toBeTruthy();

    rerender(pager(3, 3));
    expect(screen.getByRole('link', { name: 'صفحه قبل' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'صفحه بعد' })).toBeNull();
  });
});
