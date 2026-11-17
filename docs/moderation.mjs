import { escapeHtml as esc } from './menu-utils.mjs';
let key='';
const login=document.getElementById('moderation-login'),list=document.getElementById('moderation-list'),message=document.getElementById('moderation-message'),logout=document.getElementById('moderation-logout');
async function api(data) {
  const response=await fetch(new URL('./api/admin/comments',import.meta.url),{method:data?'POST':'GET',credentials:'omit',cache:'no-store',headers:{'Authorization':`Bearer ${key}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(!response.headers.get('Content-Type')?.includes('application/json')) throw Error('此站点尚未启用评论管理。');
  const result=await response.json();if(!response.ok)throw Error(result.error || '请求失败。');return result;
}
async function load() {
  const data=await api();
  list.innerHTML=data.comments.map(comment=>`<article class="student-comment"><div><strong>${esc(comment.nickname)}</strong><time>${esc(comment.created_at.slice(0,10))}</time></div><p><strong>${esc(comment.dish_name)}</strong></p><small>${esc(comment.occurrence.split('|').slice(0,2).join(' · '))}</small><p>${esc(comment.content)}</p><button class="community-submit" data-id="${esc(comment.id)}" data-status="approved">通过</button> <button class="quiet-button" data-id="${esc(comment.id)}" data-status="rejected">不公开</button></article>`).join('');
  message.textContent=data.comments.length?`当前显示 ${data.comments.length} 条待审核评论，每次最多50条。`:'没有待审核评论。';
}
login.addEventListener('submit',async event=>{
  event.preventDefault();key=document.getElementById('moderation-key').value;document.getElementById('moderation-key').value='';
  try{await load();login.hidden=true;logout.hidden=false;}catch(error){key='';message.textContent=error.message;}
});
logout.addEventListener('click',()=>{key='';list.textContent='';message.textContent='已退出管理。';login.hidden=false;logout.hidden=true;});
list.addEventListener('click',async event=>{
  const button=event.target.closest('[data-status]');if(!button)return;button.disabled=true;
  try{await api({id:button.dataset.id,status:button.dataset.status});await load();}catch(error){message.textContent=error.message;button.disabled=false;}
});
