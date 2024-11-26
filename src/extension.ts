import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'extension.showChangedFiles';
  context.subscriptions.push(statusBar);

  const updateChangedFilesCount = () => {
    vscode.workspace.findFiles('**').then(files => {
      vscode.commands.executeCommand('git.api', 'find', {}).then((api: any) => {
        const changedFiles = api.repositories.flatMap((repo: any) => repo.state.workingTreeChanges).length;
        statusBar.text = `Files Changed: ${changedFiles}`;
        statusBar.show();
      });
    });
  };

  vscode.commands.registerCommand('extension.showChangedFiles', updateChangedFilesCount);
  vscode.workspace.onDidChangeTextDocument(updateChangedFilesCount);
  vscode.workspace.onDidChangeWorkspaceFolders(updateChangedFilesCount);

  updateChangedFilesCount();
}

export function deactivate() {}
