# 绮绘预演台 V1.5 · 完整项目

本仓库包含可编辑的适配代码、编译核心、浏览器运行时、内置人物、动作和姿势资源。现在克隆仓库或选择 **Code → Download ZIP** 即可获得完整项目；浏览器版安装 Node.js 22 或更新版本后即可启动，无需安装 npm 依赖。

当前版本：**1.5.0**。相机采用位置 XYZ 与旋转 XYZ，默认固定、手动记录运镜关键帧；支持独立机位、分层镜头剪辑、骨骼关键帧、动作预览和本地资产管理。详细操作见 [使用教程](docs/user-guide.html)，变更见 [更新记录](CHANGELOG.md)。

## 下载与启动

可以使用当前仓库的 **Code → Download ZIP**、git clone，或下载 [V1.5 完整项目 ZIP](https://github.com/zhengttmy-creator/3d-director-stage-source/releases/download/v1.5.0/Qihui-Previz-V1.5-Full-Project.zip)。历史 v1.5.0 标签的自动 Source code ZIP 仍指向当时的适配层源码；从历史发布页下载时请选择明确标为 Full-Project 的附件。

1. 安装 [Node.js 22 或更新版本](https://nodejs.org/)。
2. 完整解压到可写文件夹，或克隆本仓库。
3. Windows 双击 start-windows.cmd；Mac 双击 start-macos.command。也可在项目目录的终端运行：

```sh
node scripts/start-local.mjs
```

浏览器会自动打开。保持终端运行，按 Ctrl+C 停止服务；默认端口被占用时会自动改用空闲端口。Mac 若不能双击脚本，使用上述终端命令。更多步骤见 [START-HERE.md](START-HERE.md)。

## 资源与补充包

- 仓库内置 12 种人物体型、16 个动态动作和 10 个静态姿势，包含真实预览与运行资源。
- [150 款模型补充包 V1.0（兼容 V1.5）](https://github.com/zhengttmy-creator/3d-director-stage-source/releases/tag/model-pack-v1.0) 单独下载，约 553 MB，不放进 Git 历史。将解压后的 Assets/models 内容放入软件实际使用的资产目录；安装说明与校验值随包提供。
- 首次启动为空白场景。个人项目保存在 web/state/；自定义资产放入 web/state/Assets/ 对应子目录。个人项目、账号、截图、缓存和 npm 依赖不随仓库上传。

## 开发与打包

浏览器运行已有构建不需要以下步骤；修改编译补丁、运行 Electron 或制作发行包时执行：

```sh
npm ci
npm run build
npm start
```

- npm run dist:project：生成完整项目 ZIP 与 SHA-256 清单。
- npm run dist:win:all：Windows 安装版和便携版。
- npm run dist:mac:arm64 -- /path/to/electron-cache：Mac M 系列构建，说明见 [Mac 安装说明](docs/mac-install.html)。
- npm run dist:extension：Edge / Chrome 扩展，说明见 [扩展安装说明](extension/INSTALL.md)。

src/patches/ 为功能适配代码；src/vendor/module-factories.json 为现有编译模块输入；web/vendor/ 为运行时；web/assets/ 为内置资源；sources/motions/ 保存动作转换输入及来源。第三方编译模块不是原站完整 TypeScript 工程，仓库不包含原站云端服务或账号系统。

## 许可与贡献

[MIT LICENSE](LICENSE) 仅适用于本项目原创代码。第三方编译模块、模型、动作、字体和素材保留各自来源及条款，详见 [THIRD_PARTY.md](THIRD_PARTY.md) 和素材来源记录。完整资源的提供不改变其许可范围。

提交问题或补丁时，请勿提交个人项目、浏览器缓存、账号凭据或其他用户数据。
