import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { backup, DatabaseSync } from 'node:sqlite';
import { createApp, siteOrigin } from '../server/vps.mjs';
import { openDatabase } from '../server/sqlite.mjs';

const origin = 'https://menu.example';
const target = { date:'2026-11-16', meal:'lunch', dish:'新疆大盘鸡' };
async function fixture(t, { enabled = true, staticDirectory } = {}) {
  const directory = mkdtempSync(join(tmpdir(),'nhfls-vps-'));
  const filename = join(directory,'data','reviews.sqlite');
  const DB = openDatabase(filename);
  const env = { DB, ...(enabled ? { CAPTCHA_SITE_KEY:'unit-site', CAPTCHA_SECRET:'unit-secret', SESSION_SECRET:'unit-session-secret-at-least-32-characters', MODERATION_SECRET:'unit-admin-secret-at-least-32-characters' } : {}) };
  const server = createApp({ origin, env, staticDirectory, fetcher:async () => Response.json({ success:true, hostname:'menu.example', action:'comment_dish', score:0.9, challenge_ts:new Date().toISOString() }) });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); DB.close(); rmSync(directory,{recursive:true,force:true}); });
  return { base, DB, env, filename, directory };
}

test('VPS serves the real menu and initializes SQLite without CAPTCHA', async t => {
  const { base } = await fixture(t,{enabled:false});
  const page = await fetch(base+'/'); assert.equal(page.status,200); assert.match(await page.text(),/河外饭点/);
  const module = await fetch(base+'/community.mjs'); assert.match(module.headers.get('content-type'),/javascript/);
  const menus = await (await fetch(base+'/data/menus.json')).json(); assert.equal(menus.weeks.length,12);
  const health = await (await fetch(base+'/api/health')).json(); assert.deepEqual(health,{ok:true,database:true,reviewsEnabled:false});
  assert.equal((await (await fetch(base+'/api/config')).json()).enabled,false);
  const head = await fetch(base+'/styles.css',{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),'');
});

test('VPS preserves HTTPS cookies, comment moderation and same-origin validation through HTTP upstream', async t => {
  const { base, env } = await fixture(t);
  const read = () => fetch(base+'/api/reviews?'+new URLSearchParams(target));
  const first = await read(); const cookie = first.headers.get('set-cookie'); assert.match(cookie,/; Secure/);
  const headers = { Origin:origin, 'Content-Type':'application/json', Cookie:cookie.split(';')[0] };
  const comment = { ...target, token:'unit-test-token', content:'今天的鸡肉不错', nickname:'同学甲' };
  const posted = await fetch(base+'/api/comments',{method:'POST',headers,body:JSON.stringify(comment)}); assert.equal(posted.status,201);
  assert.deepEqual((await (await read()).json()).comments,[]);
  const adminHeaders = { ...headers, Authorization:'Bearer '+env.MODERATION_SECRET };
  const queue = await (await fetch(base+'/api/admin/comments',{headers:adminHeaders})).json(); assert.equal(queue.comments.length,1);
  assert.equal((await fetch(base+'/api/admin/comments',{method:'POST',headers:adminHeaders,body:JSON.stringify({id:queue.comments[0].id,status:'approved'})})).status,200);
  assert.equal((await (await read()).json()).comments[0].content,comment.content);
  assert.equal((await fetch(base+'/api/comments',{method:'POST',headers:{...headers,Origin:'https://attacker.example','X-Forwarded-Host':'attacker.example'},body:JSON.stringify(comment)})).status,403);
});

test('SQLite migrations, comments and ratings survive restart and online backup', async t => {
  const { DB, filename, directory } = await fixture(t);
  await DB.prepare('INSERT INTO ratings(occurrence,dish_id,visitor,stars) VALUES(?,?,?,?)').bind('occ','dish','visitor',5).run();
  await DB.prepare('INSERT INTO comments(id,occurrence,dish_id,dish_name,visitor,nickname,content) VALUES(?,?,?,?,?,?,?)').bind('id','occ','dish','鸡肉','visitor','同学','不错').run();
  const reopened = openDatabase(filename);
  assert.equal((await reopened.prepare('SELECT count(*) n FROM schema_migrations').first()).n,2);
  assert.equal((await reopened.prepare('SELECT stars FROM ratings').first()).stars,5);
  const source = new DatabaseSync(filename,{readOnly:true}); const destination = join(directory,'backup.sqlite');
  await backup(source,destination); source.close(); reopened.close();
  const restored = openDatabase(destination); assert.equal((await restored.prepare('SELECT content FROM comments').first()).content,'不错'); restored.close();
});

test('VPS never exposes configuration, source, directories or symlink escapes', async t => {
  const directory = mkdtempSync(join(tmpdir(),'nhfls-static-')); const publicDirectory = join(directory,'public'); mkdirSync(publicDirectory);
  writeFileSync(join(directory,'private.json'),'{"secret":"hidden"}'); symlinkSync(join(directory,'private.json'),join(publicDirectory,'leak.json'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const { base } = await fixture(t,{staticDirectory:publicDirectory});
  for (const path of ['/.env','/_headers','/_routes.json','/server/reviews.mjs','/data/','/%2e%2e/private.json','/leak.json','/%00.json','/missing.json']) {
    const response = await fetch(base+path); assert.equal(response.status,404,path); assert.ok(!(await response.text()).includes('hidden'));
  }
  assert.equal((await fetch(base+'/%zz')).status,400);
});

test('VPS rejects invalid public origins instead of trusting forwarded headers', () => {
  for (const value of [undefined,'https://user:pass@menu.example','https://menu.example/path','ftp://menu.example','https://menu.example?x=1']) assert.throws(() => siteOrigin(value));
  assert.equal(siteOrigin('https://menu.example/'),origin);
});

test('VPS returns 413 for streamed oversized uploads and remains available', async t => {
  const { base } = await fixture(t);
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"content":"'+'a'.repeat(13000)+'"}')); controller.close();
  } });
  const response = await fetch(base+'/api/comments',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body,duplex:'half'});
  assert.equal(response.status,413); await response.text();
  assert.equal((await fetch(base+'/api/health')).status,200);
});

test('VPS counts anonymous page views and exposes them to the admin',async t=>{
  const { base, env } = await fixture(t);
  await (await fetch(base+'/')).text();
  await new Promise(resolve=>setTimeout(resolve,150));
  const response=await fetch(base+'/api/admin/stats',{headers:{Authorization:'Bearer '+env.MODERATION_SECRET}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.visitors.today,1);
  assert.equal(data.visitors.todayViews,1);
  assert.equal(data.visitors.days.length,14);
  assert.equal(data.comments.pending,0);
  assert.equal((await fetch(base+'/api/admin/stats')).status,401);
});
