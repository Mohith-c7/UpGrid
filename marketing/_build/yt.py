"""Engine for YouTube teaser + Shorts: PIL layers + numpy fade/slide compositing, piped to ffmpeg."""
import sys,os,subprocess,math
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from brand import *
from mocks_app import mock3 as mock2
import qa
QA_CTX=['']
FADE=0.3
M="/mnt/user-data/outputs/placement-os/marketing/"
FPS=30
def ease(t): t=max(0.0,min(1.0,t));return 1-(1-t)**3
def rgb(c): return tuple(int(c[i:i+2],16) for i in (1,3,5))

class Px:  # scaling proxy so brand/mock helpers render crisply at any scale
    def __init__(s,d,k,ox=0,oy=0): s.d=d;s.k=k;s.ox=ox;s.oy=oy;s._fc={}
    def _f(s,font):
        key=(font.path,font.size)
        if key not in s._fc: s._fc[key]=ImageFont.truetype(font.path,max(1,round(font.size*s.k)))
        return s._fc[key]
    def _xy(s,xy):
        if isinstance(xy[0],(tuple,list)): return [(v[0]*s.k+s.ox,v[1]*s.k+s.oy) for v in xy]
        return [xy[i]*s.k+(s.ox if i%2==0 else s.oy) for i in range(len(xy))]
    def _w(s,w): return max(1,round(w*s.k))
    def rounded_rectangle(s,box,r=0,fill=None,outline=None,width=1): s.d.rounded_rectangle(s._xy(box),r*s.k,fill=fill,outline=outline,width=s._w(width))
    def rectangle(s,box,fill=None,outline=None,width=1): s.d.rectangle(s._xy(box),fill=fill,outline=outline,width=s._w(width))
    def ellipse(s,box,fill=None,outline=None,width=1): s.d.ellipse(s._xy(box),fill=fill,outline=outline,width=s._w(width))
    def line(s,xy,fill=None,width=1,joint=None): s.d.line(s._xy(xy),fill=fill,width=s._w(width),joint=joint)
    def text(s,xy,t,font=None,fill=None,anchor=None): s.d.text(s._xy(xy),t,font=s._f(font),fill=fill,anchor=anchor)
    def textlength(s,t,font=None): return s.d.textlength(t,font=s._f(font))/s.k

def layer(fn,W,H,maxa=1.0):
    """Render fn(img,d) on black and white, recover exact RGBA, crop to bbox."""
    outs=[]
    for bg in ((0,0,0),(255,255,255)):
        img=Image.new("RGB",(W,H),bg);dd=ImageDraw.Draw(img)
        if bg==(0,0,0): dq=qa.QA(dd,W,H,W<H);fn(img,dq);dq.finish(QA_CTX[0])
        else: fn(img,dd)
        outs.append(np.asarray(img).astype(np.float32))
    k,w=outs
    a=np.clip(1-(w-k).mean(axis=2)/255,0,1)
    ys,xs=np.where(a>0.003)
    if len(ys)==0: return None
    y0,y1,x0,x1=ys.min(),ys.max()+1,xs.min(),xs.max()+1
    a=a[y0:y1,x0:x1];col=np.clip(k[y0:y1,x0:x1]/np.maximum(a[...,None],1e-3),0,255)
    return (x0,y0,col,a*maxa)

def blend(fr,L,op,dy,W,H):
    x0,y0,col,a=L;h,w=a.shape;y=y0+dy
    ys=max(0,y);ye=min(H,y+h);xs=max(0,x0);xe=min(W,x0+w)
    if ye<=ys or xe<=xs: return
    A=a[ys-y:ye-y,xs-x0:xe-x0,None]*op;R=col[ys-y:ye-y,xs-x0:xe-x0]
    reg=fr[ys:ye,xs:xe].astype(np.float32)
    fr[ys:ye,xs:xe]=(reg+(R-reg)*A+0.5).astype(np.uint8)

def base_frame(cfg,bgc):
    W,H=cfg["W"],cfg["H"];img=Image.new("RGB",(W,H),bgc);d=ImageDraw.Draw(img)
    ls=cfg["logo"];x=cfg["mx"];y=cfg["ty"]
    assert y>=(160 if W<H else 48) and x>=48
    logo(d,x,y,ls,bg=SF,fg=P);d.text((x+ls+22,y+ls//2),"Placement OS",font=F("Bold",int(ls*.52)),fill=SF,anchor="lm")
    ft="Launching soon  |  Campus pilot";f=F("Medium",cfg["tagfs"])
    d.text((W-cfg["mx"],y+ls//2),ft,font=f,fill="#CFE3E0",anchor="rm")
    return np.asarray(img)

def cap_layer(cfg,text):
    W,H=cfg["W"],cfg["H"];fs=cfg["capfs"];f=F("SemiBold",fs)
    def fn(img,d):
        lines=wrap(d,text,f,cfg["capw"]);lh=int(fs*1.3)
        tw=max(d.textlength(l,font=f) for l in lines);ph=lh*len(lines)+44;pw=tw+80
        by=cfg["capy"];y0=by-ph
        rr(d,((W-pw)/2,y0,(W+pw)/2,by),28,fill=INK)
        for i,l in enumerate(lines): d.text((W//2,y0+22+i*lh+lh//2),l,font=f,fill=SF,anchor="mm")
    return layer(fn,W,H,0.86)

def srt_t(t):
    ms=int(round(t*1000));h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
def write_srt(path,caps):
    with open(path,"w") as fh:
        for i,(a,b,t,_) in enumerate(caps,1): fh.write(f"{i}\n{srt_t(a)} --> {srt_t(b)}\n{t}\n\n")

def music(path,dur):
    def ch(m):
        fs=[(110,.05,.07,0),(164.81,.04,.09,1),(220,.03,.11,2),(277.18,.02,.06,3),(329.63,.012,.05,4)]
        return "+".join(f"{a}*sin(2*PI*{f*m}*t)*(0.75+0.25*sin(2*PI*{r}*t+{p}))" for f,a,r,p in fs)
    expr=f"{ch(1.0)}|{ch(1.0025)}"
    fo=max(0,dur-3)
    subprocess.run(["ffmpeg","-y","-v","error","-f","lavfi","-i",f"aevalsrc={expr}:s=44100:d={dur}","-af",
        f"lowpass=f=1100,aecho=0.8:0.6:500|900:0.25|0.15,afade=t=in:d=2.5,afade=t=out:st={fo}:d=3,volume=0.9",path],check=True)

def render(out,cfg,scenes,caps,music_path=None,progress=False):
    """scenes: list of dict(dur,bg,items=[(delay,fn,until)]); caps: [(t0,t1,text,burn)]"""
    W,H=cfg["W"],cfg["H"]
    starts=[];t=0
    for s in scenes: starts.append(t);t+=s["dur"]
    total=t;N=int(round(total*FPS))
    bases=[base_frame(cfg,s["bg"]) for s in scenes]
    sl=[]
    for si_,s in enumerate(scenes):
        its=[]
        for it in s["items"]:
            delay,fn=it[0],it[1];until=it[2] if len(it)>2 else None
            QA_CTX[0]=f"{os.path.basename(out)} scene {si_} t={starts[si_]:.0f}s";L=layer(fn,W,H)
            if L is not None: its.append((delay,L,until))
        sl.append(its)
    cl=[]
    for a,b,t,burn in caps:
        if burn: QA_CTX[0]=f"{os.path.basename(out)} caption {a:.1f}s";cl.append((a,b,cap_layer(cfg,t)))
    # layout check: items must stay in frame and never collide with a burned-in caption visible at the same time
    for i,its in enumerate(sl):
        for delay,L,until in its:
            x0,y0,col,a=L;h,w=a.shape
            if y0<0 or x0<0 or y0+h>H or x0+w>W: print(f"WARN scene {i}: item bbox leaves frame",(x0,y0,w,h))
            u=until if until is not None else scenes[i]["dur"]
            v0,v1=starts[i]+delay,starts[i]+u
            for ca,cb,CL in cl:
                if CL is None or cb<=v0 or ca>=v1: continue
                cx,cy,_,ca_=CL;ch_,cw_=ca_.shape
                if x0<cx+cw_ and cx<x0+w and y0<cy+ch_ and cy<y0+h: print(f"WARN overlap caption {ca:.1f}-{cb:.1f} with item bbox scene {i}",(x0,y0,w,h),"caption",(cx,cy,cw_,ch_))
    cmd=["ffmpeg","-y","-v","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-"]
    if music_path: cmd+=["-i",music_path]
    else: cmd+=["-f","lavfi","-i","anullsrc=r=44100:cl=stereo"]
    cmd+=["-t",f"{total:.3f}","-vf","scale=out_color_matrix=bt709","-c:v","libx264","-pix_fmt","yuv420p","-crf","22","-preset","veryfast",
          "-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709","-c:a","aac","-b:a","96k","-shortest","-movflags","+faststart",out]
    for m_ in qa.ISSUES: print('QA',m_)
    qa.ISSUES.clear()
    if os.environ.get('QA_ONLY'): return total
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    last=len(scenes)-1
    for n in range(N):
        t=n/FPS;i=max(j for j in range(len(scenes)) if starts[j]<=t+1e-9);lt=t-starts[i];dur=scenes[i]["dur"]
        if i<last and lt>dur-FADE:
            e=(lt-(dur-FADE))/FADE;fr=(bases[i]*(1-e)+bases[i+1]*e+0.5).astype(np.uint8)
        else: fr=bases[i].copy()
        for delay,L,until in sl[i]:
            ain=max(0.0,min(1.0,(lt-delay)/FADE))
            u=until if until is not None else (dur-FADE if i<last else 1e9)
            aout=max(0.0,min(1.0,(lt-u)/FADE));op=ain*(1-aout)
            if op>0.002: blend(fr,L,op,0,W,H)
        for a,b,L in cl:
            if L is None: continue
            op=min(max(0.0,min(1.0,(t-a)/0.2)),1-max(0.0,min(1.0,(t-(b-0.2))/0.2)))
            if op>0.002: blend(fr,L,op,0,W,H)
        if progress: fr[0:8,:int(W*n/N)]=rgb(AM)
        p.stdin.write(fr.tobytes())
    p.stdin.close();p.wait()
    return total

def render_silent(out,cfg,scenes,caps,progress=False):
    """Fallback: identical picture, silent (anullsrc) audio track. Use when the generated ambient bed is not wanted."""
    return render(out,cfg,scenes,caps,None,progress)

# ---------- device card ----------
def card_size(kinds,cw,maxh,smax=1.5,mf=None):
    mock2_=mf or mock2
    pad,hdr,ftr,gap=36,64,56,20
    im=Image.new("RGB",(1200,1600));dd=ImageDraw.Draw(im)
    hs=[mock2_(dd,k,0,0,560) for k in kinds];Hn=sum(hs)+gap*(len(kinds)-1)
    s=min((cw-2*pad)/560,(maxh-2*pad-hdr-ftr)/Hn,smax);wn=(cw-2*pad)/s
    hs=[mock2_(dd,k,0,0,wn) for k in kinds];Hn=sum(hs)+gap*(len(kinds)-1)
    ch=2*pad+hdr+ftr+Hn*s
    return s,wn,hs,ch,gap
def draw_card(img,d,kinds,x,y,cw,maxh,title,smax=1.5,mf=None):
    pad,hdr,ftr=36,64,56
    mock2_=mf or mock2
    s,wn,hs,ch,gap=card_size(kinds,cw,maxh,smax,mf)
    rr(d,(x,y,x+cw,y+ch),36,fill=CV,outline=BD,width=3)
    d.text((x+pad,y+pad),title,font=F("Bold",32),fill=INK)
    f=F("Bold",22);lab="Illustrative screen";pw=d.textlength(lab,font=f)+36
    pill(d,x+cw-pad-pw,y+pad-4,lab,INK,AM,f,18,6)
    yy=y+pad+hdr
    for k,h in zip(kinds,hs):
        mock2_(Px(d,s,x+pad,yy),k,0,0,wn);yy+=h*s+gap*s
    d.text((x+pad,y+ch-pad-14),"Fictional data. Pre-launch demo build.",font=F("Regular",22),fill=MU)
    return ch
def card_h(kinds,cw,maxh,smax=1.5,mf=None): return card_size(kinds,cw,maxh,smax,mf)[3]
