import { MEALS, chinaDate, addDays, monday, dateStripStart, weekday, shortDate, weekContains, initialSelection, searchMenus, ingredientTags, mealGroups, escapeHtml as esc } from './menu-utils.mjs';

const $ = id => document.getElementById(id);
let data, activeWeek, activeDate, view = 'day', activeMeal = 'lunch';
let today = chinaDate();
const weekById = id => data.weeks.find(w => w.id === id);
const dayByDate = date => activeWeek.days.find(d => d.date === date);

function ingredients(value) {
  const tags = ingredientTags(value);
  return tags.length ? `<ul class="ingredients" aria-label="食材与克重">${tags.map(tag => `<li class="ingredient-tag">${esc(tag)}</li>`).join('')}</ul>` : '<p class="ingredient-empty">官网未提供食材信息</p>';
}
function dishes(items) {
  return `<ul class="dish-list">${items.map((dish, i) => `<li><details><summary><span class="dish-num">${String(i + 1).padStart(2, '0')}</span><span class="dish-name">${esc(dish.name)}</span></summary>${dish.ingredientNote ? `<p class="ingredient-note">${esc(dish.ingredientNote)}</p>` : ''}${ingredients(dish.ingredients)}</details></li>`).join('')}</ul>`;
}
function groupedDishes(meal, items) {
  if (!items.length) return '<p class="week-empty">官网未提供这餐的菜单。</p>';
  if (meal === 'breakfast') return dishes(items);
  const groups = mealGroups(meal, items);
  if (groups[0]?.key === 'unclassified') return `<p class="category-note">按官网顺序显示，分类待确认。</p>${dishes(items)}`;
  return `<div class="meal-groups">${groups.map(group => `<section class="dish-group ${group.key}" aria-label="${group.title}${group.rule ? ` · ${group.rule}` : ''}"><div class="group-heading"><h4>${group.title}</h4>${group.rule ? `<span class="choice-rule">${group.rule}</span>` : ''}${group.key === 'specialty' ? `<span class="group-count">${group.items.length}种</span>` : ''}</div>${dishes(group.items)}</section>`).join('')}</div>`;
}
function safeSource(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ['www.nhfls.com.cn', 'nhfls.com.cn'].includes(u.hostname) ? u.href : 'https://www.nhfls.com.cn/mzsp/list.htm'; }
  catch { return 'https://www.nhfls.com.cn/mzsp/list.htm'; }
}
function setView(next) {
  view = next;
  document.querySelectorAll('[data-view]').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  ['day', 'week', 'search'].forEach(v => $(`${v}-view`).hidden = v !== view);
  $('heading').textContent = { day: '今天，吃点什么？', week: '这一周，好好吃饭。', search: '想吃的，都在这里。' }[view];
  $('intro').textContent = { day: '学校每周菜单，一眼就能找到。', week: '从周一到周五，提前看看每一顿的小期待。', search: '在已收录的菜单里，找找你喜欢的味道。' }[view];
  if (view === 'search') renderSearch();
}
function setWeek(id, date) {
  activeWeek = weekById(id);
  activeDate = date || activeWeek.days[0].date;
  $('week-select').value = id;
  const idx = data.weeks.indexOf(activeWeek);
  $('prev-week').disabled = idx === 0;
  $('next-week').disabled = idx === data.weeks.length - 1;
  $('source-link').href = safeSource(activeWeek.source);
  const time = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  $('updated').textContent = `学校官网公开食谱${time ? ` · 收录于 ${time}` : ''}`;
  renderDates(); renderDay(); renderWeek(); renderStatus();
}
function renderStatus() {
  const el = $('status');
  el.classList.remove('notice');
  if (activeWeek.end < today) { el.textContent = `正在查看历史菜单（${activeWeek.start}—${activeWeek.end}）。尚未收录今天的菜单时，请查看官网。`; el.classList.add('notice'); }
  else if (activeWeek.start > today) { el.textContent = `下一周菜单已收录 · ${shortDate(activeWeek.start)}—${shortDate(activeWeek.end)}，可提前查看。`; }
  else { el.textContent = `已收录 ${activeWeek.label} · 菜谱如有调整，以食堂实际供餐为准。`; }
}
function renderDates() {
  const start = dateStripStart(activeWeek);
  $('date-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i), hasMenu = !!dayByDate(date);
    return `<button class="date-button ${date === activeDate ? 'selected' : ''} ${date === today ? 'today' : ''}" data-date="${date}" aria-pressed="${date === activeDate}" aria-label="${shortDate(date)} ${weekday(date)}${date === today ? ' 今天' : ''}${hasMenu ? '' : ' 无已发布菜单'}"><span class="weekday">${weekday(date)}</span><span class="number">${Number(date.slice(-2))}</span>${hasMenu ? '<span class="dot"></span>' : '<span class="no-menu">未发布</span>'}</button>`;
  }).join('');
}
function renderDay() {
  const day = dayByDate(activeDate);
  $('day-heading').textContent = `${shortDate(activeDate)} · ${weekday(activeDate)}${activeDate === today ? ' · 今天' : ''}`;
  $('day-kicker').textContent = day ? `${activeWeek.label} / DAILY MENU` : 'TAKE A LITTLE BREAK';
  if (!day) {
    const next = data.weeks.flatMap(w => w.days.map(d => ({ week: w.id, date: d.date }))).filter(d => d.date > activeDate).sort((a, b) => a.date.localeCompare(b.date))[0];
    $('meal-cards').innerHTML = `<div class="empty"><div class="empty-icon" aria-hidden="true">♧</div><h3>这一天，尚无已发布菜单</h3><p>可能是休息日，也可能是官网还没有更新。<br>不猜菜单，等学校的下一份好消息。</p>${next ? `<button class="text-button" data-jump-week="${next.week}" data-jump-date="${next.date}">看看${shortDate(next.date)}吃什么 →</button>` : '<a class="text-button" href="https://www.nhfls.com.cn/mzsp/list.htm" target="_blank" rel="noopener noreferrer">去学校官网看看 ↗</a>'}</div>`;
    return;
  }
  $('meal-cards').innerHTML = Object.entries(MEALS).map(([key, meal]) => {
    const items = day.meals[key] || [];
    return `<article class="meal-card ${key}"><div class="meal-head"><span class="meal-symbol" aria-hidden="true">${meal.icon}</span><div><h3>${meal.name}</h3><small>${meal.en}</small></div><span class="meal-count">${key === 'breakfast' ? `${items.length} 道选择` : '套餐 / 特色餐'}</span></div>${groupedDishes(key, items)}</article>`;
  }).join('');
}
function renderWeek() {
  $('week-view').querySelector('h2').textContent = `${activeWeek.label} · ${MEALS[activeMeal].name}`;
  $('week-grid').innerHTML = activeWeek.days.map(day => `<article class="week-day"><h3>${weekday(day.date)}<span>${shortDate(day.date)}</span></h3>${groupedDishes(activeMeal, day.meals[activeMeal] || [])}</article>`).join('');
}
function renderSearch() {
  const query = $('search-input').value.trim();
  if (!query) { $('search-results').innerHTML = '<p class="search-count">输入菜名或食材，看看它哪天出现。</p>'; return; }
  const hits = searchMenus(data.weeks, query);
  $('search-results').innerHTML = `<p class="search-count">找到 ${hits.length} 条结果${hits.length > 100 ? '，先显示最近的 100 条' : ''}</p>` + (hits.length ? hits.slice(0, 100).map(hit => `<article class="search-hit"><div><h3>${esc(hit.name)}</h3><p>${esc(hit.date)} · ${weekday(hit.date)} · ${MEALS[hit.meal].name}${hit.category !== MEALS[hit.meal].name ? ` · ${esc(hit.category)}` : ''}</p>${hit.ingredientNote ? `<p class="ingredient-note">${esc(hit.ingredientNote)}</p>` : ''}${ingredients(hit.ingredients)}</div><button data-jump-week="${hit.week}" data-jump-date="${hit.date}">查看当天 →</button></article>`).join('') : '<div class="empty"><h3>还没找到这道菜</h3><p>试试更短的关键词，或换一种食材。</p></div>');
}
function initialize() {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.weeks) || !data.weeks.length) throw new Error('菜单数据为空或版本不支持');
  data.weeks.sort((a, b) => a.start.localeCompare(b.start));
  $('week-select').innerHTML = [...data.weeks].reverse().map(w => `<option value="${esc(w.id)}">${esc(w.label)} · ${shortDate(w.start)}—${shortDate(w.end)}</option>`).join('');
  $('week-select').disabled = false;
  const selection = initialSelection(data.weeks, today);
  setWeek(selection.week.id, selection.date); setView('day');
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('week-select').addEventListener('change', e => setWeek(e.target.value));
  $('prev-week').addEventListener('click', () => setWeek(data.weeks[data.weeks.indexOf(activeWeek) - 1].id));
  $('next-week').addEventListener('click', () => setWeek(data.weeks[data.weeks.indexOf(activeWeek) + 1].id));
  $('date-strip').addEventListener('click', e => { const button = e.target.closest('[data-date]'); if (!button) return; activeDate = button.dataset.date; renderDates(); renderDay(); });
  $('go-today').addEventListener('click', () => { today = chinaDate(); const w = initialSelection(data.weeks, today).week; setWeek(w.id, today); setView('day'); });
  $('meal-tabs').addEventListener('click', e => { const button = e.target.closest('[data-meal]'); if (!button) return; activeMeal = button.dataset.meal; $('meal-tabs').querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button))); renderWeek(); });
  $('main').addEventListener('click', e => { const button = e.target.closest('[data-jump-week]'); if (!button) return; setWeek(button.dataset.jumpWeek, button.dataset.jumpDate); setView('day'); $('main').scrollIntoView({ behavior: 'smooth' }); });
  $('search-input').addEventListener('input', renderSearch);
  $('print').addEventListener('click', () => { setView('week'); window.print(); });
}
$('today-label').textContent = `${shortDate(today)} · ${weekday(today)}`;
async function load() {
  try {
    const response = await fetch(new URL('./data/menus.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json(); initialize();
  } catch (error) {
    $('status').textContent = '菜单暂时没有加载成功，请刷新重试，或查看学校官网原文。';
    $('status').classList.add('notice');
    $('meal-cards').innerHTML = '<div class="empty"><h3>这次没能端上菜单</h3><p>请检查网络后重试。</p><button id="retry-load" class="text-button">重新加载</button></div>';
    $('retry-load').addEventListener('click', () => location.reload());
    console.error('Menu loading failed:', error);
  }
}
load();
