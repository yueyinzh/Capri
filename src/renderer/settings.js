const api = window.capri;
const controls = {
  alwaysOnTop: document.querySelector("#always-on-top"),
  openAtLogin: document.querySelector("#open-at-login"),
  showTray: document.querySelector("#show-tray"),
  scale: document.querySelector("#scale"),
  scaleValue: document.querySelector("#scale-value"),
  volume: document.querySelector("#volume"),
  volumeValue: document.querySelector("#volume-value"),
  status: document.querySelector("#status"),
  resetPosition: document.querySelector("#reset-position"),
  quit: document.querySelector("#quit-app")
};

let settings;
let statusTimer = null;

function setStatus(message) {
  clearTimeout(statusTimer);
  controls.status.textContent = message;
  statusTimer = setTimeout(() => {
    controls.status.textContent = "设置会自动保存";
  }, 1800);
}

function render(nextSettings) {
  settings = nextSettings;
  controls.alwaysOnTop.checked = settings.alwaysOnTop;
  controls.openAtLogin.checked = settings.openAtLogin;
  controls.showTray.checked = settings.showTray;
  controls.scale.value = String(settings.scale);
  controls.scaleValue.textContent = `${Math.round(settings.scale * 100)}%`;
  controls.volume.value = String(settings.volume);
  controls.volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
}

async function update(patch, message = "设置已保存") {
  try {
    render(await api.updateSettings(patch));
    setStatus(message);
  } catch (error) {
    console.error(error);
    setStatus("保存失败，请查看终端");
  }
}

controls.alwaysOnTop.addEventListener("change", () => {
  update({ alwaysOnTop: controls.alwaysOnTop.checked });
});

controls.openAtLogin.addEventListener("change", () => {
  update({ openAtLogin: controls.openAtLogin.checked });
});

controls.showTray.addEventListener("change", () => {
  update({ showTray: controls.showTray.checked });
});

controls.scale.addEventListener("input", () => {
  controls.scaleValue.textContent = `${Math.round(Number(controls.scale.value) * 100)}%`;
});

controls.scale.addEventListener("change", () => {
  update({ scale: Number(controls.scale.value) }, "缩放已更新");
});

controls.volume.addEventListener("input", () => {
  controls.volumeValue.textContent = `${Math.round(Number(controls.volume.value) * 100)}%`;
});

controls.volume.addEventListener("change", () => {
  update({ volume: Number(controls.volume.value) }, "音量已更新");
});

controls.resetPosition.addEventListener("click", async () => {
  try {
    render(await api.resetPosition());
    setStatus("已回到默认位置");
  } catch (error) {
    console.error(error);
    setStatus("恢复位置失败");
  }
});

controls.quit.addEventListener("click", () => api.quit());
api.onSettingsChanged(render);

api
  .getSettings()
  .then(render)
  .catch((error) => {
    console.error(error);
    setStatus("设置读取失败");
  });
