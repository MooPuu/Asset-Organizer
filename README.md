# 🎮 Asset Organizer

**The Ultimate Game Asset Management Tool**

Stop wasting hours searching through messy folders. Asset Organizer is a powerful desktop app that automatically sorts, renames, and manages your game assets with a single click.

---

## ✨ Features

- 📂 **Smart Organization** — Automatically sorts 200+ file types into categories
- 🔍 **Duplicate Finder** — Find and remove duplicate files across multiple folders
- ✏️ **Batch Rename** — Rename hundreds of files with powerful patterns (regex, find/replace, prefix, suffix, auto-numbering)
- 📊 **File Statistics** — Analyze any folder for type breakdown, size distribution, and more
- 🎨 **4 Beautiful Themes** — Dark, Light, Midnight, and AMOLED
- 🌐 **Arabic & English** — Full bilingual support with RTL layout
- ↩️ **Undo Everything** — Every session is reversible from the History tab
- 📁 **Multi-Folder Support** — Work with multiple source folders at once
- 🎯 **Drag & Drop** — Simply drag folders into the app
- ⭐ **Favorites & Recent** — Save常用 folders for quick access
- 📤 **Export Reports** — Export results as CSV
- ⌨️ **Keyboard Shortcuts** — Ctrl+O, Ctrl+D, Ctrl+R, and more
- 🔒 **Recycle Bin Deletion** — Files go to your Recycle Bin, not permanently deleted

## 📂 Categories Supported

| Category | Examples |
|----------|----------|
| 🏗️ 3D | Buildings, Characters, Vehicles, Weapons, Props, Environments, Nature |
| 🎨 Materials & Textures | Fabric, Metal, Wood, Grunge, Patterns |
| 🎬 Animations | Combat, Locomotion, Gestures |
| 🔊 Audio | Music, SFX, Ambient |
| ✨ VFX | Fire, Water, Smoke, Spells, Weather |
| 🖼️ UI | Icons, Fonts, Backgrounds, HUDs |
| 🔧 Tools & Plugins | Editor Tools, Gameplay Systems |

## 🚀 Getting Started

### Run in Development

```bash
# Install dependencies
npm install

# Start the app
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

### Download

📦 **Portable Version** — Single .exe file, no installation needed. Run it from anywhere.

⚙️ **Installer Version** — Standard Windows installer with Start Menu and Desktop shortcuts.

**Works offline** — No internet required after download. Your files never leave your computer.

## 🖥️ How It Works

1️⃣ **Choose your destination folder** — Where you want organized assets to go.

2️⃣ **Add source folders** — Where your unsorted assets currently live.

3️⃣ **Click "Scan & Preview"** — See exactly what will happen before any file moves.

4️⃣ **Click "Organize Now"** — Files are sorted into categories at your destination.

5️⃣ **Undo if needed** — Every session is reversible from the History tab.

## ⚡ Tech Stack

- 🔧 Built with **Electron** for cross-platform desktop support
- 🎨 Custom UI with **4 themeable designs** and **RTL language support**
- 📦 Distributed as a **portable .exe** — no installation required
- 🔒 **Recycle Bin deletion** — Safe by default
- 🧠 **Smart file matching** — Keyword-based taxonomy with 200+ game dev keywords

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open / Organize |
| `Ctrl+D` | Scan Duplicates |
| `Ctrl+R` | Batch Rename |
| `Ctrl+I` | File Info |
| `Ctrl+H` | History |
| `Ctrl+S` | Settings |
| `Ctrl+E` | Export |
| `Ctrl+F` | Favorites |

## 👨‍💻 Made By

**Mahdi Kareem**

🌐 [Facebook](https://www.facebook.com/19.Mehdi.96) | 🐦 [X/Twitter](https://x.com/MK_MooPu) | ✈️ [Telegram](https://t.me/moopu)

---

## 📝 License

MIT License — © 2026 Mahdi Kareem. All rights reserved.

---

**⭐ Star this repo if you find it useful!**

**🐛 Found a bug? Open an issue or contact me directly.**

**💡 Have a feature request? I'd love to hear your ideas!**
