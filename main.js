// Electron ana süreç — oyunu native bir masaüstü penceresinde açar (tarayıcı/website DEĞİL).
const { app, BrowserWindow, Menu, globalShortcut } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#05080a",
    title: "100 Gün Ormanda",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile("index.html");

  // F11 ile tam ekran
  globalShortcut.register("F11", () => win.setFullScreen(!win.isFullScreen()));
  // F12 geliştirici konsolu (hata ayıklama)
  globalShortcut.register("F12", () => win.webContents.toggleDevTools());

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());
