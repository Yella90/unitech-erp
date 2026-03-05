(function () {
  function isSameOrigin(url) {
    try {
      var u = new URL(url, window.location.origin);
      return u.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function defaultFallback() {
    var path = window.location.pathname || "/";
    if (path.indexOf("/admin") === 0 || path.indexOf("/superadmin") === 0) return "/admin/dashboard";
    if (path.indexOf("/auth") === 0 || path.indexOf("/vitrine") === 0 || path.indexOf("/entreprise") === 0) return "/vitrine";
    return "/dashboard";
  }

  function resolveFallback() {
    var bodyFallback = document.body && document.body.getAttribute("data-back-fallback");
    if (bodyFallback && bodyFallback.charAt(0) === "/") return bodyFallback;
    if (document.referrer && isSameOrigin(document.referrer)) {
      try {
        var ref = new URL(document.referrer);
        if (ref.pathname && ref.pathname !== window.location.pathname) return ref.pathname + ref.search;
      } catch (_) {}
    }
    return defaultFallback();
  }

  function goBackWithFallback() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = resolveFallback();
  }

  function wireExistingButtons() {
    var nodes = document.querySelectorAll("[data-back-system='true']");
    nodes.forEach(function (el) {
      if (el.__backWired) return;
      el.__backWired = true;
      el.addEventListener("click", function (e) {
        e.preventDefault();
        goBackWithFallback();
      });
    });
    return nodes.length > 0;
  }

  function injectFloatingButton() {
    if (document.querySelector("[data-back-floating='true']")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-back-system", "true");
    btn.setAttribute("data-back-floating", "true");
    btn.setAttribute("aria-label", "Retour");
    btn.textContent = "Retour";
    btn.style.position = "fixed";
    btn.style.left = "14px";
    btn.style.bottom = "14px";
    btn.style.zIndex = "1200";
    btn.style.padding = "8px 12px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid #cbd5e1";
    btn.style.background = "#ffffff";
    btn.style.color = "#0f172a";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "700";
    btn.style.boxShadow = "0 8px 18px rgba(15, 23, 42, 0.12)";
    btn.style.cursor = "pointer";
    document.body.appendChild(btn);
    wireExistingButtons();
  }

  function init() {
    var hasExisting = wireExistingButtons();
    if (!hasExisting) injectFloatingButton();

    document.addEventListener("keydown", function (e) {
      if (e.altKey && (e.key === "ArrowLeft" || e.keyCode === 37)) {
        e.preventDefault();
        goBackWithFallback();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
