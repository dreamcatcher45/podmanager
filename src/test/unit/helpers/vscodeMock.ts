/* eslint-disable @typescript-eslint/no-explicit-any */
// A small in-memory stand-in for the `vscode` module, so the extension's REAL command
// handlers and tree provider can run under plain mocha. Only the API surface the
// extension uses is implemented. Tests drive it through the exported `ui` object.

export class Uri {
    constructor(public fsPath: string, public scheme = 'file') {}
    static file(p: string) { return new Uri(p); }
    static parse(s: string) { return new Uri(s, 'https'); }
    static joinPath(base: Uri, ...parts: string[]) { return new Uri([base.fsPath.replace(/[\\/]+$/, ''), ...parts].join('/'), base.scheme); }
    toString() { return this.scheme === 'file' ? `file://${this.fsPath}` : this.fsPath; }
}
export class ThemeColor { constructor(public id: string) {} }
export class ThemeIcon { constructor(public id: string, public color?: ThemeColor) {} }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export class TreeItem {
    iconPath?: any; tooltip?: any; command?: any; contextValue?: string; id?: string;
    constructor(public label: any, public collapsibleState?: TreeItemCollapsibleState) {}
}
export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (l: (e: T) => void) => { this.listeners.push(l); return { dispose: () => undefined }; };
    fire(e: T) { this.listeners.forEach(l => l(e)); }
    dispose() { this.listeners = []; }
}
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }

type Pick = (items: any[]) => any;

/** Everything a test can script or inspect. */
export const ui = {
    config: {} as Record<string, any>,
    /** Answers for showInputBox, consumed in order (undefined = user pressed Esc). */
    inputs: [] as Array<string | undefined>,
    prompts: [] as string[],
    /** The `value` (pre-filled text) of each input box shown, in order. */
    prefills: [] as Array<string | undefined>,
    /** Answers for showQuickPick, consumed in order. */
    picks: [] as Pick[],
    /** Answers for the Yes/No style warning and error message buttons, consumed in order. */
    warnAnswers: [] as Array<string | undefined>,
    errorAnswers: [] as Array<string | undefined>,
    defaultWarnAnswer: 'Yes' as string | undefined,
    info: [] as string[],
    warn: [] as string[],
    error: [] as Array<{ message: string; buttons: string[] }>,
    terminals: [] as Array<{ name: string; shellPath?: string; shellArgs?: string[]; shown: boolean }>,
    outputChannels: [] as Array<{ name: string; text: string }>,
    clipboard: '',
    opened: [] as string[],
    executed: [] as Array<{ id: string; args: any[] }>,
    commands: new Map<string, (...a: any[]) => any>(),
    treeViews: new Map<string, any>(),
    /** What findFiles returns: a fixed list, or a function of the glob pattern. */
    findFilesResult: [] as Uri[] | ((glob: string) => Uri[]),
    workspaceFolder: {} as any,
    activeTextEditor: undefined as any,
    /** What showOpenDialog returns (undefined = cancelled) and the options it was called with. */
    openDialogResult: undefined as Uri[] | undefined,
    openDialogOptions: [] as any[],
    /** Documents opened with openTextDocument / showTextDocument. */
    documents: [] as Array<{ content?: string; language?: string; uri?: string }>,
    shownDocuments: 0,
    configListeners: [] as Array<(e: any) => void>,
    treeVisible: true,
    fireConfigChange(key: string) {
        this.configListeners.forEach(l => l({ affectsConfiguration: (k: string) => key === k || key.startsWith(k + '.') }));
    },
    reset() {
        this.config = {}; this.inputs = []; this.prompts = []; this.picks = [];
        this.warnAnswers = []; this.errorAnswers = []; this.defaultWarnAnswer = 'Yes';
        this.info = []; this.warn = []; this.error = []; this.terminals = []; this.outputChannels = [];
        this.clipboard = ''; this.opened = []; this.executed = [];
        this.findFilesResult = []; this.workspaceFolder = {}; this.activeTextEditor = undefined;
        this.prefills = []; this.openDialogResult = undefined; this.openDialogOptions = [];
        this.documents = []; this.shownDocuments = 0; this.treeVisible = true;
    }
};

/** Pick the quick-pick entry whose label (or string value) equals `label`. */
export const pick = (label: string): Pick => items => {
    const found = items.find(i => (typeof i === 'string' ? i : i.label) === label);
    if (!found) { throw new Error(`quick pick has no "${label}"; has: ${items.map(i => (typeof i === 'string' ? i : i.label)).join(', ')}`); }
    return found;
};

export const window = {
    showInformationMessage: async (m: string) => { ui.info.push(m); return undefined; },
    showWarningMessage: async (m: string, ..._b: string[]) => {
        ui.warn.push(m);
        return ui.warnAnswers.length ? ui.warnAnswers.shift() : ui.defaultWarnAnswer;
    },
    showErrorMessage: async (m: string, ...buttons: string[]) => {
        ui.error.push({ message: m, buttons });
        return ui.errorAnswers.shift();
    },
    showInputBox: async (opts: any) => {
        ui.prompts.push(opts?.prompt ?? '');
        ui.prefills.push(opts?.value);
        return ui.inputs.shift();
    },
    showQuickPick: async (items: any[], _opts?: any) => {
        const p = ui.picks.shift();
        return p ? p(items) : undefined;
    },
    createTerminal: (opts: any) => {
        const t = typeof opts === 'string' ? { name: opts } : opts;
        const rec = { name: t.name, shellPath: t.shellPath, shellArgs: t.shellArgs, shown: false };
        ui.terminals.push(rec);
        return { show: () => { rec.shown = true; }, sendText: () => { throw new Error('sendText must not be used'); }, dispose: () => undefined };
    },
    createTreeView: (id: string, opts: any) => {
        ui.treeViews.set(id, opts);
        return { get visible() { return ui.treeVisible; }, dispose: () => undefined };
    },
    showOpenDialog: async (opts: any) => { ui.openDialogOptions.push(opts); return ui.openDialogResult; },
    showTextDocument: async (_doc: any, _opts?: any) => { ui.shownDocuments++; return undefined; },
    createStatusBarItem: () => ({ text: '', show: () => undefined, hide: () => undefined, dispose: () => undefined }),
    createOutputChannel: (name: string) => {
        const rec = { name, text: '' };
        ui.outputChannels.push(rec);
        return { appendLine: (l: string) => { rec.text += l + '\n'; }, append: (t: string) => { rec.text += t; }, clear: () => { rec.text = ''; }, show: () => undefined, dispose: () => undefined };
    },
    setStatusBarMessage: () => ({ dispose: () => undefined }),
    get activeTextEditor() { return ui.activeTextEditor; },
};

export const commands = {
    registerCommand: (id: string, fn: (...a: any[]) => any) => { ui.commands.set(id, fn); return { dispose: () => ui.commands.delete(id) }; },
    executeCommand: async (id: string, ...args: any[]) => {
        ui.executed.push({ id, args });
        const fn = ui.commands.get(id);
        return fn ? fn(...args) : undefined;
    },
    getCommands: async () => [...ui.commands.keys()],
};

export const workspace = {
    getConfiguration: (_section?: string) => ({
        get: (key: string, def?: any) => (key in ui.config ? ui.config[key] : def),
        update: async (key: string, value: any) => { if (value === undefined) { delete ui.config[key]; } else { ui.config[key] = value; } },
        inspect: (_key: string) => undefined,
    }),
    findFiles: async (glob?: any) => (typeof ui.findFilesResult === 'function' ? ui.findFilesResult(String(glob)) : ui.findFilesResult),
    openTextDocument: async (opts: any) => { ui.documents.push({ content: opts.content, language: opts.language, uri: opts instanceof Uri ? opts.fsPath : undefined }); return opts; },
    onDidChangeConfiguration: (listener: (e: any) => void) => {
        ui.configListeners.push(listener);
        return { dispose: () => { ui.configListeners = ui.configListeners.filter(l => l !== listener); } };
    },
    getWorkspaceFolder: () => ui.workspaceFolder,
    asRelativePath: (u: any) => (typeof u === 'string' ? u : u.fsPath),
    get workspaceFolders() { return ui.workspaceFolder ? [ui.workspaceFolder] : undefined; },
};

export const env = {
    clipboard: { writeText: async (t: string) => { ui.clipboard = t; } },
    openExternal: async (u: Uri) => { ui.opened.push(u.toString()); return true; },
};

/** Make `require('vscode')` return this module. Call before loading any extension code. */
export function installVscodeMock(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Module = require('module');
    if (Module.__vscodeMockInstalled) { return; }
    const original = Module._load;
    Module._load = function (request: string, ...rest: any[]) {
        if (request === 'vscode') { return module.exports; }
        return original.call(this, request, ...rest);
    };
    Module.__vscodeMockInstalled = true;
}
