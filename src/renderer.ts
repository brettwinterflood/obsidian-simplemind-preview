import { MindMapData, MindTopic, SimpleMindPluginSettings } from "./types";

const PALETTE_COLORS: Record<string, string> = {
  "1": "#4F86F7",
  "2": "#00A86B",
  "3": "#F28C28",
  "4": "#AB47BC",
  "5": "#EF5350",
  "6": "#26A69A",
  "7": "#9CCC65",
  "8": "#FFCA28"
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getTopicColor(topic: MindTopic, settings: SimpleMindPluginSettings): string {
  if (!settings.usePaletteColors) {
    return "var(--interactive-accent)";
  }
  return PALETTE_COLORS[topic.palette ?? ""] ?? "#5E81AC";
}

function calcNodeWidth(text: string): number {
  return Math.max(100, Math.min(320, text.length * 7.5 + 24));
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
    const nodeWidth = calcNodeWidth(topic.text);
    const nodeHeight = 38;
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
      const text = escapeHtml(topic.text);
      const nodeWidth = calcNodeWidth(topic.text);
      const nodeHeight = 38;
      const left = x - nodeWidth / 2;
      const top = y - nodeHeight / 2;
      const fill = getTopicColor(topic, settings);

      return `
        <g class="simplemind-node" data-topic-id="${escapeHtml(topic.id)}">
          <rect x="${left}" y="${top}" width="${nodeWidth}" height="${nodeHeight}" rx="10" ry="10" fill="var(--background-primary)" opacity="1" stroke="${fill}" stroke-width="2"></rect>
          <text x="${x}" y="${y + 5}" text-anchor="middle" class="simplemind-label">${text}</text>
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
