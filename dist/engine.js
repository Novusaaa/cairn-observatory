export const FIELDS = ['eventId','agentId','agentName','type','targetAgent','tool','tokens','latencyMs','status','content','timestamp'];
export const COLORS = {running:'#7ae4da',thinking:'#ad9fea',idle:'#aaa6b9',success:'#7ae4da',complete:'#7ae4da',error:'#e9b779',pending:'#ad9fea'};
export const AGENTS = [
  {id:'orchestrator',name:'Orchestrator',initial:'OR'},
  {id:'researcher-01',name:'Researcher 01',initial:'R1'},
  {id:'researcher-02',name:'Researcher 02',initial:'R2'},
  {id:'analyst',name:'Analyst',initial:'AN'},
  {id:'coder',name:'Coder',initial:'CO'},
  {id:'reviewer',name:'Reviewer',initial:'RE'},
  {id:'synthesizer',name:'Synthesizer',initial:'SY'},
  {id:'librarian',name:'Librarian',initial:'LI'}
];
const TYPES = new Set(['tool_call','tool_result','message','subtask','thinking','output','error','agent_start','agent_end','paper']);
const STATUSES = new Set(Object.keys(COLORS));
const MAX = {nodes:500,edges:2500,events:2000,seen:10000,queue:1200};
const clean = (value,max=500) => String(value ?? '').slice(0,max);
export function normalizeEvent(raw) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
  if(!raw.eventId || !raw.agentId || !raw.type) return null;
  const timestamp = new Date(raw.timestamp ?? Date.now()).getTime();
  if(!Number.isFinite(timestamp)) return null;
  const tokens = Number(raw.tokens ?? 0), latencyMs = Number(raw.latencyMs ?? 0);
  if(!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(latencyMs) || latencyMs < 0) return null;
  return {eventId:clean(raw.eventId,160),agentId:clean(raw.agentId,120),agentName:clean(raw.agentName || raw.agentId,100),type:TYPES.has(raw.type)?raw.type:clean(raw.type,40),targetAgent:clean(raw.targetAgent,120),tool:clean(raw.tool,100),tokens:Math.min(Math.round(tokens),1e9),latencyMs:Math.min(Math.round(latencyMs),86400000),status:STATUSES.has(raw.status)?raw.status:'running',content:clean(typeof raw.content==='string'?raw.content:JSON.stringify(raw.content??''),6000),timestamp:new Date(timestamp).toISOString()};
}

export class EventEngine {
  constructor({budget=2000000,onBudget=()=>{}}={}) { this.budget=budget;this.onBudget=onBudget;this.reset(); }
  reset() {
    this.nodes=new Map();this.edges=new Map();this.events=[];this.queue=new Map();this.seen=new Set();this.overflowIds=new Set();this.papers=new Set();this.subtasks=new Map();this.errors=[];
    this.totalTokens=0;this.inputTokens=0;this.outputTokens=0;this.totalEvents=0;this.merged=0;this.dropped=0;this.invalid=0;this.paused=false;this.pauseReason='';this.latency=0;this.rate=0;this.tokenRate=0;this.lastSample=Date.now();this.sampleEvents=0;this.sampleTokens=0;this.version=0;
    this.latencyHistory=Array(48).fill(0);this.rateHistory=Array(48).fill(0);this.tokenHistory=Array.from({length:32},()=>[0,0]);this.listeners=new Set();this.lastFlush=0;this.flushWindow=0;this.flushes=0;
  }
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  ensureNode(id,name,kind='agent') {
    if(this.nodes.has(id))return this.nodes.get(id);
    if(this.nodes.size>=MAX.nodes-1 && id!=='__aggregate__') {
      if(this.overflowIds.size<MAX.seen)this.overflowIds.add(id);
      id='__aggregate__';name=`Cluster +${this.overflowIds.size}`;kind='cluster';
      if(this.nodes.has(id)){const node=this.nodes.get(id);node.name=name;return node;}
    }
    const node={id,name,kind,status:'idle',tokens:0,lastSeen:0,activity:0,x:0,y:0,vx:0,vy:0,positioned:false};this.nodes.set(id,node);return node;
  }
  connect(a,b,event) {
    if(a.id===b.id)return;
    const key=[a.id,b.id].sort().join('|');
    let edge=this.edges.get(key);
    if(!edge){if(this.edges.size>=MAX.edges)this.edges.delete(this.edges.keys().next().value);edge={source:a.id,target:b.id,traffic:0,tokens:0,lastSeen:0};this.edges.set(key,edge)}
    edge.traffic++;edge.tokens+=event.tokens;edge.latency=event.latencyMs;edge.lastSeen=Date.now();edge.status=event.status;
  }
  ingest(raw) {
    if(this.paused)return false;
    if(Array.isArray(raw)){raw.slice(0,1000).forEach(e=>this.ingest(e));return true}
    const e=normalizeEvent(raw);if(!e){this.invalid++;return false}
    if(this.seen.has(e.eventId))return false;
    this.seen.add(e.eventId);if(this.seen.size>MAX.seen)this.seen.delete(this.seen.values().next().value);
    const key=[e.agentId,e.targetAgent,e.type,e.tool,e.status].join('|');
    if(this.queue.has(key)) {const previous=this.queue.get(key);e.tokens+=previous.tokens;e._count=(previous._count??1)+1;e._ids=[...(previous._ids??[previous.eventId]),e.eventId].slice(-6);this.merged++}
    else if(this.queue.size>=MAX.queue){this.dropped++;return false}
    this.queue.set(key,e);return true;
  }
  flush(now=Date.now(),force=false) {
    if(this.paused)return [];
    if(!force){if(now-this.lastFlush<34)return [];if(now-this.flushWindow>=1000){this.flushWindow=now;this.flushes=0}if(this.flushes>=30)return [];this.flushes++;}
    this.lastFlush=now;const applied=[];
    for(const e of this.queue.values()) {this.apply(e);applied.push(e);if(this.totalTokens>=this.budget){this.pause('budget');break}}
    this.queue.clear();this.sample(now);if(applied.length){this.version++;for(const fn of this.listeners)fn(applied)}return applied;
  }
  apply(e) {
    const node=this.ensureNode(e.agentId,e.agentName);if(node.kind!=='cluster')node.name=e.agentName;node.status=e.status;node.tokens+=e.tokens;node.lastSeen=Date.now();node.activity=1;
    if(e.targetAgent){const target=this.ensureNode(e.targetAgent,AGENTS.find(a=>a.id===e.targetAgent)?.name??e.targetAgent);this.connect(node,target,e)}
    if(e.tool){const tool=this.ensureNode(`tool:${e.tool}`,e.tool,'tool');tool.status=e.status;tool.activity=1;tool.lastSeen=Date.now();this.connect(node,tool,e)}
    if(e.type==='subtask'){const id=`task:${e.tool||e.content.slice(0,80)}`;const task=this.ensureNode(id,e.content.slice(0,30),'task');this.connect(node,task,e);this.subtasks.set(id,{name:e.content,agent:e.agentName,status:e.status});if(this.subtasks.size>40)this.subtasks.delete(this.subtasks.keys().next().value)}
    if(e.type==='paper'){this.papers.add(e.content);if(this.papers.size>10000)this.papers.delete(this.papers.values().next().value)}
    if(e.status==='error'||e.type==='error'){this.errors.unshift(e);this.errors=this.errors.slice(0,40)}
    this.totalTokens+=e.tokens;const output=['tool_result','output','message'].includes(e.type);if(output)this.outputTokens+=e.tokens;else this.inputTokens+=e.tokens;
    this.totalEvents+=e._count??1;this.sampleEvents+=e._count??1;this.sampleTokens+=e.tokens;
    if(e.latencyMs)this.latency=this.latency ? this.latency*.82+e.latencyMs*.18:e.latencyMs;
    this.events.unshift(e);if(this.events.length>MAX.events)this.events.length=MAX.events;
  }
  sample(now=Date.now()) {
    const elapsed=(now-this.lastSample)/1000;if(elapsed<1)return;
    this.rate=this.sampleEvents/elapsed;this.tokenRate=this.sampleTokens/elapsed;
    this.latencyHistory.push(this.latency);this.latencyHistory.shift();this.rateHistory.push(this.rate);this.rateHistory.shift();
    this.tokenHistory.push([this.sampleTokens*.62,this.sampleTokens*.38]);this.tokenHistory.shift();
    this.sampleEvents=0;this.sampleTokens=0;this.lastSample=now;
  }
  pause(reason='manual'){this.paused=true;this.pauseReason=reason;this.queue.clear();if(reason==='budget')this.onBudget();}
  resume(){if(this.totalTokens>=this.budget)return false;this.paused=false;this.pauseReason='';this.lastSample=Date.now();this.sampleEvents=0;this.sampleTokens=0;return true}
}

const paperTitles=['Scaling Laws for Neural Language Models','Generative Agents: Interactive Simulacra','Communicative Agents for Software Development','Multi-Agent Collaboration Mechanisms','Collective Intelligence in Language Agents','Emergent Social Conventions in LLMs','A Survey of Multi-Agent Reinforcement Learning','Language Agents as Optimizable Graphs','Self-Organized Coordination in Agent Societies','Tool Learning with Foundation Models','The Rise and Potential of LLM Based Agents','Adaptive Collaboration in Multi-Agent Systems','Dynamic Workflows for Agentic Reasoning','Decentralized Planning with Language Models','Graph-Based Memory for Collaborative Agents','Inter-Agent Communication and Trust','Evaluating Emergent Teamwork','Hierarchical Agent Orchestration','Reasoning through Collective Debate','Reflective Multi-Agent Systems','A Taxonomy of Agent Coordination','Autonomous Research with Language Agents','Learning to Collaborate with Tools','The Landscape of Agentic Intelligence'];
const demoCode=[
  'def route_messages(events):\n  for event in events:\n    if event.targetAgent:\n      graph.add_edge(\n        event.agentId,\n        event.targetAgent,\n        weight=event.tokens,\n      )\n  return graph',
  'async def collect_evidence(papers):\n  results = await gather(\n    *[read_pdf(p) for p in papers]\n  )\n  evidence = rank(results)\n  memory.store(evidence)\n  return evidence',
  'def measure_coordination(graph):\n  nodes = graph.nodes()\n  edges = graph.edges()\n  return {\n    "agents": len(nodes),\n    "links": len(edges),\n    "density": graph.density(),\n  }'
];
export class Simulation {
  constructor(engine){this.engine=engine;this.sequence=0;this.tickCount=0;this.seed=82442;this.paperIndex=0;this.pending=[];this.next=0;this.runId=Date.now().toString(36);}
  rand(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296}
  pick(items){return items[Math.floor(this.rand()*items.length)]}
  event(agent,type,content,extra={}){return {eventId:`sim-${this.runId}-${++this.sequence}`,agentId:agent.id,agentName:agent.name,type,targetAgent:'',tool:'',tokens:Math.round(40+this.rand()*560),latencyMs:Math.round(42+this.rand()*220),status:type==='thinking'?'thinking':'running',content,timestamp:new Date(Date.now()-(this.priming?Math.max(0,150-this.sequence)*160:0)).toISOString(),...extra}}
  prime(){
    this.priming=true;
    AGENTS.forEach(a=>this.engine.ensureNode(a.id,a.name));
    for(let i=0;i<105;i++){
      const agent=AGENTS[1+i%7],tool=['arxiv.search','semantic_scholar','read_pdf','python.exec','citation.resolve','memory.query'][i%6];
      this.engine.ingest(this.event(agent,'tool_call',`Resolving ${['coordination','communication','emergence','planning','evaluation'][i%5]} reference ${i+1}`,{tool,targetAgent:i%3===0?'orchestrator':'',tokens:160+Math.round(this.rand()*900),status:'success'}));this.engine.flush(Date.now(),true);
      const node=this.engine.ensureNode(`ref:${i}`,`REF ${String(i+1).padStart(3,'0')}`,'reference');this.engine.connect(this.engine.nodes.get(agent.id),node,{tokens:40,latencyMs:50,status:'idle'});node.activity=this.rand()*.3;
    }
    for(let i=0;i<9;i++){this.engine.ingest(this.event(AGENTS[7],'paper',paperTitles[this.paperIndex++],{tokens:520,status:'success',tool:'read_pdf'}));this.engine.flush(Date.now(),true)}
    ['Trace communication patterns','Compare agent architectures','Validate cited evidence','Build coordination taxonomy'].forEach((content,i)=>{this.engine.ingest(this.event(AGENTS[i+1],'subtask',content,{tool:`subtask-${i}`,status:i===2?'success':'running',tokens:210}));this.engine.flush(Date.now(),true)});
    const actions=[['thinking','Comparing emergent communication strategies',{status:'thinking'}],['message','Cross-referencing 9 sources with the coordination taxonomy',{targetAgent:'analyst'}],['tool_result','Found 12 papers · 4 high-relevance matches',{tool:'arxiv.search',tokens:1230}],['tool_call','Extracting interaction graph from source material',{tool:'python.exec'}],['output',demoCode[0],{tool:'python.exec',tokens:840}],['tool_result','Evidence matrix updated · confidence 0.94',{tool:'memory.query',tokens:612}]];
    for(let i=0;i<32;i++){const [type,content,extra]=actions[i%actions.length];this.engine.ingest(this.event(AGENTS[i%8],type,content,extra));this.engine.flush(Date.now(),true)}
    this.engine.lastSample=Date.now();this.engine.sampleEvents=0;this.engine.sampleTokens=0;
    const historyNow=Date.now(),ordered=this.engine.events.slice().reverse();
    this.engine.latencyHistory=ordered.slice(-48).map(e=>e.latencyMs);
    while(this.engine.latencyHistory.length<48)this.engine.latencyHistory.unshift(0);
    this.engine.rateHistory=Array.from({length:48},(_,i)=>ordered.filter(e=>Math.floor((historyNow-new Date(e.timestamp).getTime())/1000)===47-i).reduce((sum,e)=>sum+(e._count??1),0));
    this.engine.tokenHistory=Array.from({length:32},(_,i)=>ordered.filter(e=>Math.floor((historyNow-new Date(e.timestamp).getTime())/1000)===31-i).reduce((sum,e)=>{sum[['tool_result','output','message'].includes(e.type)?1:0]+=e.tokens;return sum},[0,0]));
    this.priming=false;
  }
  tick(now){
    if(this.engine.paused||now<this.next)return;this.next=now+90+this.rand()*180;this.tickCount++;
    const due=this.pending.filter(p=>p.at<=now);this.pending=this.pending.filter(p=>p.at>now);due.forEach(p=>{p.event.timestamp=new Date().toISOString();if(p.started!=null)p.event.latencyMs=Math.round(now-p.started);this.engine.ingest(p.event)});
    const agent=this.pick(AGENTS),roll=this.rand();
    if(roll<.50){const tool=this.pick(['arxiv.search','semantic_scholar','read_pdf','python.exec','citation.resolve','memory.query']);const content={ 'arxiv.search':'Searching for emergent agent coordination','semantic_scholar':'Ranking evidence by citation relevance','read_pdf':'Extracting architecture and evaluation results','python.exec':'Computing inter-agent communication topology','citation.resolve':'Resolving references and publication metadata','memory.query':'Retrieving cross-agent research context'}[tool];this.engine.ingest(this.event(agent,'tool_call',content,{tool,latencyMs:0}));this.pending.push({at:now+80+this.rand()*600,started:now,event:this.event(agent,'tool_result',tool==='python.exec'?this.pick(demoCode):this.pick(['12 results returned · 4 relevant sources','Extraction complete · 2,048 tokens processed','Coordination graph updated successfully','Evidence indexed · confidence 0.94','Shared memory synchronized across 8 agents']),{tool,status:'success',tokens:400+Math.round(this.rand()*1400)})})}
    else if(roll<.73)this.engine.ingest(this.event(agent,'message',this.pick(['Sharing findings on decentralized planning','Requesting verification of the interaction graph','Passing evidence matrix to the synthesis agent','Coordination taxonomy updated · 6 categories']),{targetAgent:this.pick(AGENTS.filter(a=>a.id!==agent.id)).id}));
    else if(roll<.88)this.engine.ingest(this.event(agent,'thinking',this.pick(['Evaluating collective reasoning performance','Comparing emergent communication strategies','Reasoning about dependency resolution','Synthesizing evidence from parallel research']),{status:'thinking'}));
    else if(roll<.96)this.engine.ingest(this.event(agent,'output',this.pick(demoCode),{tool:'python.exec',tokens:650}));
    else if(roll<.985&&this.paperIndex<paperTitles.length)this.engine.ingest(this.event(AGENTS[7],'paper',paperTitles[this.paperIndex++],{tool:'read_pdf',status:'success',tokens:1200}));
    else if(roll>=.985){this.engine.ingest(this.event(agent,'error','Rate limit reached · retry scheduled in 2s',{tool:'semantic_scholar',status:'error',tokens:0,latencyMs:2000}));this.pending.push({at:now+2000,event:this.event(agent,'tool_result','Retry successful · request recovered',{tool:'semantic_scholar',status:'success',tokens:800})})}
    if(this.tickCount%24===0){const item=this.pick([...this.engine.subtasks.entries()]);if(item)this.engine.ingest(this.event(AGENTS[3],'subtask',item[1].name,{tool:item[0].replace('task:',''),status:this.tickCount%48===0?'success':'running',tokens:80}))}
  }
}

export class Transport {
  constructor(engine,onStatus=()=>{}){this.engine=engine;this.onStatus=onStatus;this.connection=null;this.timeout=null;this.kind='simulation';this.generation=0;this.stopped=false}
  close(){this.generation++;clearTimeout(this.timeout);if(this.connection){this.connection.onclose=null;this.connection.onerror=null;this.connection.close();this.connection=null}}
  connect(kind,url){
    this.close();this.stopped=false;this.kind=kind;this.url=url;if(kind==='simulation'){this.onStatus('simulation');return}
    const parsed=new URL(url);if(kind==='websocket'&&!['ws:','wss:'].includes(parsed.protocol))throw new Error('Use a ws:// or wss:// WebSocket endpoint.');if(kind==='sse'&&!['http:','https:'].includes(parsed.protocol))throw new Error('Use an http:// or https:// SSE endpoint.');if(typeof location!=='undefined'&&location.protocol==='https:'&&['ws:','http:'].includes(parsed.protocol))throw new Error('This secure page requires wss:// or https://. Use the local preview for a local endpoint.');
    this.onStatus('connecting');const gen=this.generation;this.connection=kind==='websocket'?new WebSocket(url):new EventSource(url);const c=this.connection;
    c.onopen=()=>{if(gen===this.generation){clearTimeout(this.timeout);this.onStatus('connected')}};
    c.onmessage=message=>{if(gen!==this.generation)return;try{this.engine.ingest(JSON.parse(message.data))}catch{this.engine.invalid++;this.onStatus('invalid')}};
    c.onerror=()=>{if(gen===this.generation)this.onStatus('error')};
    if(kind==='websocket')c.onclose=()=>{if(gen===this.generation)this.onStatus('disconnected')};
    this.timeout=setTimeout(()=>{if(gen===this.generation&&c.readyState!==1)this.onStatus('timeout')},10000);
  }
}
