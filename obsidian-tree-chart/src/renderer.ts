import { TreeNode, TreeChartSettings, BRANCH_COLORS } from "./types";
import { layoutTree } from "./layout";
import {
	findNode,
	findParent,
	removeNode,
	treeToMarkdown,
} from "./parser";

export interface TreeChartCallbacks {
	onUpdate?: (markdown: string) => void;
}

export class TreeChartRenderer {
	private container: HTMLElement;
	private svg: SVGSVGElement;
	private mainGroup: SVGGElement;
	private root: TreeNode;
	private settings: TreeChartSettings;
	private callbacks: TreeChartCallbacks;

	// Pan & zoom state
	private viewX = 0;
	private viewY = 0;
	private scale = 1;
	private isPanning = false;
	private panStartX = 0;
	private panStartY = 0;
	private panStartViewX = 0;
	private panStartViewY = 0;

	// Drag state
	private dragNode: TreeNode | null = null;
	private dragGhost: SVGGElement | null = null;
	private dragStartX = 0;
	private dragStartY = 0;
	private isDragging = false;

	// Selection
	private selectedNodeId: string | null = null;

	// Context menu
	private contextMenu: HTMLDivElement | null = null;

	constructor(
		container: HTMLElement,
		root: TreeNode,
		settings: TreeChartSettings,
		callbacks: TreeChartCallbacks = {}
	) {
		this.container = container;
		this.root = root;
		this.settings = settings;
		this.callbacks = callbacks;

		this.container.addClass("tree-chart-container");
		this.container.style.position = "relative";
		this.container.style.overflow = "hidden";
		this.container.style.width = "100%";
		this.container.style.minHeight = "400px";
		this.container.style.cursor = "grab";
		this.container.tabIndex = 0;

		// Create SVG
		this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		this.svg.setAttribute("width", "100%");
		this.svg.setAttribute("height", "100%");
		this.svg.style.position = "absolute";
		this.svg.style.top = "0";
		this.svg.style.left = "0";
		this.container.appendChild(this.svg);

		this.mainGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
		this.svg.appendChild(this.mainGroup);

		this.bindEvents();
		this.render();
		this.fitToView();
	}

	destroy(): void {
		this.removeContextMenu();
		this.container.empty();
	}

	private bindEvents(): void {
		// Pan
		this.container.addEventListener("mousedown", (e) => this.onMouseDown(e));
		this.container.addEventListener("mousemove", (e) => this.onMouseMove(e));
		this.container.addEventListener("mouseup", (e) => this.onMouseUp(e));
		this.container.addEventListener("mouseleave", () => this.onMouseLeave());

		// Zoom
		this.container.addEventListener("wheel", (e) => this.onWheel(e), {
			passive: false,
		});

		// Keyboard
		this.container.addEventListener("keydown", (e) => this.onKeyDown(e));

		// Touch support
		let lastTouchDist = 0;
		this.container.addEventListener("touchstart", (e) => {
			if (e.touches.length === 1) {
				const t = e.touches[0];
				this.panStartX = t.clientX;
				this.panStartY = t.clientY;
				this.panStartViewX = this.viewX;
				this.panStartViewY = this.viewY;
				this.isPanning = true;
			} else if (e.touches.length === 2) {
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				lastTouchDist = Math.sqrt(dx * dx + dy * dy);
			}
		});

		this.container.addEventListener("touchmove", (e) => {
			e.preventDefault();
			if (e.touches.length === 1 && this.isPanning) {
				const t = e.touches[0];
				this.viewX = this.panStartViewX + (t.clientX - this.panStartX);
				this.viewY = this.panStartViewY + (t.clientY - this.panStartY);
				this.updateTransform();
			} else if (e.touches.length === 2) {
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (lastTouchDist > 0) {
					const factor = dist / lastTouchDist;
					this.scale = Math.min(3, Math.max(0.1, this.scale * factor));
					this.updateTransform();
				}
				lastTouchDist = dist;
			}
		}, { passive: false });

		this.container.addEventListener("touchend", () => {
			this.isPanning = false;
			lastTouchDist = 0;
		});
	}

	private onMouseDown(e: MouseEvent): void {
		if (e.button === 2) return; // right click handled separately
		if (e.button !== 0) return;

		// Check if clicking on a node — if so, don't start panning
		const target = e.target as SVGElement;
		const nodeGroup = target.closest("[data-node-id]") as SVGElement | null;

		if (nodeGroup) {
			const nodeId = nodeGroup.getAttribute("data-node-id")!;
			this.selectNode(nodeId);

			// Start potential drag
			this.dragNode = findNode(this.root, nodeId);
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;
			this.isDragging = false;
			e.stopPropagation();
			return;
		}

		// Start panning
		this.isPanning = true;
		this.panStartX = e.clientX;
		this.panStartY = e.clientY;
		this.panStartViewX = this.viewX;
		this.panStartViewY = this.viewY;
		this.container.style.cursor = "grabbing";

		this.removeContextMenu();
		this.selectedNodeId = null;
		this.render();
	}

	private onMouseMove(e: MouseEvent): void {
		if (this.isPanning) {
			this.viewX = this.panStartViewX + (e.clientX - this.panStartX);
			this.viewY = this.panStartViewY + (e.clientY - this.panStartY);
			this.updateTransform();
			return;
		}

		// Drag node
		if (this.dragNode) {
			const dx = e.clientX - this.dragStartX;
			const dy = e.clientY - this.dragStartY;
			if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
				this.isDragging = true;
				this.createDragGhost();
			}
			if (this.isDragging && this.dragGhost) {
				const svgX = (e.clientX - this.container.getBoundingClientRect().left - this.viewX) / this.scale;
				const svgY = (e.clientY - this.container.getBoundingClientRect().top - this.viewY) / this.scale;
				this.dragGhost.setAttribute(
					"transform",
					`translate(${svgX - this.dragNode!.width / 2}, ${svgY - this.dragNode!.height / 2})`
				);

				// Highlight potential drop target
				this.highlightDropTarget(svgX, svgY);
			}
		}
	}

	private onMouseUp(e: MouseEvent): void {
		if (this.isPanning) {
			this.isPanning = false;
			this.container.style.cursor = "grab";
			return;
		}

		if (this.isDragging && this.dragNode) {
			const svgX = (e.clientX - this.container.getBoundingClientRect().left - this.viewX) / this.scale;
			const svgY = (e.clientY - this.container.getBoundingClientRect().top - this.viewY) / this.scale;
			this.dropNode(svgX, svgY);
		}

		this.dragNode = null;
		this.isDragging = false;
		this.removeDragGhost();
	}

	private onMouseLeave(): void {
		this.isPanning = false;
		this.container.style.cursor = "grab";
		this.dragNode = null;
		this.isDragging = false;
		this.removeDragGhost();
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const rect = this.container.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const oldScale = this.scale;
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		this.scale = Math.min(3, Math.max(0.1, this.scale * delta));

		// Zoom toward mouse position
		this.viewX = mouseX - (mouseX - this.viewX) * (this.scale / oldScale);
		this.viewY = mouseY - (mouseY - this.viewY) * (this.scale / oldScale);

		this.updateTransform();
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (!this.selectedNodeId) return;

		const node = findNode(this.root, this.selectedNodeId);
		if (!node) return;

		switch (e.key) {
			case "Tab": {
				// Add child
				e.preventDefault();
				this.addChild(node);
				break;
			}
			case "Enter": {
				// Add sibling
				e.preventDefault();
				if (e.shiftKey) {
					// Edit current node
					this.startEditing(node);
				} else {
					this.addSibling(node);
				}
				break;
			}
			case "Delete":
			case "Backspace": {
				// Delete node (unless root)
				e.preventDefault();
				if (node.id !== this.root.id) {
					this.deleteNode(node);
				}
				break;
			}
			case " ": {
				// Toggle collapse
				e.preventDefault();
				if (node.children.length > 0) {
					node.collapsed = !node.collapsed;
					this.render();
					this.notifyUpdate();
				}
				break;
			}
			case "F2": {
				e.preventDefault();
				this.startEditing(node);
				break;
			}
		}
	}

	private updateTransform(): void {
		this.mainGroup.setAttribute(
			"transform",
			`translate(${this.viewX}, ${this.viewY}) scale(${this.scale})`
		);
	}

	fitToView(): void {
		const rect = this.container.getBoundingClientRect();
		const bounds = this.getTreeBounds();
		if (!bounds) return;

		const padding = 60;
		const treeW = bounds.maxX - bounds.minX + padding * 2;
		const treeH = bounds.maxY - bounds.minY + padding * 2;

		const scaleX = rect.width / treeW;
		const scaleY = rect.height / treeH;
		this.scale = Math.min(1, Math.min(scaleX, scaleY));

		this.viewX = (rect.width - treeW * this.scale) / 2 - bounds.minX * this.scale + padding * this.scale;
		this.viewY = (rect.height - treeH * this.scale) / 2 - bounds.minY * this.scale + padding * this.scale;

		this.updateTransform();
	}

	private getTreeBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const visit = (node: TreeNode) => {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.width);
			maxY = Math.max(maxY, node.y + node.height);
			if (!node.collapsed) {
				for (const c of node.children) visit(c);
			}
		};
		visit(this.root);
		if (minX === Infinity) return null;
		return { minX, minY, maxX, maxY };
	}

	// ─── Rendering ──────────────────────────────────────────────

	render(): void {
		layoutTree(this.root, this.settings);

		// Clear
		while (this.mainGroup.firstChild) {
			this.mainGroup.removeChild(this.mainGroup.firstChild);
		}

		// Draw edges first (behind nodes)
		this.drawEdges(this.root);

		// Draw nodes
		this.drawNodes(this.root);

		this.updateTransform();
	}

	private drawEdges(node: TreeNode): void {
		if (node.collapsed) return;

		for (const child of node.children) {
			const path = this.createEdgePath(node, child);
			path.setAttribute("stroke", child.color);
			path.setAttribute("stroke-width", "2");
			path.setAttribute("fill", "none");
			path.setAttribute("stroke-opacity", "0.7");
			this.mainGroup.appendChild(path);

			this.drawEdges(child);
		}
	}

	private createEdgePath(parent: TreeNode, child: TreeNode): SVGPathElement {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

		if (this.settings.direction === "right") {
			const startX = parent.x + parent.width;
			const startY = parent.y + parent.height / 2;
			const endX = child.x;
			const endY = child.y + child.height / 2;
			const midX = (startX + endX) / 2;

			path.setAttribute(
				"d",
				`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
			);
		} else {
			const startX = parent.x + parent.width / 2;
			const startY = parent.y + parent.height;
			const endX = child.x + child.width / 2;
			const endY = child.y;
			const midY = (startY + endY) / 2;

			path.setAttribute(
				"d",
				`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
			);
		}

		return path;
	}

	private drawNodes(node: TreeNode): void {
		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		g.setAttribute("data-node-id", node.id);
		g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
		g.style.cursor = "pointer";

		const isSelected = node.id === this.selectedNodeId;
		const isRoot = node.id === this.root.id;

		// Node background
		const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rect.setAttribute("width", String(node.width));
		rect.setAttribute("height", String(node.height));
		rect.setAttribute("rx", "6");
		rect.setAttribute("ry", "6");
		rect.setAttribute("fill", isRoot ? node.color : this.adjustColor(node.color, 0.15));
		rect.setAttribute("stroke", isSelected ? "#fff" : node.color);
		rect.setAttribute("stroke-width", isSelected ? "3" : "1.5");
		if (isSelected) {
			rect.setAttribute("filter", "url(#glow)");
		}
		g.appendChild(rect);

		// Node text
		const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
		text.setAttribute("x", String(node.width / 2));
		text.setAttribute("y", String(node.height / 2));
		text.setAttribute("text-anchor", "middle");
		text.setAttribute("dominant-baseline", "central");
		text.setAttribute("fill", isRoot ? "#fff" : "var(--text-normal, #ddd)");
		text.setAttribute("font-size", String(this.settings.fontSize));
		text.setAttribute("font-family", "var(--font-text, -apple-system, sans-serif)");
		text.textContent = node.text;
		g.appendChild(text);

		// Collapse/expand indicator
		if (node.children.length > 0) {
			const indicator = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			if (this.settings.direction === "right") {
				indicator.setAttribute("cx", String(node.width));
				indicator.setAttribute("cy", String(node.height / 2));
			} else {
				indicator.setAttribute("cx", String(node.width / 2));
				indicator.setAttribute("cy", String(node.height));
			}
			indicator.setAttribute("r", "8");
			indicator.setAttribute("fill", node.color);
			indicator.setAttribute("stroke", "#fff");
			indicator.setAttribute("stroke-width", "1.5");
			indicator.style.cursor = "pointer";

			const countText = document.createElementNS("http://www.w3.org/2000/svg", "text");
			if (this.settings.direction === "right") {
				countText.setAttribute("x", String(node.width));
				countText.setAttribute("y", String(node.height / 2));
			} else {
				countText.setAttribute("x", String(node.width / 2));
				countText.setAttribute("y", String(node.height));
			}
			countText.setAttribute("text-anchor", "middle");
			countText.setAttribute("dominant-baseline", "central");
			countText.setAttribute("fill", "#fff");
			countText.setAttribute("font-size", "10");
			countText.setAttribute("font-weight", "bold");
			countText.textContent = node.collapsed
				? String(node.children.length)
				: "−";
			countText.style.pointerEvents = "none";

			indicator.addEventListener("click", (e) => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;
				this.render();
			});

			g.appendChild(indicator);
			g.appendChild(countText);
		}

		// Double-click to edit
		g.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			this.startEditing(node);
		});

		// Right-click context menu
		g.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.selectNode(node.id);
			this.showContextMenu(e.clientX, e.clientY, node);
		});

		this.mainGroup.appendChild(g);

		// Add glow filter (once)
		if (!this.svg.querySelector("#glow")) {
			const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
			const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
			filter.setAttribute("id", "glow");
			const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
			blur.setAttribute("stdDeviation", "3");
			blur.setAttribute("result", "coloredBlur");
			const merge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
			const mergeNode1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
			mergeNode1.setAttribute("in", "coloredBlur");
			const mergeNode2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
			mergeNode2.setAttribute("in", "SourceGraphic");
			merge.appendChild(mergeNode1);
			merge.appendChild(mergeNode2);
			filter.appendChild(blur);
			filter.appendChild(merge);
			defs.appendChild(filter);
			this.svg.insertBefore(defs, this.svg.firstChild);
		}

		// Recurse
		if (!node.collapsed) {
			for (const child of node.children) {
				this.drawNodes(child);
			}
		}
	}

	private adjustColor(hex: string, opacity: number): string {
		// Return the color with reduced opacity
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}

	// ─── Selection ──────────────────────────────────────────────

	private selectNode(id: string): void {
		this.selectedNodeId = id;
		this.render();
	}

	// ─── Inline Editing ─────────────────────────────────────────

	private startEditing(node: TreeNode): void {
		const rect = this.container.getBoundingClientRect();
		const nodeScreenX = node.x * this.scale + this.viewX + rect.left;
		const nodeScreenY = node.y * this.scale + this.viewY + rect.top;

		const input = document.createElement("input");
		input.type = "text";
		input.value = node.text;
		input.style.position = "fixed";
		input.style.left = `${nodeScreenX}px`;
		input.style.top = `${nodeScreenY}px`;
		input.style.width = `${node.width * this.scale}px`;
		input.style.height = `${node.height * this.scale}px`;
		input.style.fontSize = `${this.settings.fontSize * this.scale}px`;
		input.style.padding = "0 8px";
		input.style.border = "2px solid " + node.color;
		input.style.borderRadius = "6px";
		input.style.background = "var(--background-primary, #1e1e1e)";
		input.style.color = "var(--text-normal, #ddd)";
		input.style.outline = "none";
		input.style.zIndex = "1000";
		input.style.textAlign = "center";
		input.style.boxSizing = "border-box";

		document.body.appendChild(input);
		input.focus();
		input.select();

		const finish = () => {
			const newText = input.value.trim();
			if (newText && newText !== node.text) {
				node.text = newText;
				this.render();
				this.notifyUpdate();
			}
			input.remove();
		};

		input.addEventListener("blur", finish);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				input.blur();
			} else if (e.key === "Escape") {
				input.value = node.text; // revert
				input.blur();
			}
		});
	}

	// ─── Context Menu ───────────────────────────────────────────

	private showContextMenu(clientX: number, clientY: number, node: TreeNode): void {
		this.removeContextMenu();

		const menu = document.createElement("div");
		menu.className = "tree-chart-context-menu";
		menu.style.position = "fixed";
		menu.style.left = `${clientX}px`;
		menu.style.top = `${clientY}px`;
		menu.style.zIndex = "10000";
		menu.style.background = "var(--background-secondary, #2b2b2b)";
		menu.style.border = "1px solid var(--background-modifier-border, #444)";
		menu.style.borderRadius = "6px";
		menu.style.padding = "4px 0";
		menu.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)";
		menu.style.minWidth = "160px";

		const items: { label: string; action: () => void; disabled?: boolean }[] = [
			{
				label: "Edit (F2)",
				action: () => this.startEditing(node),
			},
			{
				label: "Add Child (Tab)",
				action: () => this.addChild(node),
			},
			{
				label: "Add Sibling (Enter)",
				action: () => this.addSibling(node),
				disabled: node.id === this.root.id,
			},
			{
				label: node.collapsed ? "Expand" : "Collapse",
				action: () => {
					node.collapsed = !node.collapsed;
					this.render();
				},
				disabled: node.children.length === 0,
			},
			{
				label: "Change Color",
				action: () => this.showColorPicker(node, clientX, clientY),
			},
			{
				label: "Delete (Del)",
				action: () => this.deleteNode(node),
				disabled: node.id === this.root.id,
			},
		];

		for (const item of items) {
			const div = document.createElement("div");
			div.textContent = item.label;
			div.style.padding = "6px 16px";
			div.style.cursor = item.disabled ? "default" : "pointer";
			div.style.color = item.disabled
				? "var(--text-muted, #666)"
				: "var(--text-normal, #ddd)";
			div.style.fontSize = "13px";
			if (!item.disabled) {
				div.addEventListener("mouseenter", () => {
					div.style.background = "var(--background-modifier-hover, #363636)";
				});
				div.addEventListener("mouseleave", () => {
					div.style.background = "transparent";
				});
				div.addEventListener("click", (e) => {
					e.stopPropagation();
					this.removeContextMenu();
					item.action();
				});
			}
			menu.appendChild(div);
		}

		document.body.appendChild(menu);
		this.contextMenu = menu;

		// Close on outside click
		const closeHandler = () => {
			this.removeContextMenu();
			document.removeEventListener("click", closeHandler);
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 0);
	}

	private removeContextMenu(): void {
		if (this.contextMenu) {
			this.contextMenu.remove();
			this.contextMenu = null;
		}
	}

	private showColorPicker(node: TreeNode, x: number, y: number): void {
		const picker = document.createElement("div");
		picker.style.position = "fixed";
		picker.style.left = `${x}px`;
		picker.style.top = `${y}px`;
		picker.style.zIndex = "10001";
		picker.style.background = "var(--background-secondary, #2b2b2b)";
		picker.style.border = "1px solid var(--background-modifier-border, #444)";
		picker.style.borderRadius = "8px";
		picker.style.padding = "8px";
		picker.style.display = "flex";
		picker.style.gap = "6px";
		picker.style.flexWrap = "wrap";
		picker.style.maxWidth = "160px";
		picker.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)";

		for (const color of BRANCH_COLORS) {
			const swatch = document.createElement("div");
			swatch.style.width = "24px";
			swatch.style.height = "24px";
			swatch.style.borderRadius = "50%";
			swatch.style.background = color;
			swatch.style.cursor = "pointer";
			swatch.style.border = node.color === color ? "2px solid #fff" : "2px solid transparent";
			swatch.addEventListener("click", (e) => {
				e.stopPropagation();
				this.applyColorToSubtree(node, color);
				this.render();
				this.notifyUpdate();
				picker.remove();
			});
			picker.appendChild(swatch);
		}

		document.body.appendChild(picker);

		const closeHandler = () => {
			picker.remove();
			document.removeEventListener("click", closeHandler);
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 0);
	}

	private applyColorToSubtree(node: TreeNode, color: string): void {
		node.color = color;
		for (const child of node.children) {
			this.applyColorToSubtree(child, color);
		}
	}

	// ─── Node Operations ────────────────────────────────────────

	private addChild(node: TreeNode): void {
		const child: TreeNode = {
			id: "node-" + Date.now(),
			text: "New",
			children: [],
			collapsed: false,
			x: 0, y: 0,
			width: 0, height: 0,
			subtreeWidth: 0, subtreeHeight: 0,
			color: node.color,
		};
		node.collapsed = false;
		node.children.push(child);
		this.selectedNodeId = child.id;
		this.render();
		this.notifyUpdate();

		// Immediately start editing
		setTimeout(() => this.startEditing(child), 50);
	}

	private addSibling(node: TreeNode): void {
		const parent = findParent(this.root, node.id);
		if (!parent) return;

		const sibling: TreeNode = {
			id: "node-" + Date.now(),
			text: "New",
			children: [],
			collapsed: false,
			x: 0, y: 0,
			width: 0, height: 0,
			subtreeWidth: 0, subtreeHeight: 0,
			color: node.color,
		};

		const idx = parent.children.indexOf(node);
		parent.children.splice(idx + 1, 0, sibling);
		this.selectedNodeId = sibling.id;
		this.render();
		this.notifyUpdate();

		setTimeout(() => this.startEditing(sibling), 50);
	}

	private deleteNode(node: TreeNode): void {
		if (node.id === this.root.id) return;

		const parent = findParent(this.root, node.id);
		removeNode(this.root, node.id);
		this.selectedNodeId = parent ? parent.id : this.root.id;
		this.render();
		this.notifyUpdate();
	}

	// ─── Drag & Drop ────────────────────────────────────────────

	private createDragGhost(): void {
		if (!this.dragNode) return;
		this.dragGhost = document.createElementNS("http://www.w3.org/2000/svg", "g");
		this.dragGhost.setAttribute("opacity", "0.6");

		const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rect.setAttribute("width", String(this.dragNode.width));
		rect.setAttribute("height", String(this.dragNode.height));
		rect.setAttribute("rx", "6");
		rect.setAttribute("fill", this.dragNode.color);
		rect.setAttribute("stroke", "#fff");
		rect.setAttribute("stroke-width", "2");
		this.dragGhost.appendChild(rect);

		const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
		text.setAttribute("x", String(this.dragNode.width / 2));
		text.setAttribute("y", String(this.dragNode.height / 2));
		text.setAttribute("text-anchor", "middle");
		text.setAttribute("dominant-baseline", "central");
		text.setAttribute("fill", "#fff");
		text.setAttribute("font-size", String(this.settings.fontSize));
		text.textContent = this.dragNode.text;
		this.dragGhost.appendChild(text);

		this.mainGroup.appendChild(this.dragGhost);
	}

	private removeDragGhost(): void {
		if (this.dragGhost) {
			this.dragGhost.remove();
			this.dragGhost = null;
		}
	}

	private highlightDropTarget(svgX: number, svgY: number): void {
		// Remove old highlights
		this.mainGroup.querySelectorAll(".drop-highlight").forEach((el) => el.remove());

		const target = this.findNodeAtPosition(this.root, svgX, svgY);
		if (target && this.dragNode && target.id !== this.dragNode.id) {
			const highlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			highlight.setAttribute("class", "drop-highlight");
			highlight.setAttribute("x", String(target.x - 3));
			highlight.setAttribute("y", String(target.y - 3));
			highlight.setAttribute("width", String(target.width + 6));
			highlight.setAttribute("height", String(target.height + 6));
			highlight.setAttribute("rx", "8");
			highlight.setAttribute("fill", "none");
			highlight.setAttribute("stroke", "#FFD700");
			highlight.setAttribute("stroke-width", "3");
			highlight.setAttribute("stroke-dasharray", "6,3");
			this.mainGroup.appendChild(highlight);
		}
	}

	private findNodeAtPosition(node: TreeNode, x: number, y: number): TreeNode | null {
		if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
			return node;
		}
		if (!node.collapsed) {
			for (const child of node.children) {
				const found = this.findNodeAtPosition(child, x, y);
				if (found) return found;
			}
		}
		return null;
	}

	private dropNode(svgX: number, svgY: number): void {
		if (!this.dragNode) return;

		const target = this.findNodeAtPosition(this.root, svgX, svgY);
		if (!target || target.id === this.dragNode.id) return;

		// Don't allow dropping onto a descendant
		if (this.isDescendant(this.dragNode, target.id)) return;

		// Don't allow dropping root
		if (this.dragNode.id === this.root.id) return;

		// Remove from old parent
		removeNode(this.root, this.dragNode.id);

		// Add to new parent
		this.dragNode.color = target.color;
		this.applyColorToSubtree(this.dragNode, target.color);
		target.children.push(this.dragNode);
		target.collapsed = false;

		this.selectedNodeId = this.dragNode.id;
		this.render();
		this.notifyUpdate();
	}

	private isDescendant(node: TreeNode, targetId: string): boolean {
		if (node.id === targetId) return true;
		for (const child of node.children) {
			if (this.isDescendant(child, targetId)) return true;
		}
		return false;
	}

	// ─── Update callback ───────────────────────────────────────

	private notifyUpdate(): void {
		if (this.callbacks.onUpdate) {
			this.callbacks.onUpdate(treeToMarkdown(this.root));
		}
	}

	// ─── Public API ─────────────────────────────────────────────

	getRoot(): TreeNode {
		return this.root;
	}

	getMarkdown(): string {
		return treeToMarkdown(this.root);
	}

	setDirection(dir: "right" | "down"): void {
		this.settings.direction = dir;
		this.render();
		this.fitToView();
	}

	collapseAll(): void {
		const collapse = (node: TreeNode) => {
			if (node.children.length > 0) node.collapsed = true;
			for (const c of node.children) collapse(c);
		};
		collapse(this.root);
		this.root.collapsed = false; // Keep root expanded
		this.render();
		this.fitToView();
	}

	expandAll(): void {
		const expand = (node: TreeNode) => {
			node.collapsed = false;
			for (const c of node.children) expand(c);
		};
		expand(this.root);
		this.render();
		this.fitToView();
	}
}
