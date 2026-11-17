import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { canonicalDish,handleRequest,verifyCaptcha } from '../server/reviews.mjs';
const origin='https://menu.example';
const target={date:'2026-11-16',meal:'lunch',dish:'新疆大盘鸡'};
const token='test-token-for-unit-tests';
const schema=readFileSync(new URL('../migrations/0001_reviews.sql',import.meta.url),'utf8');
function database() {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec(schema);
  function statement(sql,values=[]) { return { bind(...args){return statement(sql,args);}, async first(){return sqlite.prepare(sql).get(...values) || null;}, async all(){return {results:sqlite.prepare(sql).all(...values)};}, async run(){return {meta:{changes:sqlite.prepare(sql).run(...values).changes}};} }; }
  return { prepare:sql=>statement(sql),sqlite };
}
function environment() { return { DB:database(), CAPTCHA_SITE_KEY:'test-site-key',CAPTCHA_SECRET:'test-secret',SESSION_SECRET:'unit-test-session-secret-at-least-32-characters',MODERATION_SECRET:'unit-test-moderation-secret-at-least-32-characters' }; }
function request(path, data, cookie,extra={}) {
  return new Request(origin+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','Origin':origin}:{}),...(cookie?{'Cookie':cookie}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
}
function solved(action,overrides={}) { return {success:true,hostname:'menu.example',action,score:0.9,challenge_ts:new Date().toISOString(),...overrides}; }
const verifier=async (_url,options)=>Response.json(solved(new URLSearchParams(options.body).get('response')==='comment-token'?'comment_dish':'rate_dish'));
const read= (env,cookie,t=target) => handleRequest(request('reviews?'+new URLSearchParams(t),null,cookie),env,verifier);
async function visitor(env) { const response=await read(env);return response.headers.get('Set-Cookie').split(';')[0]; }
async function send(env,path,data,cookie,fetcher=verifier,extra={}) { return handleRequest(request(path,{...target,token,...data},cookie,extra),env,fetcher); }

test('unconfigured API disables submission without leaking secrets',async()=>{
  const response=await handleRequest(request('config'),{});const data=await response.json();assert.equal(data.enabled,false);assert.ok(!JSON.stringify(data).includes('SECRET'));
  assert.equal((await send(environmentWithoutCaptcha(),'ratings',{stars:5})).status,503);
});
function environmentWithoutCaptcha(){const env=environment();delete env.CAPTCHA_SECRET;return env;}
test('health checks the actual migrated table',async()=>{
  assert.equal((await handleRequest(request('health'),environment())).status,200);
  const env=environment();env.DB.sqlite.exec('DROP TABLE comments');
  assert.equal((await handleRequest(request('health'),env)).status,503);
});
test('session cookie is HttpOnly Secure and rating edits replace the previous vote',async()=>{
  const env=environment(),first=await read(env);
  assert.match(first.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax/);assert.match(first.headers.get('Set-Cookie'),/; Secure/);
  const cookie=first.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await send(env,'ratings',{stars:4},cookie)).status,200);
  assert.equal((await send(env,'ratings',{stars:2},cookie)).status,200);
  const data=await (await read(env,cookie)).json();assert.deepEqual(data.summary,{count:1,average:2});assert.equal(data.mine,2);
});
test('the same dish has distinct occurrence scores and an overall score',async()=>{
  const env=environment(),cookie=await visitor(env),t={date:'2026-11-16',meal:'breakfast',dish:'鲜肉包'};
  assert.equal((await send(env,'ratings',{...t,stars:5},cookie)).status,200);
  assert.equal((await send(env,'ratings',{...t,date:'2026-11-17',stars:3},cookie)).status,200);
  const data=await (await read(env,cookie,t)).json();assert.equal(data.summary.average,5);assert.deepEqual(data.overall,{count:2,average:4});
});
test('forged cookies cannot impersonate the visitor who rated',async()=>{
  const env=environment(),cookie=await visitor(env);await send(env,'ratings',{stars:4},cookie);
  const forged=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');
  const response=await read(env,forged);assert.ok(response.headers.get('Set-Cookie'));assert.equal((await response.json()).mine,null);
});
test('comments stay private until moderation approves them',async()=>{
  const env=environment(),cookie=await visitor(env);
  const response=await send(env,'comments',{nickname:'同学甲',content:'今天口味不错 <script>alert(1)</script>',token:'comment-token'},cookie);
  assert.equal(response.status,201);assert.equal((await response.json()).status,'pending');
  assert.deepEqual((await (await read(env,cookie)).json()).comments,[]);
  const headers={Authorization:'Bearer '+env.MODERATION_SECRET};
  const queue=await (await handleRequest(request('admin/comments',null,null,headers),env)).json();assert.equal(queue.comments.length,1);assert.equal(queue.comments[0].dish_name,'新疆大盘鸡');
  const approved=await handleRequest(request('admin/comments',{id:queue.comments[0].id,status:'approved'},null,headers),env);assert.equal(approved.status,200);
  const data=await (await read(env,cookie)).json();assert.equal(data.comments.length,1);assert.equal(data.comments[0].nickname,'同学甲');assert.ok(!('visitor' in data.comments[0]));
});
test('admin credentials and same-origin writes are mandatory',async()=>{
  const env=environment();assert.equal((await handleRequest(request('admin/comments'),env)).status,401);
  assert.equal((await send(env,'ratings',{stars:5},null,verifier,{Origin:'https://other.example'})).status,403);
});
test('dish and date must exist in the published menu, including split specialty choices',async()=>{
  const env=environment(),cookie=await visitor(env);
  assert.equal((await send(env,'ratings',{dish:"x'); DROP TABLE comments;--",stars:5},cookie)).status,404);
  assert.equal((await send(env,'ratings',{date:'2026-11-21',stars:5},cookie)).status,404);
  assert.equal((await send(env,'ratings',{date:'2026-11-19',dish:'大肉面',stars:5},cookie)).status,200);
});
test('invalid stars, empty/oversized text and oversized JSON are rejected',async()=>{
  const env=environment(),cookie=await visitor(env);
  assert.equal((await send(env,'ratings',{stars:1.5},cookie)).status,400);
  assert.equal((await send(env,'ratings',{stars:6},cookie)).status,400);
  assert.equal((await send(env,'comments',{content:'   '},cookie)).status,400);
  assert.equal((await send(env,'comments',{content:'甲'.repeat(501)},cookie)).status,400);
  assert.equal((await send(env,'comments',{content:'甲'.repeat(6000)},cookie)).status,413);
});
test('comment frequency limit is enforced per anonymous visitor',async()=>{
  const env=environment(),cookie=await visitor(env);
  for(let i=0;i<5;i++) assert.equal((await send(env,'comments',{content:'第'+i+'次评价',token:'comment-token'},cookie)).status,201);
  assert.equal((await send(env,'comments',{content:'过快的评价',token:'comment-token'},cookie)).status,429);
});
test('captcha failure cannot add a rating or comment',async()=>{
  const env=environment(),cookie=await visitor(env);
  const failure=async()=>Response.json({success:false});
  assert.equal((await send(env,'ratings',{stars:5},cookie,failure)).status,403);
  assert.equal((await send(env,'comments',{content:'不能绕过验证码'},cookie,failure)).status,403);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM ratings').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM comments').get().n,0);
});
test('captcha checks action, hostname, score, expiry and quota-fail-open responses',async()=>{
  const env=environment();
  for(const changes of [{action:'comment_dish'},{hostname:'evil.example'},{score:0.1},{challenge_ts:'invalid'},{challenge_ts:new Date(Date.now()-180000).toISOString()},{'error-codes':['Over free quota.']},{error:'Over free quota.'}]) {
    await assert.rejects(()=>verifyCaptcha(request('ratings'),env,token,'rate_dish',async()=>Response.json(solved('rate_dish',changes))));
  }
  await verifyCaptcha(request('ratings'),env,token,'rate_dish',async(url)=>{assert.equal(url,'https://www.recaptcha.net/recaptcha/api/siteverify');return Response.json(solved('rate_dish'));});
});
test('Turnstile uses server validation and the action/hostname checks too',async()=>{
  const env={...environment(),CAPTCHA_PROVIDER:'turnstile'};
  await verifyCaptcha(request('ratings'),env,token,'rate_dish',async(url)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json(solved('rate_dish'));});
});
test('canonical dish name keeps cooking methods distinct while removing new-dish annotations',()=>{
  assert.equal(canonicalDish('莲藕红烧肉（新菜）'),'莲藕红烧肉');assert.notEqual(canonicalDish('红烧牛肉'),canonicalDish('酸汤牛肉'));
});
