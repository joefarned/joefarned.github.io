import {
	Plugin,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	Editor,
} from "obsidian";
import { TreeChartSettings, DEFAULT_SETTINGS } from "./types";
import { parseBulletList, treeToMarkdown } from "./parser";
import { TreeChartRenderer } from "./renderer";

export default class TreeChartPlugin extends Plugin {
	settings: TreeChartSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadSettings();

		// Register the ```tree-chart code block processor
		this.registerMarkdownCodeBlockProcessor(
			"tree-chart",
			(source, el, ctx) => {
				this.renderTreeChart(source, el, ctx);
			}
		);

		// Command: Convert selection to tree chart
		this.addCommand({
			id: "convert-to-tree-chart",
			name: "Convert bulleted list to tree chart",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection.trim()) {
					new Notice("Select a bulleted list first");
					return;
				}
				const wrapped = "```tree-chart\n" + selection + "\n```";
				editor.replaceSelection(wrapped);
			},
		});

		// Command: Insert sample tree chart
		this.addCommand({
			id: "insert-tree-chart",
			name: "Insert sample tree chart",
			editorCallback: (editor: Editor) => {
				const sample = `\`\`\`tree-chart
- Project
  - Planning
    - Requirements
    - Timeline
    - Resources
  - Development
    - Frontend
      - UI Components
      - Styling
    - Backend
      - API
      - Database
  - Testing
    - Unit Tests
    - Integration
  - Deployment
    - Staging
    - Production
\`\`\``;
				editor.replaceSelection(sample);
			},
		});
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private renderTreeChart(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		const wrapper = el.createDiv({ cls: "tree-chart-wrapper" });

		// Toolbar
		const toolbar = wrapper.createDiv({ cls: "tree-chart-toolbar" });
		this.createToolbar(toolbar, wrapper, source, ctx);

		// Chart container
		const chartEl = wrapper.createDiv({ cls: "tree-chart-view" });
		chartEl.style.height = "500px";

		// Parse and render
		const root = parseBulletList(source);
		const renderer = new TreeChartRenderer(chartEl, root, { ...this.settings }, {
			onUpdate: (markdown: string) => {
				// Update the source in the note
				this.updateSource(ctx, markdown);
			},
		});

		// Store renderer reference for toolbar actions
		(wrapper as any)._renderer = renderer;

		// Add styles
		this.injectStyles();
	}

	private createToolbar(
		toolbar: HTMLElement,
		wrapper: HTMLElement,
		source: string,
		ctx: MarkdownPostProcessorContext
	) {
		toolbar.style.display = "flex";
		toolbar.style.gap = "4px";
		toolbar.style.padding = "6px 8px";
		toolbar.style.borderBottom = "1px solid var(--background-modifier-border, #444)";
		toolbar.style.background = "var(--background-secondary, #2b2b2b)";
		toolbar.style.borderRadius = "8px 8px 0 0";
		toolbar.style.flexWrap = "wrap";
		toolbar.style.alignItems = "center";

		const btnStyle = (btn: HTMLButtonElement) => {
			btn.style.padding = "4px 10px";
			btn.style.fontSize = "12px";
			btn.style.border = "1px solid var(--background-modifier-border, #555)";
			btn.style.borderRadius = "4px";
			btn.style.background = "var(--interactive-normal, #363636)";
			btn.style.color = "var(--text-normal, #ddd)";
			btn.style.cursor = "pointer";
			btn.addEventListener("mouseenter", () => {
				btn.style.background = "var(--interactive-hover, #464646)";
			});
			btn.addEventListener("mouseleave", () => {
				btn.style.background = "var(--interactive-normal, #363636)";
			});
		};

		// Direction toggle
		const dirBtn = toolbar.createEl("button", { text: "Layout: Right →" });
		btnStyle(dirBtn);
		let dirRight = this.settings.direction === "right";
		dirBtn.addEventListener("click", () => {
			dirRight = !dirRight;
			dirBtn.textContent = dirRight ? "Layout: Right →" : "Layout: Down ↓";
			const r = (wrapper as any)._renderer as TreeChartRenderer;
			if (r) r.setDirection(dirRight ? "right" : "down");
		});

		// Expand all
		const expandBtn = toolbar.createEl("button", { text: "Expand All" });
		btnStyle(expandBtn);
		expandBtn.addEventListener("click", () => {
			const r = (wrapper as any)._renderer as TreeChartRenderer;
			if (r) r.expandAll();
		});

		// Collapse all
		const collapseBtn = toolbar.createEl("button", { text: "Collapse All" });
		btnStyle(collapseBtn);
		collapseBtn.addEventListener("click", () => {
			const r = (wrapper as any)._renderer as TreeChartRenderer;
			if (r) r.collapseAll();
		});

		// Fit to view
		const fitBtn = toolbar.createEl("button", { text: "Fit" });
		btnStyle(fitBtn);
		fitBtn.addEventListener("click", () => {
			const r = (wrapper as any)._renderer as TreeChartRenderer;
			if (r) r.fitToView();
		});

		// Copy markdown
		const copyBtn = toolbar.createEl("button", { text: "Copy as Markdown" });
		btnStyle(copyBtn);
		copyBtn.addEventListener("click", () => {
			const r = (wrapper as any)._renderer as TreeChartRenderer;
			if (r) {
				navigator.clipboard.writeText(r.getMarkdown());
				new Notice("Tree copied to clipboard as markdown");
			}
		});

		// Spacer
		const spacer = toolbar.createSpan();
		spacer.style.flex = "1";

		// Help hint
		const hint = toolbar.createSpan({
			text: "Scroll to zoom · Drag canvas to pan · Drag nodes to reparent · Double-click to edit · Right-click for menu",
		});
		hint.style.fontSize = "11px";
		hint.style.color = "var(--text-muted, #888)";
		hint.style.fontStyle = "italic";
	}

	private updateSource(
		ctx: MarkdownPostProcessorContext,
		newMarkdown: string
	) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const editor = view.editor;
		const fullText = editor.getValue();

		// Find the tree-chart code block
		const codeBlockRegex = /```tree-chart\n([\s\S]*?)```/g;
		let match;
		let found = false;

		while ((match = codeBlockRegex.exec(fullText)) !== null) {
			// Check if this is roughly the right block by matching section info
			const start = editor.offsetToPos(match.index + "```tree-chart\n".length);
			const end = editor.offsetToPos(match.index + match[0].length - "```".length);

			editor.replaceRange(newMarkdown, start, end);
			found = true;
			break;
		}
	}

	private stylesInjected = false;
	private injectStyles(): void {
		if (this.stylesInjected) return;
		this.stylesInjected = true;

		const style = document.createElement("style");
		style.textContent = `
			.tree-chart-wrapper {
				border: 1px solid var(--background-modifier-border, #444);
				border-radius: 8px;
				overflow: hidden;
				margin: 8px 0;
			}
			.tree-chart-view {
				background: var(--background-primary, #1e1e1e);
				position: relative;
			}
			.tree-chart-container {
				outline: none;
			}
			.tree-chart-container:focus {
				box-shadow: inset 0 0 0 2px var(--interactive-accent, #4A90D9);
			}
		`;
		document.head.appendChild(style);
	}
}
