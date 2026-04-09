import JSZip from "jszip";
import { Editor, MarkdownView, Modal, Notice, Plugin, Setting, setIcon, TFile } from "obsidian";
import { parseSmmx } from "./parser";
import { renderMindMapSvg } from "./renderer";
import { SimpleMindSettingsTab } from "./settings";
import { MindMapData, SimpleMindPluginSettings } from "./types";

const DEFAULT_SETTINGS: SimpleMindPluginSettings = {
  enabled: true,
  maxPreviewHeight: 350,
  defaultZoom: 45,
  nodeTheme: "pastel",
  templatePath: ".obsidian/plugins/simplemind-preview/assets/template-mindmap.smmx"
};

type CacheItem = {
  key: string;
  data: MindMapData;
};

export default class SimpleMindPreviewPlugin extends Plugin {
  settings: SimpleMindPluginSettings = DEFAULT_SETTINGS;
  private cache = new Map<string, CacheItem>();
  private cacheOrder: string[] = [];
  private cacheMax = 20;
  private livePreviewScanTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SimpleMindSettingsTab(this.app, this));
    this.addCommand({
      id: "create-mindmap",
      name: "Create & insert new mindmap",
      editorCallback: async (editor, view) => {
        await this.createMindmap(editor, view);
      }
    });
    this.addCommand({
      id: "create-mindmap-from-current-note-name",
      name: "Create & insert new mindmap (current note name)",
      editorCallback: async (editor, view) => {
        await this.createMindmapFromCurrentNoteName(editor, view);
      }
    });

    this.registerMarkdownPostProcessor(async (el, ctx) => {
      if (!this.settings.enabled) return;
      const embeds = Array.from(el.querySelectorAll(".internal-embed"));
      for (const embed of embeds) {
        const src = embed.getAttribute("src");
        if (!src || !src.toLowerCase().endsWith(".smmx")) continue;
        const destination = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
        if (!(destination instanceof TFile)) continue;
        await this.renderEmbed(embed as HTMLElement, destination);
      }
    });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleLivePreviewScan()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleLivePreviewScan()));

    const observer = new MutationObserver(() => this.scheduleLivePreviewScan());
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());

    this.scheduleLivePreviewScan();
  }

  onunload(): void {
    this.cache.clear();
    this.cacheOrder = [];
    if (this.livePreviewScanTimer !== null) {
      window.clearTimeout(this.livePreviewScanTimer);
      this.livePreviewScanTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Migrate old public template path to internal plugin path.
    if (this.settings.templatePath === "assets/template-mindmap.smmx") {
      this.settings.templatePath = ".obsidian/plugins/simplemind-preview/assets/template-mindmap.smmx";
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private touchCache(cacheKey: string): void {
    this.cacheOrder = this.cacheOrder.filter((key) => key !== cacheKey);
    this.cacheOrder.push(cacheKey);
    while (this.cacheOrder.length > this.cacheMax) {
      const oldest = this.cacheOrder.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }

  private async readMindMap(file: TFile): Promise<MindMapData> {
    const stat = await this.app.vault.adapter.stat(file.path);
    const cacheKey = `${file.path}:${stat?.mtime ?? 0}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.touchCache(cacheKey);
      return cached.data;
    }

    const binary = await this.app.vault.adapter.readBinary(file.path);
    const data = await parseSmmx(binary);

    this.cache.set(cacheKey, { key: cacheKey, data });
    this.touchCache(cacheKey);
    return data;
  }

  private async renderEmbed(embedEl: HTMLElement, file: TFile): Promise<void> {
    if (embedEl.getAttribute("data-simplemind-rendered") === file.path) {
      return;
    }

    embedEl.empty();
    embedEl.addClass("simplemind-preview-host");
    embedEl.setAttribute("data-simplemind-rendered", file.path);

    try {
      const map = await this.readMindMap(file);
      const header = embedEl.createDiv({ cls: "simplemind-header" });
      const title = header.createDiv({ cls: "simplemind-title", text: file.basename });
      title.setAttr("title", file.path);

      const button = header.createEl("button", {
        cls: "simplemind-open-button",
        text: "Open in SimpleMind"
      });
      setIcon(button, "external-link");
      button.onclick = async () => this.openInSimpleMind(file);

      const preview = embedEl.createDiv({ cls: "simplemind-preview" });
      preview.innerHTML = renderMindMapSvg(map, this.settings);
      this.attachZoomInteractions(preview, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      embedEl.createDiv({ cls: "simplemind-error", text: `Failed to preview ${file.name}: ${message}` });
    }
  }

  private attachZoomInteractions(previewEl: HTMLElement, file: TFile): void {
    const scrollEl = previewEl.querySelector(".simplemind-preview-scroll") as HTMLElement | null;
    if (!scrollEl) return;

    // Intercept default embed opening; open SimpleMind only when a node is clicked.
    previewEl.addEventListener(
      "mousedown",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".simplemind-node")) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    previewEl.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const node = target?.closest(".simplemind-node");
        event.preventDefault();
        event.stopPropagation();
        if (node) {
          void this.openInSimpleMind(file);
        }
      },
      true
    );

    const getScale = (): number => {
      const cssValue = scrollEl.style.getPropertyValue("--simplemind-scale").trim();
      const parsed = Number.parseFloat(cssValue);
      return Number.isFinite(parsed) ? parsed : Math.max(0.2, this.settings.defaultZoom / 100);
    };

    const setScale = (nextScale: number): void => {
      const clamped = Math.max(0.2, Math.min(3, nextScale));
      scrollEl.style.setProperty("--simplemind-scale", clamped.toFixed(3));
      clampToBounds();
    };

    const clampToBounds = (): void => {
      const mapWidth = Number.parseFloat(scrollEl.getAttribute("data-map-width") ?? "");
      const mapHeight = Number.parseFloat(scrollEl.getAttribute("data-map-height") ?? "");
      if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight)) return;
      const scale = getScale();
      const maxScrollLeft = Math.max(0, mapWidth * scale - scrollEl.clientWidth);
      const maxScrollTop = Math.max(0, mapHeight * scale - scrollEl.clientHeight);
      scrollEl.scrollLeft = Math.min(maxScrollLeft, Math.max(0, scrollEl.scrollLeft));
      scrollEl.scrollTop = Math.min(maxScrollTop, Math.max(0, scrollEl.scrollTop));
    };

    const centerOnMainNode = (): void => {
      const mainX = Number.parseFloat(scrollEl.getAttribute("data-main-x") ?? "");
      const mainY = Number.parseFloat(scrollEl.getAttribute("data-main-y") ?? "");
      if (!Number.isFinite(mainX) || !Number.isFinite(mainY)) return;
      const scale = getScale();
      const targetLeft = mainX * scale - scrollEl.clientWidth / 2;
      const targetTop = mainY * scale - scrollEl.clientHeight / 2;
      scrollEl.scrollLeft = Math.max(0, targetLeft);
      scrollEl.scrollTop = Math.max(0, targetTop);
      clampToBounds();
    };

    scrollEl.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const current = getScale();
        const step = event.deltaY < 0 ? 0.03 : -0.03;
        setScale(current + step);
      },
      { passive: false }
    );

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let originScrollLeft = 0;
    let originScrollTop = 0;

    scrollEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".simplemind-node")) {
        return;
      }
      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originScrollLeft = scrollEl.scrollLeft;
      originScrollTop = scrollEl.scrollTop;
      scrollEl.setPointerCapture(event.pointerId);
      scrollEl.addClass("is-dragging");
    });

    const endDrag = (event: PointerEvent): void => {
      if (!isDragging) return;
      isDragging = false;
      if (scrollEl.hasPointerCapture(event.pointerId)) {
        scrollEl.releasePointerCapture(event.pointerId);
      }
      scrollEl.removeClass("is-dragging");
    };

    scrollEl.addEventListener("pointermove", (event) => {
      if (!isDragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      scrollEl.scrollLeft = originScrollLeft - dx;
      scrollEl.scrollTop = originScrollTop - dy;
      clampToBounds();
    });

    scrollEl.addEventListener("pointerup", endDrag);
    scrollEl.addEventListener("pointercancel", endDrag);
    scrollEl.addEventListener("scroll", clampToBounds);

    const resizeObserver = new ResizeObserver(() => clampToBounds());
    resizeObserver.observe(scrollEl);
    this.register(() => resizeObserver.disconnect());

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => centerOnMainNode());
    });
  }

  private scheduleLivePreviewScan(): void {
    if (!this.settings.enabled) return;
    if (this.livePreviewScanTimer !== null) {
      window.clearTimeout(this.livePreviewScanTimer);
    }
    this.livePreviewScanTimer = window.setTimeout(() => {
      this.livePreviewScanTimer = null;
      void this.renderLivePreviewEmbeds();
    }, 120);
  }

  private async renderLivePreviewEmbeds(): Promise<void> {
    const sourceViewEmbeds = Array.from(
      document.querySelectorAll<HTMLElement>(".markdown-source-view.mod-cm6 .internal-embed[src$='.smmx']")
    );
    if (sourceViewEmbeds.length === 0) return;

    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile?.path ?? "";

    for (const embed of sourceViewEmbeds) {
      const src = embed.getAttribute("src");
      if (!src) continue;
      const destination = this.app.metadataCache.getFirstLinkpathDest(src, sourcePath);
      if (!(destination instanceof TFile)) continue;
      await this.renderEmbed(embed, destination);
    }
  }

  private async openInSimpleMind(file: TFile): Promise<void> {
    const adapter = this.app.vault.adapter as { basePath?: string };
    const basePath = adapter.basePath;
    if (!basePath) {
      new Notice("Could not determine vault path.");
      return;
    }

    const path = window.require("path");
    const childProcess = window.require("child_process");
    const absolutePath = path.join(basePath, file.path);

    childProcess.execFile("open", ["-a", "SimpleMind Pro", absolutePath], (error: Error | null) => {
      if (error) {
        new Notice("Could not open file in SimpleMind Pro.");
      }
    });
  }

  private sanitizeFileName(input: string): string {
    return input
      .trim()
      .replace(/[\/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "");
  }

  private escapeXmlAttribute(input: string): string {
    return input
      .replaceAll("&", "&amp;")
      .replaceAll("\"", "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  private async promptMindmapName(): Promise<string | null> {
    return await new Promise((resolve) => {
      const modal = new TextInputModal(this.app, "New mindmap name", "Mindmap name", "", resolve);
      modal.open();
    });
  }

  private async createMindmap(editor: Editor, view: MarkdownView): Promise<void> {
    const rawName = await this.promptMindmapName();
    if (!rawName) return;
    await this.createMindmapWithName(rawName, editor, view);
  }

  private async createMindmapFromCurrentNoteName(editor: Editor, view: MarkdownView): Promise<void> {
    const activeFile = view.file;
    if (!activeFile) {
      new Notice("Open a note to create the mindmap beside it.");
      return;
    }
    await this.createMindmapWithName(activeFile.basename, editor, view);
  }

  private async createMindmapWithName(rawName: string, editor: Editor, view: MarkdownView): Promise<void> {
    const cleanName = this.sanitizeFileName(rawName);
    if (!cleanName) {
      new Notice("Please enter a valid mindmap name.");
      return;
    }

    const activeFile = view.file;
    if (!activeFile) {
      new Notice("Open a note to create the mindmap beside it.");
      return;
    }

    const currentFolder = activeFile.parent?.path ?? "";
    const targetPath = currentFolder ? `${currentFolder}/${cleanName}.smmx` : `${cleanName}.smmx`;
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing) {
      new Notice(`${cleanName}.smmx already exists.`);
      return;
    }

    try {
      const templateBinary = await this.app.vault.adapter.readBinary(this.settings.templatePath);
      const zip = await JSZip.loadAsync(templateBinary);
      const xmlFile = zip.file("document/mindmap.xml");
      if (!xmlFile) {
        new Notice("Template is invalid: missing document/mindmap.xml");
        return;
      }

      const xmlText = await xmlFile.async("text");
      const escapedName = this.escapeXmlAttribute(rawName.trim());
      const updatedXml = xmlText.replaceAll("-----", escapedName);
      zip.file("document/mindmap.xml", updatedXml);

      const zippedData = await zip.generateAsync({ type: "uint8array" });
      const arrayBuffer = zippedData.buffer.slice(
        zippedData.byteOffset,
        zippedData.byteOffset + zippedData.byteLength
      ) as ArrayBuffer;
      await this.app.vault.adapter.writeBinary(targetPath, arrayBuffer);

      editor.replaceSelection(`![[${cleanName}.smmx]]`);
      new Notice(`Created ${cleanName}.smmx`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to create mindmap: ${message}`);
    }
  }
}

class TextInputModal extends Modal {
  private readonly titleText: string;
  private readonly placeholder: string;
  private readonly initialValue: string;
  private readonly onSubmit: (value: string | null) => void;
  private submitted = false;

  constructor(
    app: import("obsidian").App,
    titleText: string,
    placeholder: string,
    initialValue: string,
    onSubmit: (value: string | null) => void
  ) {
    super(app);
    this.titleText = titleText;
    this.placeholder = placeholder;
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = this.placeholder;
    input.value = this.initialValue;
    input.addClass("simplemind-name-input");

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    new Setting(buttonRow).addButton((button) =>
      button.setButtonText("Create").setCta().onClick(() => {
        this.submitted = true;
        this.onSubmit(input.value.trim());
        this.close();
      })
    );
    new Setting(buttonRow).addButton((button) =>
      button.setButtonText("Cancel").onClick(() => {
        this.submitted = true;
        this.onSubmit(null);
        this.close();
      })
    );

    input.focus();
    input.select();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitted = true;
        this.onSubmit(input.value.trim());
        this.close();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.submitted = true;
        this.onSubmit(null);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) {
      this.onSubmit(null);
    }
  }
}
