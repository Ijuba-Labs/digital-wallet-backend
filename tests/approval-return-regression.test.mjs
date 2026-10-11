import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { TransferController } from '../dist/controllers/transfer.controller.js';
import { validateAppReturnUrl } from '../dist/utils/app-return.js';
const id='12345678-1234-4234-8234-123456789abc';
function app(service) {
 const app=express();
 const controller=new TransferController(service,'ijubapay://approval/transfer');
 app.get('/callback',controller.handleCallback);
 return app;
}
const query={transfer_id:id,interact_ref:'private-ref',hash:'private-proof'};
test('verified transfer approval returns only transfer ID',async()=>{
 const response=await request(app({handleCallback:async()=>({transferId:id,status:'PENDING'})})).get('/callback').query({...query,returnUrl:'https://attacker.example'}).expect(302);
 assert.equal(response.headers.location,`ijubapay://approval/transfer?transfer_id=${id}`);
});
test('verified decline returns to the app',async()=>{
 const response=await request(app({handleDecline:async()=>({transferId:id,status:'CANCELLED'})})).get('/callback').query({transfer_id:id,result:'grant_rejected',cancel_token:'a'.repeat(43)}).expect(302);
 assert.equal(response.headers.location,`ijubapay://approval/transfer?transfer_id=${id}`);
});
test('provider wait stays in browser so continuation can finish',async()=>{
 const response=await request(app({handleCallback:async()=>({transferId:id,status:'AWAITING_AUTHORIZATION',retryAfter:5})})).get('/callback').query(query).expect(202);
 assert.equal(response.headers.refresh,'5');assert.equal(response.headers.location,undefined);
 assert.ok(!response.text.includes('private-proof'));
});
test('rejected callback never selects a return destination',async()=>{
 const response=await request(app({handleCallback:async()=>{throw new Error('private-provider-error');}})).get('/callback').query(query).expect(500);
 assert.equal(response.headers.location,undefined);assert.ok(!response.text.includes('private-provider-error'));
});
test('rejects unsafe and unregistered destinations',()=>{
 for(const url of ['javascript:alert(1)','intent://approval/transfer','https://user:pass@app.example/return','https://app.example/return?next=evil','ijubapay://evil/transfer','ijubapay://approval/unknown','http://app.example/return']) assert.throws(()=>validateAppReturnUrl(url));
 assert.equal(validateAppReturnUrl('https://app.example/return'),'https://app.example/return');
});
