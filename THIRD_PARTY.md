# 第三方内容与开源范围

本公开仓库只授权本项目原创源码。第三方代码、编译模块、模型、动作和其他资源没有被本仓库重新授权；它们被有意排除在公开源码仓库之外。使用者需要自行取得相应的来源、使用和再分发许可。

## 不随源码发布的运行时内容

以下路径在完整开发目录中存在，但不进入这个公开仓库：

- `src/vendor/` 与 `web/vendor/`：已有导演台前端的编译 JavaScript 与 Worker
- `web/assets/`：人物模型、动作、姿势、预览图和 WASM 资源
- `sources/motions/` 中的 FBX/GLB 动作输入
- 模型补充包、安装包和其他构建产物

公开仓库保留的转换器、来源说明和测试代码不会自动授予这些资源的许可。

## 已记录的来源

- 部分动作转换记录见 `sources/motions/README.md` 和 `sources/motions/sources.json`。其中包含 Three.js 示例、3DCharacter、three.ws 和 Mixamo 相关内容；上游许可各不相同，且部分源没有独立许可证。
- 人物基模、已有编译模块和绮绘画布相关内容不属于本公开源码仓库的 MIT 授权范围。
- Electron、Three.js、Babel、electron-builder 等依赖按各自 npm 包的许可证提供，安装时请查看 `package-lock.json` 与依赖许可证。

如要分发完整可运行版本，请单独核对每个第三方内容的授权，并将已获授权的文件放入本地排除目录，不要直接提交到这个仓库。
