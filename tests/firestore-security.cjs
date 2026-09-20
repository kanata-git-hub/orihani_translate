const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repos=['orihani_translate'];
for(const repo of repos)test(repo+' rules preserve authorized access and reject escalation',async()=>{
 const projectId='demo-security-'+repo.replace('orihani','').replace(/[^a-z]/g,'');
 const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':').pop()),rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 const ctx=(uid,email=uid+'@example.test',verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
 const alice=ctx('alice'),bob=ctx('bob'),admin=ctx('owner','kanata840@gmail.com'),unverified=ctx('unverified','kanata840@gmail.com',false),anon=env.unauthenticatedContext().firestore();
 const collection=repo==='orihani-chart'?'users':'approved_users';
 try {
  await assertFails(anon.collection(collection).get());
  await assertFails(bob.collection(collection).doc('escalate').set({email:'bob@example.test',role:'admin'}));
  await assertFails(unverified.collection(collection).doc('escalate').set({email:'bad'}));
  await assertSucceeds(admin.collection(collection).doc('legacy-auto-id').set({email:'alice@example.test',role:'user'}));
  if(repo!=='orihani-shorts') {
   await assertSucceeds(alice.collection(collection).where('email','==','alice@example.test').get());
   await assertFails(bob.collection(collection).get());
  }
  if(repo==='orihani-marketing') {
   await assertSucceeds(alice.collection('approved_access').doc('alice').set({approvalId:'legacy-auto-id'}));
   await assertFails(bob.collection('approved_access').doc('bob').set({approvalId:'legacy-auto-id'}));
   await assertFails(bob.collection('approved_access').doc('alice').set({approvalId:'legacy-auto-id'}));
   await assertSucceeds(alice.collection('blog_history').doc('shared').set({topic:'unchanged shared history'}));
   await assertSucceeds(admin.collection('blog_history').doc('shared').get());
   await assertFails(bob.collection('blog_history').doc('shared').get());
   await assertFails(bob.collection('blog_history').doc('injected').set({topic:'bad'}));
   const ref=alice.collection('user_content').doc('private');
   await assertSucceeds(ref.set({userId:'alice',text:'keep'}));
   await assertSucceeds(ref.update({text:'edit'}));
   await assertFails(ref.update({userId:'bob'}));
   await assertFails(bob.collection('user_content').doc('private').set({userId:'bob',text:'takeover'}));
   await assertFails(bob.collection('user_content').doc('someone').set({userId:'alice'}));
   await assertSucceeds(admin.collection('approved_users').doc('legacy-auto-id').delete());
   await assertFails(ref.get()); await assertFails(alice.collection('blog_history').get());
  } else if(['orihani_translate','orihani-shorts'].includes(repo)) {
   for(const col of repo==='orihani-shorts'?['history','media']:['user_data']){
    await assertSucceeds(alice.collection(col).doc('own').set({userId:'alice',value:1}));
    await assertSucceeds(alice.collection(col).doc('own').update({value:2}));
    await assertFails(alice.collection(col).doc('own').update({userId:'bob'}));
    await assertFails(bob.collection(col).doc('own').get());
    await assertFails(bob.collection(col).doc('own').set({userId:'bob'}));
    await assertSucceeds(alice.collection(col).doc('own').delete());
   }
  } else if(repo==='orihani-cs') {
   await assertSucceeds(admin.collection('analyses').doc('private').set({userId:'alice',result:'saved'}));
   await assertSucceeds(alice.collection('analyses').doc('private').get());
   await assertFails(bob.collection('analyses').doc('private').get());
  }
 }finally{await env.cleanup();}
});
