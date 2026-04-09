import * as fs from "fs/promises";
import * as path from "path";
import JSZip from "jszip";
import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  Setting,
  setIcon,
  TFile
} from "obsidian";
import { exportMindMapToMarkdown } from "./mindmap-markdown-export";
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

type EmbedInteractionState = {
  activePointers: Set<number>;
  pendingFile: TFile | null;
};

export default class SimpleMindPreviewPlugin extends Plugin {
  settings: SimpleMindPluginSettings = DEFAULT_SETTINGS;
  private cache = new Map<string, CacheItem>();
  private cacheOrder: string[] = [];
  private cacheMax = 20;
  private livePreviewScanTimer: number | null = null;
  /** Debounced follow-up when the user edits markdown (replaces workspace-wide MutationObserver). */
  private editorEmbedScanTimer: number | null = null;
  /** Debounce vault `modify` → preview refresh per path (avoids freeze on rapid saves/sync). */
  private smmxRefreshTimers = new Map<string, number>();
  private static readonly SMMX_VAULT_REFRESH_DEBOUNCE_MS = 450;
  /** Active leaf / layout: scan only the focused note’s source pane. */
  private static readonly LEAF_LAYOUT_SCAN_DEBOUNCE_MS = 120;
  /** Typing in editor: long debounce so we do not re-parse on every keystroke. */
  private static readonly EDITOR_EMBED_SCAN_DEBOUNCE_MS = 750;
  /** Latest view from `editor-change` (cleared when the debounced run fires or leaf switches). */
  private pendingEditorScanView: MarkdownView | null = null;
  /** Supersedes stale async `renderEmbed` runs when the same host is re-entered. */
  private embedRenderGen = new WeakMap<HTMLElement, number>();
  /** Per-host pointer/drag state so refreshes do not replace DOM mid-interaction. */
  private embedInteractionState = new WeakMap<HTMLElement, EmbedInteractionState>();
  /** Aborts old preview-level listeners when a host is re-rendered. */
  private embedInteractionControllers = new WeakMap<HTMLElement, AbortController>();

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
      let smmxIndex = 0;
      for (const embed of embeds) {
        const src = embed.getAttribute("src");
        if (!src || !src.toLowerCase().endsWith(".smmx")) continue;
        const destination = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
        if (!(destination instanceof TFile)) continue;
        if (smmxIndex++ > 0) await this.yieldToMain();
        await this.renderEmbed(embed as HTMLElement, destination);
      }
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.editorEmbedScanTimer !== null) {
          window.clearTimeout(this.editorEmbedScanTimer);
          this.editorEmbedScanTimer = null;
        }
        this.pendingEditorScanView = null;
        this.scheduleLivePreviewScan();
      })
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleLivePreviewScan()));
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (!this.settings.enabled) return;
        if (!(info instanceof MarkdownView)) return;
        if (info.getMode() !== "source") return;
        this.scheduleEditorEmbedScan(info);
      })
    );

    this.scheduleLivePreviewScan();

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.settings.enabled) return;
        if (!(file instanceof TFile) || file.extension !== "smmx") return;
        this.scheduleDebouncedSmmxVaultRefresh(file.path);
      })
    );
  }

  onunload(): void {
    this.cache.clear();
    this.cacheOrder = [];
    if (this.livePreviewScanTimer !== null) {
      window.clearTimeout(this.livePreviewScanTimer);
      this.livePreviewScanTimer = null;
    }
    if (this.editorEmbedScanTimer !== null) {
      window.clearTimeout(this.editorEmbedScanTimer);
      this.editorEmbedScanTimer = null;
    }
    for (const id of this.smmxRefreshTimers.values()) {
      window.clearTimeout(id);
    }
    this.smmxRefreshTimers.clear();
  }

  /** Coalesce rapid `vault.modify` events (autosave, sync, external app) before reparsing. */
  private scheduleDebouncedSmmxVaultRefresh(filePath: string): void {
    const existing = this.smmxRefreshTimers.get(filePath);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timerId = window.setTimeout(() => {
      this.smmxRefreshTimers.delete(filePath);
      const fresh = this.app.vault.getAbstractFileByPath(filePath);
      if (fresh instanceof TFile && fresh.extension === "smmx") {
        this.runWhenIdle(() => this.refreshSmmxEmbedsForFile(fresh));
      }
    }, SimpleMindPreviewPlugin.SMMX_VAULT_REFRESH_DEBOUNCE_MS);
    this.smmxRefreshTimers.set(filePath, timerId);
  }

  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  /** Defer heavy parse/DOM so typing and layout stay responsive. */
  private runWhenIdle(task: () => void | Promise<void>): void {
    const run = (): void => {
      void Promise.resolve(task());
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(run, 0);
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

  /** Prefer template next to `main.js` (plugin folder) on desktop; fall back to vault-relative path. */
  private async loadTemplateBinary(): Promise<ArrayBuffer> {
    const pluginDir = this.manifest.dir;
    if (Platform.isDesktopApp && pluginDir) {
      const bundled = path.join(pluginDir, "assets", "template-mindmap.smmx");
      try {
        const buf = await fs.readFile(bundled);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch {
        // fall through to vault path
      }
    }
    return this.app.vault.adapter.readBinary(this.settings.templatePath);
  }

  /** Opens the file with the OS default app for `.smmx` (typically SimpleMind on desktop). */
  private async openSmmxWithSystemDefaultApp(vaultPath: string): Promise<void> {
    if (!Platform.isDesktopApp) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const absolutePath = adapter.getFullPath(vaultPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require("electron") as { shell: { openPath: (path: string) => Promise<string> } };
    const err = await shell.openPath(absolutePath);
    if (err) {
      new Notice(`Could not open ${vaultPath} externally: ${err}`);
    }
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

  private async refreshSmmxEmbedsForFile(file: TFile): Promise<void> {
    const hosts = Array.from(document.querySelectorAll<HTMLElement>("[data-simplemind-rendered]")).filter(
      (el) => el.getAttribute("data-simplemind-rendered") === file.path
    );
    for (let i = 0; i < hosts.length; i++) {
      if (i > 0) await this.yieldToMain();
      await this.renderEmbed(hosts[i], file);
    }
  }

  private getEmbedInteractionState(embedEl: HTMLElement): EmbedInteractionState {
    let state = this.embedInteractionState.get(embedEl);
    if (!state) {
      state = {
        activePointers: new Set<number>(),
        pendingFile: null
      };
      this.embedInteractionState.set(embedEl, state);
    }
    return state;
  }

  private isEmbedInteracting(embedEl: HTMLElement): boolean {
    return (this.embedInteractionState.get(embedEl)?.activePointers.size ?? 0) > 0;
  }

  private queueEmbedRefresh(embedEl: HTMLElement, file: TFile): void {
    const state = this.getEmbedInteractionState(embedEl);
    state.pendingFile = file;
  }

  private flushQueuedEmbedRefresh(embedEl: HTMLElement): void {
    const state = this.embedInteractionState.get(embedEl);
    if (!state || state.activePointers.size > 0 || !state.pendingFile) return;
    const pendingFile = state.pendingFile;
    state.pendingFile = null;
    this.runWhenIdle(() => this.renderEmbed(embedEl, pendingFile));
  }

  private beginEmbedPointerInteraction(embedEl: HTMLElement, pointerId: number): void {
    this.getEmbedInteractionState(embedEl).activePointers.add(pointerId);
  }

  private endEmbedPointerInteraction(embedEl: HTMLElement, pointerId?: number): void {
    const state = this.embedInteractionState.get(embedEl);
    if (!state) return;
    if (pointerId === undefined) {
      state.activePointers.clear();
    } else {
      state.activePointers.delete(pointerId);
    }
    if (state.activePointers.size === 0) {
      this.flushQueuedEmbedRefresh(embedEl);
    }
  }

  private resetEmbedInteractionController(embedEl: HTMLElement): AbortSignal {
    this.embedInteractionControllers.get(embedEl)?.abort();
    const controller = new AbortController();
    this.embedInteractionControllers.set(embedEl, controller);
    return controller.signal;
  }

  private async renderEmbed(embedEl: HTMLElement, file: TFile): Promise<void> {
    const gen = (this.embedRenderGen.get(embedEl) ?? 0) + 1;
    this.embedRenderGen.set(embedEl, gen);

    if (this.isEmbedInteracting(embedEl)) {
      this.queueEmbedRefresh(embedEl, file);
      return;
    }

    const stat = await this.app.vault.adapter.stat(file.path);
    if (this.embedRenderGen.get(embedEl) !== gen) return;

    const currentMtime = stat?.mtime ?? 0;
    if (
      embedEl.getAttribute("data-simplemind-rendered") === file.path &&
      embedEl.getAttribute("data-simplemind-mtime") === String(currentMtime)
    ) {
      return;
    }

    this.embedInteractionControllers.get(embedEl)?.abort();
    embedEl.empty();
    embedEl.addClass("simplemind-preview-host");

    try {
      const map = await this.readMindMap(file);
      if (this.embedRenderGen.get(embedEl) !== gen) return;

      const statAfter = await this.app.vault.adapter.stat(file.path);
      if (this.embedRenderGen.get(embedEl) !== gen) return;

      const mtimeForAttr = statAfter?.mtime ?? 0;

      const header = embedEl.createDiv({ cls: "simplemind-header" });
      const title = header.createDiv({ cls: "simplemind-title", text: file.basename });
      title.setAttr("title", file.path);

      const actions = header.createDiv({ cls: "simplemind-header-actions" });
      const refreshBtn = actions.createEl("button", {
        cls: "simplemind-refresh-button",
        text: "Refresh"
      });
      refreshBtn.setAttr("title", "Reload the preview from disk");
      refreshBtn.setAttr("aria-label", "Reload the preview from disk");
      setIcon(refreshBtn, "refresh-ccw");
      refreshBtn.onclick = () => {
        embedEl.removeAttribute("data-simplemind-rendered");
        embedEl.removeAttribute("data-simplemind-mtime");
        void this.renderEmbed(embedEl, file);
      };

      const copyMarkdownBtn = actions.createEl("button", {
        cls: "simplemind-copy-markdown-button",
        text: "Copy as markdown"
      });
      copyMarkdownBtn.setAttr(
        "title",
        "Markdown export: nested heading outline of this mindmap (e.g. for LLMs or other tools)"
      );
      copyMarkdownBtn.setAttr(
        "aria-label",
        "Copy markdown export of this mindmap to the clipboard"
      );
      setIcon(copyMarkdownBtn, "copy");
      copyMarkdownBtn.onclick = async () => {
        try {
          const map = await this.readMindMap(file);
          const text = exportMindMapToMarkdown(map, { title: file.basename });
          await navigator.clipboard.writeText(text);
          new Notice("Copied markdown export to clipboard");
        } catch {
          new Notice("Copy failed");
        }
      };

      const button = actions.createEl("button", {
        cls: "simplemind-open-button",
        text: "Open in SimpleMind"
      });
      button.setAttr("title", "Open this file in SimpleMind Pro");
      button.setAttr("aria-label", "Open this file in SimpleMind Pro");
      setIcon(button, "external-link");
      button.onclick = async () => this.openInSimpleMind(file);

      const preview = embedEl.createDiv({ cls: "simplemind-preview" });
      preview.innerHTML = renderMindMapSvg(map, this.settings);
      this.attachZoomInteractions(embedEl, preview, file);

      embedEl.setAttribute("data-simplemind-rendered", file.path);
      embedEl.setAttribute("data-simplemind-mtime", String(mtimeForAttr));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      embedEl.createDiv({ cls: "simplemind-error", text: `Failed to preview ${file.name}: ${message}` });
    }
  }

  private attachZoomInteractions(embedEl: HTMLElement, previewEl: HTMLElement, file: TFile): void {
    const scrollEl = previewEl.querySelector(".simplemind-preview-scroll") as HTMLElement | null;
    if (!scrollEl) return;
    const listenerSignal = this.resetEmbedInteractionController(embedEl);

    // Intercept default embed opening; open SimpleMind only when a node is clicked.
    previewEl.addEventListener(
      "mousedown",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".simplemind-node")) return;
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true, signal: listenerSignal }
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
      { capture: true, signal: listenerSignal }
    );

    const getScale = (): number => {
      const cssValue = scrollEl.style.getPropertyValue("--simplemind-scale").trim();
      const parsed = Number.parseFloat(cssValue);
      return Number.isFinite(parsed) ? parsed : Math.max(0.2, this.settings.defaultZoom / 100);
    };

    const setScale = (nextScale: number): void => {
      const clamped = Math.max(0.2, Math.min(3, nextScale));
      scrollEl.style.setProperty("--simplemind-scale", clamped.toFixed(3));
      const layoutEl = scrollEl.querySelector(".simplemind-map-layout") as HTMLElement | null;
      const mapWidth = Number.parseFloat(scrollEl.getAttribute("data-map-width") ?? "");
      const mapHeight = Number.parseFloat(scrollEl.getAttribute("data-map-height") ?? "");
      if (layoutEl && Number.isFinite(mapWidth) && Number.isFinite(mapHeight)) {
        layoutEl.style.width = `${mapWidth * clamped}px`;
        layoutEl.style.height = `${mapHeight * clamped}px`;
      }
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

    const forceEndInteraction = (pointerId?: number): void => {
      isDragging = false;
      if (pointerId !== undefined && scrollEl.hasPointerCapture(pointerId)) {
        scrollEl.releasePointerCapture(pointerId);
      }
      scrollEl.removeClass("is-dragging");
      this.endEmbedPointerInteraction(embedEl, pointerId);
    };

    scrollEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.beginEmbedPointerInteraction(embedEl, event.pointerId);
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
    }, { signal: listenerSignal });

    const endDrag = (event: PointerEvent): void => {
      forceEndInteraction(event.pointerId);
    };

    scrollEl.addEventListener("pointermove", (event) => {
      if (!isDragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      scrollEl.scrollLeft = originScrollLeft - dx;
      scrollEl.scrollTop = originScrollTop - dy;
      clampToBounds();
    }, { signal: listenerSignal });

    scrollEl.addEventListener("pointerup", endDrag, { signal: listenerSignal });
    scrollEl.addEventListener("pointercancel", endDrag, { signal: listenerSignal });
    scrollEl.addEventListener("lostpointercapture", (event) => {
      forceEndInteraction((event as PointerEvent).pointerId);
    }, { signal: listenerSignal });
    scrollEl.addEventListener("scroll", clampToBounds, { signal: listenerSignal });
    window.addEventListener("blur", () => forceEndInteraction(), { signal: listenerSignal });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        forceEndInteraction();
      }
    }, { signal: listenerSignal });

    const resizeObserver = new ResizeObserver(() => clampToBounds());
    resizeObserver.observe(scrollEl);
    listenerSignal.addEventListener("abort", () => resizeObserver.disconnect(), { once: true });
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
      this.runWhenIdle(() => this.renderActiveMarkdownSourceEmbeds());
    }, SimpleMindPreviewPlugin.LEAF_LAYOUT_SCAN_DEBOUNCE_MS);
  }

  private scheduleEditorEmbedScan(view: MarkdownView): void {
    if (!this.settings.enabled) return;
    this.pendingEditorScanView = view;
    if (this.editorEmbedScanTimer !== null) {
      window.clearTimeout(this.editorEmbedScanTimer);
    }
    this.editorEmbedScanTimer = window.setTimeout(() => {
      this.editorEmbedScanTimer = null;
      const target = this.pendingEditorScanView;
      this.pendingEditorScanView = null;
      if (target) {
        this.runWhenIdle(() => this.renderLivePreviewEmbedsForMarkdownView(target));
      }
    }, SimpleMindPreviewPlugin.EDITOR_EMBED_SCAN_DEBOUNCE_MS);
  }

  private async renderActiveMarkdownSourceEmbeds(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") return;
    await this.renderLivePreviewEmbedsForMarkdownView(view);
  }

  private async renderLivePreviewEmbedsForMarkdownView(view: MarkdownView): Promise<void> {
    const root = view.containerEl.querySelector<HTMLElement>(".markdown-source-view.mod-cm6");
    if (!root) return;

    const sourceViewEmbeds = Array.from(root.querySelectorAll<HTMLElement>(".internal-embed")).filter((el) => {
      const src = el.getAttribute("src");
      return src?.toLowerCase().endsWith(".smmx") ?? false;
    });
    if (sourceViewEmbeds.length === 0) return;

    const sourcePath = view.file?.path ?? "";

    for (let i = 0; i < sourceViewEmbeds.length; i++) {
      if (i > 0) await this.yieldToMain();
      const embed = sourceViewEmbeds[i];
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
      const templateBinary = await this.loadTemplateBinary();
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
      await this.openSmmxWithSystemDefaultApp(targetPath);
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
