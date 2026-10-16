# 绮绘预演台 V1.5 · 源码

这是绮绘预演台（3D 导演台）的**原创适配层源码仓库**，用于代码阅读、问题反馈和贡献。仓库刻意不携带第三方编译模块、人物/动作/模型资产或模型补充包；因此它不是下载后即可运行的完整发行包。

当前版本：**1.5.0**。相机统一使用位置 XYZ 与旋转 XYZ，默认固定、手动记录运镜关键帧；新增相机独立控制，支持整体变换打点及折叠轨道中的关键帧编辑。完整变更见 [更新记录](CHANGELOG.md)。

## 下载可运行的完整项目

前往 [V1.5 完整项目发布页](https://github.com/zhengttmy-creator/3d-director-stage-source/releases/tag/v1.5.0)，在 **Assets** 中下载 **Qihui-Previz-V1.5-Full-Project.zip**。该附件包含运行所需的编译核心、`web/vendor/`、12 种人物体型、16 个动作和 10 个姿势；不含个人场景或另行提供的 150 款模型补充包。

解压并安装 Node.js 22 或更新版本后，Windows 双击 `start-windows.cmd`，Mac 双击 `start-macos.command`，或在项目根目录运行 `node scripts/start-local.mjs`。浏览器运行不需要 `npm install`，也不需要重新构建。详细说明见 [START-HERE.md](START-HERE.md)。

**不要选择 GitHub 自动生成的 Source code (zip) / Source code (tar.gz)** 来运行应用：它们仍然只含本仓库的适配层源码。完整项目附件中的第三方内容不适用本仓库原创代码的 MIT 许可，来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 公开范围

公开内容包括：

- 本地界面适配、时间轴、相机剪辑、骨骼关键帧和资产管理代码
- Electron 宿主、浏览器扩展、本地服务器和打包脚本
- 动作/姿势转换器、测试和离线文档

未公开内容包括：

- `src/vendor/` 与 `web/vendor/` 中的已有编译模块
- `web/assets/` 中的人物、动作、姿势和其他运行时资产
- `sources/motions/` 中的 FBX/GLB 源文件
- 150 款模型补充包、应用安装包和构建产物

原创代码的许可范围见 [LICENSE](LICENSE)。第三方来源和资源边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 本地开发

需要 Node.js 22 或更高版本。要运行完整应用，需要先在本地放入你有权使用的运行时模块和资产：

- `src/vendor/module-factories.json`
- `web/vendor/`
- `web/assets/`
- 必要的动作转换输入放在 `sources/motions/`

这些目录已经在 `.gitignore` 中排除，不应提交到源码仓库。准备好本地资源后：

```sh
npm ci
npm run build
node web/server.mjs
```

然后打开 http://127.0.0.1:4202/。桌面封装和浏览器扩展的命令见 `package.json`，离线使用教程见 [`docs/user-guide.html`](docs/user-guide.html)。

## 贡献

提交问题或补丁时，请不要上传个人项目、浏览器数据、账号信息、安装包、模型文件或任何第三方未授权资源。新增第三方依赖或素材前，请在 `THIRD_PARTY.md` 中记录来源、版本、许可证和再分发范围。
