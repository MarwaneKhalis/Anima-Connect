import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Application, CareerDiscovery, JobOffer, RunMode } from '../src/shared/career.ts';
import { careerUrl, CareerError, CareerStore } from './career-store.ts';
import { Vault } from './vault.ts';
import type { CareerQueue } from './career-queue.ts';
import type { CareerSourceScheduler } from './career-source-scheduler.ts';

export interface CareerApiContext {
  store: CareerStore;
  vault: Vault;
  browser?: { discover?: CareerDiscovery['discover'] };
  runner: { start(id:string,mode:RunMode,credentialId?:string):Application; isBusy():boolean; pendingApplicationId?():string|null; closeManualSession?():Promise<boolean>; stop():Promise<void> };
  queue: Pick<CareerQueue,'snapshot'|'enqueue'|'pause'|'resume'|'cancel'|'pauseAfterActive'>;
  discovery: CareerDiscovery;
  sourceScheduler?: Pick<CareerSourceScheduler,'runNow'>;
  demo: boolean;
  allowTestAutomation?: boolean;
  allowedTestOrigins?: string[];
}
const reply=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new CareerError(400,'validation','Objet JSON attendu.');return v as Record<string,unknown>;};
const string=(v:unknown,name:string,max=10000)=>{if(typeof v!=='string'||v.length>max)throw new CareerError(400,'validation',`${name} invalide.`);return v;};
const fields=(v:Record<string,unknown>,keys:string[])=>{for(const k of Object.keys(v))if(!keys.includes(k))throw new CareerError(400,'validation',`Champ interdit : ${k}.`);};
async function json(req:IncomingMessage,max=1_000_000):Promise<Record<string,unknown>> {if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw new CareerError(400,'validation','Contenu JSON attendu.');const length=Number(req.headers['content-length']||0);if(length>max)throw new CareerError(413,'too_large','Requête trop volumineuse.');const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>max)throw new CareerError(413,'too_large','Requête trop volumineuse.');chunks.push(b);}try{return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){if(e instanceof CareerError)throw e;throw new CareerError(400,'validation','JSON invalide.');}}
const noDemo=(ctx:CareerApiContext,operation:string,targetUrl?:string)=>{if(!ctx.demo)return;if(!ctx.allowTestAutomation||!ctx.allowedTestOrigins?.length||(targetUrl&&!ctx.allowedTestOrigins.includes(new URL(targetUrl).origin)))throw new CareerError(403,'demo_disabled',`${operation} désactivé en démonstration.`);};
const safeFilename=(name:string)=>name.replace(/[\r\n"\\/\x00-\x1f\x7f]/g,'_').slice(0,150)||'cv';
const contentDisposition=(name:string)=>{const clean=safeFilename(name),ascii=clean.replace(/[^\x20-\x7e]/g,'_');return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;};
function decodeResumeBase64(value:unknown):Buffer {
  const encoded=string(value,'CV',14_000_000);
  if(encoded.length===0||encoded.length%4!==0)throw new CareerError(400,'validation','Base64 invalide.');
  let padding=0;
  if(encoded.endsWith('=='))padding=2;else if(encoded.endsWith('='))padding=1;
  const decodedLength=encoded.length/4*3-padding;
  if(decodedLength>10*1024*1024)throw new CareerError(413,'too_large','CV limité à 10 Mio.');
  for(let i=0;i<encoded.length-padding;i++){const c=encoded.charCodeAt(i);if(!((c>=65&&c<=90)||(c>=97&&c<=122)||(c>=48&&c<=57)||c===43||c===47))throw new CareerError(400,'validation','Base64 invalide.');}
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==decodedLength||bytes.toString('base64')!==encoded)throw new CareerError(400,'validation','Base64 invalide.');
  return bytes;
}

export async function handleCareerApi(req:IncomingMessage,res:ServerResponse,url:URL,context:CareerApiContext):Promise<boolean>{
  const path=url.pathname;if(!path.startsWith('/api/career/'))return false;
  const relative=path.slice('/api/career'.length),method=req.method||'GET';
  const known=relative==='/bootstrap'||relative==='/profile'||relative==='/resumes'||/^\/resumes\/[^/]+(?:\/download)?$/.test(relative)||relative.startsWith('/vault/')||relative==='/credentials'||/^\/credentials\/[^/]+$/.test(relative)||relative==='/jobs'||relative==='/discover'||relative==='/sources'||/^\/sources\/[a-f0-9-]{36}(?:\/run)?$/i.test(relative)||relative==='/applications'||/^\/applications\/[^/]+(?:\/(?:run|resolve|responses)(?:\/[a-f0-9-]{36})?)?$/i.test(relative)||relative==='/queue'||relative==='/queue/pause'||relative==='/queue/resume'||relative==='/queue/cancel'||relative==='/manual-session/close';
  if(!known)return false;
  try{
    if(method!=='GET'&&req.headers['x-anima-request']!=='1')throw new CareerError(403,'csrf','En-tête de requête requis.');
    const {store,vault,runner}=context;
    if(method==='GET'&&relative==='/queue'){reply(res,200,context.queue.snapshot());return true;}
    if(method==='POST'&&relative==='/queue'){
      noDemo(context,'File de candidatures');
      const o=await json(req);fields(o,['applicationIds','mode','credentialId']);
      if(o.mode!=='submit')throw new CareerError(400,'validation','La file accepte uniquement le mode submit.');
      reply(res,202,context.queue.enqueue(o.applicationIds,o.credentialId===undefined?undefined:string(o.credentialId,'Compte',64)));return true;
    }
    if(method==='POST'&&relative==='/queue/pause'){await json(req);reply(res,200,context.queue.pause());return true;}
    if(method==='POST'&&relative==='/queue/resume'){await json(req);noDemo(context,'Reprise de la file');reply(res,202,context.queue.resume());return true;}
    if(method==='POST'&&relative==='/queue/cancel'){await json(req);reply(res,200,await context.queue.cancel());return true;}
    if(method==='POST'&&relative==='/manual-session/close'){await json(req);if(runner.isBusy())throw new CareerError(409,'browser_busy','Un parcours navigateur est déjà en cours.');reply(res,200,{closed:await runner.closeManualSession?.()||false});return true;}
    if(method==='GET'&&relative==='/bootstrap'){reply(res,200,{profile:store.getProfile(),resumes:store.listResumes(),credentials:vault.listCredentials(),jobs:store.listJobs(),sources:store.listSources(),applications:store.listApplications(),events:store.listEvents(),responses:store.listResponses(),metrics:store.getMetrics(),vault:vault.status(),manualSessionApplicationId:runner.pendingApplicationId?.()||null});return true;}
    if(method==='PUT'&&relative==='/profile'){reply(res,200,store.saveProfile(await json(req)));return true;}
    if(method==='POST'&&relative==='/resumes'){const o=await json(req,14_500_000);fields(o,['name','filename','mime','base64']);reply(res,201,store.saveResume({name:string(o.name,'Nom',200),filename:string(o.filename,'Fichier',255),mime:string(o.mime,'Type',100),bytes:decodeResumeBase64(o.base64)}));return true;}
    const resume=relative.match(/^\/resumes\/([^/]+)(?:\/(download))?$/);if(resume){const id=resume[1];if(method==='GET'&&resume[2]==='download'){const value=store.getResume(id);res.writeHead(200,{'Content-Type':value.meta.mime,'Content-Disposition':contentDisposition(value.meta.filename),'Content-Length':value.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value.bytes);return true;}if(method==='DELETE'&&!resume[2]){store.deleteResume(id);reply(res,200,{deleted:true});return true;}}
    if(method==='POST'&&relative==='/vault/initialize'){noDemo(context,'Coffre');const o=await json(req);fields(o,['passphrase']);reply(res,201,vault.initialize(string(o.passphrase,'Phrase secrète',10000)));return true;}
    if(method==='POST'&&relative==='/vault/unlock'){noDemo(context,'Coffre');const o=await json(req);fields(o,['passphrase']);reply(res,200,vault.unlock(string(o.passphrase,'Phrase secrète',10000)));return true;}
    if(method==='POST'&&relative==='/vault/lock'){await json(req);await context.queue.pauseAfterActive();await runner.stop();reply(res,200,vault.lock());return true;}
    if(method==='POST'&&relative==='/credentials'){noDemo(context,'Comptes');const o=await json(req);fields(o,['origin','label','username','password']);reply(res,201,vault.saveCredential({origin:string(o.origin,'Origine',500),label:string(o.label,'Libellé',200),username:string(o.username,'Identifiant',500),password:string(o.password,'Mot de passe',10000)}));return true;}
    const credential=relative.match(/^\/credentials\/([^/]+)$/);if(method==='DELETE'&&credential){vault.deleteCredential(credential[1]);reply(res,200,{deleted:true});return true;}
    if(method==='POST'&&relative==='/jobs'){reply(res,201,store.saveJob(await json(req)));return true;}
    if(method==='GET'&&relative==='/sources'){reply(res,200,store.listSources());return true;}
    if(method==='POST'&&relative==='/sources'){noDemo(context,'Sources enregistrées');const o=await json(req);fields(o,['label','url','cadenceHours']);const sourceUrl=careerUrl(o.url,context.allowedTestOrigins);await context.discovery.validate?.(sourceUrl);reply(res,201,store.createSource({label:string(o.label,'Nom',120),url:sourceUrl,cadenceHours:o.cadenceHours}));return true;}
    const savedSource=relative.match(/^\/sources\/([a-f0-9-]{36})(?:\/(run))?$/i);if(savedSource){const sourceId=savedSource[1],action=savedSource[2];if(method==='PATCH'&&!action){reply(res,200,store.updateSource(sourceId,await json(req)));return true;}if(method==='DELETE'&&!action){store.deleteSource(sourceId);reply(res,200,{deleted:true});return true;}if(method==='POST'&&action==='run'){noDemo(context,'Collecte de source');if(!context.sourceScheduler)throw new CareerError(503,'unavailable','Collecte indisponible.');reply(res,202,await context.sourceScheduler.runNow(sourceId));return true;}}
    if(method==='POST'&&relative==='/discover'){if(runner.isBusy())throw new CareerError(409,'browser_busy','Navigateur occupé.');const o=await json(req);fields(o,['url']);const inputUrl=careerUrl(o.url,context.allowedTestOrigins);noDemo(context,'Découverte',inputUrl);const discovered=await context.discovery.discover(inputUrl);if(!Array.isArray(discovered.offers)||discovered.offers.length>200)throw new CareerError(400,'validation','Résultat de découverte invalide.');const jobs:JobOffer[]=discovered.offers.map(offer=>store.saveJob(offer));reply(res,200,{jobs,note:String(discovered.note||'').slice(0,1000)});return true;}
    if(method==='POST'&&relative==='/applications'){const o=await json(req);fields(o,['jobId','resumeId','prospectId']);const before=store.listApplications().some(a=>a.jobId===o.jobId);const a=store.createApplication({jobId:string(o.jobId,'Offre',64),resumeId:string(o.resumeId,'CV',64),...(o.prospectId!==undefined?{prospectId:string(o.prospectId,'Prospect',64)}:{})});reply(res,before?200:201,a);return true;}
    const application=relative.match(/^\/applications\/([^/]+)(?:\/(run|resolve|responses)(?:\/([a-f0-9-]{36}))?)?$/i);if(application){const id=application[1],action=application[2],responseId=application[3];if(method==='GET'&&!action){reply(res,200,store.getApplication(id));return true;}if(method==='PATCH'&&!action){reply(res,200,store.updateApplication(id,await json(req)));return true;}if(method==='GET'&&action==='responses'&&!responseId){store.getApplication(id);reply(res,200,store.listResponses(id));return true;}if(method==='POST'&&action==='responses'&&!responseId){noDemo(context,'Journal de réponses employeur');reply(res,201,store.recordEmployerResponse(id,await json(req)));return true;}if(method==='DELETE'&&action==='responses'&&responseId){store.deleteEmployerResponse(id,responseId);reply(res,200,{deleted:true});return true;}if(method==='POST'&&action==='run'){const target=store.getJob(store.getApplication(id).jobId).url;noDemo(context,'Automatisation',target);const o=await json(req);fields(o,['mode','credentialId']);if(o.mode!=='prepare'&&o.mode!=='submit')throw new CareerError(400,'validation','Mode invalide.');reply(res,202,runner.start(id,o.mode,o.credentialId===undefined?undefined:string(o.credentialId,'Compte',64)));return true;}if(method==='POST'&&action==='resolve'){const o=await json(req);fields(o,['resolution','detail']);reply(res,200,store.resolveUncertain(id,{resolution:o.resolution as 'submitted'|'not_submitted',detail:string(o.detail,'Détail',1000)}));return true;}}
    return false;
  }catch(error){const e=error instanceof CareerError?error:new CareerError(500,'internal','Erreur interne de candidature.');reply(res,e.status,{error:e.message,code:e.code});return true;}
}
