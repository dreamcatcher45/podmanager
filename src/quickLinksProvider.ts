import * as vscode from 'vscode';

export class QuickLinksProvider implements vscode.TreeDataProvider<QuickLinkItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickLinkItem | undefined | null | void> = 
        new vscode.EventEmitter<QuickLinkItem | undefined | null | void>();

    readonly onDidChangeTreeData: vscode.Event<QuickLinkItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: QuickLinkItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QuickLinkItem): Thenable<QuickLinkItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items = [
            new QuickLinkItem(
                'Website',
                'website',
                'Visit the Pod Manager website',
                'https://pod-manager.pages.dev',
                '$(globe)'
            ),
            new QuickLinkItem(
                'Documentation',
                'docs',
                'View the documentation',
                'https://pod-manager.pages.dev/docs',
                '$(book)'
            ),
            new QuickLinkItem(
                'GitHub Repository',
                'github',
                'View the source code on GitHub',
                'https://github.com/dreamcatcher45/podmanager',
                '$(github)'
            ),
            new QuickLinkItem(
                'Issues',
                'issues',
                'Report issues or request features',
                'https://github.com/dreamcatcher45/podmanager/issues',
                '$(issues)'
            ),
            new QuickLinkItem(
                'Settings',
                'settings',
                'Open Podmanager settings',
                'command:workbench.action.openSettings?podmanager',
                '$(settings-gear)'
            ),
            new QuickLinkItem(
                'Star Project',
                'star',
                'Star this project on GitHub',
                'https://github.com/dreamcatcher45/podmanager',
                '$(star)'
            ),
            new QuickLinkItem(
                'Support Project',
                'support',
                'Support this project',
                'https://github.com/dreamcatcher45/podmanager/discussions',
                '$(heart)'
            )
        ];

        return Promise.resolve(items);
    }
}

class QuickLinkItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextValue: string,
        public readonly tooltip: string,
        public readonly url: string,
        iconName: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(iconName.replace('$(', '').replace(')', ''));
        
        if (url.startsWith('command:')) {
            // Handle VS Code commands
            this.command = {
                command: url.split('?')[0].replace('command:', ''),
                title: label,
                arguments: [url.split('?')[1]]
            };
        } else {
            // Handle external URLs
            this.command = {
                command: 'vscode.open',
                title: label,
                arguments: [vscode.Uri.parse(url)]
            };
        }
    }
}
