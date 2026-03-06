const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("unitechDesktop", {
  platform: process.platform
});
