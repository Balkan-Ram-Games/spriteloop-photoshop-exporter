"use strict";

const photoshop = require("photoshop");
const { localFileSystem, formats } = require("uxp").storage;
const {
  METADATA_FILE_NAME,
  SpriteLoopExportError,
  buildSpriteLoopPackage,
  collectExportNodes,
  normalizeBounds
} = require("./exporter");

const { app, core, action } = photoshop;
const batchPlay = action.batchPlay;
const BATCH_OPTIONS = {
  synchronousExecution: true,
  modalBehavior: "execute"
};

async function chooseExportFolder() {
  return localFileSystem.getFolder();
}

async function exportActiveDocument(exportFolder, options, progressCallback) {
  if (!exportFolder) {
    throw new SpriteLoopExportError("Choose an export folder.");
  }

  const document = app.activeDocument;
  if (!document) {
    throw new SpriteLoopExportError("Open a Photoshop document before exporting.");
  }

  const documentInfo = documentInfoFromDocument(document);
  const root = await photoshopRootFromDocument(document);
  const nodes = collectExportNodes(root, {
    visibleOnly: options.visibleOnly,
    exportGroupsAsImages: options.exportGroupsAsImages
  });

  if (!nodes.length) {
    throw new SpriteLoopExportError("No exportable layers were found.");
  }

  const spriteLoopPackage = buildSpriteLoopPackage(documentInfo, nodes, {
    exportGroupsAsImages: options.exportGroupsAsImages
  });

  const imagesFolder = await getOrCreateFolder(exportFolder, "images");

  await core.executeAsModal(async () => {
    const total = spriteLoopPackage.parts.length;
    for (let index = 0; index < spriteLoopPackage.parts.length; index += 1) {
      const part = spriteLoopPackage.parts[index];
      reportProgress(progressCallback, index + 1, total, part.node.name);
      await exportNodePng(document, documentInfo, part.node, imagesFolder, part.fileName);
      await pauseForPhotoshopEvents();
    }
  }, { commandName: "Export SpriteLoop Package" });

  const metadataFile = await createWritableFile(exportFolder, METADATA_FILE_NAME);
  await metadataFile.write(JSON.stringify(spriteLoopPackage.metadata, null, 2) + "\n", {
    format: formats.utf8
  });

  return {
    metadataFile,
    metadataPath: metadataFile.nativePath || metadataFile.name,
    partCount: spriteLoopPackage.parts.length
  };
}

function documentInfoFromDocument(document) {
  return {
    documentName: document.path || document.title || document.name || "Untitled",
    width: unitValue(document.width),
    height: unitValue(document.height)
  };
}

async function photoshopRootFromDocument(document) {
  const children = [];
  const layers = Array.isArray(document.layers) ? document.layers : [];
  for (const layer of layers) {
    children.push(await photoshopNodeFromLayer(layer));
  }
  return { children };
}

async function photoshopNodeFromLayer(layer) {
  const isGroup = isLayerGroup(layer);
  const children = [];

  if (isGroup && Array.isArray(layer.layers)) {
    for (const child of layer.layers) {
      children.push(await photoshopNodeFromLayer(child));
    }
  }

  return {
    source: layer,
    id: layer.id,
    name: layer.name || "",
    type: isGroup ? "group" : layer.kind || "layer",
    kind: isGroup ? "group" : layer.kind,
    visible: layer.visible !== false,
    opacity: typeof layer.opacity === "number" ? layer.opacity : 100,
    bounds: await boundsForLayer(layer),
    children
  };
}

function isLayerGroup(layer) {
  return Array.isArray(layer.layers) || layer.kind === "group" || layer.constructor?.name === "LayerGroup";
}

async function boundsForLayer(layer) {
  if (layer.bounds) {
    return layer.bounds;
  }

  if (!layer.id) {
    return null;
  }

  const result = await batchPlay([
    {
      _obj: "get",
      _target: [
        { _property: "bounds" },
        { _ref: "layer", _id: layer.id }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);

  return result && result[0] && result[0].bounds ? result[0].bounds : null;
}

async function exportNodePng(sourceDocument, documentInfo, node, imagesFolder, fileName) {
  const rect = normalizeBounds(node.bounds);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  await selectDocument(documentIdFromDocument(sourceDocument));
  const originalDocumentId = await activeDocumentId();
  const layerId = node.source.id;
  let tempDocumentId = null;

  try {
    await selectDocument(originalDocumentId);
    await selectLayer(layerId, node.name);
    tempDocumentId = await createDocumentFromSelectedLayer(node.name || "SpriteLoop Part");
    if (!tempDocumentId || tempDocumentId === originalDocumentId) {
      throw new Error("Photoshop did not create a separate temporary document.");
    }
    await selectDocument(tempDocumentId);
    tempDocumentId = await activeDocumentId();
    if (tempDocumentId === originalDocumentId) {
      throw new Error("Photoshop switched back to the source document during export.");
    }

    await trimTransparentPixels();
    const outputFile = await createWritableFile(imagesFolder, fileName);
    await saveActiveDocumentAsPng(outputFile);
  } catch (error) {
    throw new SpriteLoopExportError(`Could not export "${node.name}": ${error.message || error}`);
  } finally {
    if (tempDocumentId !== null && tempDocumentId !== originalDocumentId) {
      try {
        await selectDocument(originalDocumentId);
        await closeDocumentWithoutSaving(tempDocumentId);
      } catch (_error) {
        // Best-effort cleanup: preserve the original export error if closing fails.
      }
    }
    try {
      await selectDocument(originalDocumentId);
    } catch (_error) {
      // The source document may have been closed manually while exporting.
    }
  }
}

async function selectDocument(documentId) {
  if (documentId === undefined || documentId === null) {
    throw new Error("Missing Photoshop document id.");
  }

  await batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "document", _id: documentId }],
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);
}

async function selectLayer(layerId, layerName) {
  if (layerId === undefined || layerId === null) {
    throw new Error("Missing Photoshop layer id.");
  }

  const target = { _ref: "layer", _id: layerId };
  if (layerName) {
    target._name = layerName;
  }

  await batchPlay([
    {
      _obj: "select",
      _target: [target],
      name: layerName || undefined,
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);
}

async function createDocumentFromSelectedLayer(name) {
  await batchPlay([
    {
      _obj: "make",
      _target: [{ _ref: "document" }],
      using: {
        _ref: "layer",
        _enum: "ordinal",
        _value: "targetEnum"
      },
      name,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);

  return activeDocumentId();
}

async function trimTransparentPixels() {
  await batchPlay([
    {
      _obj: "trim",
      trimBasedOn: { _enum: "trimBasedOn", _value: "transparency" },
      top: true,
      bottom: true,
      left: true,
      right: true,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);
}

async function saveActiveDocumentAsPng(file) {
  const token = await localFileSystem.createSessionToken(file);
  await batchPlay([
    {
      _obj: "save",
      as: {
        _obj: "PNGFormat",
        method: { _enum: "PNGMethod", _value: "quick" },
        PNGInterlaceType: { _enum: "PNGInterlaceType", _value: "PNGInterlaceNone" },
        PNGFilter: { _enum: "PNGFilter", _value: "PNGFilterAdaptive" },
        compression: 6
      },
      in: { _path: token, _kind: "local" },
      copy: true,
      lowerCase: true,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);
}

async function closeDocumentWithoutSaving(documentId) {
  await batchPlay([
    {
      _obj: "close",
      _target: [{ _ref: "document", _id: documentId }],
      saving: { _enum: "yesNo", _value: "no" },
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);
}

async function getOrCreateFolder(parent, name) {
  try {
    return await parent.getEntry(name);
  } catch (_error) {
    return parent.createFolder(name);
  }
}

async function createWritableFile(folder, name) {
  try {
    const existing = await folder.getEntry(name);
    if (existing && existing.isFile) {
      return existing;
    }
  } catch (_error) {
    // Create below.
  }

  return folder.createFile(name, { overwrite: true });
}

function reportProgress(callback, current, total, nodeName) {
  if (typeof callback === "function") {
    callback(current, total, nodeName);
  }
}

function unitValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value.value === "number") {
    return value.value;
  }
  return Number.parseFloat(String(value || "0"));
}

function pauseForPhotoshopEvents() {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

function documentIdFromDocument(document) {
  return document.id ?? document._id ?? document.documentID;
}

async function activeDocumentId() {
  const result = await batchPlay([
    {
      _obj: "get",
      _target: [
        { _property: "documentID" },
        { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }
  ], BATCH_OPTIONS);

  const descriptor = result && result[0] ? result[0] : {};
  const id = descriptor.documentID ?? descriptor.documentId ?? descriptor.id;
  if (id === undefined || id === null) {
    throw new Error("Could not read active Photoshop document id.");
  }
  return id;
}

module.exports = {
  chooseExportFolder,
  exportActiveDocument
};
