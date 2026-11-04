const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");
const { ChatModule } = require("../src/main/chat");
const { CleanerModule } = require("../src/main/cleaner");
const { VideoModule } = require("../src/main/video");

const rootDir = path.join(__dirname, "..");
app.setPath("userData", path.join(rootDir, ".smoke-user-data"));

let cleaner;
let video;
let chat;
let exitTimer = null;

app.whenReady().then(() => {
  const notifyPet = async (notice, state) => {
    const normalized =
      typeof notice === "string" ? { message: notice, state } : notice;
    console.log("SMOKE_NOTIFY", JSON.stringify(normalized));
  };
  cleaner = new CleanerModule({
    rootDir,
    ownerWindowProvider: () => null,
    notifyPet
  });
  video = new VideoModule({
    rootDir,
    notifyPet,
    outputRoot: path.join(rootDir, ".smoke-user-data", "Downloads", "CAPRI")
  });
  chat = new ChatModule({
    rootDir,
    userDataDir: app.getPath("userData"),
    ownerWindowProvider: () => null,
    sendToPet: (channel, payload) =>
      console.log("SMOKE_PET", channel, JSON.stringify(payload)),
    showPetInactive: () => {},
    notifyPet
  });
  cleaner.registerIpc();
  video.registerIpc();
  chat.registerIpc();
  cleaner.openWindow();
  video.openWindow();
  chat.openWindow();

  const screenshotPath = process.env.CAPRI_SMOKE_SCREENSHOT;
  if (screenshotPath) {
    setTimeout(async () => {
      const image = await chat.window?.webContents.capturePage();
      if (image && !image.isEmpty()) {
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, image.toPNG());
        console.log("SMOKE_SCREENSHOT", screenshotPath);
      }
    }, 1500);
  }

  const exitAfterMs = Number(process.env.CAPRI_SMOKE_EXIT_MS) || 0;
  if (exitAfterMs > 0) {
    exitTimer = setTimeout(() => app.quit(), exitAfterMs);
  }
});

app.on("before-quit", () => {
  clearTimeout(exitTimer);
  cleaner?.cleanup();
  video?.cleanup();
  chat?.cleanup();
});

app.on("window-all-closed", () => app.quit());
