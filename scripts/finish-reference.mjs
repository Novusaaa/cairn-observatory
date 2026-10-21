import {readFileSync,writeFileSync} from 'node:fs';
const target=new URL('../dist/field.js',import.meta.url);
let source=readFileSync(target,'utf8');
// Neutralize the static instrument. Preserve the explicit spectral flow palette.
const palette=source.match(/const SPECTRUM=\[[^\n]+/)[0];
source=source.replace(/const SPECTRUM=\[[^\n]+/,'/* SPECTRUM */');
source=source.replace(/#(?:[0-9a-f]{8}|[0-9a-f]{6})\b/gi,c=>{
  const values=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
  return (Math.max(...values)<40?'#050508':'#ffffff')+c.slice(7);
});
source=source.replace('/* SPECTRUM */',palette);
const edits=[
  ["c.fillStyle=agent?(COLORS[n.status]??'#ffffff'):'#ffffff'","c.fillStyle='#ffffff'"],
  ['font=clamp(w/200,5.6,9.5)','font=clamp(w/145,6.5,10.5)'],
  ["const color=e.status==='error'?'#ffffff':slot%4===0?'#ffffff':'#ffffff';",''],
  ["'font-size':font,fill:color,opacity:'.9'","'font-size':font,'font-weight':'500',fill:'#ffffff',opacity:'1'"],
  ["e.content.slice(0,Math.floor(band/font*1.45))];","e.content].map(line=>line.slice(0,Math.floor(band*.46/(font*.56))));"],
  ["'font-size':font*.83,fill:'#ffffff',opacity:'.75'","'font-size':font*.83,fill:'#ffffff',opacity:'1'"],
  ['performance.now()-this.lastRender>150','performance.now()-this.lastRender>350'],
  ['performance.now()-this.lastRender>180','performance.now()-this.lastRender>350']
];
for(const [from,to]of edits){if(!source.includes(from))throw new Error(`Expected source was not found: ${from}`);source=source.replace(from,to)}
// Event descriptions use the same clean sans serif as the interface; byte matrices stay mono.
source=source.replace("const text=svgEl('text',{'font-family':'Consolas,monospace'","const text=svgEl('text',{'font-family':'Segoe UI,Arial,sans-serif'");
source=source.replace('px Consolas,monospace`;const label','px Segoe UI,Arial,sans-serif`;const label');
writeFileSync(target,source);
console.log('Static field neutralized; multicolor flow palette retained.');
