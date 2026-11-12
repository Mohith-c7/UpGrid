"""Launch video (3:35) + Product demo (6:00) + thumbnails + SRT. Same engine as the teaser/Shorts (yt.py).
Usage:  python3 long_videos.py launch demo thumbs [--silent]
  --silent  renders with a silent audio track (render_silent) instead of the generated ambient bed.
"""
import sys,os;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from yt import *
from mocks_app import mock3,T,TINT,bdg
from youtube_videos import text_item,notif_items,form_items,end_item,CFG16
YT=M+"youtube/"
c=CFG16

def card_item2(kinds,title,smax=1.5,cw=820):
    top,bot=150,845;maxh=bot-top
    def fn(img,d):
        ch=card_h(kinds,cw,maxh,smax,mock3);x=c["W"]-c["mx"]-cw-20
        draw_card(img,d,kinds,x,top+(maxh-ch)//2,cw,maxh,title,smax,mock3)
    return fn
def seq(cards):
    """cards: [(delay,until|None,[kinds],title)] -> engine items"""
    return [(dl,card_item2(k,t),un) for dl,un,k,t in cards]
def title_items(sub,tagtxt):
    def title(img,d):
        W,H=c["W"],c["H"];s=150
        logo(d,(W-s)//2,230,s,bg=SF,fg=P)
        d.text((W//2,470),"UpGrid",font=F("ExtraBold",130,True),fill=SF,anchor="mm")
        d.text((W//2,590),sub,font=F("Medium",50),fill="#CFE3E0",anchor="mm")
    def tag(img,d):
        W=c["W"];f=F("Bold",44);w=d.textlength(tagtxt,font=f)+80
        rr(d,((W-w)/2,660,(W+w)/2,752),46,fill=AM);d.text((W//2,706),tagtxt,font=f,fill=INK,anchor="mm")
    return [(0.2,title),(0.9,tag)]
def honest_item():
    def fn(img,d):
        cw=820;x=c["W"]-c["mx"]-cw-20;y=240
        mock3(Px(d,1.0,x,y),"honest",0,0,cw)
    return fn
def ask_item():
    def fn(img,d):
        cw=820;x=c["W"]-c["mx"]-cw-20;y=300
        mock3(Px(d,1.0,x,y),"ask",0,0,cw)
    return fn
def offset(start,items): return [(start+a,start+b,t,1) for a,b,t in items]

# ------------------------------------------------------------------ LAUNCH (215 s = 3:35)
def launch_spec():
    S=[];caps=[];t=0
    def add(dur,bg,items,cp):
        nonlocal t
        S.append(dict(dur=dur,bg=bg,items=items));caps.extend(offset(t,cp));t+=dur
    add(12,PD,title_items("Apply by reviewing, not typing.","Launching soon  |  Campus pilot"),
        [(0.4,5.6,"Placement season. Same details, different form, every single drive."),(6.2,11.4,"I think there is a better way, and I have been building it.")])
    add(23,P,[(0.2,text_item(c,"THE PROBLEM","The same details.\nEvery drive.","CGPA, 10th and 12th percentages, backlogs, links.")),*[(dl,fn,14.0) for dl,fn,_ in form_items(c,[0.8,2.2,3.6])],(14.6,ask_item())],
        [(0.4,4.2,"If you have been through campus placements, you know the pattern."),(4.4,10.8,"You type your CGPA, 10th and 12th percentages, backlogs and links."),(11.0,14.0,"Then you do it again."),(14.8,21.6,"And somewhere in between you wonder: am I even eligible for this?")])
    add(20,PD,[(0.2,text_item(c,"HONEST START","Independent\nfounder.\nPre-launch.","No customer list. No big numbers. A product and a campus pilot in preparation.",hs=84)),(0.8,honest_item())],
        [(0.4,6.0,"I am an independent founder. There is no company behind this yet, no customer list, no big numbers to show."),(6.4,12.5,"Just a product, and a campus pilot we are preparing."),(13.0,19.0,"I would rather tell you that than make something up.")])
    add(35,P,[(0.2,text_item(c,"STEP 1","Build your\nprofile once.","Academics, links, skills, preferences and resume links.")),
        *seq([(0.8,12.3,["prof_top"],"Profile"),(12.8,22.8,["resumes"],"Resumes"),(23.3,None,["verify2"],"Field status")])],
        [(0.4,6.0,"UpGrid is a student-first app. You build your profile once."),(6.2,12.3,"A completion meter tells you what is missing and what to do next."),(13.0,22.5,"Academics, links, skills, preferences, and up to five resume links."),(23.4,33.8,"Each academic field shows whether it is unverified, self-reported, or verified by your placement officer.")])
    add(35,PD,[(0.2,text_item(c,"STEP 2","See why you're\neligible.","Required versus yours, for every criterion.")),
        *seq([(0.8,12.0,["opps"],"Opportunities"),(12.5,24.0,["drive_elig"],"Drive eligibility"),(24.5,None,["states2"],"Three clear states")])],
        [(0.4,6.2,"Then you see drives. Each one is checked against your profile."),(6.4,11.8,"The app shows the reason, not just a result."),(12.6,18.6,"Criterion by criterion: required versus yours."),(18.8,23.8,"No guessing, no silent rejection."),(24.6,34.0,"Eligible, not eligible, or pending (Check profile) when something is missing.")])
    add(35,P,[(0.2,text_item(c,"STEP 3","Review.\nOpt in.\nDone.","Prefilled from your profile. You decide.")),
        *seq([(0.8,10.5,["apply_a"],"Review and apply"),(10.8,19.8,["apply_b"],"Resume and questions"),(20.1,24.6,["apply_c"],"Confirm"),(24.9,None,["receipt2"],"After you opt in")])],
        [(0.4,5.5,"Applying is a review, not a typing session."),(5.7,10.4,"You see what will be shared and where each value came from."),(10.9,19.7,"You answer only the extra questions, and choose a resume."),(20.2,24.5,"Accept the declarations and opt in."),(25.0,30.0,"You get a reference number and a timeline."),(30.3,34.2,"Tap twice by accident and you will not apply twice.")])
    add(20,PD,[(0.2,text_item(c,"NEVER MISS IT","Reminders at\n60, 30, 15\nminutes.","Before every deadline.")),
        *notif_items(c,[0.8,1.6,2.4],until=8.4),*seq([(9.0,14.4,["rem_a"],"Reminder settings"),(14.9,None,["rem_q"],"Quiet hours")])],
        [(0.4,4.5,"And deadlines. Reminders arrive 60, 30 and 15 minutes before."),(4.7,8.3,"By push and in the app. Once you apply, they stop."),(9.2,14.2,"Switch any off. Choose push, in-app, or both."),(15.0,19.4,"Set quiet hours that suit you.")])
    add(20,P,[(0.2,text_item(c,"FOR PLACEMENT CELLS","Drive wizard.\nEligible counts.\nApplicant pipeline.",None,hs=76)),
        *seq([(0.8,5.3,["wiz_steps"],"Drive wizard"),(5.5,10.0,["whocan"],"Before you publish"),(10.2,14.7,["applicants"],"Applicant pipeline"),(14.9,None,["announce"],"Announcements")])],
        [(0.4,5.3,"For placement cells: a drive wizard with autosaved drafts and a check before publishing."),(5.5,9.9,"An eligible-student count, with reasons."),(10.2,14.7,"An applicant pipeline from submitted to joined."),(14.9,19.2,"And announcements.")])
    add(15,PD,[(0.3,end_item(c,"A student-first campus placement app","Waitlist and pilot: link in the description","Independent founder. Pre-launch.",cy=400))],
        [(0.5,5.5,"UpGrid is launching soon, starting with a campus pilot."),(5.8,10.5,"Students: join the waitlist. Placement cells: message me about a pilot."),(10.8,14.2,"Link in the description. Thanks for watching.")])
    return S,caps

# ------------------------------------------------------------------ DEMO (360 s = 6:00)
def demo_spec():
    S=[];caps=[];t=0
    def add(dur,bg,items,cp):
        nonlocal t
        S.append(dict(dur=dur,bg=bg,items=items));caps.extend(offset(t,cp));t+=dur
    add(8,PD,title_items("Product demo: student apply flow and officer drive wizard","Demo build  |  Fictional data"),
        [(0.4,7.4,"This is UpGrid, a demo build with fictional data.")])
    add(12,P,[(0.2,text_item(c,"PART A","The student.","Sign in, build a profile, find a drive, apply.")),*seq([(0.8,None,["login"],"Log in")])],
        [(0.4,5.5,"I will walk through what a student does,"),(5.7,11.2,"then what a placement officer does.")])
    add(35,PD,[(0.2,text_item(c,"STUDENT | PROFILE","Profile and\ncompletion.","Academics, contact, links, skills and preferences.")),*seq([(0.8,17.5,["prof_top"],"Profile"),(18.0,None,["verify2"],"Verification")])],
        [(0.4,6.0,"Here is the profile: academics, contact, links, skills and preferences."),(6.2,12.0,"The meter shows percentage done and the next step."),(12.2,17.3,"The checklist marks each item Done or To do."),(18.2,26.0,"Each academic field has a status: not verified yet, self-reported, or verified."),(26.2,34.0,"The placement cell checks these manually.")])
    add(20,P,[(0.2,text_item(c,"STUDENT | RESUMES","Up to five\nresume links.","Labelled, with one default.")),*seq([(0.8,None,["resumes"],"Resumes")])],
        [(0.4,9.0,"I can save up to five resume links, with labels,"),(9.2,19.0,"and mark one as default.")])
    add(40,PD,[(0.2,text_item(c,"STUDENT | DRIVES","Find the\nright drive.","Search, filter, sort and save.")),*seq([(0.8,19.5,["opps"],"Opportunities"),(20.0,None,["filters"],"Filters")])],
        [(0.4,9.5,"The Opportunities tab lists drives. I can search by company or role."),(9.7,19.3,"Saved keeps drives for later. Packages show in lakh per annum."),(20.2,29.0,"I can filter by eligibility and by status, such as open or closing soon."),(29.2,38.3,"And sort by closing first, newest or highest pay.")])
    add(30,P,[(0.2,text_item(c,"STUDENT | DRIVE DETAIL","Rules and\nreasons.","Required versus yours, for every criterion.")),*seq([(0.8,14.0,["drive_a"],"Drive details"),(14.5,None,["drive_elig"],"Your eligibility")])],
        [(0.4,7.0,"Open a drive and you see the role, rounds, requirements and deadline."),(7.2,13.8,"Compensation shows in LPA, with a live countdown."),(14.6,22.0,"The eligibility card shows what is required and what my profile says."),(22.2,29.2,"If a detail is missing, it shows Check profile instead.")])
    add(40,PD,[(0.2,text_item(c,"STUDENT | APPLY","Review, then\nopt in.","Prefilled fields. Only the missing questions.")),*seq([(0.8,13.5,["apply_a"],"Review and apply"),(14.0,26.0,["apply_b"],"Resume and questions"),(26.5,None,["apply_c"],"Confirm")])],
        [(0.4,6.5,"Tap Opt in. Before anything is sent, I see a review."),(6.7,13.3,"Each prefilled field shows its source and verification status."),(14.2,20.0,"I choose a resume. Only questions my profile cannot answer are asked."),(20.2,25.8,"Conflicts and missing details are flagged before I can submit."),(26.8,33.0,"I accept the declaration and submit."),(33.2,38.8,"Nothing is sent until I do.")])
    add(25,P,[(0.2,text_item(c,"STUDENT | AFTER APPLYING","Receipt,\ntimeline,\nreminders.",None,hs=84)),*seq([(0.8,6.8,["receipt2"],"After you opt in"),(7.1,12.9,["app_detail"],"Application"),(13.2,18.8,["rem_a"],"Reminder settings"),(19.1,None,["rem_q"],"Quiet hours")])],
        [(0.4,6.6,"I get a reference number."),(7.2,12.8,"The application has a timeline. Until screening starts, I can withdraw."),(13.4,18.7,"In Settings: reminders at 60, 30 and 15 minutes."),(19.3,24.3,"Quiet hours pause push. In-app still delivers.")])
    add(20,PD,[(0.2,text_item(c,"PART B","The placement\nofficer.","Dashboard, wizard, counts, pipeline, announcements.",hs=84)),*seq([(0.8,None,["off_dash"],"Dashboard")])],
        [(0.4,9.0,"Now the officer view. The dashboard shows open drives,"),(9.2,19.3,"drives closing today, applications today and pending verifications.")])
    add(60,P,[(0.2,text_item(c,"OFFICER | DRIVE WIZARD","Create a drive,\nstep by step.","Autosaved drafts. Nine steps.")),*seq([(0.8,14.5,["wiz_steps"],"Drive wizard"),(15.0,29.0,["wiz_elig"],"Eligibility rules"),(29.5,44.0,["wiz_q"],"Questions and rounds"),(44.5,None,["wiz_time"],"Timeline")])],
        [(0.4,7.0,"To create a drive I use the wizard: company, role, description and compensation."),(7.2,14.3,"Nine steps. It autosaves as a draft."),(15.2,28.8,"Eligibility rules: minimum CGPA, backlogs, allowed departments and batches."),(29.7,43.8,"Then custom questions and the selection rounds."),(44.7,58.8,"And the timeline: deadline, contact and a policy note.")])
    add(25,PD,[(0.2,text_item(c,"OFFICER | BEFORE PUBLISHING","Check, then\ncount.","Missing items listed. Eligible students counted.",hs=84)),*seq([(0.8,12.2,["fixlist"],"Publish check"),(12.7,None,["whocan"],"Who can apply")])],
        [(0.4,11.8,"Before publishing, a completeness check lists anything missing."),(12.9,19.0,"Who can apply: the eligible count, with reasons."),(19.2,24.3,"Blocked students are counted per rule.")])
    add(25,P,[(0.2,text_item(c,"OFFICER | PIPELINE","Move applicants\nthrough stages.","Every change is recorded.",hs=80)),*seq([(0.8,12.2,["applicants"],"Applicants"),(12.7,None,["status_sheet"],"Update status")])],
        [(0.4,6.5,"After publishing, applicants appear."),(6.7,12.0,"I filter by status and open any student."),(12.9,19.0,"Stages: screening, assessment, interview, selected, offer, joined."),(19.3,24.3,"Only allowed next steps are shown. Every change is recorded.")])
    add(12,PD,[(0.2,text_item(c,"OFFICER | ANNOUNCE","Tell students.","To everyone, or one drive's audience.")),*seq([(0.8,None,["announce"],"Announcements")])],
        [(0.4,6.5,"I can send an announcement to everyone"),(6.7,11.4,"or to one drive's participants.")])
    add(8,P,[(0.3,end_item(c,"Student apply flow. Officer drive wizard.","Waitlist and pilot: link in the description",None,cy=400))],
        [(0.4,7.4,"That is the walkthrough. Launching soon with a campus pilot. Link below.")])
    return S,caps

# ------------------------------------------------------------------ thumbnails
def phone(d,x,y,pw,ph,kind,scale_w=480,label=True):
    rr(d,(x,y,x+pw,y+ph),44,fill=INK);rr(d,(x+12,y+12,x+pw-12,y+ph-12),34,fill=CV)
    mh=mock3(ImageDraw.Draw(Image.new("RGB",(900,900))),kind,0,0,scale_w)
    s=min((pw-48)/scale_w,(ph-(80 if label else 56))/mh);mock3(Px(d,s,x+(pw-scale_w*s)/2,y+30),kind,0,0,scale_w)
    if label: d.text((x+pw/2,y+ph-30),"Illustrative screen",font=F("Regular",18),fill=MU,anchor="mm")
def thumb_launch():
    W,H=1280,720;img=Image.new("RGB",(W,H),PD);d=ImageDraw.Draw(img)
    logo(d,64,56,72,bg=SF,fg=P);d.text((152,92),"UpGrid",font=F("Bold",38),fill=SF,anchor="lm")
    y=186
    for l in ["Apply by","reviewing,","not typing."]: d.text((64,y),l,font=F("ExtraBold",108,True),fill=SF);y+=122
    pill(d,64,y+26,"Launching soon",INK,AM,F("Bold",40),34,16)
    phone(d,840,60,340,600,"apply_a")
    pill(d,770,500,"Eligible",SF,OK,F("Bold",30),26,10);pill(d,1000,440,"15 min",SF,CO,F("Bold",30),26,10)
    img.save(YT+"launch-video-thumbnail-1280x720.png")
def thumb_demo():
    W,H=1280,720;img=Image.new("RGB",(W,H),PD);d=ImageDraw.Draw(img)
    logo(d,64,48,60,bg=SF,fg=P);d.text((140,78),"UpGrid",font=F("Bold",32),fill=SF,anchor="lm")
    pill(d,W-64-330,52,"Launching soon",INK,AM,F("Bold",30),26,10)
    d.text((64,120),"Full walkthrough",font=F("ExtraBold",96,True),fill=SF);d.rectangle((64,240,64+220,250),fill=CO)
    phone(d,150,262,400,364,"drive_elig",scale_w=600,label=False);phone(d,730,262,400,364,"wiz_elig",label=False)
    d.text((W//2,698),"Illustrative screens. Fictional data.",font=F("Regular",18),fill="#CFE3E0",anchor="mm")
    # labels over the phones' lower area
    pill(d,150,638,"Student: Review and opt in",INK,AM,F("Bold",26),22,8);pill(d,730,638,"Officer: Drive wizard",INK,AM,F("Bold",26),22,8)
    img.save(YT+"product-demo-thumbnail-1280x720.png")

def build(which,silent):
    spec,out,srt,dur_=(launch_spec,"launch-video-1920x1080","launch-video-1920x1080",215) if which=="launch" else (demo_spec,"product-demo-1920x1080","product-demo-1920x1080",360)
    S,caps=spec();tot=sum(s["dur"] for s in S);assert tot==dur_,(tot,dur_)
    write_srt(YT+srt+".srt",caps)
    if silent: render_silent(YT+out+".mp4",c,S,caps)
    else:
        mp=f"/tmp/music_{which}.wav";music(mp,tot+1);render(YT+out+".mp4",c,S,caps,mp)
    print(which,"done",tot)
if __name__=="__main__":
    a=[x for x in sys.argv[1:] if not x.startswith("--")];silent="--silent" in sys.argv
    for w in a:
        if w=="thumbs": thumb_launch();thumb_demo();print("thumbs done")
        else: build(w,silent)
