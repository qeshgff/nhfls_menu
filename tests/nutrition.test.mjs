import assert from 'node:assert/strict';
import test from 'node:test';
import menus from '../docs/data/menus.json' with { type: 'json' };
import { analyzeDish, ingredientEntries, mealEnergy, menuStatistics, selectedEnergy } from '../docs/nutrition.mjs';

test('converts explicit edible weights while preserving ingredients with unknown units', () => {
  assert.deepEqual(ingredientEntries('肉沫３０ｇ 西红柿 ０.１kg方腿：20 洋葱30g. 鲜奶240ml'), [
    { name:'肉末', grams:30 }, { name:'番茄', grams:100 },
    { name:'方腿', grams:null }, { name:'洋葱', grams:30 }, { name:'鲜奶', grams:null },
  ]);
});

test('references listed ingredients by weight and separates partial and prepared estimates', () => {
  const dish = analyzeDish({ name:'番茄炒蛋', ingredients:'西红柿100g鸡蛋60g 不明调味料' });
  assert.equal(dish.energy.low, 103.8);
  assert.deepEqual(dish.energy.missing, ['不明调味料']);
  assert.equal(dish.hints[0].source, '食材表');
  const bread = analyzeDish({ name:'红糖馒头', ingredients:'100g' });
  assert.equal(bread.energy.kind, 'reference');
  assert.equal(bread.energy.low, 223);
  assert.equal(bread.hints[0].source, '需核实');
  const alternative = analyzeDish({ name:'鲜牛奶/酸奶', ingredients:'酸奶150g鲜奶240g' }).energy;
  assert.deepEqual([alternative.low, alternative.high], [91.5,146.4]);
});

test('flags recipe clues without treating fish-fragrant dishes as fish', () => {
  const fishFragrant = analyzeDish({ name:'鱼香肉丝', ingredients:'肉丝30g' });
  assert.ok(!fishFragrant.hints.some(hint => hint.label === '鱼类'));
  const shellfish = analyzeDish({ name:'蚝油肉柳盖浇饭', ingredients:'肉片110g 洋葱30g' });
  assert.deepEqual(shellfish.hints.map(hint => [hint.label, hint.source]), [['软体贝类','需核实']]);
  const combined = analyzeDish({ name:'清汤面', ingredients:'鸡蛋40g', ingredientNote:'合并记录' });
  assert.equal(combined.energy,null);
  assert.equal(combined.hints.find(hint => hint.label === '蛋类').source,'合并食材表');
});

test('calculates one main and one side, both vegetable dishes and soup', () => {
  const items = [1,2,3,4,5,6,7,90,8].map((grams,index) => ({ name:'菜'+index, ingredients:`土豆${grams}g` }));
  const actual = mealEnergy('lunch',items);
  assert.equal(actual.incomplete,false);
  assert.equal(Math.round(actual.low * 100), 2002);
  assert.equal(Math.round(actual.high * 100), 2233);
  const missingMain = items.map((item,index) => index === 2 ? { ...item, ingredients:'' } : item);
  assert.equal(mealEnergy('lunch',missingMain).incomplete,true);
  assert.equal(mealEnergy('breakfast',items),null);
  const selected = selectedEnergy([items[0],{name:'未知',ingredients:''}]);
  assert.deepEqual(selected,{low:0.77,high:0.77,missing:1,references:false});
});

test('counts the shared source row once and analyzes every published meal', () => {
  const items = Array.from({length:9}, (_,index) => ({
    name:index === 7 ? '排骨面、大肉面' : '菜'+index, ingredients:index === 7 ? '鸡蛋30g鸡蛋20g 面条60g' : '肉沫30g',
  }));
  const stats = menuStatistics([{days:[{meals:{lunch:items}}]}]);
  assert.equal(stats.rows,9);
  assert.equal(stats.withEnergy,8);
  assert.deepEqual(stats.ingredients,[['肉末',8],['鸡蛋',1],['面条',1]]);
  assert.equal(stats.dishes.find(([name])=>name==='排骨面')[1],1);
  const actual = menuStatistics(menus.weeks);
  assert.ok(actual.withEnergy > actual.rows * 0.8);
  assert.ok(actual.allergens.length >= 8);
  for (const week of menus.weeks) for (const day of week.days) for (const meal of ['lunch','dinner']) {
    const estimate = mealEnergy(meal,day.meals[meal]);
    assert.ok(estimate && estimate.low > 0 && estimate.high >= estimate.low, `${day.date} ${meal}`);
  }
});
