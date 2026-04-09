# SMMX Format Knowledge (for LLM Workflows)

This file captures practical knowledge about SimpleMind `.smmx` files for automation, parsing, and generation in Obsidian plugins and LLM-assisted tools.

## Reference Example

A complete unzipped example mindmap is available at:

```
assets/finance-mindmap-dump/document/mindmap.xml
```

This is a real SimpleMind export with multiple hierarchy levels, palette colors, and layout data. Use it as ground truth when implementing parsing or rendering logic.

## What `.smmx` Is

- `.smmx` is a ZIP archive, not a plain XML file.
- Core content lives at `document/mindmap.xml`.
- Some maps also include:
  - `document/slides.xml`
  - `images/<hash>.png` (embedded image assets)

Minimal inspection command:

```bash
unzip -l my-map.smmx
unzip -p my-map.smmx document/mindmap.xml
```

## Root XML Shape

`document/mindmap.xml` has this high-level structure:

```xml
<simplemind-mindmaps doc-version="3" ...>
  <mindmap>
    <meta>...</meta>
    <topics>...</topics>
    <relations>...</relations>
    <node-groups>...</node-groups>
  </mindmap>
</simplemind-mindmaps>
```

## Key Elements and Attributes

### `meta`

- `<title text="...">` is map title metadata.
- `<main-centraltheme id="0">` points to the central topic id.
- `<scrollstate zoom="..." x="..." y="...">` stores last viewport position in SimpleMind.

### `topics` / `topic`

Each node is a `<topic>` with common attributes:

- `id`: topic id (string/int-like)
- `parent`: parent id (`-1` means root/central node)
- `x`, `y`: absolute coordinates in SimpleMind canvas space
- `text`: displayed node text
- `textfmt`: usually `plain` or rich format marker
- `palette`: numeric index (1-8) into the active color palette
- `colorinfo`: often mirrors `palette` value

Layout is hierarchical by `parent` relationships, but positions are absolute.

### Topic Child Elements

Topics can have optional child elements:

#### `<layout>`

Defines layout behavior for the topic's children:

```xml
<topic id="0" parent="-1" text="Finance">
    <layout mode="strict-horizontal" direction="auto" flow="default"></layout>
</topic>
```

Attributes:
- `mode`: Layout algorithm (`strict-horizontal`, `list`, etc.)
- `direction`: Child placement direction (`auto`, etc.)
- `flow`: Flow behavior (`default`, `auto`, etc.)

#### `<style>`

Per-topic style overrides:

```xml
<topic id="25" text="Security Analysis">
    <style>
        <font scale="1.14"></font>
    </style>
</topic>
```

The `<font>` child can have:
- `scale`: Font size multiplier (e.g., `1.14` = 114% size)

**Important**: The presence of `<style><font>` overrides SimpleMind's default level-based bold styling.

## Color and Palette System

### Style Sheet Reference

The `<meta>` section contains a `<style key="...">` element that defines which palette is active:

```xml
<meta>
  <style key="system.bright-palette"></style>
  ...
</meta>
```

Common built-in style keys:
- `system.bright-palette` - Vibrant, saturated colors (most common default)
- Other system palettes exist but are less frequently encountered

### Style File Format (`.smmstyle`)

SimpleMind style sheets are XML files with structure:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mindmap-colorscheme>

<mindmap-colorscheme>
    <general description="name" timestamp="...">
        <bkgnd-color r="255" g="255" b="255"></bkgnd-color>
        <font-color r="24" g="24" b="24"></font-color>
    </general>
    <style has-levels="true">
        <mindmap connection-style="centered" natural-paths="false"></mindmap>
        <topics borderwidth="0.25"></topics>
        <relations>...</relations>
        <texts align="auto" callout="none"></texts>
    </style>
    <palette>
        <item>
            <fill-color r="..." g="..." b="..."></fill-color>
            <stroke-color r="..." g="..." b="..."></stroke-color>
        </item>
        <!-- 8 items total, 0-indexed in file but 1-indexed in topic palette attribute -->
    </palette>
</mindmap-colorscheme>
```

Each palette `<item>` has:
- `fill-color`: Background fill (RGB values)
- `stroke-color`: Border/line color (RGB values)

Style files are stored at:
- macOS: `~/Library/Containers/com.modelmakertools.simplemindmacpro/Data/Library/com.modelmakertools.simplemindmacpro/Mind Maps/*.smmstyle`

A reference style file is available at:

```
assets/default_colors.smmstyle
```

### Palette Index Colors

Topics reference colors via `palette="N"` where N is 1-8. The actual hex values depend on the active style sheet.

Default palette colors (from `default_colors.smmstyle`):

| Index | Color | Stroke Hex | Fill RGB |
|-------|-------|------------|----------|
| 1 | Blue | `#0033FF` | rgb(193, 204, 255) |
| 2 | Red | `#FF0000` | rgb(255, 192, 180) |
| 3 | Orange | `#FF9900` | rgb(255, 213, 149) |
| 4 | Yellow | `#FBC02D` | rgb(255, 246, 169) |
| 5 | Green | `#33FF00` | rgb(172, 255, 151) |
| 6 | Cyan | `#00CCFF` | rgb(185, 241, 255) |
| 7 | Purple | `#9900FF` | rgb(227, 185, 255) |
| 8 | Pink | `#FF80C0` | rgb(255, 193, 224) |

Note: Palette items are 0-indexed in the `.smmstyle` file but 1-indexed when referenced by `palette="N"` in topic elements.

### Explicit Topic Colors

Some topics may have explicit color attributes instead of or in addition to palette references:

- Direct attributes: `color`, `fill`, `background`, `bgcolor`
- Nested style elements: `<style><color hex="..."></style>`

Priority for color resolution:
1. Explicit hex color on topic (if present)
2. Palette index lookup using active style sheet
3. Fallback default color

### Branch-Based vs Level-Based Coloring

SimpleMind supports two coloring modes (defined in style sheet via `has-levels` attribute):
- **Branch-based**: All descendants of a topic inherit the same color as their branch root
- **Level-based**: Colors are assigned by depth level in the tree

In practice, most maps use branch-based coloring where `palette` values propagate down branches.

### `relations`

- Contains non-tree links between topics (cross-connections).
- Relation elements usually reference source/target topic ids (plugin parser maps these to connector lines).

### Embedded Images

- Topic image references include hashes and `thumbnail` references.
- Actual binaries are often in `images/`.
- For lightweight preview rendering, image handling can be optional at first.

## Text Encoding Notes

SimpleMind text can contain escaped markers:

- `\\N` represents line breaks
- `\\*` marks bold text boundaries (start/end)
- HTML entities may appear in attributes (`&gt;`, etc.)

### Bold Text Format

Bold text can come from two sources:

#### 1. Explicit `\\*` markers (inline bold)

When `textfmt="rtf1"` is set on a topic, the text may contain bold markers:

```xml
<topic text="Normal \\*Bold text\\* more normal" textfmt="rtf1">
```

The `\\*` markers work as toggles:
- First `\\*` starts bold
- Second `\\*` ends bold
- Can span across `\\N` line breaks

Example parsing:
- Input: `"🌍\\* Central banks\\*"`
- Result: "🌍" (normal) + " Central banks" (bold)

#### 2. Default level-based bold (implicit)

SimpleMind applies bold styling by default to:
- **Level 0**: Root/central topic (parent="-1")
- **Level 1**: Direct children of root

This is NOT stored in the XML - it's SimpleMind's default rendering behavior.

#### Style Override (removes default bold)

A topic with a `<style><font>` child element overrides the default bold:

```xml
<topic id="25" parent="0" text="Security Analysis" textfmt="plain">
    <style>
        <font scale="1.14"></font>
    </style>
</topic>
```

Even though this is a level-1 topic (parent="0"), the presence of `<style><font>` removes the default bold. The `scale` attribute adjusts font size but the mere presence of the element signals a style override.

#### Bold Resolution Priority

1. If topic has explicit `\\*` markers → use those for bold segments
2. Else if topic has `<style><font>` child → NOT bold (override)
3. Else if topic level is 0 or 1 → bold (default behavior)
4. Else → not bold

Safe normalization strategy for previews:

- Convert `\\N` to newline
- Parse `\\*` markers to identify bold segments
- Calculate topic level from parent hierarchy
- Check for `<style><font>` override
- Apply default bold to level 0-1 unless overridden
- Render bold segments with appropriate styling (e.g., `font-weight: bold`)

## Quick Lookup for Root Topic

Root node is typically:

- `topic[parent="-1"]`

Fallback:

- first topic in document if parent markers are missing

## Known Practical Behavior

- macOS `qlmanage` does not reliably generate previews for `.smmx` in this environment.
- Direct XML parsing and custom SVG rendering is robust and cross-platform within Obsidian plugin runtime.

### macOS App Data / Settings Paths (Observed)

For the installed app `SimpleMind Pro.app`, bundle identifier resolves to:

- `com.modelmakertools.simplemindmacpro`

On this machine, SimpleMind data/settings-related folders were found at:

- `~/Library/Containers/com.modelmakertools.simplemindmacpro`
- `~/Library/Containers/com.modelmakertools.simplemindmacpro/Data/Library/com.modelmakertools.simplemindmacpro`
- `~/Library/Application Scripts/com.modelmakertools.simplemindmacpro`

Expected generic paths that did **not** exist here:

- `~/Library/Application Support/SimpleMind`
- `~/Library/Containers/com.modelmakertools.simplemind`
- `~/Library/Preferences/com.modelmakertools.simplemindmacpro.plist`

## Safe Programmatic Creation Strategy

Recommended approach for creating new maps:

1. Keep a known-good template `.smmx`.
2. Load ZIP.
3. Edit `document/mindmap.xml` placeholders.
4. Re-zip and save.

In this project, template placeholder used is `-----` and replaced in:

- `<title text="-----">`
- central `<topic ... text="-----" ...>`

## Filename and XML Safety Rules

### Filename

When creating a new `.smmx` filename from user text:

- Remove invalid filesystem chars: `/ \\ ? % * : | " < >`
- Trim trailing dots
- Normalize whitespace

### XML Attribute

When writing to `text="..."` or `title text="..."`, escape:

- `& -> &amp;`
- `" -> &quot;`
- `< -> &lt;`
- `> -> &gt;`

## Rendering Guidance for LLMs

For 2D preview rendering in HTML/SVG:

- Use absolute node positions (`x`, `y`) from XML.
- Compute node box width from text length heuristics.
- Draw parent-child bezier connectors first.
- Draw relation connectors next (often dashed).
- Draw node boxes last to keep lines visually behind nodes.
- Keep node boxes opaque for readability.

## Bounds and Navigation Guidance

For pan/zoom UX:

- Compute bounds from furthest node box extents, not center points only.
- Include small fixed padding.
- Store map width/height metadata for clamping pan at current scale.
- Clamp scroll position on drag, zoom, and resize.
- Center initial viewport on root topic for predictable focus.

## LLM Checklist for `.smmx` Tasks

- Verify input is ZIP and contains `document/mindmap.xml`.
- Parse with XML parser, not regex-only parsing.
- Preserve unknown XML sections when possible.
- Escape all user-provided text before writing XML attributes.
- Re-zip with same relative paths.
- Handle missing files with actionable errors.

## Example TypeScript Parse Skeleton

```ts
const zip = await JSZip.loadAsync(binary);
const xmlFile = zip.file("document/mindmap.xml");
if (!xmlFile) throw new Error("missing mindmap.xml");
const xml = await xmlFile.async("text");
const doc = new DOMParser().parseFromString(xml, "application/xml");
const topics = Array.from(doc.querySelectorAll("topic")).map((el) => ({
  id: el.getAttribute("id") ?? "",
  parentId: el.getAttribute("parent") ?? "-1",
  x: Number.parseFloat(el.getAttribute("x") ?? "0"),
  y: Number.parseFloat(el.getAttribute("y") ?? "0"),
  text: el.getAttribute("text") ?? ""
}));
```

## Markdown export (plugin)

The Obsidian plugin can copy a **markdown export** of a mindmap to the clipboard—nested headings derived from the topic tree (e.g. for use with LLMs, documentation, or other tools). Header button: **Copy as markdown**. Implementation: [`src/mindmap-markdown-export.ts`](src/mindmap-markdown-export.ts).

Behavior:

- Builds the tree from each topic’s `parent` id (root: `parent="-1"`).
- Emits `# Title` using the note file’s basename (not necessarily `<title>` in XML), then **nested markdown headings** for the tree: root topics are `##`, their children `###`, and so on up to `######` (deeper levels clamp to H6). Topic labels are single-line (internal newlines collapsed to spaces).
- **Sibling order** is deterministic: sort by `y`, then `x`, then `id` (numeric when ids are plain integers), so exports are stable even if XML sibling order varies.
- If `relations` is non-empty, appends a `## Cross-links` section with bullet lines `Source → Target` (by topic text).
- If there is no root (`parent="-1"`) but topics exist, falls back to a flat list of topics as consecutive `##` headings (sorted the same way).

## Caveats

- This is empirical reverse-engineering for plugin usage, not an official SimpleMind spec.
- Keep transformations minimal if round-tripping user-authored maps.
- Prefer template-based creation over generating full mindmap XML from scratch.

## Tooling Note (Cursor/Codex Environment)

- `.smmx` files are binary ZIP archives and cannot be read directly with plain text file readers in this environment.
- Reliable workflow:
  1. Use `unzip -l <file.smmx>` to inspect archive entries.
  2. Use `unzip -p <file.smmx> document/mindmap.xml` to read XML.
  3. Modify XML and write back by recreating/updating the ZIP.
