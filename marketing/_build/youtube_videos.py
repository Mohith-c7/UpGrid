import sys,os;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from yt import *
import qa
YT=M+"youtube/"
os.makedirs(YT+"shorts",exist_ok=True)
CFG16=dict(W=1920,H=1080,logo=60,mx=96,ty=72,tagfs=28,capfs=44,capw=1500,capy=1010)
CFGV=dict(W=1080,H=1920,logo=64,mx=72,ty=170,tagfs=24,capfs=46,capw=860,capy=1660)

# ---------- item builders ----------
def text_item(cfg,kicker,head,sub,hs=None,x=None,y0=None,w=None):
    V=cfg["W"]<cfg["H"];hs=hs or (96 if V else 88);lh=int(hs*1.18)
    x=x if x is not None else cfg["mx"]+(0 if V else 20)
    w=w or (cfg["W"]-2*cfg["mx"] if V else 800)
    def fn(img,d):
        nl=len(head.split("\n"));sf=F("Regular",44 if V else 40);sl=wrap(d,sub,sf,w) if sub else []
        tot=(120 if kicker else 0)+nl*lh+(24+len(sl)*int(sf.size*1.3) if sub else 0)
        y=y0 if y0 is not None else (210 if V else max(150,(cfg["H"]-130-tot)//2+40))
        if kicker:
            kf=F("Bold",32);rr(d,(x,y,x+d.textlength(kicker,font=kf)+56,y+64),32,fill=CO);d.text((x+28,y+11),kicker,font=kf,fill=SF);y+=120
        for l in head.split("\n"): d.text((x,y),l,font=F("ExtraBold",hs,True),fill=SF);y+=lh
        if sub:
            y+=24
            for l in sl: d.text((x,y),l,font=sf,fill="#CFE3E0");y+=int(sf.size*1.3)
    return fn

def card_item(cfg,kinds,title,smax=1.5,cw=None,y=None):
    V=cfg["W"]<cfg["H"]
    cw=cw or (cfg["W"]-2*cfg["mx"] if V else 820)
    top,bot=(790,1440) if V else (150,850)
    maxh=bot-top
    def fn(img,d):
        ch=card_h(kinds,cw,maxh,smax);x=(cfg["W"]-cw)//2 if V else cfg["W"]-cfg["mx"]-cw-20
        yy=top+(maxh-ch)//2 if y is None else y
        draw_card(img,d,kinds,x,yy,cw,maxh,title,smax)
    return fn

def notif_items(cfg,delays,until=None):
    V=cfg["W"]<cfg["H"];kinds=["n60","n30","n15"]
    cw=cfg["W"]-2*cfg["mx"] if V else 780;s=1.15 if V else 1.2
    wn=cw/s;x=(cfg["W"]-cw)//2 if V else cfg["W"]-cfg["mx"]-cw-40
    top=800 if V else 220
    out=[]
    for i,(k,dl) in enumerate(zip(kinds,delays)):
        def fn(img,d,k=k,i=i):
            mock2(Px(d,s,x,top+i*(152*s+26)),k,0,0,wn)
        out.append((dl,fn,until))
    def lab(img,d):
        yy=top+3*(152*s+26)+4
        f=F("Bold",22);t="Illustrative screen";pill(d,x,yy,t,INK,AM,f,18,6)
        d.text((x+d.textlength(t,font=f)+60,yy+8),"Fictional data. Pre-launch demo build.",font=F("Regular",22),fill="#CFE3E0")
    out.append((delays[-1]+0.4,lab,until))
    return out

def form_items(cfg,delays):
    V=cfg["W"]<cfg["H"]
    cw=cfg["W"]-2*cfg["mx"] if V else 780;x=(cfg["W"]-cw)//2 if V else cfg["W"]-cfg["mx"]-cw-40
    top=800 if V else 190;chh=170 if V else 190;gap=24 if V else 30
    out=[]
    for i,dl in enumerate(delays):
        def fn(img,d,i=i):
            y=top+i*(chh+gap)
            rr(d,(x,y,x+cw,y+chh),28,fill=SF,outline=BD,width=3)
            d.text((x+32,y+24),f"Drive form {i+1}",font=F("Bold",32),fill=INK)
            f=F("Medium",26);cx=x+32;cy=y+84
            for c in ["CGPA","10th %","12th %","Backlogs","Links"]:
                w=d.textlength(c,font=f)+40
                if cx+w>x+cw-32: cx=x+32;cy+=62
                rr(d,(cx,cy,cx+w,cy+50),25,fill=CV,outline=BD,width=2);d.text((cx+20,cy+10),c,font=f,fill=INK);cx+=w+14
            pill(d,x+cw-32-d.textlength("typed again",font=F("Bold",22))-36,y+20,"typed again",INK,AM,F("Bold",22),18,9)
        out.append((dl,fn,None))
    def lab(img,d):
        yy=top+len(delays)*(chh+gap)-10
        d.text((x,yy),"Illustrative",font=F("Regular",22),fill="#CFE3E0")
    out.append((delays[-1]+0.4,lab,None))
    return out

def hook_item(cfg,head):
    def fn(img,d):
        f=F("ExtraBold",124,True);lines=[]
        for ln in head.split("\n"): lines+=wrap(d,ln,f,cfg["W"]-2*cfg["mx"])
        lh=int(124*1.15);y=(cfg["H"]-lh*len(lines))//2-60
        for l in lines: d.text((cfg["mx"],y),l,font=f,fill=SF);y+=lh
        d.rectangle((cfg["mx"],y+20,cfg["mx"]+160,y+32),fill=CO)
    return fn

def end_item(cfg,l1,l2,l3,cy=None):
    W,H=cfg["W"],cfg["H"];V=W<H;cy=cy or (H//2-110 if V else H//2-120)
    def fn(img,d):
        s=190 if V else 170
        logo(d,(W-s)//2,cy-s-60,s,bg=SF,fg=P)
        d.text((W//2,cy+40),"UpGrid",font=F("ExtraBold",110 if V else 120,True),fill=SF,anchor="mm")
        d.text((W//2,cy+135),l1,font=F("Medium",44 if V else 46),fill="#CFE3E0",anchor="mm")
        f=F("Bold",42);w=d.textlength("Launching soon  |  Campus pilot",font=f)+80
        rr(d,((W-w)/2,cy+190,(W+w)/2,cy+280),45,fill=AM);d.text((W//2,cy+235),"Launching soon  |  Campus pilot",font=f,fill=INK,anchor="mm")
        d.text((W//2,cy+345),l2,font=F("Medium",40),fill="#CFE3E0",anchor="mm")
        if l3: d.text((W//2,cy+405),l3,font=F("Regular",32),fill="#9FC3BF",anchor="mm")
    return fn

def mk_caps(spec):  # spec: [(t0,t1,text,burn)] -> returns list
    return [(a,b,t,burn) for a,b,t,burn in spec]

# ---------- teaser ----------
def teaser():
    c=CFG16;S=[]
    # 1 title 0-6
    def title(img,d):
        W,H=c["W"],c["H"];s=150
        logo(d,(W-s)//2,230,s,bg=SF,fg=P)
        d.text((W//2,470),"UpGrid",font=F("ExtraBold",130,True),fill=SF,anchor="mm")
        d.text((W//2,590),"Apply by reviewing, not typing.",font=F("Medium",52),fill="#CFE3E0",anchor="mm")
    def tag(img,d):
        W=c["W"];f=F("Bold",44);t="Launching soon  |  Campus pilot";w=d.textlength(t,font=f)+80
        rr(d,((W-w)/2,660,(W+w)/2,752),46,fill=AM);d.text((W//2,706),t,font=f,fill=INK,anchor="mm")
    S.append(dict(dur=6,bg=PD,items=[(0.2,title),(0.9,tag)]))
    S.append(dict(dur=8,bg=P,items=[(0.2,text_item(c,"THE PROBLEM","The same details.\nEvery drive.","CGPA, 10th and 12th percentages, backlogs, links.")),*form_items(c,[0.8,2.2,3.6])]))
    S.append(dict(dur=8,bg=PD,items=[(0.2,text_item(c,"STEP 1","Build your\nprofile once.","Academics, links, skills, up to five resume links.")),
        (0.8,card_item(c,["prof_top"],"Profile"),3.9),(4.1,card_item(c,["verify2"],"Field status"))]))
    S.append(dict(dur=9,bg=P,items=[(0.2,text_item(c,"STEP 2","See why you're\neligible.","Required versus yours, for every criterion.")),
        (0.8,card_item(c,["drive_elig"],"Drive eligibility"),4.9),(5.1,card_item(c,["states2"],"Three clear states"))]))
    S.append(dict(dur=9,bg=PD,items=[(0.2,text_item(c,"STEP 3","Review.\nOpt in.\nDone.","Prefilled from your profile. You decide.")),
        (0.8,card_item(c,["apply_a"],"Review and apply"),5.0),(5.2,card_item(c,["receipt2"],"After you opt in"))]))
    S.append(dict(dur=7,bg=P,items=[(0.2,text_item(c,"NEVER MISS IT","Reminders at\n60, 30, 15\nminutes.","Before every deadline.")),*notif_items(c,[0.8,1.8,2.8])]))
    S.append(dict(dur=8,bg=PD,items=[(0.2,text_item(c,"FOR PLACEMENT CELLS","Drive wizard.\nEligible counts.\nApplicant pipeline.",None,hs=76)),
        (0.8,card_item(c,["wiz_steps"],"Drive wizard"),3.9),(4.1,card_item(c,["whocan"],"Before you publish"))]))
    S.append(dict(dur=8,bg=P,items=[(0.3,end_item(c,"A student-first campus placement app","Waitlist and pilot: link in the description","Independent founder. Pre-launch.",cy=430))]))
    caps=[(0.4,5.6,"Placement season. Same details, different form, every drive.",1),
      (6.5,10.3,"You type your CGPA, 10th and 12th percentages, backlogs and links.",1),
      (10.5,13.7,"Then you do it again. And wonder: am I even eligible?",1),
      (14.5,18.0,"Build your profile once: academics, links, skills and resume links.",1),
      (18.2,21.7,"A completion meter shows what is missing and the next step.",1),
      (22.5,25.8,"Each drive's rules are checked against your profile.",1),
      (26.0,28.8,"You see the reason, criterion by criterion.",1),
      (29.0,30.7,"Eligible, not eligible or pending. No guessing.",1),
      (31.5,35.5,"Applying is a review, not a typing session.",1),
      (35.7,39.0,"See what will be shared and where each value came from.",1),
      (39.2,40.0,"",0),
      (40.5,43.0,"Reminders arrive 60, 30 and 15 minutes before a drive closes.",1),
      (43.2,46.7,"Quiet hours are yours. Once you apply, they stop.",1),
      (47.5,51.0,"For placement cells: a drive wizard with autosaved drafts.",1),
      (51.2,54.7,"See the eligible count, then move applicants through a pipeline.",1),
      (55.5,58.5,"UpGrid is launching soon, starting with a campus pilot.",1),
      (58.7,62.6,"Students: join the waitlist. Placement cells: message us about a pilot.",1)]
    caps=[x for x in caps if x[2]]
    return S,caps

# ---------- shorts ----------
def short(hook,content,cta1,cta2,caps_txt):
    """content: list of (dur,kicker,head,sub,kinds,title) or ('notif',...)"""
    c=CFGV;S=[dict(dur=3.5,bg=PD,items=[(0.2,hook_item(c,hook))])];bgs=[P,PD,P]
    caps=[];t=3.5
    for i,sc in enumerate(content):
        dur=sc[0]
        if sc[4]=="notif": extra=notif_items(c,[0.9,1.9,2.9])
        elif sc[4]=="forms": extra=form_items(c,[0.8,2.0,3.2])
        else: extra=[(0.9,card_item(c,sc[4],sc[5]))]
        S.append(dict(dur=dur,bg=bgs[i%3],items=[(0.2,text_item(c,sc[1],sc[2],sc[3],hs=92,y0=270)),*extra]))
        t+=dur
    S.append(dict(dur=4.0,bg=P if len(content)%2==0 else PD,items=[(0.3,end_item(c,cta1,cta2,None,cy=860))]))
    return S

SHORTS=[
 dict(hook="Stop typing your CGPA for every drive.",
  content=[(5.5,"BUILD ONCE","Fill your\nprofile once.","Academics, links and resume links.",["prof_top"],"Profile"),
           (5.5,"STAY ON TRACK","Know what's\nmissing.","A completion meter shows the next step.",["verify2"],"Verification"),
           (5.5,"REVIEW NEXT TIME","Prefilled.\nJust review.","Your details come from your profile.",["apply_a"],"Review and apply")],
  cta=("Build once. Review next time.","Waitlist link in the description"),
  caps=[(0.4,3.2,"Stop typing your CGPA for every drive.",0),(4.2,8.6,"Fill your academics, links and resume once.",1),
        (9.7,13.6,"A completion meter shows what is missing.",1),(15.2,19.6,"When you apply, the form is prefilled and you just review it.",1),
        (21.0,23.6,"Waitlist link in the description.",1)],
  cover=("Fill your\nprofile once.","prof_top","Profile")),
 dict(hook="Know why you're not eligible.",
  content=[(6.5,"ELIGIBILITY","Required\nvs yours.","Every drive rule, checked.",["drive_elig"],"Drive eligibility"),
           (6.5,"THREE STATES","Met, not met,\nor pending.","Missing data says pending.",["states2"],"Eligibility states")],
  cta=("Know where you stand.","Follow for the campus pilot"),
  caps=[(0.4,3.2,"Know why you're not eligible.",0),(4.2,10.0,"Each drive rule is checked and shown: required, yours, met or not.",1),
        (10.7,16.2,"If data is missing, it says pending. No silent rejection.",1),(17.6,20.2,"Follow for the campus pilot.",1)],
  cover=("Why am I not\neligible?","drive_elig","Drive eligibility")),
 dict(hook="Your deadline closes in 15 minutes.",
  content=[(7.0,"60 / 30 / 15","Three reminders.\nEvery deadline.","60, 30 and 15 minutes before closing.","notif",None),
           (6.0,"YOUR CALL","Quiet hours.\nSwitch any off.","Reminders stop once you apply.",["rem_q"],"Reminder settings")],
  cta=("Never miss a closing time.","Waitlist in the description"),
  caps=[(0.4,3.2,"Your deadline closes in 15 minutes.",0),(4.3,10.2,"Reminders at 60, 30 and 15 minutes before closing.",1),
        (11.2,16.2,"Set quiet hours. Switch any off.",1),(17.4,20.2,"Waitlist in the description.",1)],
  cover=("60, 30, 15.","notif",None)),
 dict(hook="Apply without typing.",
  content=[(6.0,"PREVIEW","See what\nwill be shared.","And where each value came from.",["apply_a"],"Review and apply"),
           (6.0,"OPT IN","Pick a resume.\nOpt in.","Get a reference and a timeline.",["receipt2"],"After you opt in")],
  cta=("Preview. Review. Opt in.","Subscribe for launch updates"),
  caps=[(0.4,3.2,"Apply without typing.",0),(4.2,9.2,"See what will be shared and answer only the extras.",1),
        (10.2,15.2,"Pick a resume, opt in, and get a reference.",1),(16.3,19.2,"Subscribe for launch updates.",1)],
  cover=("Opt in in\nseconds.","apply_a","Review and apply")),
 dict(hook="Running a drive?\nCount first, publish second.",
  content=[(5.5,"DRIVE WIZARD","Create a drive\nstep by step.","Autosaved drafts. A check before publishing.",["wiz_steps"],"Drive wizard"),
           (5.5,"ELIGIBLE COUNT","See who\nqualifies.","With reasons, before you publish.",["whocan"],"Before you publish"),
           (5.5,"PIPELINE","Move applicants\nthrough stages.","From submitted to joined.",["applicants"],"Applicant pipeline")],
  cta=("Run the drive. See the pipeline.","TPOs: message us about a pilot"),
  caps=[(0.4,3.2,"Running a drive? Count first, publish second.",0),(4.2,8.8,"Create a drive with a wizard.",1),
        (9.9,14.2,"See how many students are eligible.",1),(15.4,19.7,"Then move applicants through the pipeline.",1),
        (20.8,23.6,"TPOs, message us about a pilot.",1)],
  cover=("Count first,\npublish second.","whocan","Before you publish")),
]
def short_cover(i,sp):
    c=CFGV;W,H=c["W"],c["H"];head,kind,title=sp["cover"]
    img=Image.new("RGB",(W,H),PD);d=qa.QA(ImageDraw.Draw(img),W,H,True)
    logo(d,72,170,80,bg=SF,fg=P);d.text((176,210),"UpGrid",font=F("Bold",42),fill=SF,anchor="lm")
    y=310
    for l in head.split("\n"): d.text((72,y),l,font=F("ExtraBold",136,True),fill=SF);y+=156
    d.rectangle((72,y+16,72+180,y+30),fill=CO)
    if kind=="notif":
        s_=1.3;wn=(W-144)/s_
        for k,j in zip(["n60","n30","n15"],range(3)): mock2(Px(d,s_,72,690+j*(152*s_+24)),k,0,0,wn)
        pill(d,72,690+3*(152*s_+24)+4,"Illustrative screen",INK,AM,F("Bold",24),20,6)
    else:
        draw_card(img,d,[kind],72,690,W-144,780,title,1.5,mock2)
    pill(d,72,1530,"Launching soon  |  Campus pilot",INK,AM,F("Bold",40),36,18)
    d.finish(f"short cover {i}");img.save(YT+f"shorts/short-{i:02d}-cover.png")
def teaser_thumb():
    W,H=1280,720;img=Image.new("RGB",(W,H),PD);d=ImageDraw.Draw(img)
    logo(d,64,56,72,bg=SF,fg=P);d.text((152,88),"UpGrid",font=F("Bold",38),fill=SF,anchor="lm")
    y=190
    for l in ["Apply by","reviewing,","not typing."]: d.text((64,y),l,font=F("ExtraBold",104,True),fill=SF);y+=120
    pill(d,64,y+30,"Launching soon",INK,AM,F("Bold",40),34,16)
    # phone
    px,py,pw,ph=840,70,330,580
    rr(d,(px,py,px+pw,py+ph),48,fill=INK);rr(d,(px+14,py+14,px+pw-14,py+ph-14),36,fill=CV)
    d.text((px+38,py+52),"Drive eligibility",font=F("Bold",26),fill=INK)
    pill(d,px+38,py+104,"Eligible",SF,OK,F("Bold",26),22,8)
    for j,(a,b) in enumerate([("Min CGPA","7.00  |  8.20"),("Backlogs","max 0  |  0")]):
        yy=py+190+j*84;d.text((px+38,yy),a,font=F("SemiBold",24),fill=INK);d.text((px+38,yy+34),b,font=F("Regular",21),fill=MU)
        d.line([(px+pw-84,yy+20),(px+pw-72,yy+34),(px+pw-48,yy+6)],fill=OK,width=6)
    rr(d,(px+30,py+380,px+pw-30,py+470),20,fill=SF,outline=BD,width=3)
    pill(d,px+46,py+400,"15 min",SF,P,F("Bold",24),18,6);d.text((px+46,py+440),"Last call: 15 minutes left",font=F("Regular",19),fill=MU)
    d.text((px+38,py+ph-70),"Illustrative screen",font=F("Regular",20),fill=MU)
    img.save(YT+"launch-teaser-thumbnail-1280x720.png")

def run(which):
    if which=="teaser":
        S,caps=teaser();tot=sum(s["dur"] for s in S);mp="/tmp/music_teaser.wav";music(mp,tot+1)
        out=YT+"launch-teaser-1920x1080.mp4";render(out,CFG16,S,caps,mp);write_srt(YT+"launch-teaser-1920x1080.srt",caps)
    elif which.startswith("short"):
        i=int(which[5:]);sp=SHORTS[i-1]
        S=short(sp["hook"],sp["content"],sp["cta"][0],sp["cta"][1],None);tot=sum(s["dur"] for s in S)
        mp=f"/tmp/music_s{i}.wav";music(mp,tot+1)
        out=YT+f"shorts/short-{i:02d}.mp4";render(out,CFGV,S,sp["caps"],mp);write_srt(YT+f"shorts/short-{i:02d}.srt",sp["caps"])
    print(which,"done")
if __name__=="__main__":
    a=sys.argv[1:]
    if a==["thumbs"]:
        teaser_thumb()
        for i,sp in enumerate(SHORTS,1): short_cover(i,sp)
    else:
        for w in a: run(w)
