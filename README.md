# SpriteLoop Photoshop Exporter

Photoshop UXP extension for exporting layered artwork as a SpriteLoop import package.

The exporter creates:

- cropped PNG files for exported parts
- `spriteloop.import.json` metadata
- position and hierarchy data so SpriteLoop can reconstruct the artwork layout

## Status

Initial full-parity implementation for local UXP development. The metadata format matches the Krita exporter package contract.

## Install for Development

1. Install Adobe UXP Developer Tool.
2. Open UXP Developer Tool.
3. Choose **Add Plugin**.
4. Select this folder:

   ```text
   D:\GitHub\Other\spriteloop-photoshop-exporter
   ```

5. Load the plugin into Photoshop.
6. Open the **SpriteLoop** panel in Photoshop.

## Usage

1. Open a Photoshop document.
2. Open the SpriteLoop panel.
3. Choose an export folder.
4. Choose export options:
   - **Export groups as images** exports each group as one part and does not export its children.
   - **Export visible layers only** skips hidden layers and hidden groups.
5. Click **Export Package**.

The exported package has this layout:

```text
my-character/
  spriteloop.import.json
  images/
    head.png
    torso.png
    arm_left.png
```

## Package Contract

The metadata file is named `spriteloop.import.json` and uses:

- `format: "spriteloop.import"`
- `version: 1`
- `source.application: "Photoshop"`
- `source.plugin: "spriteloop-photoshop-exporter"`
- `canvas.width` and `canvas.height`
- `parts[]` entries with `id`, `name`, `image`, `x`, `y`, `width`, `height`, `opacity`, `visible`, and optional `parentId`
- optional `hierarchy[]` entries for groups

## Tests

Run the pure exporter tests with:

```text
npm test
```

These tests cover slugging, duplicate names, traversal options, hierarchy metadata, and zero-size layer skipping. Photoshop PNG export still needs manual QA inside Photoshop because it depends on UXP host APIs.

## Manual QA Checklist

- Export a PSD with visible and invisible layers.
- Export a PSD with nested groups using both group-export modes.
- Export text, shape/vector, smart object, and pixel layers.
- Import the package into SpriteLoop and confirm part placement.
- Confirm PNGs preserve transparency and are cropped to visible content.
- Confirm duplicate layer names produce unique IDs and filenames.

