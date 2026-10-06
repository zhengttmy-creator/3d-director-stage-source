# 动作来源和转换

动作库共 16 个真实动作片段。原有桑巴舞、Mixamo 示例、待机、行走和跑步继续保留。

新增 11 个片段：点头同意、摇头拒绝、向前跳跃、向前翻滚、后撤闪避、站立下蹲、蹲姿起身、俯身潜行、左侧步、右侧步、空中下落。相同动作的变速版和静态姿势不计为新增动作。

## 来源

- `samba.fbx`、`mixamo.fbx`、`soldier.glb` 和 `xbot.glb` 来自 [Three.js 官方示例](https://github.com/mrdoob/three.js/tree/dev/examples/models)。其中 Xbot 只提取 `agree`、`headShake`，不重复加入已有步态。
- 其他 9 个 FBX 来自 [Aaron Snoswell 的 3DCharacter 项目](https://github.com/aaronsnoswell/3DCharacter/tree/1902fb9674350f2b68b5a26b8eccd64570ac8dd4/Mixamo)。上游说明这些是 Mixamo 源动画。新增资源固定 Git commit，下载地址、文件大小和 SHA-256 均记录在 `sources.json`。
- 新增资源下载脚本优先记录原始 GitHub 地址，通过 jsDelivr 的固定 commit 镜像传输。构建会验证本地输入 SHA-256。

这些动画来自第三方示例，不是即梦的动作库。Three.js 的代码许可不等同于对所有第三方模型和动画重新授权；3DCharacter 上游未提供独立许可文件。本项目保留来源，不对这些第三方资源授予新的许可。

## 骨架与根位移

Xbot 使用标准 Mixamo 骨架，忽略未使用的眼球轨道。3DCharacter 的 41 个真实节点与现有身体骨链相同，缺少中指、无名指和小指的 24 个节点；转换仅补充静止参考节点来适配 65 骨接口，未生成这些手指的动画，也未修改身体原始关键帧。

跳跃、翻滚、后闪、潜行和侧步保留原始根位移。预览跟随人物水平位置，方便观察完整动作；原始轨道中的位移仍然保留。空中下落是循环下落姿态，不包括地面起跳或落地。

## 重建与验证

```sh
node src/motions/download-extra-motions.mjs
npm run build:motions
npm run test:motions
```

每个片段均验证：原始场景与序列化场景的位置及旋转一致、65 骨加载、原始导演台重定向器的四肢/脊柱/颈部/头部朝向、全片段有限数值和实际运动。`web/assets/motions/manifest.json` 记录逐片段验证值、增加的参考节点和源文件哈希。
