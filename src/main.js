const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { Organizer } = require("./organizer");
const { DuplicateFinder } = require("./duplicates");
const { FileStats } = require("./stats");

let mainWindow;
const DATA_DIR = path.join(app.getPath("userData"), "organizer-data");
const HISTORY_FILE = path.join(DATA_DIR, "move-history.json");
const TAXONOMY_FILE = path.join(DATA_DIR, "taxonomy.json");
const CUSTOM_KEYWORDS_FILE = path.join(DATA_DIR, "custom-keywords.json");
const PREFS_FILE = path.join(DATA_DIR, "preferences.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const RECENT_FILE = path.join(DATA_DIR, "recent-folders.json");
const RENAME_HISTORY_FILE = path.join(DATA_DIR, "rename-history.json");

const DEFAULT_PREFS = { theme: "dark", language: "en" };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return fallback;
}

function saveJSON(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function addRecentFolder(folderPath) {
  if (!folderPath) return;
  const recent = loadJSON(RECENT_FILE, []);
  const idx = recent.indexOf(folderPath);
  if (idx !== -1) recent.splice(idx, 1);
  recent.unshift(folderPath);
  if (recent.length > 20) recent.length = 20;
  saveJSON(RECENT_FILE, recent);
}

function createWindow() {
  const prefs = loadJSON(PREFS_FILE, DEFAULT_PREFS);
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    title: "Asset Organizer",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: prefs.theme === "light" ? "#f5f6fa" : prefs.theme === "midnight" ? "#0d0f14" : prefs.theme === "amoled" ? "#000000" : "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.handle("get-prefs", () => loadJSON(PREFS_FILE, DEFAULT_PREFS));
ipcMain.handle("save-prefs", (_e, prefs) => { saveJSON(PREFS_FILE, prefs); return true; });
ipcMain.handle("get-i18n", () => loadJSON(path.join(__dirname, "i18n.json"), {}));

// Folder pickers
ipcMain.handle("select-dest-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Main Assets Folder (Destination)",
  });
  if (r.canceled || !r.filePaths.length) return null;
  addRecentFolder(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle("select-source-folders", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "multiSelections"],
    title: "Select Source Folder(s)",
  });
  if (r.canceled || !r.filePaths.length) return [];
  for (const f of r.filePaths) addRecentFolder(f);
  return r.filePaths;
});

ipcMain.handle("select-stats-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder to Analyze",
  });
  if (r.canceled || !r.filePaths.length) return null;
  addRecentFolder(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle("select-rename-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder to Rename Files In",
  });
  if (r.canceled || !r.filePaths.length) return null;
  addRecentFolder(r.filePaths[0]);
  return r.filePaths[0];
});

// Recent & Favorites
ipcMain.handle("get-recent", () => loadJSON(RECENT_FILE, []));
ipcMain.handle("get-favorites", () => loadJSON(FAVORITES_FILE, []));
ipcMain.handle("save-favorites", (_e, favs) => { saveJSON(FAVORITES_FILE, favs); return true; });

// Taxonomy
ipcMain.handle("get-taxonomy", () => {
  const custom = loadJSON(TAXONOMY_FILE, null);
  const base = JSON.parse(JSON.stringify(require("./taxonomy.json")));
  return custom || base;
});
ipcMain.handle("save-taxonomy", (_e, taxonomy) => { saveJSON(TAXONOMY_FILE, taxonomy); return true; });

// Preview & Organize
ipcMain.handle("preview", async (_e, { sourceFolders, options }) => {
  const taxonomy = loadJSON(TAXONOMY_FILE, null) || require("./taxonomy.json");
  const customKw = loadJSON(CUSTOM_KEYWORDS_FILE, {});
  return new Organizer(taxonomy, customKw).preview(sourceFolders, options);
});

ipcMain.handle("organize", async (_e, { sourceFolders, destFolder, plan, options }) => {
  const taxonomy = loadJSON(TAXONOMY_FILE, null) || require("./taxonomy.json");
  const customKw = loadJSON(CUSTOM_KEYWORDS_FILE, {});
  const result = new Organizer(taxonomy, customKw).execute(sourceFolders, destFolder, plan, options);
  const history = loadJSON(HISTORY_FILE, []);
  history.push({
    id: Date.now().toString(36),
    timestamp: new Date().toISOString(),
    sourceFolders,
    destFolder,
    mode: options?.copyInstead ? "copy" : "move",
    moves: result.moves,
    unmoved: result.unmoved || [],
    errors: result.errors || [],
  });
  if (history.length > 30) history.splice(0, history.length - 30);
  saveJSON(HISTORY_FILE, history);
  return result;
});

// History & Safe Undo
ipcMain.handle("get-history", () => loadJSON(HISTORY_FILE, []));
ipcMain.handle("undo", async (_e, historyId) => {
  const history = loadJSON(HISTORY_FILE, []);
  const entry = history.find((h) => h.id === historyId);
  if (!entry) return { success: false, error: "History entry not found" };
  let undone = 0;
  const errors = [];

  for (const move of entry.moves) {
    try {
      if (entry.mode === "copy" || move.mode === "copy") {
        // Copied files: delete the duplicate created in target location
        if (fs.existsSync(move.to)) {
          await shell.trashItem(move.to);
          undone++;
        }
      } else {
        // Moved files: return from target back to source
        if (fs.existsSync(move.to)) {
          const dir = path.dirname(move.from);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          try {
            fs.renameSync(move.to, move.from);
          } catch {
            // Cross-device link fallback (EXDEV)
            fs.copyFileSync(move.to, move.from);
            fs.unlinkSync(move.to);
          }
          undone++;
        }
      }
    } catch (err) {
      errors.push({ file: move.from || move.to, error: err.message });
    }
  }

  history.splice(history.indexOf(entry), 1);
  saveJSON(HISTORY_FILE, history);
  return { success: true, undone, errors };
});

// Safe Duplicates Finder & Native Recycle Bin
ipcMain.handle("find-duplicates", async (_e, { sourceFolders, options }) => {
  return new DuplicateFinder().find(sourceFolders, options);
});

ipcMain.handle("trash-duplicates", async (_e, filePaths) => {
  let trashed = 0;
  const errors = [];
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) {
        // Native Electron cross-platform recycle bin
        await shell.trashItem(fp);
        trashed++;
      }
    } catch (err) {
      errors.push({ file: fp, error: err.message });
    }
  }
  return { trashed, errors };
});

// File Statistics
ipcMain.handle("analyze-folder", async (_e, folders) => {
  const folderList = Array.isArray(folders) ? folders : [folders];
  return new FileStats().analyze(folderList);
});

// Export (with UTF-8 BOM for Microsoft Excel compatibility)
ipcMain.handle("export-csv", async (_e, { data, defaultName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "report.csv",
    filters: [{ name: "CSV (Comma Delimited)", extensions: ["csv"] }],
  });
  if (r.canceled || !r.filePath) return false;
  // Prepend UTF-8 BOM so Microsoft Excel renders Arabic & special chars correctly
  const bomContent = data.startsWith("\uFEFF") ? data : "\uFEFF" + data;
  fs.writeFileSync(r.filePath, bomContent, "utf-8");
  return true;
});

ipcMain.handle("export-json", async (_e, { data, defaultName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "report.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, data, "utf-8");
  return true;
});

// Batch Rename
ipcMain.handle("batch-rename-scan", async (_e, { folders, options }) => {
  const pathMod = require("path");
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = pathMod.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive) walk(full);
      } else if (entry.isFile()) {
        const ext = pathMod.extname(entry.name).toLowerCase();
        const filterExts = options.fileTypes || [];
        if (filterExts.length > 0 && !filterExts.some(ft => ext === ("." + ft.replace(/^\./, "").toLowerCase()))) continue;
        try {
          const stat = fs.statSync(full);
          files.push({ filePath: full, filename: entry.name, ext, size: stat.size, directory: pathMod.dirname(full) });
        } catch {}
      }
    }
  };
  for (const f of folders) walk(f);
  return files;
});

ipcMain.handle("batch-rename-execute", async (_e, { renames, dryRun }) => {
  const results = [];
  const errors = [];
  const history = [];
  for (const r of renames) {
    try {
      if (!fs.existsSync(r.from)) { errors.push({ from: r.from, error: "Source not found" }); continue; }
      if (dryRun) {
        results.push({ from: r.from, to: r.to, status: "dry-run" });
        continue;
      }
      if (r.from === r.to) { results.push({ from: r.from, to: r.to, status: "unchanged" }); continue; }
      const toDir = path.dirname(r.to);
      if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
      if (fs.existsSync(r.to)) {
        let counter = 1;
        const ext = path.extname(r.to);
        const base = path.basename(r.to, ext);
        let newTo = r.to;
        while (fs.existsSync(newTo)) {
          newTo = path.join(toDir, `${base}_${counter}${ext}`);
          counter++;
        }
        r.to = newTo;
      }
      try {
        fs.renameSync(r.from, r.to);
      } catch {
        // Cross-device fallback
        fs.copyFileSync(r.from, r.to);
        fs.unlinkSync(r.from);
      }
      results.push({ from: r.from, to: r.to, status: "renamed" });
      history.push({ from: r.from, to: r.to });
    } catch (err) { errors.push({ from: r.from, error: err.message }); }
  }
  if (history.length > 0 && !dryRun) {
    const hist = loadJSON(RENAME_HISTORY_FILE, []);
    hist.push({ id: Date.now().toString(36), timestamp: new Date().toISOString(), renames: history });
    if (hist.length > 50) hist.splice(0, hist.length - 50);
    saveJSON(RENAME_HISTORY_FILE, hist);
  }
  return { results, errors };
});

ipcMain.handle("batch-rename-undo", async (_e, sessionId) => {
  const hist = loadJSON(RENAME_HISTORY_FILE, []);
  const entry = sessionId ? hist.find(h => h.id === sessionId) : hist[hist.length - 1];
  if (!entry) return { success: false, error: "Session not found" };
  let undone = 0;
  const errors = [];
  for (const r of entry.renames) {
    try {
      if (fs.existsSync(r.to)) {
        const dir = path.dirname(r.from);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        try {
          fs.renameSync(r.to, r.from);
        } catch {
          fs.copyFileSync(r.to, r.from);
          fs.unlinkSync(r.to);
        }
        undone++;
      }
    } catch (err) { errors.push({ file: r.from, error: err.message }); }
  }
  hist.splice(hist.indexOf(entry), 1);
  saveJSON(RENAME_HISTORY_FILE, hist);
  return { success: true, undone, errors };
});

ipcMain.handle("get-rename-history", () => loadJSON(RENAME_HISTORY_FILE, []));

// Shell utilities
ipcMain.handle("open-folder", (_e, p) => shell.openPath(p));
ipcMain.handle("open-in-explorer", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));

// Fab.com Live Search API
ipcMain.handle("search-fab", async (_e, query) => {
  const https = require("https");
  return new Promise((resolve) => {
    const url = `https://www.fab.com/i/listings/search?q=${encodeURIComponent(query)}`;
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      },
      timeout: 8000
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const results = (json.results || []).slice(0, 5).map(r => ({
            title: r.title,
            category: r.category?.name,
            productType: r.productType,
            tags: (r.tags || []).slice(0, 8).map(t => t.name)
          }));
          resolve({ success: true, results });
        } catch {
          resolve({ success: false, results: [] });
        }
      });
    });
    req.on("error", () => resolve({ success: false, results: [] }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, results: [] }); });
  });
});
