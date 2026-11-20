const fs = require("fs");
const path = require("path");

const SKIP_EXTENSIONS = new Set([".exe", ".dll", ".so", ".dylib", ".ini", ".cfg", ".env"]);

const EXTENSION_DOMAINS = {
  // 3D
  ".fbx": "3D Models", ".obj": "3D Models", ".blend": "3D Models", ".gltf": "3D Models", ".glb": "3D Models",
  ".dae": "3D Models", ".3ds": "3D Models", ".max": "3D Models", ".c4d": "3D Models", ".ma": "3D Models", ".mb": "3D Models",
  // Textures
  ".png": "Materials & Textures", ".jpg": "Materials & Textures", ".jpeg": "Materials & Textures",
  ".tga": "Materials & Textures", ".dds": "Materials & Textures", ".exr": "Materials & Textures",
  ".hdr": "Materials & Textures", ".tif": "Materials & Textures", ".tiff": "Materials & Textures", ".psd": "Materials & Textures",
  // Audio
  ".wav": "Audio", ".mp3": "Audio", ".ogg": "Audio", ".flac": "Audio", ".aif": "Audio", ".aiff": "Audio",
  // Animations
  ".anim": "Animations", ".bvh": "Animations",
  // UI & Fonts
  ".ttf": "2D & UI", ".otf": "2D & UI", ".fnt": "2D & UI",
  // Blueprints & Code
  ".cs": "Blueprints & Plugins", ".cpp": "Blueprints & Plugins", ".py": "Blueprints & Plugins", ".lua": "Blueprints & Plugins", ".uasset": "Blueprints & Plugins",
};

class FileStats {
  scan(folders) {
    const files = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!SKIP_EXTENSIONS.has(ext) && !["thumbs.db", ".ds_store"].includes(entry.name.toLowerCase())) {
            try {
              const stat = fs.statSync(full);
              files.push({
                filePath: full,
                filename: entry.name,
                ext: ext || "(no ext)",
                size: stat.size,
                mtime: stat.mtimeMs,
                directory: path.dirname(full),
              });
            } catch {}
          }
        }
      }
    };
    for (const f of folders) walk(f);
    return files;
  }

  analyze(folders) {
    const files = this.scan(folders);
    const totalSize = files.reduce((s, f) => s + f.size, 0);

    // By extension
    const byExt = {};
    for (const f of files) {
      if (!byExt[f.ext]) byExt[f.ext] = { count: 0, size: 0 };
      byExt[f.ext].count++;
      byExt[f.ext].size += f.size;
    }
    const extBreakdown = Object.entries(byExt)
      .map(([ext, data]) => ({ ext, ...data }))
      .sort((a, b) => b.size - a.size);

    // By Fab.com Category Domain
    const byCategory = {};
    for (const f of files) {
      const cat = EXTENSION_DOMAINS[f.ext] || "Other / Miscellaneous";
      if (!byCategory[cat]) byCategory[cat] = { count: 0, size: 0 };
      byCategory[cat].count++;
      byCategory[cat].size += f.size;
    }
    const categoryBreakdown = Object.entries(byCategory)
      .map(([cat, data]) => ({ category: cat, ...data }))
      .sort((a, b) => b.size - a.size);

    // By directory (smart relative path resolution)
    const byDir = {};
    for (const f of files) {
      const matchedFolder = folders.find(folder => f.directory.startsWith(folder)) || folders[0];
      const rel = matchedFolder ? path.relative(matchedFolder, f.directory) : "";
      const topDir = rel ? rel.split(path.sep)[0] : path.basename(matchedFolder || ".");
      const key = topDir || ".";
      if (!byDir[key]) byDir[key] = { count: 0, size: 0 };
      byDir[key].count++;
      byDir[key].size += f.size;
    }
    const dirBreakdown = Object.entries(byDir)
      .map(([dir, data]) => ({ dir: dir.substring(0, 60), ...data }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 20);

    // Largest files
    const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 15);

    // Size distribution
    const sizeRanges = [
      { label: "< 1 KB", min: 0, max: 1024, count: 0 },
      { label: "1-10 KB", min: 1024, max: 10240, count: 0 },
      { label: "10-100 KB", min: 10240, max: 102400, count: 0 },
      { label: "100 KB - 1 MB", min: 102400, max: 1048576, count: 0 },
      { label: "1-10 MB", min: 1048576, max: 10485760, count: 0 },
      { label: "10-100 MB", min: 10485760, max: 104857600, count: 0 },
      { label: "> 100 MB", min: 104857600, max: Infinity, count: 0 },
    ];
    for (const f of files) {
      for (const range of sizeRanges) {
        if (f.size >= range.min && f.size < range.max) { range.count++; break; }
      }
    }

    // Meaningful time distribution
    const now = Date.now();
    const dayMs = 86400000;
    const timeRanges = [
      { label: "Last 24 Hours", count: 0 },
      { label: "Last 7 Days", count: 0 },
      { label: "Last 30 Days", count: 0 },
      { label: "Last 1 Year", count: 0 },
      { label: "Older than 1 Year", count: 0 },
    ];
    for (const f of files) {
      const age = now - f.mtime;
      if (age < dayMs) timeRanges[0].count++;
      else if (age < dayMs * 7) timeRanges[1].count++;
      else if (age < dayMs * 30) timeRanges[2].count++;
      else if (age < dayMs * 365) timeRanges[3].count++;
      else timeRanges[4].count++;
    }

    return {
      totalFiles: files.length,
      totalSize,
      extBreakdown,
      categoryBreakdown,
      dirBreakdown,
      largest,
      sizeDistribution: sizeRanges,
      modTimeDistribution: timeRanges,
    };
  }
}

module.exports = { FileStats };
