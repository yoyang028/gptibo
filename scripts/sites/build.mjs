import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform === 'win32' && !/^D:\\/i.test(root)) throw new Error('Build outputs must stay on D:')
const temporary = path.join(root, 'artifacts/sites/tmp')
fs.mkdirSync(temporary, { recursive: true })
process.env.TEMP = temporary; process.env.TMP = temporary
for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.worker.json']]) execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'artifacts/sites/platform/dist'], { cwd: root, stdio: 'inherit', windowsHide: true })
