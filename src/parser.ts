import JSZip from "jszip";
import { MindMapData, MindRelation, MindTopic } from "./types";

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
    .replace(/\s+/g, " ")
    .trim();
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
  const topics: MindTopic[] = topicEls.map((topicEl) => ({
    id: getAttr(topicEl, "id"),
    parentId: getAttr(topicEl, "parent", "-1"),
    x: parseNumber(getAttr(topicEl, "x", "0")),
    y: parseNumber(getAttr(topicEl, "y", "0")),
    text: decodeSimpleMindText(getAttr(topicEl, "text", "(untitled)")) || "(untitled)",
    palette: getAttr(topicEl, "palette")
  }));

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
