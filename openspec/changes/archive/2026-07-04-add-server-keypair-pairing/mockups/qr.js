// Pseudo-QR renderer for mockups (NOT a real QR encoder — visual placeholder).
function drawFakeQR(canvas, seed){
  const N=29, px=canvas.width/N, ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  let s=0;for(const c of (seed||'pidp'))s=(s*131+c.charCodeAt(0))>>>0;
  const rnd=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
  ctx.fillStyle='#0b1120';
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    if(inFinder(x,y,N))continue;
    if(rnd()>0.52)ctx.fillRect(x*px,y*px,px,px);
  }
  finder(ctx,0,0,px);finder(ctx,N-7,0,px);finder(ctx,0,N-7,px);
  function inFinder(x,y,N){return (x<8&&y<8)||(x>=N-8&&y<8)||(x<8&&y>=N-8);}
  function finder(ctx,ox,oy,px){
    ctx.fillStyle='#0b1120';ctx.fillRect(ox*px,oy*px,7*px,7*px);
    ctx.fillStyle='#fff';ctx.fillRect((ox+1)*px,(oy+1)*px,5*px,5*px);
    ctx.fillStyle='#0b1120';ctx.fillRect((ox+2)*px,(oy+2)*px,3*px,3*px);
  }
}
document.querySelectorAll('canvas[data-qr]').forEach(c=>drawFakeQR(c,c.getAttribute('data-qr')));
