export interface SimpleMindPluginSettings {
  enabled: boolean;
  maxPreviewHeight: number;
  defaultZoom: number;
  usePaletteColors: boolean;
  templatePath: string;
}

export interface MindTopic {
  id: string;
  parentId: string;
  x: number;
  y: number;
  text: string;
  palette?: string;
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
