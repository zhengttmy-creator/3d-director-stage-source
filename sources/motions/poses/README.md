# 静态姿势来源

内置姿势目录为 `web/assets/poses/`，与 16 个动态动作分开。每个预设取自真实 Mixamo 片段的一个时间点，保留身体和手指的原始姿态，水平居中后将同一姿态保存于 0 秒及 1 秒。循环播放不会产生运动。

## 预设对应关系

| 名称 | 源文件 | 采样秒数 |
| --- | --- | --- |
| 自然站立 | 已有 `xbot.glb` 的 `idle` 片段 | 0.4 |
| 下蹲 | 已有 `crouch-down.motion.json` | 1.2 |
| 俯身警戒 | 已有 `sneak.motion.json` | 0.35 |
| 坐地屈膝 | `SittingIdle.fbx` | 1.0 |
| 交腿坐姿 | `FemaleSittingPose.fbx` | 0 |
| 架腿坐姿 | `Male_Sitting_Pose_1.fbx` | 0 |
| 双膝跪姿 | `kneeling idle.fbx` | 1.0 |
| 单膝跪姿指向 | `KneelingPointing.fbx` | 1.3 |
| 椅子坐姿 | `Sitting.fbx` | 0.5 |
| 坐姿鼓掌 | `Sitting Clap.fbx` | 1.1 |

新增源文件来自 [three.ws 的公开源文件](https://github.com/nirholas/three.ws/tree/8866e5471c1e25d41070f1e1992ecc1dbba80f22/animation-sources) 以及同一仓库的 `character-studio/public/lora-assets/animations/`、`character-studio/public/sprite-atlas-assets/animations/`。固定 commit 为 `8866e5471c1e25d41070f1e1992ecc1dbba80f22`。上游将这些 FBX 标识为 Mixamo 动画。实际下载路径、大小、SHA-256 见 `sources.json`。

上游软件仓库使用 Apache-2.0；其第三方 Mixamo 素材的权利归原权利人。本地保留来源，未把这些动作声明为原创或重新授予素材许可。

源名称不直接作为姿态判断。例如 `SittingIdle.fbx` 实际是坐地屈膝，`kneeling idle.fbx` 实际是双膝跪姿。转换时验证髋、膝、踝位置和膝角，将椅子坐姿与下蹲、地坐、跪姿区分。椅子坐姿只包含人体，场景里的座椅需另行摆放。

## 重建和测试

```sh
node src/motions/download-pose-sources.mjs
node src/motions/build-local-poses.mjs
node src/motions/test-pose-presets.mjs
```

动作目录及其 manifest 不会被姿态构建覆盖。新姿态使用现有 `.motion.json` 及同源加载器，逐个通过 65 骨重定向、序列化一致性和全程静止验证。
