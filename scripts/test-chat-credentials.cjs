const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { CredentialStore } = require("../src/main/chat/credential-store");

app.setPath("userData", path.join(os.tmpdir(), "capri-chat-credentials"));

app.whenReady().then(async () => {
  const store = new CredentialStore({ userDataDir: app.getPath("userData") });
  try {
    await store.clearApiKey();
    const saved = await store.setApiKey("test-only-not-a-real-key");
    assert.equal(saved.persisted, true);
    const loaded = await store.getApiKey();
    assert.equal(loaded.apiKey, "test-only-not-a-real-key");
    assert.ok(["keytar", "safeStorage"].includes(loaded.storage));
    if (loaded.storage === "safeStorage") {
      const raw = fs.readFileSync(store.fallbackPath, "utf8");
      assert.equal(raw.includes("test-only-not-a-real-key"), false);
    }
    await store.clearApiKey();
    assert.equal((await store.getApiKey()).apiKey, null);

    const encryptedStore = new CredentialStore({
      userDataDir: app.getPath("userData"),
      keytarProvider: () => null
    });
    const encrypted = await encryptedStore.setApiKey(
      "fallback-only-not-a-real-key"
    );
    if (encrypted.persisted) {
      assert.equal(encrypted.storage, "safeStorage");
      const raw = fs.readFileSync(encryptedStore.fallbackPath, "utf8");
      assert.equal(raw.includes("fallback-only-not-a-real-key"), false);
      assert.equal(
        (await encryptedStore.getApiKey()).apiKey,
        "fallback-only-not-a-real-key"
      );
    }
    await encryptedStore.clearApiKey();
    console.log("凭据测试通过：keytar 或系统加密回退，文件无明文");
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
