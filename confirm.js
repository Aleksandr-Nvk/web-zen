document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const targetUrl = params.get("target");
  const hostname = params.get("host");
  const remaining = parseInt(params.get("remaining"), 10);
  const total = parseInt(params.get("total"), 10);
  const duration = parseInt(params.get("duration"), 10);
  const streak = parseInt(params.get("streak"), 10) || 0;

  // Configurable heading
  const heading = params.get("heading");
  if (heading) {
    document.getElementById("heading").textContent = heading;
  }

  // Populate site name
  document.getElementById("siteName").textContent = hostname || "Unknown";

  // Session text
  const used = total - remaining;
  document.getElementById("sessionText").textContent = `${remaining}/${total} left`;

  // Circles: remaining (solid) first, then used (hollow)
  const circlesEl = document.getElementById("circles");
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.className = i < remaining ? "circle remaining" : "circle used";
    circlesEl.appendChild(dot);
  }

  // Streak
  document.getElementById("streakCount").textContent = streak;

  const openBtn = document.getElementById("openBtn");
  const closeBtn = document.getElementById("closeBtn");

  let seconds = 10;
  let counting = false;
  let interval = null;

  // If no sessions left, disable Open button
  if (remaining <= 0) {
    openBtn.disabled = true;
  }

  openBtn.addEventListener("click", () => {
    if (counting || remaining <= 0) return;
    counting = true;
    openBtn.disabled = true;

    // Immediately decrement the displayed count
    const newRemaining = remaining - 1;
    document.getElementById("sessionText").textContent = `${newRemaining}/${total} left`;

    // Update circles: remaining (solid) first, then used (hollow)
    circlesEl.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("div");
      dot.className = i < newRemaining ? "circle remaining" : "circle used";
      circlesEl.appendChild(dot);
    }

    openBtn.textContent = `Open (in ${seconds}s)`;

    interval = setInterval(() => {
      seconds--;
      if (seconds > 0) {
        openBtn.textContent = `Open (in ${seconds}s)`;
      } else {
        clearInterval(interval);
        openBtn.textContent = "Opening…";
        chrome.runtime.sendMessage(
          { type: "START_SESSION", hostname, targetUrl },
          (response) => {
            // background.js will navigate the tab
          }
        );
      }
    }, 1000);
  });

  closeBtn.addEventListener("click", () => {
    if (interval) clearInterval(interval);
    window.close();
  });
});
