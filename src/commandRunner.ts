import { execFile, ExecFileOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Shell-free command execution.
 *
 * Every command is run with execFile (executable + argument array), so no
 * shell ever parses the input and characters such as ; & | $( ) ` " ' < >
 * have no special meaning. This module deliberately does not import `vscode`
 * so it can be unit-tested with plain Node.
 */

export interface CommandResult {
    stdout: string;
    stderr: string;
}

const MAX_BUFFER = 64 * 1024 * 1024;

export function runCommand(file: string, args: string[], options: ExecFileOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        // `shell` is forced off so a caller can never re-enable shell parsing.
        execFile(file, args, { maxBuffer: MAX_BUFFER, ...options, shell: false, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                // Mirror promisify(exec): keep stdout/stderr on the error object.
                Object.assign(error, { stdout: String(stdout), stderr: String(stderr) });
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

/**
 * Rejects values that are unsafe to pass as a positional argument or as the
 * value of an option: empty, option-like (leading "-"), or containing control
 * characters (NUL, newlines).
 */
export function assertSafeArg(value: string, label = 'value'): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid ${label}: must not be empty.`);
    }
    if (value.startsWith('-')) {
        throw new Error(`Invalid ${label} "${value}": must not start with "-".`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error(`Invalid ${label}: contains control characters.`);
    }
    return value;
}

/** Podman machine names: letters, digits, "_", "." and "-", not starting with "-". */
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function assertValidMachineName(name: string): string {
    if (!MACHINE_NAME.test(name)) {
        throw new Error(`Invalid Podman machine name "${name}". Use letters, digits, "_", "." and "-".`);
    }
    return name;
}

export interface ParsedExecutable {
    /** The program to spawn (first token). */
    file: string;
    /** Extra leading arguments from the setting, e.g. ["--host", "podman"] for "flatpak-spawn --host podman". */
    prefixArgs: string[];
    /** All tokens of the setting except any "--remote" flag. */
    tokens: string[];
    /** True when the setting contained a "--remote" flag (legacy behaviour). */
    remote: boolean;
}

/**
 * What a shell used to do for these settings, minus anything that runs code: a leading `~` becomes the
 * home directory and `$VAR`, `${VAR}` (and `%VAR%` on Windows) become the variable's value. Unknown
 * variables are left as written. `$(...)` and backticks are NOT supported and stay literal.
 */
export function expandToken(
    token: string,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
    platform: NodeJS.Platform = process.platform
): string {
    let result = token;
    if (result === '~' || result.startsWith('~/') || (platform === 'win32' && result.startsWith('~\\'))) {
        result = home + result.slice(1);
    }
    result = result.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced, bare) => env[braced || bare] ?? match);
    if (platform === 'win32') {
        result = result.replace(/%([^%]+)%/g, (match, name) => env[name] ?? match);
    }
    return result;
}

/**
 * Splits a command-line style setting into tokens WITHOUT involving a shell.
 * Understands "double" and 'single' quotes only (no escapes), so Windows paths keep
 * their backslashes. Each token then gets `~` / `$VAR` substitution (see expandToken). If the whole string is an existing
 * file (e.g. an unquoted "C:\\Program Files\\...\\podman.exe") it is one token.
 */
export function splitCommandLine(value: string, fileExists: (p: string) => boolean = fs.existsSync): string[] {
    const trimmed = (value ?? '').trim();
    if (trimmed.length === 0) {
        throw new Error('Executable setting must not be empty.');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
        throw new Error('Executable setting contains control characters.');
    }
    if (fileExists(trimmed)) {
        return [trimmed];
    }
    const expandedWhole = expandToken(trimmed);
    if (expandedWhole !== trimmed && fileExists(expandedWhole)) {
        return [expandedWhole];
    }
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let inToken = false;
    for (const ch of trimmed) {
        if (quote) {
            if (ch === quote) { quote = null; } else { current += ch; }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            inToken = true;
        } else if (/\s/.test(ch)) {
            if (inToken) { tokens.push(current); current = ''; inToken = false; }
        } else {
            current += ch;
            inToken = true;
        }
    }
    if (quote) {
        throw new Error('Executable setting has an unterminated quote.');
    }
    if (inToken) { tokens.push(current); }
    return tokens.map(t => expandToken(t));
}

/**
 * podmanPath / composePath historically accepted a command line such as
 * "flatpak-spawn --host podman", "sudo podman" or "podman --remote". Keep that
 * working: the first token is the program, the rest are leading arguments.
 * These settings are machine-scoped (user-only), and nothing is ever handed to a shell.
 */
export function parseExecutableSetting(value: string, fileExists: (p: string) => boolean = fs.existsSync): ParsedExecutable {
    const all = splitCommandLine(value, fileExists);
    const remote = all.includes('--remote');
    const tokens = all.filter(t => t !== '--remote');
    if (tokens.length === 0) {
        throw new Error('Executable setting must name a program.');
    }
    return { file: tokens[0], prefixArgs: tokens.slice(1), tokens, remote };
}

/**
 * How to open an interactive terminal running `file args` so that the terminal
 * stays open afterwards (as it did when the command was typed into a shell),
 * without ever building a command string. On POSIX the program and arguments
 * are positional parameters of `sh -c '"$@"; exec $SHELL'`, which are never re-parsed.
 */
export function terminalLaunch(file: string, args: string[], platform: NodeJS.Platform = process.platform): { shellPath: string; shellArgs: string[] } {
    if (platform === 'win32') {
        return { shellPath: file, shellArgs: args };
    }
    return {
        shellPath: '/bin/sh',
        shellArgs: ['-c', '"$@"; exec "${SHELL:-/bin/sh}"', 'podmanager', file, ...args]
    };
}

/**
 * Human-readable rendering of a command, for "Copy Command" in error
 * notifications ONLY. It is never executed.
 */
export function formatCommand(file: string, args: string[], platform: NodeJS.Platform = process.platform): string {
    const quote = (s: string): string => {
        if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s)) {
            return s;
        }
        return platform === 'win32'
            ? `"${s.replace(/"/g, '\\"')}"`
            : `'${s.replace(/'/g, `'\\''`)}'`;
    };
    return [file, ...args].map(quote).join(' ');
}
