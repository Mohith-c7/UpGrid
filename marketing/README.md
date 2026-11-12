# Placement OS marketing pack (pre-launch)

Visual style (flat and professional): solid brand-colour backgrounds, no decorative circles or blobs, 10px card corners, 6px badge/button corners, no shadows or glows. Motion: plain cross-fades of 0.3 s or less only (no slide, zoom, pop, bounce). Safe margins: 48px from every frame edge; on 9:16 at least 160px from the top and 250px from the bottom for platform UI.

Tone everywhere: "Launching soon | Campus pilot". Original brand only (teal, coral, amber, Inter). No stock, no third-party brand assets, no stats, testimonials or university names. Mock panels are labelled "Illustrative screen" and "Fictional data".

## Deliverables

| Path | What | Length / size |
|---|---|---|
| `promo-reel.mp4`, `promo-cover.png` | 30 s Instagram/promo reel + cover | 30 s |
| `youtube/launch-teaser-1920x1080.mp4` (+ `.srt`, `-thumbnail-1280x720.png`) | teaser | 1:03 |
| `youtube/launch-video-1920x1080.mp4` (+ `.srt`, `launch-video-thumbnail-1280x720.png`) | full launch video, follows `launch-video-script.md` | 3:35 |
| `youtube/product-demo-1920x1080.mp4` (+ `.srt`, `product-demo-thumbnail-1280x720.png`) | student apply flow + officer drive wizard, follows `product-demo-script.md` | 6:00 |
| `youtube/shorts/short-01..05.mp4` (+ `.srt`, `-cover.png`) | five Shorts, 1080x1920 | 19.5 to 24 s |
| `youtube/*-script.md`, `shorts-scripts.md` | scripts (VO, visuals) | |
| `youtube/youtube-metadata.md` | titles, descriptions, chapters, tags (timestamps match the renders) | |
| `instagram/`, `app-store-assets/` | carousels and store art | |
| `brand-and-positioning.md`, `launch-plan.md` | positioning and plan | |

All videos: h264 yuv420p, +faststart, `-preset veryfast`, 30 fps, burned-in captions (SRT files provided for YouTube subtitle upload), quiet generated ambient bed. Motion is fade and slide only (no bounce or spring).

## How to re-render

Requires Python 3 with Pillow and numpy, ffmpeg, and the Inter fonts in `/usr/share/fonts/opentype/inter/`.

```
cd _build
python3 youtube_videos.py thumbs teaser short1 short2 short3 short4 short5   # teaser + Shorts + their thumbnails
python3 long_videos.py launch demo thumbs                                      # launch video, demo, both thumbnails
python3 long_videos.py launch demo --silent                                    # same picture, silent audio track
```

- Engine: `_build/yt.py` (layers, fade/slide compositing, captions, ambient audio, `render` and `render_silent`). Scenes and caption timings: `youtube_videos.py` (teaser, Shorts) and `long_videos.py` (launch video, demo). App-accurate mock panels: `mocks_app.py` (labels copied from `app/app/(student)` and `app/app/(officer)`); older panels: `mocks.py`.
- Edit a caption or scene in the `launch_spec()` / `demo_spec()` functions, then re-run. SRT files are regenerated from the same caption list. The render prints `WARN` lines if an item leaves the frame or collides with a caption.
- Full renders take several minutes each (CPU only).
- Other assets: `python3 carousels.py` (Instagram slides), `python3 video.py` (promo reel + cover), `python3 store.py` (app-store icon and feature graphic).

## Layout QA (run before every release)

`_build/qa.py` wraps the PIL drawing calls and reports: text crossing a card/badge edge, text overlapping other text or ticks, less than 24px padding inside a card (6px inside a badge or button), and text outside the safe margins. It runs automatically on every layer the video engine builds (all scenes and captions), on every carousel slide, on the Shorts covers and on the promo reel. Findings print as `QA [...]` lines during a render; none are expected. To check without encoding any video: `QA_ONLY=1 python3 youtube_videos.py teaser short1 short2 short3 short4 short5` and `QA_ONLY=1 python3 long_videos.py launch demo`. The engine also prints `WARN` if a panel collides with a burned-in caption.

## Replace with real screen recordings once the app is built

The mock panels are illustrative redraws of the real screens, not recordings. When the app is running on seeded fictional data, record these screens (portrait phone capture, smooth cursor/finger, no zoom bounce) and swap them in for the cards:

Student (6):
1. Profile tab: completion meter, checklist, Verification section (Verified by placement cell / Self-reported / Not verified yet), Resumes screen.
2. Opportunities tab: search, filter sheet, sort chips, drive cards with Eligible / Check profile badges.
3. Drive detail: compensation, deadline countdown, eligibility table (Required / Yours), Opt in button.
4. Review and apply: details we will send (source, verification), resume choice, only the missing questions, confirm checkbox, Submit application.
5. Application submitted receipt, then the Application screen (timeline, Withdraw application).
6. Reminders settings (60 / 30 / 15, push, in-app, quiet hours) and a real push notification.

Officer (6): 
7. Dashboard. 8. Drive wizard (9 steps, Draft saved). 9. Fix before publishing + Who can apply (eligible count with reasons). 10. Drive screen applicants list and Update status sheet. 11. New announcement.
12. The Student drive preview ("Preview as student").

Also record: founder to camera for the launch video segments 0:00-0:12, 0:35-0:55 and 3:20-3:35 (currently title cards), and the voiceover for the launch video and demo (scripts in `youtube/`). Do not narrate features that are not visible; if a screen differs in the final build, re-record that segment. Update the on-screen numbers: mock panels contain small sample counts (for example "12 eligible students") that are fictional.

## Placeholders the founder must fill

- `[WAITLIST LINK]` and `[CONTACT EMAIL]` in `youtube/youtube-metadata.md` and `launch-plan.md`; also the "link in the description" end cards assume these exist.
- Real recordings, voiceover, founder camera footage (above); channel name and channel description; upload each `.srt` as subtitles.
- Pinned comment text and final title choice per video (options in `youtube-metadata.md`).
- Confirm the shipped build matches every claim in the captions (for example reminder times, withdraw-before-screening rule, five resume links) before publishing.
- Music: the ambient bed is generated in code (no licensed audio). If you add real music, use a track you hold the licence for.
