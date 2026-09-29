/**
 * `\`, `%` and `_` as themselves inside a `like`/`ilike` pattern, for a term an
 * admin typed. Unescaped, `%` and `_` match anything and a trailing `\` makes
 * Postgres reject the pattern outright (a 500). `\` is Postgres's default
 * escape character, so no `ESCAPE` clause is needed.
 */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');
