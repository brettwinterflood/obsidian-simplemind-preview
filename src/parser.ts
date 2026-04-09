import JSZip from "jszip";
import { MindMapData, MindRelation, MindTopic, TextSegment } from "./types";

function getAttr(el: Element, name: string, fallback = ""): string {
  return el.getAttribute(name) ?? fallback;
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decodeSimpleMindText(value: string): string {
  return value
    .replace(/\\N/g, "\n")
    .replace(/\\\*/g, "")
    .trim();
}

function parseTextWithFormatting(rawText: string): { plainText: string; segments: TextSegment[] } {
  // First convert \N to newlines
  const withNewlines = rawText.replace(/\\N/g, "\n");
  
  // Parse \\* markers for bold text
  // Pattern: \\* marks start/end of bold sections
  const segments: TextSegment[] = [];
  let currentPos = 0;
  let inBold = false;
  const marker = "\\*";
  
  while (currentPos < withNewlines.length) {
    const nextMarker = withNewlines.indexOf(marker, currentPos);
    
    if (nextMarker === -1) {
      // No more markers, add remaining text
      const remaining = withNewlines.slice(currentPos).trim();
      if (remaining) {
        segments.push({ text: remaining, bold: inBold });
      }
      break;
    }
    
    // Add text before marker
    const textBefore = withNewlines.slice(currentPos, nextMarker);
    if (textBefore) {
      segments.push({ text: textBefore, bold: inBold });
    }
    
    // Toggle bold state
    inBold = !inBold;
    currentPos = nextMarker + marker.length;
  }
  
  // Build plain text (without markers)
  const plainText = segments.map(s => s.text).join("").trim() || "(untitled)";
  
  // If no segments were created, create one with the full text
  if (segments.length === 0) {
    segments.push({ text: plainText, bold: false });
  }
  
  return { plainText, segments };
}

function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return undefined;
}

function extractTopicColor(topicEl: Element): string | undefined {
  // Common direct attributes seen across some exports.
  const direct = ["color", "fill", "background", "bgcolor"];
  for (const key of direct) {
    const value = topicEl.getAttribute(key);
    if (!value) continue;
    const normalized = normalizeHexColor(value);
    if (normalized) return normalized;
  }

  // Try nested style/color definitions if present.
  const colorCandidates = Array.from(topicEl.querySelectorAll("style color, color"));
  for (const node of colorCandidates) {
    const attrs = ["hex", "value", "rgb", "color", "fill"];
    for (const attr of attrs) {
      const value = node.getAttribute(attr);
      if (!value) continue;
      const normalized = normalizeHexColor(value);
      if (normalized) return normalized;
    }
  }

  return undefined;
}

function hasStyleOverride(topicEl: Element): boolean {
  // Check if topic has a <style><font> child which overrides default styling
  const fontEl = topicEl.querySelector("style > font, style font, font");
  return fontEl !== null;
}

export async function parseSmmx(buffer: ArrayBuffer): Promise<MindMapData> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file("document/mindmap.xml");

  if (!xmlFile) {
    throw new Error("Invalid .smmx file: missing document/mindmap.xml");
  }

  const xml = await xmlFile.async("text");
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid mindmap.xml format");
  }

  const topicEls = Array.from(doc.querySelectorAll("topic"));
  
  // First pass: create topics without level
  const topicsWithoutLevel = topicEls.map((topicEl) => {
    const rawText = getAttr(topicEl, "text", "(untitled)");
    const { plainText, segments } = parseTextWithFormatting(rawText);
    return {
      id: getAttr(topicEl, "id"),
      parentId: getAttr(topicEl, "parent", "-1"),
      x: parseNumber(getAttr(topicEl, "x", "0")),
      y: parseNumber(getAttr(topicEl, "y", "0")),
      text: plainText,
      segments,
      palette: getAttr(topicEl, "palette"),
      sourceColor: extractTopicColor(topicEl),
      hasStyleOverride: hasStyleOverride(topicEl)
    };
  });

  // Build parent lookup for level calculation
  const topicById = new Map(topicsWithoutLevel.map(t => [t.id, t]));
  
  // Calculate levels
  function getLevel(topic: typeof topicsWithoutLevel[0]): number {
    if (topic.parentId === "-1") return 0;
    const parent = topicById.get(topic.parentId);
    if (!parent) return 0;
    return getLevel(parent) + 1;
  }

  const topics: MindTopic[] = topicsWithoutLevel.map((t) => {
    const level = getLevel(t);
    // Default bold for level 0 and 1, unless there's a style override
    const defaultBold = level <= 1 && !t.hasStyleOverride;
    
    // If default bold applies and no explicit bold markers in segments, make all segments bold
    const hasExplicitBold = t.segments.some(s => s.bold);
    const segments = (!hasExplicitBold && defaultBold) 
      ? t.segments.map(s => ({ ...s, bold: true }))
      : t.segments;

    return {
      id: t.id,
      parentId: t.parentId,
      x: t.x,
      y: t.y,
      text: t.text,
      segments,
      palette: t.palette,
      sourceColor: t.sourceColor,
      level
    };
  });

  const relationEls = Array.from(doc.querySelectorAll("relation"));
  const relations: MindRelation[] = relationEls
    .map((relationEl) => {
      const sourceId = getAttr(relationEl, "from");
      const targetId = getAttr(relationEl, "to");
      return { sourceId, targetId };
    })
    .filter((relation) => relation.sourceId !== "" && relation.targetId !== "");

  const bounds = topics.reduce(
    (acc, topic) => ({
      minX: Math.min(acc.minX, topic.x),
      minY: Math.min(acc.minY, topic.y),
      maxX: Math.max(acc.maxX, topic.x),
      maxY: Math.max(acc.maxY, topic.y)
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  );

  return { topics, relations, bounds };
}
