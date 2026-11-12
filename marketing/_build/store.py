import sys,os;sys.path.insert(0,os.path.dirname(__file__))
from brand import *
O="/mnt/user-data/outputs/upgrid/marketing/app-store-assets/"
im=Image.new("RGB",(512,512),P);d=ImageDraw.Draw(im)
logo(d,96,96,320,bg=SF,fg=P);im.save(O+"icon-512.png")
im=Image.new("RGB",(1024,500),PD);d=ImageDraw.Draw(im)
logo(d,64,60,72,bg=SF,fg=P);d.text((152,74),"UpGrid",font=F("Bold",34),fill=SF)
y=text_block(d,(64,170),"Apply by reviewing,\nnot typing.",F("ExtraBold",64,True),SF,640,1.1)
d.text((64,y+14),"Eligibility reasons. 60/30/15-minute reminders.",font=F("Regular",26),fill="#CFE3E0")
pill(d,64,y+70,"Launching soon  |  Campus pilot",INK,AM,F("Bold",24),24,10)
# simple phone mock
rr(d,(760,70,960,470),28,fill=SF);rr(d,(776,100,944,150),12,fill=CV)
for i,(l,c) in enumerate([("Eligible",OK),("Closing in 15 min",CO),("Applied",P)]):
    yy=170+i*90;rr(d,(776,yy,944,yy+74),12,fill=CV,outline=BD,width=2);rr(d,(788,yy+14,788+int(d.textlength(l,font=F("Bold",15)))+20,yy+40),13,fill=c);d.text((798,yy+18),l,font=F("Bold",15),fill=SF)
im.save(O+"feature-graphic-1024x500.png")
