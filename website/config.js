/*
 * Placement OS website configuration. This is the ONLY file you edit to fill placeholders.
 * Every page loads it before assets/js/site.js. See README.md.
 * Static SEO tags (canonical, Open Graph, sitemap) are rewritten by `python3 tools/stamp-urls.py`
 * after you change SITE_URL or CONTACT_EMAIL.
 */
window.PLACEMENT_OS_CONFIG = {
  SITE_NAME: "Placement OS",
  // Final public origin, no trailing slash. PLACEHOLDER: replace before launch.
  SITE_URL: "https://placementos.example",
  // PLACEHOLDER: a real inbox you read. Used for contact links and the waitlist mailto fallback.
  CONTACT_EMAIL: "hello@placementos.example",
  // Full URL of POST /api/v1/waitlist on your deployed server, e.g. "https://api.example.com/api/v1/waitlist".
  // Leave "" and the form falls back to opening an email to CONTACT_EMAIL.
  WAITLIST_ENDPOINT: "",
  // Google Play listing URL. Leave "" until the app is listed: the button stays hidden.
  PLAY_STORE_URL: "",
  // Social profile URLs. Leave "" to hide a link.
  SOCIAL_LINKEDIN: "",
  SOCIAL_INSTAGRAM: "",
  SOCIAL_X: "",
  SOCIAL_YOUTUBE: ""
};
