import struct,sys,zipfile,collections
z=zipfile.ZipFile(sys.argv[1])
res=collections.defaultdict(lambda:[0,0,[]])
for n in z.namelist():
    if n.endswith('.so') and '/lib/' in n:
        abi=n.split('/lib/')[1].split('/')[0]
        d=z.read(n)
        if d[:4]!=b'\x7fELF': continue
        is64=d[4]==2
        if is64:
            phoff=struct.unpack_from('<Q',d,0x20)[0]; phentsize,phnum=struct.unpack_from('<HH',d,0x36)
        else:
            phoff=struct.unpack_from('<I',d,0x1c)[0]; phentsize,phnum=struct.unpack_from('<HH',d,0x2a)
        al=[]
        for i in range(phnum):
            o=phoff+i*phentsize
            t=struct.unpack_from('<I',d,o)[0]
            if t==1:
                al.append(struct.unpack_from('<Q',d,o+0x30)[0] if is64 else struct.unpack_from('<I',d,o+0x1c)[0])
        ok=min(al)>=0x4000 if al else True
        r=res[abi]; r[0]+=1
        if not ok: r[1]+=1; r[2].append(n.split('/')[-1]+':'+hex(min(al)))
for abi,(t,bad,names) in res.items():
    print(abi,'total',t,'abaixo de 16KB',bad, sorted(set(names))[:12])
