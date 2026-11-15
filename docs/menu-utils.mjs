export const MEALS = { breakfast: { name: '早餐', en: 'BREAKFAST', icon: '☀' }, lunch: { name: '午餐', en: 'LUNCH', icon: '♨' }, dinner: { name: '晚餐', en: 'DINNER', icon: '☾' } };
export function chinaDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function addDays(iso, count) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function monday(iso) { const day = new Date(`${iso}T12:00:00Z`).getUTCDay(); return addDays(iso, -((day + 6) % 7)); }
export function weekday(iso) { return '周' + '日一二三四五六'[new Date(`${iso}T12:00:00Z`).getUTCDay()]; }
export function shortDate(iso) { const [, m, d] = iso.split('-'); return `${Number(m)}月${Number(d)}日`; }
export function weekContains(week, date) { return monday(week.start) <= date && date <= addDays(monday(week.start), 6); }
export function initialSelection(weeks, today) {
  const current = weeks.find(w => weekContains(w, today));
  if (current) return { week: current, date: today };
  const upcoming = [...weeks].filter(w => w.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const week = upcoming || weeks[weeks.length - 1];
  return { week, date: upcoming ? week.days[0].date : today };
}
export function searchMenus(weeks, query) {
  const q = query.trim().toLocaleLowerCase('zh-CN');
  if (!q) return [];
  return weeks.flatMap(week => week.days.flatMap(day => Object.keys(MEALS).flatMap(meal => (day.meals[meal] || []).filter(d => `${d.name} ${d.ingredients || ''}`.toLocaleLowerCase('zh-CN').includes(q)).map(d => ({ ...d, date: day.date, meal, week: week.id }))))).sort((a, b) => b.date.localeCompare(a.date));
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
