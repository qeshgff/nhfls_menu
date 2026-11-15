import test from 'node:test';
import assert from 'node:assert/strict';
import { chinaDate, monday, addDays, weekContains, initialSelection, searchMenus, ingredientTags, mealGroups, escapeHtml } from '../docs/menu-utils.mjs';
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
const realWeek = JSON.parse(readFileSync(new URL('../docs/data/menus.json', import.meta.url), 'utf8')).weeks[0];
test('实际午餐按取餐规则分组，牛肉汤特色餐不误当套餐汤', () => {
  const groups = mealGroups('lunch', realWeek.days[2].meals.lunch);
  assert.deepEqual(groups.map(g => g.title), ['大荤', '小荤', '素菜', '特色餐', '汤']);
  assert.equal(groups[0].rule, '三选一');
  assert.equal(groups[1].rule, '二选一');
  assert.equal(groups[0].items.length, 3);
  assert.equal(groups[1].items.length, 2);
  assert.equal(groups.find(g => g.key === 'specialty').items[0].name, '淮南牛肉汤');
  assert.equal(groups.at(-1).items[0].name, '西红柿汤');
});
test('实际晚餐单列糕点，两种特色餐和汤均完整保留', () => {
  const items = realWeek.days[0].meals.dinner;
  const groups = mealGroups('dinner', items);
  assert.equal(groups.find(g => g.key === 'pastry').items[0].name, '汉堡');
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
