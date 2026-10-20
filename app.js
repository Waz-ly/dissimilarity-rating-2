(() => {
  const C = CONFIG;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const params = new URLSearchParams(location.search);
  const TEST = params.get("test") === "1";
  // Optional ?pid=... lets you label participants; otherwise a random id is used.
  const PID = params.get("pid") ||
    (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));

  // ---------------- state ----------------
  const S = {
    stimuli: [],          // file names, alphabetical
    order: [],            // [[a, b], ...] shuffled pair order
    matrix: [],
    pairNumber: 0,        // number of completed pairs
    score: C.SCALE_INITIAL,
    rated: false,
    phase: "intro",       // intro | preview | trial | break | done
    previewIndex: 0,
    playingSide: null,    // "A" | "B" | null
    plays: { A: 0, B: 0 },
    trialStart: 0,
    breakEnd: 0,
    breakTimer: null,
    breakInterval: C.BREAK_INTERVAL,
    configured: !C.APPS_SCRIPT_URL.startsWith("PASTE_"),
  };

  const player = new Audio();
  player.volume = 0.7;
  player.preload = "auto";

  // ---------------- screens ----------------
  const SCREENS = ["intro", "preview", "trial", "break", "done"];
  function show(name) {
    S.phase = name;
    for (const s of SCREENS) $("screen-" + s).hidden = s !== name;
  }

  // ---------------- saving (queue + retry) ----------------
  const queue = [];
  let flushing = false;
  let failures = 0;

  function updateSaveStatus() {
    if (S.phase !== "done") return;
    if (!S.configured) {
      $("save-status").textContent = "Saving is not configured. Please download the backup copy below.";
    } else if (queue.length === 0) {
      $("save-status").textContent = "All responses saved. You can close this page.";
    } else {
      $("save-status").textContent = `Saving your responses… (${queue.length} pending)`;
    }
    const showBackup = !S.configured || failures >= 3;
    $("btn-backup").hidden = !showBackup;
    $("backup-note").hidden = !showBackup;
  }

  function send(item) {
    item.participant_id = PID;
    item.test_mode = TEST;
    queue.push(item);
    flush();
  }

  async function flush() {
    if (flushing || !S.configured) return;
    flushing = true;
    try {
      while (queue.length) {
        try {
          // text/plain keeps this a "simple" request (no CORS preflight, which Apps Script can't answer).
          const res = await fetch(C.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(queue[0]),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "server error");
          queue.shift();
          failures = 0;
        } catch (err) {
          console.warn("Save failed, will retry:", err);
          failures++;
          updateSaveStatus();
          await sleep(Math.min(1000 * 2 ** Math.min(failures, 4), 15000));
        }
        updateSaveStatus();
      }
    } finally {
      flushing = false;
    }
  }

  function matrixText() {
    return S.matrix.map((row) => row.map((v) => v.toFixed(2)).join(" ")).join("\n") + "\n";
  }

  $("btn-backup").addEventListener("click", () => {
    const blob = new Blob([matrixText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dissimilarity_matrix.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------------- setup ----------------
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  function buildTrials() {
    const n = S.stimuli.length;
    const order = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) order.push(shuffle([i, j]));
    S.order = shuffle(order);
    S.matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  }

  function updateIntroCounts() {
    const n = S.stimuli.length;
    $("n-sounds").textContent = n;
    $("n-pairs").textContent = (n * (n - 1)) / 2;
  }

  async function init() {
    if (TEST) {
      $("test-banner").hidden = false;
      $("test-banner").textContent =
        `TEST MODE (${C.TEST_STIMULI_COUNT} clips, break every ${C.TEST_BREAK_INTERVAL} pairs)`;
    }
    try {
      const res = await fetch(C.MANIFEST, { cache: "no-store" });
      let list = await res.json();
      list = list.slice().sort();
      if (TEST) {
        list = list.slice(0, C.TEST_STIMULI_COUNT);
        S.breakInterval = C.TEST_BREAK_INTERVAL;
      }
      S.stimuli = list;
      updateIntroCounts();
      $("intro-status").textContent = S.configured
        ? ""
        : "Warning: APPS_SCRIPT_URL is not set in config.js — results will not be saved.";
      $("btn-start").disabled = false;
    } catch (e) {
      $("intro-status").textContent = "Could not load sounds.json. Run make_manifest.py and redeploy.";
    }
  }

  const soundURL = (i) => C.SOUNDS_DIR + encodeURIComponent(S.stimuli[i]);

  // ---------------- preview ----------------
  $("btn-start").addEventListener("click", () => {
    if (S.phase !== "intro" || !S.stimuli.length) return;
    buildTrials();
    show("preview");
    S.previewIndex = 0;
    playPreview();
  });

  function playPreview() {
    const total = S.stimuli.length;
    $("preview-progress").textContent = `Now playing ${S.previewIndex + 1} of ${total}`;
    $("btn-preview-retry").hidden = true;
    player.src = soundURL(S.previewIndex);
    player.play().catch(() => {
      // Autoplay blocked or load failed; let the participant click to continue.
      $("btn-preview-retry").hidden = false;
    });
  }
  $("btn-preview-retry").addEventListener("click", playPreview);

  function onEnded() {
    if (S.phase === "preview") {
      S.previewIndex++;
      if (S.previewIndex >= S.stimuli.length) {
        startTrials();
      } else {
        setTimeout(() => { if (S.phase === "preview") playPreview(); }, C.PREVIEW_GAP_MS);
      }
    } else if (S.phase === "trial") {
      S.playingSide = null;
      renderPlayButtons();
    }
  }
  player.addEventListener("ended", onEnded);

  // ---------------- trials ----------------
  const PLAY_SVG = (label) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="4"/><polygon points="40,28 40,72 74,50" fill="currentColor"/><text class="label" x="50" y="94" text-anchor="middle">${label}</text></svg>`;
  const PAUSE_SVG = (label) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="4"/><rect x="34" y="28" width="11" height="44" fill="currentColor"/><rect x="55" y="28" width="11" height="44" fill="currentColor"/><text class="label" x="50" y="94" text-anchor="middle">${label}</text></svg>`;

  function renderPlayButtons() {
    $("btn-A").innerHTML = S.playingSide === "A" ? PAUSE_SVG("A") : PLAY_SVG("A");
    $("btn-B").innerHTML = S.playingSide === "B" ? PAUSE_SVG("B") : PLAY_SVG("B");
  }

  function stopAudio() {
    player.pause();
    try { player.currentTime = 0; } catch (_) {}
    S.playingSide = null;
  }

  function togglePlay(side) {
    if (S.phase !== "trial") return;
    if (S.playingSide === side && !player.paused) {
      stopAudio();
      renderPlayButtons();
      return;
    }
    const pair = S.order[S.pairNumber];
    const idx = pair[side === "A" ? 0 : 1];
    player.src = soundURL(idx);
    player.play().catch((e) => console.warn("Playback failed:", e));
    S.playingSide = side;
    S.plays[side]++;
    renderPlayButtons();
  }
  $("btn-A").addEventListener("click", () => togglePlay("A"));
  $("btn-B").addEventListener("click", () => togglePlay("B"));

  function startTrials() {
    show("trial");
    beginPair();
  }

  function beginPair() {
    S.rated = false;
    S.score = C.SCALE_INITIAL;
    S.plays = { A: 0, B: 0 };
    S.playingSide = null;
    S.trialStart = performance.now();
    $("btn-next").hidden = true;
    $("pair-number").textContent = S.pairNumber;
    renderPlayButtons();
    renderScale();
  }

  // ---------------- scale ----------------
  const hit = $("scale-hit");
  let dragging = false;

  function buildTicks() {
    const box = $("scale-ticks");
    box.innerHTML = "";
    for (let v = C.SCALE_MIN; v <= C.SCALE_MAX; v++) {
      const frac = (v - C.SCALE_MIN) / (C.SCALE_MAX - C.SCALE_MIN);
      const t = document.createElement("div");
      t.className = "tick";
      t.style.top = `calc(${(1 - frac) * 100}% - 1.5px)`;
      t.innerHTML = `<span>${v}</span>`;
      box.appendChild(t);
    }
  }

  function renderScale() {
    const frac = (S.score - C.SCALE_MIN) / (C.SCALE_MAX - C.SCALE_MIN);
    $("scale-indicator").style.top = `${(1 - frac) * 100}%`;
    $("scale-value").textContent = S.score.toFixed(1);
  }

  function scoreFromPointer(e) {
    const r = hit.getBoundingClientRect();
    const rel = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    // top = most dissimilar (max), bottom = least dissimilar (min)
    S.score = C.SCALE_MAX - rel * (C.SCALE_MAX - C.SCALE_MIN);
    if (!S.rated) {
      S.rated = true;
      $("btn-next").hidden = false;
    }
    renderScale();
  }

  hit.addEventListener("pointerdown", (e) => {
    if (S.phase !== "trial") return;
    dragging = true;
    hit.setPointerCapture(e.pointerId);
    scoreFromPointer(e);
  });
  hit.addEventListener("pointermove", (e) => { if (dragging) scoreFromPointer(e); });
  const endDrag = () => { dragging = false; };
  hit.addEventListener("pointerup", endDrag);
  hit.addEventListener("pointercancel", endDrag);

  // ---------------- next / break / finish ----------------
  $("btn-next").addEventListener("click", () => {
    if (S.phase !== "trial" || !S.rated) return;
    stopAudio();

    const [a, b] = S.order[S.pairNumber];
    const rating = Math.round(S.score * 100) / 100;
    S.matrix[a][b] = S.matrix[b][a] = rating;

    send({
      type: "rating",
      key: `${PID}:${S.pairNumber}`,
      trial: S.pairNumber + 1,
      stim_A: S.stimuli[a],
      stim_B: S.stimuli[b],
      rating,
      rt_ms: Math.round(performance.now() - S.trialStart),
      plays_A: S.plays.A,
      plays_B: S.plays.B,
    });

    S.pairNumber++;

    if (S.pairNumber >= S.order.length) return finish();

    if (S.pairNumber % S.breakInterval === 0) {
      startBreak();
    } else {
      beginPair();
    }
  });

  function startBreak() {
    show("break");
    S.breakEnd = Date.now() + C.BREAK_SECONDS * 1000;
    $("break-count").textContent = `You've rated ${S.pairNumber} pairs so far.`;
    const tick = () => {
      const left = Math.max(0, Math.ceil((S.breakEnd - Date.now()) / 1000));
      $("break-timer").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    };
    tick();
    clearInterval(S.breakTimer);
    S.breakTimer = setInterval(tick, 250);
  }

  $("btn-continue").addEventListener("click", () => {
    if (S.phase !== "break") return;
    clearInterval(S.breakTimer);
    show("trial");
    beginPair();
  });

  function finish() {
    show("done");
    send({
      type: "complete",
      stimuli: S.stimuli,
      matrix: S.matrix,
    });
    updateSaveStatus();
  }

  // Warn if leaving with unsent data.
  window.addEventListener("beforeunload", (e) => {
    if (queue.length || (S.phase !== "intro" && S.phase !== "done")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  buildTicks();
  init();
})();
