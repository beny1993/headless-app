/**
 * `\`, `%` and `_` as themselves inside a `like`/`ilike` pattern, for a term an
 * admin typed. Unescaped, `%` and `_` match anything, and a `\` escapes the
 * character after it — inside `%…%`, the closing `%` — so the search silently
 * matches the wrong rows. `\` is Postgres's default escape character, so no
 * `ESCAPE` clause is needed.
 */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');
