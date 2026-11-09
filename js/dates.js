// Local calendar dates as "YYYY-MM-DD" strings. All math goes through UTC so DST never shifts a day.
const pad = (n) => String(n).padStart(2, "0");

export function dayOf(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const today = () => dayOf(new Date());

function toUTC(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const addDays = (s, n) => fromUTC(toUTC(s) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000); // b - a
export const weekday = (s) => new Date(toUTC(s)).getUTCDay(); // 0 = Sunday
export const daysInMonth = (s) => {
  const [y, m] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthStart = (s) => s.slice(0, 8) + "01";
export const monthEnd = (s) => s.slice(0, 8) + pad(daysInMonth(s));
export const dayOfMonth = (s) => Number(s.slice(8, 10));

export function addMonths(s, n, wantDay) {
  const [y, m, d] = s.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const first = `${ny}-${pad(nm)}-01`;
  return `${ny}-${pad(nm)}-${pad(Math.min(wantDay || d, daysInMonth(first)))}`;
}

// Next occurrence after `s` for a repeat rule. `day` keeps the original day of month (so the 31st stays the 31st when it can).
export function nextDate(s, freq, day) {
  switch (freq) {
    case "weekly": return addDays(s, 7);
    case "biweekly": return addDays(s, 14);
    case "semimonthly": {
      const d = dayOfMonth(s);
      return d < 15 ? s.slice(0, 8) + "15" : addMonths(s.slice(0, 8) + "01", 1, 1);
    }
    case "monthly": return addMonths(s, 1, day);
    case "quarterly": return addMonths(s, 3, day);
    case "yearly": return addMonths(s, 12, day);
    default: return null; // "once"
  }
}

export const FREQS = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  semimonthly: "1st & 15th",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
  once: "Just once",
};
// Rough number of times per month, for monthly totals.
export const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function pretty(s, opts = {}) {
  const t = today();
  if (!opts.full) {
    if (s === t) return "Today";
    if (s === addDays(t, -1)) return "Yesterday";
    if (s === addDays(t, 1)) return "Tomorrow";
  }
  const [y, m, d] = s.split("-").map(Number);
  const base = `${DOW[weekday(s)]}, ${MON[m - 1]} ${d}`;
  return y !== Number(t.slice(0, 4)) ? `${base}, ${y}` : base;
}
export const shortDate = (s) => {
  const [, m, d] = s.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
};
export const dowName = (i) => DOW[i];
export const monthName = (s) => MON[Number(s.slice(5, 7)) - 1];

// For use mid-sentence: "today", "tomorrow", but "Wed, Nov 11" keeps its capitals.
export const prettyIn = (s, opts) => {
  const p = pretty(s, opts);
  return ["Today", "Yesterday", "Tomorrow"].includes(p) ? p.toLowerCase() : p;
};
