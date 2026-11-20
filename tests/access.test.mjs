import test from 'node:test';
import assert from 'node:assert/strict';
import {accessRows} from '../web/access.js';

test('access rows list memberships, pending grants and signed-in users without access',()=>{
 const rows=accessRows({users:[{id:'u1',email:'bo@example.com'},{id:'u2',email:'al@example.com'},{id:'u3',email:'cy@example.com'}],memberships:[{user_id:'u1',team_id:'a',role:'stats'},{user_id:'u1',team_id:null,role:'player'},{user_id:'u3',team_id:'b',role:'leadership'}],pendingMemberships:[{email:'dee@example.com',team_id:null,role:'player'}]});
 assert.deepEqual(rows.map(row=>[row.email,row.teamId,row.role,row.status]),[['al@example.com',null,null,'signed in'],['bo@example.com',null,'player','signed in'],['bo@example.com','a','stats','signed in'],['cy@example.com','b','leadership','signed in'],['dee@example.com',null,'player','pending']]);
 assert.equal(rows[0].userId,'u2');assert.equal(rows[4].userId,undefined);
});

test('admins get an admin row and are not listed as having no access',()=>{
 const rows=accessRows({users:[{id:'u1',email:'boss@example.com'},{id:'u2',email:'al@example.com'}],admins:['u1'],memberships:[{user_id:'u1',team_id:'a',role:'stats'}],pendingMemberships:[]});
 assert.deepEqual(rows.map(row=>[row.email,row.teamId,row.role]),[['al@example.com',null,null],['boss@example.com',null,'admin'],['boss@example.com','a','stats']]);
});
