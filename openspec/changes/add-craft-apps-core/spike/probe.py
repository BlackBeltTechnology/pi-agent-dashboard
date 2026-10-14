import json,subprocess,glob,os,re,sys
rows=[]
for b in sorted(glob.glob('/tmp/craft-spike/*/*/*-cli')):
    a=os.path.basename(b)[:-4]
    def run(args,t=20):
        try: p=subprocess.run([b]+args,capture_output=True,text=True,timeout=t,cwd='/tmp/craft-spike/work'); return p.stdout+p.stderr
        except Exception as e: return f'ERR {e}'
    ver=run(['--version']).strip().splitlines()[0][:40] if run(['--version']).strip() else '?'
    cmds=run(['commands'],30)
    ncmd=sum(1 for l in cmds.splitlines() if re.match(r'^\s*[a-z][\w-]*\.[\w.-]+',l))
    helptxt=run(['--help'])
    sub=sorted(set(re.findall(rf'{a}-cli (\w[\w-]*)',helptxt))-{'FILE'})
    # MCP
    msgs=[{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}},
          {"jsonrpc":"2.0","method":"notifications/initialized"},
          {"jsonrpc":"2.0","id":2,"method":"tools/list"}]
    inp=''.join(json.dumps(m)+'\n' for m in msgs)
    tools=[]
    try:
        p=subprocess.Popen([b,'mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd='/tmp/craft-spike/work')
        p.stdin.write(inp); p.stdin.flush()
        import select,time
        end=time.time()+20; buf=''
        while time.time()<end:
            r,_,_=select.select([p.stdout],[],[],1)
            if r:
                line=p.stdout.readline()
                if not line: break
                try:
                    m=json.loads(line)
                    if m.get('id')==2: tools=[t['name'] for t in m['result']['tools']]; break
                except: pass
        p.kill()
    except Exception as e: tools=[f'ERR {e}']
    rows.append(dict(app=a,ver=ver,subcmds=sub,ncmd=ncmd,ntools=len(tools),tools=tools))
json.dump(rows,open('/tmp/craft-spike/matrix.json','w'),indent=1)
for r in rows: print(f"{r['app']:12} {r['ver']:28} cmds={r['ncmd']:4} mcpTools={r['ntools']:3} sub={','.join(r['subcmds'])}")
