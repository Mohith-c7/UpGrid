import sys,os,subprocess;sys.path.insert(0,os.path.dirname(__file__))
from brand import *
import qa
W,H=1080,1920;FPS=30;DUR=30;N=FPS*DUR
M="/mnt/user-data/outputs/upgrid/marketing/"
scenes=[ # bg, kicker, headline, sub, chips
(PD,"PLACEMENT SEASON","Same form.\nAgain.\nAnd again.","CGPA. 10th. 12th. Backlogs. Links.",[]),
(P,"STEP 1","Build your\nprofile once.","Then stop re-typing it.",["Academics","Links","Resumes"]),
(PD,"STEP 2","See why you're\neligible.","Clear reasons for every drive.",["Eligible","Not eligible","Check profile"]),
(P,"STEP 3","Review.\nOpt in.\nDone.","Prefilled from your profile.",[]),
(PD,"NEVER MISS IT","Reminders at\n60, 30, 15\nminutes.","Before every deadline.",["60 min","30 min","15 min"]),
(P,"FOR PLACEMENT CELLS","Drive wizard.\nEligible counts.\nApplicant pipeline.","Plus announcements.",[]),
(PD,"","UpGrid","Launching soon  |  Campus pilot",[]),
]
SL=N//len(scenes);CHECK=False
def ease(t): t=max(0,min(1,t));return 1-(1-t)**3
def mix(a,b,t):
    a=tuple(int(a[i:i+2],16) for i in(1,3,5));b=tuple(int(b[i:i+2],16) for i in (1,3,5))
    return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))
def draw_scene(d,img,si,lt):  # lt: local seconds
    bg,k,h,sub,chips=scenes[si]
    tin=max(0,min(1,lt/0.3)); tout=max(0,min(1,(lt-(SL/FPS-0.3))/0.3)); a=tin*(1-tout)
    dy=0
    ov=Image.new("RGBA",(W,H),(0,0,0,0));o=qa.QA(ImageDraw.Draw(ov),W,H,True)
    al=int(255*a)
    def col(c): 
        r=tuple(int(c[i:i+2],16) for i in(1,3,5));return r+(al,)
    last=si==len(scenes)-1
    if last:
        s=200;logo(o,(W-s)//2,560+dy,s,bg=(255,255,255,al),fg=col(P),dot=col(CO))
        o.text((W//2,860+dy),"UpGrid",font=F("ExtraBold",110,True),fill=col(SF),anchor="mm")
        w=o.textlength(sub,font=F("Bold",42))+80
        rr(o,((W-w)/2,960+dy,(W+w)/2,1050+dy),45,fill=col(AM));o.text((W//2,1005+dy),sub,font=F("Bold",42),fill=col(INK),anchor="mm")
        o.text((W//2,1130+dy),"Waitlist: link in bio",font=F("Medium",40),fill=col("#CFE3E0"),anchor="mm")
    else:
        y=520+dy
        if k:
            rr(o,(80,y,80+o.textlength(k,font=F("Bold",32))+56,y+64),32,fill=col(CO));o.text((108,y+12),k,font=F("Bold",32),fill=col(SF));y+=120
        for l in h.split("\n"):
            o.text((80,y),l,font=F("ExtraBold",100,True),fill=col(SF));y+=120
        y+=20;o.text((80,y),sub,font=F("Regular",46),fill=col("#CFE3E0"));y+=110
        x=80
        for c in chips:
            f=F("Bold",38);w=o.textlength(c,font=f)+64
            rr(o,(x,y,x+w,y+84),42,fill=col(AM) if si!=2 or c!="Not eligible" else col(SF));o.text((x+32,y+19),c,font=f,fill=col(INK));x+=w+20
    if CHECK: o.finish(f'promo-reel scene {si}')
    img.paste(Image.alpha_composite(img.convert("RGBA"),ov).convert("RGB"))
def frame(n):
    si=min(n//SL,len(scenes)-1);lt=(n-si*SL)/FPS
    # bg crossfade over first 0.4s
    bg=scenes[si][0]
    if si>0 and lt<0.3: c=mix(scenes[si-1][0],bg,lt/0.3)
    else: c=mix(bg,bg,0)
    img=Image.new("RGB",(W,H),c);d=ImageDraw.Draw(img)
    logo(d,80,170,72,bg=SF,fg=P);d.text((172,184),"UpGrid",font=F("Bold",38),fill=SF)
    draw_scene(d,img,si,lt);return img
if __name__=="__main__":
    CHECK=True
    for si in range(len(scenes)):
        im=Image.new("RGB",(W,H),PD);draw_scene(ImageDraw.Draw(im),im,si,2.0)
    for m_ in qa.ISSUES: print("QA",m_)
    CHECK=False
    p=subprocess.Popen(["ffmpeg","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-f","lavfi","-i","anullsrc=r=44100:cl=stereo","-t",str(DUR),"-c:v","libx264","-pix_fmt","yuv420p","-crf","20","-preset","fast","-c:a","aac","-b:a","64k","-shortest","-movflags","+faststart",M+"promo-reel.mp4"],stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
    for n in range(N): p.stdin.write(frame(n).tobytes())
    p.stdin.close();p.wait()
    # cover
    img=Image.new("RGB",(W,H),PD);d=ImageDraw.Draw(img)
    logo(d,80,170,96,bg=SF,fg=P);d.text((200,194),"UpGrid",font=F("Bold",48),fill=SF)
    y=640
    for l in ["Apply by","reviewing,","not typing."]:
        d.text((80,y),l,font=F("ExtraBold",138,True),fill=SF);y+=160
    d.text((80,y+30),"Eligibility reasons. 60/30/15 reminders.",font=F("Regular",44),fill="#CFE3E0")
    pill(d,80,y+140,"Launching soon  |  Campus pilot",INK,AM,F("Bold",40),36,18)
    img.save(M+"promo-cover.png")
