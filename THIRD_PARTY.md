# 第三方内容与开源范围

本仓库提供完整运行项目：原创适配代码、已有编译模块及内置运行资源一并保留。仓库的 MIT 许可仅授权原创适配代码；第三方代码、模型、动作、字体和其他素材保留各自来源与适用条款，不因纳入仓库或发行附件而获得新的许可。

## 运行资源

- src/vendor/ 与 web/vendor/：本地已有导演台前端的编译 JavaScript、Worker 和语言文件，不是原站完整 TypeScript 工程；不包含未公开的服务器实现。
- web/assets/：人物、动作、静态姿势、预览图和 WASM。12 种体型由本地人物生成器调整已有 Alpha / Beta 基模的几何与骨骼比例生成，保留基模来源。
- sources/motions/：动作转换的 FBX/GLB 输入与记录，具体来源、固定版本及 SHA-256 见该目录的 README 和 sources.json。来源包括 Three.js 示例、3DCharacter、three.ws 和 Mixamo 相关内容；上游许可各不相同，部分来源没有独立许可证。
- 原站云端本地化 SDK 配置 key 已清空，运行时使用本地语言文件。

## 模型补充包与依赖

150 款模型补充包作为单独 Release 附件提供，模型与预览来源见包内来源清单和安装说明；它不属于原创代码的 MIT 授权范围。包版本 V1.0 与应用 V1.5 的版本各自独立。

Electron、Three.js、Babel、electron-builder 等依赖按照各自许可证提供，依赖版本见 package-lock.json。仓库不包含个人账号、凭据、用户场景或浏览器缓存。使用和再分发第三方内容时，应遵守其适用条款。
