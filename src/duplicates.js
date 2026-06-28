const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SKIP_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib",
  ".ini", ".cfg", ".env",
]);

class DuplicateFinder {
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
            try {
              const stat = fs.statSync(full);
              files.push({ filePath: full, filename: entry.name, size: stat.size, mtime: stat.mtimeMs });
            } catch {}
          }
        }
      }
    };
    for (const folder of folders) walk(folder);
    return files;
  }

  _hashFile(filePath) {
    const BUF_SIZE = 64 * 1024;
    const stat = fs.statSync(filePath);
    if (stat.size <= BUF_SIZE * 2) {
      return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
    }
    const fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(BUF_SIZE);
    const tail = Buffer.alloc(BUF_SIZE);
    fs.readSync(fd, head, 0, BUF_SIZE, 0);
    fs.readSync(fd, tail, 0, BUF_SIZE, stat.size - BUF_SIZE);
    fs.closeSync(fd);
    return crypto.createHash("md5").update(head).update(tail).update(String(stat.size)).digest("hex");
  }

  find(sourceFolders, options = {}) {
    const { fileTypes = [], minSize = 0, maxSize = Infinity } = options;

    let allFiles = this._collectFiles(sourceFolders);
    const totalFiles = allFiles.length;

    if (fileTypes.length > 0) {
      const extSet = new Set(fileTypes.map((e) => e.toLowerCase().replace(/^\./, "")));
      allFiles = allFiles.filter((f) => {
        const ext = path.extname(f.filename).toLowerCase().replace(/^\./, "");
        return extSet.has(ext);
      });
    }

    allFiles = allFiles.filter((f) => f.size >= minSize && f.size <= maxSize && f.size > 0);

    // Group by size
    const sizeGroups = new Map();
    for (const file of allFiles) {
      const key = file.size;
      if (!sizeGroups.has(key)) sizeGroups.set(key, []);
      sizeGroups.get(key).push(file);
    }

    // Hash within same-size groups
    const duplicateGroups = [];

    for (const [, sizeGroup] of sizeGroups) {
      if (sizeGroup.length < 2) continue;
      const hashGroups = new Map();
      for (const file of sizeGroup) {
        try {
          const hash = this._hashFile(file.filePath);
          file.hash = hash;
          if (!hashGroups.has(hash)) hashGroups.set(hash, []);
          hashGroups.get(hash).push(file);
        } catch {}
      }
      for (const [, hashGroup] of hashGroups) {
        if (hashGroup.length >= 2) {
          hashGroup.sort((a, b) => a.mtime - b.mtime);
          duplicateGroups.push({
            hash: hashGroup[0].hash,
            size: hashGroup[0].size,
            files: hashGroup.map((f) => ({
              filePath: f.filePath,
              filename: f.filename,
              size: f.size,
              mtime: f.mtime,
              directory: path.dirname(f.filePath),
            })),
          });
        }
      }
    }

    duplicateGroups.sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));

    const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.files.length, 0);
    const wastedBytes = duplicateGroups.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0);

    return {
      groups: duplicateGroups,
      stats: { totalFiles, filesScanned: allFiles.length, duplicateGroups: duplicateGroups.length, totalDuplicates, wastedBytes },
    };
  }
}

module.exports = { DuplicateFinder };
