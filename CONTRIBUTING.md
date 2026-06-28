# 🤝 Contributing to Asset Organizer

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/asset-organizer.git
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Run** the app:
   ```bash
   npx electron .
   ```

## Development Workflow

1. Create a new branch for your feature:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. Make your changes

3. Test thoroughly — run the app and verify your changes work

4. Commit with a clear message:
   ```bash
   git commit -m "Add: description of what you added"
   ```

5. Push to your fork:
   ```bash
   git push origin feature/my-new-feature
   ```

6. Open a Pull Request on the main repository

## Commit Messages

Use clear, descriptive commit messages:

- `Add: new language support for French`
- `Fix: duplicate finder crash on empty folders`
- `Update: batch rename regex validation`
- `Remove: deprecated taxonompy keywords`

## What to Contribute

### 🌍 Translations
Add new languages to `src/i18n.json` — copy the `"en"` block and translate.

### 🎨 Themes
Add new themes in `src/styles.css` — follow the existing `[data-theme="..."]` pattern.

### 📂 Categories
Expand `src/taxonomy.json` with new asset types or keywords.

### 🐛 Bug Fixes
Check [GitHub Issues](https://github.com/MooPuu/asset-organizer/issues) for reported bugs.

### ✨ Features
See the README for a list of ideas, or suggest your own!

## Code Style

- Keep it vanilla JavaScript — no frameworks
- Use meaningful variable and function names
- Add comments for complex logic
- Follow the existing code patterns in each file

## Questions?

Open an issue or reach out on Telegram: [@moopu](https://t.me/moopu)

Thank you for making Asset Organizer better! 🎮
