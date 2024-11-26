import * as vscode from 'vscode';
import type { GitExtension } from './vscode.git';

const debug = false;

interface FileChange {
  fileName: string;
  added: number;
  removed: number;
}

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(statusBar);

  const uniqueChanges = new Map<string, FileChange>();

  const openDashboard = vscode.commands.registerCommand('extension.openDashboard', () => {
    const panel = vscode.window.createWebviewPanel('changesDashboard', 'Changes Dashboard', vscode.ViewColumn.One, {});
    panel.webview.html = getWebviewContent(Array.from(uniqueChanges.values()), vscode.window.activeColorTheme.kind);
    panel.webview.onDidReceiveMessage(message => {
      if (message.command === 'openFile') {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const fileUri = vscode.Uri.file(`${workspaceRoot}/${message.filePath}`);
        vscode.window.showTextDocument(fileUri);
      }
    });
  });

  statusBar.command = 'extension.openDashboard';

  const updateChangedFilesCount = async () => {
    uniqueChanges.clear(); // Reset file changes
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
    if (!gitExtension) {
      debug && console.log('Git extension is not available.');
      return;
    }

    const api = gitExtension.getAPI(1);
    let addedLines = 0;
    let removedLines = 0;
    let changedFilesCount = 0;

    for (let repo of api.repositories) {
      changedFilesCount += repo.state.workingTreeChanges.length;

      for (let change of repo.state.workingTreeChanges) {
        debug && console.log(`Processing change: ${change.uri.fsPath}`);
        try {
          const diff = await repo.diffWithHEAD(change.uri.fsPath);
          debug && console.log(`Diff for ${change.uri.fsPath}:\n${diff}`);
          const additions = (diff.match(/^\+.*$/gm) || []).length;
          const deletions = (diff.match(/^\-.*$/gm) || []).length;
          debug && console.log(`Additions: ${additions}, Deletions: ${deletions}`);

          const relativeFilePath = vscode.workspace.asRelativePath(change.uri.fsPath);

          if (!uniqueChanges.has(relativeFilePath)) {
            uniqueChanges.set(relativeFilePath, { fileName: relativeFilePath, added: additions, removed: deletions });
          } else {
            const existingChange = uniqueChanges.get(relativeFilePath)!;
            existingChange.added += additions;
            existingChange.removed += deletions;
          }

          addedLines += additions;
          removedLines += deletions;
        } catch (error) {
          console.error(`Error getting diff for ${change.uri.fsPath}:`, error);
        }
      }
    }
    debug && console.log(`Total changed files: ${changedFilesCount}, Added lines: ${addedLines}, Removed lines: ${removedLines}`);
    statusBar.text = `Files Changed: ${changedFilesCount} | +${addedLines} / -${removedLines}`;
    statusBar.show();
  };

  context.subscriptions.push(openDashboard);
  vscode.workspace.onDidChangeTextDocument(() => updateChangedFilesCount().catch(() => void 0));
  vscode.workspace.onDidChangeWorkspaceFolders(() => updateChangedFilesCount().catch(() => void 0));

  const checkGitAvailability = () => {
    setTimeout(() => {
      if (vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports) {
        updateChangedFilesCount().catch(() => void 0);
      } else {
        checkGitAvailability();
      }
    }, 500);
  };

  checkGitAvailability();
}

function getWebviewContent(fileChanges: FileChange[], themeKind: vscode.ColorThemeKind) {
  const isDarkMode = themeKind === vscode.ColorThemeKind.Dark;
  const textColor = isDarkMode ? '#ffffff' : '#000000';
  const bgColor = isDarkMode ? '#1e1e1e' : '#f3f3f3';
  const borderColor = isDarkMode ? '#333333' : '#dddddd';

  const rows = fileChanges.map(change => `
    <tr>
      <td>${change.fileName}</td>
      <td style="color: green;">+${change.added}</td>
      <td style="color: red;">-${change.removed}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: ${bgColor}; color: ${textColor}; }
        h1 { font-size: 1.5em; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid ${borderColor}; padding: 8px; text-align: left; color: ${textColor}; }
        th { background-color: ${bgColor}; }
        tbody tr:nth-child(even) { background-color: ${isDarkMode ? '#2a2a2a' : '#f9f9f9'}; }
      </style>
      <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('tr').forEach(row => {
          row.addEventListener('click', () => {
            const filePath = row.querySelector('td').textContent;
            vscode.postMessage({ command: 'openFile', filePath });
          });
        });
      </script>
    </head>
    <body>
      <h1>Changes Breakdown</h1>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Added</th>
            <th>Removed</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </body>
    </html>
  `;
}

export function deactivate() { }
