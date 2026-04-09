# SimpleMind Preview (Obsidian Plugin)

Render inline previews for SimpleMind `.smmx` embeds in Obsidian.

## Features

- Renders `![[your-map.smmx]]` embeds as inline SVG previews.
- Supports previews in reading mode and live preview/source mode.
- Opens a map in SimpleMind Pro from the preview header or by clicking a node.
- Includes zoom and drag interactions for larger maps.
- Adds commands to create and insert a new `.smmx` file from a template.

## Requirements

- Obsidian desktop (plugin is desktop-only).
- Obsidian app version `1.5.11` or later.
- SimpleMind Pro installed if you want one-click open from preview.

## Install

### Manual install (vault plugin folder)

1. Build the plugin:
   - `npm install`
   - `npm run build`
2. Copy `main.js`, `manifest.json`, and `styles.css` into:
   - `<your-vault>/.obsidian/plugins/simplemind-preview/`
3. In Obsidian, enable **SimpleMind Preview** in Community plugins.

### Local dev convenience install (`.env`)

1. Copy `.env.example` to `.env`.
2. Set `OBSIDIAN_VAULT_PATH` to your vault's absolute path.
3. Run:
   - `npm run build-and-install`

This script builds and copies release files into your local vault plugin directory.

## Usage

- Embed a map in any note:
  - `![[example.smmx]]`
- Use command palette commands:
  - `Create & insert new mindmap`
  - `Create & insert new mindmap (current note name)`

For map creation commands, the plugin reads a template file from the vault-relative setting `Template path` (default: `template-mindmap.smmx`).

## Settings

- **Enable previews**
- **Max preview height**
- **Default zoom**
- **Use SimpleMind palette**
- **Template path**

## Development

- `npm run dev`: watch build during development.
- `npm run build`: one-off production build.
- `npm run install-plugin`: copy release files to `OBSIDIAN_VAULT_PATH`.
- `npm run build-and-install`: build and then install into local vault.

## Release Artifacts

The plugin package consists of:

- `main.js`
- `manifest.json`
- `styles.css`

## License

MIT. See `LICENSE`.

## Author

Brett Winterflood
