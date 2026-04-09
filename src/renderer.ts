import { MindMapData, MindTopic, SimpleMindPluginSettings, TextSegment } from "./types";

// SimpleMind palette colors from default_colors.smmstyle (stroke-color values)
// Palette items are 0-indexed in file but 1-indexed in topic palette attribute
const BRIGHT_PALETTE: Record<string, string> = {
  "1": "#0033FF", // Blue (r=0, g=51, b=255)
  "2": "#FF0000", // Red (r=255, g=0, b=0)
  "3": "#FF9900", // Orange (r=255, g=153, b=0)
  "4": "#FBC02D", // Yellow (r=251, g=192, b=45)
  "5": "#33FF00", // Green (r=51, g=255, b=0)
  "6": "#00CCFF", // Cyan (r=0, g=204, b=255)
  "7": "#9900FF", // Purple (r=153, g=0, b=255)
  "8": "#FF80C0"  // Pink (r=255, g=128, b=192)
};

const PALETTE_COLORS = BRIGHT_PALETTE;

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function toPastelHex(hex: string): string {
  const parsed = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(parsed)) return "#eef3fb";
  const r = Number.parseInt(parsed.slice(0, 2), 16);
  const g = Number.parseInt(parsed.slice(2, 4), 16);
  const b = Number.parseInt(parsed.slice(4, 6), 16);
  // Blend with white at 80% to keep pastel but opaque.
  const mix = (channel: number) => Math.round(channel * 0.2 + 255 * 0.8);
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

function getTopicColor(topic: MindTopic): string {
  if (topic.sourceColor) {
    return topic.sourceColor;
  }
  return PALETTE_COLORS[topic.palette ?? ""] ?? "#5E81AC";
}

interface LineSegment {
  text: string;
  bold: boolean;
}

interface ParsedLine {
  segments: LineSegment[];
  plainText: string;
}

function parseSegmentsIntoLines(segments: TextSegment[]): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let currentLine: LineSegment[] = [];
  let currentPlainText = "";

  for (const segment of segments) {
    const parts = segment.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i > 0) {
        // New line - push current and start fresh
        if (currentLine.length > 0 || currentPlainText.trim()) {
          lines.push({ segments: currentLine, plainText: currentPlainText.trim() });
        }
        currentLine = [];
        currentPlainText = "";
      }
      if (part) {
        currentLine.push({ text: part, bold: segment.bold });
        currentPlainText += part;
      }
    }
  }

  // Push final line
  if (currentLine.length > 0 || currentPlainText.trim()) {
    lines.push({ segments: currentLine, plainText: currentPlainText.trim() });
  }

  // Filter empty lines and ensure at least one
  const filtered = lines.filter(l => l.plainText.length > 0);
  return filtered.length > 0 ? filtered : [{ segments: [{ text: "(untitled)", bold: false }], plainText: "(untitled)" }];
}

/** ~px per Latin character at 13px UI font (matches simplemind-label). */
const APPROX_CHAR_WIDTH = 7.5;
const NODE_H_PAD = 24;
const MAX_NODE_WIDTH = 400;
const MIN_NODE_WIDTH = 100;
const LINE_HEIGHT = 18;
const VERTICAL_PAD = 20;

/** Wrap a single line of text to fit a max character width (word-aware, hard-breaks long tokens). */
function wrapPlainRowToRows(text: string, maxChars: number): string[] {
  const t = text.trim();
  if (t.length === 0) return [];
  if (maxChars < 8) return [t];
  if (t.length <= maxChars) return [t];

  const rows: string[] = [];
  const words = t.split(/(\s+)/);
  let row = "";

  const flushRow = (): void => {
    const trimmed = row.trim();
    if (trimmed.length > 0) rows.push(trimmed);
    row = "";
  };

  for (const word of words) {
    if (word.length === 0) continue;
    const candidate = row + word;
    if (candidate.length <= maxChars) {
      row = candidate;
      continue;
    }
    flushRow();
    if (word.length <= maxChars) {
      row = word;
      continue;
    }
    // Single token longer than max: hard-break
    let rest = word;
    while (rest.length > maxChars) {
      rows.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    row = rest;
  }
  flushRow();
  return rows.length > 0 ? rows : [t];
}

/** After manual newlines, split long lines so they fit the node width. */
function expandLinesWithWordWrap(lines: ParsedLine[], maxChars: number): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of lines) {
    const rows = wrapPlainRowToRows(line.plainText, maxChars);
    if (rows.length === 0) continue;
    const defaultBold = line.segments.some((s) => s.bold);
    for (const row of rows) {
      out.push({
        segments: [{ text: row, bold: defaultBold }],
        plainText: row
      });
    }
  }
  return out.length > 0 ? out : lines;
}

function calcNodeDimensions(segments: TextSegment[]): { width: number; height: number; lines: ParsedLine[] } {
  const manualLines = parseSegmentsIntoLines(segments);
  const innerBudget = MAX_NODE_WIDTH - NODE_H_PAD;
  const maxCharsPerRow = Math.max(8, Math.floor(innerBudget / APPROX_CHAR_WIDTH));
  const lines = expandLinesWithWordWrap(manualLines, maxCharsPerRow);

  const longestRowChars = lines.reduce((max, line) => Math.max(max, line.plainText.length), 0);
  const width = Math.max(
    MIN_NODE_WIDTH,
    Math.min(MAX_NODE_WIDTH, longestRowChars * APPROX_CHAR_WIDTH + NODE_H_PAD)
  );
  const height = Math.max(38, lines.length * LINE_HEIGHT + VERTICAL_PAD);

  return { width, height, lines };
}

function buildConnector(from: MindTopic, to: MindTopic, offsetX: number, offsetY: number): string {
  const x1 = from.x + offsetX;
  const y1 = from.y + offsetY;
  const x2 = to.x + offsetX;
  const y2 = to.y + offsetY;
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.35);
  const c1x = x1 + (x2 >= x1 ? dx : -dx);
  const c2x = x2 - (x2 >= x1 ? dx : -dx);
  return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
}

export function renderMindMapSvg(data: MindMapData, settings: SimpleMindPluginSettings): string {
  if (data.topics.length === 0) {
    return `<div class="simplemind-empty">No topics found.</div>`;
  }

  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const topic of data.topics) {
    const { width: nodeWidth, height: nodeHeight } = calcNodeDimensions(topic.segments);
    const left = topic.x - nodeWidth / 2;
    const top = topic.y - nodeHeight / 2;
    const right = left + nodeWidth;
    const bottom = top + nodeHeight;
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, right);
    maxBottom = Math.max(maxBottom, bottom);
  }

  const padding = 36;
  const width = Math.max(220, maxRight - minLeft + padding * 2);
  const height = Math.max(180, maxBottom - minTop + padding * 2);
  const offsetX = padding - minLeft;
  const offsetY = padding - minTop;
  const topicById = new Map(data.topics.map((topic) => [topic.id, topic]));
  const mainTopic = data.topics.find((topic) => topic.parentId === "-1") ?? data.topics[0];
  const mainX = mainTopic.x + offsetX;
  const mainY = mainTopic.y + offsetY;

  const connectors = data.topics
    .filter((topic) => topic.parentId !== "-1")
    .map((topic) => {
      const parent = topicById.get(topic.parentId);
      if (!parent) return "";
      return `<path class="simplemind-connector" d="${buildConnector(parent, topic, offsetX, offsetY)}" />`;
    })
    .join("");

  const relationLines = data.relations
    .map((relation) => {
      const source = topicById.get(relation.sourceId);
      const target = topicById.get(relation.targetId);
      if (!source || !target) return "";
      return `<path class="simplemind-relation" d="${buildConnector(source, target, offsetX, offsetY)}" />`;
    })
    .join("");

  const nodes = data.topics
    .map((topic) => {
      const x = topic.x + offsetX;
      const y = topic.y + offsetY;
      const { width: nodeWidth, height: nodeHeight, lines } = calcNodeDimensions(topic.segments);
      const left = x - nodeWidth / 2;
      const top = y - nodeHeight / 2;
      const baseColor = getTopicColor(topic);
      const textStartY = y - ((lines.length - 1) * LINE_HEIGHT) / 2;

      const textLines = lines
        .map((line, index) => {
          const dy = index === 0 ? 0 : LINE_HEIGHT;
          const segmentSpans = line.segments
            .map((seg) => {
              const escaped = escapeHtml(seg.text);
              return seg.bold ? `<tspan font-weight="bold">${escaped}</tspan>` : escaped;
            })
            .join("");
          return `<tspan x="${x}" dy="${dy}">${segmentSpans}</tspan>`;
        })
        .join("");

      const fill = settings.nodeTheme === "pastel" ? toPastelHex(baseColor) : "#ffffff";
      const strokeWidth = settings.nodeTheme === "pastel" ? 1.6 : 2;

      return `
        <g class="simplemind-node" data-topic-id="${escapeHtml(topic.id)}">
          <rect x="${left}" y="${top}" width="${nodeWidth}" height="${nodeHeight}" rx="10" ry="10" fill="${fill}" opacity="1" stroke="${baseColor}" stroke-width="${strokeWidth}"></rect>
          <text x="${x}" y="${textStartY}" text-anchor="middle" class="simplemind-label">${textLines}</text>
        </g>
      `;
    })
    .join("");

  const scale = Math.max(0.2, settings.defaultZoom / 100);
  const layoutW = width * scale;
  const layoutH = height * scale;

  return `
    <div class="simplemind-preview-scroll" data-main-x="${mainX.toFixed(2)}" data-main-y="${mainY.toFixed(2)}" data-map-width="${width.toFixed(2)}" data-map-height="${height.toFixed(2)}" style="max-height: ${settings.maxPreviewHeight}px; --simplemind-scale: ${scale};">
      <div class="simplemind-map-layout" style="width: ${layoutW}px; height: ${layoutH}px;">
        <svg class="simplemind-preview-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
          <g class="simplemind-zoom-layer">
            ${connectors}
            ${relationLines}
            ${nodes}
          </g>
        </svg>
      </div>
    </div>
  `;
}
