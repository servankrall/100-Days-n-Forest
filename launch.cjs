#!/usr/bin/env node
/* ============================================================
   Tek-tık başlatıcı.
   Bağımlılıklar yoksa ARKA PLANDA otomatik kurar, sonra oyunu açar.
   Kullanıcı elle "npm install" yapmak zorunda değil.
   (Tek ön koşul: Node.js — https://nodejs.org)
   ============================================================ */
"use strict";
const { existsSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const root = __dirname;
const isWin = process.platform === "win32";
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: isWin });

function depsMissing() {
  return (
    !existsSync(path.join(root, "node_modules")) ||
    !existsSync(path.join(root, "node_modules", "electron")) ||
    !existsSync(path.join(root, "node_modules", "three"))
  );
}

console.log("\n🌴🔪  100 GÜN ORMANDA\n");

if (depsMissing()) {
  console.log("📦 İlk çalıştırma: gerekli dosyalar otomatik kuruluyor...");
  console.log("    (yalnızca bir kez, internet gerekir — birkaç dakika sürebilir)\n");
  const r = run("npm", ["install"]);
  if (!r || r.status !== 0) {
    console.error("\n❌ Kurulum başarısız oldu.");
    console.error("   • Node.js kurulu mu?  https://nodejs.org");
    console.error("   • İnternet bağlantın var mı?");
    process.exit(1);
  }
  console.log("\n✅ Kurulum tamam.\n");
}

console.log("🚀 Oyun açılıyor... (pencere birazdan gelecek)\n");
const g = run("npm", ["start"]);
process.exit(g && g.status ? g.status : 0);
