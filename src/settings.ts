import { App, PluginSettingTab, Setting } from "obsidian";
import SimpleMindPreviewPlugin from "./main";

export class SimpleMindSettingsTab extends PluginSettingTab {
  plugin: SimpleMindPreviewPlugin;

  constructor(app: App, plugin: SimpleMindPreviewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable previews")
      .setDesc("Enable rendering .smmx embeds as inline previews.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max preview height")
      .setDesc("Preview container max height in pixels.")
      .addSlider((slider) =>
        slider
          .setLimits(200, 1200, 50)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.maxPreviewHeight)
          .onChange(async (value) => {
            this.plugin.settings.maxPreviewHeight = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default zoom")
      .setDesc("Default render zoom percent.")
      .addSlider((slider) =>
        slider
          .setLimits(30, 200, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.defaultZoom)
          .onChange(async (value) => {
            this.plugin.settings.defaultZoom = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Use SimpleMind palette")
      .setDesc("Use palette colors from the .smmx file.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.usePaletteColors).onChange(async (value) => {
          this.plugin.settings.usePaletteColors = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Template path")
      .setDesc("Vault-relative path to .smmx template used by Create new mindmap command.")
      .addText((text) =>
        text
          .setPlaceholder("assets/template-mindmap.smmx")
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            this.plugin.settings.templatePath = value.trim() || "assets/template-mindmap.smmx";
            await this.plugin.saveSettings();
          })
      );
  }
}
