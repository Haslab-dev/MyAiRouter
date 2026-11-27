#!/usr/bin/env node
/**
 * Cross-platform build & runner script for MyAiRouter (Windows, macOS, Linux).
 * Requires Node.js and Go; does not require `make` or `bash`.
 *
 * Usage:
 *   node scripts/build.mjs                 # build web + host binary
 *   node scripts/build.mjs --all           # build web + all 6 OS/arch binaries in dist/
 *   node scripts/build.mjs --target os/arch[,os/arch]
 *   node scripts/build.mjs --run           # build host binary + start background daemon
 *   node scripts/build.mjs --skip-web      # skip `npm run build` in web/
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const WEB_DIR = path.join(ROOT, 'web')
const DIST_DIR = path.join(ROOT, 'dist')

const ALL_TARGETS = [
  'darwin/amd64',
  'darwin/arm64',
  'linux/amd64',
  'linux/arm64',
  'windows/amd64',
  'windows/arm64',
]

const args = process.argv.slice(2)
const hasFlag = (flag) => args.includes(flag)
const getArgValue = (flag) => {
  const idx = args.indexOf(flag)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`Usage:
  node scripts/build.mjs                 Build frontend + host binary
  node scripts/build.mjs --all           Cross-compile all 6 platforms into dist/
  node scripts/build.mjs --target <list> Comma-separated os/arch (e.g. windows/amd64,linux/amd64)
  node scripts/build.mjs --run           Build host binary and start background daemon
  node scripts/build.mjs --skip-web      Skip frontend build`)
  process.exit(0)
}

function run(cmd, cmdArgs, opts = {}) {
  const isWin = process.platform === 'win32'
  const res = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: 'inherit',
    shell: isWin && (cmd === 'npm' || cmd === 'npx'),
  })
  if (res.error) {
    console.error(`Failed to run ${cmd}: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

function buildFrontend() {
  if (!existsSync(path.join(WEB_DIR, 'node_modules'))) {
    console.log('==> Installing frontend dependencies (web/)...')
    const installCmd = existsSync(path.join(WEB_DIR, 'package-lock.json')) ? ['ci'] : ['install']
    run('npm', installCmd, { cwd: WEB_DIR })
  }
  console.log('==> Building frontend (web/dist)...')
  run('npm', ['run', 'build'], { cwd: WEB_DIR })
}

function buildTarget(target, outPath) {
  const [goos, goarch] = target.split('/')
  if (!goos || !goarch) {
    console.error(`Invalid target "${target}". Expected format: os/arch (e.g. windows/amd64)`)
    process.exit(1)
  }
  console.log(`==> Building ${path.relative(ROOT, outPath)} (${goos}/${goarch})...`)
  run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', outPath, '.'], {
    env: {
      CGO_ENABLED: '0',
      GOOS: goos,
      GOARCH: goarch,
    },
  })
  const mb = (statSync(outPath).size / (1024 * 1024)).toFixed(1)
  console.log(`    OK (${mb} MB)`)
}

if (!hasFlag('--skip-web')) {
  buildFrontend()
}

const targetArg = getArgValue('--target')
if (hasFlag('--all') || targetArg) {
  const targets = hasFlag('--all')
    ? ALL_TARGETS
    : targetArg.split(',').map((t) => t.trim()).filter(Boolean)

  mkdirSync(DIST_DIR, { recursive: true })
  for (const target of targets) {
    const [goos, goarch] = target.split('/')
    const ext = goos === 'windows' ? '.exe' : ''
    const outPath = path.join(DIST_DIR, `myairouter-${goos}-${goarch}${ext}`)
    buildTarget(target, outPath)
  }
  console.log(`\nDone! Binaries written to ${DIST_DIR}`)
} else {
  const hostOS = process.platform === 'win32' ? 'windows' : process.platform
  const hostArch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.arch
  const ext = hostOS === 'windows' ? '.exe' : ''
  const outPath = path.join(ROOT, `myairouter${ext}`)
  buildTarget(`${hostOS}/${hostArch}`, outPath)

  if (hasFlag('--run')) {
    console.log('==> Starting MyAiRouter daemon...')
    run(outPath, ['start'])
  }
}
