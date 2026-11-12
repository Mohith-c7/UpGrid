"""Programmatic layout QA. Wrap an ImageDraw in QA(d,W,H,vertical) while drawing; .finish(ctx) reports:
 - text crossing a container edge, text overlapping other text/lines, too little padding inside its card (<24px) or chip (<6px),
 - text outside frame safe margins (48px; 9:16: 160px top, 250px bottom)."""
ISSUES=[]
def _n(b): return (min(b[0],b[2]),min(b[1],b[3]),max(b[0],b[2]),max(b[1],b[3]))
def _inter(a,b): return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
def _in(a,b,t=0.8): return a[0]>=b[0]-t and a[1]>=b[1]-t and a[2]<=b[2]+t and a[3]<=b[3]+t
class QA:
    def __init__(s,d,W,H,vertical=False): s.d=d;s.W=W;s.H=H;s.v=vertical;s.texts=[];s.boxes=[];s.lines=[]
    def __getattr__(s,n): return getattr(s.d,n)
    def text(s,xy,t,font=None,fill=None,anchor=None,**k):
        if str(t).strip(): s.texts.append((_n(s.d.textbbox(xy,t,font=font,anchor=anchor)),t))
        return s.d.text(xy,t,font=font,fill=fill,anchor=anchor,**k)
    def rounded_rectangle(s,box,*a,**k):
        s.boxes.append(_n(box));return s.d.rounded_rectangle(box,*a,**k)
    def rectangle(s,box,*a,**k):
        s.boxes.append(_n(box));return s.d.rectangle(box,*a,**k)
    def line(s,xy,fill=None,width=1,joint=None):
        pts=[tuple(p) for p in xy] if isinstance(xy[0],(tuple,list)) else [(xy[i],xy[i+1]) for i in range(0,len(xy),2)]
        xs=[p[0] for p in pts];ys=[p[1] for p in pts];w=width/2
        if width>=4 or len(pts)>2: s.lines.append((min(xs)-w,min(ys)-w,max(xs)+w,max(ys)+w))
        return s.d.line(xy,fill=fill,width=width,joint=joint)
    def finish(s,ctx):
        out=[];T=s.texts;B=[b for b in s.boxes if (b[2]-b[0])>3 and (b[3]-b[1])>3]
        full=[b for b in B if (b[2]-b[0])>=s.W*.9 and (b[3]-b[1])>=s.H*.9]
        for tb,t in T:
            sh=(tb[0]+1,tb[1]+1,tb[2]-1,tb[3]-1)
            for b in B:
                if b in full: continue
                if _inter(sh,b)>0 and not _in(tb,b): out.append(f"text crosses box edge: '{t}' {tuple(int(v) for v in tb)} vs box {tuple(int(v) for v in b)}")
            for l in s.lines:
                if _inter(sh,l)>0: out.append(f"text overlaps line/tick: '{t}' {tuple(int(v) for v in tb)}")
            cont=[b for b in B if _in(tb,b) and b not in full]
            if cont:
                c=min(cont,key=lambda b:(b[2]-b[0])*(b[3]-b[1]));pad=min(tb[0]-c[0],tb[1]-c[1],c[2]-tb[2],c[3]-tb[3]);area=(c[2]-c[0])*(c[3]-c[1])
                need=24 if area>=150000 else 6
                if pad<need-0.5: out.append(f"padding {pad:.0f}px<{need}: '{t}' in box {tuple(int(v) for v in c)}")
            top=160 if s.v else 48;bot=s.H-(250 if s.v else 48)
            if tb[0]<48 or tb[2]>s.W-48 or tb[1]<top or tb[3]>bot: out.append(f"outside safe margin: '{t}' {tuple(int(v) for v in tb)}")
        for i in range(len(T)):
            for j in range(i+1,len(T)):
                a,b=T[i][0],T[j][0];a=(a[0]+2,a[1]+3,a[2]-2,a[3]-3)
                if _inter(a,b)>0: out.append(f"text overlaps text: '{T[i][1]}' / '{T[j][1]}'")
        for o in dict.fromkeys(out): ISSUES.append(f"[{ctx}] {o}")
        return out
