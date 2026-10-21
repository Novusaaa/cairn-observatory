import {COLORS} from './engine.js';
const TAU=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const SPECTRUM=['#67d9ff','#7c96ff','#b68aff','#ef7cff','#ff7bbd','#ff8b70','#ffd580','#ffffff'];
const hash=s=>{let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0};
export function fieldGeometry(w,h){const inner=Math.max(w*.54,h*.58);return {w,h,inner,outer:inner+w*.215,cx:w*.415-inner,cy:h*.5}}
const arcX=(g,r,y)=>g.cx+Math.sqrt(Math.max(0,r*r-(y-g.cy)**2));
const svgEl=(tag,attrs={})=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e};
const txt=(attrs,value)=>{const t=svgEl('text',attrs);t.textContent=value;return t};

export class DispatchTape{
  constructor(element){this.element=element;this.items=[];this.pending=new Map();this.seen=new Set();this.height=element.clientHeight;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.observer=new ResizeObserver(()=>{const next=element.clientHeight,ratio=this.height?next/this.height:1;this.items.forEach(item=>item.y*=ratio);this.height=next;this.draw()});this.observer.observe(element)}
  reset(){this.items=[];this.pending.clear();this.seen.clear();this.element.replaceChildren()}
  seed(events,total){this.reset();this.height=this.element.clientHeight;const count=Math.max(4,Math.min(16,Math.floor(this.height/44))),spacing=this.height/count;events.slice(0,count).map((event,i)=>({event,sequence:total-i})).reverse().forEach((data,i)=>{this.add(data,8+i*spacing);this.seen.add(data.event.eventId)});this.draw()}
  push(events,total){events.forEach((event,i)=>{if(this.seen.has(event.eventId))return;this.seen.add(event.eventId);if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value);const key=[event.agentId,event.type,event.tool].join('|');this.pending.delete(key);this.pending.set(key,{event,sequence:total-events.length+i+1});if(this.pending.size>64)this.pending.delete(this.pending.keys().next().value)})}
  add(data,y){const box=document.createElement('div');box.className='dispatch-item';box.dataset.eventId=data.event.eventId;const line=document.createElement('strong'),id=document.createElement('span'),tokens=document.createElement('span'),detail=document.createElement('small');id.textContent=`EVT-${String(data.sequence).padStart(4,'0')}`;tokens.textContent=`${data.event.tokens}t`;detail.textContent=data.event.tool||data.event.agentName;line.append(id,tokens);box.append(line,detail);this.element.append(box);this.items.push({...data,box,y})}
  step(dt){if(!this.height)return;const spacing=Math.max(40,this.height/16),speed=this.reduced?0:Math.min(1.5, .65+this.pending.size*.018);for(const item of this.items)item.y-=speed*dt;while(this.items.length&&this.items[0].y<-45){this.items.shift().box.remove()}
    const last=this.items.at(-1);if(this.pending.size&&(!last||last.y<=this.height-spacing)){const [key,data]=this.pending.entries().next().value;this.pending.delete(key);this.add(data,this.height+2)}
    if(this.reduced&&this.pending.size){const [key,data]=this.pending.entries().next().value;this.pending.delete(key);if(this.items.length)this.items.shift().box.remove();this.add(data,this.height-34);this.items.forEach((item,i)=>item.y=8+i*spacing)}this.draw()}
  draw(){for(const item of this.items){item.box.style.transform=`translate3d(0,${item.y.toFixed(2)}px,0)`;item.box.style.opacity=String(clamp(item.y/34,0,1))}}
}

export class CanvasSurface{
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});this.width=0;this.height=0;this.dpr=Math.min(devicePixelRatio||1,1.25);this.resize();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas)}
  resize(){const r=this.canvas.getBoundingClientRect();if(this.width===r.width&&this.height===r.height)return;this.width=r.width;this.height=r.height;this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr);this.ctx?.setTransform(this.dpr,0,0,this.dpr,0,0);if(this.engine)for(const n of this.engine.nodes.values())n.positioned=false}
  reset(){if(this.rays)this.rays=[];this.ctx?.clearRect(0,0,this.width,this.height)}
}

export class Network extends CanvasSurface{
  constructor(canvas,engine,{onSelect,tooltip}={}){
    super(canvas);this.engine=engine;this.onSelect=onSelect;this.tooltip=tooltip;this.selected=null;this.hover=null;this.drag=null;this.pointer=null;this.phase=0;this.wallTime=Date.now();this.canvas.style.touchAction='pan-y';
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();this.pointer={x:e.clientX-r.left,y:e.clientY-r.top};if(this.drag){this.drag.x=this.pointer.x;this.drag.y=this.pointer.y;this.drag.vx=0;this.drag.vy=0;this.moved=true}else this.findHover()});
    canvas.addEventListener('pointerdown',e=>{this.findHover();this.moved=false;if(this.hover){this.drag=this.hover;canvas.setPointerCapture(e.pointerId)}});
    canvas.addEventListener('pointerup',()=>{if(this.drag&&!this.moved)this.onSelect?.(this.drag.kind==='agent'?this.drag.id:null);this.drag=null});canvas.addEventListener('pointercancel',()=>this.drag=null);canvas.addEventListener('pointerleave',()=>{this.hover=null;if(this.tooltip)this.tooltip.hidden=true});
  }
  findHover(){if(!this.pointer)return;let dist=15,nearest=null;for(const n of this.engine.nodes.values()){const d=Math.hypot(n.x-this.pointer.x,n.y-this.pointer.y);if(d<dist){dist=d;nearest=n}}this.hover=nearest;this.canvas.style.cursor=nearest?'pointer':'default';if(this.tooltip){this.tooltip.hidden=!nearest;if(nearest){this.tooltip.textContent=`${nearest.name} / ${nearest.status} / ${nearest.tokens.toLocaleString()} TOK`;this.tooltip.style.left=`${clamp(nearest.x+14,10,this.width-225)}px`;this.tooltip.style.top=`${clamp(nearest.y-34,105,this.height-40)}px`}}}
  position(n,i){const g=fieldGeometry(this.width,this.height),seed=hash(n.id);n.x=75+(seed%10000)/10000*(this.width*.36-75);n.y=30+((seed>>>8)%10000)/10000*(this.height-60);n.vx=0;n.vy=0;n.positioned=true}
  step(dt,now){
    const nodes=[...this.engine.nodes.values()],g=fieldGeometry(this.width,this.height),agents=nodes.filter(n=>n.kind==='agent');this.phase+=dt*.007;this.wallTime=now;
    nodes.forEach((n,i)=>{if(!n.positioned)this.position(n,i);n.activity*=.96;if(n===this.drag)return;if(n.kind==='agent'){const idx=agents.indexOf(n),angle=-.82+idx/Math.max(1,agents.length-1)*1.64;const y=clamp(g.cy+Math.sin(angle)*g.inner,42,this.height-45);n.x=arcX(g,g.inner-7,y);n.y=y;return}n.vx+=(this.width*.20-n.x)*.00045*dt;n.vy+=(g.cy-n.y)*.0002*dt});
    const free=nodes.filter(n=>n.kind!=='agent');for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){const a=free[i],b=free[j],dx=a.x-b.x,dy=a.y-b.y,d2=Math.max(50,dx*dx+dy*dy),f=Math.min(.4,60/d2)*dt,d=Math.sqrt(d2);a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f}
    for(const e of this.engine.edges.values()){const a=this.engine.nodes.get(e.source),b=this.engine.nodes.get(e.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-this.width*.22)*.00012*dt;if(a.kind!=='agent'){a.vx+=dx/d*f;a.vy+=dy/d*f}if(b.kind!=='agent'){b.vx-=dx/d*f;b.vy-=dy/d*f}}
    for(const n of free)if(n!==this.drag){n.vx*=.92;n.vy*=.92;n.y=clamp(n.y+n.vy*dt,12,this.height-20);n.x=clamp(n.x+n.vx*dt,64,Math.max(70,arcX(g,g.inner-30,n.y)-12))}
  }
  draw(){const c=this.ctx;if(!c)return;const w=this.width,h=this.height,g=fieldGeometry(w,h);c.clearRect(0,0,w,h);c.save();c.beginPath();c.arc(g.cx,g.cy,g.inner-3,0,TAU);c.clip();
    c.fillStyle='#ffffff';c.globalAlpha=.14;for(let x=15;x<w*.43;x+=38)for(let y=20;y<h;y+=38)c.fillRect(x,y,.6,.6);
    let index=0;
    for(const e of this.engine.edges.values()){
      const a=this.engine.nodes.get(e.source),b=this.engine.nodes.get(e.target);if(!a||!b)continue;const active=this.wallTime-e.lastSeen<1800,selected=!this.selected||e.source===this.selected||e.target===this.selected;const key=hash(e.source+e.target),bend=((key%100)/100-.5)*h*.4;const control={x:(a.x+b.x)*.45,y:(a.y+b.y)*.5+bend};
      c.strokeStyle='#ffffff';c.globalAlpha=selected?(active?.43:.17):.02;c.lineWidth=active?clamp(.5+e.tokens/20000,.6,1.4):.45;c.beginPath();c.moveTo(a.x,a.y);c.quadraticCurveTo(control.x,control.y,b.x,b.y);c.stroke();
      const count=selected?6:1;for(let j=0;j<count;j++){const t=(this.phase*(.28+key%17/40)+j/count+(key%100)/100)%1,t0=Math.max(0,t-(active?.028:.021));const p=quad(a,control,b,t),q=quad(a,control,b,t0);c.globalAlpha=selected?(active?.95:.7):.08;c.strokeStyle=SPECTRUM[(key+j+Math.floor(this.phase))%SPECTRUM.length];c.lineWidth=j%3===0?1:.6;c.beginPath();c.moveTo(q.x,q.y);c.lineTo(p.x,p.y);c.stroke()}
      index++;
    }
    for(const n of this.engine.nodes.values()){
      const agent=n.kind==='agent',selected=!this.selected||n.id===this.selected;c.globalAlpha=selected?(agent?1:.6):.15;c.fillStyle='#ffffff';const radius=agent?3.4:n.kind==='tool'?1.5:.8;c.beginPath();c.arc(n.x,n.y,radius,0,TAU);c.fill();
      if(agent){c.strokeStyle='#ffffff';c.lineWidth=.8;c.globalAlpha=selected?.85:.2;c.beginPath();c.arc(n.x,n.y,8,0,TAU);c.stroke();c.beginPath();c.arc(n.x,n.y,11,0,TAU);c.stroke();c.font=`${w>1700?8:6.5}px Segoe UI,Arial,sans-serif`;const label=n.name.toUpperCase(),labelWidth=c.measureText(label).width+10;c.fillStyle='#050508ed';c.fillRect(n.x-labelWidth-19,n.y-14,labelWidth,11);c.strokeStyle='#ffffff';c.lineWidth=.5;c.strokeRect(n.x-labelWidth-19,n.y-14,labelWidth,11);c.fillStyle='#ffffff';c.fillText(label,n.x-labelWidth-14,n.y-6)}
      if(this.hover===n||this.selected===n.id){c.globalAlpha=1;c.strokeStyle='#fff';c.beginPath();c.arc(n.x,n.y,14,0,TAU);c.stroke()}
    }
    c.restore();c.globalAlpha=1;
  }
}
function quad(a,b,c,t){const n=1-t;return {x:n*n*a.x+2*n*t*b.x+t*t*c.x,y:n*n*a.y+2*n*t*b.y+t*t*c.y}}

export class Stream extends CanvasSurface{
  constructor(canvas){super(canvas);this.rays=[];this.seed=2871;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.phase=0}
  rand(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296}
  spawn(e){const seed=hash(e.agentId+e.tool+e.eventId),band=(seed%8+.5)/8,count=this.reduced?6:clamp(Math.round(e.tokens/2.5),100,500);for(let i=0;i<count;i++){if(this.rays.length>=4500)this.rays.shift();this.rays.push({y:clamp(band+(this.rand()-.5)*.14,.002,.998),head:-this.rand()*160,length:100+this.rand()*620,speed:12+this.rand()*22,width:this.rand()>.96?1.5:.45+this.rand()*.45,alpha:.6+this.rand()*.4,color:SPECTRUM[Math.floor(this.rand()*SPECTRUM.length)]})}}
  step(dt){if(this.reduced)return;for(const r of this.rays)r.head+=r.speed*dt;this.rays=this.rays.filter(r=>r.head-r.length<this.width*.7);this.phase+=dt}
  draw(){const c=this.ctx;if(!c)return;const w=this.width,h=this.height,g=fieldGeometry(w,h);c.clearRect(0,0,w,h);c.save();c.beginPath();c.rect(0,0,w,h);c.arc(g.cx,g.cy,g.outer+5,0,TAU,true);c.clip('evenodd');
    for(const r of this.rays){const y=r.y*h,start=arcX(g,g.outer+6,y),head=start+r.head;if(head<start)continue;const tail=Math.max(start,head-r.length),fade=clamp(1-(head-w)/(r.length*.8),0,1);if(tail>w||fade<=0)continue;const grad=c.createLinearGradient(tail,y,head,y);grad.addColorStop(0,r.color+'00');grad.addColorStop(.65,r.color+'90');grad.addColorStop(1,r.color);c.strokeStyle=grad;c.globalAlpha=r.alpha*fade;c.lineWidth=r.width;c.beginPath();c.moveTo(tail,y);c.lineTo(head,y+(head-tail)*.001);c.stroke();if(r.width>1){c.globalAlpha=r.alpha*.10;c.lineWidth=4;c.stroke()}c.fillStyle=r.color;c.globalAlpha=r.alpha*fade*.9;c.fillRect(head-2,y-.5,2,.8)}
    c.restore();c.globalAlpha=1;
  }
}

export class Horizon{
  constructor(svg){this.svg=svg;this.rotation=0;this.tickRotation=0;this.events=[];this.selected=null;this.ids='';this.lastRender=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.width=0;this.height=0;this.rebuild();this.observer=new ResizeObserver(()=>this.rebuild());this.observer.observe(svg)}
  rebuild(){const r=this.svg.getBoundingClientRect();if(!r.width||!r.height)return;if(this.width===r.width&&this.height===r.height)return;this.width=r.width;this.height=r.height;this.g=fieldGeometry(r.width,r.height);const {cx,cy,inner,outer,w,h}=this.g;this.svg.setAttribute('viewBox',`0 0 ${w} ${h}`);this.svg.replaceChildren();
    const base=svgEl('g');this.svg.append(base);
    const annulus=`M ${cx+outer} ${cy} A ${outer} ${outer} 0 1 0 ${cx-outer} ${cy} A ${outer} ${outer} 0 1 0 ${cx+outer} ${cy} M ${cx+inner} ${cy} A ${inner} ${inner} 0 1 1 ${cx-inner} ${cy} A ${inner} ${inner} 0 1 1 ${cx+inner} ${cy}`;
    base.append(svgEl('path',{d:annulus,fill:'#050508','fill-rule':'evenodd','fill-opacity':'.97'}));
    for(const [radius,color,width,opacity]of [[inner-4,'#ffffff',9,.04],[inner-4,'#ffffff',1,.9],[inner+2,'#ffffff',1,.6],[inner+10,'#ffffff',.7,.7],[outer-1,'#ffffff',1.6,.95],[outer+4,'#ffffff',.7,.8],[outer+8,'#ffffff',8,.05],[outer-13,'#ffffff',.7,.35]])base.append(svgEl('circle',{cx,cy,r:radius,fill:'none',stroke:color,'stroke-width':width,opacity}));
    this.ticks=svgEl('g');this.svg.append(this.ticks);let minor='',major='',inside='';for(let i=0;i<1080;i++){const a=i/1080*TAU,large=i%30===0,mid=i%6===0;const p1=polar(this.g,outer-13-(large?8:mid?5:2),a),p2=polar(this.g,outer-12,a);const path=`M${p1.x.toFixed(2)} ${p1.y.toFixed(2)}L${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;if(large)major+=path;else minor+=path;if(i%2===0){const a1=polar(this.g,inner+3,a),a2=polar(this.g,inner+(i%12===0?12:7),a);inside+=`M${a1.x.toFixed(2)} ${a1.y.toFixed(2)}L${a2.x.toFixed(2)} ${a2.y.toFixed(2)}`}}
    this.ticks.append(svgEl('path',{d:minor,fill:'none',stroke:'#ffffff','stroke-width':'.65',opacity:'.65'}),svgEl('path',{d:major,fill:'none',stroke:'#ffffff','stroke-width':'.8',opacity:'.95'}),svgEl('path',{d:inside,fill:'none',stroke:'#ffffff','stroke-width':'.55',opacity:'.72'}));
    this.labels=svgEl('g');this.svg.append(this.labels);for(let i=0;i<72;i++){const a=i/72*TAU,p=polar(this.g,outer-24,a);this.labels.append(txt({x:p.x,y:p.y,'font-family':'Consolas,monospace','font-size':w>1700?'6.5':'5',fill:'#ffffff',transform:`rotate(${a*180/Math.PI} ${p.x} ${p.y})`},String(i*5).padStart(3,'0')))}
    this.packets=svgEl('g');this.svg.append(this.packets);for(const rotor of [this.packets,this.labels,this.ticks]){rotor.style.transformBox='view-box';rotor.style.transformOrigin=`${cx}px ${cy}px`;rotor.style.willChange='transform'}this.renderPackets();this.applyRotation();
  }
  update(events,selected){this.events=(selected?events.filter(e=>e.agentId===selected||e.targetAgent===selected):events).slice(0,48);this.selected=selected;const ids=this.events.map(e=>e.eventId).join('|');if(ids===this.ids)return;this.ids=ids;this.dirty=true;if(performance.now()-this.lastRender>350)this.renderPackets()}
  renderPackets(){if(!this.packets)return;this.lastRender=performance.now();this.dirty=false;this.packets.replaceChildren();const {inner,outer,w}=this.g;const band=outer-inner,font=clamp(w/145,6.5,10.5),step=font*1.15;const data=this.events;if(!data.length)return;
    // The blocks are real event fields and the hexadecimal bytes of their payload.
    const count=Math.max(22,Math.min(48,Math.floor(TAU*inner/(step*9.2))));for(let slot=0;slot<count;slot++){
      const e=data[slot%data.length],angle=-Math.PI+slot/count*TAU;const p=polar(this.g,inner+20,angle);const block=svgEl('g',{transform:`translate(${p.x} ${p.y}) rotate(${angle*180/Math.PI})`});const text=svgEl('text',{'font-family':'Segoe UI,Arial,sans-serif','font-size':font,'font-weight':'500',fill:'#ffffff',opacity:'1'});const date=new Date(e.timestamp).toISOString().slice(11,23);const lines=[`// ${e.agentName.toUpperCase().slice(0,19)}`,date,`${e.type.toUpperCase()}`,e.tool||e.targetAgent||'agent.runtime',`TOK ${String(e.tokens).padStart(5,'0')}`,`LAT ${String(e.latencyMs).padStart(4,'0')} ms`,`STATUS ${e.status.toUpperCase()}`,e.content].map(line=>line.slice(0,Math.floor(band*.46/(font*.56))));
      lines.forEach((line,i)=>{const span=svgEl('tspan',{x:0,y:i*step});span.textContent=line;text.append(span)});block.append(text);
      const highlight=svgEl('rect',{x:-1,y:step*2-font*.8,width:Math.min(band*.42,font*lines[2].length*.6),height:font*.95,fill:'#ffffff',opacity:slot%5===0?'.27':'.07'});block.insertBefore(highlight,text);this.packets.append(block);
      const hp=polar(this.g,inner+band*.57,angle+.018),hexBlock=svgEl('g',{transform:`translate(${hp.x} ${hp.y}) rotate(${angle*180/Math.PI})`});const bytes=new TextEncoder().encode(JSON.stringify({id:e.agentId,tool:e.tool,tok:e.tokens,ms:e.latencyMs}));const matrix=svgEl('text',{'font-family':'Consolas,monospace','font-size':font*.83,fill:'#ffffff',opacity:'1'});const cols=Math.max(3,Math.min(8,Math.floor(band*.36/(font*1.6))));for(let row=0;row<8;row++){const span=svgEl('tspan',{x:0,y:row*step});span.textContent=Array.from({length:cols},(_,col)=>bytes[(row*cols+col)%bytes.length].toString(16).padStart(2,'0').toUpperCase()).join(' ');matrix.append(span)}hexBlock.append(matrix);this.packets.append(hexBlock);
    }
  }
  step(dt){if(this.reduced)return;this.rotation-=dt*.012;this.tickRotation+=dt*.0035;this.applyRotation();if(this.dirty&&performance.now()-this.lastRender>350)this.renderPackets()}
  applyRotation(){if(!this.g)return;if(this.packets)this.packets.style.transform=`rotate(${this.rotation}deg)`;if(this.labels)this.labels.style.transform=`rotate(${this.rotation*.45}deg)`;if(this.ticks)this.ticks.style.transform=`rotate(${this.tickRotation}deg)`}
}
function polar(g,r,a){return{x:g.cx+Math.cos(a)*r,y:g.cy+Math.sin(a)*r}}

export function sparkline(canvas,data,color,{bars=false}={}){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const d=Math.min(devicePixelRatio||1,2),w=r.width,h=r.height;if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d)}const c=canvas.getContext('2d');if(!c)return;c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);c.strokeStyle='#ffffff';c.lineWidth=.4;
  if(bars){const max=Math.max(1,...data.map(a=>a[0]+a[1])),gap=w/data.length;data.forEach((a,i)=>{const h1=a[0]/max*(h-2),h2=a[1]/max*(h-2);c.fillStyle='#ffffff9a';c.fillRect(i*gap,h-h1,Math.max(.7,gap-1.5),h1);c.fillStyle='#ffffff75';c.fillRect(i*gap,h-h1-h2,Math.max(.7,gap-1.5),h2)});return}
  for(let i=1;i<=3;i++){c.beginPath();c.moveTo(0,h/3*i-1);c.lineTo(w,h/3*i-1);c.stroke()}const max=Math.max(1,...data)*1.12,points=data.map((n,i)=>[i/(data.length-1)*w,h-2-n/max*(h-5)]);c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.lineTo(w,h);c.lineTo(0,h);c.closePath();const fill=c.createLinearGradient(0,0,0,h);fill.addColorStop(0,color+'27');fill.addColorStop(1,color+'00');c.fillStyle=fill;c.fill();c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=.8;c.stroke();}
