const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SKIP_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib",
  ".ini", ".cfg", ".env",
]);

// Semantic content families to prevent cross-type false positives
// (e.g. documentation PDF files must never be grouped with asset RAR archives)
const EXTENSION_FAMILIES = {
  // Archives & Compressed Packages
  ".rar": "archive",
  ".zip": "archive",
  ".7z": "archive",
  ".tar": "archive",
  ".gz": "archive",
  ".bz2": "archive",

  // Documents & Manuals
  ".pdf": "document",
  ".doc": "document",
  ".docx": "document",
  ".txt": "document",
  ".rtf": "document",
  ".md": "document",
  ".chm": "document",

  // 3D Models
  ".fbx": "3d",
  ".obj": "3d",
  ".blend": "3d",
  ".gltf": "3d",
  ".glb": "3d",
  ".dae": "3d",
  ".max": "3d",
  ".c4d": "3d",
  ".ma": "3d",
  ".mb": "3d",
  ".usd": "3d",
  ".usda": "3d",
  ".usdc": "3d",
  ".usdz": "3d",

  // Textures & Images
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".tga": "image",
  ".tif": "image",
  ".tiff": "image",
  ".exr": "image",
  ".hdr": "image",
  ".psd": "image",
  ".bmp": "image",
  ".webp": "image",

  // Audio
  ".wav": "audio",
  ".mp3": "audio",
  ".ogg": "audio",
  ".flac": "audio",
  ".aif": "audio",
  ".aiff": "audio",

  // Video
  ".mp4": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
  ".webm": "video",

  // Unreal Engine Binaries
  ".uasset": "uasset",
  ".umap": "umap",

  // Code / Plugins
  ".cpp": "code",
  ".h": "code",
  ".hpp": "code",
  ".cs": "code",
  ".py": "code",
  ".uplugin": "plugin",
  ".uproject": "project"
};

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

  // Quick partial hash: first 64KB + file size
  _quickHash(filePath, size) {
    const BUF_SIZE = 64 * 1024;
    if (size <= BUF_SIZE) {
      return this._fullHash(filePath);
    }
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(BUF_SIZE);
    try {
      fs.readSync(fd, buf, 0, BUF_SIZE, 0);
    } finally {
      fs.closeSync(fd);
    }
    return crypto.createHash("md5").update(buf).update(String(size)).digest("hex");
  }

  // Full verification hash: streaming SHA-256 for 100% precision
  _fullHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (err) => reject(err));
    });
  }

  _getFamily(ext) {
    ext = (ext || "").toLowerCase();
    if (/^\.(00[1-9]|0[1-9][0-9])$/i.test(ext)) return "archive";
    return EXTENSION_FAMILIES[ext] || ext;
  }

  _normalizeSmartAsset(filename) {
    let ext = path.extname(filename).toLowerCase();
    let base = path.basename(filename, ext);

    // Multi-part split archive detection (.001, .002, or part1, part2)
    let isSplit = false;
    let splitIdx = 0;
    if (/^\.(00[1-9]|0[1-9][0-9])$/i.test(ext)) {
      isSplit = true;
      splitIdx = parseInt(ext.slice(1), 10);
      const inner = path.extname(base).toLowerCase();
      if ([".rar", ".zip", ".7z", ".tar"].includes(inner)) {
        base = path.basename(base, inner);
      }
    }
    const partM = base.match(/[._\-\s]part0*([1-9][0-9]*)(_[0-9]+)?$/i);
    if (partM) {
      isSplit = true;
      splitIdx = parseInt(partM[1], 10);
      base = base.slice(0, partM.index);
    }

    // Strip duplicate download suffixes: ' (1)', ' (2)' or trailing single digit '_1', '_2'
    base = base.replace(/[\s_]*\([0-9]+\)$/, "");
    base = base.replace(/_([1-9])$/, "");

    // Separate attached UE version markers: e.g. SystemUE51 -> System UE51
    base = base.replace(/([a-zA-Z])(UE\s*[0-9]+)/gi, "$1 $2");
    base = base.replace(/(UE\s*[0-9]+)([a-zA-Z])/gi, "$1 $2");

    // Strip author credits: 'by <Author>', 'by Kekdot', etc.
    base = base.replace(/\bby\s+[a-zA-Z0-9_\-.]+\b/gi, " ");

    // Extract version if present for display label
    let version = "";
    const vMatch = base.match(/(?:[._\-\s]|^)(?:UE|v|version)?[._\-\s]*([0-9]+(?:\.[0-9]+)+|[0-9]+_[0-9]+)\+?(?:[._\-\s]|$)/i);
    if (vMatch) {
      version = vMatch[1].replace(/_/g, ".");
    }

    // Strip version patterns: UE5.1+, UE51, V4, v5.7, 5.3+, etc.
    base = base.replace(/(?:^|[._\-\s])(?:UE\s*)[0-9]{2,3}(?:\+)?(?=[._\-\s]|$)/gi, " ");
    base = base.replace(/(?:^|[._\-\s])(?:UE|v|version)[._\-\s]*[0-9]+(?:\.[0-9]+)*\+?(?=[._\-\s]|$)/gi, " ");
    base = base.replace(/(?:^|[._\-\s])[0-9]+(?:\.[0-9]+)+\+?(?=[._\-\s]|$)/gi, " ");
    base = base.replace(/(?:^|[._\-\s])v[0-9]+(?=[._\-\s]|$)/gi, " ");

    // Strip packaging words like 'Template'
    base = base.replace(/\btemplate\b/gi, " ");

    // Normalized title
    let title = base
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();

    // Human readable asset label
    let label = title.toUpperCase();

    const family = this._getFamily(ext);

    return {
      title,
      version,
      isSplit,
      splitIdx,
      family,
      label,
      // Key groups by content family + normalized title, allowing cross-version duplicate detection
      key: family + " :: " + title + (isSplit ? " :: part" + splitIdx : "")
    };
  }

  _findSmartAssetDuplicates(allFiles, totalFiles) {
    const assetMap = new Map();

    for (const file of allFiles) {
      const norm = this._normalizeSmartAsset(file.filename);
      if (!norm.title || norm.title.length < 3) continue;

      if (!assetMap.has(norm.key)) {
        assetMap.set(norm.key, {
          label: norm.label,
          title: norm.title,
          version: norm.version,
          files: []
        });
      }
      assetMap.get(norm.key).files.push(file);
    }

    const duplicateGroups = [];

    for (const [, item] of assetMap) {
      if (item.files.length < 2) continue;

      // Sort files by mtime ascending (oldest first, newest last)
      item.files.sort((a, b) => a.mtime - b.mtime);

      const groupTotalBytes = item.files.reduce((sum, f) => sum + f.size, 0);
      const newestSize = item.files[item.files.length - 1].size;
      const wasted = groupTotalBytes - newestSize;

      duplicateGroups.push({
        mode: "smart",
        label: item.label,
        hash: "",
        size: newestSize,
        wastedBytes: wasted,
        files: item.files.map((f) => ({
          filePath: f.filePath,
          filename: f.filename,
          size: f.size,
          mtime: f.mtime,
          directory: path.dirname(f.filePath),
        })),
      });
    }

    // Sort groups by wasted bytes descending (largest savings first)
    duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);

    const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.files.length, 0);
    const wastedBytes = duplicateGroups.reduce((sum, g) => sum + g.wastedBytes, 0);

    return {
      groups: duplicateGroups,
      stats: {
        totalFiles,
        filesScanned: allFiles.length,
        duplicateGroups: duplicateGroups.length,
        totalDuplicates,
        wastedBytes,
      },
    };
  }

  async _findExactDuplicates(allFiles, totalFiles) {
    // Tier 1: Group by file size
    const sizeGroups = new Map();
    for (const file of allFiles) {
      const key = file.size;
      if (!sizeGroups.has(key)) sizeGroups.set(key, []);
      sizeGroups.get(key).push(file);
    }

    const duplicateGroups = [];

    // Tier 2 & 3: For same-size files, quick hash then full verify
    for (const [fileSize, sizeGroup] of sizeGroups) {
      if (sizeGroup.length < 2) continue;

      // Tier 2: Quick partial hash
      const quickGroups = new Map();
      for (const file of sizeGroup) {
        try {
          const qHash = await this._quickHash(file.filePath, fileSize);
          if (!quickGroups.has(qHash)) quickGroups.set(qHash, []);
          quickGroups.get(qHash).push(file);
        } catch {}
      }

      // Tier 3: Full SHA-256 verification on potential duplicates
      for (const [, qGroup] of quickGroups) {
        if (qGroup.length < 2) continue;

        const fullGroups = new Map();
        for (const file of qGroup) {
          try {
            const fHash = await this._fullHash(file.filePath);
            file.hash = fHash;
            if (!fullGroups.has(fHash)) fullGroups.set(fHash, []);
            fullGroups.get(fHash).push(file);
          } catch {}
        }

        for (const [, verifiedGroup] of fullGroups) {
          if (verifiedGroup.length >= 2) {
            verifiedGroup.sort((a, b) => a.mtime - b.mtime);
            duplicateGroups.push({
              mode: "exact",
              hash: verifiedGroup[0].hash,
              size: verifiedGroup[0].size,
              wastedBytes: verifiedGroup[0].size * (verifiedGroup.length - 1),
              files: verifiedGroup.map((f) => ({
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
    }

    duplicateGroups.sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));

    const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.files.length, 0);
    const wastedBytes = duplicateGroups.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0);

    return {
      groups: duplicateGroups,
      stats: { totalFiles, filesScanned: allFiles.length, duplicateGroups: duplicateGroups.length, totalDuplicates, wastedBytes },
    };
  }

  async find(sourceFolders, options = {}) {
    const { fileTypes = [], minSize = 0, maxSize = Infinity, mode = "exact" } = options;

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

    if (mode === "smart") {
      return this._findSmartAssetDuplicates(allFiles, totalFiles);
    }

    return this._findExactDuplicates(allFiles, totalFiles);
  }
}

module.exports = { DuplicateFinder };
