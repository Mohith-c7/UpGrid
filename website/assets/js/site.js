/* Placement OS site script: applies config.js values, accessible tabs. No animation. */
(function () {
  "use strict";
  var C = window.PLACEMENT_OS_CONFIG || {};
  var STAMPED_ORIGIN = "https://placementos.example";
  var STAMPED_EMAIL = "hello@placementos.example";
  var $ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // site name
  $("[data-cfg='SITE_NAME']").forEach(function (el) { if (C.SITE_NAME) el.textContent = C.SITE_NAME; });

  // contact email
  if (C.CONTACT_EMAIL) {
    $("[data-cfg-email]").forEach(function (el) {
      var subj = el.getAttribute("data-subject");
      el.setAttribute("href", "mailto:" + C.CONTACT_EMAIL + (subj ? "?subject=" + encodeURIComponent(subj) : ""));
      if (el.hasAttribute("data-show")) el.textContent = C.CONTACT_EMAIL;
    });
  }

  // Play Store + social links: shown only when set
  function linkOrHide(sel, url) {
    $(sel).forEach(function (el) {
      if (url && /^https:\/\//.test(url)) { el.setAttribute("href", url); el.hidden = false; }
      else { el.hidden = true; }
    });
  }
  linkOrHide("[data-cfg-link='PLAY_STORE_URL']", C.PLAY_STORE_URL);
  linkOrHide("[data-cfg-link='SOCIAL_LINKEDIN']", C.SOCIAL_LINKEDIN);
  linkOrHide("[data-cfg-link='SOCIAL_INSTAGRAM']", C.SOCIAL_INSTAGRAM);
  linkOrHide("[data-cfg-link='SOCIAL_X']", C.SOCIAL_X);
  linkOrHide("[data-cfg-link='SOCIAL_YOUTUBE']", C.SOCIAL_YOUTUBE);
  $("[data-cfg-hide-if-play]").forEach(function (el) { if (C.PLAY_STORE_URL) el.hidden = true; });

  // canonical / OG urls follow SITE_URL even if the static HTML was not re-stamped
  if (C.SITE_URL && C.SITE_URL.replace(/\/$/, "") !== STAMPED_ORIGIN) {
    var origin = C.SITE_URL.replace(/\/$/, "");
    $("link[rel='canonical'], meta[property='og:url'], meta[property='og:image'], meta[name='twitter:image']").forEach(function (el) {
      var attr = el.tagName === "LINK" ? "href" : "content";
      var v = el.getAttribute(attr) || "";
      if (v.indexOf(STAMPED_ORIGIN) === 0) el.setAttribute(attr, origin + v.slice(STAMPED_ORIGIN.length));
    });
  }
  void STAMPED_EMAIL;

  // tabs (progressive enhancement: without JS every panel is visible)
  $(".tabs").forEach(function (root) {
    var tabs = $("[role='tab']", root), panels = $("[role='tabpanel']", root);
    if (!tabs.length) return;
    root.classList.add("js");
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i, false); });
      t.addEventListener("keydown", function (e) {
        var k = e.key, n = tabs.length;
        if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); select((i + 1) % n, true); }
        else if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); select((i - 1 + n) % n, true); }
        else if (k === "Home") { e.preventDefault(); select(0, true); }
        else if (k === "End") { e.preventDefault(); select(n - 1, true); }
      });
    });
    var hash = (location.hash || "").replace("#", ""), start = 0;
    tabs.forEach(function (t, i) { if (t.getAttribute("data-key") === hash) start = i; });
    select(start, false);
  });

  var y = document.getElementById("yr"); if (y) y.textContent = String(new Date().getFullYear());
})();
