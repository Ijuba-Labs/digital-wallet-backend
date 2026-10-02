import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { verifyInteractionHash } from '../dist/utils/grant-interaction.js';
import { createGrantCipher } from '../dist/utils/grant-encryption.js';
import { WalletService } from '../dist/services/wallet.service.js';
import { TransferService } from '../dist/services/transfer.service.js';
import { PaymentTokenService } from '../dist/services/payment-token.service.js';
const wallet={id:'https://provider.example/a',assetCode:'ZAR',assetScale:2,authServer:'https://provider.example/auth',resourceServer:'https://provider.example'};
const amount={value:'1000',assetCode:'ZAR',assetScale:2};
test('wallet listing still exposes only repository ownership data and no spending grant',async()=>{
 const rows=[{id:'linked-a',walletAddressUrl:wallet.id,status:'LINKED',verifiedAt:new Date()}];let called;
 const service=new WalletService({grantRepository:{listLinkedWallets:async user=>{called=user;return rows;}},getOpenPaymentsClient:async()=>({walletAddress:{get:async()=>wallet}})});
 assert.deepEqual(await service.listLinkedWallets('customer'),rows);assert.equal(called,'customer');assert.deepEqual(await service.getWalletAddress(wallet.id),wallet);
});
test('public v2 ciphertext remains decryptable after extracting the shared cipher',()=>{
 const ringKey=process.env.GRANT_ENCRYPTION_KEY,context='transfer-outgoing:test',id='development',iv=randomBytes(12);
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(ringKey,'hex'),Buffer.from('wallet-backend:v2'),Buffer.from(context.split(':')[0]),32));
 const legacy=createCipheriv('aes-256-gcm',key,iv);legacy.setAAD(Buffer.from(`v2:${id}:${context}`));
 const bytes=Buffer.concat([legacy.update('old-token','utf8'),legacy.final()]);const encrypted=['v2',id,iv.toString('base64url'),legacy.getAuthTag().toString('base64url'),bytes.toString('base64url')].join(':');
 assert.equal(createGrantCipher().decrypt(encrypted,context),'old-token');
});
test('P2P outgoing token stores encrypted authority and never reuses ownership as spending permission',async()=>{
 let row;const repo={saveCredential:async(id,owner,value)=>{row=value;},credential:async()=>row};
 const service=new PaymentTokenService(repo,async()=>({}));const token={value:'p2p-spending',manage:'https://provider.example/manage',access:[{type:'outgoing-payment',identifier:wallet.id,actions:['create','read','list'],limits:{debitAmount:amount,receiver:'https://provider.example/incoming'}}]};
 await service.store('transfer','owner','outgoing',token,()=>{});assert.ok(!JSON.stringify(row).includes('p2p-spending'));
 assert.equal(await service.get('transfer','owner','outgoing',()=>{}),'p2p-spending');
});
test('P2P preparation requests exact spending authority and never submits before consent',async()=>{
 let record,session;const credentials=new Map();let submissions=0;const grants=[];
 const repo={findByIdempotencyKey:async()=>undefined,findWallet:async user=>({id:user, walletAddressUrl:`https://provider.example/${user}`,assetCode:'ZAR',assetScale:2}),reserve:async input=>{record={...input,status:'CREATING',created_at:new Date(),updated_at:new Date(),cleanup_state:'PENDING'};return{created:true,transfer:record};},claim:async()=>record,renew:async()=>true,release:async()=>{},transition:async(id,owner,expected,updates)=>{Object.assign(record,updates);return record;},saveCredential:async(id,owner,value)=>credentials.set(value.purpose,value),credential:async(id,purpose)=>credentials.get(purpose),clearCredential:async(id,owner,purpose)=>credentials.delete(purpose)};
 const client={walletAddress:{get:async({url})=>({...wallet,id:url})},grant:{request:async(args,body)=>{grants.push(body.access_token.access);if(body.interact)return{interact:{redirect:'https://provider.example/approve',finish:'server'},continue:{uri:'https://provider.example/continue',access_token:{value:'continue'}}};return{access_token:{value:'grant-value',manage:'https://provider.example/manage',access:body.access_token.access},continue:{uri:'https://provider.example/continue',access_token:{value:'continue'}}};}},incomingPayment:{create:async()=>({id:'https://provider.example/incoming',walletAddress:'https://provider.example/recipient',completed:false})},quote:{create:async()=>({id:'https://provider.example/quote',walletAddress:'https://provider.example/sender',receiver:'https://provider.example/incoming',debitAmount:amount,receiveAmount:amount})},token:{revoke:async()=>{}},outgoingPayment:{create:async()=>{submissions++;}}};
 const service=new TransferService({transferRepository:repo,paymentSessionRepository:{save:async s=>{session=s;},findById:async()=>session,delete:async()=>{}},getOpenPaymentsClient:async()=>client,apiPublicUrl:'http://localhost:9001'});
 const result=await service.create('sender',{recipientUserId:'recipient',amount:'1000'},'key');assert.equal(result.transfer.status,'AWAITING_AUTHORIZATION');assert.equal(submissions,0);
 const spending=grants.at(-1)[0];assert.equal(spending.type,'outgoing-payment');assert.equal(spending.identifier,'https://provider.example/sender');assert.deepEqual(spending.limits,{debitAmount:amount,receiver:'https://provider.example/incoming'});
 const ref='ref',hash=createHash('sha256').update([session.clientNonce,session.serverInteractNonce,ref,session.grantRequestUrl].join('\n')).digest('base64url');assert.equal(verifyInteractionHash(session,ref,hash),true);
});
