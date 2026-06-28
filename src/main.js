const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { Organizer } = require("./organizer");
const { DuplicateFinder } = require("./duplicates");
const { FileStats } = require("./stats");

// trash is ESM-only (v10+), use dynamic import
let trashFn = null;
async function loadTrash() {
  if (!trashFn) {
    const mod = await import("trash");
    trashFn = mod.default || mod;
  }
  return trashFn;
}

let mainWindow;
const DATA_DIR = path.join(app.getPath("userData"), "organizer-data");
const HISTORY_FILE = path.join(DATA_DIR, "move-history.json");
const TAXONOMY_FILE = path.join(DATA_DIR, "taxonomy.json");
const CUSTOM_KEYWORDS_FILE = path.join(DATA_DIR, "custom-keywords.json");
const PREFS_FILE = path.join(DATA_DIR, "preferences.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const RECENT_FILE = path.join(DATA_DIR, "recent-folders.json");

const DEFAULT_PREFS = { theme: "dark", language: "en" };

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function loadJSON(filePath, fallback) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {}
  return fallback;
}

function saveJSON(filePath, data) { ensureDataDir(); fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }

function addRecentFolder(folderPath) {
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
    width: 1060, height: 780, minWidth: 800, minHeight: 600,
    title: "Asset Organizer",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: prefs.theme === "light" ? "#f5f6fa" : prefs.theme === "midnight" ? "#0d0f14" : prefs.theme === "amoled" ? "#000000" : "#0f1117",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
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
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Select Main Assets Folder (Destination)" });
  if (r.canceled || !r.filePaths.length) return null;
  addRecentFolder(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle("select-source-folders", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "multiSelections"], title: "Select Source Folder(s)" });
  if (r.canceled || !r.filePaths.length) return [];
  for (const f of r.filePaths) addRecentFolder(f);
  return r.filePaths;
});

ipcMain.handle("select-stats-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Select Folder to Analyze" });
  if (r.canceled || !r.filePaths.length) return null;
  addRecentFolder(r.filePaths[0]);
  return r.filePaths[0];
});

// Recent folders
ipcMain.handle("get-recent", () => loadJSON(RECENT_FILE, []));

// Favorites
ipcMain.handle("get-favorites", () => loadJSON(FAVORITES_FILE, []));
ipcMain.handle("save-favorites", (_e, favs) => { saveJSON(FAVORITES_FILE, favs); return true; });

// Taxonomy
ipcMain.handle("get-taxonomy", () => {
  const custom = loadJSON(TAXONOMY_FILE, null);
  const customKw = loadJSON(CUSTOM_KEYWORDS_FILE, {});
  const base = require("./taxonomy.json");
  if (Object.keys(customKw).length > 0) {
    for (const [cat, subs] of Object.entries(base)) {
      for (const [sub, keywords] of Object.entries(subs)) {
        const key = `${cat}::${sub}`;
        if (customKw[key]) base[cat][sub] = [...new Set([...keywords, ...customKw[key]])];
      }
    }
  }
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
  history.push({ id: Date.now().toString(36), timestamp: new Date().toISOString(), sourceFolders, destFolder, moves: result.moves, unmoved: result.unmoved });
  if (history.length > 20) history.splice(0, history.length - 20);
  saveJSON(HISTORY_FILE, history);
  return result;
});

// History
ipcMain.handle("get-history", () => loadJSON(HISTORY_FILE, []));
ipcMain.handle("undo", async (_e, historyId) => {
  const history = loadJSON(HISTORY_FILE, []);
  const entry = history.find((h) => h.id === historyId);
  if (!entry) return { success: false, error: "History entry not found" };
  let undone = 0; const errors = [];
  for (const move of entry.moves) {
    try {
      if (fs.existsSync(move.to) && !fs.existsSync(move.from)) {
        const dir = path.dirname(move.from);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(move.to, move.from); undone++;
      }
    } catch (err) { errors.push({ file: move.from, error: err.message }); }
  }
  history.splice(history.indexOf(entry), 1);
  saveJSON(HISTORY_FILE, history);
  return { success: true, undone, errors };
});

// Duplicates
ipcMain.handle("find-duplicates", async (_e, { sourceFolders, options }) => {
  return new DuplicateFinder().find(sourceFolders, options);
});
ipcMain.handle("trash-duplicates", async (_e, filePaths) => {
  let trash;
  try {
    const mod = await import("trash");
    trash = mod.default || mod;
  } catch (_) {}

  const { execSync } = require("child_process");
  let trashed = 0; const errors = [];

  for (const fp of filePaths) {
    try {
      if (!fs.existsSync(fp)) continue;
      let success = false;

      // Try trash package first
      if (trash) {
        try { await trash(fp); success = true; } catch (_) {}
      }

      // Fallback: PowerShell Shell recycle bin (works cross-drive too)
      if (!success) {
        try {
          const psScript = `$shell = New-Object -ComObject Shell.Application; $shell.Namespace(0xA).MoveHere('${fp.replace(/'/g, "''")}')`;
          execSync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 10000, windowsHide: true });
          success = true;
        } catch (_) {}
      }

      // Last resort: permanently delete
      if (!success) {
        try { fs.unlinkSync(fp); success = true; } catch (_) {}
      }

      if (success && !fs.existsSync(fp)) {
        trashed++;
      } else if (fs.existsSync(fp)) {
        errors.push({ file: fp, error: "File still exists after delete attempt" });
      } else {
        trashed++;
      }
    } catch (err) { errors.push({ file: fp, error: err.message }); }
  }
  return { trashed, errors };
});

// File Statistics
ipcMain.handle("analyze-folder", async (_e, folders) => {
  const folderList = Array.isArray(folders) ? folders : [folders];
  return new FileStats().analyze(folderList);
});

// Export
ipcMain.handle("export-csv", async (_e, { data, defaultName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "report.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, data, "utf-8");
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
ipcMain.handle("select-rename-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Select Folder to Rename Files In" });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

const RENAME_HISTORY_FILE = path.join(DATA_DIR, "rename-history.json");

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
        if (filterExts.length > 0 && !filterExts.some(ft => ext === ("." + ft.replace(/^\./, "")))) continue;
        const stat = fs.statSync(full);
        files.push({ filePath: full, filename: entry.name, ext, size: stat.size, directory: pathMod.dirname(full) });
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
          newTo = path.join(toDir, base + "_" + counter + ext);
          counter++;
        }
        r.to = newTo;
      }
      fs.renameSync(r.from, r.to);
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
  const entry = hist.find(h => h.id === sessionId);
  if (!entry) return { success: false, error: "Session not found" };
  let undone = 0; const errors = [];
  for (const r of entry.renames) {
    try {
      if (fs.existsSync(r.to) && !fs.existsSync(r.from)) {
        const dir = path.dirname(r.from);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(r.to, r.from);
        undone++;
      }
    } catch (err) { errors.push({ file: r.from, error: err.message }); }
  }
  hist.splice(hist.indexOf(entry), 1);
  saveJSON(RENAME_HISTORY_FILE, hist);
  return { success: true, undone, errors };
});

ipcMain.handle("get-rename-history", () => loadJSON(RENAME_HISTORY_FILE, []));

// Shell
ipcMain.handle("open-folder", (_e, p) => shell.openPath(p));
ipcMain.handle("open-in-explorer", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));
