import {EventEngine,Simulation,Transport,AGENTS,COLORS,FIELDS} from './engine.js';
import {Network,Stream,Horizon,DispatchTape,sparkline} from './field.js';
import {Energy} from './effects.js';
import {GPUStream} from './gpu-stream.js';
import {EventInstruments} from './instruments.js';

const $=id=>document.getElementById(id);
const num=n=>n.toLocaleString('en-US');
const k=n=>(n/1000).toFixed(1);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let engine,simulation,transport,selected=null,mode='simulation',sourceState='simulation',started=Date.now(),lastUI=0,lastFrame=0,lastPhysics=0,frames=0,fps=60,frameStart=0,filtered=[],logVersion=-1,autoHidden=false;
initializeDock();
function initializeDock(){
  const host=document.querySelector('.panels');
  for(const [a,b]of [['tasks','subtasks'],['agents','errors'],['code','paper'],['metrics','tokens']]){
    const group=document.createElement('section');group.className='dock-module';group.setAttribute('aria-label',`${a} and ${b}`);
    const tabs=document.createElement('div');tabs.className='dock-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',`${a} / ${b}`);group.append(tabs);
    const articles=[a,b].map(name=>host.querySelector(`.${name}-panel`));
    [a,b].forEach((name,i)=>{const panel=articles[i],button=document.createElement('button');panel.id=`dock-${name}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`tab-${name}`);panel.hidden=i!==0;button.id=`tab-${name}`;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-selected',String(i===0));button.tabIndex=i===0?0:-1;button.textContent=name.toUpperCase();button.onclick=()=>{[...tabs.children].forEach((t,j)=>{t.setAttribute('aria-selected',String(i===j));t.tabIndex=i===j?0:-1;articles[j].hidden=i!==j});refreshUI()};button.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=[...tabs.children][i===0?1:0];next.click();next.focus()}};tabs.append(button);group.append(panel)});host.append(group);
  }
}
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const dispatch=new DispatchTape($('dispatch-queue'));
const stream=new GPUStream($('stream-canvas'));
const horizon=new Horizon($('horizon'));
const energy=new Energy($('energy-canvas'));
const network=new Network($('network-canvas'),{nodes:new Map(),edges:new Map()},{onSelect:selectAgent,tooltip:$('node-tooltip')});
const micro=new EventInstruments(()=>engine,{onAgent:selectAgent});

function boot(prime=true){
  transport?.close();engine=new EventEngine({budget:engine?.budget??2000000,onBudget:()=>{syncPause();transport?.close();showNotice('Token 预算已用完，本地接收已暂停。提高预算后可继续，远端智能体不受影响。')}});network.engine=engine;selected=null;network.selected=null;horizon.ids=null;horizon.update([],null);stream.rays=[];energy.reset();$('latest-tool').textContent='—';$('latest-content').textContent='等待下一条事件';
  transport=new Transport(engine,onTransportStatus);simulation=new Simulation(engine);mode=prime?'simulation':mode;started=Date.now();
  engine.subscribe(events=>{dispatch.push(events,engine.totalEvents);for(const e of events){if(e.type==='tool_call'||e.type==='tool_result')energy.spawn(e);if(['tool_result','output'].includes(e.type)){stream.spawn(e);$('latest-tool').textContent=e.tool||e.agentName;$('latest-content').textContent=e.content;if(e.type==='output'||/python|code|exec/.test(e.tool))renderCode(e.content,e)}}horizon.update(engine.events,selected)});
  if(!prime)renderCode('Waiting for code output…');
  codeHistory=[];if(prime)simulation.prime();dispatch.seed(engine.events,engine.totalEvents);$('selection-chip').hidden=true;logVersion=-1;syncPause();refreshUI();
}
function showNotice(text){$('notice').textContent=text;$('notice').hidden=!text}
function onTransportStatus(status){sourceState=status;const label=mode==='simulation'?'SIMULATION':mode==='sse'?'SSE':'WEBSOCKET';$('source-label').textContent=status==='connecting'?`${label} · CONNECTING`:label;$('session-state').textContent=engine.paused?'PAUSED':status==='connected'||status==='simulation'?'LIVE SESSION':status==='connecting'?'CONNECTING':'SIGNAL LOST';
  const messages={error:'Connection interrupted. Check the endpoint, CORS and network. SSE reconnects automatically; reopen the source control to retry WebSocket.',timeout:'No connection after 10 seconds. Check the endpoint URL and server availability.',disconnected:'WebSocket disconnected. Reconnect using the source control.',invalid:'Malformed event ignored. Send JSON with eventId, agentId, type and the documented fields.'};
  if(messages[status])showNotice(messages[status]);else if(['connected','simulation','connecting'].includes(status))showNotice('');
  $('live-dot').style.background=['error','disconnected','timeout'].includes(status)?COLORS.error:'';
}
function syncPause(){document.body.classList.toggle('paused',engine.paused);$('pause-label').textContent=engine.paused?'Resume':'Pause';$('pause-icon').textContent=engine.paused?'▷':'Ⅱ';$('pause-button').setAttribute('aria-label',engine.paused?'Resume session':'Pause session');$('session-state').textContent=engine.paused?(engine.pauseReason==='budget'?'BUDGET LIMIT':'PAUSED'):['connected','simulation'].includes(sourceState)?'LIVE SESSION':'CONNECTING';$('reset-button').disabled=mode!=='simulation';$('reset-button').title=mode==='simulation'?'Restart simulation (R)':'Restart is available in simulation mode';}
function togglePause(){if(!engine.paused){engine.pause('manual');if(mode!=='simulation')transport.close();showNotice(mode==='simulation'?'':'Local observation paused. Live events during a pause are not replayed.')}else{if(!engine.resume()){$('budget-dialog').showModal();return}showNotice('');if(mode!=='simulation')try{transport.connect(mode,transport.url)}catch(e){showNotice(e.message)}}syncPause();refreshUI()}
function selectAgent(id){selected=selected===id?null:id;network.selected=selected;$('selection-chip').hidden=!selected;$('selection-label').textContent=selected?engine.nodes.get(selected)?.name:'';horizon.ids='';horizon.update(engine.events,selected);logVersion=-1;renderAgents();if($('event-dialog').open)renderLog(true)}
function renderAgents(){
  const agents=[...engine.nodes.values()].filter(n=>n.kind==='agent');$('active-agent-count').textContent=String(agents.length).padStart(2,'0');
  $('agent-list').innerHTML=agents.slice(0,8).map((n,i)=>`<button class="agent-row ${selected===n.id?'selected':''}" data-agent="${escape(n.id)}" aria-pressed="${selected===n.id}" title="${escape(n.name)} — ${escape(n.status)}"><span class="agent-avatar">${String(i+1).padStart(2,'0')}</span><span class="agent-name">${escape(n.name)}</span><span class="agent-state" style="width:${9+Math.min(16,n.tokens/3000)}%"></span><span class="agent-status-label">${escape(n.status.toUpperCase().slice(0,7))}</span></button>`).join('')+(agents.length>8?`<button class="agent-more" id="more-agents">+ ${agents.length-8} more ↗</button>`:'');
  $('agent-list').querySelectorAll('[data-agent]').forEach(b=>b.onclick=()=>selectAgent(b.dataset.agent));const more=$('more-agents');if(more)more.onclick=()=>openInspector();
}
function refreshUI(){
  const agents=[...engine.nodes.values()].filter(n=>n.kind==='agent'),paperCount=engine.papers.size,percent=Math.min(100,Math.round(paperCount/24*100)),usage=engine.totalTokens/engine.budget;
  $('compass-node-count').textContent=engine.nodes.size;$('compass-agent-count').textContent=`${String(agents.length).padStart(2,'0')} AGENTS`;
  $('task-feed').innerHTML=engine.events.slice(0,14).map((e,i)=>`<div><time>${String(engine.totalEvents-i).padStart(3,'0')}</time><b>${e.type==='tool_result'?'RECV':e.type==='tool_call'?'CALL':e.type==='message'?'SEND':e.type==='error'?'ERR':e.type==='thinking'?'PLAN':e.type==='paper'?'READ':'EXEC'}</b><span>${escape(e.tool||e.content)}</span></div>`).join('');
  $('top-papers').innerHTML=`${paperCount}<span class="metric-unit"> / 24</span>`;$('top-agents').innerHTML=`${agents.length}<span class="metric-dot"></span>`;$('top-network').innerHTML=`${engine.nodes.size}<span class="metric-unit"> NODES</span>`;$('top-reqs').innerHTML=`${engine.rate.toFixed(1)}<span class="metric-unit"> /s</span>`;$('top-tokens').innerHTML=`${k(engine.totalTokens)}<span class="metric-unit"> k</span>`;
  $('network-size').textContent=`${engine.nodes.size} NODES · ${engine.edges.size} EDGES${engine.overflowIds.size?` · +${engine.overflowIds.size} GROUPED`:''}`;
  $('event-count').textContent=`${num(engine.totalEvents)} EVENTS CAPTURED`;$('event-rate').textContent=`${engine.paused?'0.0':engine.rate.toFixed(1)} EVT/S`;$('stream-speed').textContent=`${num(Math.round(engine.paused?0:engine.tokenRate))} TOKENS / SEC`;
  $('task-percent').textContent=`${percent}%`;$('task-fraction').textContent=`${paperCount} / 24 papers`;$('task-progress').style.width=`${percent}%`;$('latency-value').textContent=Math.round(engine.latency);$('throughput-value').textContent=engine.paused?'0.0':engine.rate.toFixed(1);
  const elapsed=Math.floor((Date.now()-started)/1000);$('uptime').textContent=[Math.floor(elapsed/3600),Math.floor(elapsed/60)%60,elapsed%60].map(n=>String(n).padStart(2,'0')).join(':');$('clock').textContent=`UTC ${new Date().toISOString().slice(11,19)}`;
  $('token-total').textContent=k(engine.totalTokens);$('input-tokens').textContent=k(engine.inputTokens)+'k';$('output-tokens').textContent=k(engine.outputTokens)+'k';$('budget-label').textContent=`${Math.round(usage*100)}% OF ${engine.budget>=1000000?+(engine.budget/1000000).toFixed(2)+'M':num(engine.budget/1000)+'K'} BUDGET`;
  document.body.classList.toggle('budget-warning',usage>=.8);if(usage>=.8&&usage<1&&!engine.paused)showNotice('Token usage is above 80% of the session budget. Local observation pauses at the limit.');
  $('paper-name').textContent=[...engine.papers].at(-1)??'Waiting for research sources';$('paper-status').textContent=`${paperCount} SOURCES INDEXED`;
  $('paper-list').innerHTML=[...engine.papers].slice(-10).reverse().map((p,i)=>`<div><b>${String(paperCount-i).padStart(2,'0')}</b><span>${escape(p)}</span></div>`).join('');
  $('error-count').textContent=String(engine.errors.length).padStart(2,'0');$('error-list').innerHTML=engine.errors.length?engine.errors.slice(0,2).map(e=>`<div class="error-item"><strong>${escape(e.tool||e.agentName)}</strong><p>${escape(e.content)}</p><time>${new Date(e.timestamp).toISOString().slice(11,19)}</time></div>`).join(''):'<div class="healthy-state"><span>↗</span>All systems operational.<br>No errors in this session.</div>';
  $('errors-foot').textContent=engine.errors.length?'RECOVERABLE · AUTO RETRY':'NO ERRORS CAPTURED';
  const subtasks=[...engine.subtasks.values()];$('subtask-count').textContent=String(subtasks.length).padStart(2,'0');$('subtask-list').innerHTML=subtasks.slice(-4).map(t=>`<div class="subtask-item ${['success','complete'].includes(t.status)?'done':''}"><div><span class="subtask-status"></span><span class="subtask-name">${escape(t.name)}</span></div><small>${escape(t.agent)} · ${['success','complete'].includes(t.status)?'complete':'in progress'}</small></div>`).join('')||'<div class="quiet">Waiting for delegated work.</div>';
  $('fps-label').textContent=`${fps} FPS · ${engine.paused?'PAUSED':reduceMotion.matches?'REDUCED MOTION':'REALTIME'}`;
  sparkline($('latency-chart'),engine.latencyHistory,'#ffffff');sparkline($('throughput-chart'),engine.rateHistory,'#ffffff');sparkline($('token-chart'),engine.tokenHistory,'#ffffff',{bars:true});
  renderAgents();if($('event-dialog').open)renderLog();
}
const codeLines=[['<span class="code-keyword">async def</span> <span class="code-function">coordinate</span>():'],['  <span class="code-comment"># shared intelligence</span>'],['  agents = <span class="code-keyword">await</span> spawn('],['    task=<span class="code-string">"research"</span>,'],['    workers=<span class="code-string">8</span>'],['  )'],['  <span class="code-keyword">for</span> agent <span class="code-keyword">in</span> agents:'],['    <span class="code-keyword">await</span> agent.<span class="code-function">run</span>()']];
$('code-content').innerHTML=codeLines.map((l,i)=>`<span class="code-line"><span class="line-no">${i+1}</span>${l[0]}</span>`).join('');
let codeHistory=[];
function renderCode(content,event={}){const lines=content.split('\n').slice(0,12),previous=codeHistory;codeHistory=lines;$('code-content').innerHTML=lines.map((line,i)=>`<span class="code-line ${previous[i]!==line?'changed':''}"><span class="line-no">${String(i+1).padStart(2,'0')}</span>${escape(line)}</span>`).join('');document.querySelector('.code-panel .file-label').textContent=`${event.tool||'stdout'}${event.timestamp?' / '+new Date(event.timestamp).toISOString().slice(11,19):''}`;$('code-status').textContent=event.type?`${event.status.toUpperCase()} / ${event.latencyMs} MS / ${event.tokens} TOK`:'WAITING FOR OUTPUT';}

function openInspector(){logVersion=-1;$('event-dialog').showModal();renderLog(true)}
function renderLog(force=false){
  if(engine.version!==logVersion||force){const query=$('event-search').value.toLowerCase(),type=$('event-type').value;filtered=engine.events.filter(e=>(!selected||e.agentId===selected||e.targetAgent===selected)&&(type==='all'||e.type===type)&&(!query||`${e.agentName} ${e.agentId} ${e.tool} ${e.content}`.toLowerCase().includes(query)));logVersion=engine.version;$('filtered-count').textContent=`${num(filtered.length)} EVENTS${selected?' · AGENT FILTER':''}`;$('virtual-spacer').style.height=`${filtered.length*68}px`}
  const viewport=$('virtual-log'),start=Math.max(0,Math.floor(viewport.scrollTop/68)-2),end=Math.min(filtered.length,start+Math.ceil(viewport.clientHeight/68)+5);
  $('virtual-rows').style.transform=`translateY(${start*68}px)`;$('virtual-rows').innerHTML=filtered.length?filtered.slice(start,end).map(e=>`<div class="log-row"><div class="log-agent"><time>${new Date(e.timestamp).toISOString().slice(11,23)}</time><span title="${escape(e.agentId)}">${escape(e.agentName)}</span></div><div class="log-content"><strong style="color:${COLORS[e.status]??COLORS.running}">${escape(e.type)}${e.tool?' / '+escape(e.tool):''}${e._count>1?' ×'+e._count:''}</strong><span title="${escape(e.content)}">${escape(e.content)}</span></div><span class="log-tokens">${e.tokens>1000?k(e.tokens)+'k':e.tokens}</span></div>`).join(''):'<div class="log-empty">No events match this filter.</div>';
}
$('virtual-log').addEventListener('scroll',()=>renderLog());$('event-search').oninput=()=>{$('virtual-log').scrollTop=0;renderLog(true)};$('event-type').onchange=()=>{$('virtual-log').scrollTop=0;renderLog(true)};
$('inspect-button').onclick=openInspector;$('selection-chip').onclick=()=>selectAgent(null);$('pause-button').onclick=togglePause;
$('reset-button').onclick=()=>{if(mode==='simulation'){showNotice('');boot(true);onTransportStatus('simulation')}};
$('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{showNotice('Fullscreen is unavailable in this browser. Open Cairn in a standalone browser window.')}};
$('source-button').onclick=()=>{$('transport').value=mode;$('endpoint-field').hidden=mode==='simulation';$('endpoint').value=transport.url??'';$('connection-error').hidden=true;$('connection-dialog').showModal()};
$('transport').onchange=()=>{const v=$('transport').value;$('endpoint-field').hidden=v==='simulation';$('endpoint').required=v!=='simulation';$('endpoint').placeholder=v==='websocket'?'ws://localhost:8788':'http://localhost:8788/events'};
$('connection-form').onsubmit=e=>{e.preventDefault();const kind=$('transport').value,url=$('endpoint').value.trim();try{
  if(kind!=='simulation'){const parsed=new URL(url);if(kind==='websocket'&&!['ws:','wss:'].includes(parsed.protocol))throw new Error('Enter a ws:// or wss:// endpoint.');if(kind==='sse'&&!['http:','https:'].includes(parsed.protocol))throw new Error('Enter an http:// or https:// endpoint.');if(location.protocol==='https:'&&['ws:','http:'].includes(parsed.protocol))throw new Error('Use a secure endpoint, or open the local preview for a local server.')}
  mode=kind;if(kind==='simulation'){boot(true);onTransportStatus('simulation')}else{boot(false);transport.connect(kind,url)}$('connection-dialog').close();syncPause();refreshUI();
}catch(error){$('connection-error').textContent=error.message;$('connection-error').hidden=false}};
$('budget-button').onclick=()=>{$('budget-input').value=engine.budget;$('budget-dialog').showModal()};
$('budget-form').onsubmit=e=>{e.preventDefault();const budget=Number($('budget-input').value);if(!Number.isFinite(budget)||budget<1000||budget>1e9)return;engine.budget=budget;if(engine.totalTokens>=budget){engine.pause('budget');transport.close()}else{if(engine.pauseReason==='budget'){engine.resume();if(mode!=='simulation')try{transport.connect(mode,transport.url)}catch(err){showNotice(err.message)}}showNotice('')}syncPause();refreshUI();$('budget-dialog').close()};
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}}));
$('export-button').onclick=()=>{const data=filtered.map(e=>Object.fromEntries(FIELDS.map(key=>[key,e[key]])));const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`cairn-events-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();togglePause()}else if(e.key.toLowerCase()==='f')$('fullscreen-button').click();else if(e.key.toLowerCase()==='r'&&mode==='simulation')$('reset-button').click()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(!engine.paused){engine.pause('hidden');autoHidden=true;transport.close();syncPause()}}else if(autoHidden){autoHidden=false;if(engine.resume()){if(mode!=='simulation')try{transport.connect(mode,transport.url)}catch(e){showNotice(e.message)}syncPause()}lastFrame=0}});

function frame(now){
  requestAnimationFrame(frame);if(document.hidden)return;if(lastFrame&&now-lastFrame<15)return;
  const delta=lastFrame?Math.min((now-lastFrame)/16.667,2):1;lastFrame=now;frames++;if(now-frameStart>=1000){fps=Math.round(frames*1000/(now-frameStart));frames=0;frameStart=now}
  if(!engine.paused){if(mode==='simulation')simulation.tick(now);engine.flush();}
  const physicsInterval=reduceMotion.matches?250:engine.nodes.size>300?66:32;
  if(!engine.paused&&now-lastPhysics>=physicsInterval){network.step(Math.min(2,physicsInterval/16.667),Date.now());lastPhysics=now}
  if(!engine.paused){stream.step(delta);horizon.step(delta);dispatch.step(delta);energy.step(delta);micro.step(delta)}
  network.draw(Date.now());stream.draw();energy.draw();micro.draw();if(now-lastUI>500){lastUI=now;refreshUI()}
}
boot();onTransportStatus('simulation');requestAnimationFrame(frame);
window.cairn={ingest:event=>engine.ingest(event),connect:(kind,url)=>{mode=kind;boot(false);transport.connect(kind,url);syncPause()},pause:()=>{engine.pause('manual');transport.close();syncPause()},resume:()=>{if(engine.resume()){if(mode!=='simulation')transport.connect(mode,transport.url);syncPause();return true}return false},reset:()=>{mode='simulation';boot(true);onTransportStatus('simulation')},get state(){return {mode,paused:engine.paused,pauseReason:engine.pauseReason,nodes:engine.nodes.size,edges:engine.edges.size,events:engine.totalEvents,totalTokens:engine.totalTokens,budget:engine.budget,merged:engine.merged,dropped:engine.dropped,invalid:engine.invalid,retainedEvents:engine.events.length,aggregatedNodes:engine.overflowIds.size}},setBudget:n=>{if(Number.isFinite(n)&&n>=1000){engine.budget=n;if(engine.totalTokens>=n){engine.pause('budget');transport.close();syncPause()}}},get events(){return engine.events.map(e=>Object.fromEntries(FIELDS.map(f=>[f,e[f]])))}};
