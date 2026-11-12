#!/usr/bin/env python3
"""After editing SITE_URL / CONTACT_EMAIL in config.js, run: python3 tools/stamp-urls.py
Rewrites the placeholder origin and email in the static HTML, sitemap.xml, robots.txt and site.webmanifest
so crawlers (which may not run JavaScript) see the real canonical URLs. Safe to re-run."""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
def get(k):
    m = re.search(k + r'\s*:\s*"([^"]*)"', cfg); return m.group(1).strip() if m else ""
url, mail = get("SITE_URL").rstrip("/"), get("CONTACT_EMAIL")
state = os.path.join(ROOT, "tools", ".stamped")
prev_url, prev_mail = "https://upgrid.example", "hello@upgrid.example"
if os.path.exists(state):
    a = open(state).read().split("\n"); prev_url, prev_mail = a[0], a[1]
if not url.startswith("https://"): sys.exit("SITE_URL must start with https://")
n = 0
for f in glob.glob(os.path.join(ROOT, "*.html")) + [os.path.join(ROOT, x) for x in ("sitemap.xml", "robots.txt", "site.webmanifest")]:
    s = open(f, encoding="utf-8").read(); t = s.replace(prev_url, url)
    if mail: t = t.replace(prev_mail, mail)
    if t != s: open(f, "w", encoding="utf-8").write(t); n += 1
open(state, "w").write(url + "\n" + (mail or prev_mail))
print(f"Stamped {url} / {mail} into {n} files.")
