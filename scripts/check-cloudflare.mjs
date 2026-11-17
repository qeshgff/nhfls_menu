import { readFile } from 'node:fs/promises';
const menus = JSON.parse(await readFile(new URL('../docs/data/menus.json',import.meta.url),'utf8'));
if (menus.schemaVersion !== 1 || !menus.weeks.length) throw new Error('Menu archive is missing');
for (const path of ['docs/index.html','docs/_routes.json','functions/api/[[path]].js','migrations/0001_reviews.sql']) await readFile(new URL(`../${path}`,import.meta.url));
console.log(`Cloudflare source ready: ${menus.weeks.length} weeks; output=docs; Functions=/api/*; D1 binding=DB`);
