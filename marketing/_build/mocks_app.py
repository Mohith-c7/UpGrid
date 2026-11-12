"""Illustrative mock panels that mirror the real app's screens (labels taken from app/app/(student) and app/app/(officer)).
All data is fictional. Every function: mock3(d, kind, x, y, w) -> y_end. Unknown kinds fall back to mocks.mock2."""
import sys,os;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from brand import *
from mocks import mock2

TINT={"success":("#E3F4EC",OK),"warning":("#FBF0DC",WA),"error":("#F9E3E1",ER),"info":("#E4EEF8","#2A5E94"),"neutral":("#EEF1F3",MU)}
f30=lambda:F("SemiBold",30); fT=lambda:F("Bold",34); fB=lambda:F("Regular",26); fM=lambda:F("Regular",22); fS=lambda:F("Regular",20)

def chk(d,s,font,maxw):
    w=d.textlength(s,font=font)
    assert w<=maxw+0.5,f"text too wide ({w:.0f}>{maxw:.0f}): {s}"
def T(d,x,y,s,font,fill=INK,maxw=None,anchor=None):
    if maxw is not None: chk(d,s,font,maxw)
    d.text((x,y),s,font=font,fill=fill,anchor=anchor)
def para(d,x,y,s,font,fill,maxw,lh=1.3):
    for l in wrap(d,s,font,maxw): d.text((x,y),l,font=font,fill=fill);y+=font.size*lh
    return y
def panel(d,x,y,w,h): rr(d,(x,y,x+w,y+h),24,fill=SF,outline=BD,width=3)
def sub(d,x,y,w,h,fill=SF): rr(d,(x,y,x+w,y+h),16,fill=fill,outline=BD,width=2)
def bdg(d,xr,y,label,tone,font=None):
    font=font or F("SemiBold",20);bg,fg=TINT[tone];tw=d.textlength(label,font=font);w=tw+32;h=font.size+20
    rr(d,(xr-w,y,xr,y+h),6,fill=bg);d.text((xr-w+16,y+8),label,font=font,fill=fg);return w
def btn(d,x,y,w,label,kind="primary",h=58):
    if kind=="primary": rr(d,(x,y,x+w,y+h),14,fill=P);c=SF
    elif kind=="secondary": rr(d,(x,y,x+w,y+h),14,fill=SF,outline=P,width=3);c=P
    elif kind=="danger": rr(d,(x,y,x+w,y+h),14,fill=SF,outline=ER,width=3);c=ER
    else: c=P
    fb=F("SemiBold",26 if h>=50 else 22);chk(d,label,fb,w-24);d.text((x+w/2,y+h/2),label,font=fb,fill=c,anchor="mm");return y+h
def chip(d,x,y,label,sel=False,font=None):
    font=font or F("Medium",22);tw=d.textlength(label,font=font);w=tw+34
    rr(d,(x,y,x+w,y+44),22,fill=P if sel else SF,outline=P if sel else BD,width=2)
    d.text((x+17,y+9),label,font=font,fill=SF if sel else INK);return w
def flow(d,x,y,maxx,labels,sel=()):
    cx=x
    for l in labels:
        w=d.textlength(l,font=F("Medium",22))+34
        if cx+w>maxx: cx=x;y+=54
        chip(d,cx,y,l,l in sel);cx+=w+10
    return y+44
def field(d,x,y,w,label,value,ph=False,h=54):
    T(d,x,y,label,fM(),MU,w);rr(d,(x,y+30,x+w,y+30+h),12,fill=SF,outline=BD,width=2)
    T(d,x+16,y+30+h/2,value,fB(),MU if ph else INK,w-32,anchor="lm");return y+30+h
def switch(d,x,y,w,title,on=True,subt=None):
    fo=F("Regular",25);lines=wrap(d,title,fo,w-100);yy=y
    for l in lines: d.text((x,yy),l,font=fo,fill=INK);yy+=32
    if subt:
        for l in wrap(d,subt,fS(),w-100): d.text((x,yy),l,font=fS(),fill=MU);yy+=26
    cy=y+14;rr(d,(x+w-80,cy-4,x+w,cy+32),18,fill=P if on else BD)
    r=14;cx=x+w-22 if on else x+w-58;d.ellipse((cx-r,cy+14-r,cx+r,cy+14+r),fill=SF)
    return max(yy-y,46)
def sect(d,x,y,title): T(d,x,y,title,F("Bold",26),INK);return y+40
def logoc(d,x,y,name,s=52):
    rr(d,(x,y,x+s,y+s),8,fill="#DCEBE9");d.text((x+s/2,y+s/2),name,font=F("Bold",int(s*.42)),fill=PD,anchor="mm")
def tick(d,x,y,c=OK,s=1.0): d.line([(x,y+12*s),(x+9*s,y+22*s),(x+26*s,y)],fill=c,width=6)
def hdr(d,x,y,w,title,subt=None):
    T(d,x,y,title,fT(),INK,w)
    if subt: T(d,x,y+42,subt,fM(),MU,w)
    return y+(78 if subt else 56)

def mock3(d,kind,x,y,w):
    p=36;iw=w-2*p
    if kind=="login":
        h=450;panel(d,x,y,w,h);yy=hdr(d,x+p,y+30,iw,"Log in")
        yy=field(d,x+p,yy+8,iw,"Email","name@example.com");yy=field(d,x+p,yy+14,iw,"Password","••••••••")
        yy=btn(d,x+p,yy+30,iw,"Log in");T(d,x+w/2,yy+30,"New here? Create an account",F("SemiBold",24),P,iw,anchor="mm");return y+h
    if kind=="prof_top":
        h=470;panel(d,x,y,w,h);yy=y+28
        logoc(d,x+p,yy,"DS",64);T(d,x+p+84,yy+2,"Demo Student",F("Bold",32),INK,iw-84);T(d,x+p+84,yy+40,"name@example.com",fM(),MU,iw-84);yy+=88
        d.line((x+p,yy,x+w-p,yy),fill=BD,width=2);yy+=16
        T(d,x+p,yy,"Profile completion",f30(),INK);T(d,x+w-p,yy,"80%",f30(),INK,anchor="ra")
        rr(d,(x+p,yy+46,x+w-p,yy+62),8,fill=BD);rr(d,(x+p,yy+46,x+p+int(iw*.8),yy+62),8,fill=P)
        T(d,x+p,yy+74,"Next: add your 12th percentage",fM(),MU,iw);yy+=122
        yy=sect(d,x+p,yy,"Checklist")
        for t,done in [("Academics",True),("Links",True),("Resume links",False)]:
            sub(d,x+p,yy,iw,52);T(d,x+p+16,yy+12,t,F("Regular",24),INK,iw-170)
            bdg(d,x+w-p-12,yy+9,"Done" if done else "To do","success" if done else "warning");yy+=60
        return y+h
    if kind=="verify2":
        h=500;panel(d,x,y,w,h);yy=sect(d,x+p,y+28,"Verification")
        for lab,val,b,tone in [("CGPA","8.20 / 10","Verified by placement cell","success"),("10th percentage","86%","Self-reported","info"),("Active backlogs","0","Not verified yet","warning")]:
            T(d,x+p,yy,lab,fM(),MU);T(d,x+p,yy+26,val,F("Regular",28),INK);bdg(d,x+p+d.textlength(b,font=F("SemiBold",20))+28,yy+64,b,tone);yy+=114
        para(d,x+p,yy-6,"The placement cell checks these manually; nothing is pulled from a university system.",fS(),MU,iw,1.3)
        return y+h
    if kind=="resumes":
        h=545;panel(d,x,y,w,h);yy=hdr(d,x+p,y+26,iw,"Resumes");yy=sect(d,x+p,yy-6,"Saved (2/5)")
        for lab,url,dflt in [("Software roles","example.com/resume-a",True),("General","example.com/resume-b",False)]:
            sub(d,x+p,yy,iw,128);T(d,x+p+16,yy+12,lab,f30(),INK,iw-140)
            if dflt: bdg(d,x+w-p-12,yy+14,"Default","success")
            T(d,x+p+16,yy+50,url,fM(),MU,iw-32)
            if not dflt: btn(d,x+p+16,yy+78,190,"Make default","secondary",40);btn(d,x+p+222,yy+78,120,"Delete","danger",40)
            yy+=140
        yy=sect(d,x+p,yy+4,"Add a resume link");field(d,x+p,yy-6,iw,"Label","For example: Software roles",True,48)
        return y+h
    if kind=="opps":
        h=560;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Opportunities")
        yy=field(d,x+p,yy-8,iw,"Search","Company or role",True,48)
        yy=flow(d,x+p,yy+12,x+w-p,["Filters","Saved","Closing first","Newest","Highest pay"],("Closing first",))
        yy+=16
        for nm,role,badge,tone,meta in [("Sample Company A","Sample role","Eligible","success","₹6 LPA  |  Closes in 38 min"),("Sample Company B","Sample role","Check profile","warning","₹5 LPA  |  2h 14m left")]:
            sub(d,x+p,yy,iw,112);logoc(d,x+p+14,yy+14,nm[-1]+"" if False else "SC",48);T(d,x+p+76,yy+10,nm,F("SemiBold",25),INK,iw-90);T(d,x+p+76,yy+42,role,fM(),MU,iw-250)
            bdg(d,x+w-p-12,yy+40,badge,tone);T(d,x+p+14,yy+72,meta,fS(),INK,iw-28);yy+=122
        return y+h
    if kind=="filters":
        h=520;panel(d,x,y,w,h);yy=hdr(d,x+p,y+26,iw,"Filters")
        for g,opts,s in [("Eligibility",["Any","Eligible","Check profile","Not eligible"],"Eligible"),("Status",["Any status","Open","Closing soon","Closed"],"Closing soon"),("Work mode",["Any","Remote","Hybrid","On-site"],"Any")]:
            yy=sect(d,x+p,yy-4,g);yy=flow(d,x+p,yy-6,x+w-p,opts,(s,))+18
        btn(d,x+p,yy+4,(iw-16)/2,"Reset","secondary",52);btn(d,x+p+(iw+16)/2,yy+4,(iw-16)/2,"Done","primary",52);return y+h
    if kind=="drive_a":
        h=500;panel(d,x,y,w,h);logoc(d,x+p,y+28,"SC",60);T(d,x+p+78,y+28,"Sample Company A",F("Bold",30),INK,iw-78);T(d,x+p+78,y+66,"Sample role",fM(),MU,iw-78)
        yy=sect(d,x+p,y+112,"Compensation");sub(d,x+p,yy,iw,56);T(d,x+p+16,yy+14,"CTC",F("Regular",24),MU);T(d,x+w-p-16,yy+14,"₹6 LPA",F("SemiBold",24),INK,anchor="ra");yy+=78
        yy=sect(d,x+p,yy,"Deadline");sub(d,x+p,yy,iw,84);T(d,x+p+16,yy+10,"Closes in 38 min",F("SemiBold",28),WA,iw-32);T(d,x+p+16,yy+50,"Deadline 5:00 PM IST",fM(),MU,iw-32);yy+=106
        yy=sect(d,x+p,yy,"Selection rounds");T(d,x+p,yy-8,"1. Online assessment",fB(),INK,iw);T(d,x+p,yy+24,"2. Interview",fB(),INK,iw);return y+h
    if kind=="drive_elig":
        h=500;panel(d,x,y,w,h);T(d,x+p,y+28,"Your eligibility",F("Bold",30),INK);bdg(d,x+w-p,y+30,"Eligible","success",F("SemiBold",22))
        yy=y+86;cx=[x+p,x+p+iw*.40,x+p+iw*.70]
        for c,t in zip(cx,["Criterion","Required","Yours"]): T(d,c,yy,t,fM(),MU)
        yy+=34;d.line((x+p,yy,x+w-p,yy),fill=BD,width=2);yy+=12
        for a,b,c in [("Min CGPA","7.00","8.20"),("Active backlogs","max 0","0"),("Batch","2027","2027")]:
            T(d,cx[0],yy+8,a,F("Regular",24),INK,iw*.38);T(d,cx[1],yy+8,b,F("Regular",24),INK,iw*.28);T(d,cx[2],yy+8,c,F("Regular",24),INK,iw*.2);tick(d,x+w-p-24,yy+8,OK,.8)
            yy+=56;d.line((x+p,yy-8,x+w-p,yy-8),fill=BD,width=2)
        T(d,x+p,yy+6,"Every rule is met.",fM(),MU);btn(d,x+p,yy+50,iw,"Opt in  →");return y+h
    if kind=="states2":
        yy=y
        for l,tone,t in [("Eligible","success","You meet every rule."),("Not eligible","error","A rule is not met."),("Check profile","warning","A needed detail is missing.")]:
            panel(d,x,yy,w,118);bdg(d,x+p+d.textlength(l,font=F("SemiBold",24))+28,yy+22,l,tone,F("SemiBold",24));T(d,x+p,yy+68,t,F("Regular",26),INK,iw);yy+=138
        return yy-20
    if kind=="apply_a":
        h=630;panel(d,x,y,w,h);yy=hdr(d,x+p,y+32,iw,"Review and apply","Sample Company A · Sample role")
        sub(d,x+p,yy,iw,72);T(d,x+p+16,yy+8,"Closes in 38 min",F("SemiBold",26),WA,iw-32);T(d,x+p+16,yy+42,"Deadline 5:00 PM IST",fS(),MU);yy+=88
        yy=sect(d,x+p,yy,"Details we will send");yy=para(d,x+p,yy-8,"Filled from your profile. Edit them in Profile, not here.",fS(),MU,iw,1.25)+6
        for lab,val,b,tone in [("CGPA","8.20","Verified","success"),("Active backlogs","0","Self-confirmed","info")]:
            sub(d,x+p,yy,iw,140);T(d,x+p+14,yy+8,lab,fM(),MU,iw-200);bdg(d,x+w-p-12,yy+8,b,tone);T(d,x+p+14,yy+38,val,F("Regular",26),INK)
            T(d,x+p+14,yy+70,"Source: profile",fS(),MU);T(d,x+p+14,yy+96,"Shared with Sample Company A",fS(),MU,iw-28);yy+=150
        return y+h
    if kind=="apply_b":
        h=520;panel(d,x,y,w,h);yy=sect(d,x+p,y+26,"Resume")
        for lab,hlp,on in [("Software roles","Default",True),("General",None,False)]:
            cy=yy+22;d.ellipse((x+p,cy-13,x+p+26,cy+13),outline=P if on else MU,width=3)
            if on: d.ellipse((x+p+6,cy-7,x+p+20,cy+7),fill=P)
            T(d,x+p+42,yy+4,lab,F("Regular",26),INK,iw-160)
            if hlp: T(d,x+p+42,yy+34,hlp,fS(),MU)
            yy+=70
        yy=sect(d,x+p,yy+10,"Questions from the company")
        yy=field(d,x+p,yy-2,iw,"Preferred work location *","Type your answer",True,56)
        para(d,x+p,yy+20,"Also save this answer to my profile for next time",fS(),MU,iw-100,1.25)
        cy=yy+28;rr(d,(x+w-p-64,cy-4,x+w-p,cy+28),16,fill=BD);d.ellipse((x+w-p-62,cy-2,x+w-p-34,cy+26),fill=SF)
        para(d,x+p,yy+90,"Only what your profile cannot answer is asked.",fS(),P,iw,1.25);return y+h
    if kind=="apply_c":
        h=330;panel(d,x,y,w,h);yy=sect(d,x+p,y+26,"Confirm")
        rr(d,(x+p,yy+2,x+p+34,yy+36),8,fill=P);d.line([(x+p+7,yy+19),(x+p+15,yy+28),(x+p+28,yy+10)],fill=SF,width=5)
        para(d,x+p+50,yy,"I confirm these details are accurate and I agree to share them with Sample Company A.",F("Regular",24),INK,iw-50,1.3)
        btn(d,x+p,y+h-96,iw,"Submit application  ➤" if False else "Submit application");return y+h
    if kind=="receipt2":
        h=520;panel(d,x,y,w,h);d.ellipse((x+w/2-34,y+28,x+w/2+34,y+96),fill="#E3F4EC");d.line([(x+w/2-16,y+62),(x+w/2-4,y+75),(x+w/2+18,y+48)],fill=OK,width=7)
        T(d,x+w/2,y+130,"Application submitted",F("Bold",34),INK,iw,anchor="mm")
        yy=para(d,x+p,y+166,"Keep your reference number. You will see updates from the placement cell in Applications.",fM(),MU,iw,1.3)+10
        sub(d,x+p,yy,iw,130)
        for i,(a,b) in enumerate([("Reference","PO-DEMO"),("Company","Sample Company A"),("Role","Sample role")]):
            T(d,x+p+16,yy+10+i*40,a,fM(),MU);T(d,x+w-p-16,yy+8+i*40,b,F("SemiBold",24),INK,iw-150,anchor="ra")
        yy+=144;btn(d,x+p,yy,iw,"View application","primary",52);btn(d,x+p,yy+62,iw,"Back to opportunities","secondary",52);return y+h
    if kind=="app_detail":
        h=530;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Application");logoc(d,x+p,yy,"SC",52);T(d,x+p+66,yy+2,"Sample Company A",f30(),INK,iw-66);T(d,x+p+66,yy+34,"Sample role",fM(),MU);yy+=68
        bdg(d,x+p+110,yy,"Submitted","info");T(d,x+p+130,yy+4,"Placement cell",fM(),MU);yy+=52
        sub(d,x+p,yy,iw,128);T(d,x+p+16,yy+10,"What happens next",F("Bold",24),INK)
        para(d,x+p+16,yy+44,"Wait for screening. You can withdraw until the placement cell starts screening.",fS(),MU,iw-32,1.3);yy+=144
        sub(d,x+p,yy,iw,64);d.ellipse((x+p+18,yy+22,x+p+38,yy+42),fill=P);T(d,x+p+56,yy+16,"Submitted",F("SemiBold",24),INK);T(d,x+w-p-16,yy+19,"you",fM(),MU,anchor="ra");yy+=80
        btn(d,x+p,yy,iw,"Withdraw application","danger",52);return y+h
    if kind=="rem_a":
        h=540;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Reminders");yy=sect(d,x+p,yy-4,"When")
        for t in ["60 minutes before","30 minutes before","15 minutes before"]: switch(d,x+p,yy,iw,t,True);yy+=50;d.line((x+p,yy-8,x+w-p,yy-8),fill=BD,width=2)
        yy=sect(d,x+p,yy+8,"How");switch(d,x+p,yy,iw,"Push notifications",True,"Alerts on this phone");yy+=70;switch(d,x+p,yy,iw,"In-app notifications",True,"Listed under Notifications");yy+=70
        return y+h
    if kind=="rem_q":
        h=470;panel(d,x,y,w,h);yy=sect(d,x+p,y+26,"Quiet hours");yy+=switch(d,x+p,yy,iw,"Pause push during quiet hours",True,"In-app reminders are still delivered")+22
        hw=(iw-16)/2;field(d,x+p,yy,hw,"Start (HH:mm)","22:00");field(d,x+p+hw+16,yy,hw,"End (HH:mm)","07:00");yy+=100
        para(d,x+p,yy,"Times are in India Standard Time. A window like 22:00 to 07:00 runs overnight.",fS(),MU,iw,1.3);btn(d,x+p,y+h-78,iw,"Save quiet hours","primary",52);return y+h
    if kind=="off_dash":
        h=540;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Dashboard");gw=(iw-16)/2
        for i,(n,l) in enumerate([("2","Open drives"),("1","Closing today"),("5","Applications today"),("3","Pending verifications")]):
            cx=x+p+(i%2)*(gw+16);cy=yy+(i//2)*124;sub(d,cx,cy,gw,112);T(d,cx+16,cy+8,n,F("Bold",46,True),INK);para(d,cx+16,cy+66,l,fS(),MU,gw-24,1.1)
        yy+=256;btn(d,x+p,yy,iw,"+  Create drive","primary",54);yy=sect(d,x+p,yy+70,"Upcoming deadlines")
        sub(d,x+p,yy-4,iw,80);T(d,x+p+16,yy+4,"Sample Company A",F("SemiBold",24),INK,iw-170);T(d,x+p+16,yy+38,"Sample role",fS(),MU);bdg(d,x+w-p-12,yy+8,"Published","success");return y+h
    if kind=="wiz_steps":
        h=560;panel(d,x,y,w,h);T(d,x+p,y+22,"Sample Company A",F("Bold",30),INK,iw);T(d,x+p,y+60,"Draft saved",F("SemiBold",22),OK)
        yy=y+104
        for i,s in enumerate(["Company","Role","Description","Compensation","Eligibility","Questions","Rounds","Timeline","Review"]):
            done=i<4;cur=i==4
            d.ellipse((x+p,yy,x+p+34,yy+34),fill=P if (done or cur) else BD)
            if done: d.line([(x+p+9,yy+18),(x+p+15,yy+24),(x+p+26,yy+10)],fill=SF,width=4)
            else: d.text((x+p+17,yy+17),str(i+1),font=F("SemiBold",19),fill=SF if cur else MU,anchor="mm")
            T(d,x+p+52,yy+3,s,F("SemiBold",26) if cur else F("Regular",26),INK if (done or cur) else MU);
            if cur: T(d,x+w-p,yy+6,"Step 5 of 9",fS(),P,anchor="ra")
            yy+=46
        return y+h
    if kind=="wiz_elig":
        h=560;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Eligibility")
        yy=field(d,x+p,yy-8,iw,"Minimum CGPA (0–10)","7.00",False,46)+8
        yy=field(d,x+p,yy,iw,"Max active backlogs (0–50)","0",False,46)+8
        T(d,x+p,yy,"Allowed departments",fM(),MU);yy=flow(d,x+p,yy+30,x+w-p,["CSE","IT","ECE"],("CSE","IT"))+10
        T(d,x+p,yy,"Batch",fM(),MU);flow(d,x+p,yy+30,x+w-p,["2026","2027","2028"],("2027",));return y+h
    if kind=="wiz_q":
        h=560;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Questions and rounds");sub(d,x+p,yy-8,iw,196)
        field(d,x+p+14,yy-2,iw-28,"Question text *","Preferred work location",False,46);switch(d,x+p+14,yy+90,iw-28,"Required",True)
        T(d,x+p+14,yy+134,"Up",F("SemiBold",24),P);T(d,x+p+84,yy+134,"Down",F("SemiBold",24),P);T(d,x+p+190,yy+134,"Remove",F("SemiBold",24),P)
        yy+=206;btn(d,x+p,yy,iw,"+  Add question","secondary",48);yy+=66
        sub(d,x+p,yy,iw,84);T(d,x+p+14,yy+8,"Round 1",fM(),MU);T(d,x+p+14,yy+38,"Online assessment",F("SemiBold",26),INK,iw-28);yy+=96;btn(d,x+p,yy,iw,"+  Add round","secondary",48);return y+h
    if kind=="wiz_time":
        h=480;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Timeline");hw=(iw-16)/2
        T(d,x+p,yy-6,"Application deadline *",fM(),MU);field(d,x+p,yy+18,hw*1.3,"Date (DD/MM/YYYY)","15/01/2027",False,46);field(d,x+p+hw*1.3+14,yy+18,iw-hw*1.3-14,"Time (24h)","17:00",False,46)
        yy+=124;flow(d,x+p,yy,x+w-p,["Tomorrow 5 PM","In 3 days","In 7 days"]);yy+=62
        yy=field(d,x+p,yy+8,iw,"Contact email","contact@example.com",False,46);T(d,x+p,yy+22,"Draft saved",F("SemiBold",22),OK);return y+h
    if kind=="fixlist":
        h=500;panel(d,x,y,w,h);T(d,x+p,y+26,"Fix before publishing",F("Bold",30),ER,iw)
        T(d,x+p,y+80,"Description",F("Regular",26),INK);para(d,x+p,y+114,"• Job description needs at least 50 characters",fS(),ER,iw,1.2)
        T(d,x+p,y+150,"Go to Description",F("SemiBold",24),P)
        d.line((x+p,y+198,x+w-p,y+198),fill=BD,width=2)
        T(d,x+p,y+222,"Sample Company A — Sample role",F("SemiBold",24),INK,iw);T(d,x+p,y+262,"₹6 LPA",fM(),MU);T(d,x+p,y+296,"Deadline: 15 Jan 2027, 5:00 PM IST",fM(),MU,iw)
        T(d,x+p,y+332,"1 custom question(s) · 1 round(s)",fM(),MU,iw);T(d,x+p,y+380,"Edit details",F("SemiBold",24),P);return y+h
    if kind=="whocan":
        h=520;panel(d,x,y,w,h);T(d,x+p,y+26,"Who can apply",F("Bold",30),INK)
        T(d,x+p,y+76,"12 eligible students",F("Bold",34),INK,iw);T(d,x+p,y+122,"5 pending (missing data) · 7 not eligible",fM(),MU,iw)
        for i,t in enumerate(["Minimum CGPA: 4 students blocked","Active backlogs: 3 students blocked"]): T(d,x+p,y+164+i*34,t,fM(),INK,iw)
        T(d,x+p,y+244,"Refresh count",F("SemiBold",24),P)
        btn(d,x+p,y+300,iw,"Preview as student","secondary",56);btn(d,x+p,y+372,iw,"Publish drive","primary",56);return y+h
    if kind=="applicants":
        h=540;panel(d,x,y,w,h);yy=sect(d,x+p,y+26,"Applicants");yy=flow(d,x+p,yy-4,x+w-p,["All","Submitted","Screening","Assessment"],("All",))+14
        for nm,meta,st,tone in [("Student A","CSE  |  2027","Submitted","info"),("Student B","IT  |  2027","Screening","info"),("Student C","ECE  |  2027","Interview","info")]:
            sub(d,x+p,yy,iw,116);T(d,x+p+14,yy+8,nm,F("SemiBold",26),INK,iw-170);T(d,x+p+14,yy+40,meta,fS(),MU);bdg(d,x+w-p-12,yy+10,st,tone)
            T(d,x+p+14,yy+72,"Student",F("SemiBold",22),P);btn(d,x+w-p-12-212,yy+62,212,"Update status","secondary",44);yy+=126
        return y+h
    if kind=="status_sheet":
        h=470;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"Update Student A");para(d,x+p,yy-6,"Current: Submitted. Only allowed next steps are shown.",fM(),MU,iw,1.3)
        yy+=60;yy=field(d,x+p,yy,iw,"Note (optional)","Add a note",True,56)+16
        btn(d,x+p,yy,iw,"Move to Screening","primary",54);btn(d,x+p,yy+66,iw,"Move to Rejected","danger",54);return y+h
    if kind=="announce":
        h=520;panel(d,x,y,w,h);yy=hdr(d,x+p,y+24,iw,"New announcement");yy=sect(d,x+p,yy-6,"Audience")
        yy=flow(d,x+p,yy-6,x+w-p,["All students","Sample Company A participants"],("All students",))+14
        yy=field(d,x+p,yy,iw,"Title","Assessment schedule",False,48)+10
        T(d,x+p,yy,"Message",fM(),MU);rr(d,(x+p,yy+30,x+w-p,yy+114),12,fill=SF,outline=BD,width=2);T(d,x+p+16,yy+44,"Sample message text",fB(),INK,iw-32);T(d,x+p,yy+120,"19/1000",fS(),MU)
        btn(d,x+p,yy+150,iw,"Send announcement","primary",54);return y+h
    if kind=="honest":
        h=470;panel(d,x,y,w,h);T(d,x+p,y+28,"Where things stand",F("Bold",32),INK,iw);yy=y+92
        for a,b,tone in [("Product","Demo build","success"),("Campus pilot","Preparing","warning"),("Customers","None yet","neutral"),("Big numbers","None to show","neutral")]:
            sub(d,x+p,yy,iw,68);T(d,x+p+18,yy+18,a,F("Regular",26),INK,iw-250);bdg(d,x+w-p-14,yy+16,b,tone,F("SemiBold",22));yy+=82
        return y+h
    if kind=="ask":
        h=300;panel(d,x,y,w,h);T(d,x+w/2,y+70,"Am I even",F("ExtraBold",64,True),INK,iw,anchor="mm");T(d,x+w/2,y+150,"eligible?",F("ExtraBold",64,True),P,iw,anchor="mm")
        d.rectangle((x+w/2-70,y+212,x+w/2+70,y+222),fill=CO);return y+h
    return mock2(d,kind,x,y,w)
