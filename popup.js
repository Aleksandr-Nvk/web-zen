document.addEventListener("DOMContentLoaded", async () => {
  const websitesEl = document.getElementById("websites");
  const confirmMessageEl = document.getElementById("confirmMessage");
  const sessionCountEl = document.getElementById("sessionCount");
  const sessionDurationEl = document.getElementById("sessionDuration");
  const saveBtn = document.getElementById("save");
  const statusEl = document.getElementById("status");

  // Load current settings
  const data = await chrome.storage.local.get("settings");
  const settings = data.settings || { websites: [], sessionCount: 3, sessionDuration: 15, confirmMessage: "Is this important?" };

  websitesEl.value = settings.websites.join("\n");
  confirmMessageEl.value = settings.confirmMessage || "Is this important?";
  sessionCountEl.value = settings.sessionCount;
  sessionDurationEl.value = String(settings.sessionDuration);

  // Save
  saveBtn.addEventListener("click", async () => {
    const raw = websitesEl.value
      .split("\n")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // Deduplicate
    const websites = [...new Set(raw)];

    const newSettings = {
      websites,
      confirmMessage: confirmMessageEl.value.trim() || "Is this important?",
      sessionCount: Math.max(1, parseInt(sessionCountEl.value, 10) || 3),
      sessionDuration: parseFloat(sessionDurationEl.value) || 15
    };

    await chrome.storage.local.set({ settings: newSettings });

    statusEl.hidden = false;
    setTimeout(() => {
      statusEl.hidden = true;
    }, 2000);
  });
});
