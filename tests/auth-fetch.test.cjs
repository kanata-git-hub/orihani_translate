const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
test('frontend keeps the request and refreshes its ID token, without sending it to external URLs',async()=>{
 const calls=[];const auth={authStateReady:async()=>{},currentUser:{getIdToken:async()=> 'fresh-token'}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/authFetch.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};new Function('require','module','exports','fetch',code)(()=>({auth}),m,m.exports,async(...args)=>{calls.push(args);return new Response('{}');});
 const body=JSON.stringify({prompt:'원래 입력',data:'same-image'});
 await m.exports.authFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body});
 assert.equal(calls[0][1].body,body);assert.equal(calls[0][1].headers.get('Authorization'),'Bearer fresh-token');assert.equal(calls[0][1].headers.get('Content-Type'),'application/json');
 await assert.rejects(m.exports.authFetch('https://external.invalid/api/generate'),/Invalid/);
 auth.currentUser=null;await assert.rejects(m.exports.authFetch('/api/generate'),/로그인/);assert.equal(calls.length,1);
});
