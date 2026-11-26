import { escapeHtml as esc } from './menu-utils.mjs';

const $ = id => document.getElementById(id);
const login=$('moderation-login'),panel=$('moderation-panel'),list=$('moderation-list'),message=$('moderation-message');
const logout=$('moderation-logout'),refresh=$('moderation-refresh'),auto=$('moderation-auto'),updated=$('moderation-updated');
const statsCards=$('stats-cards'),statsDaily=$('stats-daily'),statsStars=$('stats-stars'),statsDishes=$('stats-dishes');
let key='',timer=0,busy=false;

async function api(path,data) {
  const response=await fetch(new URL(`./api/admin/${path}`,import.meta.url),{method:data?'POST':'GET',credentials:'omit',cache:'no-store',headers:{'Authorization':`Bearer ${key}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(!response.headers.get('Content-Type')?.includes('application/json')) throw Error('此站点尚未启用评论管理。');
  const result=await response.json();
  if(!response.ok){const error=Error(result.error||'请求失败。');error.status=response.status;throw error;}
  return result;
}
const clock=date=>date.toLocaleTimeString('zh-CN',{hour12:false});
const bar=(value,maximum,label)=>`<span class="bar"><i style="width:${Math.max(1,Math.round(value/Math.max(1,maximum)*100))}%"></i></span><b>${esc(label)}</b>`;

function renderStats(data) {
  const cards=[['今日访客',data.visitors.today],['今日浏览',data.visitors.todayViews],['待审核',data.comments.pending],['已公开评论',data.comments.approved],['累计评分',data.ratings.total],['平均分',data.ratings.average??'—']];
  statsCards.innerHTML=cards.map(([label,value])=>`<div class="stats-card"><strong>${esc(String(value))}</strong><span>${esc(label)}</span></div>`).join('');
  const dayMax=Math.max(...data.visitors.days.map(day=>day.views));
  statsDaily.innerHTML=data.visitors.days.map(day=>`<div class="stats-row"><time>${esc(day.day.slice(5))}</time>${bar(day.views,dayMax,`${day.visitors} 人 / ${day.views} 浏览`)}</div>`).join('')||'<p class="review-muted">还没有访问记录。</p>';
  const starMax=Math.max(...data.ratings.distribution.map(star=>star.count));
  statsStars.innerHTML=data.ratings.distribution.map(star=>`<div class="stats-row"><time>${star.stars} 星</time>${bar(star.count,starMax,`${star.count} 次`)}</div>`).join('');
  const rated=data.topDishes.length?data.topDishes.map(dish=>`<div class="stats-dish"><span>${esc(dish.name)}</span><b>${dish.count} 次 · ${dish.average??'—'} 分</b></div>`).join(''):'<p class="review-muted">还没有评分。</p>';
  const commented=data.topComments.length?data.topComments.map(dish=>`<div class="stats-dish"><span>${esc(dish.name)}</span><b>${dish.count} 条</b></div>`).join(''):'<p class="review-muted">还没有评论。</p>';
  statsDishes.innerHTML=`<div class="stats-grid"><div><h4>评分最多</h4>${rated}</div><div><h4>评论最多</h4>${commented}</div></div>`;
}

function renderComments(comments) {
  list.innerHTML=comments.length?comments.map(comment=>`<article class="student-comment"><div><strong>${esc(comment.nickname)}</strong><time>${esc(comment.created_at.slice(0,10))}</time></div><p><strong>${esc(comment.dish_name)}</strong></p><small>${esc(comment.occurrence.split('|').slice(0,2).join(' · '))}</small><p>${esc(comment.content)}</p><button class="community-submit" data-id="${esc(comment.id)}" data-status="approved">通过</button> <button class="quiet-button" data-id="${esc(comment.id)}" data-status="rejected">不公开</button></article>`).join(''):'<p class="review-muted">没有待审核评论。</p>';
  return comments.length;
}

async function refreshAll({announce=true}={}) {
  if(!key||busy)return false;
  busy=true;refresh.disabled=true;refresh.textContent='刷新中…';
  try {
    const [data,queue]=await Promise.all([api('stats'),api('comments')]);
    renderStats(data);
    const count=renderComments(queue.comments);
    updated.textContent=`更新于 ${clock(new Date())}`;
    if(announce)message.textContent=count?`当前 ${count} 条待审核评论，每次最多显示 50 条。`:'没有待审核评论。';
    return true;
  } catch(error) {
    if(error.status===401){stopAuto();key='';panel.hidden=true;login.hidden=false;}
    message.textContent=error.message;
    return false;
  } finally {
    busy=false;refresh.disabled=false;refresh.textContent='刷新数据';
  }
}

function stopAuto(){if(timer){clearInterval(timer);timer=0;}auto.checked=false;}

login.addEventListener('submit',async event=>{
  event.preventDefault();
  const field=$('moderation-key');
  key=field.value.trim();field.value='';
  if(!key){message.textContent='请输入管理员密钥。';return;}
  const ok=await refreshAll();
  if(ok){login.hidden=true;panel.hidden=false;}
  else {key='';field.focus();}
});
refresh.addEventListener('click',()=>{if(key)refreshAll();});
auto.addEventListener('change',()=>{
  if(auto.checked&&key&&!timer){timer=setInterval(()=>{if(key&&!document.hidden)refreshAll({announce:false});},30000);}
  else if(!auto.checked)stopAuto();
});
logout.addEventListener('click',()=>{
  stopAuto();key='';list.replaceChildren();statsCards.replaceChildren();statsDaily.replaceChildren();statsStars.replaceChildren();statsDishes.replaceChildren();
  updated.textContent='';message.textContent='已退出管理。';login.hidden=false;panel.hidden=true;
});
list.addEventListener('click',async event=>{
  const button=event.target.closest('[data-status]');if(!button)return;
  button.disabled=true;
  try {
    await api('comments',{id:button.dataset.id,status:button.dataset.status});
    await refreshAll({announce:false});
    message.textContent=button.dataset.status==='approved'?'已通过，评论现在对访客公开。':'已设为不公开，访客看不到这条评论。';
  } catch(error) {
    message.textContent=error.message;button.disabled=false;
  }
});
