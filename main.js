"use strict";

const { entrypoints } = require("uxp");
const { storage } = require("uxp");
const photoshop = require("photoshop");
const { SpriteLoopExportError } = require("./exporter");
const { chooseExportFolder, exportActiveDocument } = require("./photoshopExport");

const DEFAULT_SETTINGS = {
  visibleOnly: true,
  exportGroupsAsImages: true
};

let state = {
  panel: null,
  exportFolder: null,
  settings: { ...DEFAULT_SETTINGS },
  exporting: false
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
      run: async () => {
        await runExport();
      }
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
    <div class="brand">
      <img class="brand-logo" src="assets/spriteloop-logo.png" alt="" />
      <div>
        <h1>SpriteLoop</h1>
        <p>Photoshop Exporter</p>
      </div>
    </div>

    <section class="control-group">
      <div class="group-title">Destination</div>
      <div class="destination-row">
        <div id="export-folder" class="folder-display">No folder selected</div>
        <button id="choose-folder" class="secondary" type="button">Browse</button>
      </div>
    </section>

    <section class="control-group">
      <div class="group-title">Export Content</div>
      <label class="option-row">
        <input id="export-groups" type="checkbox" />
        <span>Export groups as images</span>
      </label>
      <label class="option-row">
        <input id="visible-only" type="checkbox" />
        <span>Export visible layers only</span>
      </label>
    </section>

    <button id="export-button" class="primary" type="button">Export Package</button>
    <div id="progress-wrap" class="progress-wrap" hidden>
      <progress id="progress" class="progress" max="1" value="0"></progress>
    </div>
    <div id="status" class="status is-idle" role="status"></div>
  `;

  root.appendChild(link);
  root.appendChild(wrapper);

  state.settings = await loadSettings();
  syncPanel();

  root.querySelector("#choose-folder").addEventListener("click", async () => {
    const folder = await chooseExportFolder();
    if (folder) {
      state.exportFolder = folder;
      await saveSettingsFromPanel();
      syncPanel();
    }
  });

  root.querySelector("#export-groups").addEventListener("change", saveSettingsFromPanel);
  root.querySelector("#visible-only").addEventListener("change", saveSettingsFromPanel);
  root.querySelector("#export-button").addEventListener("click", runExport);
}

async function runExport() {
  if (state.exporting) {
    return;
  }

  try {
    state.exporting = true;
    syncPanel();

    if (!state.exportFolder) {
      setStatus("Choose an export folder.");
      state.exportFolder = await chooseExportFolder();
      if (!state.exportFolder) {
        throw new SpriteLoopExportError("Choose an export folder.");
      }
    }

    await saveSettingsFromPanel();
    setStatus("Preparing export...");
    setProgress(0, 1);

    const result = await exportActiveDocument(state.exportFolder, state.settings, (current, total, nodeName) => {
      setStatus(`Exporting ${nodeName} (${current}/${total})`);
      setProgress(current, total);
    });

    setStatus(`Exported ${result.partCount} part(s).`);
    setProgress(1, 1);
    await showDialog("SpriteLoop Export Complete", `Exported ${result.partCount} part(s).\n\n${result.metadataPath}`, "success");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error("SpriteLoop Export Failed", error);
    setStatus(message);
    await showDialog("SpriteLoop Export Failed", message, "error");
  } finally {
    state.exporting = false;
    syncPanel();
  }
}

async function saveSettingsFromPanel() {
  if (state.panel) {
    state.settings = {
      exportGroupsAsImages: state.panel.querySelector("#export-groups").checked,
      visibleOnly: state.panel.querySelector("#visible-only").checked
    };
  }

  const data = await storage.localFileSystem.getDataFolder();
  const file = await data.createFile("settings.json", { overwrite: true });
  await file.write(JSON.stringify({
    ...state.settings,
    exportFolderToken: state.exportFolder ? await storage.localFileSystem.createPersistentToken(state.exportFolder) : null
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

  const folderDisplay = state.panel.querySelector("#export-folder");
  const exportGroups = state.panel.querySelector("#export-groups");
  const visibleOnly = state.panel.querySelector("#visible-only");
  const exportButton = state.panel.querySelector("#export-button");

  if (state.exportFolder) {
    const path = state.exportFolder.nativePath || state.exportFolder.name;
    folderDisplay.textContent = path;
    folderDisplay.title = path;
    folderDisplay.classList.add("has-folder");
  } else {
    folderDisplay.textContent = "No folder selected";
    folderDisplay.title = "";
    folderDisplay.classList.remove("has-folder");
  }
  exportGroups.checked = state.settings.exportGroupsAsImages !== false;
  visibleOnly.checked = state.settings.visibleOnly !== false;
  exportButton.disabled = state.exporting;
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
  progress.max = safeTotal;
  progress.value = Math.max(0, Math.min(safeTotal, Number(current) || 0));
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

async function showDialog(title, message, tone) {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog dialog-${tone}`;
  dialog.innerHTML = `
    <form method="dialog" class="dialog-panel">
      <div class="dialog-heading">
        <div class="dialog-icon" aria-hidden="true">${tone === "success" ? "✓" : "!"}</div>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <div class="dialog-subtitle">${tone === "success" ? "Package ready for SpriteLoop import" : "Export did not complete"}</div>
        </div>
      </div>
      <pre class="dialog-message">${escapeHtml(message)}</pre>
      <footer>
        <button class="dialog-button" autofocus type="submit">Close</button>
      </footer>
    </form>
  `;
  document.body.appendChild(dialog);

  await new Promise((resolve) => {
    dialog.addEventListener("close", resolve, { once: true });
    dialog.showModal();
  });

  dialog.remove();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
