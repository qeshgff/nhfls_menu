import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';

test('Workers serves the original static request through the ASSETS binding',async()=>{
  const request=new Request('https://menu.example/');let actual;
  const response=await worker.fetch(request,{ASSETS:{fetch:async value=>{actual=value;return new Response('<!doctype html>菜单',{headers:{'Content-Type':'text/html'}});}}});
  assert.equal(actual,request);assert.equal(response.status,200);assert.match(await response.text(),/菜单/);
});
test('API configuration always reaches the backend instead of returning the HTML shell',async()=>{
  const response=await worker.fetch(new Request('https://menu.example/api/config'),{ASSETS:{fetch:()=>{throw Error('API must not reach static assets');}}});
  assert.match(response.headers.get('Content-Type'),/application\/json/);assert.equal((await response.json()).enabled,false);
});
test('missing static files preserve 404 rather than becoming the homepage',async()=>{
  const response=await worker.fetch(new Request('https://menu.example/missing.json'),{ASSETS:{fetch:async()=>new Response('Not Found',{status:404})}});
  assert.equal(response.status,404);
});
test('only the /api namespace invokes the backend',async()=>{
  const response=await worker.fetch(new Request('https://menu.example/apiary.txt'),{ASSETS:{fetch:async()=>new Response('static')}});
  assert.equal(await response.text(),'static');
  const api=await worker.fetch(new Request('https://menu.example/api'),{});
  assert.match(api.headers.get('Content-Type'),/application\/json/);
});
