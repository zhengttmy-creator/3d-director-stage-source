# 绮绘预演台 V1.5 浏览器扩展

适用于 Windows 上的 Google Chrome 和 Microsoft Edge 桌面浏览器（Chromium 116 或更高版本）。完整编辑器在独立标签页中运行，无须启动 EXE、本地服务器或 Node.js。内置人物、动作与姿势随扩展提供。

## 安装

1. 将 ZIP 完整解压到固定文件夹。不要从压缩包内直接打开。
2. Edge 地址栏输入 `edge://extensions`；Chrome 输入 `chrome://extensions`。
3. 打开“开发人员模式”。
4. 点击“加载解压缩的扩展”，选择直接包含 `manifest.json` 的文件夹。
5. 在浏览器扩展菜单中固定“绮绘预演台V1.5”，点击图标打开。

这是本地加载版，未发布至扩展商店。无需拖拽 CRX，也无需开启网页数据读取权限。

## 保存和备份

编辑后点击顶部保存或按 `Ctrl+S`。项目、导入动作、姿势、模型和拍摄素材保存于此浏览器的扩展存储中；Edge、Chrome 和桌面版的数据彼此独立。

点击资产栏的文件夹图标进入“本地资产与备份”。先保存当前项目，再点击“导出备份”下载 `.qihui.json`。在另一个浏览器安装后点击“恢复备份”，可迁移项目与导入资产。恢复会替换该浏览器扩展原有数据，请先为已有项目备份。

卸载扩展、删除浏览器配置文件或清除此扩展的数据会删除本地内容。升级时保留此文件夹位置，用新版文件覆盖后在扩展管理页面点击“重新加载”；更新前建议导出备份，不要先卸载。

## 添加自己的资产

创建一个 `Assets` 文件夹，在其中建立以下子目录：

| 子目录 | 内容 |
| --- | --- |
| `characters` | 兼容 Mixamo 骨架的 FBX 人物 |
| `models` | FBX、GLB、GLTF 模型，及其贴图、BIN 文件 |
| `motions` | Mixamo FBX 动作或 `.motion.json` |
| `poses` | 本软件导出的 `.octomotion.json` 姿势 |

点击“本地资产与备份 → 导入资产文件夹”，选择这个 `Assets` 文件夹。文件会复制到浏览器存储，保留子目录关系；外部文件修改后，需要再次导入。浏览器扩展不会自动扫描硬盘目录。GLTF、BIN 和贴图须一同导入；推荐每套模型单独放在子目录中。动作窗口原有的单文件 FBX 和动作备份导入入口也可使用。

## 版本范围

- 保留三轴变换、骨骼动画、动作库、定格接续、多镜头时间轴、删除快捷键和本地截图/视频导出。
- 初始项目为空场景。没有相机时不能拍摄或导出视频。
- 扩展版不连接绮绘画布账号或上传云端。需要云端连接、自动扫描本机资产目录时使用桌面 EXE。
- 3D 视图需要 WebGL2 和可用的图形加速。视频编码受浏览器与显卡支持影响。
- 扩展未包含个人项目、凭据或浏览器登录数据。

开发与来源信息见 `THIRD_PARTY.md`。

官方安装说明：[Edge 本地加载扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading)、[Chrome 加载解压缩扩展](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。
