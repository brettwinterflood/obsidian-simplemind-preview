# SMMX Format Knowledge (for LLM Workflows)

This file captures practical knowledge about SimpleMind `.smmx` files for automation, parsing, and generation in Obsidian plugins and LLM-assisted tools.

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
- `palette` / `colorinfo`: style/color hints

Layout is hierarchical by `parent` relationships, but positions are absolute.

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
- `\\*` appears in formatted text exports
- HTML entities may appear in attributes (`&gt;`, etc.)

Safe normalization strategy for previews:

- Convert `\\N` to newline or space
- Strip `\\*` for plain display
- Collapse repeated whitespace for node label sizing

## Quick Lookup for Root Topic

Root node is typically:

- `topic[parent="-1"]`

Fallback:

- first topic in document if parent markers are missing

## Known Practical Behavior

- macOS `qlmanage` does not reliably generate previews for `.smmx` in this environment.
- Direct XML parsing and custom SVG rendering is robust and cross-platform within Obsidian plugin runtime.

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
