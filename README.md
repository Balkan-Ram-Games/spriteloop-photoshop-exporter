# SpriteLoop Photoshop Exporter

[![Photoshop exporter](https://img.shields.io/badge/Photoshop-Exporter-1473E6?style=for-the-badge&logo=adobephotoshop&logoColor=white)](https://www.adobe.com/products/photoshop.html)

Photoshop UXP extension for exporting layered artwork as a SpriteLoop import package.

The exporter creates:

- cropped PNG files for exported parts
- `spriteloop.import.json` metadata
- position and hierarchy data so SpriteLoop can reconstruct the artwork layout

## Install

1. Download the latest `spriteloop-photoshop-exporter.ccx` package.
2. Double-click the `.ccx` file.
3. Follow the Creative Cloud installation prompt.
4. Restart Photoshop if it is already open.
5. Open the exporter from:

   ```text
   Plugins -> SpriteLoop Exporter -> SpriteLoop
   ```

The exporter panel is named **SpriteLoop**.

## Usage

1. Open a Photoshop document.
2. Open the SpriteLoop panel.
3. Click **Export Package**.
4. In the export dialog, choose an export folder and export options:
   - **Export groups as images** exports each group as one part and does not export its children.
   - **Export visible layers only** skips hidden layers and hidden groups.
   - Clipping-mask layers are baked into their base layer or group instead of being exported as separate parts.
5. Click **Export**.

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

## Related SpriteLoop Projects

- [SpriteLoop App](https://github.com/Balkan-Ram-Games/spriteloop-app) - desktop animation editor
- [Krita Exporter](https://github.com/Balkan-Ram-Games/spriteloop-krita-exporter) - Krita Python exporter
- [Defold Extension](https://github.com/Balkan-Ram-Games/spriteloop-defold) - native `.spla` playback for Defold
