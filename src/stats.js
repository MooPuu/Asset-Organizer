const fs = require("fs");
const path = require("path");

const SKIP_EXTENSIONS = new Set([".exe", ".dll", ".so", ".dylib", ".ini", ".cfg", ".env"]);

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

    // By directory (top-level)
    const byDir = {};
    for (const f of files) {
      const rel = folders.length === 1 ? path.relative(folders[0], f.directory) : f.directory;
      const topDir = rel.split(path.sep)[0] || ".";
      if (!byDir[topDir]) byDir[topDir] = { count: 0, size: 0 };
      byDir[topDir].count++;
      byDir[topDir].size += f.size;
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

    // Modified time distribution (last 7 days)
    const now = Date.now();
    const dayMs = 86400000;
    const modTimeRanges = [];
    for (let d = 6; d >= 0; d--) {
      const dayStart = now - (d + 1) * dayMs;
      const dayEnd = now - d * dayMs;
      const count = files.filter((f) => f.mtime >= dayStart && f.mtime < dayEnd).length;
      const date = new Date(dayEnd);
      modTimeRanges.push({
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count,
      });
    }

    return {
      totalFiles: files.length,
      totalSize,
      extBreakdown,
      dirBreakdown,
      largest,
      sizeDistribution: sizeRanges,
      modTimeDistribution: modTimeRanges,
    };
  }
}

module.exports = { FileStats };
