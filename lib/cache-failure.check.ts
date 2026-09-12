import assert from "node:assert/strict";
import postgres from "postgres";
import {db} from "./db";
// A healthy reader retains its own L1 and Redis values while a different DB
// connection commits without sending any invalidation. Redis is an in-memory
// protocol double so this check never consumes production Redis quota.
async function main() {
 const target=new URL(process.env.DATABASE_URL_DIRECT!);
 assert.equal(target.hostname,'127.0.0.1');assert.match(target.pathname,/^\/restore_\d+$/);
 let fail=false,loads=0;
 const values=new Map<string,string>();
 const fake={mget:async(...keys:string[])=>{if(fail)throw Error('Redis unavailable');return keys.map(key=>values.get(key)??null)},
  get:async(key:string)=>values.get(key)??null,set:async(key:string,value:string)=>{values.set(key,value);return 'OK'},incr:async()=>{throw Error('Invalidation delivery unavailable')}};
 Object.assign(globalThis,{upstashRawClientV2:fake,appCache:new Map(),circuitUntil:0,epochRequired:false});
 process.env.UPSTASH_REDIS_REST_URL='http://127.0.0.1:1';process.env.UPSTASH_REDIS_REST_TOKEN='local-test';
 const {cached}=await import('./cache');
 const writer=postgres(process.env.DATABASE_URL_DIRECT!,{max:1,onnotice:()=>{}});
 try {
  const load=async()=>++loads;
  assert.equal(await cached('brands:failure-test',60000,load),1);
  assert.equal(await cached('brands:failure-test',60000,load),1,'healthy hot reader uses its cache');
  await writer`UPDATE brands SET name=name WHERE id=(SELECT id FROM brands LIMIT 1)`;
  assert.equal(await cached('brands:failure-test',60000,load),2,'a committed write invalidates another reader without any Redis delivery');
  fail=true;
  await writer`UPDATE brands SET name=name WHERE id=(SELECT id FROM brands LIMIT 1)`;
  assert.equal(await cached('brands:failure-test',60000,load),3,'Redis failure bypasses the old L1 value');
  assert.equal(await cached('brands:failure-test',60000,load),4,'circuit-open reads remain fresh');
  console.log('Cache outage checks passed: warm reader, independent writer, lost invalidation, Redis failure and circuit-open bypass');
 } finally {await writer.end()}
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
