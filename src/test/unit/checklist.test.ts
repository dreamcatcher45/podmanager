import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// CHECKLIST.md maps every item of the manual test suite to the automated tests that cover it.
// This keeps the file honest: every test it names must still exist in src/test/unit.
const root = path.resolve(__dirname, '../../..');
const checklist = fs.readFileSync(path.join(root, 'CHECKLIST.md'), 'utf8');

function sources(dir: string): string {
    return fs.readdirSync(dir, { withFileTypes: true })
        .map(e => (e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith('.ts') ? fs.readFileSync(path.join(dir, e.name), 'utf8') : ''))
        .join('\n');
}
const testSources = sources(path.join(root, 'src', 'test')).replace(/\\'/g, "'");

const rows = checklist.split('\n').filter(l => l.startsWith('| ☐ |') && !l.includes('| Manual item |') && !l.includes('| Behaviour |'));
const cells = (row: string) => row.split('|').slice(1, -1).map(c => c.trim());
const manualRows = rows.filter(r => cells(r).length === 5);
const extraRows = rows.filter(r => cells(r).length === 4);
const refsOf = (cell: string) => cell.split('<br>').map(r => r.replace(/^[`\s]+|[`\s]+$/g, '')).filter(r => r && !r.startsWith('—'));

suite('CHECKLIST.md stays in sync with the tests', () => {
    test('covers all 65 items of the manual test suite', () => {
        assert.strictEqual(manualRows.length, 65);
    });
    test('every manual item (except the environment prerequisite) names at least one automated test', () => {
        for (const r of manualRows) {
            const c = cells(r);
            if (c[1] === 'Podman CLI + extension installed') { continue; }
            assert.ok(refsOf(c[3]).length > 0, `${c[1]} has no automated test`);
        }
    });
    test('every test named in the checklist exists', () => {
        const missing: string[] = [];
        for (const r of manualRows) { refsOf(cells(r)[3]).forEach(ref => { if (!testSources.includes(ref)) { missing.push(`${cells(r)[1]}: ${ref}`); } }); }
        for (const r of extraRows) { refsOf(cells(r)[2]).forEach(ref => { if (!testSources.includes(ref)) { missing.push(`${cells(r)[1]}: ${ref}`); } }); }
        assert.deepStrictEqual(missing, []);
    });
});
