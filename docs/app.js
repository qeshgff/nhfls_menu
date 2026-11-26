import { initializeCommunity, refreshMenuRatings } from './community.mjs';
import { MEALS, chinaDate, addDays, monday, dateStripStart, weekday, shortDate, weekContains, initialSelection, searchMenus, ingredientTags, mealGroups, escapeHtml as esc } from './menu-utils.mjs';
import { analyzeDish, formatEnergy, ingredientEntries, mealEnergy, menuStatistics, selectedEnergy } from './nutrition.mjs';

const $ = id => document.getElementById(id);
let data, activeWeek, activeDate, view = 'day', activeMeal = 'lunch';
let today = chinaDate();
let statistics, statsPage = 0;
const weekById = id => data.weeks.find(w => w.id === id);
const dayByDate = date => activeWeek.days.find(d => d.date === date);

function ingredients(value) {
  const tags = ingredientTags(value);
  return tags.length ? `<ul class="ingredients" aria-label="食材与克重">${tags.map(tag => `<li class="ingredient-tag">${esc(tag)}</li>`).join('')}</ul>` : '<p class="ingredient-empty">官网未提供食材信息</p>';
}
function nutritionDetails({ energy, hints, reason }) {
  const estimate = energy ? `${energy.missing.length ? '可估食材小计' : energy.kind === 'reference' ? '同类成品参考' : '按公布食材估算'} · ${formatEnergy(energy)}` : '热量暂无法估算';
  const note = energy?.missing.length ? `未计入：${energy.missing.join('、')}` : energy?.references?.join('、') || reason;
  return `<div class="dish-nutrition"><p><strong>${esc(estimate)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</p><div class="allergen-hints"><span>过敏原提示</span>${hints.length ? hints.map(hint => `<span class="allergen-chip" title="${esc(hint.evidence)}">${esc(hint.label)} · ${esc(hint.source)}</span>`).join('') : '<span>现有信息不足以排除过敏原</span>'}</div><small>需向食堂核实配方、调味料及共用器具。</small></div>`;
}
function dishes(items, context = {}) {
  return `<ul class="dish-list">${items.map((dish, i) => {
    const nutrition = analyzeDish(dish);
    const rating = context.date ? `<span class="dish-rating" data-rating-date="${esc(context.date)}" data-rating-meal="${esc(context.meal)}" data-rating-dish="${esc(dish.name)}" hidden></span>` : '';
    return `<li><details><summary><span class="dish-num">${String(i + 1).padStart(2, '0')}</span><span class="dish-name">${esc(dish.name)}${rating}</span>${nutrition.energy ? `<span class="dish-kcal" title="${nutrition.energy.missing.length ? '仅含可估食材' : '参考热量'}">${formatEnergy(nutrition.energy)}</span>` : ''}</summary>${dish.ingredientNote ? `<p class="ingredient-note">${esc(dish.ingredientNote)}</p>` : ''}${ingredients(dish.ingredients)}${nutritionDetails(nutrition)}${context.date ? `<button type="button" class="review-open" data-review-date="${esc(context.date)}" data-review-meal="${esc(context.meal)}" data-review-dish="${esc(dish.name)}">评分与同学评价 ↗</button>` : ''}</details></li>`;
  }).join('')}</ul>`;
}
function mealNutrition(meal, items, date) {
  if (!items.length) return '';
  const estimate = mealEnergy(meal, items);
  const summary = estimate ? `${estimate.incomplete ? '套餐已知部分' : '基础套餐估算'} · ${formatEnergy(estimate)}` : '勾选菜品，计算这顿饭的热量';
  const description = estimate ? '按大荤选一、小荤选一、两种素菜和汤计算。额外主食、糕点、特色餐可另选。' : '套餐组合和份量可能因人而异。';
  const options = mealGroups(meal, items).flatMap(group => group.items.map(dish => ({ dish, group: group.key })));
  return `<details class="meal-nutrition" data-energy-meal="${meal}" data-energy-date="${date}"><summary>${summary}</summary><p>${description} 未公布的油、酱料和用量不计入。</p><fieldset><legend>按实际选菜合计</legend>${options.map(({ dish, group }, index) => `<label><input type="checkbox" data-energy-option="${index}"${group === 'main' || group === 'side' ? ` data-choice-group="${group}"` : ''}> ${esc(dish.name)}</label>`).join('')}</fieldset><output aria-live="polite">勾选你要吃的菜品。</output></details>`;
}
function groupedDishes(meal, items, date = activeDate) {
  const context = { meal, date };
  if (!items.length) return '<p class="week-empty">官网未提供这餐的菜单。</p>';
  const nutrition = mealNutrition(meal, items, date);
  if (meal === 'breakfast') return nutrition + dishes(items, context);
  const groups = mealGroups(meal, items);
  if (groups[0]?.key === 'unclassified') return `${nutrition}<p class="category-note">按官网顺序显示，分类待确认。</p>${dishes(items, context)}`;
  return `${nutrition}<div class="meal-groups">${groups.map(group => `<section class="dish-group ${group.key}" aria-label="${group.title}${group.rule ? ` · ${group.rule}` : ''}"><div class="group-heading"><h4>${group.title}</h4>${group.rule ? `<span class="choice-rule">${group.rule}</span>` : ''}${group.key === 'specialty' ? `<span class="group-count">${group.items.length}种</span>` : ''}</div>${dishes(group.items, context)}</section>`).join('')}</div>`;
}
function safeSource(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ['www.nhfls.com.cn', 'nhfls.com.cn'].includes(u.hostname) ? u.href : 'https://www.nhfls.com.cn/mzsp/list.htm'; }
  catch { return 'https://www.nhfls.com.cn/mzsp/list.htm'; }
}
function refreshVisibleRatings() {
  refreshMenuRatings(view === 'day' || view === 'week' ? $(`${view}-view`) : null);
}
function setView(next) {
  view = next;
  document.querySelectorAll('[data-view]').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  ['day', 'week', 'search', 'stats'].forEach(v => $(`${v}-view`).hidden = v !== view);
  $('menu-toolbar').hidden = view === 'stats';
  $('status').hidden = view === 'stats';
  $('heading').textContent = { day: '今天，吃点什么？', week: '这一周，好好吃饭。', search: '想吃的，都在这里。', stats: '菜谱统计' }[view];
  $('intro').textContent = { day: '学校每周菜单，一眼就能找到。', week: '从周一到周五，提前看看每一顿的小期待。', search: '在已收录的菜单里，找找你喜欢的味道。', stats: '在已收录的菜单中，看看菜品、食材和过敏原提示出现了多少次。' }[view];
  if (view === 'search') renderSearch();
  if (view === 'stats') renderStatistics();
  refreshVisibleRatings();
}
function setWeek(id, date, nextView = view) {
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
  setView(nextView);
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
  $('week-grid').innerHTML = activeWeek.days.map(day => `<article class="week-day"><h3>${weekday(day.date)}<span>${shortDate(day.date)}</span></h3>${groupedDishes(activeMeal, day.meals[activeMeal] || [], day.date)}</article>`).join('');
}
function renderSearch() {
  const query = $('search-input').value.trim();
  if (!query) { $('search-results').innerHTML = '<p class="search-count">输入菜名或食材，看看它哪天出现。</p>'; return; }
  const hits = searchMenus(data.weeks, query);
  $('search-results').innerHTML = `<p class="search-count">找到 ${hits.length} 条结果${hits.length > 100 ? '，先显示最近的 100 条' : ''}</p>` + (hits.length ? hits.slice(0, 100).map(hit => `<article class="search-hit"><div><h3>${esc(hit.name)}</h3><p>${esc(hit.date)} · ${weekday(hit.date)} · ${MEALS[hit.meal].name}${hit.category !== MEALS[hit.meal].name ? ` · ${esc(hit.category)}` : ''}</p>${hit.ingredientNote ? `<p class="ingredient-note">${esc(hit.ingredientNote)}</p>` : ''}${ingredients(hit.ingredients)}${nutritionDetails(analyzeDish(hit))}</div><button data-jump-week="${hit.week}" data-jump-date="${hit.date}">查看当天 →</button></article>`).join('') : '<div class="empty"><h3>还没找到这道菜</h3><p>试试更短的关键词，或换一种食材。</p></div>');
}
function updatePickedEnergy(input) {
  const panel = input.closest('.meal-nutrition');
  const { energyMeal: meal, energyDate: date } = panel.dataset;
  const items = dayByDate(date).meals[meal];
  const choices = mealGroups(meal, items).flatMap(group => group.items);
  if (input.checked && input.dataset.choiceGroup) {
    for (const other of panel.querySelectorAll('input[data-choice-group]:checked')) {
      if (other !== input && other.dataset.choiceGroup === input.dataset.choiceGroup) other.checked = false;
    }
  }
  const picked = [...panel.querySelectorAll('input:checked')].map(box => choices[Number(box.dataset.energyOption)]);
  const value = selectedEnergy(picked);
  panel.querySelector('output').textContent = !picked.length ? '勾选你要吃的菜品。' : !value ? '选中的菜品暂无可估热量。' :
    `已选 ${picked.length} 道 · ${value.missing ? `已知部分 ${formatEnergy(value)} · ${value.missing} 道估算不完整` : formatEnergy(value)}${value.references ? ' · 含同类成品参考' : ''}`;
}
function chartBar(count, max, label, className = '') {
  const width = 100 * count / max;
  return `<div class="stats-chart-series ${className}"><span class="stats-chart-track" aria-hidden="true"><span style="width:${width}%"></span></span><span class="stats-chart-value"><span class="sr-only">${label}：</span>${count}<span class="sr-only"> 次</span></span></div>`;
}
function renderStatistics() {
  statistics ??= menuStatistics(data.weeks);
  const kind = $('stats-kind').value;
  const query = $('stats-query').value.trim().normalize('NFKC');
  const ingredientQuery = kind === 'ingredients' ? ingredientEntries(query)[0]?.name : '';
  const rows = statistics[kind];
  const results = rows.filter(([name]) => name.includes(query) || (ingredientQuery && name.includes(ingredientQuery)));
  const compareAllergens = kind === 'allergens';
  // Reuse the category's scale across searches and pages so bars remain comparable.
  const highest = rows.reduce((max, [, count, possible]) => Math.max(max, count, possible ?? 0), 1);
  const tickSize = Math.max(1, 10 ** Math.floor(Math.log10(highest / 4)) / 2);
  const step = Math.ceil(highest / (4 * tickSize)) * tickSize;
  const max = step * 4;
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  statsPage = Math.max(0, Math.min(statsPage, pages - 1));
  $('stats-coverage').textContent = `${data.weeks.length} 份周菜单 · ${statistics.days} 个供餐日 · ${statistics.rows.toLocaleString('zh-CN')} 条官网菜品记录`;
  $('stats-chart').hidden = results.length === 0;
  $('stats-chart-title').textContent = { dishes:'菜品出现次数', ingredients:'食材出现次数', allergens:'过敏原提示次数' }[kind];
  $('stats-legend').hidden = !compareAllergens;
  $('stats-axis').innerHTML = Array.from({ length: 5 }, (_, tick) => `<span>${tick * step}</span>`).join('');
  $('stats-results').innerHTML = results.slice(statsPage * pageSize, (statsPage + 1) * pageSize).map(([name, count, possible]) => {
    const listed = chartBar(count, max, compareAllergens ? '食材表列出' : '出现');
    return `<li class="stats-chart-item"><span class="stats-chart-label">${esc(name)}</span><div>${listed}${compareAllergens ? chartBar(possible, max, '需核实', 'stats-possible') : ''}</div></li>`;
  }).join('');
  $('stats-empty').hidden = results.length > 0;
  $('stats-page').textContent = results.length ? `${results.length} 项 · 第 ${statsPage + 1} / ${pages} 页` : '0 项';
  $('stats-prev').disabled = statsPage === 0;
  $('stats-next').disabled = statsPage >= pages - 1;
}
function initialize() {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.weeks) || !data.weeks.length) throw new Error('菜单数据为空或版本不支持');
  data.weeks.sort((a, b) => a.start.localeCompare(b.start));
  $('week-select').innerHTML = data.weeks.toReversed().map(w => `<option value="${esc(w.id)}">${esc(w.label)} · ${shortDate(w.start)}—${shortDate(w.end)}</option>`).join('');
  $('week-select').disabled = false;
  const selection = initialSelection(data.weeks, today);
  setWeek(selection.week.id, selection.date, 'day');
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('week-select').addEventListener('change', e => setWeek(e.target.value));
  $('prev-week').addEventListener('click', () => setWeek(data.weeks[data.weeks.indexOf(activeWeek) - 1].id));
  $('next-week').addEventListener('click', () => setWeek(data.weeks[data.weeks.indexOf(activeWeek) + 1].id));
  $('date-strip').addEventListener('click', e => { const button = e.target.closest('[data-date]'); if (!button) return; activeDate = button.dataset.date; renderDates(); renderDay(); refreshVisibleRatings(); });
  $('go-today').addEventListener('click', () => { today = chinaDate(); const w = initialSelection(data.weeks, today).week; setWeek(w.id, today, 'day'); });
  $('meal-tabs').addEventListener('click', e => { const button = e.target.closest('[data-meal]'); if (!button) return; activeMeal = button.dataset.meal; $('meal-tabs').querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button))); renderWeek(); refreshVisibleRatings(); });
  $('main').addEventListener('click', e => { const button = e.target.closest('[data-jump-week]'); if (!button) return; setWeek(button.dataset.jumpWeek, button.dataset.jumpDate, 'day'); $('main').scrollIntoView({ behavior: 'smooth' }); });
  $('search-input').addEventListener('input', renderSearch);
  $('main').addEventListener('change', e => { if (e.target.matches('[data-energy-option]')) updatePickedEnergy(e.target); });
  $('stats-kind').addEventListener('change', () => { statsPage = 0; renderStatistics(); });
  $('stats-query').addEventListener('input', () => { statsPage = 0; renderStatistics(); });
  $('stats-prev').addEventListener('click', () => { statsPage--; renderStatistics(); });
  $('stats-next').addEventListener('click', () => { statsPage++; renderStatistics(); });
  $('print').addEventListener('click', () => { setView('week'); window.print(); });
}
$('today-label').textContent = `${shortDate(today)} · ${weekday(today)}`;
async function load() {
  try {
    const response = await fetch(new URL('./data/menus.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json(); initialize(); initializeCommunity();
  } catch (error) {
    $('status').textContent = '菜单暂时没有加载成功，请刷新重试，或查看学校官网原文。';
    $('status').classList.add('notice');
    $('meal-cards').innerHTML = '<div class="empty"><h3>这次没能端上菜单</h3><p>请检查网络后重试。</p><button id="retry-load" class="text-button">重新加载</button></div>';
    $('retry-load').addEventListener('click', () => location.reload());
    console.error('Menu loading failed:', error);
  }
}
load();
