(function(){
  function parse(c){var s=c.match(/color\(srgb ([^)]+)\)/);if(s){var q=s[1].split(/[ \/]+/).filter(Boolean).map(Number);return {r:q[0]*255,g:q[1]*255,b:q[2]*255,a:q.length>3?q[3]:1};}var m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;var p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function over(f,b){var a=f.a;return {r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
  function bg(el){var layers=[];for(var e=el;e;e=e.parentElement){var c=parse(getComputedStyle(e).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break;}}
    var base={r:255,g:255,b:255,a:1};for(var i=layers.length-1;i>=0;i--)base=over(layers[i],base);return base;}
  function lum(c){function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
  function ratio(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
  var fails=[],n=0,w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){var t=w.currentNode;if(!t.textContent.trim())continue;var el=t.parentElement;if(el.closest('script'))continue;
    var cs=getComputedStyle(el);var fg=parse(cs.color);var b=bg(el);fg=over(fg,b);var r=ratio(fg,b);n++;
    var big=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.66&&parseInt(cs.fontWeight)>=700);
    if(r<(big?3:4.5))fails.push(r.toFixed(2)+' '+el.tagName+'.'+el.className+' "'+t.textContent.trim().slice(0,30)+'"');}
  return JSON.stringify({theme:document.documentElement.dataset.theme,checked:n,fails:fails,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth});
})()
