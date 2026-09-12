// Electron 打包验证：编译产物 → 开发模式启动自检 → 免安装 exe 启动自检。
// 用本机 electron 二进制加载 dist-electron/main.cjs（DS_SMOKE_OUT 触发自检），
// 探针结果由主进程写文件返回，避免依赖 stdout。
// 报告同时写入 _electron_report.txt（UTF-8），规避 PowerShell 管道编码乱码。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const REPORT = resolve(ROOT, '_electron_report.txt');
const lines = [];
let fail = 0;
const say = (s) => {
  lines.push(s);
  console.log(s);
};
const flush = () => writeFileSync(REPORT, lines.join('\n') + '\n', 'utf-8');
const check = (name, cond, detail = '') => {
  if (!cond) fail++;
  say(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

try {
  // —— 1. 编译产物 ——
  const MAIN = resolve(ROOT, 'dist-electron/main.cjs');
  const PRE = resolve(ROOT, 'dist-electron/preload.cjs');
  check('dist-electron/main.cjs 存在', existsSync(MAIN));
  check('dist-electron/preload.cjs 存在', existsSync(PRE));
  if (existsSync(MAIN)) {
    const s = readFileSync(MAIN, 'utf-8');
    check('main.cjs 为 CJS（含 require("electron")）', s.includes('require("electron")'));
    check('main.cjs 指向 dist/index.html', s.includes('"index.html"'));
    check('main.cjs 含启动自检钩子', s.includes('DS_SMOKE_OUT'));
  }
  check('dist/index.html 存在', existsSync(resolve(ROOT, 'dist/index.html')));

  // —— 2. 启动自检（dev / packed 通用）——
  function smokeRun(exePath, args, label) {
    const out = resolve(ROOT, `_smoke_${label}.json`);
    rmSync(out, { force: true });

    // 关键：清掉 ELECTRON_RUN_AS_NODE，否则 electron 会退化成纯 Node 跑主进程，
    // require('electron') 只返回 exe 路径字符串，ipcMain 等全是 undefined。
    const env = { ...process.env, DS_SMOKE_OUT: out };
    delete env.ELECTRON_RUN_AS_NODE;

    const r = spawnSync(exePath, args, { env, timeout: 90_000, encoding: 'utf-8', windowsHide: true });
    if (!existsSync(out)) {
      check(
        `${label} 自检产出结果文件`,
        false,
        `exit=${r.status} stderr=${(r.stderr || '').replace(/\s+/g, ' ').slice(0, 260)}`
      );
      return;
    }
    let data = null;
    try {
      data = JSON.parse(readFileSync(out, 'utf-8'));
    } catch (e) {
      check(`${label} 结果可解析`, false, String(e));
      return;
    }
    check(`${label} 自检通过（渲染层已挂载）`, data.ok === true, JSON.stringify(data.probe ?? data));
    if (data.probe) {
      const p = data.probe;
      say(`     UI: title="${p.title}" elements=${p.elementCount} mermaid=${p.uiMermaid} plantuml=${p.uiPlantUml} flow=${p.uiFlow}`);
    }
    if (data.probe?.fsApi) {
      const f = data.probe.fsApi;
      say(
        `     渲染层能力： saveFilePicker=${f.saveFilePicker} directoryPicker=${f.directoryPicker} ` +
          `indexedDB=${f.indexedDB} secureContext=${f.isSecureContext} origin=${f.origin}`
      );
    }
  }

  const ELECTRON_BIN = resolve(ROOT, 'node_modules/electron/dist/electron.exe');
  check('本机 electron 二进制存在', existsSync(ELECTRON_BIN));
  if (existsSync(ELECTRON_BIN)) smokeRun(ELECTRON_BIN, [MAIN], 'dev');

  // —— 3. 免安装 exe ——
  const UNPACKED = [resolve(ROOT, 'release-build/win-unpacked'), resolve(ROOT, 'release/win-unpacked')].find((p) =>
    existsSync(p)
  );
  if (!UNPACKED) {
    say('SKIP win-unpacked 不存在（先跑 electron-builder --dir）');
  } else {
    say(`     win-unpacked: ${UNPACKED.replace(ROOT + '\\', '')}`);
    const exes = readdirSync(UNPACKED).filter((f) => f.endsWith('.exe'));
    check('win-unpacked 内有可执行文件', exes.length > 0, exes.join(', '));
    if (exes.length) {
      const exe = resolve(UNPACKED, exes[0]);
      const size = statSync(exe).size;
      check('exe 体积合理（>100MB 为 Electron 本体）', size > 100 * 1024 * 1024, `${(size / 1024 / 1024).toFixed(1)} MB`);
      check('win-unpacked/resources/app.asar 存在', existsSync(resolve(UNPACKED, 'resources/app.asar')));
      smokeRun(exe, [], 'packed');
    }
  }

  say('');
  say(fail === 0 ? 'ALL PASS' : `${fail} FAILED`);
  flush();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  say('EXCEPTION ' + String(e));
  flush();
  process.exit(2);
}
