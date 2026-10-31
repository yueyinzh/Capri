const path = require("node:path");
const { app } = require("electron");
const { CleanerModule } = require("../src/main/cleaner");
const { VideoModule } = require("../src/main/video");

const rootDir = path.join(__dirname, "..");
app.setPath("userData", path.join(rootDir, ".smoke-user-data"));

let cleaner;
let video;

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
  cleaner.registerIpc();
  video.registerIpc();
  cleaner.openWindow();
  video.openWindow();
});

app.on("before-quit", () => {
  cleaner?.cleanup();
  video?.cleanup();
});

app.on("window-all-closed", () => app.quit());
