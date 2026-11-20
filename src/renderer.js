/* ============================================================
   Asset Organizer – renderer.js
   Full Fab.com taxonomy support, interactive organize preview,
   token-based batch rename, safe recycling, and Excel-ready export.
   ============================================================ */
(function () {
  'use strict';

  const api = window.api;
  const isElectron = !!api;

  // ── State ───────────────────────────────────────────────────
  let currentLang = 'en';
  let currentTheme = 'dark';
  let i18nData = {};

  let organizeSources = [];
  let organizeDest = '';
  let lastScanResult = null;

  let dupSources = [];
  let dupResults = null;

  let statsFolder = '';
  let lastStats = null;

  let renameFolder = '';
  let renameSources = [];
  let renameScanFiles = [];
  let renamePreview = [];
  let taxonomy = null;

  // ── Helpers ─────────────────────────────────────────────────
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  const PathUtils = {
    extname: (name) => {
      const idx = name.lastIndexOf('.');
      return idx !== -1 ? name.slice(idx) : '';
    },
    basename: (name, ext = '') => {
      const base = name.replace(/^.*[\\/]/, '');
      return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
    },
    dirname: (p) => {
      const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      return idx !== -1 ? p.slice(0, idx) : '.';
    },
    join: (dir, file) => dir.replace(/[\\/]+$/, '') + '\\' + file.replace(/^[\\/]+/, ''),
  };

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function shortenPath(p, max = 50) {
    if (!p) return '';
    if (p.length <= max) return p;
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return p;
    return parts[0] + '/.../' + parts[parts.length - 1];
  }

  function escapeCSV(val) {
    const s = String(val ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    // UTF-8 BOM for Microsoft Excel compatibility
    return '\uFEFF' + rows.map(r => r.map(escapeCSV).join(',')).join('\r\n');
  }

  function showToast(msg, type = 'info') {
    const container = $('#toast-container');
    if (!container) {
      alert(msg);
      return;
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  // ── i18n ────────────────────────────────────────────────────
  function t(key) {
    return (i18nData[currentLang] && i18nData[currentLang][key])
      || (i18nData['en'] && i18nData['en'][key])
      || key;
  }

  function applyI18n() {
    $$('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val) el.textContent = val;
    });
    $$('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  async function loadI18n() {
    if (isElectron) {
      try { i18nData = await api.getI18n(); } catch (_) { i18nData = { en: {}, ar: {} }; }
    } else {
      try {
        const resp = await fetch('i18n.json');
        i18nData = await resp.json();
      } catch (_) { i18nData = { en: {}, ar: {} }; }
    }
    applyI18n();
  }

  // ── Theme ───────────────────────────────────────────────────
  function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    $$('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === theme));
  }

  // ── Language ────────────────────────────────────────────────
  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    $$('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
    applyI18n();
  }

  // ── Navigation ──────────────────────────────────────────────
  function switchView(viewName) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = $(`#view-${viewName}`);
    if (target) target.classList.add('active');
    const btn = $(`.nav-btn[data-view="${viewName}"]`);
    if (btn) btn.classList.add('active');
  }

  // ── Progress Overlay ────────────────────────────────────────
  function showProgress(msg) {
    $('#progress-text').textContent = msg || 'Working...';
    $('#progress-overlay').classList.remove('hidden');
  }

  function hideProgress() {
    $('#progress-overlay').classList.add('hidden');
  }

  // ── Source List Rendering ───────────────────────────────────
  function renderSourceList(container, sources, onRemove) {
    container.innerHTML = '';
    if (sources.length === 0) {
      container.innerHTML = `<div style="padding:8px;color:var(--text-muted);font-size:12px;">${t('no_sources')}</div>`;
      return;
    }
    sources.forEach((src, idx) => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.innerHTML = `<span title="${src}">${shortenPath(src, 60)}</span><button title="Remove">&times;</button>`;
      item.querySelector('button').addEventListener('click', () => {
        sources.splice(idx, 1);
        onRemove();
      });
      container.appendChild(item);
    });
  }

  // ── Folder Pickers ──────────────────────────────────────────
  async function pickDestFolder() {
    if (!isElectron) return prompt('Enter destination folder path:') || '';
    return await api.selectDestFolder() || '';
  }

  async function pickSourceFolders() {
    if (!isElectron) {
      const val = prompt('Enter source folder paths (comma-separated):');
      if (!val) return [];
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
    return await api.selectSourceFolders() || [];
  }

  async function pickStatsFolder() {
    if (!isElectron) return prompt('Enter folder path to analyze:') || '';
    return await api.selectStatsFolder() || '';
  }

  async function pickRenameFolder() {
    if (!isElectron) return prompt('Enter folder path to rename:') || '';
    return await api.selectRenameFolder() || '';
  }

  // ── Recent Folders ──────────────────────────────────────────
  async function loadRecentFolders() {
    const select = $('#recent-folders');
    select.innerHTML = `<option value="">-- ${t('no_recent')} --</option>`;
    if (!isElectron) return;
    try {
      const recent = await api.getRecent() || [];
      recent.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = shortenPath(p, 50);
        select.appendChild(opt);
      });
    } catch (_) {}
  }

  // ── Favorites ───────────────────────────────────────────────
  async function loadFavorites() {
    const select = $('#favorites-select');
    select.innerHTML = `<option value="">-- ${t('no_favorites')} --</option>`;
    if (!isElectron) return;
    try {
      const favs = await api.getFavorites() || [];
      favs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = shortenPath(p, 50);
        select.appendChild(opt);
      });
    } catch (_) {}
  }

  async function saveFavorite() {
    if (!isElectron) return;
    const favs = await api.getFavorites() || [];
    const toAdd = [organizeDest, ...organizeSources].filter(p => p && !favs.includes(p));
    if (toAdd.length === 0) return;
    favs.push(...toAdd);
    await api.saveFavorites(favs);
    loadFavorites();
    showToast(t('fav_saved'), 'success');
  }

  // ── Taxonomy ────────────────────────────────────────────────
  async function loadTaxonomy() {
    if (isElectron) {
      try { taxonomy = await api.getTaxonomy(); } catch (_) { taxonomy = {}; }
    } else {
      try {
        const resp = await fetch('taxonomy.json');
        taxonomy = await resp.json();
      } catch (_) { taxonomy = {}; }
    }
    renderTaxonomy();
  }

  function renderTaxonomy() {
    const container = $('#taxonomy-editor');
    container.innerHTML = '';
    if (!taxonomy) return;

    const flat = {};
    for (const [cat, subcats] of Object.entries(taxonomy)) {
      if (typeof subcats === 'object' && !Array.isArray(subcats)) {
        for (const [sub, keywords] of Object.entries(subcats)) {
          if (Array.isArray(keywords)) {
            flat[cat + ' :: ' + sub] = keywords;
          }
        }
      } else if (Array.isArray(subcats)) {
        flat[cat] = subcats;
      }
    }

    Object.keys(flat).sort().forEach(key => {
      const keywords = flat[key].filter(k => k && k.trim());
      const div = document.createElement('div');
      div.className = 'taxonomy-category';
      div.innerHTML = `
        <h4>${key}</h4>
        <div class="taxonomy-keywords">
          ${keywords.map(kw => `<span class="taxonomy-tag">${kw}<button data-key="${key}" data-kw="${kw}">&times;</button></span>`).join('')}
        </div>
        <div class="taxonomy-add-row">
          <input type="text" placeholder="Add keyword..." data-key="${key}" />
          <button data-key="${key}">+</button>
        </div>
      `;
      div.querySelectorAll('.taxonomy-tag button').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.key;
          const kw = btn.dataset.kw;
          for (const [cat, subcats] of Object.entries(taxonomy)) {
            if (typeof subcats === 'object' && !Array.isArray(subcats)) {
              for (const [sub, arr] of Object.entries(subcats)) {
                if (Array.isArray(arr) && cat + ' :: ' + sub === k) {
                  const idx = arr.indexOf(kw);
                  if (idx !== -1) arr.splice(idx, 1);
                }
              }
            }
          }
          renderTaxonomy();
        });
      });
      const addBtn = div.querySelector('.taxonomy-add-row button');
      const addInput = div.querySelector('.taxonomy-add-row input');
      const doAdd = () => {
        const val = addInput.value.trim().toLowerCase();
        if (!val) return;
        for (const [cat, subcats] of Object.entries(taxonomy)) {
          if (typeof subcats === 'object' && !Array.isArray(subcats)) {
            for (const [sub, arr] of Object.entries(subcats)) {
              if (Array.isArray(arr) && cat + ' :: ' + sub === key) {
                if (!arr.includes(val)) arr.push(val);
              }
            }
          }
        }
        addInput.value = '';
        renderTaxonomy();
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
      container.appendChild(div);
    });
  }

  async function saveTaxonomyChanges() {
    if (!isElectron || !taxonomy) return;
    await api.saveTaxonomy(taxonomy);
    showToast(t('taxonomy_saved'), 'success');
  }

  // ── History ─────────────────────────────────────────────────
  async function loadHistory() {
    const container = $('#history-list');
    if (!isElectron) {
      container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);">${t('no_history')}</div>`;
      return;
    }
    try {
      const history = await api.getHistory() || [];
      if (history.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);">${t('no_history')}</div>`;
        return;
      }
      container.innerHTML = '';
      history.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const movedCount = entry.moves ? entry.moves.length : 0;
        const unmovedCount = entry.unmoved ? entry.unmoved.length : 0;
        const modeBadge = entry.mode === 'copy' ? '<span class="badge" style="margin-left:6px;">Copy</span>' : '<span class="badge" style="margin-left:6px;">Move</span>';
        item.innerHTML = `
          <div class="history-meta">
            <span class="history-date">${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''} ${modeBadge}</span>
            <span class="history-summary">${movedCount} ${t('moved_label')}, ${unmovedCount} ${t('unmatched_label')}</span>
          </div>
          <div class="history-actions">
            <button class="btn btn-sm btn-ghost btn-undo">${t('undo')}</button>
            <button class="btn btn-sm btn-ghost btn-open-folder">${t('open_folder')}</button>
          </div>
        `;
        item.querySelector('.btn-undo').addEventListener('click', async () => {
          if (!confirm(t('undo_confirm'))) return;
          showProgress(t('undoing'));
          try {
            const result = await api.undo(entry.id);
            hideProgress();
            if (result.success) {
              showToast(`${t('undo_success')} (${result.undone} files restored)`, 'success');
              loadHistory();
            } else {
              showToast(t('undo_failed') + ': ' + (result.error || ''), 'danger');
            }
          } catch (err) {
            hideProgress();
            showToast(t('undo_failed') + ': ' + err.message, 'danger');
          }
        });
        item.querySelector('.btn-open-folder').addEventListener('click', () => {
          if (entry.destFolder) api.openFolder(entry.destFolder);
        });
        container.appendChild(item);
      });
    } catch (_) {
      container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);">${t('no_history')}</div>`;
    }
  }

  // ── Organize: Scan & Preview ────────────────────────────────
  async function scanFolders() {
    if (organizeSources.length === 0) { showToast(t('need_sources'), 'danger'); return; }
    showProgress(t('scanning'));
    try {
      if (isElectron) {
        const fileTypes = $('#opt-filetypes').value.trim();
        lastScanResult = await api.preview({
          sourceFolders: organizeSources,
          options: { fileTypes: fileTypes ? fileTypes.split(',').map(s => s.trim()) : [] }
        });
      } else {
        await new Promise(r => setTimeout(r, 600));
        lastScanResult = { plan: [], unmoved: [], summary: {}, totalScanned: 0 };
      }
      renderScanResults();
      hideProgress();
    } catch (err) {
      hideProgress();
      showToast(t('scan_failed') + ': ' + err.message, 'danger');
    }
  }

  function renderScanResults() {
    if (!lastScanResult) return;
    const { plan, unmoved, summary, totalScanned } = lastScanResult;

    // Default each item to included
    plan.forEach(item => { if (item.included === undefined) item.included = true; });

    $('#stat-scanned').textContent = totalScanned;
    $('#stat-matched').textContent = plan.length;
    $('#stat-unmatched').textContent = unmoved.length;
    $('#stat-categories').textContent = Object.keys(summary).length;
    $('#matched-count').textContent = plan.length;

    // Render interactive organize table
    const tableBody = $('#organize-preview-body');
    if (tableBody) {
      tableBody.innerHTML = '';
      plan.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.idx = idx;

        // Subcategory options for this category
        const subcats = (taxonomy && taxonomy[item.category]) ? Object.keys(taxonomy[item.category]) : [item.subcategory];
        const subcatOptions = subcats.map(sub => `<option value="${sub}" ${sub === item.subcategory ? 'selected' : ''}>${sub}</option>`).join('');

        const splitBadge = item.isSplitPart
          ? `<span class="badge badge-split" title="Multi-part split archive [Part ${item.splitPartIndex}]">Part ${item.splitPartIndex}</span>`
          : '';

        tr.innerHTML = `
          <td><input type="checkbox" class="cb-plan-item" data-idx="${idx}" ${item.included ? 'checked' : ''} /></td>
          <td title="${item.from}"><strong>${shortenPath(item.filename, 40)}</strong> ${splitBadge}</td>
          <td><span class="badge">${item.ext}</span></td>
          <td>${formatBytes(item.size)}</td>
          <td><span class="badge" style="background:var(--accent-bg);color:var(--accent);">${item.category}</span></td>
          <td>
            <select class="select-inline-table select-subcat" data-idx="${idx}">
              ${subcatOptions}
            </select>
          </td>
          <td>
            <button type="button" class="btn-table-fab" data-filename="${item.filename}" title="Search on Fab.com">🔍 Fab</button>
          </td>
        `;

        tr.querySelector('.cb-plan-item').addEventListener('change', (e) => {
          item.included = e.target.checked;
          updateOrganizeButtonCounts();
        });

        tr.querySelector('.select-subcat').addEventListener('change', (e) => {
          item.subcategory = e.target.value;
          updateOrganizeSummaryCounts();
        });

        tableBody.appendChild(tr);
      });
    }

    renderOrganizeSummary(summary);

    const unmatchedEl = $('#unmatched-list');
    unmatchedEl.innerHTML = '';
    unmoved.forEach(f => {
      const item = document.createElement('div');
      item.className = 'unmatched-item';
      const splitBadge = f.isSplitPart
        ? `<span class="badge badge-split" title="Multi-part split archive [Part ${f.splitPartIndex}]">Part ${f.splitPartIndex}</span>`
        : '';
      item.innerHTML = `
        <span title="${f.from}"><strong>${shortenPath(f.filename, 45)}</strong> ${splitBadge}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="badge">${f.ext}</span>
          <span class="badge">${formatBytes(f.size)}</span>
          <button type="button" class="btn-table-fab" data-filename="${f.filename}" title="Search on Fab.com">🔍 Fab</button>
        </div>
      `;
      unmatchedEl.appendChild(item);
    });

    $('#unmatched-count').textContent = unmoved.length;
    $('#results-area').classList.remove('hidden');
    $('#btn-organize').disabled = false;
    $('#btn-export-organize').disabled = false;
    $('#search-organize-wrap').classList.remove('hidden');

    updateOrganizeButtonCounts();
  }

  function renderOrganizeSummary(summary) {
    const summaryEl = $('#summary-list');
    summaryEl.innerHTML = '';
    Object.entries(summary).sort().forEach(([cat, count]) => {
      const item = document.createElement('div');
      item.className = 'summary-item';
      item.innerHTML = `<span>${cat}</span><span class="badge">${count} ${t('files_count')}</span>`;
      summaryEl.appendChild(item);
    });
  }

  function updateOrganizeSummaryCounts() {
    if (!lastScanResult) return;
    const summary = {};
    lastScanResult.plan.forEach(item => {
      if (item.included) {
        const key = `${item.category} / ${item.subcategory}`;
        summary[key] = (summary[key] || 0) + 1;
      }
    });
    renderOrganizeSummary(summary);
    $('#stat-categories').textContent = Object.keys(summary).length;
  }

  function updateOrganizeButtonCounts() {
    if (!lastScanResult) return;
    const includedCount = lastScanResult.plan.filter(i => i.included).length;
    $('#stat-matched').textContent = includedCount;
    $('#btn-organize').disabled = includedCount === 0;
  }

  // ── Organize: Execute ───────────────────────────────────────
  async function runOrganize() {
    if (!organizeDest) { showToast(t('need_dest'), 'danger'); return; }
    if (!lastScanResult || !lastScanResult.plan.length) { showToast(t('need_sources'), 'danger'); return; }

    const activePlan = lastScanResult.plan.filter(i => i.included !== false);
    if (activePlan.length === 0) {
      showToast('No files selected to organize', 'danger');
      return;
    }

    const dryRun = $('#opt-dryrun').checked;
    const copyInstead = $('#opt-copy').checked;
    const conflictResolution = $('#opt-conflict') ? $('#opt-conflict').value : 'rename';
    const cleanupEmptyDirs = $('#opt-cleanup') ? $('#opt-cleanup').checked : false;

    showProgress(dryRun ? t('dry_running') : t('organizing'));
    try {
      let result;
      if (isElectron) {
        result = await api.organize({
          sourceFolders: organizeSources,
          destFolder: organizeDest,
          plan: activePlan,
          options: { dryRun, copyInstead, conflictResolution, cleanupEmptyDirs }
        });
      } else {
        await new Promise(r => setTimeout(r, 600));
        result = { moves: [], unmoved: [], errors: [] };
      }

      hideProgress();
      const msg = dryRun
        ? `${t('dry_run_complete')}: ${result.moves.length} ${t('files_count')}`
        : `${t('done_moved')} ${result.moves.length} ${t('files_count')}${result.errors && result.errors.length > 0 ? ', ' + result.errors.length + ' ' + t('errors_count') : ''}`;
      showToast(msg, result.errors && result.errors.length > 0 ? 'danger' : 'success');
      loadHistory();
    } catch (err) {
      hideProgress();
      showToast(t('organize_failed') + ': ' + err.message, 'danger');
    }
  }

  // ── Duplicates ──────────────────────────────────────────────
  async function findDuplicates() {
    if (dupSources.length === 0) { showToast(t('need_sources'), 'danger'); return; }
    showProgress(t('dup_scanning'));
    try {
      if (isElectron) {
        const mode = $('#dup-mode') ? $('#dup-mode').value : 'exact';
        const fileTypes = $('#dup-filetypes').value.trim();
        const minSize = parseInt($('#dup-minsize').value) || 0;
        const maxSizeMB = parseFloat($('#dup-maxsize').value) || 0;
        dupResults = await api.findDuplicates({
          sourceFolders: dupSources,
          options: {
            mode,
            fileTypes: fileTypes ? fileTypes.split(',').map(s => s.trim()) : [],
            minSize: minSize * 1024,
            maxSize: maxSizeMB > 0 ? maxSizeMB * 1024 * 1024 : Infinity
          }
        });
      } else {
        await new Promise(r => setTimeout(r, 800));
        dupResults = { groups: [], stats: { totalFiles: 0, filesScanned: 0, duplicateGroups: 0, totalDuplicates: 0, wastedBytes: 0 } };
      }
      hideProgress();
      renderDupResults();
    } catch (err) {
      hideProgress();
      showToast(t('scan_failed') + ': ' + err.message, 'danger');
    }
  }

  function renderDupResults() {
    if (!dupResults) return;
    const { groups, stats } = dupResults;

    $('#dup-stat-scanned').textContent = stats.filesScanned;
    $('#dup-stat-groups').textContent = stats.duplicateGroups;
    $('#dup-stat-total').textContent = stats.totalDuplicates;
    $('#dup-stat-wasted').textContent = formatBytes(stats.wastedBytes);

    $('#dup-stats-area').classList.remove('hidden');
    $('#dup-groups-area').classList.remove('hidden');
    $('#search-dup-wrap').classList.remove('hidden');

    renderDupGroups(groups);
    updateDupButtons();
  }

  function renderDupGroups(groups) {
    const container = $('#dup-groups-list');
    container.innerHTML = '';
    if (!groups || groups.length === 0) {
      container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);">${t('dup_no_duplicates')}</div>`;
      return;
    }

    groups.forEach((group, gi) => {
      const newestIdx = group.files.reduce((bi, f, i, arr) =>
        (f.mtime || 0) > (arr[bi].mtime || 0) ? i : bi, 0);

      const div = document.createElement('div');
      div.className = 'dup-group';
      const totalSize = group.files.reduce((s, f) => s + (f.size || 0), 0);
      const isSmart = group.mode === 'smart';

      let filesHTML = '';
      group.files.forEach((f, fi) => {
        const isNewest = fi === newestIdx;
        const formattedDate = f.mtime ? new Date(f.mtime).toLocaleDateString() : '';
        filesHTML += `
          <div class="dup-file-item ${isNewest ? 'is-newest' : ''}">
            <label>
              <input type="checkbox" data-group="${gi}" data-file="${fi}" ${isNewest ? '' : 'checked'} />
              <span class="dup-file-path" title="${f.filePath}">${shortenPath(f.filePath, 55)}</span>
            </label>
            <span class="dup-file-date" style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);margin:0 6px;">${formattedDate}</span>
            <span class="dup-file-size">${formatBytes(f.size)}</span>
            ${isNewest ? `<span class="badge" style="background:var(--success-bg);color:var(--success);margin-left:6px;">${t('dup_original')}</span>` : `<span class="badge" style="background:rgba(239, 68, 68, 0.15);color:var(--danger);margin-left:6px;">${t('dup_older')}</span>`}
          </div>
        `;
      });

      const groupTitle = isSmart
        ? `${t('dup_group_label') || 'Group'} ${gi + 1}: ${group.label || t('dup_smart_asset') || 'Asset Duplicate'}`
        : `${t('dup_group_label') || 'Group'} ${gi + 1} — SHA256: ${group.hash ? group.hash.substring(0, 10) : ''}...`;

      div.innerHTML = `
        <div class="dup-group-header">
          <h4>${groupTitle}</h4>
          <span class="dup-group-size">${group.files.length} ${isSmart ? 'repacks' : 'files'} · ${formatBytes(totalSize)}</span>
        </div>
        ${filesHTML}
      `;
      container.appendChild(div);
    });

    $$('#dup-groups-list input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', updateDupButtons);
    });
  }

  function updateDupButtons() {
    const checked = $$('#dup-groups-list input[type="checkbox"]:checked');
    $('#btn-delete-selected').disabled = checked.length === 0;
    $('#btn-delete-all-except-newest').disabled = !dupResults || dupResults.groups.length === 0;
    $('#btn-export-dup').disabled = !dupResults || dupResults.groups.length === 0;
  }

  function getCheckedDupFiles() {
    const checked = $$('#dup-groups-list input[type="checkbox"]:checked');
    const files = [];
    checked.forEach(cb => {
      const gi = parseInt(cb.dataset.group);
      const fi = parseInt(cb.dataset.file);
      if (dupResults && dupResults.groups[gi] && dupResults.groups[gi].files[fi]) {
        files.push(dupResults.groups[gi].files[fi]);
      }
    });
    return files;
  }

  async function trashSelectedDups() {
    const files = getCheckedDupFiles();
    if (files.length === 0) return;
    if (!confirm(t('dup_confirm_trash'))) return;
    showProgress(t('dup_trashing'));
    try {
      let result;
      if (isElectron) {
        result = await api.trashDuplicates(files.map(f => f.filePath));
      } else {
        await new Promise(r => setTimeout(r, 500));
        result = { trashed: files.length, errors: [] };
      }
      hideProgress();
      showToast(`${t('dup_trashed')}: ${result.trashed}/${files.length}`, 'success');
      if (dupResults) {
        dupResults.groups.forEach(g => {
          g.files = g.files.filter(f => !files.some(df => df.filePath === f.filePath));
        });
        dupResults.groups = dupResults.groups.filter(g => g.files.length > 1);
        renderDupResults();
      }
    } catch (err) {
      hideProgress();
      showToast(t('dup_trash_failed') + ': ' + err.message, 'danger');
    }
  }

  async function keepNewestOnly() {
    if (!dupResults || dupResults.groups.length === 0) return;
    if (!confirm(t('dup_confirm_keep_newest'))) return;
    const filesToTrash = [];
    dupResults.groups.forEach(g => {
      if (g.files.length < 2) return;
      let newestIdx = 0;
      g.files.forEach((f, i) => {
        if ((f.mtime || 0) > (g.files[newestIdx].mtime || 0)) newestIdx = i;
      });
      g.files.forEach((f, i) => {
        if (i !== newestIdx) filesToTrash.push(f);
      });
    });
    if (filesToTrash.length === 0) return;
    showProgress(t('dup_trashing'));
    try {
      let result;
      if (isElectron) {
        result = await api.trashDuplicates(filesToTrash.map(f => f.filePath));
      } else {
        await new Promise(r => setTimeout(r, 500));
        result = { trashed: filesToTrash.length, errors: [] };
      }
      hideProgress();
      showToast(`${t('dup_trashed')}: ${result.trashed}/${filesToTrash.length}`, 'success');
      if (dupResults) {
        dupResults.groups.forEach(g => {
          let newestIdx = 0;
          g.files.forEach((f, i) => {
            if ((f.mtime || 0) > (g.files[newestIdx].mtime || 0)) newestIdx = i;
          });
          g.files = [g.files[newestIdx]];
        });
        dupResults.groups = dupResults.groups.filter(g => g.files.length > 1);
        renderDupResults();
      }
    } catch (err) {
      hideProgress();
      showToast(t('dup_trash_failed') + ': ' + err.message, 'danger');
    }
  }

  // ── Batch Rename (Modernized with Tokens & Live Preview) ──────
  function applyCasing(str, mode) {
    if (!mode || mode === 'keep') return str;
    if (mode === 'lower') return str.toLowerCase();
    if (mode === 'upper') return str.toUpperCase();

    // Split on uppercase boundaries or delimiters
    const normalized = str.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    const tokens = normalized.split(/[\s_\-]+/).filter(Boolean);

    if (mode === 'title') {
      return tokens.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('_');
    }
    if (mode === 'camel') {
      return tokens.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    }
    if (mode === 'snake') {
      return tokens.map(w => w.toLowerCase()).join('_');
    }
    if (mode === 'kebab') {
      return tokens.map(w => w.toLowerCase()).join('-');
    }
    return str;
  }

  function computeNewName(fileItem, options) {
    const filename = fileItem.filename || fileItem;
    const ext = PathUtils.extname(filename);
    let base = PathUtils.basename(filename, ext);
    const parentDir = PathUtils.basename(fileItem.directory || PathUtils.dirname(fileItem.filePath || ''));
    const today = new Date().toISOString().split('T')[0];

    const replaceTokens = (pattern, currentNum) => {
      if (!pattern) return '';
      const numStr = String(currentNum).padStart(options.numberDigits, '0');
      return pattern
        .replace(/\{name\}/gi, base)
        .replace(/\{ext\}/gi, ext.replace(/^\./, ''))
        .replace(/\{parent\}/gi, parentDir)
        .replace(/\{folder\}/gi, parentDir)
        .replace(/\{date\}/gi, today)
        .replace(/\{counter\}/gi, numStr);
    };

    // Find & Replace
    if (options.findReplace) {
      if (options.regex) {
        try {
          const re = new RegExp(options.find, 'g');
          base = base.replace(re, replaceTokens(options.replace, options.numberStart));
        } catch (_) {}
      } else {
        if (options.find) base = base.split(options.find).join(replaceTokens(options.replace, options.numberStart));
      }
    }

    // Prefix & Suffix
    if (options.prefix) base = replaceTokens(options.prefix, options.numberStart) + base;
    if (options.suffix) base = base + replaceTokens(options.suffix, options.numberStart);

    // Numbering
    if (options.numberMode !== 'none') {
      const num = String(options.numberStart).padStart(options.numberDigits, '0');
      if (options.numberMode === 'prefix') base = num + '_' + base;
      else if (options.numberMode === 'suffix') base = base + '_' + num;
      else if (options.numberMode === 'replace') base = num;
      options.numberStart += options.numberStep;
    }

    // Casing
    base = applyCasing(base, options.caseMode);

    // Trim
    if (options.trim) base = base.trim();

    return base + ext;
  }

  function getRenameOptions() {
    return {
      findReplace: $('#rn-find-replace').checked,
      find: $('#rn-find').value,
      replace: $('#rn-replace').value,
      regex: $('#rn-regex').checked,
      prefix: $('#rn-prefix').value,
      suffix: $('#rn-suffix').value,
      numberMode: $('#rn-number-mode').value,
      numberStart: parseInt($('#rn-number-start').value) || 0,
      numberStep: parseInt($('#rn-number-step').value) || 1,
      numberDigits: parseInt($('#rn-number-digits').value) || 3,
      caseMode: $('#rn-case-mode') ? $('#rn-case-mode').value : 'keep',
      trim: $('#rn-trim').checked,
      fileTypes: $('#rn-filetypes').value.trim() ? $('#rn-filetypes').value.split(',').map(s => s.trim()) : [],
      recursive: $('#rn-recursive').checked,
    };
  }

  async function scanRenameFolder() {
    const allFolders = [renameFolder, ...renameSources].filter(Boolean);
    if (allFolders.length === 0) { showToast(t('need_sources'), 'danger'); return; }
    showProgress(t('rename_scanning'));
    try {
      const opts = getRenameOptions();
      if (isElectron) {
        renameScanFiles = await api.batchRenameScan({ folders: allFolders, options: opts });
      } else {
        await new Promise(r => setTimeout(r, 400));
        renameScanFiles = [];
      }
      recalculateRenamePreview();
      hideProgress();
    } catch (err) {
      hideProgress();
      showToast(t('scan_failed') + ': ' + err.message, 'danger');
    }
  }

  function recalculateRenamePreview() {
    const opts = getRenameOptions();
    renamePreview = [];
    const counter = { numberStart: opts.numberStart };
    renameScanFiles.forEach(f => {
      const fileOpts = { ...opts, numberStart: counter.numberStart };
      const newName = computeNewName(f, fileOpts);
      counter.numberStart = fileOpts.numberStart;
      renamePreview.push({
        from: f.filePath,
        oldName: f.filename,
        newName,
        directory: f.directory,
        status: newName !== f.filename ? 'changed' : 'unchanged'
      });
    });
    renderRenamePreview();
  }

  function renderRenamePreview() {
    const total = renamePreview.length;
    const changed = renamePreview.filter(r => r.status === 'changed').length;
    $('#rn-stat-total').textContent = total;
    $('#rn-stat-changed').textContent = changed;
    $('#rn-stat-unchanged').textContent = total - changed;

    const body = $('#rename-preview-body');
    body.innerHTML = '';
    renamePreview.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td title="${r.from}">${shortenPath(r.oldName, 45)}</td>
        <td class="${r.status === 'changed' ? 'rename-status-changed' : ''}">${shortenPath(r.newName, 45)}</td>
        <td class="${r.status === 'changed' ? 'rename-status-changed' : 'rename-status-unchanged'}">${r.status === 'changed' ? t('rename_changed') : t('rename_unchanged')}</td>
      `;
      body.appendChild(tr);
    });

    $('#rename-results-area').classList.remove('hidden');
    $('#btn-rename-execute').disabled = changed === 0;
    $('#btn-rename-export').disabled = total === 0;
    $('#search-rename-wrap').classList.remove('hidden');
    refreshRenameUndoButton();
  }

  async function refreshRenameUndoButton() {
    if (!isElectron) return;
    try {
      const hist = await api.getRenameHistory() || [];
      $('#btn-rename-undo').disabled = hist.length === 0;
    } catch (_) {
      $('#btn-rename-undo').disabled = true;
    }
  }

  async function executeRename() {
    const dryRun = $('#rn-dryrun').checked;
    const toRename = renamePreview.filter(r => r.status === 'changed');
    if (toRename.length === 0) return;

    if (!dryRun && !confirm(t('rename_execute') + '?')) return;
    showProgress(dryRun ? t('dry_running') : t('rename_executing'));
    try {
      const renames = toRename.map(r => ({ from: r.from, to: PathUtils.join(r.directory, r.newName) }));
      let result;
      if (isElectron) {
        result = await api.batchRenameExecute({ renames, dryRun });
      } else {
        await new Promise(r => setTimeout(r, 400));
        result = { results: renames.map(r => ({ ...r, status: dryRun ? 'dry-run' : 'renamed' })), errors: [] };
      }
      hideProgress();
      const renamed = result.results.filter(r => r.status === 'renamed' || r.status === 'dry-run').length;
      showToast(`${dryRun ? t('dry_run_complete') : t('rename_complete')}: ${renamed}/${toRename.length}`, 'success');
      renamePreview.forEach(r => {
        const match = result.results.find(rr => rr.from === r.from);
        if (match && match.status === 'renamed') { r.status = 'done'; }
      });
      renderRenamePreview();
    } catch (err) {
      hideProgress();
      showToast(t('scan_failed') + ': ' + err.message, 'danger');
    }
  }

  async function undoRename() {
    if (!isElectron) return;
    try {
      const history = await api.getRenameHistory();
      if (history.length === 0) { showToast(t('no_history'), 'danger'); return; }
      const last = history[history.length - 1];
      if (!confirm(t('rename_undo_confirm'))) return;
      showProgress(t('undoing'));
      const result = await api.batchRenameUndo(last.id);
      hideProgress();
      if (result.success) {
        showToast(`${t('rename_undo_done')}: ${result.undone} files restored`, 'success');
        refreshRenameUndoButton();
        scanRenameFolder();
      } else {
        showToast(t('undo_failed') + ': ' + (result.error || ''), 'danger');
      }
    } catch (err) {
      hideProgress();
      showToast(err.message, 'danger');
    }
  }

  async function exportRenameReport() {
    if (renamePreview.length === 0) return;
    const rows = [['Original', 'New Name', 'Status', 'Directory']];
    renamePreview.forEach(r => rows.push([r.oldName, r.newName, r.status, r.directory]));
    const csvContent = toCSV(rows);
    if (isElectron) {
      await api.exportCsv({ data: csvContent, defaultName: 'rename-report.csv' });
      showToast(t('export_success'), 'success');
    } else {
      downloadBlob('rename-report.csv', csvContent);
    }
  }

  // ── Statistics ──────────────────────────────────────────────
  async function analyzeFolder() {
    if (!statsFolder) { showToast(t('need_dest'), 'danger'); return; }
    showProgress(t('scanning'));
    try {
      if (isElectron) {
        lastStats = await api.analyzeFolder(statsFolder);
      } else {
        await new Promise(r => setTimeout(r, 600));
        lastStats = { totalFiles: 0, totalSize: 0, extBreakdown: [], categoryBreakdown: [], dirBreakdown: [], largest: [], sizeDistribution: [], modTimeDistribution: [] };
      }
      hideProgress();
      renderStatsResults();
    } catch (err) {
      hideProgress();
      showToast(t('scan_failed') + ': ' + err.message, 'danger');
    }
  }

  function renderStatsResults() {
    if (!lastStats) return;
    const s = lastStats;

    $('#stats-total-files').textContent = s.totalFiles;
    $('#stats-total-size').textContent = formatBytes(s.totalSize);
    $('#stats-total-types').textContent = (s.extBreakdown || []).length;

    // Fab.com Categories Table
    const catBody = $('#stats-category-body');
    if (catBody) {
      catBody.innerHTML = '';
      (s.categoryBreakdown || []).forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${d.category}</strong></td><td>${d.count}</td><td>${formatBytes(d.size)}</td>`;
        catBody.appendChild(tr);
      });
    }

    // Size distribution chart
    if (s.sizeDistribution) {
      const sizeData = {};
      s.sizeDistribution.forEach(r => { sizeData[r.label] = r.count; });
      renderChartBars($('#stats-size-chart'), sizeData, 'files');
    }

    // Age distribution chart
    if (s.modTimeDistribution) {
      const modData = {};
      s.modTimeDistribution.forEach(r => { modData[r.label] = r.count; });
      renderChartBars($('#stats-mod-chart'), modData, 'files');
    }

    // Extension table
    const extBody = $('#stats-ext-body');
    extBody.innerHTML = '';
    (s.extBreakdown || []).forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.ext}</td><td>${d.count}</td><td>${formatBytes(d.size)}</td>`;
      extBody.appendChild(tr);
    });

    // Largest files
    const largestBody = $('#stats-largest-body');
    largestBody.innerHTML = '';
    (s.largest || []).forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td title="${f.filePath}">${shortenPath(f.filename, 40)}</td><td>${formatBytes(f.size)}</td><td title="${f.directory}">${shortenPath(f.directory, 35)}</td>`;
      largestBody.appendChild(tr);
    });

    // Top directories
    const dirBody = $('#stats-dir-body');
    dirBody.innerHTML = '';
    (s.dirBreakdown || []).forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td title="${d.dir}">${shortenPath(d.dir, 40)}</td><td>${d.count}</td><td>${formatBytes(d.size)}</td>`;
      dirBody.appendChild(tr);
    });

    $('#stats-results').classList.remove('hidden');
    $('#btn-export-stats').disabled = false;
  }

  function renderChartBars(container, data, unitLabel) {
    container.innerHTML = '';
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    if (entries.length === 0) return;
    const maxVal = Math.max(...entries.map(([, v]) => v));
    entries.forEach(([label, value]) => {
      const pct = maxVal > 0 ? (value / maxVal * 100) : 0;
      const row = document.createElement('div');
      row.className = 'chart-bar-row';
      row.innerHTML = `
        <span class="chart-bar-label">${label}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <span class="chart-bar-value">${value} ${unitLabel}</span>
      `;
      container.appendChild(row);
    });
  }

  // ── Export (Excel / CSV with UTF-8 BOM) ──────────────────────
  async function exportOrganizeReport() {
    if (!lastScanResult) return;
    const rows = [['File Name', 'Extension', 'Size (Bytes)', 'Size (Formatted)', 'Target Category', 'Subcategory', 'Source Path']];
    (lastScanResult.plan || []).forEach(item => {
      rows.push([item.filename, item.ext, item.size, formatBytes(item.size), item.category, item.subcategory, item.from]);
    });
    (lastScanResult.unmoved || []).forEach(item => {
      rows.push([item.filename, item.ext, item.size, formatBytes(item.size), 'Unmatched', '', item.from]);
    });
    const csv = toCSV(rows);
    if (isElectron) {
      await api.exportCsv({ data: csv, defaultName: 'fab-organize-report.csv' });
      showToast(t('export_success'), 'success');
    } else {
      downloadBlob('fab-organize-report.csv', csv);
    }
  }

  async function exportDupReport() {
    if (!dupResults) return;
    const rows = [['Group #', 'File Name', 'Size (Bytes)', 'Size (Formatted)', 'Last Modified', 'Full Path', 'SHA256 Hash']];
    dupResults.groups.forEach((g, i) => {
      g.files.forEach(f => {
        rows.push([i + 1, f.filename, f.size, formatBytes(f.size), new Date(f.mtime).toISOString(), f.filePath, g.hash]);
      });
    });
    const csv = toCSV(rows);
    if (isElectron) {
      await api.exportCsv({ data: csv, defaultName: 'duplicates-report.csv' });
      showToast(t('export_success'), 'success');
    } else {
      downloadBlob('duplicates-report.csv', csv);
    }
  }

  async function exportStatsReport() {
    if (!lastStats) return;
    const rows = [['Section', 'Item / Extension', 'Count', 'Size (Bytes)', 'Size (Formatted)']];
    (lastStats.categoryBreakdown || []).forEach(d => {
      rows.push(['Fab.com Category', d.category, d.count, d.size, formatBytes(d.size)]);
    });
    (lastStats.extBreakdown || []).forEach(d => {
      rows.push(['File Type', d.ext, d.count, d.size, formatBytes(d.size)]);
    });
    const csv = toCSV(rows);
    if (isElectron) {
      await api.exportCsv({ data: csv, defaultName: 'statistics-report.csv' });
      showToast(t('export_success'), 'success');
    } else {
      downloadBlob('statistics-report.csv', csv);
    }
  }

  function downloadBlob(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Search Filters ──────────────────────────────────────────
  function filterOrganizeResults(query) {
    query = query.toLowerCase();
    $$('#organize-preview-body tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
    $$('#unmatched-list .unmatched-item').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
    $$('#summary-list .summary-item').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  }

  function filterDupResults(query) {
    query = query.toLowerCase();
    $$('#dup-groups-list .dup-group').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'o') { e.preventDefault(); switchView('organize'); }
      else if (key === 'd') { e.preventDefault(); switchView('duplicates'); }
      else if (key === 'i') { e.preventDefault(); switchView('statistics'); }
      else if (key === 'h') { e.preventDefault(); switchView('history'); }
      else if (key === 'r') { e.preventDefault(); switchView('rename'); }
      else if (key === 's') { e.preventDefault(); scanFolders(); }
      else if (key === 'e') {
        e.preventDefault();
        const active = $('.view.active');
        if (active?.id === 'view-organize') exportOrganizeReport();
        else if (active?.id === 'view-duplicates') exportDupReport();
        else if (active?.id === 'view-statistics') exportStatsReport();
      }
      else if (key === 'f') {
        e.preventDefault();
        const active = $('.view.active');
        if (active?.id === 'view-organize') $('#search-organize')?.focus();
        else if (active?.id === 'view-duplicates') $('#search-dup')?.focus();
        else if (active?.id === 'view-rename') $('#search-rename')?.focus();
      }
    });
  }

  // ── Drag & Drop ─────────────────────────────────────────────
  function setupDropZone(elementId, onDrop) {
    const zone = document.getElementById(elementId);
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const paths = [];
      if (e.dataTransfer.files) {
        Array.from(e.dataTransfer.files).forEach(f => { if (f.path) paths.push(f.path); });
      }
      if (paths.length > 0) onDrop(paths);
    });
  }

  // ── Initialize ──────────────────────────────────────────────
  async function init() {
    if (isElectron) {
      try {
        const prefs = await api.getPrefs();
        if (prefs.theme) currentTheme = prefs.theme;
        if (prefs.language) currentLang = prefs.language;
      } catch (_) {}
    }

    await loadI18n();
    setTheme(currentTheme);
    setLanguage(currentLang);
    await loadTaxonomy();
    await loadHistory();
    await loadRecentFolders();
    await loadFavorites();
    refreshRenameUndoButton();

    // Sidebar navigation
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Theme buttons
    $$('.theme-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        setTheme(btn.dataset.theme);
        if (isElectron) await api.savePrefs({ theme: currentTheme, language: currentLang });
      });
    });

    // Language buttons
    $$('.lang-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        setLanguage(btn.dataset.lang);
        if (isElectron) await api.savePrefs({ theme: currentTheme, language: currentLang });
      });
    });

    // Organize: Dest folder
    $('#btn-select-dest').addEventListener('click', async () => {
      const folder = await pickDestFolder();
      if (folder) {
        organizeDest = folder;
        $('#dest-path').textContent = folder;
        loadRecentFolders();
        updateOrganizeButtons();
      }
    });

    // Organize: Source folders
    $('#btn-add-sources').addEventListener('click', async () => {
      const folders = await pickSourceFolders();
      if (folders.length > 0) {
        folders.forEach(f => { if (!organizeSources.includes(f)) organizeSources.push(f); });
        refreshOrganizeSources();
      }
    });

    $('#btn-clear-sources').addEventListener('click', () => {
      organizeSources = [];
      refreshOrganizeSources();
    });

    function refreshOrganizeSources() {
      renderSourceList($('#source-list'), organizeSources, refreshOrganizeSources);
      $('#btn-clear-sources').disabled = organizeSources.length === 0;
      updateOrganizeButtons();
    }

    function updateOrganizeButtons() {
      $('#btn-scan').disabled = organizeSources.length === 0;
      $('#btn-save-favorite').disabled = organizeSources.length === 0 && !organizeDest;
    }

    // Recent & Favorites
    $('#recent-folders').addEventListener('change', e => {
      if (e.target.value && !organizeSources.includes(e.target.value)) {
        organizeSources.push(e.target.value);
        refreshOrganizeSources();
      }
    });

    $('#favorites-select').addEventListener('change', e => {
      if (e.target.value && !organizeSources.includes(e.target.value)) {
        organizeSources.push(e.target.value);
        refreshOrganizeSources();
      }
    });

    $('#btn-save-favorite').addEventListener('click', saveFavorite);

    // Organize Actions
    $('#btn-scan').addEventListener('click', scanFolders);
    $('#btn-organize').addEventListener('click', runOrganize);
    $('#btn-export-organize').addEventListener('click', exportOrganizeReport);
    $('#search-organize').addEventListener('input', e => filterOrganizeResults(e.target.value));

    // Organize Interactive Table Selection
    const masterCb = $('#cb-matched-master');
    if (masterCb) {
      masterCb.addEventListener('change', (e) => {
        const val = e.target.checked;
        $$('.cb-plan-item').forEach(cb => {
          cb.checked = val;
          const idx = parseInt(cb.dataset.idx);
          if (lastScanResult && lastScanResult.plan[idx]) {
            lastScanResult.plan[idx].included = val;
          }
        });
        updateOrganizeButtonCounts();
      });
    }

    const btnSelectAll = $('#btn-select-all-matched');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        if (masterCb) masterCb.checked = true;
        $$('.cb-plan-item').forEach(cb => {
          cb.checked = true;
          const idx = parseInt(cb.dataset.idx);
          if (lastScanResult && lastScanResult.plan[idx]) {
            lastScanResult.plan[idx].included = true;
          }
        });
        updateOrganizeButtonCounts();
      });
    }

    const btnDeselectAll = $('#btn-deselect-all-matched');
    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', () => {
        if (masterCb) masterCb.checked = false;
        $$('.cb-plan-item').forEach(cb => {
          cb.checked = false;
          const idx = parseInt(cb.dataset.idx);
          if (lastScanResult && lastScanResult.plan[idx]) {
            lastScanResult.plan[idx].included = false;
          }
        });
        updateOrganizeButtonCounts();
      });
    }

    // Duplicates Actions
    $('#btn-dup-add-sources').addEventListener('click', async () => {
      const folders = await pickSourceFolders();
      if (folders.length > 0) {
        folders.forEach(f => { if (!dupSources.includes(f)) dupSources.push(f); });
        refreshDupSources();
      }
    });

    $('#btn-dup-clear-sources').addEventListener('click', () => {
      dupSources = [];
      refreshDupSources();
    });

    function refreshDupSources() {
      renderSourceList($('#dup-source-list'), dupSources, refreshDupSources);
      $('#btn-dup-clear-sources').disabled = dupSources.length === 0;
      $('#btn-find-duplicates').disabled = dupSources.length === 0;
    }

    $('#btn-find-duplicates').addEventListener('click', findDuplicates);
    $('#btn-delete-selected').addEventListener('click', trashSelectedDups);
    $('#btn-delete-all-except-newest').addEventListener('click', keepNewestOnly);
    $('#btn-export-dup').addEventListener('click', exportDupReport);
    $('#search-dup').addEventListener('input', e => filterDupResults(e.target.value));

    $('#btn-select-all-dups').addEventListener('click', () => {
      $$('#dup-groups-list input[type="checkbox"]').forEach(cb => {
        const gi = parseInt(cb.dataset.group);
        const fi = parseInt(cb.dataset.file);
        if (dupResults?.groups[gi]) {
          let newestIdx = 0;
          dupResults.groups[gi].files.forEach((f, i, arr) => {
            if ((f.mtime || 0) > (arr[newestIdx].mtime || 0)) newestIdx = i;
          });
          cb.checked = fi !== newestIdx;
        }
      });
      updateDupButtons();
    });

    $('#btn-deselect-all').addEventListener('click', () => {
      $$('#dup-groups-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      updateDupButtons();
    });

    // Statistics
    $('#btn-stats-folder').addEventListener('click', async () => {
      const folder = await pickStatsFolder();
      if (folder) {
        statsFolder = folder;
        $('#stats-folder-path').textContent = folder;
        $('#btn-analyze').disabled = false;
      }
    });

    $('#btn-analyze').addEventListener('click', analyzeFolder);
    $('#btn-export-stats').addEventListener('click', exportStatsReport);

    // Taxonomy Save
    $('#btn-save-taxonomy').addEventListener('click', saveTaxonomyChanges);

    // Drop Zones
    setupDropZone('drop-zone-organize', paths => {
      paths.forEach(p => { if (!organizeSources.includes(p)) organizeSources.push(p); });
      refreshOrganizeSources();
    });

    setupDropZone('drop-zone-dup', paths => {
      paths.forEach(p => { if (!dupSources.includes(p)) dupSources.push(p); });
      refreshDupSources();
    });

    // ── Batch Rename Setup ──
    $('#btn-rename-folder').addEventListener('click', async () => {
      const folder = await pickRenameFolder();
      if (folder) {
        renameFolder = folder;
        $('#rename-folder-path').textContent = folder;
        updateRenameButtons();
      }
    });

    $('#btn-rename-add-sources').addEventListener('click', async () => {
      const folders = await pickSourceFolders();
      if (folders.length > 0) {
        folders.forEach(f => { if (!renameSources.includes(f)) renameSources.push(f); });
        refreshRenameSources();
      }
    });

    $('#btn-rename-clear-sources').addEventListener('click', () => {
      renameSources = [];
      refreshRenameSources();
    });

    function refreshRenameSources() {
      renderSourceList($('#rename-source-list'), renameSources, refreshRenameSources);
      $('#btn-rename-clear-sources').disabled = renameSources.length === 0;
      updateRenameButtons();
    }

    function updateRenameButtons() {
      $('#btn-rename-scan').disabled = !renameFolder && renameSources.length === 0;
    }

    $('#btn-rename-scan').addEventListener('click', scanRenameFolder);
    $('#btn-rename-execute').addEventListener('click', executeRename);
    $('#btn-rename-undo').addEventListener('click', undoRename);
    $('#btn-rename-export').addEventListener('click', exportRenameReport);

    // Live reactive recalculation on rename input changes
    const reactiveInputs = [
      '#rn-find', '#rn-replace', '#rn-regex', '#rn-prefix', '#rn-suffix',
      '#rn-number-mode', '#rn-number-start', '#rn-number-step', '#rn-number-digits',
      '#rn-case-mode', '#rn-trim'
    ];
    let debounceTimer = null;
    reactiveInputs.forEach(sel => {
      const el = $(sel);
      if (el) {
        const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(evt, () => {
          if (renameScanFiles.length > 0) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(recalculateRenamePreview, 80);
          }
        });
      }
    });

    $('#search-rename').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      $$('#rename-preview-body tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    setupDropZone('drop-zone-rename', paths => {
      if (paths.length > 0 && !renameFolder) {
        renameFolder = paths[0];
        $('#rename-folder-path').textContent = paths[0];
        for (let i = 1; i < paths.length; i++) {
          if (!renameSources.includes(paths[i])) renameSources.push(paths[i]);
        }
        refreshRenameSources();
      } else {
        paths.forEach(p => { if (!renameSources.includes(p)) renameSources.push(p); });
        refreshRenameSources();
      }
      updateRenameButtons();
    });

    // External Social Links
    $$('.social-link[data-href]').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = link.dataset.href;
        if (isElectron && api.openExternal) {
          await api.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      });
    });

    // Global Fab.com Search button handler
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-table-fab');
      if (!btn) return;
      const rawName = btn.dataset.filename || '';
      const cleanQ = rawName
        .replace(/\.part0*[0-9]+(_[0-9]+)?$/i, '')
        .replace(/\.(00[1-9]|0[1-9][0-9])$/i, '')
        .replace(/\bUE[0-9]+(\.[0-9]+)?\+?\b/gi, '')
        .replace(/\bUE[0-9]{2,3}\b/gi, '')
        .replace(/\bv[0-9]+(\.[0-9]+)*\+?\b/gi, '')
        .replace(/_[0-9]+$/g, '')
        .replace(/\.[a-zA-Z0-9]+$/g, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .trim();
      if (cleanQ) {
        const fabUrl = `https://www.fab.com/search?q=${encodeURIComponent(cleanQ)}`;
        if (isElectron && api.openExternal) {
          await api.openExternal(fabUrl);
        } else {
          window.open(fabUrl, '_blank');
        }
      }
    });

    initKeyboardShortcuts();
  }

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
