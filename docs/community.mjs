import { escapeHtml as esc, MEALS, weekday } from './menu-utils.mjs';
let configuration, dialog, context, refreshVersion = 0;
let googleLoading, googleWidget, commentWidget, turnstileLoading, turnstileId;
let inertBackground = [], reviewTrigger;
const usesCheckbox = () => configuration.commentCaptcha.enabled && configuration.commentCaptcha.provider === 'recaptcha-v2';
const endpoint = path => new URL(`./api/${path}`,import.meta.url);
async function api(path, options = {}) {
  const response = await fetch(endpoint(path), { credentials:'same-origin', cache:'no-store', ...options });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw Error('评价服务暂时不可用。');
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '操作没有成功，请稍后再试。');
  return data;
}
function script(url) {
  return new Promise((resolve,reject) => {
    const el = document.createElement('script');
    const timeout = setTimeout(() => { el.remove(); reject(Error('验证服务加载超时，请检查网络后重试。')); },15000);
    el.src=url; el.async=true; el.onload=()=>{clearTimeout(timeout);resolve();};
    el.onerror=()=>{clearTimeout(timeout);el.remove();reject(Error('验证服务没有加载成功，请稍后重试。'));};
    document.head.append(el);
  });
}
async function loadGoogle() {
  googleLoading ||= script('https://www.recaptcha.net/recaptcha/api.js?render=explicit').catch(error => {
    googleLoading = null;
    throw error;
  });
  await googleLoading;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('人机验证加载超时，请重试。')), 15000);
    window.grecaptcha.ready(() => {
      clearTimeout(timeout);
      resolve(window.grecaptcha);
    });
  });
}
async function loadGoogleBadge() {
  const google = await loadGoogle();
  googleWidget ??= google.render(dialog.querySelector('#review-google-badge'), {
    sitekey: configuration.siteKey,
    size: 'invisible',
    badge: 'inline',
  });
  return googleWidget;
}
function updateCheckbox(verified, message) {
  dialog.querySelector('#comment-submit').disabled = !verified || dialog.dataset.busy === 'true';
  dialog.querySelector('#comment-captcha-status').textContent = message;
}
function resetCheckbox() {
  if (commentWidget !== undefined) window.grecaptcha.reset(commentWidget);
  updateCheckbox(false, commentWidget === undefined ? '' : '请勾选「我不是机器人」。');
}
async function showCheckbox() {
  if (commentWidget !== undefined) return;
  const retry = dialog.querySelector('#comment-captcha-retry');
  const current = context;
  retry.hidden = true;
  updateCheckbox(false, '正在加载人机验证…');
  try {
    const google = await loadGoogle();
    if (!dialog.open || context !== current || commentWidget !== undefined) return;
    const container = dialog.querySelector('#comment-captcha');
    commentWidget = google.render(container, {
      sitekey: configuration.commentCaptcha.siteKey,
      size: container.clientWidth < 304 ? 'compact' : 'normal',
      callback: () => updateCheckbox(true, '验证已完成，可以提交评论。'),
      'expired-callback': () => updateCheckbox(false, '验证已过期，请重新勾选。'),
      'error-callback': () => {
        updateCheckbox(false, '人机验证未完成，请检查网络后重试。');
        retry.hidden = false;
      },
    });
    updateCheckbox(false, '请勾选「我不是机器人」。');
  } catch {
    if (!dialog.open || context !== current) return;
    updateCheckbox(false, '验证服务没有加载成功，请重试。');
    retry.hidden = false;
  }
}
async function captcha(action) {
  if (configuration.provider === 'recaptcha-v3') {
    const widget = await loadGoogleBadge();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('人机验证超时，请重试。')), 20000);
      Promise.resolve().then(() => window.grecaptcha.execute(widget, { action })).then(resolve, () => {
        reject(Error('人机验证失败，请重试。'));
      }).finally(() => clearTimeout(timeout));
    });
  }
  turnstileLoading ||= script('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit').catch(error=>{turnstileLoading=null;throw error;});
  await turnstileLoading;
  if (turnstileId !== undefined) window.turnstile.remove(turnstileId);
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('人机验证超时，请重试。')),120000);
    turnstileId=window.turnstile.render(dialog.querySelector('#review-captcha'),{sitekey:configuration.siteKey,action,
      callback:value=>{clearTimeout(timeout);resolve(value);},'error-callback':()=>{clearTimeout(timeout);reject(Error('人机验证失败，请重试。'));},
      'expired-callback':()=>{clearTimeout(timeout);reject(Error('验证已过期，请重试。'));}});
  });
}
function summary(value) { return value.count ? `${value.average} / 5 · ${value.count} 人评分` : '还没有评分'; }
async function refresh() {
  const version=++refreshVersion;
  const params=new URLSearchParams(context);
  const data=await api(`reviews?${params}`);
  if (version!==refreshVersion || !dialog.open) return;
  dialog.querySelector('#review-summary').textContent=`这次供餐：${summary(data.summary)}　·　历次：${summary(data.overall)}`;
  dialog.querySelector('#review-list').innerHTML=data.comments.length ? data.comments.map(comment=>`<article class="student-comment"><div><strong>${esc(comment.nickname)}</strong><time>${esc(new Date(comment.created_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}))}</time></div><p>${esc(comment.content)}</p></article>`).join('') : '<p class="review-muted">还没有公开评论，来说说这次的味道吧。</p>';
  const selected=dialog.querySelector(`input[name="stars"][value="${data.mine}"]`);
  if (selected) selected.checked=true;
}
function makeDialog() {
  const badge = configuration.ratingsEnabled && configuration.provider === 'recaptcha-v3' ? '<div id="review-google-badge"></div>' : '';
  const checkbox = usesCheckbox();
  const commentEnabled = configuration.commentCaptcha.enabled;
  const badgeByRating = checkbox || !commentEnabled;
  dialog=document.createElement('dialog'); dialog.className='review-dialog'; dialog.setAttribute('aria-labelledby','review-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow">同学们的饭后评价</span><h2 id="review-title"></h2><p id="review-context"></p></div><button type="button" class="icon-button" id="review-close" aria-label="关闭评价">×</button></div>
    <p id="review-summary" class="review-summary"></p>
    <form id="rating-form" ${configuration.ratingsEnabled ? '' : 'hidden'}><fieldset><legend>这次吃起来怎么样？</legend><div class="rating-stars">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="stars" value="${n}" required><span>${n} ★</span></label>`).join('')}</div></fieldset><div class="comment-actions"><button type="submit" class="community-submit">提交评分</button>${badgeByRating ? badge : ''}</div></form>
    <section class="comment-section"><h3>说说这道菜</h3>${commentEnabled ? '' : '<p class="review-muted">评论验证暂未配置。</p>'}<form id="comment-form" ${commentEnabled ? '' : 'hidden'}><label for="review-nickname">昵称（选填）</label><input id="review-nickname" name="nickname" maxlength="20" placeholder="同学"><label for="review-content">评价</label><textarea id="review-content" name="content" maxlength="500" rows="3" placeholder="口味、份量，或这次有什么变化…" required></textarea></form>
    ${checkbox ? '<div id="comment-captcha"></div><p id="comment-captcha-status" class="review-muted" role="status"></p><button id="comment-captcha-retry" class="quiet-button" type="button" hidden>重新加载验证</button>' : ''}
    <div class="comment-actions" ${commentEnabled ? '' : 'hidden'}><button id="comment-submit" type="submit" form="comment-form" class="community-submit" ${checkbox ? 'disabled' : ''}>${!badgeByRating && badge ? 'Google 验证并提交评论' : '提交评论'}</button>${badgeByRating ? '' : badge}</div></section>
    <p class="review-muted">每次评分和评论均需人机验证。评论审核后显示；同一浏览器对这次供餐的评分可以修改。请勿填写真实姓名、班级等个人信息。</p>
    <div id="review-captcha"></div><p id="review-verification" class="review-muted"></p><p id="review-message" class="review-message" role="status"></p><section aria-label="同学评论" id="review-list"></section>`;
  if (checkbox) {
    // Google attaches the image challenge to body, outside the checkbox iframe.
    // Keep it interactive by avoiding the native dialog top layer.
    dialog.classList.add('review-checkbox');
    const overlay = document.createElement('div');
    overlay.className = 'review-checkbox-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.append(overlay);
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.close(); });
    dialog.querySelector('#comment-captcha-retry').addEventListener('click', () => {
      dialog.querySelector('#comment-captcha-retry').hidden = true;
      if (commentWidget === undefined) showCheckbox();
      else resetCheckbox();
    });
  }
  document.body.append(dialog);
  dialog.querySelector('#review-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close', () => {
    refreshVersion++;
    if (checkbox) {
      resetCheckbox();
      inertBackground.forEach(element => { element.inert = false; });
      inertBackground = [];
      reviewTrigger?.focus();
    }
    if (turnstileId !== undefined && window.turnstile) { window.turnstile.remove(turnstileId); turnstileId=undefined; }
  });
  dialog.querySelector('#rating-form').addEventListener('submit',event=>submit(event,'ratings'));
  dialog.querySelector('#comment-form').addEventListener('submit',event=>submit(event,'comments'));
}
async function submit(event,path) {
  event.preventDefault();
  const form=event.currentTarget;
  const button=path==='comments' ? dialog.querySelector('#comment-submit') : form.querySelector('button[type="submit"]');
  const message=dialog.querySelector('#review-message');
  if (dialog.dataset.busy==='true') return;
  const checkbox = path === 'comments' && usesCheckbox();
  const checkboxToken = checkbox && commentWidget !== undefined ? window.grecaptcha.getResponse(commentWidget) : '';
  if (checkbox && !checkboxToken) { updateCheckbox(false, '请先勾选「我不是机器人」。'); return; }
  const submittedContext=context;
  const payload=Object.fromEntries(new FormData(form));
  if (path==='ratings') payload.stars=Number(payload.stars);
  dialog.dataset.busy='true'; button.disabled=true; message.textContent=checkbox ? '正在提交评论…' : '正在完成人机验证…';
  try {
    const token=checkbox ? checkboxToken : await captcha(path==='ratings'?'rate_dish':'comment_dish');
    if (!dialog.open || context!==submittedContext) return;
    const result=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...submittedContext,...payload,token})});
    if (!dialog.open || context!==submittedContext) return;
    if (path==='comments') form.querySelector('textarea').value='';
    message.textContent=result.message;
    try { await refresh(); } catch { message.textContent += ' 列表暂未刷新，可稍后重新打开。'; }
  } catch(error) { if (dialog.open && context===submittedContext) message.textContent=error.message; }
  finally {
    dialog.dataset.busy='false';
    if (checkbox && context === submittedContext) resetCheckbox();
    if (!checkbox) button.disabled=false;
    if (usesCheckbox() && (!checkbox || context !== submittedContext) && commentWidget !== undefined) {
      dialog.querySelector('#comment-submit').disabled = !window.grecaptcha.getResponse(commentWidget);
    }
  }
}
async function openReview(button) {
  if (!dialog) makeDialog();
  if (dialog.open) return;
  context={date:button.dataset.reviewDate,meal:button.dataset.reviewMeal,dish:button.dataset.reviewDish};
  dialog.querySelector('#review-title').textContent=context.dish;
  dialog.querySelector('#review-context').textContent=`${context.date} · ${weekday(context.date)} · ${MEALS[context.meal].name}`;
  dialog.querySelector('#review-summary').textContent='正在读取评分…'; dialog.querySelector('#review-message').textContent='';
  dialog.querySelector('#rating-form').reset(); dialog.querySelector('#comment-form').reset(); dialog.querySelector('#review-list').textContent='';
  const checkbox = usesCheckbox();
  const google = checkbox || configuration.provider === 'recaptcha-v3';
  dialog.querySelector('#review-verification').innerHTML=google ? '本操作使用 Google reCAPTCHA，适用其<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>和<a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">服务条款</a>。' : '本操作使用 Cloudflare Turnstile 人机验证。';
  if (checkbox) {
    reviewTrigger = button;
    inertBackground = Array.from(document.querySelectorAll('body > .skip, body > .sidebar, body > .workspace, body > .mobile-nav')).filter(element => !element.inert);
    inertBackground.forEach(element => { element.inert = true; });
    dialog.show();
    dialog.querySelector('#review-close').focus();
    showCheckbox();
  } else {
    dialog.showModal();
  }
  if (configuration.ratingsEnabled && configuration.provider === 'recaptcha-v3') loadGoogleBadge().catch(() => {});
  try { await refresh(); } catch(error) { dialog.querySelector('#review-message').textContent=error.message; }
}
export async function initializeCommunity() {
  // GitHub Pages remains a static fallback while the Cloudflare account is set
  // up. An absent/unconfigured API hides submission controls without fake data.
  try { configuration=await api('config'); if(!configuration.enabled) return; }
  catch { return; }
  document.body.classList.add('has-community');
  document.addEventListener('click',event=>{const button=event.target.closest('[data-review-dish]');if(button) openReview(button);});
}
