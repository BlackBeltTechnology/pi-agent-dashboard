// Shared: pipe two ws sockets, buffering a→b until b is open. Preserves text/binary framing.
export function pipe(a, b, tag, log) {
  const q = [];
  let n = { up: 0, down: 0 };
  a.on("message", (d, bin) => { n.up++; b.readyState === 1 ? b.send(d, { binary: bin }) : q.push([d, bin]); });
  b.on("open", () => { for (const [d, bin] of q.splice(0)) b.send(d, { binary: bin }); log(`${tag} upstream open, flushed`); });
  b.on("message", (d, bin) => { n.down++; if (a.readyState === 1) a.send(d, { binary: bin }); });
  const close = (who) => (code, reason) => { log(`${tag} ${who} closed ${code} ${reason} msgs up=${n.up} down=${n.down}`); try { a.close(); } catch {} try { b.close(); } catch {} };
  a.on("close", close("downstream")); b.on("close", close("upstream"));
  a.on("error", (e) => log(`${tag} downstream err ${e.message}`)); b.on("error", (e) => log(`${tag} upstream err ${e.message}`));
}
