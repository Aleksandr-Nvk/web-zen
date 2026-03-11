// === Focus Guard — Background Service Worker ===

const DEFAULT_SETTINGS = {
  websites: [],
  sessionCount: 3,
  sessionDuration: 15, // minutes
  confirmMessage: "Is this important?"
};

// ---- Storage helpers ----

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return data.settings || { ...DEFAULT_SETTINGS };
}

async function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function getUsageData() {
  const key = await getTodayKey();
  const data = await chrome.storage.local.get(key);
  return { key, usage: data[key] || {} };
}

async function saveUsageData(key, usage) {
  await chrome.storage.local.set({ [key]: usage });
}

// Returns { used, remaining, activeSince } for a given hostname today
async function getHostUsage(hostname) {
  const settings = await getSettings();
  const { key, usage } = await getUsageData();
  const entry = usage[hostname] || { count: 0, activeSince: null };
  return {
    count: entry.count,
    remaining: settings.sessionCount - entry.count,
    total: settings.sessionCount,
    activeSince: entry.activeSince,
    sessionDuration: settings.sessionDuration
  };
}

// ---- Streak tracking ----

async function getStreak() {
  const data = await chrome.storage.local.get("streak");
  return data.streak || { count: 0, lastDate: null };
}

async function updateStreak() {
  const todayKey = await getTodayKey();
  const streak = await getStreak();

  if (streak.lastDate === todayKey) {
    return streak.count; // already counted today
  }

  // Check if yesterday was tracked
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  if (streak.lastDate === yKey) {
    streak.count += 1;
  } else if (streak.lastDate !== null) {
    streak.count = 1; // streak broken
  } else {
    streak.count = 1; // first ever day
  }
  streak.lastDate = todayKey;
  await chrome.storage.local.set({ streak });
  return streak.count;
}

// ---- Hostname matching ----

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function isTrackedSite(hostname) {
  if (!hostname) return false;
  const settings = await getSettings();
  const h = hostname.toLowerCase();
  return settings.websites.some((site) => {
    const clean = site.replace(/^www\./, "").toLowerCase();
    return h === clean || h.endsWith("." + clean);
  });
}

// ---- URL matching ----

async function isTrackedUrl(url) {
  if (!url) return false;
  const settings = await getSettings();
  const lower = url.toLowerCase();
  return settings.websites.some((site) => {
    const clean = site.replace(/^www\./, "").toLowerCase();
    return lower.includes(clean);
  });
}

// ---- Navigation interception ----

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only handle top-level frames
  if (details.frameId !== 0) return;

  const url = details.url;
  if (!(await isTrackedUrl(url))) return;

  const hostname = extractHostname(url);

  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab) return;

  // If the tab is already showing our confirm page, don't redirect again
  const currentUrl = tab.url || tab.pendingUrl || "";
  if (currentUrl.startsWith(chrome.runtime.getURL("confirm.html"))) {
    return;
  }

  const hostUsage = await getHostUsage(hostname);

  // If there is an active session, check if it has expired
  if (hostUsage.activeSince) {
    const elapsed = (Date.now() - hostUsage.activeSince) / 1000 / 60;
    if (elapsed >= hostUsage.sessionDuration) {
      // Session expired — clear activeSince and show confirmation again
      const { key, usage } = await getUsageData();
      if (usage[hostname]) {
        usage[hostname].activeSince = null;
      }
      await saveUsageData(key, usage);
      const updatedUsage = await getHostUsage(hostname);
      const settings = await getSettings();
      const streak = await updateStreak();
      chrome.tabs.update(details.tabId, {
        url: chrome.runtime.getURL(
          `confirm.html?target=${encodeURIComponent(url)}&host=${encodeURIComponent(hostname)}&remaining=${updatedUsage.remaining}&total=${updatedUsage.total}&duration=${updatedUsage.sessionDuration}&streak=${streak}&heading=${encodeURIComponent(settings.confirmMessage || DEFAULT_SETTINGS.confirmMessage)}`
        )
      });
      return;
    }
    // Session still valid, allow navigation
    return;
  }

  // No active session — show confirmation page (Open disabled if remaining=0)
  const settings = await getSettings();
  const streak = await updateStreak();
  chrome.tabs.update(details.tabId, {
    url: chrome.runtime.getURL(
      `confirm.html?target=${encodeURIComponent(url)}&host=${encodeURIComponent(hostname)}&remaining=${hostUsage.remaining}&total=${hostUsage.total}&duration=${hostUsage.sessionDuration}&streak=${streak}&heading=${encodeURIComponent(settings.confirmMessage || DEFAULT_SETTINGS.confirmMessage)}`
    )
  });
});

// ---- Messages from confirm page ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_SESSION") {
    handleStartSession(msg.hostname, msg.targetUrl, sender.tab?.id).then(sendResponse);
    return true; // async
  }
  if (msg.type === "GET_STATUS") {
    getHostUsage(msg.hostname).then(sendResponse);
    return true;
  }
});

async function handleStartSession(hostname, targetUrl, tabId) {
  const settings = await getSettings();
  const { key, usage } = await getUsageData();

  if (!usage[hostname]) {
    usage[hostname] = { count: 0, activeSince: null };
  }

  if (usage[hostname].count >= settings.sessionCount) {
    return { ok: false, reason: "limit" };
  }

  usage[hostname].count += 1;
  usage[hostname].activeSince = Date.now();
  await saveUsageData(key, usage);

  // Set an alarm to block the tab when the session expires
  const alarmName = `session_${tabId}_${hostname}`;
  chrome.alarms.create(alarmName, { delayInMinutes: settings.sessionDuration });

  // Navigate the tab to the actual site
  if (tabId) {
    chrome.tabs.update(tabId, { url: targetUrl });
  }

  return { ok: true, remaining: settings.sessionCount - usage[hostname].count };
}

// ---- Alarm handler: session expired ----

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("session_")) return;

  const parts = alarm.name.split("_");
  const tabId = parseInt(parts[1], 10);
  const hostname = parts.slice(2).join("_");

  // Clear active session
  const { key, usage } = await getUsageData();
  if (usage[hostname]) {
    usage[hostname].activeSince = null;
    await saveUsageData(key, usage);
  }

  // Try to redirect the tab — always show confirmation screen
  try {
    const tab = await chrome.tabs.get(tabId);
    const tabHost = extractHostname(tab.url);
    if (tabHost && tabHost.replace(/^www\./, "") === hostname) {
      const hostUsage = await getHostUsage(hostname);
      const settings = await getSettings();
      const streak = await updateStreak();
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(
          `confirm.html?target=${encodeURIComponent(tab.url)}&host=${encodeURIComponent(hostname)}&remaining=${hostUsage.remaining}&total=${hostUsage.total}&duration=${hostUsage.sessionDuration}&streak=${streak}&heading=${encodeURIComponent(settings.confirmMessage || DEFAULT_SETTINGS.confirmMessage)}`
        )
      });
    }
  } catch {
    // Tab may have been closed
  }
});

// ---- Midnight reset alarm ----

chrome.runtime.onInstalled.addListener(() => {
  scheduleMidnightReset();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleMidnightReset();
});

function scheduleMidnightReset() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const delayMs = midnight.getTime() - now.getTime();
  chrome.alarms.create("midnight_reset", { delayInMinutes: delayMs / 60000, periodInMinutes: 1440 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "midnight_reset") {
    // Clean up old usage keys (anything that is not today)
    const todayKey = await getTodayKey();
    const all = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(
      (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k !== todayKey
    );
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  }
});
