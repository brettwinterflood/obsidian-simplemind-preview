import { MindMapData, MindTopic } from "./types";

function compareTopics(a: MindTopic, b: MindTopic): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  const na = Number.parseInt(a.id, 10);
  const nb = Number.parseInt(b.id, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a.id && String(nb) === b.id) {
    return na - nb;
  }
  return a.id.localeCompare(b.id);
}

function singleLineLabel(topic: MindTopic): string {
  return topic.text.replace(/\s+/g, " ").trim() || "(empty)";
}

function buildChildrenByParent(topics: MindTopic[]): Map<string, MindTopic[]> {
  const map = new Map<string, MindTopic[]>();
  for (const t of topics) {
    const key = t.parentId;
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  for (const list of map.values()) {
    list.sort(compareTopics);
  }
  return map;
}

/** Markdown allows at most 6 heading levels; `#` is reserved for the file title. */
const MIN_TOPIC_HEADING_LEVEL = 2;
const MAX_HEADING_LEVEL = 6;

function headingPrefix(depth: number): string {
  const level = Math.min(MAX_HEADING_LEVEL, MIN_TOPIC_HEADING_LEVEL + depth);
  return "#".repeat(level);
}

function emitSubtree(topic: MindTopic, depth: number, childrenByParent: Map<string, MindTopic[]>, lines: string[]): void {
  lines.push(`${headingPrefix(depth)} ${singleLineLabel(topic)}`);
  const kids = childrenByParent.get(topic.id) ?? [];
  for (const child of kids) {
    emitSubtree(child, depth + 1, childrenByParent, lines);
  }
}

export function exportMindMapToMarkdown(data: MindMapData, options: { title: string }): string {
  const lines: string[] = [`# ${options.title}`, ""];
  const byParent = buildChildrenByParent(data.topics);
  const roots = (byParent.get("-1") ?? []).slice().sort(compareTopics);

  if (roots.length === 0 && data.topics.length > 0) {
    lines.push("_(No root topic with parent=-1; listing topics by id.)_", "");
    const sorted = [...data.topics].sort(compareTopics);
    for (const t of sorted) {
      lines.push(`${headingPrefix(0)} ${singleLineLabel(t)}`);
    }
  } else {
    for (const root of roots) {
      emitSubtree(root, 0, byParent, lines);
    }
  }

  if (data.relations.length > 0) {
    const idToTopic = new Map(data.topics.map((t) => [t.id, t]));
    lines.push("", "## Cross-links", "");
    for (const rel of data.relations) {
      const from = idToTopic.get(rel.sourceId);
      const to = idToTopic.get(rel.targetId);
      const left = from ? singleLineLabel(from) : `(missing id ${rel.sourceId})`;
      const right = to ? singleLineLabel(to) : `(missing id ${rel.targetId})`;
      lines.push(`- ${left} → ${right}`);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
