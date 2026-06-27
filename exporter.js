"use strict";

const METADATA_FILE_NAME = "spriteloop.import.json";
const FORMAT_NAME = "spriteloop.import";
const FORMAT_VERSION = 1;
const PLUGIN_NAME = "spriteloop-photoshop-exporter";

class SpriteLoopExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpriteLoopExportError";
  }
}

function collectExportNodes(root, options = {}) {
  const normalizedOptions = {
    visibleOnly: options.visibleOnly !== false,
    exportGroupsAsImages: options.exportGroupsAsImages !== false
  };
  const counters = Object.create(null);
  const nodes = [];

  function walk(container, parentId) {
    const children = Array.isArray(container.children) ? container.children : [];
    let clippingLayers = [];

    for (const child of children) {
      if (child.isClippingMask === true) {
        if (!normalizedOptions.visibleOnly || nodeVisible(child)) {
          clippingLayers.push(child);
        }
        continue;
      }

      const attachedClippingLayers = clippingLayers;
      clippingLayers = [];

      if (normalizedOptions.visibleOnly && !nodeVisible(child)) {
        continue;
      }

      const childType = child.type || "layer";
      const childName = typeof child.name === "string" ? child.name : "";
      const childId = uniqueId(slugify(childName), counters);

      if (isGroupNode(child)) {
        const group = {
          source: child.source || child,
          id: childId,
          name: childName,
          type: "group",
          parentId,
          bounds: child.bounds,
          opacity: nodeOpacity(child),
          visible: nodeVisible(child),
          clippingLayers: attachedClippingLayers,
          children: child.children || []
        };
        nodes.push(group);

        if (!normalizedOptions.exportGroupsAsImages) {
          walk(child, childId);
        }
      } else if (isSupportedLayerType(childType)) {
        nodes.push({
          source: child.source || child,
          id: childId,
          name: childName,
          type: childType,
          parentId,
          bounds: child.bounds,
          opacity: nodeOpacity(child),
          visible: nodeVisible(child),
          clippingLayers: attachedClippingLayers,
          children: []
        });
      }
    }
  }

  walk(root, null);
  return nodes;
}

function buildSpriteLoopPackage(documentInfo, nodes, options = {}) {
  const normalizedOptions = {
    exportGroupsAsImages: options.exportGroupsAsImages !== false
  };
  const usedFileNames = Object.create(null);
  const nodeIds = new Map(nodes.map((node) => [node.source, node.id]));
  const parts = [];
  const hierarchy = [];

  for (const item of nodes) {
    if (item.type === "group") {
      hierarchy.push(groupMetadata(item, nodeIds));
      if (!normalizedOptions.exportGroupsAsImages) {
        continue;
      }
    }

    const rect = normalizeBounds(item.bounds);
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const fileName = uniqueFileName(slugify(item.name), usedFileNames);
    const part = {
      id: item.id,
      name: item.name,
      image: `images/${fileName}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: nodeOpacity(item),
      visible: nodeVisible(item)
    };

    if (item.parentId) {
      part.parentId = item.parentId;
    }

    parts.push({
      node: item,
      fileName,
      metadata: part
    });
  }

  if (!parts.length) {
    throw new SpriteLoopExportError("No non-empty layers were exported.");
  }

  const metadata = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    source: {
      application: "Photoshop",
      plugin: PLUGIN_NAME,
      documentName: documentInfo.documentName || "Untitled"
    },
    canvas: {
      width: Math.trunc(documentInfo.width),
      height: Math.trunc(documentInfo.height)
    },
    parts: parts.map((part) => part.metadata)
  };

  if (hierarchy.length) {
    metadata.hierarchy = hierarchy;
  }

  return {
    metadata,
    parts
  };
}

function groupMetadata(item, nodeIds) {
  const children = [];

  for (const child of item.children || []) {
    const source = child.source || child;
    const childId = nodeIds.get(source);
    if (childId) {
      children.push(childId);
    }
  }

  return {
    id: item.id,
    name: item.name,
    type: "group",
    children
  };
}

function isGroupNode(node) {
  return node.type === "group" || node.type === "layerSection" || node.kind === "group";
}

function isSupportedLayerType(type) {
  return !type || type === "layer" || type === "pixel" || type === "text" || type === "shape" ||
    type === "smartObject" || type === "adjustment" || type === "solidColorLayer" ||
    type === "paintlayer" || type === "vectorlayer" || type === "filelayer";
}

function normalizeBounds(bounds) {
  if (!bounds) {
    return null;
  }

  const left = unitValue(bounds.left ?? bounds.x ?? bounds._left);
  const top = unitValue(bounds.top ?? bounds.y ?? bounds._top);
  const right = unitValue(bounds.right ?? bounds._right);
  const bottom = unitValue(bounds.bottom ?? bounds._bottom);
  const width = unitValue(bounds.width ?? (Number.isFinite(right) && Number.isFinite(left) ? right - left : undefined));
  const height = unitValue(bounds.height ?? (Number.isFinite(bottom) && Number.isFinite(top) ? bottom - top : undefined));

  if (![left, top, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.trunc(left),
    y: Math.trunc(top),
    width: Math.max(0, Math.trunc(width)),
    height: Math.max(0, Math.trunc(height))
  };
}

function unitValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value.value === "number") {
    return value.value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function nodeVisible(node) {
  return node.visible !== false;
}

function nodeOpacity(node) {
  const value = typeof node.opacity === "number" ? node.opacity : 1;
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function uniqueId(base, counters) {
  const safeBase = base || "part";
  const index = (counters[safeBase] || 0) + 1;
  counters[safeBase] = index;
  return index === 1 ? safeBase : `${safeBase}_${index}`;
}

function uniqueFileName(base, counters) {
  return `${uniqueId(base, counters)}.png`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "part";
}

module.exports = {
  FORMAT_NAME,
  FORMAT_VERSION,
  METADATA_FILE_NAME,
  PLUGIN_NAME,
  SpriteLoopExportError,
  buildSpriteLoopPackage,
  collectExportNodes,
  normalizeBounds,
  slugify,
  uniqueFileName,
  uniqueId
};
