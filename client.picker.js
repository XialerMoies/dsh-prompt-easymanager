// Picker composition chunk. Component implementations live in focused chunks.
window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.picker.js",
  factory: (require) => {
    var module = { exports: {} };

    function create(api, parts) {
      if (!parts || !parts.shared || !parts.session || !parts.hero) {
        throw new Error("picker parts are not loaded");
      }
      var shared = parts.shared.create(api);
      var session = parts.session.create(api, shared);
      var hero = parts.hero.create(api);
      return {
        PresetDropdown: session.PresetDropdown,
        PromptPicker: session.PromptPicker,
        HeroPresetChip: hero.HeroPresetChip,
        HeroPresetPanel: hero.HeroPresetPanel,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
