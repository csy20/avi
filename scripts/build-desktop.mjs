import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('app/src/wasm-pkg/avi_wasm.js')) {
  console.log('avi: building pixel filters (wasm-pack)')
  const built = spawnSync('bash', ['wasm/build.sh'], { stdio: 'inherit' })
  if (built.status !== 0) {
    console.error('avi: wasm/build.sh failed. Install wasm-pack and the wasm32-unknown-unknown target, then retry.')
    process.exit(built.status ?? 1)
  }
}

const built = spawnSync('npm', ['run', 'build:app'], { stdio: 'inherit', shell: true })
process.exit(built.status ?? 1)
