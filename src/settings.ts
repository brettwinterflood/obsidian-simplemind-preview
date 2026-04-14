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
      .setName("Node theme")
      .setDesc("Choose whether nodes render with pastel fills or outline-only style.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("pastel", "Pastel fill")
          .addOption("outline", "Outline")
          .setValue(this.plugin.settings.nodeTheme)
          .onChange(async (value) => {
            this.plugin.settings.nodeTheme = value as "pastel" | "outline";
            await this.plugin.saveSettings();
          })
      );
  }
}
