(function(){
"use strict";
/* ============ Хичээлийн цаг (schedule.xlsx-ээс) ============ */
const PT = [["I","7:40","8:30"],["II","8:40","9:30"],["III","9:40","10:30"],["IV","10:40","11:30"],["V","11:40","12:30"],["VI","12:40","13:30"],["VII","14:20","15:10"],["VIII","15:20","16:10"],["IX","16:20","17:10"],["X","17:20","18:10"],["XI","18:20","19:10"],["XII","19:20","20:10"]];
const toM = s=>{const [a,b]=s.split(":").map(Number);return a*60+b;};
const P = PT.map(([l,a,b],i)=>({i,label:l,start:toM(a),end:toM(b)}));
const WDS = ["Даваа","Мягмар","Лхагва","Пүрэв","Баасан","Бямба","Ням"]; // хуваарийн дараалал

/* ============ Захиалгын дүрэм ============ */
const CFG = {
  maxClassPeriods: 4, libOpen: 8*60, libClose: 21*60, libSlotMin: 60, libMaxUpcoming: 1,
  advanceDays: 7, graceMin: 15, checkinEarlyMin: 15, cancelBeforeMin: 0, upcomingNotifyMin: 60,
  classCap: 26, emailDomain: "ufe.edu.mn"
};

/* Туршилтын горимд ашиглах хуваарь (negdsen huvaari namar.xlsx) */

/* ============ Барилга ============ */
const FLOORS = [
  {n:14,label:"Спорт заал",kind:"nob"},{n:13,label:"Анги 1301–1306",kind:"bookable"},{n:12,label:"Номын сан",kind:"bookable",lib:true},
  {n:11,label:"Анги 1101–1108",kind:"bookable"},{n:10,label:"Ашиглагдахгүй",kind:"nob"},{n:9,label:"Ашиглагдахгүй",kind:"nob"},{n:8,label:"Ашиглагдахгүй",kind:"nob"},
  {n:7,label:"Анги 701–708",kind:"bookable"},{n:6,label:"Анги 601–608",kind:"bookable"},{n:5,label:"Анги 501–508",kind:"bookable"},
  {n:4,label:"Ашиглагдахгүй",kind:"nob"},{n:3,label:"Лобби · нээлттэй талбай",kind:"nob"},{n:2,label:"IT лаб + 202–208",kind:"bookable"},{n:1,label:"Тодорхойлогдоогүй",kind:"nob"}
];
const ROOM_RANGES=[[13,1301,1306],[11,1101,1108],[7,701,708],[6,601,608],[5,501,508],[2,202,208]];
const ROOMS=[];ROOM_RANGES.forEach(([f,a,b])=>{for(let r=a;r<=b;r++)ROOMS.push({id:"R-"+r,number:String(r),floor:f,capacity:CFG.classCap,type:"Анги"});});
const CLASS_FLOORS=[...new Set(ROOMS.map(r=>r.floor))];
const TABLES=[],SEATS=[];
for(let t=1;t<=35;t++){TABLES.push({number:t});for(let k=0;k<2;k++){const n=(t-1)*2+1+k;SEATS.push({id:"S-"+pad(n),number:n,table:t,status:"ACTIVE"});}}
const roomById=Object.fromEntries(ROOMS.map(r=>[r.id,r]));
const seatById=Object.fromEntries(SEATS.map(s=>[s.id,s]));
/* Ангийн суудал: 3 хэсэг × 5 ширээ × 2 суудал = 30 суудал, үүнээс захиалах боломжтой нь 26 (01–26) */
const CSEC=["А","Б","В"],CLASS_SEATS=30;
const CSEATS=[];for(let s=0;s<3;s++)for(let t=1;t<=5;t++)for(let k=0;k<2;k++){const n=s*10+(t-1)*2+k+1;CSEATS.push({n,sec:s,table:t,bookable:n<=CFG.classCap});}
function cseatId(roomId,n){return roomId+":S-"+pad(n);}
function isClassType(t){return t==="CLASSROOM"||t==="CLASSROOM_SEAT";}
function roomOf(s){return s.resourceType==="CLASSROOM_SEAT"?s.roomId:s.resourceType==="CLASSROOM"?s.resourceId:null;}

/* ============ Туслах ============ */
function pad(n){return String(n).padStart(2,"0");}
function h(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dstr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function parseD(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);}
function today(){return dstr(new Date());}
function addDays(s,n){const d=parseD(s);d.setDate(d.getDate()+n);return dstr(d);}
function wdi(s){return (parseD(s).getDay()+6)%7;}           // 0 = Даваа
function fmtLong(s){const d=parseD(s);return d.getFullYear()+" оны "+(d.getMonth()+1)+"-р сарын "+d.getDate()+", "+WDS[wdi(s)];}
function fmtShort(s){const d=parseD(s);return (d.getMonth()+1)+"-р сарын "+d.getDate()+", "+WDS[wdi(s)];}
function fmtM(m){return pad(Math.floor(m/60))+":"+pad(m%60);}
function ts(date,min){const d=parseD(date);d.setMinutes(min);return d.getTime();}
function overlap(a,b){return a.start<b.end&&b.start<a.end;}
function fmtClock(t){const d=new Date(t);return pad(d.getHours())+":"+pad(d.getMinutes());}
function fmtWhen(t){const d=new Date(t);return dstr(d)===today()?"Өнөөдөр "+fmtClock(t):(d.getMonth()+1)+"/"+d.getDate()+" "+fmtClock(t);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function rid(date){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<4;i++)s+=c[Math.floor(Math.random()*c.length)];return "RES-"+date.replace(/-/g,"")+"-"+s;}
function periodsOf(s){return P.filter(p=>p.start<s.end&&s.start<p.end);}
function pLabel(s){const ps=periodsOf(s);return ps.length?(ps.length>1?ps[0].label+"–"+ps[ps.length-1].label:ps[0].label)+" цаг":"";}
/* И-мэйлээс нууц (таах боломжгүй) бүртгэлийн түлхүүр */
async function acctKey(email){
  const e=email.trim().toLowerCase();
  try{const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("ufe-booking:"+e));return "a"+[...new Uint8Array(buf)].slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join("");}
  catch(x){let h1=2166136261;for(const c of e){h1^=c.charCodeAt(0);h1=Math.imul(h1,16777619)>>>0;}return "a"+h1.toString(16);}
}

/* ============ Төлөв ============ */
function eff(s,now){
  now=now||Date.now();
  if(s.status==="CANCELLED"||s.status==="NO_SHOW"||s.status==="COMPLETED")return s.status;
  const st=ts(s.date,s.start),en=ts(s.date,s.end);
  if(s.status==="CHECKED_IN")return now>=en?"COMPLETED":"CHECKED_IN";
  if(now>=st+CFG.graceMin*60000)return "NO_SHOW";
  return "CONFIRMED";
}
function blocking(s,now){const e=eff(s,now);return e==="CONFIRMED"||e==="CHECKED_IN";}
const STATUS={CONFIRMED:["Баталгаажсан","pri"],CHECKED_IN:["Ирсэн · ашиглаж байна","ok"],COMPLETED:["Дууссан","off"],CANCELLED:["Цуцалсан","off"],NO_SHOW:["Ирээгүй · автоматаар цуцлагдсан","busy"]};
function chip(e){const [t,c]=STATUS[e];return `<span class="chip ${c}">${t}</span>`;}
function chip2(t,c){return `<span class="chip ${c}">${t}</span>`;}
function resName(s){
  if(s.resourceType==="CLASSROOM_SEAT")return "Анги "+roomById[s.roomId].number+" · Суудал "+pad(s.seatN);
  if(s.resourceType==="CLASSROOM")return "Анги "+roomById[s.resourceId].number;
  return "Номын сан · Суудал "+pad(seatById[s.resourceId].number);}
function resSub(s){
  if(s.resourceType==="CLASSROOM_SEAT"){const c=CSEATS[s.seatN-1];return roomById[s.roomId].floor+"-р давхар · Хэсэг "+CSEC[c.sec]+" · Ширээ "+c.table;}
  if(s.resourceType==="CLASSROOM")return roomById[s.resourceId].floor+"-р давхар · бүтэн анги";
  return "12-р давхар · Ширээ "+pad(seatById[s.resourceId].table);}

/* ============ State ============
   Суудлын эзэмшлийн үнэн эх сурвалж = өгөгдлийн сан дахь slot.owner (UFE бүртгэлийн түлхүүр).
   localStorage-д зөвхөн сүүлд нэвтэрсэн и-мэйл (session заагч) ба өнгөний горим хадгалагдана. */
const S={mode:"loading",isAdmin:false,acct:null,email:null,profile:null,prefs:{read:[]},slots:[],sched:null,
  q:null,lib:null,libSel:null,roomSel:null,detail:null,modal:null,panel:false,toast:null,busy:false,theme:"light",importMsg:null,
  login:{mode:"in",user:"",err:null,busy:false},pendingProfile:null};
try{const t=localStorage.getItem("ufe.theme");if(t==="light"||t==="dark")S.theme=t;}catch(e){}
function applyTheme(){if(document.documentElement.getAttribute("data-theme")!==S.theme)document.documentElement.setAttribute("data-theme",S.theme);}
applyTheme();
try{new MutationObserver(applyTheme).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});}catch(e){}
function curTheme(){return S.theme;}
function toggleTheme(){S.theme=S.theme==="dark"?"light":"dark";applyTheme();try{localStorage.setItem("ufe.theme",S.theme);}catch(e){}render();}

function nextPeriod(date){
  if(date!==today())return 0;
  const n=new Date(),m=n.getHours()*60+n.getMinutes();
  return P.findIndex(p=>m<p.start+CFG.graceMin);
}
function defaultQ(){let date=today(),i=nextPeriod(date);if(i<0){date=addDays(date,1);i=0;}return {date,sp:i,ep:i,floor:"all",cap:""};}
function defaultLib(){let date=today();const n=new Date();let m=n.getHours()*60+n.getMinutes();let st=Math.ceil(m/60)*60;if(m%60<=CFG.graceMin&&m>=CFG.libOpen)st=Math.floor(m/60)*60;if(st<CFG.libOpen)st=CFG.libOpen;if(st+60>CFG.libClose){date=addDays(date,1);st=CFG.libOpen;}return {date,start:st};}
S.q=defaultQ();S.lib=defaultLib();

/* ============ Ангийн суудлын тооцоо (өгөгдлийн сангаас) ============ */
function classAt(roomId,date,pi){const b=S.sched&&S.sched.busy&&S.sched.busy[roomId];if(!b)return null;return b[wdi(date)+"-"+pi]||null;}
function winOf(date,sp,ep){return {date,start:P[sp].start,end:P[ep].end};}
/* тухайн хугацаанд эзлэгдсэн суудлууд: Map(суудлын дугаар → эзэмшигч) */
function takenSeats(roomId,w,now){
  now=now||Date.now();const m=new Map();
  S.slots.forEach(s=>{if(s.date!==w.date||roomOf(s)!==roomId||!blocking(s,now)||!overlap(s,w))return;
    if(s.resourceType==="CLASSROOM")CSEATS.forEach(c=>m.set(c.n,s.owner));else m.set(s.seatN,s.owner);});
  return m;
}
function freeSeats(roomId,w,now){const t=takenSeats(roomId,w,now);let n=0;CSEATS.forEach(c=>{if(c.bookable&&!t.has(c.n))n++;});return n;}
function isMineIn(taken){for(const o of taken.values())if(S.acct&&o===S.acct)return true;return false;}
/* нэг цагийн нүдний төлөв: past | cls | full | free (+free тоо, mine) */
function cellState(roomId,date,pi,now){
  now=now||Date.now();const p=P[pi];
  if(ts(date,p.start)+CFG.graceMin*60000<=now)return {st:"past"};
  const c=classAt(roomId,date,pi);if(c)return {st:"cls",text:c};
  const w={date,start:p.start,end:p.end},t=takenSeats(roomId,w,now);
  const free=CSEATS.filter(x=>x.bookable&&!t.has(x.n)).length;
  return {st:free>0?"free":"full",free,mine:isMineIn(t)};
}
/* хугацааны мужид: хичээлтэй эсэх, сул суудлын тоо */
function rangeInfo(roomId,date,sp,ep,now){
  now=now||Date.now();let cls=null;
  for(let i=sp;i<=ep;i++){const c=classAt(roomId,date,i);if(c){cls=c;break;}}
  if(cls)return {cls,free:0,mine:false};
  const w=winOf(date,sp,ep),t=takenSeats(roomId,w,now);
  return {cls:null,free:CSEATS.filter(x=>x.bookable&&!t.has(x.n)).length,mine:isMineIn(t),taken:t};
}

/* ============ Store ============
   Хоёр хэрэгжүүлэлт ижил интерфейстэй:
   • supabaseStore — бодит өгөгдлийн сан (js/config.js-д түлхүүр оруулсан үед)
   • memStore      — туршилтын горим (өгөгдөл хадгалагдахгүй)
   Суудлын эзэмшлийн үнэн эх сурвалж нь үргэлж өгөгдлийн сан. */
let store=null;
class BookErr extends Error{constructor(c){super(c);this.code=c;}}
const ERR_CODES=["SEAT_TAKEN","USER_OVERLAP","LIB_LIMIT","CLASS_IN_SESSION","BAD_SEAT","BAD_TIME","BAD_ROOM","BAD_TYPE","OUT_OF_WINDOW","IN_PAST","BAD_DOMAIN","NOT_AUTHENTICATED","CANNOT_CANCEL","CANNOT_CHECK_IN"];
function codeOf(err){const m=String(err&&(err.message||err.details||err)||"");return ERR_CODES.find(c=>m.includes(c))||"UNKNOWN";}
function fromRow(r){return {id:r.id,resourceType:r.resource_type,resourceId:r.resource_id,roomId:r.room_id,seatN:r.seat_n,date:r.date,start:r.start_min,end:r.end_min,status:r.status,
  createdAt:r.created_at?Date.parse(r.created_at):Date.now(),checkInAt:r.check_in_at?Date.parse(r.check_in_at):null,cancelledAt:r.cancelled_at?Date.parse(r.cancelled_at):null};}

function supabaseStore(sb){
  let channel=null,pollT=null,uid=null;
  async function rpc(fn,args){const {data,error}=await sb.rpc(fn,args);if(error)throw new BookErr(codeOf(error));return data;}
  const api={
    async init(){
      const {data}=await sb.from("schedule").select("*").eq("id","current").maybeSingle();
      if(data)S.sched={title:data.title,importedAt:Date.parse(data.imported_at),busy:data.busy||{},classes:data.classes,unmatched:data.unmatched,skipped:data.skipped};
    },
    async session(){const {data}=await sb.auth.getSession();const u=data&&data.session&&data.session.user;return u?{id:u.id,email:(u.email||"").toLowerCase()}:null;},
    onAuth(cb){sb.auth.onAuthStateChange((ev,sess)=>{const u=sess&&sess.user;cb(u?{id:u.id,email:(u.email||"").toLowerCase()}:null,ev);});},
    async signIn(email,password){const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;const u=data.user;return {id:u.id,email:(u.email||"").toLowerCase()};},
    async signUp(email,password){const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;
      if(!data.session)throw new Error("CONFIRM_EMAIL_ON");const u=data.user;return {id:u.id,email:(u.email||"").toLowerCase()};},
    async changePassword(password){const {error}=await sb.auth.updateUser({password});if(error)throw error;},
    async logout(){await sb.auth.signOut();},
    /* нэвтэрсэн хэрэглэгчийн мэдээлэл */
    async loadUser(u){
      uid=u.id;
      const [{data:p},{data:a}]=await Promise.all([sb.from("profiles").select("*").eq("id",u.id).maybeSingle(),sb.from("app_admins").select("email").eq("email",u.email).maybeSingle()]);
      S.isAdmin=!!a;
      return {profile:p?{name:p.name,studentId:p.student_id||"",createdAt:Date.parse(p.created_at)}:null,prefs:{read:(p&&p.notif_read)||[]}};
    },
    async saveProfile(p){const {error}=await sb.from("profiles").upsert({id:uid,email:S.email,name:p.name,student_id:p.studentId||null});if(error)throw error;},
    async savePrefs(read){await sb.from("profiles").update({notif_read:read}).eq("id",uid);},
    async saveSchedule(doc){const {error}=await sb.from("schedule").upsert({id:"current",title:doc.title,imported_at:new Date(doc.importedAt).toISOString(),busy:doc.busy,classes:doc.classes,unmatched:doc.unmatched,skipped:doc.skipped||null});
      if(error)throw new Error("Хуваарь хадгалах эрхгүй байна (app_admins хүснэгтэд таны и-мэйл байх ёстой).");S.sched=doc;},
    /* суудлын төлөвийг өгөгдлийн сангаас дахин унших (кэш биш) */
    async refresh(){
      if(!uid){S.slots=[];render();return;}
      const from=addDays(today(),-1),to=addDays(today(),CFG.advanceDays+1);
      const [occ,own]=await Promise.all([sb.rpc("occupancy",{p_from:from,p_to:to}),sb.from("reservations").select("*").gte("date",addDays(today(),-120)).order("date",{ascending:false}).limit(500)]);
      if(occ.error||own.error){console.warn(occ.error||own.error);return;}
      const others=(occ.data||[]).filter(r=>!r.is_mine).map((r,i)=>Object.assign(fromRow(Object.assign({id:"occ-"+i},r)),{owner:"other"}));
      const mineRows=(own.data||[]).map(r=>Object.assign(fromRow(r),{owner:S.acct}));
      S.slots=others.concat(mineRows);render();
    },
    startLive(){
      api.stopLive();
      channel=sb.channel("occupancy").on("broadcast",{event:"changed"},()=>api.refresh()).subscribe();
      pollT=setInterval(()=>{if(!document.hidden)api.refresh();},20000);
      document.addEventListener("visibilitychange",api._vis=()=>{if(!document.hidden)api.refresh();});
    },
    stopLive(){if(channel){sb.removeChannel(channel);channel=null;}if(pollT){clearInterval(pollT);pollT=null;}if(api._vis)document.removeEventListener("visibilitychange",api._vis);},
    ping(){if(channel)channel.send({type:"broadcast",event:"changed",payload:{}});},
    async book(d){const r=await rpc("book_reservation",{p_type:d.resourceType,p_resource_id:d.resourceId,p_room_id:d.roomId||null,p_seat_n:d.seatN||null,p_date:d.date,p_start:d.start,p_end:d.end});
      api.ping();await api.refresh();return Object.assign(fromRow(r),{owner:S.acct});},
    async cancel(id){await rpc("cancel_reservation",{p_id:id});api.ping();await api.refresh();},
    async checkIn(id){await rpc("check_in",{p_id:id});await api.refresh();}
  };
  return api;
}

function memStore(){
  const d0=today(),d1=addDays(d0,1),prof={},pref={},accts={};let cur=null;const authCbs=[];
  const mk=(r,d,a,b,t,extra)=>Object.assign({resourceType:t,resourceId:r,date:d,start:a,end:b},extra||{});
  const seed=[];
  [["R-1301",[1,2,3,4,7,8,15,21]],["R-1305",[5,6,11,12,13]],["R-608",[...Array(26)].map((_,i)=>i+1)]].forEach(([r,ns])=>ns.forEach(n=>{const p=Math.max(0,nextPeriod(d0));seed.push(mk(cseatId(r,n),d0,P[p].start,P[p].end,"CLASSROOM_SEAT",{roomId:r,seatN:n}));}));
  [3,4,9,12,17,18,22,23,27,31,36,40,44,50,51,56,63,64,69].forEach((n,i)=>{const st=(10+(i%6))*60;seed.push(mk("S-"+pad(n),i%3?d0:d1,st,st+60,"LIBRARY_SEAT"));});
  let all=seed.map((s,i)=>Object.assign({id:"DEMO-"+i,owner:"demo-other",status:"CONFIRMED",createdAt:Date.now()-86400000,checkInAt:null,cancelledAt:null},s));
  const api={
    async init(){S.sched=window.DEMO_SCHEDULE||null;},
    async session(){return cur;},onAuth(cb){authCbs.push(cb);},
    async signIn(email,password){const a=accts[email];if(!a||a!==password)throw new Error("Invalid login credentials");cur={id:"demo:"+email,email};return cur;},
    async signUp(email,password){if(accts[email])throw new Error("User already registered");accts[email]=password;cur={id:"demo:"+email,email};return cur;},
    async changePassword(){},
    async logout(){cur=null;},
    async loadUser(u){S.isAdmin=true;return {profile:prof[u.id]||null,prefs:{read:pref[u.id]||[]}};},
    async saveProfile(p){prof[S.acct]=p;},async savePrefs(read){pref[S.acct]=read;},async saveSchedule(d){S.sched=d;},
    async refresh(){S.slots=all.map(s=>Object.assign({},s,{owner:s.owner===S.acct&&S.acct?S.acct:s.owner}));render();},
    startLive(){},stopLive(){},
    async book(d){await sleep(200);const now=Date.now();
      if(all.some(s=>s.resourceId===d.resourceId&&s.date===d.date&&blocking(s,now)&&overlap(s,d)))throw new BookErr("SEAT_TAKEN");
      if(all.some(s=>s.owner===S.acct&&s.date===d.date&&blocking(s,now)&&overlap(s,d)))throw new BookErr("USER_OVERLAP");
      const row=Object.assign({},d,{id:rid(d.date),owner:S.acct,status:"CONFIRMED",createdAt:Date.now(),checkInAt:null,cancelledAt:null});all=all.concat([row]);await api.refresh();return row;},
    async cancel(id){all=all.map(s=>s.id===id&&s.owner===S.acct?Object.assign({},s,{status:"CANCELLED",cancelledAt:Date.now()}):s);await api.refresh();},
    async checkIn(id){all=all.map(s=>s.id===id&&s.owner===S.acct?Object.assign({},s,{status:"CHECKED_IN",checkInAt:Date.now()}):s);await api.refresh();}
  };
  return api;
}

/* Нэвтэрсэн/гарсан үед бүх хэрэглэгчийн төлөвийг цэвэрлэж, өгөгдлийн сангаас дахин ачаална */
async function setUser(u){
  S.libSel=null;S.roomSel=null;S.modal=null;S.panel=false;S.detail=null;S.slots=[];
  if(!u){S.acct=null;S.email=null;S.profile=null;S.prefs={read:[]};S.isAdmin=false;store.stopLive();render();return;}
  if(!u.email.endsWith("@"+CFG.emailDomain)){await store.logout();S.login={mode:"in",user:"",err:"Зөвхөн @"+CFG.emailDomain+" хаягаар нэвтэрнэ."};return setUser(null);}
  S.acct=u.id;S.email=u.email;
  const r=await store.loadUser(u);S.profile=r.profile;S.prefs=r.prefs;
  if(!S.profile&&S.pendingProfile){try{await store.saveProfile(S.pendingProfile);S.profile=S.pendingProfile;}catch(e){console.warn(e);}}
  S.pendingProfile=null;
  await store.refresh();store.startLive();render();
}
async function boot(){
  render();
  const cfg=window.UFE_CONFIG||{};
  if(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&window.supabase){
    S.mode="db";store=supabaseStore(window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:true}}));
  }else{S.mode="memory";store=memStore();}
  try{await store.init();}catch(e){console.warn(e);}
  try{const u=await store.session();await setUser(u);}catch(e){console.warn(e);await setUser(null);}
  let first=true;store.onAuth((u,ev)=>{if(first&&ev==="INITIAL_SESSION"){first=false;return;}if((u&&u.id)!==S.acct)setUser(u);});
  render();
  setInterval(()=>{const a=document.activeElement;if(a&&/INPUT|SELECT/.test(a.tagName))return;if(S.modal)return;render();},30000);
}

/* ============ Үйлдэл ============ */
function mine(){return S.acct?S.slots.filter(s=>s.owner===S.acct):[];}
function seatFree(seatId,w){const now=Date.now();return !S.slots.some(s=>s.resourceId===seatId&&s.date===w.date&&blocking(s,now)&&overlap(s,w));}
function inWindow(date){return date>=today()&&date<=addDays(today(),CFG.advanceDays);}

function validateClass(q){
  if(!inWindow(q.date))return "Зөвхөн ойрын "+CFG.advanceDays+" хоногийн дотор захиална.";
  if(q.ep<q.sp)return "Дуусах цаг эхлэх цагаас өмнө байж болохгүй.";
  if(q.ep-q.sp+1>CFG.maxClassPeriods)return "Нэг удаад дээд тал нь "+CFG.maxClassPeriods+" цаг (пар) захиална.";
  if(ts(q.date,P[q.sp].start)+CFG.graceMin*60000<=Date.now())return "Энэ цаг өнгөрсөн байна. Дараагийн цагийг сонгоно уу.";
  return null;
}
function validateLib(w){
  if(!inWindow(w.date))return "Зөвхөн ойрын "+CFG.advanceDays+" хоногийн дотор захиална.";
  if(w.start<CFG.libOpen||w.start+CFG.libSlotMin>CFG.libClose)return "Номын сан "+fmtM(CFG.libOpen)+"–"+fmtM(CFG.libClose)+" цагт ажиллана.";
  if(ts(w.date,w.start)+CFG.graceMin*60000<=Date.now())return "Энэ цаг өнгөрсөн байна.";
  return null;
}
function libUpcoming(){const now=Date.now();return mine().filter(s=>s.resourceType==="LIBRARY_SEAT"&&eff(s,now)==="CONFIRMED"&&ts(s.date,s.start)>now);}

const ERR_TEXT={
  SEAT_TAKEN:"Энэ суудал саяхан өөр оюутанд захиалагдлаа. Өөр суудал сонгоно уу.",
  USER_OVERLAP:"Энэ цагт танд өөр идэвхтэй захиалга байна. Нэг оюутан нэг цагт нэг л суудал захиална.",
  LIB_LIMIT:"Танд эхлээгүй байгаа номын сангийн захиалга аль хэдийн байна. Тэр цаг эхэлсний дараа дахин захиалж болно.",
  CLASS_IN_SESSION:"Энэ цагт хуваарийн дагуу хичээл орно.",
  BAD_SEAT:"Энэ суудлыг захиалах боломжгүй.",BAD_TIME:"Сонгосон цаг буруу байна.",BAD_ROOM:"Энэ анги захиалгын системд ороогүй.",
  OUT_OF_WINDOW:"Зөвхөн ойрын "+CFG.advanceDays+" хоногийн дотор захиална.",IN_PAST:"Энэ цаг өнгөрсөн байна.",
  BAD_DOMAIN:"Зөвхөн @"+CFG.emailDomain+" хаягаар захиална.",NOT_AUTHENTICATED:"Дахин нэвтэрнэ үү.",
  CANNOT_CANCEL:"Энэ захиалгыг цуцлах боломжгүй (эхэлсэн эсвэл аль хэдийн цуцлагдсан).",
  CANNOT_CHECK_IN:"Ирц зөвхөн эхлэхээс "+CFG.checkinEarlyMin+" минутын өмнөөс "+CFG.graceMin+" минутын дараа хүртэл бүртгэгдэнэ.",
  UNKNOWN:"Захиалга хадгалагдсангүй. Интернэтээ шалгаад дахин оролдоно уу."};
async function book(draft){
  if(!S.acct){toast("Эхлээд нэвтэрнэ үү.");return;}
  const now=Date.now();
  if(draft.resourceType==="CLASSROOM_SEAT"){
    const ps=periodsOf(draft);if(ps.some(p=>classAt(draft.roomId,draft.date,p.i))){S.modal={kind:"error",text:"Энэ цагт хуваарийн дагуу хичээл орно."};render();return;}
    if(!CSEATS[draft.seatN-1]||!CSEATS[draft.seatN-1].bookable){S.modal={kind:"error",text:"Энэ суудлыг захиалах боломжгүй."};render();return;}
  }else{
    if(draft.end-draft.start!==CFG.libSlotMin){toast("Номын сангийн суудлыг 1 цагаар захиална.");return;}
    if(libUpcoming().length>=CFG.libMaxUpcoming){S.modal={kind:"error",text:"Танд эхлээгүй байгаа номын сангийн захиалга аль хэдийн байна. Нэг удаад зөвхөн 1 цаг захиална — тэр цаг эхэлсний дараа дахин захиалж болно."};render();return;}
  }
  if(mine().some(s=>s.date===draft.date&&blocking(s,now)&&overlap(s,draft))){S.modal={kind:"error",text:"Энэ цагт танд өөр идэвхтэй захиалга байна. Нэг оюутан нэг цагт нэг л суудал захиална."};render();return;}
  S.busy=true;render();
  try{const saved=await store.book(draft);S.modal={kind:"done",slot:saved};S.libSel=null;S.roomSel=null;}
  catch(e){S.modal={kind:"error",text:ERR_TEXT[e.code]||ERR_TEXT.UNKNOWN};S.roomSel=null;S.libSel=null;try{await store.refresh();}catch(x){}}
  S.busy=false;render();
}
function ownSlot(id){return S.acct?S.slots.find(x=>x.id===id&&x.owner===S.acct):null;}
async function cancelRes(id){const s=ownSlot(id);if(!s)return;
  try{await store.cancel(id);S.modal=null;toast("Захиалга цуцлагдлаа. "+resName(s)+" дахин сул боллоо.");}catch(e){S.modal=null;toast(ERR_TEXT[e.code]||"Цуцалж чадсангүй. Дахин оролдоно уу.");}render();}
async function checkIn(id){const s=ownSlot(id);if(!s)return;
  try{await store.checkIn(id);toast("Ирц бүртгэгдлээ · "+fmtClock(Date.now()));}catch(e){toast(ERR_TEXT[e.code]||"Бүртгэж чадсангүй. Дахин оролдоно уу.");}render();}
function canCheckIn(s,now){now=now||Date.now();if(eff(s,now)!=="CONFIRMED")return false;const st=ts(s.date,s.start);return now>=st-CFG.checkinEarlyMin*60000&&now<st+CFG.graceMin*60000;}
function canCancel(s,now){now=now||Date.now();return eff(s,now)==="CONFIRMED"&&now<ts(s.date,s.start)-CFG.cancelBeforeMin*60000;}

function notifs(){
  const now=Date.now(),out=[];
  mine().forEach(s=>{
    const n=resName(s),when=fmtShort(s.date)+" "+fmtM(s.start)+"–"+fmtM(s.end);
    const st=ts(s.date,s.start),en=ts(s.date,s.end),dl=st+CFG.graceMin*60000;
    out.push({id:s.id+":b",t:s.createdAt,text:"Захиалга баталгаажлаа: "+n+", "+when+"."});
    if(s.status==="CANCELLED"){out.push({id:s.id+":c",t:s.cancelledAt||s.createdAt,text:"Та захиалгаа цуцаллаа: "+n+", "+when+"."});return;}
    if(s.status==="CONFIRMED"){
      if(now>=st-CFG.upcomingNotifyMin*60000&&now<st)out.push({id:s.id+":u",t:st-CFG.upcomingNotifyMin*60000,text:"Удахгүй: "+n+" "+fmtM(s.start)+" цагт эхэлнэ."});
      if(now>=st&&now<dl)out.push({id:s.id+":d",t:st,text:"Ирцээ бүртгүүлнэ үү! "+n+" — хугацаа "+fmtClock(dl)+" цагт дуусна."});
      if(now>=dl)out.push({id:s.id+":n",t:dl,text:"Ирц бүртгүүлээгүй тул "+n+" ("+when+") автоматаар цуцлагдлаа."});
    }
    if(s.status==="CHECKED_IN"&&now>=en)out.push({id:s.id+":f",t:en,text:"Захиалга дууслаа: "+n+", "+when+"."});
  });
  return out.filter(x=>x.t<=now+1000).sort((a,b)=>b.t-a.t).slice(0,40);
}
function unreadCount(){const r=new Set(S.prefs.read||[]);return notifs().filter(n=>!r.has(n.id)).length;}
async function markAllRead(){const ids=notifs().map(n=>n.id),prev=S.prefs.read||[];if(ids.every(i=>prev.includes(i)))return;
  const np=Object.assign({},S.prefs,{read:[...new Set(ids.concat(prev))].slice(0,300)});S.prefs=np;try{if(S.acct)await store.savePrefs(np.read);}catch(e){}render();}
let toastT=null;
function toast(t){S.toast=t;clearTimeout(toastT);toastT=setTimeout(()=>{S.toast=null;render();},3800);render();}

/* ============ Хуваарь импортлох (эзэмшигч) ============ */
function loadScript(src){return new Promise((res,rej)=>{if(window.XLSX)return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s);});}
async function importSchedule(file){
  S.importMsg={t:"Уншиж байна…"};render();
  try{
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
    const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null,raw:false});
    const doc=parseSchedule(rows);
    await store.saveSchedule(doc);
    S.importMsg={ok:true,t:"Хуваарь шинэчлэгдлээ: "+doc.classes+" хичээл уншигдлаа"+(doc.unmatched?", "+doc.unmatched+" нүдэнд өрөөний дугаар олдсонгүй":"")+"."};
  }catch(e){S.importMsg={t:e.message==="load"?"Excel уншигч ачаалагдсангүй. Дахин оролдоно уу.":e.message};}
  render();
}
function parseSchedule(rows){
  const tRe=/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/;
  let tr=-1;for(let i=0;i<Math.min(rows.length,30);i++){if((rows[i]||[]).filter(v=>v&&tRe.test(String(v))).length>=6){tr=i;break;}}
  if(tr<0)throw new Error("Цагийн мөр (7:40-8:30 …) олдсонгүй. Хуваарийн загварыг ашиглана уу.");
  const colDay={};let day=-1,prev=1e9;
  (rows[tr]||[]).forEach((v,c)=>{const m=v&&String(v).match(tRe);if(!m)return;const st=+m[1]*60+ +m[2];if(st<prev)day++;prev=st;if(day>=0&&day<7)colDay[c]=day;});
  let title="";for(let i=0;i<tr&&!title;i++){(rows[i]||[]).forEach(v=>{if(!title&&v&&String(v).trim().length>6)title=String(v).trim().replace(/^\/|\/$/g,"").replace(/\//g," / ");});}
  const busy={};const k={classes:0,online:0,otherBuilding:0,notBookableRoom:0};
  for(let r=tr+1;r<rows.length;r++){const row=rows[r]||[];
    Object.keys(colDay).forEach(c=>{const v=row[c];if(v==null||String(v).trim()==="")return;const text=String(v);
      const lines=text.split("\n").map(x=>x.trim()).filter(Boolean);
      if(/Online/i.test(text)){k.online++;return;}
      const rm=text.match(/[CС]\s*-\s*[CС](\d{3,4}[A-ZА-Я]?)\s*$/);           // "C - C706" = C байр, 706 тоот
      if(!rm){k.otherBuilding++;return;}
      const id="R-"+rm[1];if(!roomById[id]){k.notBookableRoom++;return;}
      const tm=text.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);if(!tm){k.otherBuilding++;return;}
      const a=+tm[1]*60+ +tm[2],b=+tm[3]*60+ +tm[4],label=((lines[0]||"")+" · "+(lines[1]||"")).slice(0,40);
      P.filter(p=>p.start<b&&a<p.end).forEach(p=>{(busy[id]=busy[id]||{})[colDay[c]+"-"+p.i]=label;});k.classes++;});
  }
  return {title:title||"Хичээлийн хуваарь",importedAt:Date.now(),busy,classes:k.classes,unmatched:k.online+k.otherBuilding+k.notBookableRoom,
    skipped:{online:k.online,otherBuilding:k.otherBuilding,notBookableRoom:k.notBookableRoom}};
}

/* ============ Сануулга / зөвлөмж (дахин ашиглах бүрэлдэхүүн) ============
   Шинэ төрлийн орон зай нэмэхдээ REMINDERS-д resourceType-аар нь нэг бичлэг нэмнэ. */
const REMINDERS={
  LIBRARY_SEAT:{
    title:"Номын санг зөв зохистой ашиглах зөвлөмж, дүрэм",
    lead:"Суудлаа захиаллаа. Номын санд орохын өмнө дараах дүрмийг санаарай.",
    sections:[{heading:null,items:[
      "Номын санд чимээгүй, тайван орчин бүрдүүлж, бусдад саад болохгүй байна.",
      "Ном, сэтгүүл болон бусад материалыг гамтай, цэвэрхэн ашиглана.",
      "Номыг урах, нугалах, зурж тэмдэглэх, бохирдуулахыг хориглоно.",
      "Авсан номоо зориулалтын байранд нь буцааж тавина.",
      "Номыг зөвшөөрөлгүйгээр номын сангаас авч гарахгүй.",
      "Ном зээлсэн бол тогтоосон хугацаанд нь буцааж өгнө.",
      "Номын санд хоол, ундаа авч орохгүй, хог хаяхгүй.",
      "Гар утсыг дуугүй горимд тохируулж, шаардлагагүй үед ашиглахгүй.",
      "Номын сангийн ширээ, сандал болон бусад тоног төхөөрөмжийг зориулалтын дагуу ашиглана.",
      "Эд зүйл гэмтээсэн тохиолдолд номын санч, багшид нэн даруй мэдэгдэнэ.",
      "Номын сангаас гарахдаа суудал болон ашигласан орчноо цэвэр, эмх цэгцтэй үлдээнэ.",
      "Номын санч болон бусдын өгсөн заавар, дүрмийг хүндэтгэн дагаж мөрдөнө."]}]
  },
  CLASSROOM:{
    title:"Анги танхимыг зөв зохистой ашиглах дүрэм",
    lead:"Анги захиаллаа. Ангиа ашиглахдаа дараах дүрмийг баримтална уу.",
    sections:[
      {heading:"Анги танхим",items:[
        "Анги танхимын эд зүйлсийг зөвшөөрөлгүйгээр зөөж, зориулалтыг нь өөрчлөхгүй.",
        "Ширээ, сандал, самбар, компьютер, проектор болон бусад тоног төхөөрөмжийг болгоомжтой ашиглана.",
        "Ширээ, сандал дээр бичих, зурах, наах, маажихыг хориглоно.",
        "Хичээлийн үед чанга ярих, гүйх, бусдад саад болох үйлдэл хийхгүй.",
        "Хогийг зориулалтын саванд хийж, анги танхимыг цэвэр цэмцгэр байлгана.",
        "Хичээл дууссаны дараа ширээ, сандлаа эмхэлж, өөрийн хэрэглэсэн зүйлсээ хураана.",
        "Ангийн эд зүйл эвдэрсэн, гэмтсэн тохиолдолд багшид шууд мэдэгдэнэ.",
        "Анги танхимаас гарахдаа гэрэл, цахилгаан хэрэгслийг шалгана."]},
      {heading:"Сандал, ширээг зөв зохистой ашиглах",items:[
        "Ширээн дээр гарах, суух, хэвтэхгүй.",
        "Ширээг чирэх, түлхэхдээ шал болон бусад эд зүйлсийг гэмтээхгүй байх.",
        "Ширээ, сандлыг зориулалтын бусаар ашиглахгүй.",
        "Ширээн дээр хутга, үзэг зэрэг зүйлээр зурж, сийлэхгүй.",
        "Хичээл дууссаны дараа сандлаа ширээнийхээ дэргэд эмх цэгцтэй байрлуулна.",
        "Эвдэрсэн ширээ, сандлыг өөрөө засах гэж оролдохгүй, багшид мэдэгдэнэ.",
        "Бусдын суудлыг зөвшөөрөлгүй эзлэхгүй.",
        "Ангиас гарахдаа ширээ, сандлаа цэвэр, бүрэн бүтэн үлдээнэ."]}]
  }
};
REMINDERS.CLASSROOM_SEAT=REMINDERS.CLASSROOM;
function reminderCard(type,opts){
  const r=REMINDERS[type];if(!r)return "";opts=opts||{};
  const lib=type==="LIBRARY_SEAT";
  return `<section class="rem ${lib?"lib":"cls"} ${opts.inModal?"in-modal":"card"}" aria-label="${h(r.title)}">
    <div class="rem-h"><span class="rem-ico">${lib?I.book:I.door}</span><div><div class="eyebrow">Сануулга</div><h3>${h(r.title)}</h3></div></div>
    ${opts.lead!==false?`<p class="small muted">${h(r.lead)}</p>`:""}
    ${r.sections.map(sec=>`${sec.heading?`<div class="rem-sub">${h(sec.heading)}</div>`:""}<ol class="rem-list">${sec.items.map(t=>`<li>${h(t)}</li>`).join("")}</ol>`).join("")}
  </section>`;
}

/* ============ Icons ============ */
const I={
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  door:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M15 12h.01"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16M8 14h3M8 17h6"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
};
function themeBtn(cls){const d=curTheme()==="dark";return `<button class="iconbtn ${cls||""}" data-theme-toggle aria-label="${d?"Цайвар горим":"Бараан горим"}" title="${d?"Цайвар горим":"Бараан горим"}">${d?I.sun:I.moon}</button>`;}

/* ============ Views ============ */
function route(){return (location.hash||"#/").slice(1).split("/").filter(Boolean);}
function floorStack(opts){opts=opts||{};
  return `<div class="stack">`+FLOORS.map(f=>{
    const sel=opts.sel!=null&&String(opts.sel)===String(f.n);
    const cls="floor "+(f.kind==="bookable"?"bookable":"nob")+(sel?" sel":"");
    const tag=f.kind==="nob"?`<span class="small">${f.n===1?"TBD":"—"}</span>`:f.lib?`<span class="small">70 суудал</span>`:`<span class="small">${ROOMS.filter(r=>r.floor===f.n).length} анги</span>`;
    const inner=`<span class="fn">${pad(f.n)}</span><span>${h(f.label)}</span>${tag}`;
    if(opts.static||f.kind==="nob")return `<div class="${cls}">${inner}</div>`;
    return `<button type="button" class="${cls}" data-floor="${f.n}" aria-pressed="${sel}">${inner}</button>`;
  }).join("")+`</div>`;}
function periodOpts(sel,useEnd){return P.map(p=>`<option value="${p.i}"${p.i===sel?" selected":""}>${p.label} · ${fmtM(useEnd?p.end:p.start)}</option>`).join("");}
function dateOpts(sel){let o="";for(let i=0;i<=CFG.advanceDays;i++){const d=addDays(today(),i);o+=`<option value="${d}"${d===sel?" selected":""}>${i===0?"Өнөөдөр · ":i===1?"Маргааш · ":""}${fmtShort(d)}</option>`;}return o;}

function resRow(s,withActs){
  const now=Date.now(),e=eff(s,now),isC=isClassType(s.resourceType);
  const icon=s.resourceType==="CLASSROOM_SEAT"?roomById[s.roomId].number+"<br>"+pad(s.seatN):isC?roomById[s.resourceId].number:"S"+pad(seatById[s.resourceId].number);
  let acts=`<a class="btn sm ghost" href="#/res/${h(s.id)}">Дэлгэрэнгүй</a>`;
  if(withActs){if(canCheckIn(s,now))acts+=`<button class="btn sm" data-checkin="${s.id}">Ирцээ бүртгүүлэх</button>`;if(canCancel(s,now))acts+=`<button class="btn sm danger" data-askcancel="${s.id}">Цуцлах</button>`;}
  const extra=s.checkInAt?` · Ирсэн ${fmtClock(s.checkInAt)}`:(e==="CONFIRMED"?` · Бүртгэл ${fmtM(s.start-CFG.checkinEarlyMin)}–${fmtM(s.start+CFG.graceMin)}`:"");
  return `<div class="res"><div class="rico ${isC?"":"lib"}">${icon}</div>
    <div><div class="t">${resName(s)}</div><div class="s">${fmtShort(s.date)} · <span class="mono">${fmtM(s.start)}–${fmtM(s.end)}</span>${isC?" · "+pLabel(s):""} · ${resSub(s)}${extra}</div>
    <div style="margin-top:6px" class="row">${chip(e)}<span class="small muted mono">${h(s.id)}</span></div></div><div class="acts">${acts}</div></div>`;
}
function schedNote(){
  if(!S.sched)return `<div class="note"><b>Хичээлийн хуваарь оруулаагүй.</b> Одоогоор бүх ангийг хичээлгүй гэж тооцож байна.</div>`;
  const n=S.sched.classes||0;
  return `<div class="note"><b>${h(S.sched.title)}</b> · ${n?n+" хичээл":"хуваарьт хичээл бүртгэгдээгүй — бүх анги хичээлгүй гэж тооцно"}${S.sched.importedAt?" · шинэчилсэн "+fmtWhen(S.sched.importedAt):""}${S.sched.skipped?`<br><span class="small">Тооцоогүй: онлайн ${S.sched.skipped.online}, өөр байр (B, заал) ${S.sched.skipped.otherBuilding}, системд ороогүй өрөө ${S.sched.skipped.notBookableRoom}.</span>`:""}</div>`;
}
function seatsLabel(n){return n>0?n+" / "+CFG.classCap+" суудал сул":"Захиалагдсан";}

function viewHome(){
  const name=(S.profile&&S.profile.name)||"Оюутан",now=Date.now();
  const up=mine().filter(s=>blocking(s,now)).sort((a,b)=>ts(a.date,a.start)-ts(b.date,b.start));
  let d=today(),pi=nextPeriod(d);if(pi<0){d=addDays(d,1);pi=0;}
  let freeRooms=0,freeClassSeats=0;ROOMS.forEach(r=>{const c=cellState(r.id,d,pi,now);if(c.st==="free"){freeRooms++;freeClassSeats+=c.free;}});
  const L=defaultLib(),w={date:L.date,start:L.start,end:L.start+60};const freeLib=SEATS.filter(s=>seatFree(s.id,w)).length;
  return `<div class="hero">
    <div class="card pad" style="padding:22px">
      <div class="eyebrow">${fmtShort(today())}</div>
      <h1 style="margin-top:6px">Сайн байна уу, ${h(name)}</h1>
      <p class="muted" style="margin-top:6px">Юу захиалах вэ?</p>
      <div class="tiles">
        <a class="tile primary" href="#/rooms"><div class="ico">${I.door}</div><div><h3>Ангийн суудал</h3><div class="meta">45 анги · ангид 26 суудал</div></div>
          <div class="row" style="gap:6px"><span class="bignum">${freeClassSeats}</span><span class="meta">суудал ${freeRooms} ангид ${d===today()?"":"маргааш "}${P[pi].label} цагт (${fmtM(P[pi].start)}) сул</span></div></a>
        <a class="tile" href="#/library"><div class="ico">${I.book}</div><div><h3>Номын сангийн суудал</h3><div class="meta">12-р давхар · 70 суудал · 1 цагаар</div></div>
          <div class="row" style="gap:6px"><span class="bignum">${freeLib}</span><span class="meta">/ 70 суудал ${fmtM(w.start)}–${fmtM(w.end)}-д сул</span></div></a>
      </div>
    </div>
    <div class="card pad"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Барилга</h2><span class="small muted">14 давхар</span></div>${floorStack({})}</div>
  </div>
  <div class="card">
    <div class="row pad" style="justify-content:space-between;border-bottom:1px solid var(--line)"><h2>Удахгүй болох захиалгууд</h2><a href="#/my" class="small">Бүгдийг харах →</a></div>
    ${up.length?up.slice(0,4).map(s=>resRow(s,true)).join(""):`<div class="empty">Танд идэвхтэй захиалга алга. Дээрээс анги эсвэл номын сангийн суудал сонгоорой.</div>`}
  </div>`;
}

function viewRooms(){
  const q=S.q,err=validateClass(q);
  const capErr=q.cap!==""&&(+q.cap<1||+q.cap>CFG.classCap)?"1–"+CFG.classCap+" хооронд оруулна уу (ангид "+CFG.classCap+" суудал).":null;
  const list=ROOMS.filter(r=>q.floor==="all"||String(r.floor)===String(q.floor));
  const bad=err||capErr,need=q.cap===""?1:+q.cap,now=Date.now();
  const info=bad?[]:list.map(r=>({r,i:rangeInfo(r.id,q.date,q.sp,q.ep,now)})).filter(x=>!x.i.cls);
  const avail=info.filter(x=>x.i.free>=need),full=info.filter(x=>x.i.free<need);
  const totalFree=avail.reduce((a,x)=>a+x.i.free,0);
  const card=x=>`<div class="card room ${x.i.free<need?"is-full":""}"><div class="room-top"><div><div class="room-no">${x.r.number}</div><div class="small muted">${x.r.floor}-р давхар</div></div>${x.i.mine?chip2("Таных","acc"):""}</div>
    <div class="seatcount ${x.i.free?"":"none"}"><b class="mono">${x.i.free}</b><span>/ ${CFG.classCap}</span></div><div class="small ${x.i.free?"":"err"}">${x.i.free?"суудал сул":"Захиалагдсан"}</div>
    <a class="btn sm block ${x.i.free?"":"ghost"}" href="#/room/${x.r.id}" data-enter="${x.r.id}">${x.i.free?"Суудал сонгох":"Харах"}</a></div>`;
  const matrix=`<div class="mx-wrap"><table class="mx"><thead><tr><th style="text-align:left;padding-left:8px">Анги</th>${P.map(p=>`<th class="${p.i>=q.sp&&p.i<=q.ep?"hl":""}">${p.label}<span class="mono">${fmtM(p.start)}</span></th>`).join("")}</tr></thead><tbody>
    ${list.map(r=>`<tr><td class="rn"><a href="#/room/${r.id}">${r.number}</a></td>${P.map(p=>{const c=cellState(r.id,q.date,p.i,now);const hl=p.i>=q.sp&&p.i<=q.ep?" hl":"";
      if(c.st==="free")return `<td><button type="button" class="cell ${c.mine?"mine":"free"}${hl}" data-cell="${r.id}|${p.i}" aria-label="${r.number}, ${p.label} цаг, ${c.free} суудал сул" title="${c.free} / ${CFG.classCap} суудал сул${c.mine?" · таны суудал":""}">${c.free}</button></td>`;
      const lab={cls:"Хичээл",full:"Дүүрсэн",past:"—"}[c.st];
      return `<td><span class="cell ${c.st==="full"?(c.mine?"mine":"bk"):c.st}${hl}" title="${c.text?h(c.text):c.st==="full"?"Захиалагдсан (0 / 26)":lab}" style="display:grid;place-items:center">${c.st==="full"&&c.mine?"Таных":lab}</span></td>`;}).join("")}</tr>`).join("")}
  </tbody></table></div>`;
  return `<div class="page-head"><div><h1>Ангийн суудал хайх</h1><p>Хичээлийн хуваарь болон бусад оюутны захиалгыг тооцоод анги бүрт хэдэн суудал сул байгааг харуулна.</p></div></div>
  <div class="search-layout">
    <aside class="side card pad"><div class="eyebrow" style="margin-bottom:10px">Давхраар шүүх</div>
      <button type="button" class="floor bookable ${q.floor==="all"?"sel":""}" data-floor="all" style="margin-bottom:6px"><span class="fn">★</span><span>Бүх давхар</span><span class="small">45</span></button>
      ${floorStack({sel:q.floor})}
      
    </aside>
    <section style="min-width:0">
      <form class="card pad" id="roomForm" style="margin-bottom:12px">
        <div class="form-grid">
          <div class="field"><label for="q-date">Огноо</label><select class="input" id="q-date" name="date">${dateOpts(q.date)}</select></div>
          <div class="field"><label for="q-sp">Эхлэх цаг</label><select class="input" id="q-sp" name="sp">${periodOpts(q.sp)}</select></div>
          <div class="field"><label for="q-ep">Дуусах цаг</label><select class="input" id="q-ep" name="ep">${periodOpts(q.ep,true)}</select></div>
          <div class="field"><label for="q-floor">Давхар</label><select class="input" id="q-floor" name="floor"><option value="all">Бүгд</option>${CLASS_FLOORS.map(f=>`<option value="${f}"${String(q.floor)===String(f)?" selected":""}>${f}-р давхар</option>`).join("")}</select></div>
          <div class="field"><label for="q-cap">Хамгийн багадаа сул суудал</label><input class="input" id="q-cap" name="cap" type="number" min="1" max="26" inputmode="numeric" placeholder="1–26" value="${h(q.cap)}"></div>
          <button class="btn" type="submit">Хайх</button>
        </div>
        ${bad?`<p class="err" style="margin-top:10px">${bad}</p>`:""}
      </form>
      <div style="margin-bottom:14px">${schedNote()}</div>
      ${bad?"":`<div class="summary"><span class="chip ok">${avail.length} ангид ${totalFree} суудал сул</span>${full.length?`<span class="chip busy">${full.length} анги дүүрсэн</span>`:""}<span class="small muted">${fmtShort(q.date)} · ${P[q.sp].label}${q.ep>q.sp?"–"+P[q.ep].label:""} цаг · <span class="mono">${fmtM(P[q.sp].start)}–${fmtM(P[q.ep].end)}</span></span></div>`}
      <div class="rooms">${avail.concat(full.filter(x=>x.i.free===0)).map(card).join("")}</div>
      ${!bad&&!avail.length?`<div class="card empty">Энэ хугацаанд сул суудалтай анги олдсонгүй. Доорх хүснэгтээс өөр цаг сонгоно уу.</div>`:""}
      <div class="row" style="justify-content:space-between;margin:26px 0 10px"><h2>Сул суудлын тоо · ${fmtShort(q.date)}</h2>
        <div class="legend"><span><i style="background:var(--ok-soft)"></i>Сул суудлын тоо</span><span><i style="background:var(--cls-soft)"></i>Хичээлтэй</span><span><i style="background:var(--busy-soft)"></i>Дүүрсэн</span><span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>Таны суудалтай</span></div></div>
      ${matrix}
      <p class="small muted" style="margin-top:8px">Нүдэн дэх тоо = тухайн цагт захиалах боломжтой суудал (26-аас). Дарж анги руу орно.</p>
    </section>
  </div>`;
}

function viewRoom(id){
  const r=roomById[id];if(!r)return `<div class="card empty">Анги олдсонгүй. <a href="#/rooms">Буцах</a></div>`;
  if(!S.detail||S.detail.id!==id){S.detail={id,date:S.q.date,sp:S.q.sp,ep:S.q.ep};S.roomSel=null;}
  const w=S.detail,err=validateClass(w),now=Date.now(),info=err?null:rangeInfo(id,w.date,w.sp,w.ep,now);
  const taken=info&&info.taken||new Map(),blocked=!!err||!!(info&&info.cls);
  let days="";for(let i=0;i<=CFG.advanceDays;i++){const d=addDays(today(),i),dd=parseD(d);days+=`<button type="button" class="day-chip ${d===w.date?"on":""}" data-dday="${d}"><b>${dd.getDate()}</b><span>${i===0?"Өнөөдөр":WDS[wdi(d)]}</span></button>`;}
  const cells=P.map(p=>{const c=cellState(id,w.date,p.i,now);const sel=p.i>=w.sp&&p.i<=w.ep?" sel":"";
    const cls=c.st==="free"?(c.mine?"mine":"free"):c.st==="full"?(c.mine?"mine":"bk"):c.st;
    const lab={free:c.free+" суудал сул",cls:c.text||"Хичээлтэй",full:"Захиалагдсан",past:"Өнгөрсөн"}[c.st];
    const clickable=c.st==="free"||c.st==="full";
    return `<${clickable?"button type=\"button\" data-pick=\""+p.i+"\"":"div"} class="pc ${cls}${sel}" title="${h(lab)}"><span class="pn">${p.label}</span><span class="pt">${fmtM(p.start)}–${fmtM(p.end)}</span><span class="ps">${h(lab)}</span></${clickable?"button":"div"}>`;}).join("");
  // суудлын зураг
  if(S.roomSel&&(blocked||taken.has(S.roomSel)))S.roomSel=null;
  const label={av:"сул",rs:"захиалагдсан",un:"захиалах боломжгүй",mine:"таны суудал",sel:"сонгосон"};
  const seatState=c=>{if(!c.bookable||blocked)return "un";if(taken.has(c.n))return taken.get(c.n)===S.acct?"mine":"rs";return S.roomSel===c.n?"sel":"av";};
  const secs=CSEC.map((nm,si)=>{let tb="";for(let t=1;t<=5;t++){const a=CSEATS[si*10+(t-1)*2],b=CSEATS[si*10+(t-1)*2+1];
      const seat=c=>{const st=seatState(c);return `<button type="button" class="seat ${st}" data-cseat="${c.n}" ${st==="av"||st==="sel"?"":"disabled"} aria-pressed="${st==="sel"}" aria-label="Суудал ${pad(c.n)}, ${label[st]}">${pad(c.n)}</button>`;};
      tb+=`<div class="tbl"><div class="tbl-no">ШИРЭЭ ${t}</div><div class="tbl-body">${seat(a)}${seat(b)}</div></div>`;}
    return `<div class="csec"><div class="eyebrow" style="text-align:center">Хэсэг ${nm}</div>${tb}</div>`;}).join("");
  const freeN=info&&!info.cls?info.free:0,sel=S.roomSel?CSEATS[S.roomSel-1]:null;
  const status=err?`<span class="err">${err}</span>`:info.cls?`<span class="err">Энэ хугацаанд хичээл орно: ${h(info.cls)}</span>`:freeN?`<span style="color:var(--ok);font-weight:600">${freeN} / ${CFG.classCap} суудал захиалах боломжтой</span>`:`<span class="err">Захиалагдсан — сул суудал алга</span>`;
  return `<div class="page-head"><div><a href="#/rooms" class="small">← Ангийн суудал хайх</a><h1 style="margin-top:6px">Анги ${r.number}</h1><p>${r.floor}-р давхар · 3 хэсэг × 5 ширээ × 2 суудал · захиалах боломжтой ${CFG.classCap} суудал</p></div></div>
  <div class="card pad" style="margin-bottom:16px"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2>Цаг сонгох</h2>
      <form id="roomBook" class="row" style="gap:8px"><select class="input" id="d-sp" name="sp" style="width:auto">${periodOpts(w.sp)}</select><span class="muted">–</span><select class="input" id="d-ep" name="ep" style="width:auto">${periodOpts(w.ep,true)}</select></form></div>
    <div class="day-chips" style="margin-bottom:14px">${days}</div>
    <div class="periods">${cells}</div>
    <p class="small muted" style="margin-top:10px">Цаг дээр дарж сонгоно; дараагийн цагийг дарвал муж уртасна (дээд тал нь ${CFG.maxClassPeriods} цаг). Хичээлтэй цаг хуваариас автоматаар тооцогдоно.</p>
  </div>
  <div class="lib-toolbar">
    <div class="card pad"><div class="eyebrow">Сонгосон хугацаа</div><div style="margin-top:6px;font-weight:600">${fmtShort(w.date)} · ${P[w.sp].label}${w.ep>w.sp?"–"+P[w.ep].label:""} цаг · <span class="mono">${fmtM(P[w.sp].start)}–${fmtM(P[w.ep].end)}</span></div><div style="margin-top:6px">${status}</div></div>
    <div class="card pad"><div class="eyebrow">Сул суудал</div><div class="count"><span class="bignum" style="color:${freeN?"var(--ok)":"var(--busy)"}">${blocked?"—":freeN}</span><span class="muted">/ ${CFG.classCap}</span></div><div class="small muted">${blocked?"":freeN?"захиалах боломжтой":"захиалагдсан"}</div></div>
  </div>
  <div class="card hall">
    <div class="hall-head"><h2>Ангийн суудал</h2><div class="legend"><span><i style="background:var(--ok-soft)"></i>Сул</span><span><i style="background:var(--busy-soft)"></i>Захиалагдсан</span><span><i style="background:var(--off-soft)"></i>Боломжгүй</span><span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>Таных</span><span><i style="background:var(--primary)"></i>Сонгосон</span></div></div>
    <div class="board" style="margin-bottom:14px">САМБАР</div>
    <div class="csecs">${secs}</div>
    <div class="entrance"><span>ХААЛГА</span></div>
    <p class="small muted" style="margin-top:10px;text-align:center">27–30 дугаар суудал ангийн захиалгын дээд хязгаар (${CFG.classCap}) -аас давсан тул захиалагдахгүй.</p>
  </div>
  <div class="selbar"><div>${sel?`<div style="font-weight:600">Анги ${r.number} · Суудал ${pad(sel.n)} · Хэсэг ${CSEC[sel.sec]} · Ширээ ${sel.table}</div><div class="small muted">${fmtShort(w.date)} · <span class="mono">${fmtM(P[w.sp].start)}–${fmtM(P[w.ep].end)}</span></div>`:`<div class="muted">${blocked||!freeN?"Энэ хугацаанд захиалах суудал алга.":"Зургаас сул (ногоон) суудал сонгоно уу."}</div>`}</div>
    <button class="btn" data-bookcseat ${sel?"":"disabled"}>Сонгосон суудлыг захиалах</button></div>`;
}

function viewLibrary(){
  const L=S.lib,w={date:L.date,start:L.start,end:L.start+CFG.libSlotMin},err=validateLib(w),now=Date.now();
  const myIds=new Set(mine().filter(s=>blocking(s,now)&&s.date===w.date&&overlap(s,w)).map(s=>s.resourceId));
  let freeN=0;
  const state=SEATS.map(s=>{let st;if(s.status!=="ACTIVE"||err)st="un";else if(myIds.has(s.id))st="mine";else if(seatFree(s.id,w)){st="av";freeN++;}else st="rs";if(S.libSel===s.id&&st==="av")st="sel";return st;});
  if(S.libSel&&state[seatById[S.libSel].number-1]!=="sel")S.libSel=null;
  const label={av:"сул",rs:"захиалагдсан",un:"ашиглах боломжгүй",mine:"таны захиалга",sel:"сонгосон"};
  const tables=TABLES.map(t=>{const a=SEATS[(t.number-1)*2],b=SEATS[(t.number-1)*2+1];
    const seat=s=>{const st=state[s.number-1];return `<button type="button" class="seat ${st}" data-seat="${s.id}" ${st==="av"||st==="sel"?"":"disabled"} aria-pressed="${st==="sel"}" aria-label="Суудал ${pad(s.number)}, ${label[st]}">${pad(s.number)}</button>`;};
    return `<div class="tbl"><div class="tbl-no">ШИРЭЭ ${pad(t.number)}</div><div class="tbl-body">${seat(a)}${seat(b)}</div></div>`;}).join("");
  let hours="";for(let m=CFG.libOpen;m+CFG.libSlotMin<=CFG.libClose;m+=60){const past=ts(L.date,m)+CFG.graceMin*60000<=now;hours+=`<button type="button" class="hr ${m===L.start?"on":""}" data-hour="${m}" ${past?"disabled":""}>${fmtM(m)}<small>–${fmtM(m+60)}</small></button>`;}
  const sel=S.libSel?seatById[S.libSel]:null,upc=libUpcoming();
  return `<div class="page-head"><div><h1>Номын сан · 12-р давхар</h1><p>Суудлыг 1 цагаар захиална. Илүү хэрэгтэй бол тухайн цаг эхэлсний дараа дахин захиална.</p></div></div>
  <div class="lib-toolbar">
    <form class="card pad" id="libForm">
      <div class="field" style="max-width:320px;margin-bottom:12px"><label for="l-date">Огноо</label><select class="input" id="l-date" name="date">${dateOpts(L.date)}</select></div>
      <div class="field"><label>Цаг (1 цаг)</label><div class="hours">${hours}</div></div>
      ${err?`<p class="err" style="margin-top:10px">${err}</p>`:""}
      ${upc.length?`<p class="note" style="margin-top:12px">Танд эхлээгүй захиалга байна: <b>${resName(upc[0])}</b>, ${fmtShort(upc[0].date)} <span class="mono">${fmtM(upc[0].start)}–${fmtM(upc[0].end)}</span>. Тэр цаг эхэлсний дараа дараагийн цагаа захиалж болно.</p>`:""}
    </form>
    <div class="card pad"><div class="eyebrow">Сул суудал</div><div class="count"><span class="bignum">${err?"—":freeN}</span><span class="muted">/ 70</span></div><div class="small muted">${fmtShort(L.date)} · <span class="mono">${fmtM(w.start)}–${fmtM(w.end)}</span></div></div>
  </div>
  <div class="card hall">
    <div class="hall-head"><h2>Уншлагын танхим</h2><div class="legend"><span><i style="background:var(--ok-soft)"></i>Сул</span><span><i style="background:var(--busy-soft)"></i>Захиалагдсан</span><span><i style="background:var(--off-soft)"></i>Боломжгүй</span><span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>Таных</span><span><i style="background:var(--primary)"></i>Сонгосон</span></div></div>
    <div class="shelves" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="tables">${tables}</div>
    <div class="entrance"><span>ОРЦ</span></div>
    <p class="small muted" style="margin-top:10px;text-align:center">Бүдүүвч зураг. Ширээний бодит байршил тодорхой болмогц шинэчилнэ.</p>
  </div>
  <div class="selbar"><div>${sel?`<div style="font-weight:600">Суудал ${pad(sel.number)} · Ширээ ${pad(sel.table)}</div><div class="small muted">${fmtShort(L.date)} · <span class="mono">${fmtM(w.start)}–${fmtM(w.end)}</span> · 1 цаг</div>`:`<div class="muted">Газрын зургаас сул (ногоон) суудал сонгоно уу.</div>`}</div>
    <button class="btn" data-booklib ${sel?"":"disabled"}>Сонгосон суудлыг захиалах</button></div>`;
}

function viewRes(id){
  const s=ownSlot(id);
  if(!s)return `<div class="card empty">Захиалга олдсонгүй. <a href="#/my">Миний захиалга</a></div>`;
  const now=Date.now(),e=eff(s,now),isC=isClassType(s.resourceType);
  let acts="";if(canCheckIn(s,now))acts+=`<button class="btn" data-checkin="${s.id}">Ирцээ бүртгүүлэх</button>`;if(canCancel(s,now))acts+=`<button class="btn danger" data-askcancel="${s.id}">Цуцлах</button>`;
  return `<div class="page-head"><div><a href="#/my" class="small">← Миний захиалга</a><h1 style="margin-top:6px">${resName(s)}</h1><p>${fmtLong(s.date)} · <span class="mono">${fmtM(s.start)}–${fmtM(s.end)}</span></p></div><div class="row">${acts}</div></div>
  <div class="detail-layout">
    ${reminderCard(s.resourceType,{lead:false})}
    <div class="card pad" style="align-self:start"><h2 style="margin-bottom:12px">Захиалгын мэдээлэл</h2>
      <dl class="kv" style="font-size:14.5px;gap:9px 18px">
        <dt>Захиалгын дугаар</dt><dd class="mono">${h(s.id)}</dd><dt>Төлөв</dt><dd>${chip(e)}</dd>
        <dt>Төрөл</dt><dd>${s.resourceType==="CLASSROOM_SEAT"?"Ангийн суудал (CLASSROOM_SEAT)":isC?"Бүтэн анги (CLASSROOM)":"Номын сангийн суудал (LIBRARY_SEAT)"}</dd><dt>Байршил</dt><dd>${resSub(s)}</dd>
        <dt>Огноо</dt><dd>${fmtLong(s.date)}</dd><dt>Цаг</dt><dd><span class="mono">${fmtM(s.start)}–${fmtM(s.end)}</span>${isC?" · "+pLabel(s):" · 1 цаг"}</dd>
        <dt>Ирц бүртгэх</dt><dd class="mono">${fmtM(s.start-CFG.checkinEarlyMin)}–${fmtM(s.start+CFG.graceMin)}</dd>
        <dt>Ирсэн цаг</dt><dd class="mono">${s.checkInAt?fmtClock(s.checkInAt):"—"}</dd><dt>Захиалсан</dt><dd>${fmtWhen(s.createdAt)}</dd>
      </dl></div>
  </div>`;
}
function viewMy(tab){
  const now=Date.now(),all=mine();
  const up=all.filter(s=>blocking(s,now)).sort((a,b)=>ts(a.date,a.start)-ts(b.date,b.start));
  const hist=all.filter(s=>!blocking(s,now)).sort((a,b)=>ts(b.date,b.start)-ts(a.date,a.start));
  const isH=tab==="history",list=isH?hist:up;
  return `<div class="page-head"><div><h1>${isH?"Захиалгын түүх":"Миний захиалга"}</h1><p>${isH?"Дууссан, цуцалсан болон ирээгүй захиалгууд.":"Идэвхтэй болон удахгүй болох захиалгууд."}</p></div>
    <nav class="tabs"><a href="#/my" class="${isH?"":"on"}">Удахгүй (${up.length})</a><a href="#/history" class="${isH?"on":""}">Түүх (${hist.length})</a></nav></div>
  <div class="card">${list.length?list.map(s=>resRow(s,!isH)).join(""):`<div class="empty">${isH?"Түүх хоосон байна.":"Идэвхтэй захиалга алга. <a href='#/rooms'>Анги</a> эсвэл <a href='#/library'>номын сангийн суудал</a> захиалаарай."}</div>`}</div>`;
}

function viewProfile(){
  const p=Object.assign({},S.profile,{email:S.email}),all=mine(),now=Date.now(),cnt=k=>all.filter(s=>eff(s,now)===k).length;
  const im=S.importMsg;
  return `<div class="page-head"><div><h1>Профайл</h1><p>Таны бүртгэлийн мэдээлэл ба захиалгын дүрэм.</p></div><div class="row">${themeBtn("plain")}<button class="btn ghost" data-logout>Гарах</button></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="grid" style="align-content:start">
    <form class="card pad grid" id="profForm" style="gap:14px"><h2>Оюутны мэдээлэл</h2>
      <div class="field"><label>Нэвтрэх нэр (UFE и-мэйл)</label><div class="input mono" style="display:flex;align-items:center;background:var(--surface-2)">${h(p.email)}</div></div>
      <div class="field"><label for="p-name">Нэр</label><input class="input" id="p-name" name="name" value="${h(p.name)}" required maxlength="60"></div>
      <div class="field"><label for="p-sid">Оюутны код</label><input class="input mono" id="p-sid" name="studentId" value="${h(p.studentId)}" maxlength="20"></div>
      <div class="small muted">Бүртгүүлсэн: ${p.createdAt?fmtWhen(p.createdAt):"—"}</div>
      <button class="btn" type="submit">Хадгалах</button>
    </form>
    <form class="card pad grid" id="pwForm" style="gap:12px" novalidate><h2>Нууц үг солих</h2>
      <div class="field"><label for="pw-a">Шинэ нууц үг</label><input class="input" id="pw-a" name="pw" type="password" autocomplete="new-password" maxlength="72"></div>
      <div class="field"><label for="pw-b">Давтах</label><input class="input" id="pw-b" name="pw2" type="password" autocomplete="new-password" maxlength="72"></div>
      <button class="btn ghost" type="submit">Нууц үг солих</button></form>
    ${S.isAdmin?`<div class="card pad grid" style="gap:12px"><h2>Хичээлийн хуваарь</h2>${schedNote()}
      <p class="small muted">schedule.xlsx загвараар (Даваа–Ням, I–XII цаг) бөглөсөн файлаа оруулна. Нүд бүрийн "C - C706" хэлбэрийн өрөө, "10:40-13:30" цагийг уншиж тухайн анги хичээлтэй цагийг тооцно. Онлайн болон өөр байрны хичээлийг алгасна.</p>
      <label class="btn ghost" for="sched-file" style="cursor:pointer">Excel файл сонгох (.xlsx)</label><input id="sched-file" type="file" accept=".xlsx,.xls" hidden>
      ${im?`<p class="${im.ok?"small":"err"}" style="${im.ok?"color:var(--ok);font-weight:600":""}">${h(im.t)}</p>`:""}
      <p class="small muted">Энэ хэсгийг зөвхөн app_admins хүснэгтэд бүртгэлтэй хүн харна.</p></div>`:""}
    </div>
    <div class="card pad" style="align-self:start"><h2 style="margin-bottom:10px">Статистик</h2>
      <table class="rules"><tr><td>Нийт захиалга</td><td class="mono">${all.length}</td></tr><tr><td>Дууссан</td><td class="mono">${cnt("COMPLETED")}</td></tr><tr><td>Цуцалсан</td><td class="mono">${cnt("CANCELLED")}</td></tr><tr><td>Ирээгүй</td><td class="mono">${cnt("NO_SHOW")}</td></tr></table>
      <h2 style="margin:20px 0 10px">Захиалгын дүрэм</h2>
      <table class="rules">
        <tr><td>Ангийн суудал</td><td>Суудлаар · ангид ${CFG.classCap} суудал</td></tr>
        <tr><td>Ангийн цаг</td><td>Хуваарийн I–XII цаг (${fmtM(P[0].start)}–${fmtM(P[11].end)})</td></tr>
        <tr><td>Ангийн дээд хугацаа</td><td>${CFG.maxClassPeriods} цаг (пар)</td></tr>
        <tr><td>Номын сангийн суудал</td><td>1 удаад 1 цаг</td></tr>
        <tr><td>Номын сан ажиллах цаг</td><td class="mono">${fmtM(CFG.libOpen)}–${fmtM(CFG.libClose)}</td></tr>
        <tr><td>Урьдчилан захиалах</td><td>${CFG.advanceDays} хоног</td></tr>
        <tr><td>Ирц бүртгэх</td><td>эхлэхээс ${CFG.checkinEarlyMin} мин өмнө – ${CFG.graceMin} мин дараа</td></tr>
        <tr><td>Ирээгүй бол</td><td>Автоматаар цуцлагдана</td></tr>
        <tr><td>Нэг цагт</td><td>1 оюутан = 1 суудал</td></tr>
        <tr><td>Давхар захиалга</td><td>Хориотой</td></tr>
      </table>
      <p class="small muted" style="margin-top:10px">Хугацааны хязгаарууд түр тохиргоо — сургууль эцэслэн шийдвэрлэнэ.</p>
    </div>
  </div>`;
}

function viewLogin(){
  const L=S.login,reg=L.mode==="up",demo=S.mode==="memory";
  const tabs=`<nav class="tabs" style="align-self:flex-start"><a href="#" data-auth-mode="in" class="${reg?"":"on"}">Нэвтрэх</a><a href="#" data-auth-mode="up" class="${reg?"on":""}">Бүртгүүлэх</a></nav>`;
  const form=`
    <form class="login-form" id="authForm" novalidate>
      ${tabs}
      <div><h2>${reg?"Шинээр бүртгүүлэх":"UFE и-мэйлээрээ нэвтэрнэ үү"}</h2></div>
      <div class="field"><label for="l-user">Нэвтрэх нэр (UFE и-мэйл)</label>
        <div class="suffix"><input class="input mono" id="l-user" name="user" required maxlength="60" autocomplete="username" value="${h(L.user)}" placeholder="b00fa0000"><span>@${CFG.emailDomain}</span></div></div>
      ${reg?`<div class="field"><label for="l-name">Нэр</label><input class="input" id="l-name" name="name" maxlength="60" autocomplete="name"></div>
      <div class="field"><label for="l-sid">Оюутны код (заавал биш)</label><input class="input mono" id="l-sid" name="studentId" maxlength="20"></div>`:""}
      <div class="field"><label for="l-pw">Нууц үг</label><input class="input" id="l-pw" name="password" type="password" autocomplete="${reg?"new-password":"current-password"}" minlength="6" maxlength="72"></div>
      ${reg?`<div class="field"><label for="l-pw2">Нууц үг давтах</label><input class="input" id="l-pw2" name="password2" type="password" autocomplete="new-password" maxlength="72"></div>`:""}
      <p class="err" id="authErr" ${L.err?"":"hidden"}>${h(L.err||"")}</p>
      <button class="btn block" type="submit">${reg?"Бүртгүүлэх":"Нэвтрэх"}</button>
      <p class="note">Зөвхөн <b>@${CFG.emailDomain}</b> хаягаар бүртгүүлнэ. ${reg?"Нууц үг хамгийн багадаа 6 тэмдэгт.":"Бүртгэлгүй бол <b>Бүртгүүлэх</b> хэсгээр нэг удаа бүртгүүлнэ."}${demo?" (Туршилтын горим — өгөгдөл хадгалагдахгүй.)":""} Нууц үгээ мартвал сургуулийн админд хандана уу.</p>
    </form>`;
  return `<div class="login-wrap"><div class="login-theme">${themeBtn("plain")}</div><div class="card login">
    <div class="login-art"><div><div class="brand-mark">UFE</div>
      <h1 style="margin-top:18px;color:inherit">Анги, номын сангийн суудал захиалга</h1>
      <p style="margin-top:8px;opacity:.85">Санхүү, эдийн засгийн их сургуулийн оюутнуудад.</p></div>${floorStack({static:true})}</div>
    ${form}</div></div>`;
}
function viewSetup(){
  return `<div class="login-wrap"><div class="card pad" style="width:min(460px,100%);padding:28px">
    <form class="grid" id="setupForm" style="gap:14px" novalidate>
      <div><div class="eyebrow">Анх удаа нэвтэрлээ</div><h2 style="margin-top:6px">Мэдээллээ бөглөнө үү</h2><p class="small muted" style="margin-top:4px">${h(S.email)}</p></div>
      <div class="field"><label for="s-name">Нэр</label><input class="input" id="s-name" name="name" required maxlength="60" autocomplete="name"></div>
      <div class="field"><label for="s-sid">Оюутны код (заавал биш)</label><input class="input mono" id="s-sid" name="studentId" maxlength="20"></div>
      <p class="err" id="setupErr" hidden></p>
      <button class="btn block" type="submit">Үргэлжлүүлэх</button>
      <button class="btn ghost block" type="button" data-logout>Гарах</button>
    </form></div></div>`;
}

function viewModal(){
  const m=S.modal;if(!m)return "";let body="";
  if(m.kind==="confirm"){const d=m.draft,isC=d.resourceType==="CLASSROOM_SEAT",r=isC?roomById[d.roomId]:seatById[d.resourceId],cs=isC?CSEATS[d.seatN-1]:null;
    body=`<h2>Захиалга баталгаажуулах</h2>
      <dl class="kv"><dt>Нөөц</dt><dd>${isC?"Анги "+r.number+" · Суудал "+pad(d.seatN)+" · Хэсэг "+CSEC[cs.sec]+" · Ширээ "+cs.table:"Номын сан · Суудал "+pad(r.number)+" · Ширээ "+pad(r.table)}</dd><dt>Давхар</dt><dd>${isC?r.floor:12}</dd><dt>Огноо</dt><dd>${fmtLong(d.date)}</dd><dt>Цаг</dt><dd><span class="mono">${fmtM(d.start)}–${fmtM(d.end)}</span>${isC?" · "+pLabel(d):" · 1 цаг"}</dd><dt>Суудал</dt><dd>1 хүн</dd></dl>
      <p class="small muted">Ирцээ ${fmtM(d.start-CFG.checkinEarlyMin)}–${fmtM(d.start+CFG.graceMin)} хооронд бүртгүүлнэ. Бүртгүүлээгүй бол автоматаар цуцлагдана.</p>
      <div class="acts"><button class="btn ghost" data-close>Болих</button><button class="btn" data-confirm ${S.busy?"disabled":""}>${S.busy?"Хадгалж байна…":"Захиалга баталгаажуулах"}</button></div>`;}
  else if(m.kind==="done"){const s=m.slot;
    body=`<div class="row" style="gap:14px;flex-wrap:nowrap"><div class="okmark" style="flex:0 0 auto">${I.check}</div><div><h2>Захиалга баталгаажлаа</h2><p class="muted" style="margin-top:4px">${resName(s)} · ${fmtLong(s.date)} · <span class="mono">${fmtM(s.start)}–${fmtM(s.end)}</span></p></div></div>
      <div><div class="eyebrow">Захиалгын дугаар</div><div class="resid">${h(s.id)}</div></div>
      ${reminderCard(s.resourceType,{inModal:true})}
      <div class="acts"><a class="btn ghost" href="#/res/${h(s.id)}" data-close>Захиалгын дэлгэрэнгүй</a><button class="btn" data-close>Ойлголоо</button></div>`;}
  else if(m.kind==="cancel"){const s=S.slots.find(x=>x.id===m.id);
    body=`<h2>Захиалгыг цуцлах уу?</h2><p>${s?resName(s)+" · "+fmtShort(s.date)+" · "+fmtM(s.start)+"–"+fmtM(s.end):""}</p><p class="small muted">Цуцалсны дараа энэ цаг бусад оюутанд шууд нээгдэнэ.</p>
      <div class="acts"><button class="btn ghost" data-close>Үгүй</button><button class="btn danger" data-docancel="${h(m.id)}">Тийм, цуцлах</button></div>`;}
  else if(m.kind==="error"){body=`<h2>Захиалах боломжгүй</h2><p>${h(m.text)}</p><div class="acts"><button class="btn" data-close>Ойлголоо</button></div>`;}
  return `<div class="scrim" data-scrim><div class="modal ${m.kind==="done"?"wide":""}" role="dialog" aria-modal="true">${body}</div></div>`;
}
function viewPanel(){if(!S.panel)return "";const r=new Set(S.prefs.read||[]),ns=notifs();
  return `<div class="panel" role="dialog" aria-label="Мэдэгдэл"><div class="panel-h"><h3>Мэдэгдэл</h3><button class="linkbtn" data-readall>Бүгдийг уншсан</button></div>
    ${ns.length?ns.map(n=>`<div class="nt ${r.has(n.id)?"":"unread"}"><i></i><div><div>${h(n.text)}</div><div class="when">${fmtWhen(n.t)}</div></div></div>`).join(""):`<div class="empty">Мэдэгдэл алга.</div>`}</div>`;}
function banner(){return `<div class="demo-banner">Туршилтын горим: Supabase тохируулаагүй (js/config.js). Жишээ захиалгууд харагдаж байна; өгөгдөл хадгалагдахгүй.</div>`;}

function render(){
  const app=document.getElementById("app");
  if(S.mode==="loading"){app.innerHTML=`<div class="loading">Ачааллаж байна…</div>`;return;}
  const r=route();
  if(!S.acct||!S.profile){app.innerHTML=(S.mode==="memory"?banner():"")+(S.acct?viewSetup():viewLogin())+(S.toast?`<div class="toast" role="status">${h(S.toast)}</div>`:"");return;}
  const page=r[0]||"home";let body;
  if(page==="rooms")body=viewRooms();else if(page==="room")body=viewRoom(r[1]);else if(page==="library")body=viewLibrary();
  else if(page==="my")body=viewMy("up");else if(page==="history")body=viewMy("history");else if(page==="profile")body=viewProfile();else if(page==="res")body=viewRes(r[1]);else body=viewHome();
  const on=k=>(k===page||(k==="rooms"&&page==="room")||(k==="my"&&(page==="history"||page==="res"))||(k==="home"&&!["rooms","room","library","my","history","profile","res"].includes(page)))?"on":"";
  const u=unreadCount(),ini=(((S.profile&&S.profile.name)||S.email||"?").trim()[0]||"?").toUpperCase(),sy=window.scrollY;
  app.innerHTML=(S.mode==="memory"?banner():"")+`<header class="topbar"><div class="topbar-in">
    <a class="brand" href="#/"><span class="brand-mark">UFE</span><span class="brand-t">Захиалга<small>Анги · Номын сан</small></span></a>
    <nav class="nav"><a href="#/" class="${on("home")}">Нүүр</a><a href="#/rooms" class="${on("rooms")}">Ангийн суудал</a><a href="#/library" class="${on("library")}">Номын сан</a><a href="#/my" class="${on("my")}">Миний захиалга</a></nav>
    <div class="top-right">${themeBtn()}<button class="iconbtn" data-bell aria-label="Мэдэгдэл${u?", "+u+" шинэ":""}">${I.bell}${u?`<span class="dot">${u>9?"9+":u}</span>`:""}</button>
    <a class="avatar" href="#/profile" aria-label="Профайл">${h(ini)}</a></div></div></header>
  <main>${body}</main>
  <nav class="bnav"><a href="#/" class="${on("home")}">${I.home}Нүүр</a><a href="#/rooms" class="${on("rooms")}">${I.door}Анги</a><a href="#/library" class="${on("library")}">${I.book}Номын сан</a><a href="#/my" class="${on("my")}">${I.list}Захиалга</a><a href="#/profile" class="${on("profile")}">${I.user}Профайл</a></nav>
  ${viewPanel()}${viewModal()}${S.toast?`<div class="toast" role="status">${h(S.toast)}</div>`:""}`;
  window.scrollTo(0,sy);
}

/* ============ Events ============ */
function cseatDraft(roomId,n,date,sp,ep){return {resourceType:"CLASSROOM_SEAT",resourceId:cseatId(roomId,n),roomId,seatN:n,date,start:P[sp].start,end:P[ep].end};}
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-floor],[data-enter],[data-cseat],[data-bookcseat],[data-cell],[data-pick],[data-seat],[data-hour],[data-booklib],[data-close],[data-confirm],[data-askcancel],[data-docancel],[data-checkin],[data-bell],[data-readall],[data-logout],[data-auth-mode],[data-dday],[data-theme-toggle],[data-scrim]");
  if(S.panel&&!e.target.closest(".panel")&&!e.target.closest("[data-bell]")){S.panel=false;render();}
  if(!t)return;const d=t.dataset;
  if(d.scrim!==undefined){if(e.target===t&&!S.busy){S.modal=null;render();}return;}
  if(d.themeToggle!==undefined){toggleTheme();return;}
  if(d.floor!==undefined){if(d.floor==="12"){location.hash="#/library";return;}S.q.floor=d.floor==="all"?"all":d.floor;if(route()[0]!=="rooms")location.hash="#/rooms";render();return;}
  if(d.enter){S.detail=null;return;}
  if(d.cell){const [rid2,pi]=d.cell.split("|");S.detail={id:rid2,date:S.q.date,sp:+pi,ep:+pi};S.roomSel=null;location.hash="#/room/"+rid2;return;}
  if(d.pick!==undefined){const pi=+d.pick,w=S.detail;if(pi===w.ep+1&&w.ep-w.sp+1<CFG.maxClassPeriods)w.ep=pi;else{w.sp=pi;w.ep=pi;}S.roomSel=null;render();return;}
  if(d.cseat){const n=+d.cseat;S.roomSel=S.roomSel===n?null:n;render();return;}
  if(d.bookcseat!==undefined){const w=S.detail;if(!S.roomSel||!w)return;S.modal={kind:"confirm",draft:cseatDraft(w.id,S.roomSel,w.date,w.sp,w.ep)};render();return;}
  if(d.seat){S.libSel=S.libSel===d.seat?null:d.seat;render();return;}
  if(d.hour){S.lib.start=+d.hour;render();return;}
  if(d.booklib!==undefined){if(!S.libSel)return;S.modal={kind:"confirm",draft:{resourceType:"LIBRARY_SEAT",resourceId:S.libSel,date:S.lib.date,start:S.lib.start,end:S.lib.start+CFG.libSlotMin}};render();return;}
  if(d.close!==undefined){if(S.busy)return;S.modal=null;render();return;}
  if(d.confirm!==undefined){book(S.modal.draft);return;}
  if(d.askcancel){S.modal={kind:"cancel",id:d.askcancel};render();return;}
  if(d.docancel){cancelRes(d.docancel);return;}
  if(d.checkin){checkIn(d.checkin);return;}
  if(d.bell!==undefined){S.panel=!S.panel;render();if(S.panel)setTimeout(markAllRead,1500);return;}
  if(d.readall!==undefined){markAllRead();return;}
  if(d.logout!==undefined){(async()=>{try{await store.logout();}catch(x){}S.login={mode:"in",user:"",err:null,busy:false};await setUser(null);location.hash="#/";})();return;}
  if(d.authMode){e.preventDefault();S.login={mode:d.authMode,user:S.login.user,err:null,busy:false};render();return;}
  if(d.dday){S.detail.date=d.dday;S.roomSel=null;const i=nextPeriod(d.dday);if(i>S.detail.sp){S.detail.sp=Math.max(0,i);S.detail.ep=Math.max(S.detail.ep,S.detail.sp);}render();return;}
});
document.addEventListener("change",e=>{
  if(e.target.id==="sched-file"){const f=e.target.files&&e.target.files[0];if(f)importSchedule(f);return;}
  const f=e.target.form;if(!f)return;const n=e.target.name,v=e.target.value;
  const fix=o=>{if(o.ep<o.sp)o.ep=o.sp;if(o.ep-o.sp+1>CFG.maxClassPeriods)o.ep=o.sp+CFG.maxClassPeriods-1;};
  if(f.id==="roomForm"){S.q[n]=(n==="sp"||n==="ep")?+v:v;if(n==="sp")fix(S.q);render();}
  if(f.id==="libForm"&&n==="date"){S.lib.date=v;const firstOk=[...Array(13)].map((_,i)=>CFG.libOpen+i*60).find(m=>ts(v,m)+CFG.graceMin*60000>Date.now());if(firstOk!=null&&S.lib.start<firstOk)S.lib.start=firstOk;S.libSel=null;render();}
  if(f.id==="roomBook"){S.detail[n]=+v;if(n==="sp")fix(S.detail);S.roomSel=null;render();}
});
document.addEventListener("input",e=>{if(e.target.id==="q-cap")S.q.cap=e.target.value.replace(/[^0-9]/g,"");});
document.addEventListener("submit",async e=>{
  const f=e.target;e.preventDefault();
  if(f.id==="roomForm"){S.q.cap=f.cap.value.replace(/[^0-9]/g,"");render();return;}
  if(f.id==="authForm"){
    const L=S.login,reg=L.mode==="up";
    let u=f.user.value.trim().toLowerCase();L.user=u.split("@")[0];
    const btn=f.querySelector("button[type=submit]"),errEl=f.querySelector("#authErr"),label=btn.textContent;
    const fail=t=>{errEl.textContent=t;errEl.hidden=false;btn.disabled=false;btn.textContent=label;};
    if(u.includes("@")){const [a,dom]=u.split("@");if(dom!==CFG.emailDomain)return fail("Зөвхөн @"+CFG.emailDomain+" хаягаар нэвтэрнэ.");u=a;}
    if(!/^[a-z0-9][a-z0-9._-]{1,40}$/.test(u))return fail("Нэвтрэх нэр буруу байна. Жишээ: b22fa1260@"+CFG.emailDomain);
    const email=u+"@"+CFG.emailDomain,pw=f.password.value;
    if(pw.length<6)return fail("Нууц үг хамгийн багадаа 6 тэмдэгт байна.");
    if(reg){
      const name=f.name.value.trim(),sid=f.studentId.value.trim().toUpperCase();
      if(!name)return fail("Нэрээ оруулна уу.");
      if(sid&&!/^[A-Z0-9-]{4,20}$/.test(sid))return fail("Оюутны код 4–20 тэмдэгт (латин үсэг, тоо) байна.");
      if(pw!==f.password2.value)return fail("Нууц үг таарахгүй байна.");
      S.pendingProfile={name,studentId:sid,createdAt:Date.now()};
    }
    errEl.hidden=true;btn.disabled=true;btn.textContent="Түр хүлээнэ үү…";
    try{const usr=reg?await store.signUp(email,pw):await store.signIn(email,pw);
      S.login={mode:"in",user:"",err:null,busy:false};await setUser(usr);location.hash="#/";}
    catch(x){S.pendingProfile=null;const m=String(x&&x.message||"");
      fail(/Invalid login credentials/i.test(m)?"И-мэйл эсвэл нууц үг буруу байна.":
           /already registered|already exists/i.test(m)?"Энэ и-мэйл бүртгэлтэй байна. \"Нэвтрэх\" хэсгээр орно уу.":
           /CONFIRM_EMAIL_ON|not confirmed/i.test(m)?"Бүртгэл үүссэн ч и-мэйл баталгаажуулалт асаалттай байна. Supabase → Sign In / Providers → Email → \"Confirm email\"-ийг унтраана уу.":
           /Database error|ufe\.edu\.mn/i.test(m)?"Зөвхөн @"+CFG.emailDomain+" хаягаар бүртгүүлнэ.":
           /rate|limit|too many/i.test(m)?"Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.":
           /password/i.test(m)?"Нууц үг хэт сул байна. Илүү урт нууц үг сонгоно уу.":
           "Алдаа гарлаа: "+m);}
    return;
  }
  if(f.id==="pwForm"){const a=f.pw.value,b=f.pw2.value;
    if(a.length<6){toast("Нууц үг хамгийн багадаа 6 тэмдэгт.");return;}if(a!==b){toast("Нууц үг таарахгүй байна.");return;}
    try{await store.changePassword(a);f.reset();toast("Нууц үг солигдлоо.");}catch(x){toast("Солиж чадсангүй: "+(x.message||""));}return;}
  if(f.id==="setupForm"){
    const name=f.name.value.trim(),sid=f.studentId.value.trim().toUpperCase(),el=f.querySelector("#setupErr");
    if(!name){el.textContent="Нэрээ оруулна уу.";el.hidden=false;return;}
    if(sid&&!/^[A-Z0-9-]{4,20}$/.test(sid)){el.textContent="Оюутны код 4–20 тэмдэгт (латин үсэг, тоо) байна.";el.hidden=false;return;}
    const p={name,studentId:sid,createdAt:Date.now()};
    try{await store.saveProfile(p);S.profile=p;location.hash="#/";render();}catch(x){el.textContent="Хадгалж чадсангүй. Дахин оролдоно уу.";el.hidden=false;}
    return;
  }
  if(f.id==="profForm"){const name=f.name.value.trim(),sid=f.studentId.value.trim().toUpperCase();
    if(!name){toast("Нэрээ оруулна уу.");return;}if(sid&&!/^[A-Z0-9-]{4,20}$/.test(sid)){toast("Оюутны код 4–20 тэмдэгт байна.");return;}
    try{const np=Object.assign({},S.profile,{name,studentId:sid});await store.saveProfile(np);S.profile=np;toast("Мэдээлэл хадгалагдлаа.");}catch(x){toast("Хадгалж чадсангүй.");}render();}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(S.modal&&!S.busy){S.modal=null;render();}else if(S.panel){S.panel=false;render();}}});
window.addEventListener("hashchange",()=>{S.panel=false;render();window.scrollTo(0,0);});
boot();
})();
