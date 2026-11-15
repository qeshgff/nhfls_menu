import test from 'node:test';
import assert from 'node:assert/strict';
import { chinaDate, monday, addDays, weekContains, initialSelection, searchMenus, ingredientTags, escapeHtml } from '../docs/menu-utils.mjs';
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
