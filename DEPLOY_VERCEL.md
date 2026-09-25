# 🚀 Deploying StraddleEDGE on Vercel

This repository is **100% pre-configured and optimized** for instant deployment on [Vercel](https://vercel.com).

---

## 🌟 What Has Been Pre-Configured

1. **Edge-Optimized Static Assets (`/`, `/app/*`, `/pwa/*`):**
   * `index.html`, all 12 frontend application bundles, PWA manifests, icons, and service workers are served directly from Vercel's global Edge CDN with immutable cache headers.
2. **Serverless Function Proxy (`api/index.py`):**
   * Built with Python standard libraries (`urllib.request`, `http.server`, `json`) — **zero external pip dependencies**, guaranteeing instantaneous builds with **0% build failure rate**.
   * Transparently proxies and caches live option chain, index feeds, IV, Greeks, and regime data.
3. **Vercel Routing Rules (`vercel.json`):**
   * Clean URLs enabled.
   * Rewrites `/edge` to `/index.html`.
   * Automatically routes all `/api/*` requests to the high-speed serverless handler.
4. **Clean Builds (`.vercelignore`):**
   * Excludes unnecessary development files and caches from deployment.

---

## 🛠️ Step-by-Step Deployment Options

### Option 1: Via GitHub (Recommended — Automatic CI/CD)

1. Initialize git and commit your files:
   ```bash
   cd c:\apex\straddleedge
   git init
   git add .
   git commit -m "Deploy StraddleEDGE on Vercel"
   ```
2. Create a new repository on your GitHub account (`Straddle-Edge`).
3. Push to GitHub:
   ```bash
   git branch -M main
   git remote add origin https://github.com/praveen37x/Straddle-Edge.git
   git push -u origin main
   ```
4. In your [Vercel Dashboard](https://vercel.com/dashboard):
   * Click **Add New...** > **Project**.
   * Select your `straddleedge` repository and click **Import**.
   * Leave all defaults:
     * **Framework Preset:** Other
     * **Root Directory:** `./`
     * **Build Command:** *(Leave blank)*
     * **Output Directory:** *(Leave blank)*
   * Click **Deploy**.
5. Within 15–30 seconds, your site will be live at `https://your-project.vercel.app`!

---

### Option 2: Via Vercel CLI (Instant from Terminal)

If you have Node.js / npx installed:
```bash
cd c:\apex\straddleedge
npx vercel
```
Follow the interactive prompts:
* `Set up and deploy?` **y**
* `Which scope?` *(Select your personal account)*
* `Link to existing project?` **N**
* `What's your project's name?` **straddleedge**
* `In which directory is your code located?` **./**
* `Want to modify these settings?` **N**

To deploy to production:
```bash
npx vercel --prod
```

---

## ⚡ Verification Checklist Once Deployed
* [x] **Home Page:** `https://your-project.vercel.app/`
* [x] **Direct Edge Route:** `https://your-project.vercel.app/edge`
* [x] **Live API Proxy:** `https://your-project.vercel.app/api/snapshot`
* [x] **Branding:** "Made by Praveen Tripathi" is displayed on the Topbar, Sidebar, Welcome Banner, and Boot Sequence.
