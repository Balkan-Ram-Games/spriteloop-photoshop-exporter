"use strict";

const { entrypoints, storage } = require("uxp");
const photoshop = require("photoshop");
const { chooseExportFolder, exportActiveDocument } = require("./photoshopExport");

const DEFAULT_SETTINGS = {
  visibleOnly: true,
  exportGroupsAsImages: true
};

let state = {
  panel: null,
  exportFolder: null,
  settings: { ...DEFAULT_SETTINGS },
  settingsPromise: null,
  exporting: false,
  dialogOpen: false
};
const mountedRoots = new WeakSet();

entrypoints.setup({
  panels: {
    spriteloopPanel: {
      create(event) {
        mountPanel(panelNodeFromEvent(event));
      },
      show(event) {
        mountPanel(panelNodeFromEvent(event));
      }
    }
  },
  commands: {
    exportSpriteLoopPackage: {
      run: openExportWorkflow
    }
  }
});

addEventListener("error", (event) => {
  console.error("SpriteLoop Exporter error", event.error || event.message);
});

addEventListener("unhandledrejection", (event) => {
  console.error("SpriteLoop Exporter unhandled rejection", event.reason);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mountPanel(document.body));
} else {
  mountPanel(document.body);
}

function panelNodeFromEvent(event) {
  if (event && event.node) {
    return event.node;
  }
  if (event && event.target) {
    return event.target;
  }
  return event || document.body;
}

function mountPanel(root) {
  if (!root || mountedRoots.has(root)) {
    return;
  }

  mountedRoots.add(root);
  state.panel = root;
  renderPanel(root).catch((error) => {
    console.error("Could not render SpriteLoop panel", error);
    root.textContent = `SpriteLoop Exporter failed to render: ${error.message || error}`;
  });
}

async function renderPanel(root) {
  root.innerHTML = "";

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "src/panel.css";

  const wrapper = document.createElement("div");
  wrapper.className = "panel";
  wrapper.innerHTML = `
    <div class="brand brand-centered">
      <img class="brand-logo brand-logo-large" src="assets/spriteloop-logo.png" alt="" />
      <div class="brand-copy">
        <h1>SpriteLoop</h1>
        <p>Photoshop Exporter</p>
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="panel-actions">
      <sp-button id="export-button" variant="cta">Export Package</sp-button>
    </div>

    <div id="progress-wrap" class="panel-progress" hidden>
      <sp-progressbar id="progress" max="100" value="0" size="small" show-value="false"></sp-progressbar>
    </div>
    <div id="status" class="status is-idle" role="status"></div>
  `;

  root.appendChild(link);
  root.appendChild(wrapper);

  await ensureSettingsLoaded();
  syncPanel();
  root.querySelector("#export-button").addEventListener("click", openExportWorkflow);
}

async function openExportWorkflow() {
  if (state.exporting || state.dialogOpen) {
    return;
  }

  await ensureSettingsLoaded();

  if (!photoshop.app.activeDocument) {
    state.dialogOpen = true;
    syncPanel();
    try {
      await showResultDialog({
        title: "No document open",
        message: "Open a Photoshop document before exporting.",
        tone: "error"
      });
    } finally {
      state.dialogOpen = false;
      syncPanel();
    }
    return;
  }

  state.dialogOpen = true;
  syncPanel();
  let options;
  try {
    options = await showExportOptionsDialog();
  } finally {
    state.dialogOpen = false;
    syncPanel();
  }

  if (!options) {
    return;
  }

  state.exportFolder = options.exportFolder;
  state.settings = {
    exportGroupsAsImages: options.exportGroupsAsImages,
    visibleOnly: options.visibleOnly
  };
  await runExport();
}

async function runExport() {
  if (state.exporting) {
    return;
  }

  try {
    state.exporting = true;
    setStatus("Preparing export...");
    setProgress(0, 1);
    syncPanel();

    await saveSettings();
    const result = await exportActiveDocument(state.exportFolder, state.settings, (current, total, nodeName) => {
      const message = `Exporting ${nodeName} (${current}/${total})`;
      setStatus(message);
      setProgress(current, total);
    });

    setStatus(`Exported ${result.partCount} part(s).`);
    setProgress(1, 1);

    state.dialogOpen = true;
    await showResultDialog({
      title: "Export complete",
      message: `Exported ${result.partCount} part(s). The package is ready to import into SpriteLoop.`,
      detailLabel: "Data file",
      detail: result.metadataPath,
      tone: "success"
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error("SpriteLoop Export Failed", error);
    setStatus(message);

    state.dialogOpen = true;
    await showResultDialog({
      title: "Export failed",
      message,
      tone: "error"
    });
  } finally {
    state.dialogOpen = false;
    state.exporting = false;
    syncPanel();
  }
}

function ensureSettingsLoaded() {
  if (!state.settingsPromise) {
    state.settingsPromise = loadSettings().then((settings) => {
      state.settings = settings;
      return settings;
    });
  }
  return state.settingsPromise;
}

async function saveSettings() {
  const data = await storage.localFileSystem.getDataFolder();
  const file = await data.createFile("settings.json", { overwrite: true });
  await file.write(JSON.stringify({
    ...state.settings,
    exportFolderToken: state.exportFolder
      ? await storage.localFileSystem.createPersistentToken(state.exportFolder)
      : null
  }, null, 2));
}

async function loadSettings() {
  try {
    const data = await storage.localFileSystem.getDataFolder();
    const file = await data.getEntry("settings.json");
    const raw = await file.read();
    const parsed = JSON.parse(raw);

    if (parsed.exportFolderToken) {
      try {
        state.exportFolder = await storage.localFileSystem.getEntryForPersistentToken(parsed.exportFolderToken);
      } catch (_error) {
        state.exportFolder = null;
      }
    }

    return {
      exportGroupsAsImages: parsed.exportGroupsAsImages !== false,
      visibleOnly: parsed.visibleOnly !== false
    };
  } catch (_error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function syncPanel() {
  if (!state.panel) {
    return;
  }

  const exportButton = state.panel.querySelector("#export-button");
  if (!exportButton) {
    return;
  }

  exportButton.disabled = state.exporting || state.dialogOpen;
  exportButton.textContent = state.exporting ? "Exporting..." : "Export Package";
  setProgressVisible(state.exporting);
}

function setStatus(message) {
  if (!state.panel) {
    return;
  }

  const status = state.panel.querySelector("#status");
  if (status) {
    status.textContent = message || "";
    status.classList.toggle("is-idle", !message);
  }
}

function setProgress(current, total) {
  if (!state.panel) {
    return;
  }

  const progress = state.panel.querySelector("#progress");
  if (!progress) {
    return;
  }

  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCurrent = Math.max(0, Math.min(safeTotal, Number(current) || 0));
  progress.max = safeTotal;
  progress.value = safeCurrent;
}

function setProgressVisible(visible) {
  if (!state.panel) {
    return;
  }

  const wrapper = state.panel.querySelector("#progress-wrap");
  if (wrapper) {
    wrapper.hidden = !visible;
  }
}

async function showExportOptionsDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog dialog-options";
  dialog.innerHTML = `
    <div class="dialog-panel dialog-panel-wide">
      <header class="dialog-heading">
        <img class="dialog-brand-icon" src="assets/spriteloop-logo.png" alt="" />
        <div class="dialog-heading-copy">
          <h2>Export SpriteLoop Package</h2>
          <p class="dialog-subtitle">Choose where and what to export from the active document.</p>
        </div>
      </header>

      <div class="dialog-content">
        <section class="form-section">
          <sp-detail>DESTINATION</sp-detail>
          <div class="destination-row">
            <div id="dialog-export-folder" class="folder-display"></div>
            <sp-button id="dialog-choose-folder" variant="secondary">Browse…</sp-button>
          </div>
          <p id="folder-help" class="field-help">Choose the folder that will contain the data file and images folder.</p>
        </section>

        <div class="section-divider"></div>

        <section class="form-section">
          <sp-detail>EXPORT CONTENT</sp-detail>
          <div class="checkbox-stack">
            <div class="checkbox-row">
              <sp-checkbox id="dialog-export-groups">Export groups as images</sp-checkbox>
            </div>
            <div class="checkbox-row">
              <sp-checkbox id="dialog-visible-only">Export visible layers only</sp-checkbox>
            </div>
          </div>
        </section>
      </div>

      <footer class="dialog-footer">
        <sp-button id="dialog-cancel" variant="secondary">Cancel</sp-button>
        <sp-button id="dialog-export" class="dialog-action" variant="cta">Export</sp-button>
      </footer>
    </div>
  `;
  document.body.appendChild(dialog);

  let exportFolder = state.exportFolder;
  let choosingFolder = false;
  const folderDisplay = dialog.querySelector("#dialog-export-folder");
  const chooseFolderButton = dialog.querySelector("#dialog-choose-folder");
  const cancelButton = dialog.querySelector("#dialog-cancel");
  const exportButton = dialog.querySelector("#dialog-export");
  const exportGroups = dialog.querySelector("#dialog-export-groups");
  const visibleOnly = dialog.querySelector("#dialog-visible-only");

  exportGroups.checked = state.settings.exportGroupsAsImages !== false;
  visibleOnly.checked = state.settings.visibleOnly !== false;

  const syncFolder = () => {
    if (exportFolder) {
      const path = exportFolder.nativePath || exportFolder.name;
      folderDisplay.textContent = path;
      folderDisplay.title = path;
      folderDisplay.classList.add("has-folder");
    } else {
      folderDisplay.textContent = "No folder selected";
      folderDisplay.title = "";
      folderDisplay.classList.remove("has-folder");
    }
    exportButton.disabled = !exportFolder;
  };
  syncFolder();

  chooseFolderButton.addEventListener("click", async () => {
    if (choosingFolder) {
      return;
    }

    choosingFolder = true;
    chooseFolderButton.disabled = true;
    try {
      const selectedFolder = await chooseExportFolder();
      if (selectedFolder) {
        exportFolder = selectedFolder;
        syncFolder();
      }
    } finally {
      choosingFolder = false;
      chooseFolderButton.disabled = false;
    }
  });

  cancelButton.addEventListener("click", () => dialog.close("cancel"));
  exportButton.addEventListener("click", () => {
    if (exportFolder) {
      dialog.close("export");
    }
  });

  const returnValue = await waitForDialog(dialog);
  const result = returnValue === "export" && exportFolder
    ? {
        exportFolder,
        exportGroupsAsImages: exportGroups.checked,
        visibleOnly: visibleOnly.checked
      }
    : null;

  dialog.remove();
  return result;
}

async function showResultDialog({ title, message, detailLabel, detail, tone }) {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog dialog-${tone}`;
  dialog.innerHTML = `
    <div class="dialog-panel">
      <header class="dialog-heading">
        <div class="dialog-icon" aria-hidden="true">${tone === "success" ? "&#10003;" : "!"}</div>
        <div class="dialog-heading-copy">
          <h2>${escapeHtml(title)}</h2>
          <p class="dialog-subtitle">${tone === "success" ? "Package ready for SpriteLoop import" : "The package was not exported"}</p>
        </div>
      </header>
      <div class="dialog-content">
        <p class="dialog-message">${escapeHtml(message)}</p>
        ${detail ? `
          <section class="dialog-detail">
            <div class="detail-label">${escapeHtml(detailLabel || "Details")}</div>
            <div class="detail-value">${escapeHtml(detail)}</div>
          </section>
        ` : ""}
      </div>
      <footer class="dialog-footer">
        <sp-button id="dialog-close" class="dialog-action" variant="cta">${tone === "success" ? "Done" : "Close"}</sp-button>
      </footer>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector("#dialog-close").addEventListener("click", () => dialog.close("close"));
  await waitForDialog(dialog);
  dialog.remove();
}

function waitForDialog(dialog) {
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
