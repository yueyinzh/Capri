import { StateMachine } from "./state-machine.js";

const api = window.capri;
const shell = document.querySelector("#pet-shell");
const stage = document.querySelector("#pet-stage");
const image = document.querySelector("#pet-image");
const bubble = document.querySelector("#speech-bubble");
const bubbleText = document.querySelector("#speech-text");
const speechStatus = document.querySelector("#speech-status");
const quickActions = document.querySelector(".quick-actions");
const quickDownload = document.querySelector("#quick-download");
const quickCleaner = document.querySelector("#quick-cleaner");

const DOUBLE_CLICK_MS = 450;
const DRAG_THRESHOLD = 6;

let settings;
let emotions;
let dialogues;
let machine;
let frameRecords = new Map();
let inactivityTimer = null;
let blinkTimer = null;
let microActionTimer = null;
let bubbleTimer = null;
let bubbleHideAt = 0;
let bubbleRemainingMs = 1800;
let singleClickTimer = null;
let lastClick = null;
let pointerState = null;
let lastDialogueByGroup = new Map();
let audioContext = null;

function randomBetween(range) {
  const [min, max] = Array.isArray(range) ? range : [range, range];
  return min + Math.random() * (max - min);
}

function chooseDialogue(group) {
  const lines = dialogues[group];
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const previous = lastDialogueByGroup.get(group);
  const choices = lines.filter((line) => line !== previous);
  const pool = choices.length ? choices : lines;
  const line = pool[Math.floor(Math.random() * pool.length)];
  lastDialogueByGroup.set(group, line);
  return line;
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  bubbleHideAt = 0;
  bubbleRemainingMs = 0;
  bubble.classList.remove("is-visible");
  bubble.setAttribute("aria-hidden", "true");
  bubble.setAttribute("inert", "");
  if (bubble.contains(document.activeElement)) {
    stage.focus({ preventScroll: true });
  }
}

function scheduleBubbleHide(duration) {
  clearTimeout(bubbleTimer);
  bubbleRemainingMs = duration;
  bubbleHideAt = Date.now() + duration;
  bubbleTimer = setTimeout(() => {
    if (
      quickActions.matches(":hover") ||
      bubble.contains(document.activeElement)
    ) {
      pauseBubbleHide();
      return;
    }
    hideBubble();
  }, duration);
}

function pauseBubbleHide() {
  if (!bubble.classList.contains("is-visible")) return;
  bubbleRemainingMs = bubbleHideAt
    ? Math.max(900, bubbleHideAt - Date.now())
    : 1800;
  bubbleHideAt = 0;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
}

function resumeBubbleHide() {
  if (
    !bubble.classList.contains("is-visible") ||
    quickActions.matches(":hover") ||
    bubble.contains(document.activeElement)
  ) {
    return;
  }
  scheduleBubbleHide(Math.max(900, bubbleRemainingMs || 1800));
}

function showMessage(text, duration = 2200) {
  if (!text) return;
  bubbleText.textContent = text;
  bubble.removeAttribute("aria-hidden");
  bubble.removeAttribute("inert");
  bubble.classList.add("is-visible");
  scheduleBubbleHide(duration);
}

function showDialogue(group, duration = 2200) {
  showMessage(chooseDialogue(group), duration);
}

function setFrame(frameId) {
  const frame = frameRecords.get(frameId);
  if (!frame) {
    console.warn(`找不到表情帧：${frameId}`);
    return;
  }
  image.src = frame.url;
  image.dataset.frame = frameId;
  image.alt = `摩羯：${frame.label || frameId}`;
}

function showWakeIfNeeded() {
  if (machine.current?.name === "sleep") {
    machine.request("idle", { force: true });
    showDialogue("wake", 1300);
  }
}

function scheduleSleep() {
  clearTimeout(inactivityTimer);
  const timeout = Number(emotions.idleTimeoutMs) || 90000;
  inactivityTimer = setTimeout(() => {
    if (machine.current?.name !== "drag") {
      machine.request("sleep", { force: true });
    }
  }, timeout);
}

function registerActivity() {
  showWakeIfNeeded();
  scheduleSleep();
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (machine.current?.name === "idle") {
      machine.request("blink");
    }
    scheduleBlink();
  }, randomBetween(emotions.blinkIntervalMs));
}

function scheduleMicroAction() {
  clearTimeout(microActionTimer);
  microActionTimer = setTimeout(() => {
    if (machine.current?.name === "idle" && !pointerState?.dragging) {
      machine.request("idle", { force: true });
      if (Math.random() < 0.55) {
        showDialogue("micro", 1700);
      }
    }
    scheduleMicroAction();
  }, randomBetween(emotions.microActionIntervalMs));
}

function openQuickAction(action) {
  resetTapTimer();
  lastClick = null;
  registerActivity();
  playUiSound(720);
  document.activeElement?.blur();

  if (action === "download") {
    showMessage("正在打开视频接收终端…", 1400);
    api.openDownloader();
  } else {
    showMessage("正在打开系统清理终端…", 1400);
    api.openCleaner();
  }
}

function playUiSound(frequency = 620) {
  if (!settings || settings.volume <= 0) return;
  try {
    audioContext ||= new AudioContext();
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.045);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, settings.volume * 0.075),
      now + 0.006
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  } catch (error) {
    console.warn("界面提示音不可用：", error.message);
  }
}

function transitionFromEnd(finished) {
  if (finished.state.onEnd === "randomEmotion") {
    const pool = emotions.emotionPool.filter(
      (stateName) => stateName !== machine.current?.name
    );
    const next = pool[Math.floor(Math.random() * pool.length)] || "happy";
    machine.request(next, { force: true });
    return;
  }
  if (finished.state.onEnd === "idle") {
    machine.request("idle", { force: true });
  }
}

function createMachine() {
  return new StateMachine({
    states: emotions.states,
    onEnter: ({ name, state, frame }) => {
      setFrame(frame);
      shell.dataset.state = name;
      shell.dataset.motion = state.motion || "none";
      speechStatus.textContent = `${state.label} // ${name.toUpperCase()}`;
      if (name !== "idle" && name !== "blink") {
        const duration =
          name === "drag" ? 1800 : Math.min(state.timeoutMs ?? 2400, 2600);
        showDialogue(name, duration);
      }
    },
    onEnd: transitionFromEnd
  });
}

function resetTapTimer() {
  clearTimeout(singleClickTimer);
  singleClickTimer = null;
}

function handleSingleClick() {
  resetTapTimer();
  lastClick = null;
  registerActivity();
  playUiSound();
  machine.request("click", { force: true });
}

function finishPointer(event, { cancelled = false } = {}) {
  if (!pointerState) return;
  const state = pointerState;
  pointerState = null;
  stage.classList.remove("is-dragging");

  if (!state.dragging) {
    if (cancelled) {
      lastClick = null;
      resetTapTimer();
      return;
    }

    const now = performance.now();
    if (lastClick && now - lastClick.time <= DOUBLE_CLICK_MS) {
      resetTapTimer();
      lastClick = null;
      registerActivity();
      api.showInteractionMenu();
      return;
    }

    lastClick = { time: now };
    resetTapTimer();
    singleClickTimer = setTimeout(handleSingleClick, DOUBLE_CLICK_MS);
    return;
  }

  api.dragEnd();
  registerActivity();
  machine.request("idle", { force: true });
  showDialogue("dragEnd", 1500);
}

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  registerActivity();

  if (lastClick && performance.now() - lastClick.time <= DOUBLE_CLICK_MS) {
    resetTapTimer();
  }

  pointerState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    lastX: event.screenX,
    lastY: event.screenY,
    dragging: false
  };
});

window.addEventListener("pointermove", (event) => {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return;

  pointerState.lastX = event.screenX;
  pointerState.lastY = event.screenY;
  const distance = Math.hypot(
    event.screenX - pointerState.startX,
    event.screenY - pointerState.startY
  );

  if (!pointerState.dragging && distance >= DRAG_THRESHOLD) {
    pointerState.dragging = true;
    resetTapTimer();
    lastClick = null;
    stage.classList.add("is-dragging");
    api.dragStart({
      x: pointerState.startX,
      y: pointerState.startY
    });
    playUiSound(480);
    machine.request("drag", { force: true });
  }

  if (pointerState.dragging) {
    api.dragMove({ x: event.screenX, y: event.screenY });
  }
});

window.addEventListener("pointerup", (event) => {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return;
  finishPointer(event);
});

window.addEventListener("pointercancel", (event) => {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return;
  finishPointer(event, { cancelled: true });
});

stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  resetTapTimer();
  lastClick = null;
  registerActivity();
  api.showPetMenu();
});

stage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleSingleClick();
  }
});

quickDownload.addEventListener("click", () => openQuickAction("download"));
quickCleaner.addEventListener("click", () => openQuickAction("cleaner"));
quickActions.addEventListener("pointerenter", pauseBubbleHide);
quickActions.addEventListener("pointerleave", resumeBubbleHide);
quickActions.addEventListener("focusin", pauseBubbleHide);
quickActions.addEventListener("focusout", () => {
  setTimeout(resumeBubbleHide, 0);
});

async function preloadFrames() {
  const entries = Object.entries(emotions.frames);
  const records = new Map();
  await Promise.all(
    entries.map(async ([frameId, frame]) => {
      const asset = new Image();
      asset.src = frame.url;
      await asset.decode();
      records.set(frameId, { ...frame, element: asset });
    })
  );
  return records;
}

async function initialize() {
  const bootstrap = await api.getBootstrap();
  settings = bootstrap.settings;
  emotions = bootstrap.emotions;
  dialogues = bootstrap.dialogues;
  frameRecords = await preloadFrames();
  machine = createMachine();

  api.onSettingsChanged((nextSettings) => {
    settings = nextSettings;
  });
  api.onStateRequested(({ state, force = true }) => {
    registerActivity();
    playUiSound(540);
    machine.request(state, { force });
  });
  api.onNotice(({ message, text, state = "happy", durationMs = 2600 }) => {
    registerActivity();
    machine.request(state, { force: true });
    showMessage(message || text, durationMs);
  });

  machine.request("idle", {
    force: true,
    preferredFrame: "A1_idle"
  });
  shell.classList.add("ready");
  scheduleSleep();
  scheduleBlink();
  scheduleMicroAction();
}

window.addEventListener("beforeunload", () => {
  clearTimeout(inactivityTimer);
  clearTimeout(blinkTimer);
  clearTimeout(microActionTimer);
  clearTimeout(bubbleTimer);
  clearTimeout(singleClickTimer);
  machine?.stop();
});

initialize().catch((error) => {
  console.error(error);
  bubble.classList.add("is-visible");
  bubbleText.textContent = "素材或配置加载失败，请查看终端日志。";
});
