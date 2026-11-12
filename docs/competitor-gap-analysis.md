# UpGrid: Competitor Gap Analysis

Research date: 2026-11-07. Method: public web pages, vendor sites, review aggregators, news and forum threads, read via search and fetch. Nothing here comes from private demos or logged-in product use.

Legend: **Y** = stated on a vendor page I read. **not found** = I did not see it on the pages I read, which does NOT prove the product lacks it. **?** = could not verify. Vendor pages are marketing claims, not audited facts.

Baseline for "already has / in scope" (from the brief): profile-once, opt-in, eligibility, 60-30-15 reminders, scheduling, CSV import, tickets, online assessments with coding tests, recruiter portal, AI copilot, analytics, policy engine, restrictions.

---

## 0. Coverage and limits of this research

| Item | Status |
|---|---|
| Superset vendor pages (university, employer) | Read |
| Superset Capterra and Trustpilot reviews | Read (Capterra page 2 only; Trustpilot page 4 only, and it notes invitations are stale) |
| Superset Play Store / App Store reviews | **Could not retrieve** (AppsHunter fetch failed; Play Store not directly reachable). Treat app-store sentiment as unverified, and use Capterra as the nearest proxy. |
| Unstop (employer campus hiring page) | Read. College-side and student app features not covered on that page. |
| HackerEarth (university hiring, proctoring) | Read |
| Mettl | Only a 2021 launch PDF and a case-study page. Proctoring detail is thin. |
| TCS iON | Only the TCS Assessment-as-a-Service page, which does not describe iON campus features in detail. Mostly **?**. |
| HackerRank, CodeTantra | **Not verified.** Search returned only college pages that mention CodeTantra. Excluded from the matrix. |
| Internshala campus | One 2018 blog post (old, treat as dated) |
| SmartRecruiters campus | **Not verified.** Search returned nothing usable. Excluded. |
| Handshake | AI career copilot announcement and employer page read. Handshake targets US campuses, so use it as a pattern reference only. |
| Placement ERP (IITMS, Edumerge, Erekrut) | Erekrut read. IITMS redirect not followed. Edumerge not opened. |
| Reddit / Quora | Only a few threads via mirrors. Quora not retrieved. The student pain evidence is thin and anecdotal. |

---

## 1. Comparison matrix

Columns: **SS** Superset, **UN** Unstop (employer campus hiring), **HE** HackerEarth, **ME** Mettl, **HS** Handshake, **ER** Erekrut Campus Suite, **ISH** Internshala campus drive (2018 page).
UpGrid column shows planned status per the brief.

| Feature | UpGrid | SS | UN | HE | ME | HS | ER | ISH |
|---|---|---|---|---|---|---|---|---|
| Eligibility rules (CGPA, backlogs) | Has | Y [1] | not found | n/a | n/a | ? | ? | n/a |
| Reminders to eligible non-applicants | Has (60-30-15) | Y [1] | ? | ? | ? | ? | ? | ? |
| Drive and season dashboards, per-drive funnel | Scope (analytics) | Y [1] | Y (recruiter-side) [3] | Y (reports) [4] | Y [6] | Y (analytics) [9] | Y (reporting) [8] | not found |
| Department verification of marks/backlogs | **Missing** | Y [1] | not found | n/a | n/a | ? | ? | n/a |
| Online assessments with question bank | Scope | Y, 2,480 Qs [1] | Y [3] | Y, 17k-25k Qs (page conflicts) [4] | Y [6] | not found | Y, 2,500+ roles [8] | not found |
| Coding sandbox | Scope | Y (assessment bundles incl. coding) [1] | Y [3] | Y [4] | Y [6] | not found | ? | not found |
| Remote proctoring | Scope (partial) | Y ("proctored sessions", no detail) [1] | Y, Aadhaar, voice biometrics, tab-switch, geo-IP [3] | Y, smart browser, face/audio, DigiLocker ID, plagiarism [5] | Y, AI-proctoring (AI plus human described in one case study) [6][7] | not found | ? | not found |
| Cross-candidate plagiarism / question pooling | **Missing** | not found | not found | Y [5] | ? | n/a | ? | n/a |
| Recruiter portal / ATS | Scope | Y (Campus ATS, DriveX) [2] | Y (built-in ATS) [3] | not found | Y (ATS/HRMS integration) [6] | Y (ATS integration on Enterprise) [9] | Y (offer mgmt) [8] | Y (basic) [10] |
| Bulk offer letters | **Missing** | Y [2] | Y [3] | n/a | ? | ? | Y (offer mgmt) [8] | not found |
| Live video interviews | **Missing** (scheduling only) | Y [1][2] | Y (virtual, async, AI) [3] | Y (FaceCode) [4] | Y (structured and pair-programming) [6] | ? | ? | not found |
| AI interviewer / AI mock interview | **Missing** (copilot in scope) | Y, InterviewEdge mock interviews [1] | Y, AI interview agent [3] | not found | not found | Y, copilot is for career questions only [11] | not found | not found |
| D-day control centre (rooms, panels, slots) | **Missing** | Y [1] | Y (scheduling, panelist assignment) [3] | n/a | ? | ? | Y (interview scheduling) [8] | n/a |
| Employer CRM / outreach to colleges | **Missing** | Y (CRM for TPO; 24,000-college database for employers, claimed) [1][2] | Y (sourcing, 42,000+ colleges, claimed) [3] | Y (virtual campus outreach) [4] | Y (campus intelligence) [6] | not found | Y (LeadAI, 250+ recruiters/day claimed) [8] | n/a |
| College-format resume + shareable profile with view tracking | **Missing** | Y [1] | not found | n/a | n/a | ? | ? | n/a |
| Resume ATS analysis | **Missing** | Y [1] | ? | n/a | n/a | ? | ? | n/a |
| Internship management (allotment, logs, evaluation) | **Missing** | Y [1] | ? | n/a | n/a | ? | ? | Y (internship-led drive) [10] |
| Virtual or on-campus career fair | **Missing** | Y [1] | Y (hackathons, challenges) [3] | not found | Y (hackathons, ideathons) [6] | Y (event/fair support) [9] | ? | Y (online campus drive) [10] |
| Student mentors / interview experiences | **Missing** | Y (college-moderated) [1] | ? | n/a | n/a | ? | ? | n/a |
| Year-round skill assessments / cohorts / courses | **Missing** | Y [1] | ? | n/a | ? | ? | Y (academic and employability tests) [8] | n/a |
| SSO, MFA, RBAC scoped by team, role and drive | Partial | Y [1] | ? | ? | ? | ? | ? | ? |
| Mobile app for students | Has | Y (Android and iOS) [1] | not found on that page | n/a | n/a | ? | ? | n/a |
| Mobile app for TPO and recruiter | Has (one app) | not found (admin appears web-based; unverified) | not found | n/a | n/a | ? | ? | n/a |
| Policy engine (one-offer, dream tiers, penalties) | Scope | not found | not found | n/a | n/a | n/a | not found | n/a |
| Alumni and student record management | **Missing** | ? | ? | n/a | n/a | ? | Y [8] | n/a |
| HRMS/ATS integration | **Missing** | Y (HRMS) [2] | Y (structured data for enterprise) [3] | ? | Y [6] | Y [9] | ? | n/a |
| Diversity metrics at funnel stages | **Missing** | not found | Y [3] | not found | Y (filters) [6] | ? | ? | n/a |

**Sources**
1. Superset university page: https://joinsuperset.com/university.html
2. Superset employer page: https://joinsuperset.com/lp/employer
3. Unstop campus hiring: https://unstop.com/employers/campus-hiring/amp
4. HackerEarth university hiring: https://www.hackerearth.com/recruit/university-hiring
5. HackerEarth proctoring: https://www.hackerearth.com/recruit/features/proctoring
6. Mettl campus suite launch PDF (2021): https://resources.mettl.com/wp-content/uploads/2021/09/Mercer-Mettl-launches-campus-hiring-solution-suite-to-conduct-end-to-end-campus-drives-virtually.pdf
7. Mettl case-study page (AI plus human proctoring, one client): https://mettl.com/clients/achieving-exam-integrity/
8. Erekrut Campus Suite: https://www.erekrut.com/erekrut-campus-suite/
9. Handshake employers: https://joinhandshake.com/employers/
10. Internshala online campus drive (2018): https://internshala.com/blog/indias-largest-online-campus-drive/
11. Handshake AI career copilot: https://updates.joinhandshake.com/announcements/ai-career-copilot
12. TCS Assessment as a Service (generic, not campus-specific): https://tcs.com/what-we-do/industries/education/solution/digital-assessment-platform-delivering-boundaryless-experiences. It lists self, machine and dual proctoring, on-centre and remote delivery, and results within 24 hours. I did not verify iON campus-hiring features.

**Observations from the matrix**
- Superset is the only product I verified that covers the college side end to end (eligibility, verification, drives, D-day, CRM, internships, mock interviews). That is the feature set UpGrid is directly measured against.
- Unstop and the assessment vendors (HackerEarth, Mettl) are employer-side and strongest on integrity tooling. Treat them as the benchmark for the proctoring layer, not for TPO workflow.
- Handshake's AI copilot is, per its own announcement, a limited pilot that answers career questions and shows career centres what students ask. It is not a hiring agent.
- I found no competitor page describing a rules engine for placement policy (one-offer rule, dream/normal tiers, offer penalties). That could be a real gap, or it may live behind login. Marked "not found", not "absent".

---

## 2. Recurring pain points

Evidence quality is mixed. Each item is tagged **[review]**, **[forum]**, **[vendor blog]**, or **[study]**. No single source is representative.

### Students
| Pain point | Evidence |
|---|---|
| Mobile web/app is messy, slow, blank pages after updates, buffering in interviews, needs high bandwidth | Capterra reviews of Superset (4 to 5 star reviewers still raised it) https://www.capterra.com/p/10002353/Superset/reviews/?page=2 [review] |
| Profile fields (name, college, marks) cannot be edited after sign-up | Same Capterra page [review] |
| Invalid links, especially for written exams | Same [review] |
| Fake or doubtful companies listed | Same [review] |
| Sign-up asks for a lot of personal data | Same [review] |
| Slow support | Same, called the most frequent complaint [review] |
| Cheaters pass online rounds and honest students are eliminated; a college was blacklisted by a company | CodeChef forum thread https://discuss.codechef.com/t/cheating-in-online-campus-hiring-programs/78726 [forum] |
| Offer-backout penalties, one-offer rules, hardship cases, and cells seen as serving college statistics | r/developersIndia thread (via mirror) https://lr.in.psf.lt/r/developersIndia/comments/1f666hf/not_only_tier3_even_tier1_colleges_do_these_things [forum]. Several claims are unverified commenter statements. |
| Unwritten "placement cell fee" of 2.1% of CTC, with certificates withheld and no written notice | Business Today, summarising a Reddit post (allegation, no college response) https://businesstoday.in/jobs/story/college-demanding-21-ctc-as-placement-ceel-fee-engineering-students-post-goes-viral-on-reddit-users-demand-answers-386167-2023-06-19 [forum, via news] |
| Few jobs or companies shown | Capterra [review] |

### TPOs / placement cells
| Pain point | Evidence |
|---|---|
| Admin overload from Google Forms, email, WhatsApp groups; collecting student data, relaying company info, scheduling, reports | AccioJob article https://medium.com/acciojob/4-challenges-placement-cells-face-during-placement-season-b5dba0e6964a [vendor blog, a competitor's view] |
| Chasing students to read notices and meet deadlines | Same |
| Coordinating departments, exam cells and admin | Same |
| Limited company outreach for Tier-2/3 colleges | Same |
| Seasonal spikes in workload | Superset blog (page could not be fetched, so only the title was seen) [vendor blog, unverified] |
| Online test integrity: 30 to 50 percent of entry-level candidates cheat per one vendor's study; image-only proctoring misses about 92 percent | HirePro study via Careers360 https://news.careers360.com/30-to-50-percent-candidates-cheat-during-entry-level-job-assessments-says-hirepro-study/amp [study, vendor-run, Hirepro's own platform data] |

### Recruiters
| Pain point | Evidence |
|---|---|
| Cheated assessments lead to wasted interview rounds and, in one case, zero hires | CodeChef thread [forum] |
| Need to reach Tier-2/3 talent efficiently | Unstop, Mettl pitch this as a need (vendor claim, not recruiter testimony) |
| Link and logistics failures on drive day | Capterra (student view) [review] |
| Direct recruiter testimonials or public complaints | **Not found.** I did not locate public recruiter complaints about Superset or peers. Recruiter pain points above are inferred from vendor positioning. |

---

## 3. Prioritised missing features (after the stated scope)

Tags: Priority = must-have (M), should-have (S), differentiator (D). Effort = S/M/L (rough: S under 2 weeks, M 2 to 6 weeks, L over 6 weeks for a small team). "Single mobile app?" = whether it fits Expo mobile without a companion web surface.

| # | Feature | Priority | Effort | Single mobile app? | Why (evidence) |
|---|---|---|---|---|---|
| 1 | Recruiter/company verification (CIN/GST/domain email check, admin approval, "verified" badge, reporting of fake drives) | M | S | Yes | Fake listings complaint on Capterra |
| 2 | Offer-to-joining lifecycle: offers, accept/decline, multi-offer rules via the policy engine, revocation, bulk offer letters, joining tracking | M | M | Yes | Superset and Unstop both ship bulk offers; offer-backout disputes are the most visible student grievance |
| 3 | Assessment integrity layer: browser lock, tab-switch and focus loss logging, periodic webcam snapshots, ID check (DigiLocker), cross-candidate code similarity, question pooling and shuffling, flagged-review queue with human decision | M | L | **Partly.** Phones cannot enforce a locked browser. Run coding tests on a laptop via a web view or lab mode, and keep the Expo app for scheduling and results. | HackerEarth and Unstop set the bar; cheating is the top recruiter and honest-student complaint |
| 4 | DPDP consent and rights toolkit: consent ledger, purpose notices, withdraw, erasure, grievance contact, minor handling (see section 5) | M | M | Yes | Substantive DPDP obligations start 2027-05-13 |
| 5 | Department/faculty verification of marks and backlogs with audit trail | M | M | Yes | Superset offers it; the eligibility engine is only as good as its data |
| 6 | Drive-day control: live round tracking, rooms/panels/slots, attendance check-in (QR), no-show handling | S | M | Yes (staff view) | Superset "D-day control centre" |
| 7 | Interview module: panel feedback forms, scorecards, decisions per round; video via link-out (Meet/Zoom/Teams) rather than building video | S | M | Yes | Superset, Unstop, HackerEarth all offer interviews. Building native video would be L, so link out. |
| 8 | Multi-channel notifications (push, SMS, WhatsApp, email) with delivery and read tracking, plus low-bandwidth and offline-tolerant screens | S | M | Yes | Cells use WhatsApp groups and chase students; Superset mobile performance complaints |
| 9 | Student-visible application status, rejection reasons where policy allows, and an appeals/grievance path on top of tickets | S | S | Yes | Unwritten fees and policy disputes; tickets already exist |
| 10 | Editable profile with change history and re-verification (instead of locked fields) | S | S | Yes | Capterra: profile non-editable |
| 11 | Resume generator in college format, shareable profile link with view tracking, ATS-style resume check | S | M | Yes | Superset "Talent showcase" and resume analysis |
| 12 | AI mock interviews and readiness diagnostic | D | M-L | Yes | Superset InterviewEdge. Voice and scoring costs and quality risk. Keep to text plus voice later. |
| 13 | TPO company-outreach CRM (pipeline stages, follow-ups, drive history, employer feedback) | S | M | Yes | Superset CRM; Erekrut, Unstop outreach tooling |
| 14 | Integrations and exports: ATS/HRMS export, college ERP or SSO, public API/webhooks, calendar sync | S | M | Yes (back end) | Superset, Mettl, Handshake list integrations |
| 15 | Internship management and PPO tracking; alumni and interview-experience library | S | M | Yes | Superset internships and Student Mentors; Internshala internship-led drives |

Lower priority, not listed above: hackathon/contest hosting, courses and training partners, virtual career fairs, funnel diversity dashboards. These are covered by Superset or Unstop but are weakly tied to the core TPO workflow. I would defer them.

---

## 4. Ten strongest honest differentiators

"Honest" = true of UpGrid by design, and not contradicted by anything I verified. Where a rival might also do it behind a login, the wording says so.

1. **One Expo app for student, TPO and recruiter.** Superset's student app exists on Android and iOS, but I found no evidence of a TPO or recruiter mobile app. Unstop's page does not mention a mobile app. (Verify against a demo before claiming it publicly.)
2. **Profile once, opt-in per drive.** Students enter data once and choose what each company can see. Reviewers complained about heavy sign-up data and non-editable profiles; opt-in per drive addresses the privacy half of that.
3. **Policy engine visible to students.** One-offer rules, tiers and penalties are encoded and shown before a student applies. Student grievances centre on opaque rules and verbal fees. No competitor page I read describes this ("not found", not "absent").
4. **60-30-15 reminder cadence out of the box.** Superset can message non-applicants; automatic deadline-based cadences were not described on the pages I read.
5. **Editable profiles with an audit trail.** Directly answers a Capterra complaint.
6. **Honest integrity model.** Human review of flagged sessions, and published limits, rather than claiming the AI "catches everything." The HirePro study shows layered signals matter, and image-only checks miss most cheating.
7. **DPDP-native design.** Consent ledger, purpose limitation, and erasure built in before the Act's main obligations start (2027-05-13). Superset and others may also comply; the differentiator is being visible and early.
8. **Tier-2/3 college fit.** Light-weight setup via CSV import, low-bandwidth screens, and regional language support. Candidate pricing: affordable or free for small colleges (pricing of competitors unverified).
9. **Accountable support.** Built-in tickets with visible status and SLA, against "slow support" as the most frequent Superset review complaint.
10. **Student data portability.** Students can export their verified profile and leave with it after graduation. I found no competitor page describing this.

Do not claim: "first", "only" or "best", and do not claim AI proctoring parity with HackerEarth or Unstop until the integrity layer (item 3) ships.

---

## 5. Indian compliance notes (high level, not legal advice)

**This section is general information from public summaries. It is not legal advice. Have a lawyer review before launch, especially for minors, cross-border hosting, and any fee or penalty policies.**

**Timeline** (per AZB & Partners, https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/; consistent with SCC Online's "18 months" summary https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/):
- 2025-11-13: institutional provisions (Data Protection Board, definitions) in force.
- 2026-11-13: consent-manager registration provisions start. This is six days from today.
- 2027-05-13: substantive obligations start (notice and consent, fiduciary duties, children's data, rights, penalties).

**What this means for UpGrid**
- **Roles.** The college is likely the data fiduciary for student data it collects, and UpGrid (the vendor) likely a data processor. Recruiters receiving profiles become fiduciaries for what they hold. Contracts should say who is who. Confirm with counsel.
- **Notice and consent.** Notices must be clear, in plain language, state the data and purpose, give contact details, and explain how to withdraw and complain (SCC Online). Your opt-in per drive maps well to purpose-specific consent. Record who consented, to what, when, and any withdrawal.
- **Sharing with recruiters.** Share only the fields a student opted into for that drive. Log every disclosure. Treat resume links with view tracking as a disclosure you must disclose.
- **Minors.** Verifiable parental consent applies to anyone under 18 (SCC Online, LiveLaw). Most placement students are adults, but first- and second-year internship and skills features may include 17-year-olds. Either gate by date of birth or get advice. Exemptions exist for some educational institutions in narrow welfare contexts (AZB). Whether they cover placement is a legal question.
- **Retention and erasure.** Delete data when the purpose ends unless law requires keeping it; give notice (the summaries cite 48 hours' notice for some classes) and keep processing logs for at least one year (SCC Online, AZB). Define retention per data class: active students, alumni, rejected applicants, assessment recordings and webcam snapshots (high sensitivity, short retention).
- **Security and breaches.** Reasonable safeguards (encryption, access control, logging, backups) apply to processors too. Breach reports go to affected individuals and the Board, with a detailed report within 72 hours per AZB. Build an incident runbook.
- **Cross-border.** Transfers are generally allowed except to restricted countries, with possible localisation for significant fiduciaries (AZB). Prefer India-region hosting and disclose any overseas sub-processors, such as AI model providers used by the copilot. Do not send raw student PII to AI vendors without a lawful basis and a contract.
- **Proctoring and biometrics.** Webcam snapshots, face match, voice biometrics and Aadhaar-based checks are high-risk. Collect the minimum, get explicit consent, say how long it is kept, and never make Aadhaar the only route. I did not verify Aadhaar-specific restrictions in this research; ask counsel.
- **Fees and certificate withholding.** The "placement cell fee" and withheld-certificate stories are a reputational and likely regulatory risk for customer colleges. The policy engine should make any fee rule explicit and written. Whether such fees are lawful is outside this research.
- **Grievance and rights.** Provide access, correction and erasure requests and a named grievance contact in-app. Your tickets feature can carry this.
- **Not verified here:** penalty amounts (the sources I read gave none), sector-specific rules for universities (UGC/AICTE), and the final status of consent-manager requirements.

---

## Appendix: facts to treat with care

- Superset "claimed numbers" (24,000 colleges, 3,500+ companies, 2.51 million applications, 3.07 lakh offers) come from the page's "Superset in 2022" figures. Unaudited.
- HackerEarth's question library size appears as both 25,000+ and 17,000+ on one page.
- Unstop's 42,000+ colleges and 32M+ users are marketing claims.
- Superset's Trustpilot score (4.8 from 79 reviews) comes from a page that says review invitations had lapsed, so it is likely skewed.
- Capterra's top Superset themes (support, mobile, profile locks) are from one page of reviews, not the full set.
