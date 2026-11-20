# 🎮 Asset Organizer

**The Ultimate Game Asset Management Tool** — Open Source & Free Forever

Stop wasting hours searching through messy folders. Asset Organizer is a powerful desktop app that automatically sorts, renames, and manages your game assets with a single click.

> 🔓 **100% Open Source** — Fork it, customize it, make it yours. MIT License.

---

## 📥 Download

**⬇️ [Download Latest Release (v1.0)](https://github.com/MooPuu/Asset-Organizer/releases/tag/v1.0)**

| File | Size | Description |
|------|------|-------------|
| `Asset-Organizer-1.0.0-win-x64.zip` | ~110 MB | **Extract & Run** — Download, extract, run `Asset Organizer.exe` |
| `Asset-Organizer-1.0.0-portable.exe` | ~70 MB | **Portable** — Single .exe, no extraction needed |

> 💡 **No installation required.** Works offline. Your files never leave your computer.

---

## ✨ Features

- 📂 **Smart Organization (Fab.com Taxonomy)** — Automatically classifies and organizes 200+ file types across all 7 official Fab.com pillars and 50 subcategories with Unreal Engine `.uasset` prefix intelligence (`SM_`, `SK_`, `M_`, `WBP_`, etc.).
- 📦 **Split Archive Intelligence** — Automatically detects and bundles multi-part split archives (`.zip.001`, `.part1_1.rar`, etc.) to prevent breaking split asset packages.
- 🔍 **Dual-Mode Duplicate Finder**:
  - **Exact Binary Mode**: 3-stage streaming SHA-256 hash verification for 100% bit-for-bit identical clones.
  - **Smart Asset Mode**: Finds duplicate asset packages across different revisions, repacks, and engine versions (e.g. `5.7` vs `v5.7`, `.zip` vs `.rar`, `by <Author>`) while protecting split archive parts and documentation PDFs.
- 🎨 **Modern & Compact Developer UI** — High-density developer interface inspired by Unreal Engine 5, Blender, VS Code, and Linear with compact tables, inline selectors, and 4 refined themes (Dark, Light, Midnight, AMOLED).
- ✏️ **Batch Rename Engine** — Rename hundreds of files with powerful token patterns (`{name}`, `{ext}`, `{parent}`, `{date}`, `{counter}`), case conversion, regex, and live preview.
- 📊 **File Statistics Dashboard** — Analyze any directory for Fab.com category breakdown, size distribution, file age timelines, and top directory usage.
- 🌐 **Arabic & English** — Complete bilingual support with seamless RTL (Right-to-Left) mirroring across all 201 UI keys.
- 📁 **Multi-Folder Support** — Select and manage multiple source directories simultaneously.
- ↩️ **Undo Everything** — Every organize session is recorded and completely reversible from the History tab.
- 🎯 **Drag & Drop** — Sleek interactive drop zones to quickly add source directories.
- ⭐ **Favorites & Recent Folders** — Fast one-click access to frequent project directories.
- 📤 **Export Reports** — RFC 4180 and Microsoft Excel-compliant CSV export with UTF-8 BOM.
- ⌨️ **Keyboard Shortcuts** — Full productivity navigation (Ctrl+O, Ctrl+D, Ctrl+R, Ctrl+I, Ctrl+H, Ctrl+S).
- 🔒 **Recycle Bin Protection** — Safe native recycling via Electron `shell.trashItem()` instead of permanent deletion.
- 🧠 **Custom Taxonomy** — Visually edit categories, subcategories, and keywords directly inside the app.

---

## 📂 Supported Categories

| Category | Examples |
|----------|----------|
| 🏗️ 3D | Buildings, Characters, Vehicles, Weapons, Props, Environments, Nature |
| 🎨 Materials & Textures | Fabric, Metal, Wood, Grunge, Patterns |
| 🎬 Animations | Combat, Locomotion, Gestures |
| 🔊 Audio | Music, SFX, Ambient |
| ✨ VFX | Fire, Water, Smoke, Spells, Weather |
| 🖼️ UI | Icons, Fonts, Backgrounds, HUDs |
| 🔧 Tools & Plugins | Editor Tools, Gameplay Systems |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Git](https://git-scm.com/)

### Installation

```bash
# Clone the repo
git clone https://github.com/MooPuu/asset-organizer.git

# Go into the folder
cd asset-organizer

# Install dependencies
npm install

# Run the app
npx electron .
```

### Build for Distribution

```bash
# Build portable .exe (no installation needed)
npm run build:portable

# Build installer (.exe with Start Menu shortcut)
npm run build:installer

# Build both
npm run build:all
```

Output files will be in the `dist/` folder.

---

## 🎨 Customization Guide

This app is designed to be easily forked and customized. Here's how:

### 🏷️ Change App Name & Branding

1. **Edit `package.json`:**
   - Change `"name"` — the app identifier
   - Change `"productName"` inside `"build"` — the display name
   - Change `"description"` — app description

2. **Replace the icon:**
   - Put your own `icon.png` (512x512 or larger) in `build/`
   - Run `node build-icon.js` to convert it to `.ico` for Windows
   - Or place your `.ico` directly at `build/icon.ico`

3. **Update social links:**
   - Open `src/index.html` and update the Facebook, X/Twitter, and Telegram links
   - Update the developer name in the About section

### 🌐 Add a New Language

1. Open `src/i18n.json`
2. Copy the `"en"` block
3. Paste it and rename to your language code (e.g. `"fr"`, `"de"`, `"ja"`)
4. Translate all the strings
5. In `src/renderer.js`, find the language selector and add your new language

### 🎨 Add a New Theme

1. Open `src/styles.css`
2. Find any `[data-theme="dark"]` block
3. Copy it and rename to your theme (e.g. `[data-theme="solarized"]`)
4. Change the CSS variables to your colors
5. In `src/index.html`, add a theme option in the Settings dropdown

### 📂 Modify Categories & Keywords

1. Open `src/taxonomy.json`
2. Add new categories, subcategories, or keywords
3. Changes take effect immediately on next scan

### 🔧 Change File Type Mappings

1. Open `src/organizer.js`
2. Find the `CATEGORY_MAP` object
3. Add or modify file extension → category mappings

---

## 📁 Project Structure

```
asset-organizer/
├── build/                    # App icon (icon.png, icon.ico)
├── src/
│   ├── main.js              # Electron main process (IPC handlers, trash, file ops)
│   ├── preload.js           # Context bridge (secure API between main & renderer)
│   ├── index.html           # App UI layout (8 tabs)
│   ├── renderer.js          # Frontend logic (all views, themes, i18n)
│   ├── styles.css           # Styles & 4 themes
│   ├── i18n.json            # Arabic/English translations
│   ├── organizer.js         # File organizing engine
│   ├── duplicates.js        # Duplicate finder engine
│   ├── stats.js             # File analysis engine
│   └── taxonomy.json        # Fab.com asset taxonomy
├── package.json             # Dependencies & build config
├── LICENSE                  # MIT License
├── README.md                # This file
└── .gitignore               # Git ignore rules
```

---

## ⚡ Tech Stack

| Technology | Purpose |
|-----------|---------|
| [Electron](https://www.electronjs.org/) | Cross-platform desktop app framework |
| [Node.js](https://nodejs.org/) | Backend runtime |
| [electron-builder](https://www.electron.build/) | Package & distribute as .exe |
| [trash](https://github.com/sindresorhus/trash) | Safe recycle bin deletion |
| HTML/CSS/JS | Frontend (no frameworks, pure vanilla) |

---

## 🤝 Contributing

Contributions are welcome! Here's how to contribute:

1. **Fork** this repository
2. **Create** a feature branch: `git checkout -b my-new-feature`
3. **Commit** your changes: `git commit -m 'Add my new feature'`
4. **Push** to the branch: `git push origin my-new-feature`
5. **Open** a Pull Request

### Ideas for Contributions

- 🌍 Add more languages (French, German, Japanese, etc.)
- 🎨 Create new themes
- 📂 Add support for more file types
- 🖥️ macOS and Linux support
- 📊 Better statistics and charts
- 🔍 Search/filter in organized results
- 📁 Sub-category organization (deeper folder structure)

---

## 🐛 Found a Bug?

Open an issue on [GitHub Issues](https://github.com/MooPuu/asset-organizer/issues) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Screenshots if applicable

---

## 💡 Feature Requests

Have an idea? Open an issue with the **enhancement** label and describe what you'd like to see!

---

## 👨‍💻 Author

**Mahdi Kareem**

🌐 [Facebook](https://www.facebook.com/19.Mehdi.96) | 🐦 [X/Twitter](https://x.com/MK_MooPu) | ✈️ [Telegram](https://t.me/moopu)

---

## 📝 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

You are free to:
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Use in private projects
- ✅ Sublicense

---

## ⭐ Support

If you find this project useful, please give it a ⭐ star on GitHub! It helps others discover the project.

---

*© 2026 Mahdi Kareem. Open source under MIT License.*
