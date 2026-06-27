"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FORMAT_NAME,
  FORMAT_VERSION,
  buildSpriteLoopPackage,
  collectExportNodes,
  normalizeBounds,
  slugify,
  uniqueFileName
} = require("../exporter");

test("slugifies names like the Krita exporter", () => {
  assert.equal(slugify(" Arm Left! "), "arm_left");
  assert.equal(slugify(""), "part");
  assert.equal(slugify("___"), "part");
});

test("generates duplicate filenames with suffixes", () => {
  const counters = {};
  assert.equal(uniqueFileName("head", counters), "head.png");
  assert.equal(uniqueFileName("head", counters), "head_2.png");
  assert.equal(uniqueFileName("head", counters), "head_3.png");
});

test("normalizes bounds from Photoshop style left/top/right/bottom", () => {
  assert.deepEqual(normalizeBounds({
    left: { value: 10.8 },
    top: { value: 20.2 },
    right: { value: 42.9 },
    bottom: { value: 55.1 }
  }), {
    x: 10,
    y: 20,
    width: 32,
    height: 34
  });
});

test("exports groups as images and does not recurse into their children", () => {
  const root = fixtureTree();
  const nodes = collectExportNodes(root, {
    visibleOnly: true,
    exportGroupsAsImages: true
  });

  assert.deepEqual(nodes.map((node) => node.id), ["body"]);

  const result = buildSpriteLoopPackage(documentInfo(), nodes, {
    exportGroupsAsImages: true
  });

  assert.equal(result.metadata.format, FORMAT_NAME);
  assert.equal(result.metadata.version, FORMAT_VERSION);
  assert.equal(result.metadata.parts.length, 1);
  assert.equal(result.metadata.parts[0].id, "body");
  assert.equal(result.metadata.parts[0].image, "images/body.png");
  assert.deepEqual(result.metadata.hierarchy, [
    {
      id: "body",
      name: "Body",
      type: "group",
      children: []
    }
  ]);
});

test("recurses into groups when group image export is disabled", () => {
  const nodes = collectExportNodes(fixtureTree(), {
    visibleOnly: true,
    exportGroupsAsImages: false
  });

  assert.deepEqual(nodes.map((node) => node.id), ["body", "head", "torso"]);

  const result = buildSpriteLoopPackage(documentInfo(), nodes, {
    exportGroupsAsImages: false
  });

  assert.deepEqual(result.metadata.parts.map((part) => part.id), ["head", "torso"]);
  assert.equal(result.metadata.parts[0].parentId, "body");
  assert.deepEqual(result.metadata.hierarchy, [
    {
      id: "body",
      name: "Body",
      type: "group",
      children: ["head", "torso"]
    }
  ]);
});

test("skips invisible nodes when visibleOnly is enabled", () => {
  const nodes = collectExportNodes(fixtureTree(), {
    visibleOnly: true,
    exportGroupsAsImages: false
  });
  assert.equal(nodes.some((node) => node.id === "hidden_arm"), false);
});

test("includes invisible nodes when visibleOnly is disabled", () => {
  const nodes = collectExportNodes(fixtureTree(), {
    visibleOnly: false,
    exportGroupsAsImages: false
  });
  assert.equal(nodes.some((node) => node.id === "hidden_arm"), true);
});

test("attaches clipping masks to their base instead of exporting them as parts", () => {
  const clippedHighlight = layer("Highlight", 10, 10, 30, 30);
  clippedHighlight.isClippingMask = true;
  const base = layer("Body", 0, 0, 100, 100);
  const nodes = collectExportNodes({
    children: [clippedHighlight, base]
  }, {
    visibleOnly: true,
    exportGroupsAsImages: false
  });

  assert.deepEqual(nodes.map((node) => node.id), ["body"]);
  assert.deepEqual(nodes[0].clippingLayers.map((node) => node.name), ["Highlight"]);

  const result = buildSpriteLoopPackage(documentInfo(), nodes, {
    exportGroupsAsImages: false
  });
  assert.deepEqual(result.metadata.parts.map((part) => part.id), ["body"]);
});

test("does not attach clipping masks from a hidden base to the next layer", () => {
  const clippedHighlight = layer("Highlight", 10, 10, 30, 30);
  clippedHighlight.isClippingMask = true;
  const hiddenBase = layer("Hidden Body", 0, 0, 100, 100, false);
  const nextBase = layer("Background", 0, 0, 200, 200);
  const nodes = collectExportNodes({
    children: [clippedHighlight, hiddenBase, nextBase]
  }, {
    visibleOnly: true,
    exportGroupsAsImages: false
  });

  assert.deepEqual(nodes.map((node) => node.id), ["background"]);
  assert.deepEqual(nodes[0].clippingLayers, []);
});

test("skips zero-size nodes while building metadata", () => {
  const root = {
    children: [
      layer("Empty", 0, 0, 0, 0),
      layer("Head", 10, 20, 40, 50)
    ]
  };
  const nodes = collectExportNodes(root, {
    visibleOnly: true,
    exportGroupsAsImages: false
  });
  const result = buildSpriteLoopPackage(documentInfo(), nodes, {
    exportGroupsAsImages: false
  });

  assert.deepEqual(result.metadata.parts.map((part) => part.id), ["head"]);
});

function fixtureTree() {
  return {
    children: [
      {
        name: "Body",
        type: "group",
        visible: true,
        opacity: 100,
        bounds: bounds(100, 100, 400, 500),
        children: [
          layer("Head", 160, 120, 90, 80),
          layer("Torso", 140, 240, 120, 180),
          layer("Hidden Arm", 90, 230, 80, 170, false)
        ]
      }
    ]
  };
}

function documentInfo() {
  return {
    documentName: "character.psd",
    width: 1024,
    height: 768
  };
}

function layer(name, x, y, width, height, visible = true) {
  return {
    name,
    type: "layer",
    visible,
    opacity: 75,
    bounds: bounds(x, y, width, height),
    children: []
  };
}

function bounds(x, y, width, height) {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height
  };
}
