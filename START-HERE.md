# 绮绘预演台 V1.5 · 完整项目启动说明

本包包含可编辑代码、`src/vendor/module-factories.json`、`web/vendor/` 运行时，以及内置人物、动作和姿势资源。它与 GitHub 自动生成的 **Source code (zip)** 不同；请下载 **Qihui-Previz-V1.5-Full-Project.zip**。

## 第一次使用

1. 安装 [Node.js](https://nodejs.org/) 22 或更新版本；安装后重新打开终端。
2. 将完整 ZIP 解压到一个可写文件夹，保留全部目录结构。不要在压缩包里直接启动。
3. Windows 双击 `start-windows.cmd`；Mac 双击 `start-macos.command`。启动后浏览器自动打开本地地址。Mac 若不能直接打开脚本，可在该文件夹的终端运行下方命令。
4. 保持启动窗口打开。退出时在该窗口按 Ctrl+C。

所有系统也可在项目根目录运行：

```sh
node scripts/start-local.mjs
```

浏览器运行已有构建不需要 `npm install`，不需要重新构建。默认端口 4202 被占用时，启动器会选择空闲端口；以终端显示的地址为准。若登录提示出现，可跳过连接，直接使用本地功能。

## 修改代码与桌面版

需要修改编译补丁或运行 Electron 时，再执行：

```sh
npm ci
npm run build
npm start
```

安装开发依赖需要网络。Windows EXE 与 Mac 应用的构建说明见 `README.md`。本 ZIP 是完整项目，未附带 Node.js、npm 依赖或已经打包的 EXE。

## 项目和资产

- 首次启动为空场景；个人项目保存到 `web/state/`，启动器不会替换已有数据。
- 自己导入的人物、模型、动作和姿势放入 `web/state/Assets/` 对应子文件夹。可在软件资产管理入口查看。
- `web/assets/` 是内置资源，请保留目录结构；另行下载的 150 款模型补充包不包含在本 ZIP 中。
- 转移电脑时，保存场景并另行备份自己的 `web/state/` 和外部资产；此发行包不含作者的个人数据。
- 详细操作和快捷键：`docs/user-guide.html`。

## 资源与许可

第三方编译模块、人物、动作和素材保留各自来源及适用条款，不属于原创适配代码的 MIT 授权。请阅读 `THIRD_PARTY.md` 及 `sources/motions/` 中的来源说明。`FULL-PROJECT-MANIFEST.json` 列出本包文件及 SHA-256 校验值。
