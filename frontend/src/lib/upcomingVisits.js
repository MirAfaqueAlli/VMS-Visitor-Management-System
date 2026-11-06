// frontend/src/lib/upcomingVisits.js
// Groups the gate's upcoming visits by day: today, tomorrow, the next two days, later.

/** "2026-11-06" + n days → "2026-11-08" (calendar dates, no time zone involved). */
export const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
const weekday = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

/** The tabs for a list of visits: today, +1, +2, +3, later — with counts. */
export function upcomingGroups(visits, today) {
  const days = [0, 1, 2, 3].map((n) => addDays(today, n));
  const groups = [
    { id: days[0], label: "Today", rows: [] },
    { id: days[1], label: "Tomorrow", rows: [] },
    { id: days[2], label: weekday(days[2]), rows: [] },
    { id: days[3], label: weekday(days[3]), rows: [] },
    { id: "later", label: "Later", rows: [] },
  ];
  for (const v of visits) {
    const g = groups.find((x) => x.id === v.day) || groups[4];
    g.rows.push(v);
  }
  return groups;
}
