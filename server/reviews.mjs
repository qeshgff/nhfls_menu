import menus from '../docs/data/menus.json' with { type: 'json' };
import { mealGroups } from '../docs/menu-utils.mjs';

const encoder = new TextEncoder();
const catalogue = new Map();
export const canonicalDish = name => String(name).normalize('NFKC').replace(/\s+/gu, '').replace(/\(新菜\)/gu, '');
for (const week of menus.weeks) for (const day of week.days) for (const [meal, dishes] of Object.entries(day.meals)) {
  for (const dish of mealGroups(meal, dishes).flatMap(group => group.items)) {
    const name = canonicalDish(dish.name);
    catalogue.set(`${day.date}|${meal}|${name}`, name);
  }
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
class PublicError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new PublicError(status, message); };
const hex = value => [...new Uint8Array(value)].map(n => n.toString(16).padStart(2, '0')).join('');
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function signingKey(secret) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']); }
async function mac(secret, value) { return hex(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(value))); }
function decodeHex(value) { return new Uint8Array(value.match(/../g).map(n => parseInt(n,16))); }

export function publicConfig(env) {
  const provider = env.CAPTCHA_PROVIDER || 'recaptcha-v3';
  const providerValid = ['recaptcha-v3','turnstile'].includes(provider);
  return { enabled: Boolean(env.DB && env.CAPTCHA_SITE_KEY && env.CAPTCHA_SECRET && env.SESSION_SECRET?.length >= 32 && providerValid),
    provider, siteKey: env.CAPTCHA_SITE_KEY || '', moderation: true, anonymous: true };
}
async function session(request, env) {
  const raw = request.headers.get('Cookie')?.match(/(?:^|;\s*)nhfls_session=([^;]+)/)?.[1];
  const parts = raw?.split('.');
  let id, issued;
  const now = Math.floor(Date.now()/1000);
  if (parts?.length === 3 && /^[0-9a-f-]{36}$/.test(parts[0]) && /^\d{10}$/.test(parts[1]) && /^[0-9a-f]{64}$/.test(parts[2])) {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(env.SESSION_SECRET), decodeHex(parts[2]), encoder.encode(parts.slice(0,2).join('.')));
    if (valid && Number(parts[1]) <= now && now-Number(parts[1]) < 30*86400) [id,issued] = parts;
  }
  let cookie;
  if (!id) {
    id = crypto.randomUUID(); issued = String(now);
    const token = `${id}.${issued}.${await mac(env.SESSION_SECRET, `${id}.${issued}`)}`;
    cookie = `nhfls_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  }
  return { visitor: await mac(env.SESSION_SECRET, `visitor:${id}`), cookie };
}
export async function verifyCaptcha(request, env, token, action, fetcher = fetch) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) fail(400, '请先完成人机验证。');
  const provider = env.CAPTCHA_PROVIDER || 'recaptcha-v3';
  const endpoint = provider === 'turnstile' ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : 'https://www.recaptcha.net/recaptcha/api/siteverify';
  let result;
  try {
    const response = await fetcher(endpoint, { method:'POST', body:new URLSearchParams({ secret:env.CAPTCHA_SECRET, response:token }), signal:AbortSignal.timeout(10000) });
    if (!response.ok) fail(503, '人机验证服务暂时不可用，请稍后重试。');
    result = await response.json();
  } catch { fail(503, '人机验证服务暂时不可用，请稍后重试。'); }
  const hostname = new URL(request.url).hostname;
  // Some legacy Google responses fail open above quota. Reject every error,
  // including a success=true response carrying "Over free quota.".
  const errors = result['error-codes'];
  if (!result.success || (errors && (!Array.isArray(errors) || errors.length)) || result.error || /over free quota/i.test(JSON.stringify(result))) fail(403, '人机验证未通过，请重试。');
  if (result.hostname !== hostname || result.action !== action) fail(403, '人机验证来源不匹配，请刷新后重试。');
  const age = Date.now() - Date.parse(result.challenge_ts);
  if (!Number.isFinite(age) || age < -30000 || age > (provider === 'turnstile' ? 300000 : 120000)) fail(403, '人机验证已过期，请重试。');
  const threshold = Number(env.RECAPTCHA_MIN_SCORE ?? '0.5');
  if (provider === 'recaptcha-v3' && (!Number.isFinite(result.score) || result.score < (Number.isFinite(threshold) ? Math.min(1,Math.max(0,threshold)) : 0.5))) fail(403, '人机验证未通过，请稍后重试。');
}
async function target(input) {
  const { date, meal, dish } = input;
  if (typeof dish !== 'string' || dish.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !['breakfast','lunch','dinner'].includes(meal)) fail(400, '菜品信息不完整。');
  const name = catalogue.get(`${date}|${meal}|${canonicalDish(dish)}`);
  if (!name) fail(404, '未找到这一天已公布的菜品。');
  const dishId = await digest(name);
  return { name, dishId, occurrence:`${date}|${meal}|${dishId}` };
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, '请使用 JSON 提交。');
  if (Number(request.headers.get('Content-Length') || 0) > 12000) fail(413, '提交内容过长。');
  // Stream the body with a byte cap rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) fail(400, '提交内容为空。');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 12000) { await reader.cancel(); fail(413, '提交内容过长。'); }
    chunks.push(value);
  }
  const raw = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk,offset); offset += chunk.length; }
  try { const parsed = JSON.parse(new TextDecoder().decode(raw)); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; }
  catch { fail(400, '提交格式有误。'); }
}
async function limit(db, bucket, duration, maximum) {
  const window = Math.floor(Date.now()/duration)*duration;
  const row = await db.prepare(`INSERT INTO request_limits(bucket,window_start,count) VALUES(?,?,1)
    ON CONFLICT(bucket,window_start) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(bucket,window,maximum).first();
  if (!row) fail(429, '提交太频繁，请稍后再试。');
}
function cleanText(value, maximum, label) {
  if (typeof value !== 'string') fail(400, `${label}格式有误。`);
  const text = value.normalize('NFKC').trim();
  if (!text || [...text].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail(400, `${label}不能为空，且最多 ${maximum} 字。`);
  return text;
}
async function admin(request, env, path) {
  if (!env.MODERATION_SECRET || env.MODERATION_SECRET.length < 32) fail(503, '评论管理尚未配置。');
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /,'') || '';
  if (await digest(supplied) !== await digest(env.MODERATION_SECRET)) fail(401, '管理员验证失败。');
  if (path === 'admin/comments' && request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT id,occurrence,dish_name,nickname,content,created_at FROM comments WHERE status='pending' ORDER BY created_at LIMIT 50").all();
    return json({ comments:results });
  }
  if (path === 'admin/comments' && request.method === 'POST') {
    const input = await body(request);
    if (!/^[0-9a-f-]{36}$/.test(input.id || '') || !['approved','rejected'].includes(input.status)) fail(400,'审核参数有误。');
    const result = await env.DB.prepare('UPDATE comments SET status=? WHERE id=?').bind(input.status,input.id).run();
    if (!result.meta.changes) fail(404,'未找到评论。');
    return json({ ok:true });
  }
  fail(404,'接口不存在。');
}
export async function handleRequest(request, env, fetcher = fetch) {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/,'');
    if (path === 'config' && request.method === 'GET') return json(publicConfig(env));
    if (path === 'health' && request.method === 'GET') {
      if (!env.DB) return json({ ok:false, database:false, reviewsEnabled:false },503);
      try { await env.DB.prepare('SELECT count(*) AS n FROM comments').first(); }
      catch { return json({ ok:false, database:false, reviewsEnabled:false },503); }
      return json({ ok:true, database:true, reviewsEnabled:publicConfig(env).enabled });
    }
    if (!env.DB) fail(503,'评论服务尚未启用。');
    if (!['GET','POST'].includes(request.method)) fail(405,'不支持的请求方式。');
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) fail(403,'请从本站页面提交。');
    if (path.startsWith('admin/')) return await admin(request,env,path);
    if (path === 'reviews' && request.method === 'GET') {
      const item = await target(Object.fromEntries(url.searchParams));
      let visitor;
      const headers = {};
      if (env.SESSION_SECRET?.length >= 32) {
        const current = await session(request,env); visitor=current.visitor;
        if (current.cookie) headers['Set-Cookie']=current.cookie;
      }
      const summary = await env.DB.prepare('SELECT count(*) AS count,round(avg(stars),1) AS average FROM ratings WHERE occurrence=?').bind(item.occurrence).first();
      const overall = await env.DB.prepare('SELECT count(*) AS count,round(avg(stars),1) AS average FROM ratings WHERE dish_id=?').bind(item.dishId).first();
      const { results } = await env.DB.prepare("SELECT id,nickname,content,created_at FROM comments WHERE occurrence=? AND status='approved' ORDER BY created_at DESC,id DESC LIMIT 30").bind(item.occurrence).all();
      const mine = visitor ? await env.DB.prepare('SELECT stars FROM ratings WHERE occurrence=? AND visitor=?').bind(item.occurrence,visitor).first() : null;
      return json({ summary,overall,comments:results,mine:mine?.stars || null },200,headers);
    }
    if (!['ratings','comments'].includes(path) || request.method !== 'POST') fail(404,'接口不存在。');
    if (!publicConfig(env).enabled) fail(503,'人机验证尚未配置，暂不能提交。');
    const input = await body(request), item = await target(input);
    const current = await session(request,env);
    const headers = current.cookie ? { 'Set-Cookie':current.cookie } : {};
    let nickname, content;
    if (path === 'ratings' && (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5)) fail(400,'请选择 1—5 星。');
    if (path === 'comments') { nickname=cleanText(input.nickname || '同学',20,'昵称'); content=cleanText(input.content,500,'评论'); }
    // A high per-network ceiling accommodates a shared school NAT. Never use
    // an IP address as the identity of a voter, and never persist the raw IP.
    const address = request.headers.get('CF-Connecting-IP');
    if (address) await limit(env.DB,await mac(env.SESSION_SECRET,`network:${address}`),60000,300);
    await limit(env.DB,`visitor:${current.visitor}:${path}`,600000,path === 'comments' ? 5 : 30);
    await verifyCaptcha(request,env,input.token,path === 'ratings' ? 'rate_dish' : 'comment_dish',fetcher);
    await env.DB.prepare('DELETE FROM request_limits WHERE window_start < ?').bind(Date.now()-2*86400000).run();
    if (path === 'ratings') {
      await env.DB.prepare(`INSERT INTO ratings(occurrence,dish_id,visitor,stars) VALUES(?,?,?,?)
        ON CONFLICT(occurrence,visitor) DO UPDATE SET stars=excluded.stars,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(item.occurrence,item.dishId,current.visitor,input.stars).run();
      return json({ ok:true,message:'评分已保存，可以重新选择星级修改。' },200,headers);
    }
    await env.DB.prepare('INSERT INTO comments(id,occurrence,dish_id,dish_name,visitor,nickname,content) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),item.occurrence,item.dishId,item.name,current.visitor,nickname,content).run();
    return json({ ok:true,status:'pending',message:'评论已提交，审核后显示。' },201,headers);
  } catch(error) {
    if (error instanceof PublicError) return json({ error:error.message },error.status);
    // Do not expose SQL, secrets, tokens or request payloads to visitors/logs.
    return json({ error:'评论服务暂时不可用，请稍后重试。' },503);
  }
}
