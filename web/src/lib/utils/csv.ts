/**
 * Dependency-free CSV serialisation (Epic 3, Story 4 — R9, BR6).
 *
 * The Transactions Export builds its CSV CLIENT-SIDE from the already-loaded,
 * currently-filtered set (project-brief §9 step 3) — there is no server-side
 * export endpoint. This module is a small, pure, dependency-free serialiser so
 * the export path is easy to reason about and re-use; no CSV library is pulled
 * in (the format we need — header row + RFC-4180 field escaping — is trivial).
 */

/**
 * A single export column: its header label and how to read the cell value from
 * a row. The value accessor returns whatever should appear in the cell; it is
 * stringified and escaped by {@link toCsv}, so it may return a number or string.
 */
export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number;
}

/**
 * Escapes a single CSV field per RFC 4180: a field containing a comma, double
 * quote, or newline is wrapped in double quotes, and any embedded double quote
 * is doubled. Other fields pass through unquoted.
 */
function escapeField(raw: string | number): string {
  const value = String(raw);
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialises `rows` to a CSV string: a header row built from each column's
 * `header`, then one line per row reading each column's `value`. Fields are
 * escaped with {@link escapeField}; lines are joined with CRLF (RFC 4180). The
 * row-set is exactly what the caller passes — the Export caller passes the
 * currently-filtered set so the CSV equals that set (BR6).
 */
export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const header = columns.map((col) => escapeField(col.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => escapeField(col.value(row))).join(','),
  );
  return [header, ...lines].join('\r\n');
}
