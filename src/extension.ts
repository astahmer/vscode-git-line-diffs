import * as vscode from "vscode";
import type { GitExtension } from "./vscode.git";

const cmdId = "git-line-diffs.openDashboard";

export function activate(context: vscode.ExtensionContext) {
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		0,
	);
	statusBar.command = cmdId;

	const openDashboard = vscode.commands.registerCommand(cmdId, () => {
		const panel = vscode.window.createWebviewPanel(
			"changesDashboard",
			"GitLineDiffs",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
			},
		);
		panel.webview.html = getWebviewContent(
			Array.from(uniqueChanges.values()),
			vscode.window.activeColorTheme.kind,
		);
		panel.webview.onDidReceiveMessage((message) => {
			if (message.command === "openFile") {
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
				const fileUri = vscode.Uri.file(`${workspaceRoot}/${message.filePath}`);
				vscode.window.showTextDocument(fileUri);
			}
		});
	});

	context.subscriptions.push(statusBar);
	context.subscriptions.push(openDashboard);

	let commitSummaries = [] as CommitChanges[];
	const authorChanges = new Map<string, AuthorChanges>();
	const uniqueChanges = new Map<string, FileChange>();

	const updateChangedFilesCount = async () => {
		uniqueChanges.clear();
		authorChanges.clear();
		commitSummaries = [];

		const gitExtension =
			vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
		if (!gitExtension) return;

		const api = gitExtension.getAPI(1);

		let addedLines = 0;
		let removedLines = 0;
		let changedFilesCount = 0;

		for (const repo of api.repositories) {
			changedFilesCount += repo.state.workingTreeChanges.length;

			const logs = await repo.log({ maxEntries: 50, shortStats: true });
			for (const log of logs) {
				commitSummaries.push({
					message: log.message,
					added: log.shortStat?.insertions ?? 0,
					removed: log.shortStat?.deletions ?? 0,
					files: log.shortStat?.files ?? 0,
				});
			}

			for (const change of repo.state.workingTreeChanges) {
				try {
					const diff = await repo.diffWithHEAD(change.uri.fsPath);

					const additions = (diff.match(/^\+.*$/gm) || []).length;
					const deletions = (diff.match(/^\-.*$/gm) || []).length;

					const relativeFilePath = vscode.workspace.asRelativePath(
						change.uri.fsPath,
					);
					if (!uniqueChanges.has(relativeFilePath)) {
						uniqueChanges.set(relativeFilePath, {
							fileName: relativeFilePath,
							added: additions,
							removed: deletions,
						});
					} else {
						// biome-ignore lint/style/noNonNullAssertion: <explanation>
						const existingChange = uniqueChanges.get(relativeFilePath)!;
						existingChange.added += additions;
						existingChange.removed += deletions;
					}

					const log = logs[0];
					const author = log.authorName || "Unknown";
					if (!authorChanges.has(author)) {
						authorChanges.set(author, { added: 0, removed: 0 });
					}

					// biome-ignore lint/style/noNonNullAssertion: <explanation>
					const updates = authorChanges.get(author)!;
					updates.added += additions;
					updates.removed += deletions;

					addedLines += additions;
					removedLines += deletions;
				} catch (error) {
					console.error(`Error getting diff for ${change.uri.fsPath}:`, error);
				}
			}
		}

		statusBar.text = `Files Changed: ${changedFilesCount} (+${addedLines} / -${removedLines})`;
		statusBar.show();
	};

	vscode.workspace.onDidChangeTextDocument(() =>
		updateChangedFilesCount().catch(() => void 0),
	);
	vscode.workspace.onDidChangeWorkspaceFolders(() =>
		updateChangedFilesCount().catch(() => void 0),
	);

	const checkGitAvailability = () => {
		setTimeout(() => {
			if (vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports) {
				updateChangedFilesCount().catch(() => void 0);
			} else {
				checkGitAvailability();
			}
		}, 500);
	};

	checkGitAvailability();

	function getWebviewContent(
		fileChanges: FileChange[],
		themeKind: vscode.ColorThemeKind,
	) {
		const isDarkMode = themeKind === vscode.ColorThemeKind.Dark;
		const textColor = isDarkMode ? "#ffffff" : "#000000";
		const bgColor = isDarkMode ? "#1e1e1e" : "#f3f3f3";
		const borderColor = isDarkMode ? "#333333" : "#dddddd";

		const sortedFileChanges = [...fileChanges].sort(
			(a, b) => b.added + b.removed - (a.added + a.removed),
		);
		const rows = sortedFileChanges
			.map(
				(change) => `
    <tr style="background-color: ${change.added + change.removed > 500 ? (isDarkMode ? "#444444" : "#ffcccc") : "transparent"};">
      <td><a href="#">${change.fileName}</a></td>
      <td style="color: green;">+${change.added}</td>
      <td style="color: red;">-${change.removed}</td>
    </tr>
  `,
			)
			.join("");

		const commitList = commitSummaries
			.map((log) => {
				return `<li>${log.message} (<span style="color: green;">+${log.added}</span> / <span style="color: red;">-${log.removed}</span> in ${log.files} files)</li>`;
			})
			.join("");

		const authorList = Array.from(authorChanges.entries())
			.map(([author, changes]) => {
				return `<li>${author}: <span style="color: green;">+${changes.added}</span> / <span style="color: red;">-${changes.removed}</span></li>`;
			})
			.join("");

		return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: ${bgColor}; color: ${textColor}; }
        h1 { font-size: 1.5em; margin-bottom: 15px; }
        h2 { font-size: 1.25em; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid ${borderColor}; padding: 8px; text-align: left; color: ${textColor}; }
        th { background-color: ${bgColor}; }
        tbody tr:nth-child(even) { background-color: ${isDarkMode ? "#2a2a2a" : "#f9f9f9"}; }
      </style>
    </head>
    <body>
      <div style="display: flex; margin-bottom: 20px;">
        <div style="display: flex; flex-direction: column; width: 50%;">
          <h2>Diffs on last ${commitSummaries.length} commits :</h2>
          <ul style="overflow-y: auto; max-height: 300px;">
            ${commitList}
          </ul>
        </div>
        <div style="display: flex; flex-direction: column; width: 50%;">
          <h2>Contributor Insights:</h2>
          <ul style="overflow-y: auto; max-height: 300px;">
            ${authorList}
          </ul>
        </div>
      </div>
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
    <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('tbody tr').forEach(row => {
          row.addEventListener('click', () => {
            const filePath = row.cells[0].textContent.trim();
            vscode.postMessage({ command: 'openFile', filePath });
          });
        });
      </script>
    </html>
  `;
	}
}

export function deactivate() {
	//
}

interface FileChange {
	fileName: string;
	added: number;
	removed: number;
}
interface CommitChanges {
	message: string;
	added: number;
	removed: number;
	files: number;
}
interface AuthorChanges {
	added: number;
	removed: number;
}
