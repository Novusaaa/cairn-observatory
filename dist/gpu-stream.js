import {Stream as CanvasStream,fieldGeometry} from './field.js';
const palette=['#3ecbff','#697eff','#a86bff','#ef64ff','#ff5d9e','#ff9860','#ffe08a','#ffffff'];
const hash=s=>{let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const colors=palette.map(rgb);

export class GPUStream{
  constructor(canvas){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,depth:false,stencil:false,powerPreference:'high-performance'});
    if(!gl){canvas.dataset.renderer='canvas';return new CanvasStream(canvas)}
    this.canvas=canvas;this.gl=gl;this.rays=[];this.seed=2871;this.width=0;this.height=0;this.dpr=Math.min(devicePixelRatio||1,1.25);this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.vertices=new Float32Array(4600*8*6);this.contextLost=false;
    const vertex=this.shader(gl.VERTEX_SHADER,'attribute vec2 a_position; attribute vec4 a_color; uniform vec2 u_resolution; varying vec4 v_color; void main(){vec2 p=a_position/u_resolution*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);v_color=a_color;}');
    const fragment=this.shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec4 v_color; void main(){gl_FragColor=v_color;}');
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Output shader could not link');gl.useProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);this.program=program;
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);
    const pos=gl.getAttribLocation(program,'a_position'),color=gl.getAttribLocation(program,'a_color');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,4,gl.FLOAT,false,24,8);this.resolution=gl.getUniformLocation(program,'u_resolution');gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.disable(gl.DEPTH_TEST);canvas.dataset.renderer='webgl';this.resize();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;canvas.dataset.renderer='recovering'});canvas.addEventListener('webglcontextrestored',()=>{const replacement=canvas.cloneNode();canvas.replaceWith(replacement);this.fallback=new CanvasStream(replacement);replacement.dataset.renderer='canvas';this.contextLost=false});
  }
  shader(type,source){const gl=this.gl,s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Output shader could not compile');return s}
  resize(){const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;this.canvas.width=Math.round(rect.width*this.dpr);this.canvas.height=Math.round(rect.height*this.dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height)}
  rand(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296}
  spawn(e){if(this.fallback)return this.fallback.spawn(e);const seed=hash(e.agentId+e.tool+e.eventId),band=(seed%8+.5)/8,count=this.reduced?5:clamp(Math.round(e.tokens/2),130,650);for(let i=0;i<count;i++){if(this.rays.length>=4500)this.rays.shift();this.rays.push({y:clamp(band+(this.rand()-.5)*.15,.002,.998),head:-this.rand()*200,length:100+this.rand()*720,speed:15+this.rand()*27,alpha:.6+this.rand()*.4,color:Math.floor(this.rand()*colors.length),flare:this.rand()>.94})}}
  step(dt){if(this.fallback)return this.fallback.step(dt);if(this.reduced)return;for(const ray of this.rays)ray.head+=ray.speed*dt;this.rays=this.rays.filter(ray=>ray.head-ray.length<this.width*.7)}
  draw(){if(this.fallback)return this.fallback.draw();if(this.contextLost||!this.width||!this.height)return;const gl=this.gl,w=this.width,h=this.height,g=fieldGeometry(w,h),v=this.vertices;let offset=0;
    const put=(x,y,color,alpha)=>{v[offset++]=x;v[offset++]=y;v[offset++]=color[0];v[offset++]=color[1];v[offset++]=color[2];v[offset++]=alpha};
    for(const ray of this.rays){const y=ray.y*h,start=g.cx+Math.sqrt(Math.max(0,g.outer*g.outer-(y-g.cy)**2))+7,head=start+ray.head,tail=Math.max(start,head-ray.length);if(head<start||tail>w)continue;const fade=clamp(1-(head-w)/(ray.length*.8),0,1),color=colors[ray.color],alpha=ray.alpha*fade;
      put(tail,y,color,0);put(head,y,color,alpha);put(Math.max(tail,head-130),y-.9,color,0);put(head,y-.9,color,alpha*.13);put(Math.max(tail,head-130),y+.9,color,0);put(head,y+.9,color,alpha*.13);put(Math.max(tail,head-(ray.flare?12:3)),y,colors[7],alpha*.85);put(head,y,colors[7],alpha*.85);
    }
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.uniform2f(this.resolution,w,h);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,v.subarray(0,offset));gl.drawArrays(gl.LINES,0,offset/6);
  }
}
