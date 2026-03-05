(function () {
  function safeText(value, maxLen) {
    return String(value || "").trim().slice(0, maxLen || 255);
  }

  function getVisitorToken() {
    const key = "unitech_public_visitor_token";
    try {
      const existing = safeText(localStorage.getItem(key), 96);
      if (existing) return existing;
      const token = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, token);
      return token;
    } catch (_) {
      return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function sendVisit(pagePath, geo) {
    const payload = {
      page_path: pagePath,
      visitor_token: getVisitorToken(),
      timezone: safeText(Intl.DateTimeFormat().resolvedOptions().timeZone, 120) || null,
      locale: safeText(navigator.language || "", 32) || null,
      geo: geo || null
    };

    fetch("/api/public/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function boot(pagePath) {
    const allowed = pagePath === "/vitrine" || pagePath === "/entreprise";
    if (!allowed) return;

    if (!("permissions" in navigator) || !("geolocation" in navigator)) {
      sendVisit(pagePath, null);
      return;
    }

    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!status || status.state !== "granted") {
          sendVisit(pagePath, null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            sendVisit(pagePath, {
              lat: pos && pos.coords ? pos.coords.latitude : null,
              lng: pos && pos.coords ? pos.coords.longitude : null,
              accuracy: pos && pos.coords ? pos.coords.accuracy : null
            });
          },
          () => sendVisit(pagePath, null),
          { enableHighAccuracy: false, timeout: 1500, maximumAge: 120000 }
        );
      })
      .catch(() => sendVisit(pagePath, null));
  }

  window.UNITECH_TRACK_PUBLIC_VISIT = boot;
})();
