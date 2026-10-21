import {CanvasSurface,fieldGeometry} from './field.js';
const TAU=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const spectrum=['#3ecbff','#697eff','#a86bff','#ef64ff','#ff5d9e','#ff9860','#ffe08a','#ffffff'];
const hash=s=>{let h=0;for(const c of String(s))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return h};

export class Energy extends CanvasSurface{
  constructor(canvas){super(canvas);this.pulses=[];this.time=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches}
  reset(){this.pulses=[];this.time=0}
  spawn(e){if(this.reduced)return;const seed=hash(e.eventId);if(this.pulses.length>22)this.pulses.shift();this.pulses.push({age:0,speed:.006+Math.min(e.tokens/800000,.005),angle:((seed%1000)/1000-.5)*1.8,width:.035+Math.min(e.tokens/10000,.12),color:spectrum[seed%spectrum.length]})}
  step(dt){this.time+=dt;for(const p of this.pulses)p.age+=p.speed*dt;this.pulses=this.pulses.filter(p=>p.age<1.15)}
  draw(){const c=this.ctx;if(!c)return;const w=this.width,h=this.height,g=fieldGeometry(w,h);c.clearRect(0,0,w,h);if(this.reduced)return;c.save();c.globalCompositeOperation='lighter';
    for(const p of this.pulses){const radius=g.inner+(g.outer-g.inner+90)*p.age,alpha=Math.sin(clamp(p.age,0,1)*Math.PI)*.85*(radius>g.inner+18&&radius<g.outer-18?.18:1);for(let echo=0;echo<3;echo++){const r=radius-echo*13;c.strokeStyle=p.color;c.globalAlpha=alpha*(echo?.20:.65);c.lineWidth=echo?1:2.2;c.beginPath();c.arc(g.cx,g.cy,r,p.angle-p.width,p.angle+p.width);c.stroke();if(!echo){c.globalAlpha=alpha*.07;c.lineWidth=13;c.stroke()}}
      if(p.age>.62){const a=p.angle,x=g.cx+Math.cos(a)*radius,y=g.cy+Math.sin(a)*radius;const reach=(p.age-.62)*w*.55;c.strokeStyle=p.color;c.globalAlpha=alpha*.7;c.lineWidth=.8;c.beginPath();c.moveTo(x,y);c.lineTo(x+reach,y);c.stroke();c.strokeStyle='#ffffff';c.globalAlpha=alpha;c.beginPath();c.moveTo(x-6,y);c.lineTo(x+14,y);c.moveTo(x,y-7);c.lineTo(x,y+7);c.stroke()}
    }
    const sweep=Math.sin(this.time*.0033)*1.1;for(let layer=0;layer<3;layer++){const radius=g.outer+layer*4;c.strokeStyle=spectrum[(Math.floor(this.time/90)+layer)%spectrum.length];c.lineWidth=layer?1:3;c.globalAlpha=layer?.35:.7;c.beginPath();c.arc(g.cx,g.cy,radius,sweep-.075,sweep+.075);c.stroke()}c.restore();
  }
}

