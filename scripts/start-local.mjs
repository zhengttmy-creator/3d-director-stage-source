import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('请安装 Node.js 22 或更新版本：https://nodejs.org/');
  process.exitCode = 1;
} else {
  try {
    const required = ['src/vendor/module-factories.json', 'web/vendor/modules.js', 'web/vendor/locale.js', 'web/assets/character.fbx', 'web/assets/characters/manifest.json', 'web/assets/motions/manifest.json', 'web/assets/poses/manifest.json'];
    const missing = [];
    for (const file of required) {
      try { await fs.access(path.join(root, file)); } catch { missing.push(file); }
    }
    if (missing.length) throw new Error('缺少完整运行资源：\n' + missing.join('\n') + '\n请下载发布页中的 Qihui-Previz-V1.5-Full-Project.zip：\nhttps://github.com/zhengttmy-creator/3d-director-stage-source/releases/tag/v1.5.0');
    const { startDirectorServer } = await import('../web/server.mjs');
    const portArgument = process.argv.slice(2).find(value => /^\d+$/.test(value));
    const requestedPort = portArgument === undefined ? 4202 : Number(portArgument);
    if (requestedPort > 65535) throw new Error('端口必须在 0–65535 之间。');
    let server;
    try { server = await startDirectorServer({ port: requestedPort }); }
    catch (error) {
      if (error.code !== 'EADDRINUSE' || requestedPort === 0) throw error;
      console.log('默认端口已被占用，使用另一个可用端口。');
      server = await startDirectorServer({ port: 0 });
    }
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    console.log('绮绘预演台 V1.5 已启动：' + url);
    console.log('项目数据保存在 web/state；请保持此窗口打开，按 Ctrl+C 停止服务。');
    if (!process.argv.includes('--no-open')) {
      const [command, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
      child.on('error', () => console.log('请在浏览器打开上面的本地地址。'));
      child.unref();
    }
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      server.close(() => process.exit(0));
      server.closeAllConnections();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
