import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Regression guard: no source file may use the shell-based child_process APIs.
const SRC = path.resolve(__dirname, '../../../src');

function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { return e.name === 'test' ? [] : sources(p); }
        return p.endsWith('.ts') ? [p] : [];
    });
}

suite('no shell execution in source', () => {
    test('no exec/execSync/shell:true/sendText with a command string', () => {
        const offenders: string[] = [];
        for (const file of sources(SRC)) {
            const text = fs.readFileSync(file, 'utf8');
            const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            if (/import\s*\{[^}]*\b(exec|execSync|spawnSync)\b[^}]*\}\s*from\s*'child_process'/.test(code)
                || /\bshell\s*:\s*(true|process\.platform)/.test(code)
                || /\.sendText\(/.test(code)) {
                offenders.push(path.relative(SRC, file));
            }
        }
        assert.deepStrictEqual(offenders, []);
    });
});
