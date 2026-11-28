import test from 'node:test';
import assert from 'node:assert/strict';
import { chinaDate, monday, dateStripStart, addDays, weekContains, initialSelection, searchMenus, ingredientTags, mealGroups, escapeHtml } from '../docs/menu-utils.mjs';
import { readFileSync } from 'node:fs';
const week = { id:'2026-11-16', start:'2026-11-16', end:'2026-11-20', days:[{date:'2026-11-16', meals:{lunch:[{name:'酸汤牛腩', ingredients:'牛腩110g 土豆30g'}], dinner:[], breakfast:[]}}] };
test('中国日期不依赖访客所在时区', () => assert.equal(chinaDate(new Date('2026-11-15T17:00:00Z')), '2026-11-16'));
test('周日仍属于本周，跨年加日期正常', () => { assert.equal(monday('2026-11-22'), '2026-11-16'); assert.equal(addDays('2026-12-31',1), '2027-01-01'); assert.equal(weekContains(week,'2026-11-22'),true); });
test('周末显示当天空状态，不冒充周一菜单', () => assert.equal(initialSelection([week],'2026-11-22').date, '2026-11-22'));
test('新周尚未开始则默认最近供餐日', () => assert.equal(initialSelection([week],'2026-11-15').date,'2026-11-16'));
test('过期菜单不冒充今天菜单', () => assert.equal(initialSelection([week],'2026-12-01').date,'2026-12-01'));
test('支持按食材搜索，空白查询不返回全部数据', () => { assert.equal(searchMenus([week],'土豆').length,1); assert.equal(searchMenus([week],'   ').length,0); assert.equal(searchMenus([week],'没有这道菜').length,0); });
test('页面转义官网文字', () => assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;'));
test('食材独立成标签，兼容连写与空格克重', () => {
  assert.deepEqual(ingredientTags('鸡肉120g土豆30g 青椒 5 g，红椒5g'), ['鸡肉120g', '土豆30g', '青椒 5g', '红椒5g']);
});
test('保留官网不完整信息，不猜测克重归属', () => {
  assert.deepEqual(ingredientTags('鱼丸110g 洋葱 土豆20g 胡萝卜20g10g'), ['鱼丸110g', '洋葱', '土豆20g', '胡萝卜20g', '10g']);
  assert.deepEqual(ingredientTags('100g'), ['100g']);
  assert.deepEqual(ingredientTags(''), []);
});
const archive = JSON.parse(readFileSync(new URL('../docs/data/menus.json', import.meta.url), 'utf8')).weeks;
const realWeek = archive.find(w => w.id === '2026-11-16');
test('实际午餐按取餐规则分组，牛肉汤特色餐不误当套餐汤', () => {
  const groups = mealGroups('lunch', realWeek.days[2].meals.lunch);
  assert.deepEqual(groups.map(g => g.title), ['大荤', '小荤', '素菜', '特色餐', '汤']);
  assert.equal(groups[0].rule, '三选一');
  assert.equal(groups[1].rule, '二选一');
  assert.equal(groups.find(g => g.key === 'vegetable').rule, '两种必选');
  assert.equal(groups.find(g => g.key === 'vegetable').items.length, 2);
  assert.equal(groups[0].items.length, 3);
  assert.equal(groups[1].items.length, 2);
  assert.equal(groups.find(g => g.key === 'specialty').items[0].name, '淮南牛肉汤');
  assert.equal(groups.at(-1).items[0].name, '西红柿汤');
});
test('实际晚餐单列糕点，两种特色餐和汤均完整保留', () => {
  const items = realWeek.days[0].meals.dinner;
  const groups = mealGroups('dinner', items);
  assert.equal(groups.find(g => g.key === 'pastry').items[0].name, '汉堡');
  assert.equal(groups.find(g => g.key === 'vegetable').rule, '两种必选');
  assert.equal(groups.find(g => g.key === 'vegetable').items.length, 2);
  assert.deepEqual(groups.find(g => g.key === 'specialty').items.map(i => i.name), ['虾仁馄饨', '蚝油肉片盖浇饭']);
  assert.equal(groups.flatMap(g => g.items).length, items.length);
  assert.equal(groups.at(-1).items[0].name, '紫菜汤');
});
test('合并特色餐拆开并注明共用食材，未公布的菜不补造', () => {
  const groups = mealGroups('lunch', realWeek.days[3].meals.lunch);
  const specials = groups.find(g => g.key === 'specialty').items;
  assert.deepEqual(specials.map(i => i.name), ['排骨面', '大肉面']);
  assert.ok(specials.every(i => i.ingredientNote && i.ingredients));
  assert.equal(mealGroups('lunch', realWeek.days[0].meals.lunch).find(g => g.key === 'specialty').items.length, 1);
  assert.ok(searchMenus([realWeek], '大肉面').every(hit => hit.category === '特色餐' && hit.name === '大肉面'));
});
test('异常行数完整显示原菜单，避免默默漏菜或错误标注', () => {
  const items = [{name:'临时菜单甲'}, {name:'临时菜单乙'}];
  const groups = mealGroups('dinner', items);
  assert.equal(groups[0].key, 'unclassified');
  assert.deepEqual(groups[0].items, items);
});

test('周日调休跨自然周时，每一天都能选择且优先精确日期', () => {
  const previous = {id:'2026-09-14',start:'2026-09-14',end:'2026-09-18',days:[{date:'2026-09-14'}]};
  const holiday = {id:'2026-09-20',start:'2026-09-20',end:'2026-09-24',days:Array.from({length:5},(_,i)=>({date:addDays('2026-09-20',i)}))};
  assert.equal(dateStripStart(holiday),'2026-09-20');
  for (const day of holiday.days) assert.equal(initialSelection([previous,holiday],day.date).week.id,holiday.id);
  assert.equal(initialSelection([previous,holiday],'2026-09-19').week.id,previous.id);
  assert.equal(initialSelection([previous,holiday],'2026-09-25').date,'2026-09-25');
  assert.equal(weekContains(holiday,'2026-09-25'),true);
});

test('逐日核对后的糕点行不互换，特殊汤品仍归特色餐', () => {
  const latePastryWeeks = [1, 2, 5, 7, 10, 13];
  assert.equal(archive.length >= 14, true);
  for (const [index, week] of archive.slice(0, 14).entries()) {
    for (const day of week.days) {
      const row = latePastryWeeks.includes(index + 1) ? 9 : 7;
      const items = day.meals.dinner;
      const groups = mealGroups('dinner', items);
      assert.equal(groups.find(g => g.key === 'pastry').items[0], items[row], day.date);
      assert.equal(groups.at(-1).items[0], items.at(-1), day.date);
    }
  }
  const dinner = archive[1].days.find(d => d.date === '2026-09-10').meals.dinner;
  const groups = mealGroups('dinner', dinner);
  assert.equal(groups.find(g => g.key === 'pastry').items[0].name, '松子肉丁烧麦');
  assert.ok(groups.find(g => g.key === 'specialty').items.some(d => d.name === '淮南牛肉汤'));
});

test('糕点行不明确时按原顺序展示可选菜，仍保留套餐分类', () => {
  const items = realWeek.days[0].meals.dinner.map(({ name, ingredients }) => ({ name, ingredients }));
  const groups = mealGroups('dinner', items);
  assert.equal(groups.some(group => group.key === 'pastry'), false);
  assert.deepEqual(groups.find(group => group.key === 'optional').items, items.slice(7, -1));
  assert.equal(groups.at(-1).items[0], items.at(-1));
});

test('以空白分隔的两种面能分别搜索；官网第十二周现表优先', () => {
  const day = archive[0].days.find(d => d.date === '2026-09-03');
  const groups = mealGroups('lunch', day.meals.lunch);
  const specials = groups.find(g => g.key === 'specialty').items;
  assert.deepEqual(specials.map(d => d.name), ['番茄土豆牛腩面', '大肉面']);
  assert.ok(specials.every(d => d.ingredientNote && d.ingredients));
  assert.ok(searchMenus(archive, '大肉面').some(d => d.name === '大肉面' && d.date === day.date));
  assert.equal(realWeek.days[0].meals.breakfast[8].name, '红糖馒头');
  assert.equal(realWeek.days[4].meals.lunch[0].name, '红烧带鱼');
});
