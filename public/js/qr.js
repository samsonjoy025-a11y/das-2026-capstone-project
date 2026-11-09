// Vendored QR Code encoder (minimal, byte mode, ECC L). Treat as a black box.
// API: renderQR(container, text, { size, margin }?) -> canvas
//      toDataURL(text, { size, margin }?) -> data URL

const EC_LEVEL_L = 1; // format bits use L=01

// Capacity and EC info for versions 1-10, ECC level L: [totalCodewords, ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data]
const VINFO = {
  1:[26,7,1,19,0,0], 2:[44,10,1,34,0,0], 3:[70,15,1,55,0,0], 4:[100,20,1,80,0,0],
  5:[134,26,1,108,0,0], 6:[172,18,2,68,0,0], 7:[196,20,2,78,0,0], 8:[242,24,2,97,0,0],
  9:[292,30,2,116,0,0], 10:[346,18,2,68,2,69],
};
const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};

// GF(256) tables for QR (primitive 0x11d)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF(){
  let x = 1;
  for (let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&256) x^=285; }
  for (let i=255;i<512;i++) EXP[i]=EXP[i-255];
})();

function gfMul(a,b){ if(!a||!b) return 0; return EXP[LOG[a]+LOG[b]]; }
function polyMul(p,q){
  const r = new Uint8Array(p.length+q.length-1);
  for(let i=0;i<p.length;i++) for(let j=0;j<q.length;j++) r[i+j]^=gfMul(p[i],q[j]);
  return r;
}
function rsGenerator(ecLen){
  let g = new Uint8Array([1]);
  for(let i=0;i<ecLen;i++) g = polyMul(g, new Uint8Array([1, EXP[i]]));
  return g;
}
function rsCompute(data, ecLen){
  const gen = rsGenerator(ecLen);
  const msg = new Uint8Array(data.length+ecLen);
  msg.set(data);
  for(let i=0;i<data.length;i++){
    const coef = msg[i]; if(!coef) continue;
    for(let j=0;j<gen.length;j++) msg[i+j]^=gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

function encodeData(text, version){
  const bytes = new TextEncoder().encode(text);
  const info = VINFO[version];
  const dataCap = info[2]*info[3] + info[4]*info[5]; // data codewords
  const bits = [];
  const push = (val, len)=>{ for(let i=len-1;i>=0;i--) bits.push((val>>>i)&1); };
  push(0b0100, 4); // byte mode
  const countLen = version <= 9 ? 8 : 16;
  push(bytes.length, countLen);
  for(const b of bytes) push(b, 8);
  const capBits = dataCap * 8;
  const term = Math.min(4, capBits - bits.length);
  push(0, term);
  while(bits.length % 8) bits.push(0);
  const pad = [0xec, 0x11]; let pi=0;
  while(bits.length < capBits){ push(pad[pi%2], 8); pi++; }
  const out = new Uint8Array(dataCap);
  for(let i=0;i<dataCap;i++){ let v=0; for(let j=0;j<8;j++) v=(v<<1)|bits[i*8+j]; out[i]=v; }
  return out;
}

function interleave(data, version){
  const [, ecPerBlock, g1b, g1d, g2b, g2d] = VINFO[version];
  const blocks = []; let off=0;
  const makeBlocks=(n,dc)=>{ for(let i=0;i<n;i++){ const d=data.slice(off,off+dc); off+=dc; blocks.push({d, ec:rsCompute(d,ecPerBlock)}); } };
  makeBlocks(g1b,g1d); makeBlocks(g2b,g2d);
  const res=[]; const maxD=Math.max(g1d,g2d);
  for(let i=0;i<maxD;i++) for(const b of blocks) if(i<b.d.length) res.push(b.d[i]);
  for(let i=0;i<ecPerBlock;i++) for(const b of blocks) res.push(b.ec[i]);
  return res;
}

function makeMatrix(version){
  const size = version*4+17;
  const m = Array.from({length:size},()=>Array(size).fill(null)); // null=unset
  const rsv = Array.from({length:size},()=>Array(size).fill(false)); // reserved
  const set=(y,x,v,res=true)=>{ if(y>=0&&y<size&&x>=0&&x<size){ m[y][x]=v?1:0; if(res) rsv[y][x]=true; } };
  // finder + separators
  const finder=(y,x)=>{
    for(let dy=-1;dy<=7;dy++) for(let dx=-1;dx<=7;dx++){
      const yy=y+dy, xx=x+dx; if(yy<0||yy>=size||xx<0||xx>=size) continue;
      const inOuter = dy===-1||dy===7||dx===-1||dx===7;
      const inBorder = dy===0||dy===6||dx===0||dx===6;
      const inInner = dy>=2&&dy<=4&&dx>=2&&dx<=4;
      set(yy,xx, inOuter?0:(inBorder||inInner)?1:0);
    }
  };
  finder(0,0); finder(0,size-7); finder(size-7,0);
  // timing
  for(let i=8;i<size-8;i++){ set(6,i,i%2===0); set(i,6,i%2===0); }
  // alignment
  const pos=ALIGN[version];
  for(const y of pos) for(const x of pos){
    if(rsv[y][x]) continue;
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) set(y+dy,x+dx, Math.abs(dy)===2||Math.abs(dx)===2|| (dy===0&&dx===0)?1:0);
  }
  // dark module
  set(size-8,8,1);
  // reserve format info
  for(let i=0;i<9;i++){ if(m[8][i]===null) set(8,i,0); if(m[i][8]===null) set(i,8,0); }
  for(let i=0;i<8;i++){ if(m[8][size-1-i]===null) set(8,size-1-i,0); if(m[size-1-i][8]===null) set(size-1-i,8,0); }
  return {m,rsv,size};
}

function placeData(matrix, codewords){
  const {m,rsv,size}=matrix;
  let bitIdx=0; const total=codewords.length*8;
  let dir=-1;
  for(let x=size-1;x>0;x-=2){
    if(x===6) x--;
    for(let i=0;i<size;i++){
      const y = dir===-1 ? size-1-i : i;
      for(const dx of [0,1]){
        const xx=x-dx; if(rsv[y][xx]) continue;
        let bit=0;
        if(bitIdx<total){ bit=(codewords[Math.floor(bitIdx/8)]>>>(7-(bitIdx%8)))&1; bitIdx++; }
        m[y][xx]=bit;
      }
    }
    dir=-dir;
  }
}

function maskMatrix(m,size,rsv,mask){
  const out=m.map(row=>row.slice());
  const fn = (y,x)=>((y+x)%2===0)?1:0; // mask 0
  if(mask!==0) throw new Error('only mask 0');
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!rsv[y][x]) out[y][x]^=fn(y,x);
  return out;
}

function formatBits(mask=0){
  const data = (EC_LEVEL_L<<3)|mask; // 01(L)<<3 | mask
  let bits = data<<10;
  const gen=0x537;
  let b=bits;
  for(let i=14;i>=10;i--) if(b&(1<<i)) b^=(gen<<(i-10));
  return ((data<<10)|b)^0x5412;
}

function drawFormat(m,size){
  const f=formatBits(0); const bit=i=> (f>>i)&1;
  // around top-left
  for(let i=0;i<=5;i++) m[8][i]=bit(i);
  m[8][7]=bit(6); m[8][8]=bit(7); m[7][8]=bit(8);
  for(let i=9;i<=14;i++) m[14-i][8]=bit(i);
  // other
  for(let i=0;i<8;i++) m[8][size-1-i]=bit(i);
  for(let i=8;i<15;i++) m[size-15+i][8]=bit(i);
}

function build(text){
  const bytes = new TextEncoder().encode(text);
  let version=1;
  for(let v=1;v<=10;v++){ const cap=VINFO[v][2]*VINFO[v][3]+VINFO[v][4]*VINFO[v][5]; if(bytes.length <= cap - 3){ version=v; break; } if(v===10) version=10; }
  const data=encodeData(text,version);
  const codewords=interleave(data,version);
  const matrix=makeMatrix(version);
  placeData(matrix, codewords);
  matrix.m = maskMatrix(matrix.m,matrix.size,matrix.rsv,0);
  drawFormat(matrix.m,matrix.size);
  return matrix;
}

export function toCanvas(text, { size=200, margin=4 } = {}){
  const {m,size:n}=build(String(text??''));
  const canvas = (typeof document!=='undefined') ? document.createElement('canvas') : null;
  if(!canvas) throw new Error('Canvas not available');
  const scale = Math.max(1, Math.floor(size/(n+margin*2)));
  const dim = (n+margin*2)*scale;
  canvas.width=dim; canvas.height=dim;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,dim,dim);
  ctx.fillStyle='#000';
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(m[y][x]) ctx.fillRect((x+margin)*scale,(y+margin)*scale,scale,scale);
  return canvas;
}

export function toDataURL(text, opts){ return toCanvas(text, opts).toDataURL('image/png'); }
export function renderQR(container, text, opts={}){
  const canvas = toCanvas(text, opts);
  if(container){ container.textContent=''; container.appendChild(canvas); }
  return canvas;
}

export default { toCanvas, toDataURL, renderQR };
