import sys,os;sys.path.insert(0,os.path.dirname(__file__))
from brand import *
OUT="/mnt/user-data/outputs/upgrid/marketing/instagram/carousels/"
W,H=1080,1350
# mock kinds: eligible, reminders, review, wizard, pipeline, checklist, none
C=[
("01-build-profile-once","Build your profile once","Stop re-typing the same details for every drive.",
 "Every drive form asks for the same things: CGPA, 10th, 12th, backlogs, links. In UpGrid you fill your profile once, and your details come prefilled when you opt in. Illustrative, pre-launch: we're running a campus pilot soon. #UpGrid #CampusPlacements #PlacementPrep",
 [("cover","Build your profile once.","Then stop re-typing it for every drive.",None),
  ("body","The same form, again and again.","CGPA. 10th %. 12th %. Backlogs. LinkedIn. Resume link. Every drive asks again.",None),
  ("body","One profile. Filled once.","Academics, links, skills, role and location preferences, and up to 5 resume links, all in one place.","profile"),
  ("body","A completion meter that tells you why.","See what is still missing and the next step, so your profile is ready before a drive opens.","meter"),
  ("body","Your data stays labelled.","Each academic field shows whether it is unverified, student-confirmed or verified by your placement officer.","verify"),
  ("cta","Launching soon.","Campus pilot in progress. Join the waitlist via the link in bio.",None)]),
("02-why-eligible","Eligible or not? See the reason.","Clear reasons beat a silent rejection.",
 "Eligibility should not be a mystery. UpGrid compares your profile with each drive's rules and shows the reason for every criterion. Illustrative screens; launching soon with a campus pilot. #UpGrid #CampusDrives #StudentLife",
 [("cover","Eligible or not?\nSee the reason.","Every drive, criterion by criterion.",None),
  ("body","Drive rules are specific.","Minimum CGPA, 10th and 12th %, active backlogs, gap years, allowed departments and batches.",None),
  ("body","Your profile is checked against them.","A deterministic check, same inputs, same answer. No guesswork.","eligible"),
  ("body","Three clear states.","Eligible. Not eligible. Pending, when we are missing data we need from your profile.","states"),
  ("body","Pending? Fill the gap.","If a detail is missing, the app tells you which one, so you can complete it and re-check.",None),
  ("cta","Know where you stand.","Launching soon. Campus pilot. Link in bio for the waitlist.",None)]),
("03-never-miss-deadline","Never miss a deadline","60, 30 and 15 minutes before it closes.",
 "A drive closing at 5 PM should not surprise you at 4:58. UpGrid sends reminders 60, 30 and 15 minutes before a deadline, with quiet hours you control. Launching soon, campus pilot. #UpGrid #DeadlineReminder #CampusPlacements",
 [("cover","Never miss\na deadline.","Reminders at 60, 30 and 15 minutes.",None),
  ("body","Closing times sneak up on you.","Between classes, labs and exams, a deadline is easy to lose.",None),
  ("body","Three nudges, by default.","60 minutes, 30 minutes, 15 minutes before the drive closes. Switch any of them off.","reminders"),
  ("body","Push and in-app.","Get a push notification on your phone, plus a copy inside the app's notification list.",None),
  ("body","Quiet hours, respected.","Set a window like 10 PM to 7 AM. Reminders in that window stay in-app.",None),
  ("body","Applied? Reminders stop.","Once you have applied, you will not be nagged about that drive.",None),
  ("cta","Launching soon.","Campus pilot. Join the waitlist, link in bio.",None)]),
("04-apply-in-seconds","Review and opt in, in seconds","Prefilled data. You stay in control.",
 "Applying should mean checking, not typing. UpGrid prefills a drive's form from your profile; you review, answer any extra questions, choose a resume and opt in. Illustrative screens, launching soon with a campus pilot. #UpGrid #ApplyFaster #CampusPlacements",
 [("cover","Apply by\nreviewing, not typing.","Prefilled from your profile.",None),
  ("body","Step 1: See the preview.","Before you apply, you see exactly which details will be shared and where they came from.","review"),
  ("body","Step 2: Fix conflicts.","If something in your profile does not match, the preview flags it first.",None),
  ("body","Step 3: Answer only the extras.","Only drive-specific questions are left. Optionally save an answer back to your profile.",None),
  ("body","Step 4: Pick a resume, opt in.","Choose from your saved resume links and accept the declarations.",None),
  ("body","Step 5: Get a receipt.","A reference number, and a timeline to track your application. Tapped twice by mistake? No duplicate.",None),
  ("cta","Launching soon.","Campus pilot. Waitlist link in bio.",None)]),
("05-for-placement-officers","For placement officers","A drive wizard, eligibility counts, a pipeline.",
 "A note for placement officers and TPOs: UpGrid gives you a step-by-step drive wizard, an eligible-student count before you publish, an applicant pipeline and announcements. We are starting with a campus pilot. DM to talk. #UpGrid #PlacementCell #TPO",
 [("cover","For placement\nofficers.","Run a drive without the spreadsheet shuffle.",None),
  ("body","Create a drive with a wizard.","Step by step, autosaved as a draft. A completeness check before you publish.","wizard"),
  ("body","See the count before you publish.","How many students are eligible, and the reasons behind those who are not.",None),
  ("body","Move applicants through a pipeline.","Submitted, screening, assessment, interview, selected, offer, joined. Every change is logged.","pipeline"),
  ("body","Announce to the right audience.","Send an announcement to everyone, or to a single drive's audience.",None),
  ("body","Verify what matters.","Mark academic fields as verified, so the drive sees trusted data.",None),
  ("cta","Interested in a pilot?","Message us. We are launching soon with a campus pilot.",None)]),
("06-pre-drive-checklist","Pre-drive checklist","Six things to sort before the next drive opens.",
 "Get ready before the notification hits. Save this checklist for the week before a placement season. UpGrid is launching soon with a campus pilot. #PlacementPrep #CampusPlacements #StudentTips #UpGrid",
 [("cover","Six things to sort\nbefore a drive opens.","Save this for placement season.",None),
  ("body","1. Know your numbers.","CGPA, 10th %, 12th %, active backlogs and gap years. Keep them handy and accurate.",None),
  ("body","2. Keep one resume link ready.","A link that opens without a login. Check it on your phone.",None),
  ("body","3. Tidy your public links.","LinkedIn and GitHub should open and say what you want them to say.",None),
  ("body","4. Know your preferences.","Roles, locations, work mode, relocation. Decide before you are rushed.",None),
  ("body","5. Turn on notifications.","Deadlines move fast. Give yourself a nudge before closing time.",None),
  ("body","6. Read the eligibility rules.","Check them early, so there are no surprises on the last day.","checklist"),
  ("cta","Make it easier.","UpGrid is launching soon. Campus pilot. Waitlist in bio.",None)]),
("07-launching-soon","UpGrid: launching soon","What we are building, and where we are.",
 "UpGrid is a student-first campus placement app, built by an independent founder. No customers to show off yet, just a product we are piloting on campus soon. Follow along. #UpGrid #BuildInPublic #CampusPlacements",
 [("cover","UpGrid\nis launching soon.","A student-first campus placement app.",None),
  ("body","Why we are building it.","Placement season is stressful, repetitive and full of last-minute deadlines.",None),
  ("body","For students.","One profile, clear eligibility reasons, quick opt-in, 60/30/15-minute reminders.",None),
  ("body","For placement cells.","Drive wizard, eligibility counts, applicant pipeline, announcements.",None),
  ("body","Where we are.","Pre-launch. Android-first. Preparing a campus pilot. No fake numbers here.",None),
  ("cta","Follow along.","Waitlist and pilot enquiries: link in bio.",None)]),
]

import qa
from mocks_app import mock3
from yt import Px
MAP={"eligible":["drive_elig"],"states":["states2"],"verify":["verify2"],"profile":["prof_top"],"meter":["prof_top"],"reminders":["n60","n30","n15"],"review":["apply_a"],"wizard":["wiz_steps"],"pipeline":["applicants"],"checklist":["checklist"]}
def mock(d,kind,x,y,w,ymax):
    kinds=MAP.get(kind,[kind]);scratch=ImageDraw.Draw(Image.new("RGB",(1200,1600)))
    gap=20
    for s in (1.6,1.4,1.2,1.0,0.9,0.8,0.7):
        wn=w/s;hs=[mock3(scratch,k,0,0,wn) for k in kinds];tot=sum(hs)+gap*(len(kinds)-1)
        if tot*s<=ymax-y: break
    yy=y
    for k,h in zip(kinds,hs): mock3(Px(d,s,x,yy),k,0,0,wn);yy+=(h+gap)*s
    return yy

def slide(c,i,n,s):
    kind,h,b,m=s
    d_img=Image.new("RGB",(W,H),PD if kind in("cover","cta") else CV)
    d=qa.QA(ImageDraw.Draw(d_img),W,H);dark=kind in("cover","cta")
    fg=SF if dark else INK;sub="#CFE3E0" if dark else MU
    logo(d,72,64,64,bg=SF if dark else P,fg=P if dark else SF)
    d.text((152,78),"UpGrid",font=F("Bold",34),fill=fg)
    pg=f"{i+1}/{n}";d.text((W-72-d.textlength(pg,font=F("SemiBold",30)),80),pg,font=F("SemiBold",30),fill=sub)
    if kind=="cover":
        y=text_block(d,(72,300),h,F("ExtraBold",92,True),SF,W-144,1.08)
        text_block(d,(72,y+30),b,F("Regular",44),"#CFE3E0",W-200,1.3)
        pill(d,72,H-170,"Swipe  >",INK,AM,F("Bold",34),32,14)
    elif kind=="cta":
        y=text_block(d,(72,380),h,F("ExtraBold",96,True),SF,W-144,1.08)
        y=text_block(d,(72,y+30),b,F("Regular",46),"#CFE3E0",W-144,1.3)
        pill(d,72,y+50,"Launching soon  |  Campus pilot",INK,AM,F("Bold",34),32,16)
    else:
        d.rectangle((72,190,72+120,190+10),fill=CO)
        y=text_block(d,(72,240),h,F("ExtraBold",70,True),INK,W-144,1.12)
        y=text_block(d,(72,y+24),b,F("Regular",40),MU,W-144,1.35)
        if m:
            ye=mock(d,m,72,y+40,W-144,H-200)
            d.text((72,H-168),"Illustrative screen. Fictional data. Pre-launch.",font=F("Regular",24),fill=MU)
    ft="Launching soon  |  Campus pilot"
    d.text((72,H-104) if not dark else (W-72-d.textlength(ft,font=F("Medium",26)),H-104),ft,font=F("Medium",26),fill=sub)
    d.finish(f"carousel {c[0]} slide {i+1}");d_img.save(OUT+c[0]+f"/slide-{i+1:02d}.png")

md=["# Instagram carousels (7)\n\nAll slides rendered at 1080x1350 in `carousels/<slug>/slide-NN.png`. Mock UI panels are labelled illustrative and use no real data. Add `Launching soon / campus pilot` context in captions. No metrics, testimonials or integrations are claimed.\n"]
for c in C:
    os.makedirs(OUT+c[0],exist_ok=True)
    n=len(c[4])
    md.append(f"\n## {c[0]}: {c[1]}\n\nGoal: {c[2]}\n\n")
    for i,s in enumerate(c[4]):
        slide(c,i,n,s)
        md.append(f"**Slide {i+1} ({s[0]})**  \nHeadline: {s[1].replace(chr(10),' ')}  \nBody: {s[2]}  \n"+(f"Visual: illustrative mock panel ({s[3]})  \n" if s[3] else "")+"\n")
    md.append(f"**Caption:** {c[3]}\n\n---\n")
open(OUT+"carousels.md","w").write("".join(md))

for m_ in qa.ISSUES: print('QA',m_)
