import {COLORS} from './engine.js';
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function geometry(w,h){const s=Math.min(w/1400,h/640);return {s,cx:(w-1400*s)/2+700*s,cy:(h-640*s)/2+600*s,r:500*s}}
export class CanvasSurface {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.width=0;this.height=0;this.resize();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas)}
  resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);this.ctx?.setTransform(dpr,0,0,dpr,0,0)}
}
export class Network extends CanvasSurface {
  constructor(canvas,engine,{onSelect,tooltip}={}){
    super(canvas);this.engine=engine;this.onSelect=onSelect;this.tooltip=tooltip;this.selected=null;this.drag=null;this.hover=null;this.pointer=null;this.moved=false;this.canvas.style.touchAction='pan-y';
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();this.pointer={x:e.clientX-r.left,y:e.clientY-r.top};if(this.drag){this.moved=true;this.drag.x=this.pointer.x;this.drag.y=this.pointer.y;this.drag.vx=0;this.drag.vy=0}else this.findHover()});
    canvas.addEventListener('pointerleave',()=>{this.pointer=null;this.hover=null;if(this.tooltip)this.tooltip.hidden=true});
    canvas.addEventListener('pointerdown',e=>{this.findHover();this.moved=false;if(this.hover){this.drag=this.hover;canvas.setPointerCapture(e.pointerId)}});
    canvas.addEventListener('pointerup',()=>{if(this.drag&&!this.moved)this.onSelect?.(this.drag.kind==='agent'?this.drag.id:null);this.drag=null});canvas.addEventListener('pointercancel',()=>this.drag=null);
  }
  findHover(){if(!this.pointer)return;let nearest=null,dist=15;for(const n of this.engine.nodes.values()){const d=Math.hypot(n.x-this.pointer.x,n.y-this.pointer.y);if(d<dist){dist=d;nearest=n}}this.hover=nearest;this.canvas.style.cursor=nearest?'grab':'default';if(this.tooltip){this.tooltip.hidden=!nearest;if(nearest){this.tooltip.textContent=`${nearest.name} · ${nearest.status} · ${nfmt(nearest.tokens)} tokens`;this.tooltip.style.left=`${clamp(nearest.x+10,5,this.width-195)}px`;this.tooltip.style.top=`${clamp(nearest.y-40,50,this.height-45)}px`}}}
  position(node,index){const {cx,cy,r}=geometry(this.width,this.height);const hash=hashCode(node.id);const angle=-Math.PI+.15+(hash%2800)/1000;const radius=r*(node.kind==='agent'?.47+index%3*.07:.23+(hash%420)/1000);node.x=cx+Math.cos(angle)*radius;node.y=cy+Math.sin(angle)*radius;node.positioned=true}
  step(dt,now){
    const nodes=[...this.engine.nodes.values()],w=this.width,h=this.height,edges=this.engine.edges,{cx,cy,r}=geometry(w,h);
    nodes.forEach((n,i)=>{if(!n.positioned)this.position(n,i);if(n===this.drag)return;n.activity*=Math.pow(.97,dt);n.vx+=(cx-n.x)*.00035*dt;n.vy+=(cy-r*.42-n.y)*.00035*dt});
    // Pairwise repulsion at this bounded size gives a stable force layout without a dependency.
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y;const d2=Math.max(dx*dx+dy*dy,40),f=Math.min(1.2,100/d2)*dt;const d=Math.sqrt(d2);dx=dx/d*f;dy=dy/d*f;if(a!==this.drag){a.vx+=dx;a.vy+=dy}if(b!==this.drag){b.vx-=dx;b.vy-=dy}
    }
    for(const e of edges.values()){const a=this.engine.nodes.get(e.source),b=this.engine.nodes.get(e.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),rest=(a.kind==='agent'&&b.kind==='agent')?w*.22:w*.17;const f=(d-rest)*.0008*dt;if(a!==this.drag){a.vx+=dx/d*f;a.vy+=dy/d*f}if(b!==this.drag){b.vx-=dx/d*f;b.vy-=dy/d*f}}
    nodes.forEach(n=>{if(n!==this.drag){n.vx*=.89;n.vy*=.89;n.x+=n.vx*dt;n.y=Math.min(cy-14,n.y+n.vy*dt);const dx=n.x-cx,dy=n.y-cy,d=Math.hypot(dx,dy);if(d>r*.68){n.x=cx+dx/d*r*.68;n.y=cy+dy/d*r*.68}}});
  }
  draw(now){const ctx=this.ctx;if(!ctx)return;const w=this.width,h=this.height;ctx.clearRect(0,0,w,h);ctx.lineWidth=.5;
    const {cx,cy,r}=geometry(w,h);ctx.fillStyle='#45414e';for(let x=cx-r;x<cx+r;x+=24)for(let y=cy-r;y<cy;y+=24){if(Math.hypot(x-cx,y-cy)<r*.77)ctx.fillRect(x,y,.65,.65)}
    for(const e of this.engine.edges.values()){
      const a=this.engine.nodes.get(e.source),b=this.engine.nodes.get(e.target);if(!a||!b)continue;const age=now-e.lastSeen;const active=age<1300;const selected=!this.selected||a.id===this.selected||b.id===this.selected;const alpha=selected?(active?.15+Math.max(0,1-age/1300)*.28:.055):.015;
      ctx.strokeStyle=active&&selected?(COLORS[e.status]??COLORS.running):'#d0cddb';ctx.globalAlpha=alpha;ctx.lineWidth=active?Math.min(1.8,.5+Math.log1p(e.tokens)/10):.5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      if(active&&selected){const t=((now%1300)/1300),x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;ctx.globalAlpha=Math.max(0,1-age/1300)*.9;ctx.fillStyle='#e6fff9';ctx.beginPath();ctx.arc(x,y,1.3,0,TAU);ctx.fill()}
    }
    ctx.globalAlpha=1;for(const n of this.engine.nodes.values()){
      const selected=!this.selected||this.selected===n.id;const isAgent=n.kind==='agent';const radius=isAgent?3.2:n.kind==='tool'?2.2:n.kind==='cluster'?6:1.2;const color=isAgent||n.activity>.5?(COLORS[n.status]??COLORS.idle):'#b9b5c8';ctx.globalAlpha=selected?1:.22;
      if((n.activity>.35||isAgent)&&selected){const glow=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,isAgent?18:9);glow.addColorStop(0,color+'38');glow.addColorStop(1,color+'00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(n.x,n.y,isAgent?18:9,0,TAU);ctx.fill()}
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x,n.y,radius,0,TAU);ctx.fill();if(isAgent){ctx.strokeStyle=color;ctx.globalAlpha=selected?.3:.08;ctx.lineWidth=.5;ctx.beginPath();ctx.arc(n.x,n.y,6+(n.activity*3),0,TAU);ctx.stroke();ctx.globalAlpha=selected?.75:.25;ctx.font='6px "DM Mono",Consolas,monospace';ctx.fillStyle='#c8c3d4';const text=n.name.toUpperCase();const right=n.x<w*.73;ctx.fillText(text,right?n.x+10:n.x-ctx.measureText(text).width-10,n.y+2)}
      if(this.hover===n||this.selected===n.id){ctx.globalAlpha=.9;ctx.strokeStyle='#f3ecff';ctx.lineWidth=.7;ctx.beginPath();ctx.arc(n.x,n.y,11,0,TAU);ctx.stroke()}
    }ctx.globalAlpha=1;
  }
}

export class Stream extends CanvasSurface {
  constructor(canvas){super(canvas);this.rays=[];this.seed=1128;this.lastSpawn=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;for(let i=0;i<26;i++)this.spawn({tokens:200+i*30,status:i%3?'success':'thinking'},true)}
  random(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296}
  spawn(e,initial=false){const count=this.reduced?1:clamp(Math.round(e.tokens/120),3,16);for(let i=0;i<count;i++){if(this.rays.length>=260)this.rays.shift();this.rays.push({radius:initial?this.random()*480:100+this.random()*90,angle:-Math.PI+.06+this.random()*(Math.PI-.12),speed:2+this.random()*5,length:15+this.random()*80,width:this.random()>.92?1.2:.55,alpha:.25+this.random()*.55,color:e.status==='error'?'#e9b779':this.random()>.65?'#b7a5e9':this.random()>.5?'#90cfc8':'#e2daed'})}}
  step(dt){if(this.reduced)return;this.rays.forEach(r=>r.radius+=r.speed*dt);this.rays=this.rays.filter(r=>r.radius-r.length<525)}
  draw(){const ctx=this.ctx;if(!ctx)return;ctx.clearRect(0,0,this.width,this.height);const {cx,cy,s}=geometry(this.width,this.height);
    for(const r of this.rays){const fade=clamp((530-r.radius)/200,0,1);ctx.globalAlpha=r.alpha*fade;const x=cx+Math.cos(r.angle)*r.radius*s,y=cy+Math.sin(r.angle)*r.radius*s,x0=cx+Math.cos(r.angle)*(r.radius-r.length)*s,y0=cy+Math.sin(r.angle)*(r.radius-r.length)*s;const g=ctx.createLinearGradient(x0,y0,x,y);g.addColorStop(0,r.color+'00');g.addColorStop(1,r.color);ctx.strokeStyle=g;ctx.lineWidth=r.width;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle=r.color;ctx.fillRect(x,y,1.5,1.5);if(r.width>1){ctx.globalAlpha*=.12;ctx.lineWidth=4;ctx.stroke()}}
    ctx.globalAlpha=1;
  }
}

export class Horizon {
  constructor(svg){
    this.svg=svg;this.events=svg.querySelector('#ring-events');this.back=svg.querySelector('#ring-back');this.front=svg.querySelector('#ring-front');this.ids='';
    const clipped=el('g',{'clip-path':'url(#compass-clip)'});this.back.append(clipped);
    const armor=el('g',{class:'compass-rotor rotor-armor'});clipped.append(armor);
    for(let i=0;i<90;i++){armor.append(el('path',{d:arc(531,i*4+.2,i*4+2.8),fill:'none',stroke:i%5===0?'#eeeeef':'#97979f','stroke-width':i%5===0?'10':'6',opacity:i%5===0?'.9':'.5'}))}
    // Full circular rotors are clipped at the datum to form one rotating half compass.
    const outer=el('g',{class:'compass-rotor rotor-outer'});clipped.append(outer);
    for(let i=0;i<240;i++){const angle=i*1.5*Math.PI/180,major=i%10===0,minor=i%5===0;outer.append(el('line',{x1:700+Math.cos(angle)*(major?488:minor?496:502),y1:600+Math.sin(angle)*(major?488:minor?496:502),x2:700+Math.cos(angle)*514,y2:600+Math.sin(angle)*514,stroke:major?'#dedce7':'#9f9bac','stroke-width':major?'1.3':'.6',opacity:major?'.85':'.45'}))}
    const middle=el('g',{class:'compass-rotor rotor-middle'});clipped.append(middle);
    for(let i=0;i<12;i++){middle.append(el('path',{d:arc(476,i*30+1,i*30+22),fill:'none',stroke:i%3===0?'#a2e8db':'#d6d6df','stroke-width':i%3===0?'8':'3',opacity:i%3===0?'.8':'.6'}));middle.append(el('path',{d:arc(465,i*30+3,i*30+17),fill:'none',stroke:'#babac5','stroke-width':'1',opacity:'.6'}))}
    const core=el('g',{class:'compass-rotor rotor-core'});clipped.append(core);
    for(let i=0;i<72;i++){core.append(el('path',{d:arc(315,i*5+.5,i*5+2.7),fill:'none',stroke:'#dddde5','stroke-width':'4',opacity:i%6===0?'.65':'.16'}))}
    for(let i=0;i<6;i++){core.append(el('path',{d:arc(336,i*60+2,i*60+39),fill:'none',stroke:i%2?'#9a8bb9':'#a8c8c5','stroke-width':i%2?'1':'2',opacity:'.45'}));core.append(el('path',{d:arc(327,i*60+4,i*60+25),fill:'none',stroke:'#c0b6d0','stroke-width':'.6',opacity:'.4'}));}
    const sweep=el('g',{class:'compass-rotor rotor-scan'});clipped.append(sweep);sweep.append(el('path',{d:'M 700 600 L 330 221 A 530 530 0 0 1 392 169 Z',fill:'#7ae4da',opacity:'.025'}));sweep.append(el('line',{x1:700,y1:600,x2:392,y2:169,stroke:'#7ae4da','stroke-width':'1',opacity:'.4'}));
    for(const [r,alpha] of [[536,.12],[526,.45],[483,.18],[453,.35],[352,.15],[305,.2],[160,.11],[94,.25]])this.front.append(el('path',{d:arc(r,180,360),fill:'none',stroke:r===526?'#d4cfe2':'#b9b0cd','stroke-width':r===526?'1':'.6',opacity:alpha}));
    // Fixed navigational references stay readable while the dial rotates.
    for(let i=0;i<=12;i++){const angle=180+i*15,p=point(559,angle);const label=i===6?'N':String((270+i*15)%360).padStart(3,'0');const text=el('text',{x:p.x,y:p.y+4,'text-anchor':'middle',fill:i===6?'#d6f7ef':'#bfbfc9','font-size':i===6?'22':'12','font-family':'Arial, sans-serif','letter-spacing':'.4'});text.textContent=label;this.front.append(text)}
    for(let i=1;i<12;i++){const a=180+i*15,p1=point(170,a),p2=point(316,a);this.back.append(el('line',{x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,stroke:'#aaa0bb','stroke-width':'.5','stroke-dasharray':'2 8',opacity:'.15'}))}
    const needle=el('g',{class:'compass-rotor compass-needle'});needle.append(el('path',{d:'M 700 595 L 686 360 L 700 228 L 714 360 Z',fill:'#bce5df','fill-opacity':'.035',stroke:'#bce5df','stroke-width':'.8',opacity:'.8'}));needle.append(el('path',{d:'M 694 252 L 700 228 L 706 252 Z',fill:'#c4f4ec'}));clipped.append(needle);
    this.front.append(el('line',{x1:120,y1:601,x2:1280,y2:601,stroke:'#b2a6c5','stroke-width':'.7',opacity:'.45'}));
    for(const x of [120,175,700,1225,1280])this.front.append(el('path',{d:`M ${x-4} 601 H ${x+4} M ${x} 597 V 605`,stroke:'#afa5be','stroke-width':'.8',fill:'none',opacity:'.6'}));
    this.front.append(el('rect',{x:600,y:440,width:200,height:130,fill:'#050508','fill-opacity':'.96'}));
    const caption=el('text',{x:700,y:462,'text-anchor':'middle',fill:'#a1a1ad','font-size':'11','font-family':'Arial, sans-serif'});caption.textContent='CURRENT BEARING';this.front.append(caption);
    this.bearing=el('text',{x:700,y:516,'text-anchor':'middle',fill:'#f4f4f6','font-size':'52','font-family':'Arial, sans-serif','letter-spacing':'-2'});this.bearing.textContent='048.6°';this.front.append(this.bearing);
    this.agent=el('text',{x:700,y:544,'text-anchor':'middle',fill:'#aaaab5','font-family':'Arial, sans-serif','font-size':'12'});this.agent.textContent='Waiting for events';this.front.append(this.agent);
    this.front.append(el('path',{d:'M 700 565 L 727 580 L 727 610 L 700 625 L 673 610 L 673 580 Z',fill:'#0b0c0f',stroke:'#bcbcc8','stroke-width':'1.5'}));
    this.front.append(el('circle',{cx:700,cy:595,r:17,fill:'none',stroke:'#7d8b8b','stroke-width':'1'}));this.front.append(el('path',{d:'M 690 595 H 710 M 700 585 V 605',stroke:'#bceee2','stroke-width':'1.5',fill:'none'}));this.front.append(el('line',{x1:700,y1:625,x2:700,y2:640,stroke:'#c8c8d0','stroke-width':'1'}));
  }
  update(events,selected){const list=(selected?events.filter(e=>e.agentId===selected||e.targetAgent===selected):events).slice(0,4),ids=list.map(e=>e.eventId).join();if(ids===this.ids)return;this.ids=ids;this.events.replaceChildren();
    list.forEach((e,i)=>{const radius=443-i*23,id=`compass-event-${i}`;this.events.append(el('path',{id,d:arc(radius,194,346),fill:'none',stroke:'#a79ab9','stroke-width':'.4','stroke-opacity':'.12'}));const color=i===0?(COLORS[e.status]??COLORS.running):'#aaa1ba';const text=el('text',{fill:color,'font-family':'DM Mono,Consolas,monospace','font-size':'8.5','letter-spacing':'.7',opacity:1-i*.17});const path=el('textPath',{href:`#${id}`,startOffset:`${4+i*6}%`});path.textContent=`${new Date(e.timestamp).toISOString().slice(11,19)}  //  ${e.agentName.toUpperCase()}  ›  ${e.tool||e.type}  ·  ${e.content.slice(0,70)}`;text.append(path);this.events.append(text)});
    if(list[0]){this.bearing.textContent=((hashCode(list[0].agentId)%1450)/10+12).toFixed(1)+'°';this.agent.textContent=list[0].agentName.slice(0,23)}else{this.bearing.textContent='—';this.agent.textContent='Waiting for events'}
  }
}
function point(r,degrees){const a=degrees*Math.PI/180;return {x:700+Math.cos(a)*r,y:600+Math.sin(a)*r}}
function arc(r,start,end){const a=point(r,start),b=point(r,end);return `M ${a.x} ${a.y} A ${r} ${r} 0 ${end-start>180?1:0} 1 ${b.x} ${b.y}`}
function el(name,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function hashCode(s){let hash=0;for(let i=0;i<s.length;i++)hash=(hash*31+s.charCodeAt(i))>>>0;return hash}
function nfmt(n){return n>1000?`${(n/1000).toFixed(1)}k`:n}

export function sparkline(canvas,data,color,{bars=false,second=false}={}){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=Math.min(devicePixelRatio||1,2),w=r.width,h=r.height;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}const c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.strokeStyle='#292332';c.lineWidth=.5;
  if(bars){const max=Math.max(1,...data.map(a=>a[0]+a[1]));const gap=w/data.length;data.forEach((a,i)=>{const h1=a[0]/max*(h-3),h2=a[1]/max*(h-3);c.fillStyle='#7ae4da88';c.fillRect(i*gap,h-h1,Math.max(1,gap-2),h1);c.fillStyle='#ad9fea99';c.fillRect(i*gap,h-h1-h2,Math.max(1,gap-2),h2)});return}
  for(let i=1;i<=3;i++){c.beginPath();c.moveTo(0,h/3*i-1);c.lineTo(w,h/3*i-1);c.stroke()}
  const max=Math.max(1,...data)*1.1,points=data.map((n,i)=>[i/(data.length-1)*w,h-3-n/max*(h-8)]);c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.lineTo(w,h);c.lineTo(0,h);c.closePath();const fill=c.createLinearGradient(0,0,0,h);fill.addColorStop(0,color+'24');fill.addColorStop(1,color+'00');c.fillStyle=fill;c.fill();c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=.85;c.stroke();const p=points.at(-1);c.fillStyle=color;c.beginPath();c.arc(p[0]-1,p[1],1.7,0,TAU);c.fill();
}
