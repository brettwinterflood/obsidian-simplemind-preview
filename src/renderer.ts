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

function calcNodeDimensions(segments: TextSegment[]): { width: number; height: number; lines: ParsedLine[] } {
  const lines = parseSegmentsIntoLines(segments);
  const longestLineLength = lines.reduce((max, line) => Math.max(max, line.plainText.length), 0);
  const width = Math.max(100, Math.min(400, longestLineLength * 7.5 + 24));
  const lineHeight = 18;
  const verticalPadding = 16;
  const height = Math.max(38, lines.length * lineHeight + verticalPadding);

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
      const lineHeight = 18;
      const textStartY = y - ((lines.length - 1) * lineHeight) / 2 + 5;
      
      const textLines = lines
        .map((line, index) => {
          const dy = index === 0 ? 0 : lineHeight;
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

  return `
    <div class="simplemind-preview-scroll" data-main-x="${mainX.toFixed(2)}" data-main-y="${mainY.toFixed(2)}" data-map-width="${width.toFixed(2)}" data-map-height="${height.toFixed(2)}" style="max-height: ${settings.maxPreviewHeight}px; --simplemind-scale: ${scale};">
      <svg class="simplemind-preview-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet">
        <g class="simplemind-zoom-layer">
          ${connectors}
          ${relationLines}
          ${nodes}
        </g>
      </svg>
    </div>
  `;
}
