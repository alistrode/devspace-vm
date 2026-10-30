const fs=require('fs');
const disk=process.argv[2];const fd=fs.openSync(disk,'r');
function raw(off,n){let b=Buffer.alloc(n);fs.readSync(fd,b,0,n,off);return b;}
const h=raw(0,512);if(h.readUInt32LE(0)!==0x564d444b)throw Error('Unsupported VMDK');
const grain=Number(h.readBigUInt64LE(20))*512,ng=h.readUInt32LE(44),gd=Number(h.readBigUInt64LE(56))*512;
const dirs=new Map(),tables=new Map();
function virt(off,n){const b=Buffer.alloc(n);let done=0;while(done<n){const pos=off+done,gi=Math.floor(pos/grain),di=Math.floor(gi/ng),ti=gi%ng;let gt=dirs.get(di);if(gt===undefined){gt=raw(gd+di*4,4).readUInt32LE();dirs.set(di,gt);}let tab=tables.get(gt);if(!tab){tab=gt?raw(gt*512,ng*4):Buffer.alloc(ng*4);tables.set(gt,tab);}const g=tab.readUInt32LE(ti*4),part=Math.min(n-done,grain-pos%grain);if(g)raw(g*512+pos%grain,part).copy(b,done);done+=part;}return b;}
const mbr=virt(0,512);let parts=[];for(let i=0;i<4;i++){const at=446+i*16,t=mbr[at+4],lba=mbr.readUInt32LE(at+8);if(t===7)parts.push(lba*512);}
function fix(b){b=Buffer.from(b);const at=b.readUInt16LE(4),n=b.readUInt16LE(6);for(let i=1;i<n;i++)b.copy(b,i*512-2,at+i*2,at+i*2+2);return b;}
function attrs(b){let a=[],p=b.readUInt16LE(20);while(p+16<=b.length&&b.readUInt32LE(p)!==0xffffffff){const type=b.readUInt32LE(p),len=b.readUInt32LE(p+4);if(len<24||p+len>b.length)break;const x={type,non:b[p+8],name:b[p+9]?b.toString('utf16le',p+b.readUInt16LE(p+10),p+b.readUInt16LE(p+10)+b[p+9]*2):''};if(!x.non)x.data=b.subarray(p+b.readUInt16LE(p+20),p+b.readUInt16LE(p+20)+b.readUInt32LE(p+16));else{x.size=Number(b.readBigUInt64LE(p+48));x.runs=[];let rp=p+b.readUInt16LE(p+32),lcn=0;while(rp<p+len&&b[rp]){const tag=b[rp++],ls=tag&15,os=tag>>4;let count=0,delta=0;for(let i=0;i<ls;i++)count+=b[rp+i]*2**(8*i);rp+=ls;for(let i=0;i<os;i++)delta+=b[rp+i]*2**(8*i);if(os&&(b[rp+os-1]&128))delta-=2**(os*8);rp+=os;lcn+=delta;x.runs.push({lcn:os?lcn:null,count});}}a.push(x);p+=len;}return a;}
for(const part of parts){const boot=virt(part,512);if(boot.toString('ascii',3,11)!=='NTFS    ')continue;const cluster=boot.readUInt16LE(11)*boot[13],rs=boot.readInt8(64),recordSize=rs<0?2**(-rs):rs*cluster,mft=Number(boot.readBigUInt64LE(48))*cluster;
function data(attr,off=0,n=attr.size){if(!attr.non)return attr.data.subarray(off,off+n);const out=Buffer.alloc(n);let cursor=0,done=0;for(const r of attr.runs){const size=r.count*cluster;if(off>=cursor+size){cursor+=size;continue;}const start=Math.max(0,off-cursor),take=Math.min(n-done,size-start);if(r.lcn!==null)virt(part+r.lcn*cluster+start,take).copy(out,done);done+=take;cursor+=size;if(done>=n)break;}return out;}
const ma=attrs(fix(virt(part+mft,recordSize))).find(a=>a.type===128&&!a.name);if(!ma)continue;
const records=new Map();for(let start=0;start<ma.size;start+=recordSize*1024){const chunk=data(ma,start,Math.min(recordSize*1024,ma.size-start));for(let at=0;at+recordSize<=chunk.length;at+=recordSize){if(chunk.toString('ascii',at,at+4)!=='FILE')continue;const b=fix(chunk.subarray(at,at+recordSize));if(!(b.readUInt16LE(22)&1))continue;let as=attrs(b),names=as.filter(a=>a.type===48&&a.data.length>=66);const f=names.find(a=>a.data[65]!==2)||names[0];if(!f)continue;const na=f.data,number=(start+at)/recordSize;records.set(number,{id:number,parent:Number(na.readBigUInt64LE(0)&0xffffffffffffn),name:na.toString('utf16le',66,66+na[64]*2),dir:!!(b.readUInt16LE(22)&2),attrs:as,bytes:as.find(a=>a.type===128&&!a.name)?.size||as.find(a=>a.type===128&&!a.name)?.data?.length||0});}}
function pathFor(r,seen=new Set()){if(!r||r.id===5)return '';if(seen.has(r.id))return '?';seen.add(r.id);return pathFor(records.get(r.parent),seen)+'\\'+r.name;}

const path=require('path'),crypto=require('crypto');
const prefix='\\devspace\\',destination=process.argv[3],mode=process.argv[4]||'source';
if(!destination)throw Error('Usage: node recover-vm-files.cjs DISK.vmdk NEW_DESTINATION [source|dist]');
const dest=path.resolve(destination);fs.mkdirSync(dest,{recursive:false});const files=[];
for(const r of records.values()){
 r.path=pathFor(r);if(r.dir||!r.path.startsWith(prefix))continue;const rel=r.path.slice(prefix.length);
 if(mode==='dist'?!rel.startsWith('dist\\'):/^(?:\.git|node_modules|\.tools|dist|build|coverage|logs|data)(?:\\|$)/i.test(rel))continue;
 if(/(?:^|\\)(?:node_modules|\.git|\.cache)(?:\\|$)/.test(rel)||rel==='mcp_test_tmp.txt'||/(?:^|\\)\.env(?!\.example$|\.sample$)/i.test(rel)||/\.(?:pem|pfx|key|log)$/i.test(rel))continue;
 const target=path.resolve(dest,rel),relative=path.relative(dest,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe destination');
 const a=r.attrs.find(a=>a.type===128&&!a.name);if(!a)continue;const b=data(a,0,a.size||a.data.length);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b,{flag:'wx'});files.push({path:rel,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});
}
console.log(JSON.stringify({mode,files}));}
fs.closeSync(fd);
