const api = window.capriPetMenu;

const elements = {
  close: document.querySelector("#close-menu"),
  state: document.querySelector("#state-select"),
  stateCode: document.querySelector("#state-code"),
  alwaysOnTop: document.querySelector("#always-on-top"),
  scaleValue: document.querySelector("#scale-value"),
  scaleOptions: document.querySelector("#scale-options"),
  hidePet: document.querySelector("#hide-pet"),
  actions: [...document.querySelectorAll("[data-action]")]
};

const scaleChoices = [0.5, 0.75, 1, 1.25, 1.5, 2];
let settings = null;
let states = [];

function renderScale(nextSettings) {
  elements.scaleOptions.replaceChildren();
  elements.scaleValue.textContent = `${Math.round(nextSettings.scale * 100)}%`;

  for (const scale of scaleChoices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scale-option";
    button.textContent = `${Math.round(scale * 100)}%`;
    button.classList.toggle(
      "is-active",
      Math.abs(nextSettings.scale - scale) < 0.01
    );
    button.addEventListener("click", () => {
      api.runCommand({ action: "set-scale", scale });
    });
    elements.scaleOptions.append(button);
  }
}

function renderStateOptions() {
  const selected = elements.state.value;
  elements.state.replaceChildren(new Option("选择表情状态…", ""));
  for (const [state, label] of states) {
    elements.state.append(new Option(label, state));
  }
  if ([...elements.state.options].some((option) => option.value === selected)) {
    elements.state.value = selected;
  }
}

function render(snapshot) {
  settings = snapshot.settings;
  const nextStates = Array.isArray(snapshot.states) ? snapshot.states : [];
  if (JSON.stringify(nextStates) !== JSON.stringify(states)) {
    states = nextStates;
    renderStateOptions();
  }
  elements.state.value = "";

  elements.alwaysOnTop.setAttribute(
    "aria-checked",
    settings.alwaysOnTop ? "true" : "false"
  );
  elements.hidePet.disabled = !snapshot.showTray;
  elements.hidePet.title = snapshot.showTray
    ? ""
    : "托盘图标已关闭，无法隐藏到托盘";
  elements.stateCode.textContent =
    `STATE // ${String(states.length).padStart(2, "0")}`;
  renderScale(settings);
}

async function runCommand(command) {
  try {
    await api.runCommand(command);
  } catch (error) {
    console.error(error);
  }
}

elements.close.addEventListener("click", () => runCommand({ action: "close" }));
elements.state.addEventListener("change", () => {
  if (elements.state.value) {
    runCommand({ action: "set-state", state: elements.state.value });
  }
});
elements.alwaysOnTop.addEventListener("click", () => {
  runCommand({
    action: "toggle-always-on-top",
    value: elements.alwaysOnTop.getAttribute("aria-checked") !== "true"
  });
});

for (const button of elements.actions) {
  button.addEventListener("click", () => {
    runCommand({ action: button.dataset.action });
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    runCommand({ action: "close" });
  }
});

window.addEventListener("blur", () => {
  runCommand({ action: "close" });
});

api.onUpdate(render);
api
  .getSnapshot()
  .then(render)
  .catch((error) => console.error(error));
