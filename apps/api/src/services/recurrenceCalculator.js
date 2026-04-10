import { DateTime } from 'luxon';

/**
 * Compute the next occurrence after `current` for the given recurrence type.
 * Uses `timezone` for day-of-week recurrence (weekdays/weekends/weekly).
 * Returns a JS Date, or null if recurrence === 'never'.
 */
export function nextOccurrence(current, recurrence, timezone) {
  if (recurrence === 'never') return null;
  const dt = DateTime.fromJSDate(current).setZone(timezone || 'UTC');

  switch (recurrence) {
    case 'hourly':        return dt.plus({ hours:  1 }).toJSDate();
    case 'daily':         return dt.plus({ days:   1 }).toJSDate();
    case 'weekly':        return dt.plus({ weeks:  1 }).toJSDate();
    case 'fortnightly':   return dt.plus({ weeks:  2 }).toJSDate();
    case 'monthly':       return dt.plus({ months: 1 }).toJSDate();  // Luxon clamps to last day of month
    case 'every_3_months':return dt.plus({ months: 3 }).toJSDate();
    case 'every_6_months':return dt.plus({ months: 6 }).toJSDate();
    case 'yearly':        return dt.plus({ years:  1 }).toJSDate();
    case 'weekdays': {
      let n = dt.plus({ days: 1 });
      while (n.weekday === 6 || n.weekday === 7) n = n.plus({ days: 1 });
      return n.toJSDate();
    }
    case 'weekends': {
      let n = dt.plus({ days: 1 });
      while (n.weekday !== 6 && n.weekday !== 7) n = n.plus({ days: 1 });
      return n.toJSDate();
    }
    default: return null;
  }
}
