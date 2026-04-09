export type NodeTheme = "pastel" | "outline";

export interface SimpleMindPluginSettings {
  enabled: boolean;
  maxPreviewHeight: number;
  defaultZoom: number;
  nodeTheme: NodeTheme;
  templatePath: string;
}

export interface TextSegment {
  text: string;
  bold: boolean;
}

export interface MindTopic {
  id: string;
  parentId: string;
  x: number;
  y: number;
  text: string;
  segments: TextSegment[];
  palette?: string;
  sourceColor?: string;
  level: number;
}

export interface MindRelation {
  sourceId: string;
  targetId: string;
}

export interface MindMapData {
  topics: MindTopic[];
  relations: MindRelation[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}
