# DSH 提示词管理-dsh-prompt-easymanager

## 介绍

可以自行选择在全局范围或单独会话中增加个人提示词，或修改系统提示词，辅助不同类型的工作。

## 解决什么问题

DSH 的系统提示词由多个段落组成。这个插件把个人提示词、系统提示词改写和会话选择集中管理：

- 在全局范围为新会话设置默认提示词组合。
- 为单独会话选择不同的提示词组合，或明确不注入自定义提示词。
- 保存个人提示词，按预设启用或停用。
- 在插件自己的副本上改写或关闭 DSH 原生段落，不修改 DSH 自己的文件。
- 系统提示词改写只有在保存到预设并启用后才会注入。

## 安装

使用 DSH 从 GitHub 安装：

```powershell
dsh plugin --profile web add github:XialerMoies/dsh-prompt-easymanager#v0.3.7
```

将 `web` 换成实际使用的 DSH profile 名称。安装或更新完成后重启 DSH Web。

## 注意事项

- 当前版本暂时关闭预览功能，入口会显示“正在回炉重造，敬请期待”，计划在 0.3.8 重新设计。
- 插件只修改自己的数据和提示词副本，不修改 DSH 原生文件。
- 预设、会话选择和提示词库保存在 `$DSH_HOME` 下，升级或卸载插件不会删除这些用户数据。
- 提示词库位于 `$DSH_HOME/prompts/`，状态文件为 `$DSH_HOME/dsh-prompt-easymanager-state.json`。
- 改动插件代码后需要重启 DSH；在插件设置页保存提示词后会立即重新加载并应用。
- 当前已验证的 DSH 版本以 `package.json` 的兼容性声明为准，未列出的版本不保证兼容。

## 开源协议

MIT License
