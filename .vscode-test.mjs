import { defineConfig } from '@vscode/test-cli';

// Only tests that need a real VS Code live in integration/. Everything else
// (src/test/unit) runs with plain mocha and needs no editor.
export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	// A fake malicious repository: its settings must have no effect.
	workspaceFolder: 'test/fixtures/hostile-workspace',
	// Electron refuses to start its sandbox inside containers; opt in via env.
	launchArgs: process.env.VSCODE_TEST_NO_SANDBOX ? ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'] : [],
});
