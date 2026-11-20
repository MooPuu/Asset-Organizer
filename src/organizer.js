const path = require("path");
const fs = require("fs");

const SKIP_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib",
  ".git", ".ds_store", "thumbs.db",
  ".ini", ".cfg", ".env",
]);

// Map file extensions to their natural root domain in game development (matching Fab.com taxonomy)
const EXTENSION_DOMAINS = {
  // 3D Models
  ".fbx": "3D Models", ".obj": "3D Models", ".blend": "3D Models", ".gltf": "3D Models", ".glb": "3D Models",
  ".dae": "3D Models", ".3ds": "3D Models", ".max": "3D Models", ".c4d": "3D Models", ".ma": "3D Models",
  ".mb": "3D Models", ".usd": "3D Models", ".usdz": "3D Models",

  // Audio
  ".wav": "Audio", ".mp3": "Audio", ".ogg": "Audio", ".flac": "Audio",
  ".aif": "Audio", ".aiff": "Audio", ".m4a": "Audio",

  // Animations
  ".anim": "Animations", ".bvh": "Animations", ".bip": "Animations",

  // Fonts / 2D & UI
  ".ttf": "2D & UI", ".otf": "2D & UI", ".fnt": "2D & UI", ".woff": "2D & UI", ".woff2": "2D & UI",

  // Scripts / Blueprints & Plugins (C++, C#, Python, Plugins)
  ".cs": "Blueprints & Plugins", ".cpp": "Blueprints & Plugins", ".h": "Blueprints & Plugins",
  ".hpp": "Blueprints & Plugins", ".c": "Blueprints & Plugins", ".py": "Blueprints & Plugins",
  ".lua": "Blueprints & Plugins", ".uplugin": "Blueprints & Plugins", ".uproject": "Blueprints & Plugins"
};

// Unreal Engine standard naming convention prefixes
const UE_ASSET_PREFIXES = [
  { match: /^(sm_|staticmesh_)/i, domain: "3D Models", subcat: "Props & Objects" },
  { match: /^(sk_|skm_|skeletalmesh_)/i, domain: "3D Models", subcat: "Characters & Creatures" },
  { match: /^(m_|mi_|mf_|material_|mat_)/i, domain: "Materials & Textures", subcat: "Surfaces & Megascans" },
  { match: /^(t_|texture_|tc_)/i, domain: "Materials & Textures", subcat: "Surfaces & Megascans" },
  { match: /^(wbp_|widget_|ui_)/i, domain: "2D & UI", subcat: "UI Kits & HUDs" },
  { match: /^(a_|as_|anim_|animsequence_|abp_|bs_|montage_|am_)/i, domain: "Animations", subcat: "Locomotion" },
  { match: /^(ns_|ne_|ps_|fx_|vfx_|niagara_|emitter_)/i, domain: "Visual Effects (VFX)", subcat: "Shaders & Post-Processing" },
  { match: /^(s_|sw_|sc_|sound_|cue_|wave_)/i, domain: "Audio", subcat: "Sound Effects (SFX)" },
  { match: /^(map_|l_|level_)/i, domain: "3D Models", subcat: "Environments & Landscapes" },
  { match: /^(bp_|bpi_|bpc_|blueprint_)/i, domain: "Blueprints & Plugins", subcat: "Gameplay Systems" },
];

// Texture map markers
const TEXTURE_MARKERS = new Set([
  "diffuse", "albedo", "basecolor", "normal", "roughness", "metallic",
  "specular", "height", "displacement", "ao", "ambientocclusion", "emission",
  "emissive", "opacity", "mask", "orm", "packed", "pbr", "texture"
]);

// Adjectives that should not override specific functional nouns (e.g. "medieval sword" is a Weapon)
const ERA_ADJECTIVES = new Set([
  "medieval", "ancient", "vintage", "retro", "historical", "antique"
]);

// Location and biome nouns that frequently act as modifiers (e.g. "forest wolf", "mountain bike")
const BIOME_MODIFIERS = new Set([
  "forest", "desert", "mountain", "swamp", "jungle", "arctic", "snowy", "autumn", "winter"
]);

// Technical channel keywords that shouldn't override specific material types (e.g. "brick albedo" is Brick/Surfaces)
const TECHNICAL_CHANNELS = new Set([
  "albedo", "diffuse", "basecolor", "normal", "roughness", "metallic",
  "specular", "height", "displacement", "ao", "orm", "seamless", "tileable", "pbr"
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
          const key = kw.toLowerCase().trim();
          if (!key) continue;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ category, subcategory });
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
            try {
              const stat = fs.statSync(full);
              files.push({ filePath: full, size: stat.size, mtime: stat.mtimeMs });
            } catch {
              files.push({ filePath: full, size: 0, mtime: 0 });
            }
          }
        }
      }
    };
    for (const folder of folders) walk(folder);
    return files;
  }

  _parseAssetInfo(filename) {
    let ext = path.extname(filename).toLowerCase();
    let baseName = path.basename(filename, ext);
    let isSplitPart = false;
    let splitPartIndex = null;

    // Check for 7z / generic split: .001, .002, etc.
    if (/^\.(00[1-9]|0[1-9][0-9])$/i.test(ext)) {
      isSplitPart = true;
      splitPartIndex = parseInt(ext.slice(1), 10);
      baseName = baseName.replace(/_[0-9]+$/, "");
      const innerExt = path.extname(baseName).toLowerCase();
      if (innerExt && [".zip", ".7z", ".rar", ".tar"].includes(innerExt)) {
        ext = innerExt + ext;
        baseName = path.basename(baseName, innerExt);
      }
    }

    // Check for part1, part2, part01, part1_1 in baseName
    const partMatch = baseName.match(/[._\-\s]part0*([1-9][0-9]*)(_[0-9]+)?$/i);
    if (partMatch) {
      isSplitPart = true;
      splitPartIndex = parseInt(partMatch[1], 10);
      baseName = baseName.slice(0, partMatch.index);
    }

    // Strip trailing _1, _2 artifact download numbers (e.g. 'Pack_UE5.1+_1')
    baseName = baseName.replace(/_[0-9]+$/, "");

    // Check Unreal asset prefix for .uasset
    let ueDomain = null;
    let ueSubcat = null;
    if (ext === ".uasset") {
      for (const rule of UE_ASSET_PREFIXES) {
        if (rule.match.test(baseName)) {
          ueDomain = rule.domain;
          ueSubcat = rule.subcat;
          break;
        }
      }
    }

    return { baseName, ext, isSplitPart, splitPartIndex, ueDomain, ueSubcat };
  }

  _matchFile(filename, ext, keywordMap) {
    const info = this._parseAssetInfo(filename);
    let baseRaw = info.baseName;
    const cleanExt = info.ext;

    // Domain from extension or .uasset prefix
    let domainFromExt = info.ueDomain || EXTENSION_DOMAINS[cleanExt] || EXTENSION_DOMAINS[ext.toLowerCase()];

    // Clean version tags and split camelCase/PascalCase boundaries
    baseRaw = baseRaw
      .replace(/\bUE[0-9]+(\.[0-9]+)?\+?\b/gi, ' ')
      .replace(/\bUE[0-9]{2,3}\b/gi, ' ')
      .replace(/\bv[0-9]+(\.[0-9]+)*\+?\b/gi, ' ')
      .replace(/([a-zA-Z])([0-9]{2,})/g, '$1 $2')
      .replace(/([0-9]{2,})([a-zA-Z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z]{2,})/g, '$1 $2');

    const rawTokens = baseRaw.toLowerCase().split(/[\s_\-.\[\]{}()!,;+&]+/).filter(Boolean);
    const tokenSet = new Set();
    for (const t of rawTokens) {
      tokenSet.add(t);
      if (t.endsWith("ies") && t.length > 4) {
        tokenSet.add(t.slice(0, -3) + "y");
      } else if (t.endsWith("es") && t.length > 4) {
        tokenSet.add(t.slice(0, -1));
        tokenSet.add(t.slice(0, -2));
      } else if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) {
        tokenSet.add(t.slice(0, -1));
      }
    }
    const tokens = Array.from(tokenSet);
    const baseJoined = rawTokens.join(" ");

    // Check if texture by naming convention or texture extensions
    const isTextureFile = [".png", ".tga", ".dds", ".exr", ".hdr", ".tif", ".tiff", ".psd"].includes(cleanExt);
    const hasTextureMarker = tokens.some(t => TEXTURE_MARKERS.has(t));

    let bestMatch = null;
    let bestScore = -1;

    for (const [kw, targets] of keywordMap) {
      const kwTokens = kw.split(/[\s_\-]+/).filter(Boolean);

      // Check for exact token match or exact token sequence
      let matched = false;
      if (kwTokens.length === 1) {
        matched = tokens.includes(kwTokens[0]);
      } else if (kwTokens.length > 1) {
        const kwJoined = kwTokens.join(" ");
        matched = baseJoined.includes(kwJoined);
      }

      if (matched) {
        for (const target of targets) {
          let score = kw.length * 10;

          // Domain bonus: strongly favor category that matches the file extension domain
          if (domainFromExt && target.category === domainFromExt) {
            score += 1000;
          } else if (domainFromExt && target.category !== domainFromExt) {
            score -= 500;
          }

          // Texture bonus
          if (isTextureFile && (target.category === "Materials & Textures" || target.category === "2D & UI")) {
            score += 200;
          }
          if (hasTextureMarker && target.category === "Materials & Textures") {
            score += 400;
          }

          // Era/adjective penalty: "sword" or "castle" should win over "medieval" or "ancient"
          if (ERA_ADJECTIVES.has(kw)) {
            score -= 150;
          }

          // Technical channel penalty when surface material noun is present
          if (TECHNICAL_CHANNELS.has(kw)) {
            score -= 50;
          }

          // Biome/location modifier penalty when modifying functional entities
          if (BIOME_MODIFIERS.has(kw)) {
            score -= 25;
          }

          // Entity bonus: functional subjects (animals, characters, weapons, vehicles) take precedence over general biomes
          if (["Animals & Pets", "Characters & Creatures", "Weapons & Military", "Vehicles & Transportation"].includes(target.subcategory)) {
            score += 20;
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = { category: target.category, subcategory: target.subcategory };
          }
        }
      }
    }

    // Default domain fallback if no specific keyword matched but extension clearly indicates domain
    if (!bestMatch) {
      if (info.ueSubcat) {
        bestMatch = { category: info.ueDomain, subcategory: info.ueSubcat };
      } else if (domainFromExt) {
        if (domainFromExt === "Audio") {
          bestMatch = { category: "Audio", subcategory: "Sound Effects (SFX)" };
        } else if (domainFromExt === "3D Models") {
          bestMatch = { category: "3D Models", subcategory: "Props & Objects" };
        } else if (domainFromExt === "Animations") {
          bestMatch = { category: "Animations", subcategory: "Locomotion" };
        } else if (domainFromExt === "2D & UI") {
          bestMatch = { category: "2D & UI", subcategory: "Fonts & Typography" };
        } else if (domainFromExt === "Blueprints & Plugins") {
          bestMatch = { category: "Blueprints & Plugins", subcategory: "Gameplay Systems" };
        }
      }
    }

    if (bestMatch) {
      bestMatch.isSplitPart = info.isSplitPart;
      bestMatch.splitPartIndex = info.splitPartIndex;
      bestMatch.splitBaseName = info.baseName;
    }

    return bestMatch;
  }

  preview(sourceFolders, options = {}) {
    const keywordMap = this._buildKeywordMap();
    const collected = this._collectFiles(sourceFolders);
    const { fileTypes = [] } = options;

    const plan = [];
    const unmoved = [];

    const normTypes = fileTypes.map(ft => "." + ft.toLowerCase().replace(/^\./, ""));

    for (const fileItem of collected) {
      const filePath = fileItem.filePath;
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();

      if (normTypes.length > 0 && !normTypes.includes(ext)) continue;

      const match = this._matchFile(filename, ext, keywordMap);
      const info = this._parseAssetInfo(filename);

      if (match) {
        const sourceFolder = sourceFolders.find((sf) => filePath.startsWith(sf)) || sourceFolders[0];
        plan.push({
          from: filePath,
          filename,
          ext: ext || "(no ext)",
          size: fileItem.size,
          category: match.category,
          subcategory: match.subcategory,
          sourceFolder,
          isSplitPart: info.isSplitPart,
          splitPartIndex: info.splitPartIndex,
          splitBaseName: info.baseName,
        });
      } else {
        unmoved.push({
          from: filePath,
          filename,
          ext: ext || "(no ext)",
          size: fileItem.size,
          isSplitPart: info.isSplitPart,
          splitPartIndex: info.splitPartIndex,
          splitBaseName: info.baseName,
        });
      }
    }

    const summary = {};
    const folderStructure = options.folderStructure || "subcategories";
    for (const item of plan) {
      const key = folderStructure === "main" ? item.category : `${item.category} / ${item.subcategory}`;
      summary[key] = (summary[key] || 0) + 1;
    }

    return { plan, unmoved, summary, totalScanned: collected.length };
  }

  execute(sourceFolders, destFolder, plan, options = {}) {
    const {
      dryRun = false,
      copyInstead = false,
      conflictResolution = "rename", // "rename", "skip", "overwrite"
      cleanupEmptyDirs = false,
      folderStructure = "subcategories", // "subcategories" or "main"
    } = options;

    const moves = [];
    const errors = [];
    const skipped = [];

    for (const item of plan) {
      const targetDir = folderStructure === "main"
        ? path.join(destFolder, item.category)
        : path.join(destFolder, item.category, item.subcategory);
      let targetPath = path.join(targetDir, item.filename);

      if (fs.existsSync(targetPath)) {
        if (conflictResolution === "skip") {
          skipped.push({ file: item.from, reason: "Destination file already exists" });
          continue;
        } else if (conflictResolution === "rename") {
          const ext = path.extname(item.filename);
          const base = path.basename(item.filename, ext);
          let counter = 1;
          while (fs.existsSync(targetPath)) {
            targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
            counter++;
          }
        }
        // If "overwrite", targetPath stays as is
      }

      if (dryRun) {
        moves.push({ from: item.from, to: targetPath, mode: copyInstead ? "copy" : "move" });
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
        moves.push({ from: item.from, to: targetPath, mode: copyInstead ? "copy" : "move" });
      } catch (err) {
        errors.push({ file: item.from, error: err.message });
      }
    }

    // Optionally cleanup empty source directories
    if (cleanupEmptyDirs && !dryRun && !copyInstead) {
      this._pruneEmptyDirs(sourceFolders);
    }

    return { moves, errors, skipped };
  }

  _pruneEmptyDirs(folders) {
    const prune = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        try {
          if (fs.statSync(full).isDirectory()) {
            prune(full);
          }
        } catch {}
      }
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {}
    };

    for (const folder of folders) {
      try {
        const subdirs = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const sd of subdirs) {
          prune(path.join(folder, sd.name));
        }
      } catch {}
    }
  }
}

module.exports = { Organizer };
