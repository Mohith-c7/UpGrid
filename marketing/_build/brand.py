from PIL import Image, ImageDraw, ImageFont
P="#126B63";PD="#0D4F4A";CO="#F26B4F";AM="#F5B544";INK="#172B3A";MU="#64748B";CV="#F6F8F9";SF="#FFFFFF";BD="#E4E9EC";OK="#16845B";WA="#B7791F";ER="#C2413A"
FD="/usr/share/fonts/opentype/inter/"
def F(w="Bold",s=40,disp=False):
    return ImageFont.truetype(FD+("InterDisplay-" if disp else "Inter-")+w+".otf",s)
def wrap(d,text,font,maxw):
    lines=[]
    for para in text.split("\n"):
        cur=""
        for w in para.split():
            t=(cur+" "+w).strip()
            if d.textlength(t,font=font)<=maxw: cur=t
            else: lines.append(cur);cur=w
        lines.append(cur)
    return lines
def text_block(d,xy,text,font,fill,maxw,lh=1.25,anchor_w=None):
    x,y=xy;lines=wrap(d,text,font,maxw)
    for l in lines:
        d.text((x,y),l,font=font,fill=fill);y+=int(font.size*lh)
    return y
def rr(d,box,r,fill=None,outline=None,width=1):
    # flat style: cards/panels ~10px, pill-like shapes become 6px rectangles
    m=min(abs(box[2]-box[0]),abs(box[3]-box[1]))
    r=6 if r>=m/2-1 else min(r,10)
    d.rounded_rectangle(box,r,fill=fill,outline=outline,width=width)
def logo(d,x,y,s,bg=P,fg=SF,dot=CO):
    rr(d,(x,y,x+s,y+s),int(s*.26),fill=bg)
    # check mark
    pts=[(x+s*.26,y+s*.53),(x+s*.43,y+s*.70),(x+s*.76,y+s*.32)]
    d.line(pts,fill=fg,width=max(2,int(s*.11)),joint="curve")
    for p in (pts[0],pts[2]):
        r=max(1,int(s*.055));d.ellipse((p[0]-r,p[1]-r,p[0]+r,p[1]+r),fill=fg)
    r=int(s*.09);cx,cy=x+s*.80,y+s*.20
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=dot)
def pill(d,x,y,label,fg,bg,font,padx=22,pady=10):
    w=d.textlength(label,font=font)
    h=font.size+pady*2
    rr(d,(x,y,x+w+padx*2,y+h),h//2,fill=bg)
    d.text((x+padx,y+pady-2),label,font=font,fill=fg)
    return x+w+padx*2,y+h
