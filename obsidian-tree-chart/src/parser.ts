import { TreeNode, BRANCH_COLORS } from "./types";

let idCounter = 0;

function nextId(): string {
	return "node-" + (idCounter++);
}

export function resetIdCounter(): void {
	idCounter = 0;
}

/**
 * Parse an Obsidian-style bulleted list into a tree structure.
 * Supports:
 *   - `- item` or `* item` or `+ item`
 *   - Tab or space indentation (auto-detected)
 *   - Nested to any depth
 */
export function parseBulletList(markdown: string): TreeNode {
	resetIdCounter();
	const lines = markdown.split("\n").filter((l) => l.trim().length > 0);

	if (lines.length === 0) {
		return createNode("Empty");
	}

	// Detect indent unit from the first indented line
	let indentUnit = 0;
	for (const line of lines) {
		const leading = line.match(/^(\s+)/);
		if (leading) {
			indentUnit = leading[1].includes("\t") ? 1 : leading[1].length;
			break;
		}
	}
	if (indentUnit === 0) indentUnit = 2; // default fallback

	// Parse each line into { depth, text }
	const parsed = lines.map((line) => {
		const leading = line.match(/^(\s*)/);
		const rawIndent = leading ? leading[1].length : 0;
		const depth = indentUnit === 1
			? (leading ? leading[1].replace(/[^\t]/g, "").length : 0)
			: Math.round(rawIndent / indentUnit);
		// Strip bullet marker
		const text = line.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+\.\s+/, "").trim();
		return { depth, text };
	});

	// If everything is at same depth, create synthetic root
	const minDepth = Math.min(...parsed.map((p) => p.depth));
	const adjusted = parsed.map((p) => ({ ...p, depth: p.depth - minDepth }));

	// Build tree
	const root = createNode(adjusted[0].text);
	root.color = "#61AFEF";

	const stack: { node: TreeNode; depth: number }[] = [{ node: root, depth: 0 }];

	for (let i = 1; i < adjusted.length; i++) {
		const { depth, text } = adjusted[i];
		const newNode = createNode(text);

		// Pop stack until we find the parent at depth - 1
		while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
			stack.pop();
		}

		const parent = stack[stack.length - 1].node;
		// Assign branch color based on top-level child index
		if (depth === 1) {
			newNode.color = BRANCH_COLORS[parent.children.length % BRANCH_COLORS.length];
		} else {
			newNode.color = parent.color;
		}
		parent.children.push(newNode);
		stack.push({ node: newNode, depth });
	}

	return root;
}

function createNode(text: string): TreeNode {
	return {
		id: nextId(),
		text,
		children: [],
		collapsed: false,
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		subtreeWidth: 0,
		subtreeHeight: 0,
		color: "#61AFEF",
	};
}

/**
 * Convert a tree back to a bulleted markdown list.
 */
export function treeToMarkdown(node: TreeNode, depth: number = 0): string {
	const indent = "  ".repeat(depth);
	const bullet = depth === 0 ? "- " : "- ";
	let result = indent + bullet + node.text + "\n";
	for (const child of node.children) {
		result += treeToMarkdown(child, depth + 1);
	}
	return result;
}

/**
 * Deep clone a tree node.
 */
export function cloneTree(node: TreeNode): TreeNode {
	return {
		...node,
		id: nextId(),
		children: node.children.map((c) => cloneTree(c)),
	};
}

/**
 * Find a node by id in the tree.
 */
export function findNode(root: TreeNode, id: string): TreeNode | null {
	if (root.id === id) return root;
	for (const child of root.children) {
		const found = findNode(child, id);
		if (found) return found;
	}
	return null;
}

/**
 * Find the parent of a node by id.
 */
export function findParent(root: TreeNode, id: string): TreeNode | null {
	for (const child of root.children) {
		if (child.id === id) return root;
		const found = findParent(child, id);
		if (found) return found;
	}
	return null;
}

/**
 * Remove a node from the tree by id. Returns true if removed.
 */
export function removeNode(root: TreeNode, id: string): boolean {
	const idx = root.children.findIndex((c) => c.id === id);
	if (idx !== -1) {
		root.children.splice(idx, 1);
		return true;
	}
	for (const child of root.children) {
		if (removeNode(child, id)) return true;
	}
	return false;
}
