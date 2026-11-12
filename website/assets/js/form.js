/* Waitlist + contact forms. Validation mirrors the server (src/validation.ts) so users get the same answers. */
(function () {
  "use strict";
  var C = window.UPGRID_CONFIG || {};
  var TYPOS = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmal.com": "gmail.com", "gmil.com": "gmail.com", "hotmial.com": "hotmail.com", "yahooo.com": "yahoo.com" };
  var EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  var PHONE_MSG = "Enter a valid 10-digit mobile number starting with 6–9";
  var MIN_FILL_MS = 2500;
  var CTRL = /[\u0000-\u001f\u007f-\u009f]/;

  function validateEmail(raw) {
    var e = String(raw || "").trim().toLowerCase();
    if (!e) return { msg: "Enter your email address" };
    if (e.length > 254 || CTRL.test(e) || !EMAIL_RE.test(e) || e.indexOf("..") >= 0) return { msg: "Enter a valid email address" };
    var at = e.lastIndexOf("@"), local = e.slice(0, at), domain = e.slice(at + 1);
    if (local.charAt(0) === "." || local.charAt(local.length - 1) === ".") return { msg: "Enter a valid email address" };
    if (domain.split(".").some(function (p) { return p.charAt(0) === "-" || p.charAt(p.length - 1) === "-"; })) return { msg: "Enter a valid email address" };
    if (TYPOS[domain]) return { msg: "Did you mean " + TYPOS[domain] + "?", suggest: local + "@" + TYPOS[domain] };
    if (domain === "gmail.com" || domain === "googlemail.com") {
      var base = local.split("+")[0];
      if (!/^[a-z0-9.]+$/.test(base)) return { msg: "Gmail addresses can only use letters, numbers and dots" };
      if (base.charAt(0) === "." || base.charAt(base.length - 1) === "." || base.indexOf("..") >= 0 || !/[a-z0-9]/.test(base)) return { msg: "Enter a valid email address" };
      if (base.length < 6 || base.length > 30) return { msg: "Gmail usernames must be 6–30 characters" };
    }
    return { value: e };
  }
  function validatePhone(raw) {
    var s = String(raw || "").trim();
    if (!s) return { value: "" }; // optional
    if (/[a-zA-Z]/.test(s)) return { msg: PHONE_MSG };
    s = s.replace(/[\s\-().]/g, "");
    var plus = false;
    if (s.charAt(0) === "+") { plus = true; s = s.slice(1); }
    if (!/^\d+$/.test(s)) return { msg: PHONE_MSG };
    if (plus) { if (!(s.indexOf("91") === 0 && s.length === 12)) return { msg: PHONE_MSG }; s = s.slice(2); }
    else if (s.length === 12 && s.indexOf("91") === 0) s = s.slice(2);
    else if (s.length === 11 && s.charAt(0) === "0") s = s.slice(1);
    if (s.length !== 10 || !/^[6-9]/.test(s) || /^(\d)\1{9}$/.test(s) || s === "1234567890" || s === "0123456789") return { msg: PHONE_MSG };
    return { value: s };
  }
  function validateName(raw) {
    var s = String(raw || "").trim().replace(/\s+/g, " ");
    if (s.length < 2) return { msg: "Name must be at least 2 characters" };
    if (s.length > 80) return { msg: "Name must be at most 80 characters" };
    if (CTRL.test(s) || !/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s)) return { msg: "Name can only contain letters, spaces and . ' -" };
    return { value: s };
  }
  window.UpGridValidate = { email: validateEmail, phone: validatePhone, name: validateName };

  function $(id) { return document.getElementById(id); }
  function setErr(field, msg, suggest) {
    var input = $(field), box = $(field + "-err");
    if (!box) return;
    box.textContent = msg || "";
    if (msg && suggest) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Use " + suggest;
      b.addEventListener("click", function () { input.value = suggest; setErr(field, ""); input.focus(); });
      box.appendChild(b);
    }
    if (input) { if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }

  // ---- waitlist
  var form = $("waitlist-form");
  if (form) {
    var started = Date.now(), busy = false;
    var status = $("form-status");
    var roleLabels = { student: "Student", placement_officer: "Placement officer", recruiter: "Recruiter", other: "Other" };

    var checks = {
      name: function () { var r = validateName($("name").value); setErr("name", r.msg); return r; },
      role: function () { var v = $("role").value; var ok = !!roleLabels[v]; setErr("role", ok ? "" : "Choose the option that fits you best"); return { value: v, msg: ok ? null : "x" }; },
      college: function () { var v = $("college").value.trim(); var bad = v.length > 120 || CTRL.test(v); setErr("college", bad ? "Keep this under 120 characters" : ""); return { value: v, msg: bad ? "x" : null }; },
      email: function () { var r = validateEmail($("email").value); setErr("email", r.msg, r.suggest); return r; },
      phone: function () { var r = validatePhone($("phone").value); setErr("phone", r.msg); return r; },
      consent: function () { var ok = $("consent").checked; setErr("consent", ok ? "" : "Please tick the box to join the waitlist"); return { msg: ok ? null : "x" }; }
    };
    Object.keys(checks).forEach(function (k) {
      var el = $(k); if (!el) return;
      el.addEventListener("blur", function () { if (el.value || k === "consent") checks[k](); });
      el.addEventListener(k === "role" || k === "consent" ? "change" : "input", function () { if (el.getAttribute("aria-invalid")) checks[k](); });
    });

    function show(kind, title, html) {
      status.className = "alert " + kind;
      status.innerHTML = "";
      var h = document.createElement("h2"); h.textContent = title; status.appendChild(h);
      var p = document.createElement("p"); if (html && html.nodeType) p.appendChild(html); else p.textContent = html; status.appendChild(p);
      status.hidden = false; status.setAttribute("tabindex", "-1"); status.focus();
    }
    function mailtoHref(d) {
      var body = "Please add me to the UpGrid waitlist.\n\nName: " + d.name + "\nRole: " + roleLabels[d.role] + "\nCollege: " + (d.college || "-") + "\nEmail: " + d.email + (d.phone ? "\nMobile: " + d.phone : "") + "\n\nI agree to be contacted about the campus pilot and launch.";
      return "mailto:" + (C.CONTACT_EMAIL || "") + "?subject=" + encodeURIComponent("UpGrid waitlist") + "&body=" + encodeURIComponent(body);
    }
    function mailLink(d, text) { var a = document.createElement("a"); a.href = mailtoHref(d); a.textContent = text; return a; }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      status.hidden = true;
      var res = {}, firstBad = null;
      ["name", "role", "college", "email", "phone", "consent"].forEach(function (k) {
        res[k] = checks[k]();
        if (res[k].msg && !firstBad) firstBad = $(k);
      });
      if (firstBad) { firstBad.focus(); return; }
      var data = { name: res.name.value, role: res.role.value, college: res.college.value, email: res.email.value, phone: res.phone.value };
      var hp = $("website").value;

      if (!C.WAITLIST_ENDPOINT) {
        var wrap = document.createElement("span");
        wrap.appendChild(document.createTextNode("The online sign-up is not connected yet, so we will use email instead. "));
        wrap.appendChild(mailLink(data, "Open a pre-filled email to " + (C.CONTACT_EMAIL || "us")));
        wrap.appendChild(document.createTextNode(" and press send."));
        show("good", "Almost there", wrap);
        return;
      }
      busy = true;
      var btn = $("submit-btn"); btn.disabled = true; btn.textContent = "Sending…";
      var wait = Math.max(0, MIN_FILL_MS - (Date.now() - started));
      setTimeout(function () {
        var ctl = typeof AbortController === "function" ? new AbortController() : null;
        var to = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
        fetch(C.WAITLIST_ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json" }, mode: "cors", credentials: "omit",
          signal: ctl ? ctl.signal : undefined,
          body: JSON.stringify({ name: data.name, role: data.role, college: data.college || undefined, email: data.email, phone: data.phone || undefined, consent: true, website: hp, elapsedMs: Date.now() - started })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
        }).then(function (r) {
          clearTimeout(to);
          if (r.status >= 200 && r.status < 300) {
            form.hidden = true;
            show("good", "You are on the list", "Thank you, " + data.name.split(" ")[0] + ". We will email " + data.email + " about the campus pilot and launch. No spam, and you can ask us to remove you at any time.");
            return;
          }
          if (r.status === 400 && r.body && r.body.error && r.body.error.fields) {
            var f = r.body.error.fields, first = null;
            Object.keys(f).forEach(function (k) { if ($(k + "-err")) { setErr(k, f[k]); if (!first) first = $(k); } });
            show("bad", "Please check the form", "One or more details need fixing. The messages are shown under each field.");
            if (first) first.focus();
          } else if (r.status === 429) {
            show("bad", "Too many attempts", "Please try again in an hour, or email us instead.");
          } else {
            throw new Error("http " + r.status);
          }
        }).catch(function () {
          clearTimeout(to);
          var w = document.createElement("span");
          w.appendChild(document.createTextNode("We could not reach the server. Your details were not saved. Please try again in a minute, or "));
          w.appendChild(mailLink(data, "send them by email instead"));
          w.appendChild(document.createTextNode("."));
          show("bad", "Something went wrong", w);
        }).then(function () { busy = false; btn.disabled = false; btn.textContent = "Join the waitlist"; });
      }, wait);
    });
  }

  // ---- contact (mailto composer)
  var cf = $("contact-form");
  if (cf) {
    cf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = validateName($("c-name").value), e = validateEmail($("c-email").value), m = $("c-msg").value.trim();
      setErr("c-name", n.msg); setErr("c-email", e.msg, e.suggest); setErr("c-msg", m.length < 10 ? "Write at least a sentence (10 characters)" : "");
      if (n.msg || e.msg || m.length < 10) { (n.msg ? $("c-name") : e.msg ? $("c-email") : $("c-msg")).focus(); return; }
      var topic = $("c-topic").value;
      var body = m + "\n\n--\n" + n.value + " <" + e.value + ">";
      window.location.href = "mailto:" + (C.CONTACT_EMAIL || "") + "?subject=" + encodeURIComponent("[" + topic + "] UpGrid") + "&body=" + encodeURIComponent(body);
      var s = $("c-status"); s.hidden = false; s.textContent = "Your email app should open with the message ready to send. If nothing opens, write to us directly at the address shown above.";
    });
  }
})();
