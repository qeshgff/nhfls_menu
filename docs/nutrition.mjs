import { ingredientTags, mealGroups } from './menu-utils.mjs';
import { ingredientsSR28, ingredientsCFS, preparedReferences } from './nutrition-reference.mjs';

const spelling = new Map(Object.entries({
  肉沫: '肉末', 猪肉沫: '猪肉末', 西红柿: '番茄', 西蓝花: '西兰花',
  花生米: '花生', 藕: '莲藕', 肉圆: '肉丸', 鸭肫: '鸭胗', 千禧: '千禧果',
}));
export function ingredientEntries(value) {
  return ingredientTags(String(value ?? '').normalize('NFKC')).flatMap(part => {
    const tag = part.replace(/[.。]+$/u, '');
    const weight = tag.match(/(\d+(?:\.\d+)?)\s*(kg|千克|g|克)$/i);
    const name = (weight ? tag.slice(0, weight.index) : tag.replace(/\d+(?:\.\d+)?\s*(?:ml|毫升)?$/i, ''))
      .replace(/[:：]+$/u, '').replace(/^\d+(?=\p{Script=Han})/u, '').trim();
    const grams = weight ? Number(weight[1]) * (/kg|千克/i.test(weight[2]) ? 1000 : 1) : null;
    if (!name && !grams) return [];
    return [{ name: spelling.get(name) || name, grams }];
  });
}

function bounds(values) { return { low: Math.min(...values), high: Math.max(...values) }; }
const rawReference = new Map([...ingredientsSR28, ...ingredientsCFS].flatMap(([names, references]) =>
  names.split(' ').map(name => [name, bounds(references.map(([kcal]) => kcal))])));

function portion(reference, grams) {
  return { low: reference.low * grams / 100, high: reference.high * grams / 100 };
}
function addEnergy(parts) {
  return parts.reduce((total, part) => ({
    low: total.low + part.low, high: total.high + part.high,
  }), { low: 0, high: 0 });
}
function preparedEnergy(name, grams) {
  const entries = name.split(/[\/／]/u).map(option => {
    const food = option.trim();
    const record = preparedReferences.find(([pattern]) => pattern.test(food));
    if (!record) return null;
    const [, kcal, reference] = record;
    return { range: portion(bounds([kcal].flat()), grams), reference };
  });
  if (entries.some(entry => !entry)) return null;
  return {
    kind: 'reference',
    ...bounds(entries.flatMap(({ range }) => [range.low, range.high])),
    references: [...new Set(entries.map(entry => entry.reference))],
    missing: [],
  };
}

const allergens = [
  ['蛋类', /鸡蛋|鹌鹑蛋|鸭蛋|皮蛋|咸蛋|蛋黄|蛋清|蛋白粉|五香蛋|白水蛋|卤蛋|茶叶蛋|涨蛋/u, /蛋糕|蛋挞|奶黄包/u],
  ['奶类', /牛奶|鲜奶|酸奶|奶粉|奶油|乳清|奶酪|芝士|黄油|炼乳/u, /奶黄包|蛋挞|蛋糕|奶香/u],
  ['含麸质谷物', /面粉|小麦|面条|面筋|烤麸|挂面|刀削面|意大利面|燕麦|大麦|黑麦/u, /(?<!米)面$|馒头|花卷|包子|包$|饺|馄饨|烧麦|烧卖|蛋糕|蛋挞|面包|软欧|油条|汉堡|手抓饼|酱香饼|烧饼|饼干|鸡蛋饼|韭菜盒子/u],
  ['大豆', /大豆|黄豆|毛豆|腐竹|豆腐|豆浆|豆干|香干|干丝|千张|百叶结|豆皮|豆泡|酱油|生抽|老抽|豆豉/u, /豆芽|豆果|豆瓣酱/u],
  ['花生', /花生/u],
  ['坚果', /腰果|核桃|杏仁|松子|榛子|开心果|碧根果|巴旦木|夏威夷果/u],
  ['鱼类', /鱼肉|鱼片|鱼排|鱼丸|鱼豆腐|带鱼|鲈鱼|鳕鱼|鲫鱼|鲳鱼|鳝鱼|鲑鱼|青鱼|黑鱼|鲅鱼|龙利鱼|巴沙鱼|鱼干|鱼露|鱼柳|三文鱼/u, /^(?:鱼|乌鱼|草鱼)$|剁椒鱼头/u],
  ['甲壳类', /(?<!龙)虾|龙虾|螃蟹|蟹肉|梭子蟹|河蟹|大闸蟹/u, /蟹棒|蟹柳/u],
  ['软体贝类', /蛤蜊|花蛤|文蛤|扇贝|干贝|贻贝|青口|生蚝|牡蛎|蚝油|鱿鱼|章鱼|墨鱼|鲍鱼|海螺/u],
  ['芝麻', /芝麻|麻酱|香油/u, /麻团/u],
];
function allergenHints(dish, entries) {
  const ingredientNames = entries.map(({ name }) => name).filter(Boolean);
  // These are cues to check the recipe, never a claim that the meal is safe.
  const name = dish.name.replace(/鱼香|蚂蚁上树|虾味|蟹味菇/g, '');
  return allergens.flatMap(([label, direct, recipe]) => {
    const listed = ingredientNames.filter(food => direct.test(food.replace(/虾味|蟹味菇/g, '')));
    if (listed.length) return [{ label, source: dish.ingredientNote ? '合并食材表' : '食材表', evidence: listed.join('、') }];
    if (direct.test(name) || recipe?.test(name) || (label === '大豆' && ingredientNames.some(food => /^(豆芽|豆果|豆瓣酱)$/u.test(food)))) {
      return [{ label, source: '需核实', evidence: name }];
    }
    return [];
  });
}

export function analyzeDish(dish) {
  const entries = ingredientEntries(dish.ingredients);
  const hints = allergenHints(dish, entries);
  if (dish.ingredientNote) return { energy: null, hints, reason: '官网合并标注了多道菜的用量，无法拆算。' };
  if (entries.length === 1 && !entries[0].name) {
    const energy = preparedEnergy(dish.name.replace(/\(新菜\)|（新菜）/gu, ''), entries[0].grams);
    return { energy, hints, reason: energy ? '' : '官网只列成品重量，暂无合适的参考值。' };
  }
  const missing = [];
  const known = [];
  for (const { name, grams } of entries) {
    const reference = rawReference.get(name);
    if (reference && grams > 0) known.push(portion(reference, grams));
    else if (name) missing.push(name);
    else missing.push('未标明名称的克重');
  }
  if (!known.length) return { energy: null, hints, reason: '缺少可换算的食材或克重。' };
  const alternatives = /[\/／]/u.test(dish.name);
  return {
    energy: {
      kind: 'ingredients', missing: [...new Set(missing)],
      ...(alternatives ? bounds(known.flatMap(part => [part.low, part.high])) : addEnergy(known)),
    },
    hints, reason: '',
  };
}

export function selectedEnergy(items) {
  const values = items.map(item => analyzeDish(item).energy);
  const known = values.filter(Boolean);
  return known.length ? {
    ...addEnergy(known),
    missing: values.filter(value => !value || value.missing.length).length,
    references: known.some(value => value.kind === 'reference'),
  } : null;
}

export function mealEnergy(meal, items) {
  const groups = mealGroups(meal, items);
  if (!groups.some(group => group.key === 'main')) return null;
  const required = groups.filter(group => ['main', 'side', 'vegetable', 'soup'].includes(group.key));
  const parts = [];
  let incomplete = false;
  for (const group of required) {
    const values = group.items.map(item => analyzeDish(item).energy);
    incomplete ||= values.some(value => !value || value.missing.length > 0);
    if (group.key === 'main' || group.key === 'side') {
      // A missing alternative makes the range for the full set unknowable.
      if (values.every(Boolean)) parts.push(bounds(values.flatMap(({ low, high }) => [low, high])));
    } else {
      parts.push(...values.filter(Boolean));
    }
  }
  return parts.length ? { ...addEnergy(parts), incomplete } : null;
}

function frequencies(values) {
  return [...values].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b, 'zh-CN'));
}
function increment(map, key) { map.set(key, (map.get(key) || 0) + 1); }

export function menuStatistics(weeks) {
  const dishes = new Map(), ingredients = new Map(), allergensListed = new Map(), allergensPossible = new Map();
  let days = 0, rows = 0, withEnergy = 0;
  for (const week of weeks) for (const day of week.days) {
    days++;
    for (const [meal, items] of Object.entries(day.meals)) {
      rows += items.length;
      for (const item of items) {
        // Count a school source row once, including when two choices share that row.
        const names = new Set(ingredientEntries(item.ingredients).map(entry => entry.name).filter(Boolean));
        for (const name of names) increment(ingredients, name);
      }
      for (const group of mealGroups(meal, items)) for (const item of group.items) {
        for (const name of item.name.replace(/\(新菜\)|（新菜）/gu, '').split(/[\/／]/u)) {
          if (name.trim()) increment(dishes, name.trim());
        }
        const { energy, hints } = analyzeDish(item);
        if (energy) withEnergy++;
        for (const hint of hints) increment(hint.source === '食材表' ? allergensListed : allergensPossible, hint.label);
      }
    }
  }
  return { days, rows, withEnergy, dishes: frequencies(dishes), ingredients: frequencies(ingredients),
    allergens: frequencies(allergensListed).map(([name, count]) => [name, count, allergensPossible.get(name) || 0])
      .concat(frequencies(allergensPossible).filter(([name]) => !allergensListed.has(name)).map(([name, count]) => [name, 0, count])) };
}

export function formatEnergy(value) {
  const low = Math.round(value.low), high = Math.round(value.high);
  return `约 ${low === high ? low : `${low}–${high}`} 千卡`;
}
