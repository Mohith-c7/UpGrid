# UpGrid

> Unified Campus Placement Ecosystem connecting Students, Placement Officers, and Recruiters in one cohesive platform.

[![Node Version](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![Expo](https://img.shields.io/badge/Expo-v58-black.svg)](https://expo.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-336791.svg)](https://www.postgresql.org/)

---

## 📌 Overview

**UpGrid** replaces fractured placement spreadsheets, fragmented WhatsApp groups, and disconnected job boards with an enterprise-grade platform. Designed specifically for university placement cells, candidate students, and hiring partners.

---

## 📁 Repository Structure

```
UpGrid/
├── app/                  # Mobile Client (React Native + Expo Router)
│   ├── app/              # Expo file-based routing: (auth), (student), (officer), (recruiter)
│   ├── src/              # Reusable components, state management, API client, design system
│   ├── assets/           # Icons, splashes, and branding graphics
│   └── package.json
│
├── server/               # Backend REST API (Node.js + Express + TypeScript + PostgreSQL)
│   ├── src/              # Controllers, routes, middleware, models, DB migrations, seed data
│   ├── test/             # Vitest test suites (550+ tests covering business rules & workflows)
│   ├── docs/             # API documentation & endpoints specification
│   └── package.json
│
├── website/              # Public Marketing & Waitlist Landing Website
│   ├── assets/           # CSS stylesheets, JavaScript interactions, images
│   ├── tools/            # Local preview server & utility scripts
│   └── index.html        # Landing page with interactive role-specific showcases
│
├── marketing/            # Go-to-Market & Launch Materials
│   ├── app-store-assets/ # Mobile store screenshots and copy
│   ├── instagram/        # Social carousels, stories, reels copy
│   ├── youtube/          # Product demo, teaser videos, and shorts
│   └── _build/           # Asset generation and automation scripts
│
├── docs/                 # System Architecture & Specifications
│   ├── ARCHITECTURE_V2.md        # Technical architecture, DB schema, flow diagrams
│   └── competitor-gap-analysis.md # Market comparison & differentiator analysis
│
├── CONTRACT.md           # Unified API Contract & Validation Schema
└── README.md             # Repository Documentation
```

---

## ✨ Features by Role

### 🎓 Students
- **Smart Eligibility & One-Click Apply**: Real-time eligibility calculations based on CGPA, backlogs, branch, and placement policy.
- **Application Tracker**: Live progression pipeline across test, interview, and offer stages.
- **Slot Booking & Attendance**: Self-service interview scheduling and dynamic QR code check-in.
- **Assessment Engine**: Integrated MCQ and coding assessments with practice environments.
- **AI Career Suite**: Resume scoring, targeted interview question generation, and simulated mock interviews.
- **Offers & Acceptance**: Formal accept/decline workflows with placement policy conflict detection.

### 🏢 Placement Officers
- **Drive Orchestrator**: Multi-round drive setup, automatic eligibility filtering, and batch communications.
- **Assessment Builder**: Question bank management, coding test creation with test cases, and anti-plagiarism monitoring.
- **Placement Policy Simulator**: Policy rule engine (e.g., dream offers, PPO restrictions, offer capping) with real-time impact simulation.
- **Company CRM**: Corporate partner directory, contact management, past CTC benchmarks, and historical drive archives.
- **Analytics & Reporting**: Cohort progress, placement percentages, branch-wise CTC distribution, and accreditation-ready exports.

### 💼 Recruiters (Invite-Only)
- **Drive-Scoped Candidate Pipelines**: Apply-time snapshot views preserving applicant data integrity.
- **Blind Evaluation & Scorecards**: Objective scoring matrices with configurable blind evaluation to reduce bias.
- **Slot & Schedule Management**: Create interview slots and sync round feedback directly with the placement cell.
- **AI-Assisted Question Recommendations**: Tailored interview prompts generated from the candidate's verified resume.

---

## 🛠️ Integrations

The system is architected with graceful degradation (integrations report status via `/config`):
- **Authentication**: Google OAuth 2.0 & Email OTP / Magic Link (SMTP)
- **Storage**: Cloudflare R2 / AWS S3 presigned uploads for resumes and assets
- **Security & Bot Protection**: Cloudflare Turnstile verification
- **Code Execution Engine**: Judge0 sandbox for technical coding assessments
- **AI Capabilities**: Google Gemini API for intelligent resume parsing and interview coaching

---

## 🚀 Getting Started

### 1. Server Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your PostgreSQL credentials and secrets
npm run migrate
npm run seed
npm run dev
```

> **Demo Accounts (seeded):**
> - **Officer**: `officer@placement.demo` / `Officer@123`
> - **Recruiter**: `recruiter@placement.demo` / `Recruiter@123`
> - **Students**: `aarav.sharma@students.demo`, `diya.patel@students.demo` / `Student@123`

### 2. Mobile App Setup (Expo)

```bash
cd app
npm install
cp .env.example .env
# Set EXPO_PUBLIC_API_URL to your server URL (e.g. http://localhost:4000)
npm run start
```
*Note: Due to native dependencies (camera, document picker, secure store), run via EAS build or prebuild on physical/virtual devices rather than bare Expo Go.*

### 3. Marketing Website

```bash
cd website
# Open index.html directly or serve using Python:
python tools/serve.py
```

---

## 🧪 Testing

The backend includes a comprehensive suite of unit and integration tests:

```bash
cd server
npm test
```

---

## 📄 License

Proprietary / Internal project. All rights reserved.
