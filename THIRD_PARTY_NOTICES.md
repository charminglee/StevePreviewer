# 内置资源与接口来源

## Minecraft / Mojang

内置模型与贴图来自 Mojang 官方 [bedrock-samples](https://github.com/Mojang/bedrock-samples) 仓库，固定提交：

`46ba6ea985fb5a92d79a9419198f10dda14c199d`

| 本地文件 | 官方源文件 | SHA-256 |
| --- | --- | --- |
| `assets/steve.geo.json` | [humanoid.custom.geo.json](https://github.com/Mojang/bedrock-samples/blob/46ba6ea985fb5a92d79a9419198f10dda14c199d/resource_pack/models/entity/humanoid.custom.geo.json) | `D3688F959A95F6B39C9BD8B15312A19361256AE161D2D055BA63D810E17A8CA8` |
| `assets/steve.png` | [steve.png](https://github.com/Mojang/bedrock-samples/blob/46ba6ea985fb5a92d79a9419198f10dda14c199d/resource_pack/textures/entity/steve.png) | `86312CB1215F9BF7A734E66791460581764EE12A6B790A5BD27DA716D953BB40` |

原始资源未修改。构建时抽取 `minecraft:geometry` 中的玩家几何，运行时仅转换 Bedrock 与 Blockbench 之间的 X 轴坐标约定，不应用皮肤编辑器的站姿预设。贴图按 64×64 UV 显示。

Minecraft 资源版权归 Mojang AB 所有。原仓库条款要求遵守 [Minecraft EULA](https://www.minecraft.net/en-us/eula)，原文随附于 [`assets/Mojang-LICENSE.md`](assets/Mojang-LICENSE.md)。本插件不是 Mojang 或 Microsoft 官方产品。

## Blockbench 接口核对

目标宿主为 Blockbench 桌面版 5.2.2。以下原始源码只用于核对接口和行为，没有把 Blockbench 的运行库打入插件：

- [Action 与事件注册](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/interface/actions.ts)
- [工具栏](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/interface/toolbars.ts)
- [对话框](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/interface/dialog.ts)
- [Cube 渲染与 UV](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/cube.js)
- [Group 及轨道删除](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/types/group.js)
- [Outliner 标记事件](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/outliner/outliner.js)
- [Bedrock 几何编译](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock.js)
- [Bedrock 动画编译](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bedrock/bedrock_animation.js)
- [工程属性](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/io/project.ts)
- [bbmodel 存储](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/formats/bbmodel.js)
- [Undo](https://github.com/JannisX11/blockbench/blob/v5.2.2/js/undo.js)
