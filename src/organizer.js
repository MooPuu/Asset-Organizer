const path = require("path");
const fs = require("fs");

const SKIP_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib",
  ".git", ".ds_store", "thumbs.db",
  ".ini", ".cfg", ".env",
]);

class Organizer {
  constructor(taxonomy, customKeywords = {}) {
    this.taxonomy = taxonomy;
    this.customKeywords = customKeywords;
  }

  _buildKeywordMap() {
    const map = new Map();
    for (const [category, subcats] of Object.entries(this.taxonomy)) {
      for (const [subcategory, keywords] of Object.entries(subcats)) {
        for (const kw of keywords) {
          const key = kw.toLowerCase();
          if (!map.has(key)) map.set(key, { category, subcategory });
        }
      }
    }
    return map;
  }

  _collectFiles(folders) {
    const files = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const base = entry.name.toLowerCase();
          if (!SKIP_EXTENSIONS.has(ext) && !SKIP_EXTENSIONS.has(base)) {
            files.push(full);
          }
        }
      }
    };
    for (const folder of folders) walk(folder);
    return files;
  }

  _matchFile(filename, keywordMap) {
    const lower = filename.toLowerCase();
    const tokens = lower.split(/[\s_\-.\[\]{}()!,;]+/).filter(Boolean);
    let bestMatch = null;
    let bestScore = 0;

    for (const token of tokens) {
      if (keywordMap.has(token) && token.length > bestScore) {
        bestScore = token.length;
        bestMatch = keywordMap.get(token);
      }
    }
    for (const [kw, target] of keywordMap) {
      if (kw.length >= 3 && lower.includes(kw) && kw.length > bestScore) {
        bestScore = kw.length;
        bestMatch = target;
      }
    }
    return bestMatch;
  }

  /**
   * Preview: scan multiple source folders, return a plan.
   * Files are tagged with their sourceFolder.
   */
  preview(sourceFolders, options = {}) {
    const keywordMap = this._buildKeywordMap();
    const files = this._collectFiles(sourceFolders);
    const { fileTypes = [] } = options;

    const plan = [];
    const unmoved = [];

    for (const filePath of files) {
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();

      if (fileTypes.length > 0 && !fileTypes.some((ft) => ext === `.${ft}`)) continue;

      const match = this._matchFile(filename, keywordMap);

      if (match) {
        // Determine which source folder this file belongs to
        const sourceFolder = sourceFolders.find((sf) => filePath.startsWith(sf)) || sourceFolders[0];
        plan.push({
          from: filePath,
          filename,
          category: match.category,
          subcategory: match.subcategory,
          sourceFolder,
        });
      } else {
        unmoved.push({ from: filePath, filename });
      }
    }

    const summary = {};
    for (const item of plan) {
      const key = `${item.category} / ${item.subcategory}`;
      summary[key] = (summary[key] || 0) + 1;
    }

    return { plan, unmoved, summary, totalScanned: files.length };
  }

  /**
   * Execute: move files from source folders into destFolder organized by categories.
   */
  execute(sourceFolders, destFolder, plan, options = {}) {
    const { dryRun = false, copyInstead = false } = options;
    const moves = [];
    const errors = [];
    const unmoved = [];

    for (const item of plan) {
      const targetDir = path.join(destFolder, item.category, item.subcategory);
      let targetPath = path.join(targetDir, item.filename);

      // Handle duplicate names in destination
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(item.filename);
        const base = path.basename(item.filename, ext);
        let counter = 1;
        while (fs.existsSync(targetPath)) {
          targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
          counter++;
        }
      }

      if (dryRun) {
        moves.push({ from: item.from, to: targetPath });
        continue;
      }

      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        if (copyInstead) {
          fs.copyFileSync(item.from, targetPath);
        } else {
          try {
            fs.renameSync(item.from, targetPath);
          } catch {
            fs.copyFileSync(item.from, targetPath);
            fs.unlinkSync(item.from);
          }
        }
        moves.push({ from: item.from, to: targetPath });
      } catch (err) {
        errors.push({ file: item.from, error: err.message });
      }
    }

    return { moves, errors, unmoved };
  }
}

module.exports = { Organizer };
