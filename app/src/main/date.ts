/** Format a Date as a calendar date in the machine's local timezone. */
export function localDateString(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Add calendar days locally so UTC offsets and DST do not move the date boundary. */
export function localDatePlusDays(days: number, value: Date = new Date()): string {
  const result = new Date(value.getTime());
  result.setDate(result.getDate() + days);
  return localDateString(result);
}
