import sys,os;sys.path.insert(0,os.path.dirname(__file__))
from brand import *
def mock(d,kind,x,y,w):
    f=F("SemiBold",30);fs=F("Regular",26);fb=F("Bold",32)
    if kind=="profile":
        rr(d,(x,y,x+w,y+380),24,fill=SF,outline=BD,width=3)
        rows=[("Program","B.Tech, 2027"),("CGPA","8.20 / 10"),("Active backlogs","0"),("LinkedIn","added"),("Resumes","2 of 5")]
        for i,(a,b) in enumerate(rows):
            yy=y+28+i*68;d.text((x+36,yy),a,font=fs,fill=MU);d.text((x+w-36-d.textlength(b,font=f),yy),b,font=f,fill=INK)
            if i<4:d.line((x+36,yy+52,x+w-36,yy+52),fill=BD,width=2)
        return y+380
    if kind=="meter":
        rr(d,(x,y,x+w,y+300),24,fill=SF,outline=BD,width=3)
        d.text((x+36,y+28),"Profile completion",font=fs,fill=MU);d.text((x+36,y+68),"80%",font=F("Bold",64,True),fill=INK)
        rr(d,(x+36,y+160,x+w-36,y+184),12,fill=BD);rr(d,(x+36,y+160,x+36+int((w-72)*.8),y+184),12,fill=P)
        d.text((x+36,y+212),"Next: add your 12th percentage",font=f,fill=P);return y+300
    if kind=="verify":
        rr(d,(x,y,x+w,y+300),24,fill=SF,outline=BD,width=3)
        items=[("Verified",OK),("Student-confirmed",INK),("Unverified",WA)]
        yy=y+36
        for (l,c),fld in zip(items,["CGPA","10th percentage","Active backlogs"]):
            d.text((x+36,yy),fld,font=f,fill=INK);pill(d,x+w-36-d.textlength(l,font=fs)-44,yy-6,l,SF,c,fs,22,8);yy+=80
        return y+300
    if kind=="eligible":
        rr(d,(x,y,x+w,y+420),24,fill=SF,outline=BD,width=3)
        pill(d,x+36,y+30,"Eligible",SF,OK,f,24,8)
        rows=[("Min CGPA","7.00","8.20"),("Active backlogs","max 0","0"),("Batch","2027","2027")]
        for i,(a,b,c) in enumerate(rows):
            yy=y+120+i*90;d.text((x+36,yy),a,font=f,fill=INK);d.text((x+36,yy+40),"Required "+b+"  |  Yours "+c,font=fs,fill=MU)
            d.text((x+w-70,yy+4),"✓",font=F("Bold",40),fill=OK) if False else (d.line([(x+w-80,yy+22),(x+w-66,yy+38),(x+w-40,yy+6)],fill=OK,width=7))
        return y+420
    if kind=="states":
        yy=y
        for l,c,t in [("Eligible",OK,"You meet every rule."),("Not eligible",ER,"A rule is not met."),("Pending",WA,"A needed detail is missing.")]:
            rr(d,(x,yy,x+w,yy+110),20,fill=SF,outline=BD,width=3);pill(d,x+28,yy+26,l,SF,c,fs,22,8);d.text((x+300,yy+34),t,font=fs,fill=INK);yy+=130
        return yy
    if kind=="reminders":
        yy=y
        for t,s in [("60 min","Closing in 1 hour"),("30 min","Closing in 30 minutes"),("15 min","Last call: 15 minutes left")]:
            rr(d,(x,yy,x+w,yy+120),20,fill=SF,outline=BD,width=3);pill(d,x+28,yy+30,t,SF,P,f,22,8);d.text((x+230,yy+40),s,font=f,fill=INK);yy+=140
        return yy
    if kind=="review":
        rr(d,(x,y,x+w,y+440),24,fill=SF,outline=BD,width=3)
        d.text((x+36,y+26),"Review before you apply",font=fb,fill=INK)
        rows=[("Name","from profile"),("CGPA","verified"),("Resume","Resume (default)"),("Extra question","1 to answer")]
        for i,(a,b) in enumerate(rows):
            yy=y+100+i*74;d.text((x+36,yy),a,font=f,fill=INK);d.text((x+w-36-d.textlength(b,font=fs),yy+2),b,font=fs,fill=MU);d.line((x+36,yy+54,x+w-36,yy+54),fill=BD,width=2)
        rr(d,(x+36,y+380,x+w-36,y+430),12,fill=P) if False else None
        return y+440
    if kind=="wizard":
        yy=y;steps=["Company & role","Eligibility rules","Rounds & questions","Review & publish"]
        for i,s in enumerate(steps):
            c=P if i<2 else BD;tc=SF if i<2 else MU
            d.ellipse((x,yy,x+64,yy+64),fill=c);d.text((x+32,yy+32),str(i+1),font=f,fill=tc,anchor="mm");d.text((x+90,yy+14),s,font=f,fill=INK);yy+=96
        return yy
    if kind=="pipeline":
        stages=["Submitted","Screening","Assessment","Interview","Offer"];xx=x
        for i,s in enumerate(stages):
            ww=int(d.textlength(s,font=fs))+40
            if xx+ww>x+w:xx=x;y+=84
            pill(d,xx,y,s,SF if i<2 else INK,P if i<2 else BD,fs,20,8);xx+=ww+14
        return y+80
    if kind=="checklist":
        yy=y
        for t in ["Min CGPA","Backlogs","Batch","Department"]:
            rr(d,(x,yy,x+w,yy+90),18,fill=SF,outline=BD,width=3);rr(d,(x+28,yy+26,x+66,yy+64),8,outline=P,width=4);d.text((x+90,yy+26),t,font=f,fill=INK);yy+=106
        return yy
    return y


def mock2(d,kind,x,y,w):
    f=F("SemiBold",30);fs=F("Regular",26);fb=F("Bold",32)
    if kind in("n60","n30","n15"):
        t={"n60":"Closing in 1 hour","n30":"Closing in 30 minutes","n15":"Last call: 15 minutes left"}[kind]
        rr(d,(x,y,x+w,y+152),24,fill=SF,outline=BD,width=3)
        logo(d,x+26,y+42,68)
        d.text((x+120,y+22),"UpGrid  |  now",font=F("Regular",24),fill=MU)
        d.text((x+120,y+54),t,font=fb,fill=INK)
        d.text((x+120,y+96),"Sample drive closes 5:00 PM",font=F("Regular",24),fill=MU)
        return y+152
    if kind=="settings":
        rr(d,(x,y,x+w,y+400),24,fill=SF,outline=BD,width=3)
        d.text((x+36,y+26),"Reminders",font=fb,fill=INK)
        for i,t in enumerate(["60 minutes before","30 minutes before","15 minutes before"]):
            yy=y+96+i*70
            d.text((x+36,yy),t,font=f,fill=INK)
            rr(d,(x+w-120,yy+2,x+w-36,yy+42),20,fill=P);d.ellipse((x+w-80,yy+6,x+w-44,yy+38),fill=SF)
            d.line((x+36,yy+56,x+w-36,yy+56),fill=BD,width=2)
        d.text((x+36,y+316),"Quiet hours",font=f,fill=INK);d.text((x+36,y+354),"10 PM to 7 AM",font=fs,fill=MU)
        rr(d,(x+w-120,y+318,x+w-36,y+358),20,fill=P);d.ellipse((x+w-80,y+322,x+w-44,y+354),fill=SF)
        return y+400
    if kind=="receipt":
        rr(d,(x,y,x+w,y+430),24,fill=SF,outline=BD,width=3)
        d.ellipse((x+36,y+30,x+92,y+86),fill=OK);d.line([(x+50,y+58),(x+60,y+68),(x+79,y+45)],fill=SF,width=6)
        d.text((x+110,y+34),"Application submitted",font=fb,fill=INK)
        d.text((x+110,y+76),"Reference  PO-DEMO",font=fs,fill=MU)
        for i,(t,on) in enumerate([("Submitted",True),("Screening",False),("Assessment",False),("Interview",False)]):
            yy=y+150+i*66;c=P if on else BD
            d.ellipse((x+44,yy,x+72,yy+28),fill=c)
            if i<3:d.line((x+58,yy+30,x+58,yy+66),fill=BD,width=4)
            d.text((x+100,yy-2),t,font=f,fill=INK if on else MU)
        return y+430
    if kind=="count":
        rr(d,(x,y,x+w,y+430),24,fill=SF,outline=BD,width=3)
        d.text((x+36,y+26),"Eligible students",font=fb,fill=INK)
        d.text((x+36,y+68),"Checked before you publish",font=fs,fill=MU)
        rows=[("Meet every rule",OK,.86),("Below minimum CGPA",ER,.42),("Backlogs over limit",ER,.28),("Pending: missing data",WA,.34)]
        for i,(t,c,fr) in enumerate(rows):
            yy=y+130+i*72
            d.text((x+36,yy),t,font=F("Regular",26),fill=INK)
            rr(d,(x+36,yy+36,x+w-36,yy+50),7,fill=BD);rr(d,(x+36,yy+36,x+36+int((w-72)*fr),yy+50),7,fill=c)
        return y+430
    return mock(d,kind,x,y,w)
