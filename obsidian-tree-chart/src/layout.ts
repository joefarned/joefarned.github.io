import { TreeNode, TreeChartSettings } from "./types";

/**
 * Measure text width using a canvas context.
 */
function measureText(text: string, fontSize: number): number {
	// Approximate: average char width is ~0.6 * fontSize for sans-serif
	return text.length * fontSize * 0.6 + 8;
}

/**
 * Compute the width/height of each node based on its text.
 */
function measureNodes(node: TreeNode, settings: TreeChartSettings): void {
	const textWidth = measureText(node.text, settings.fontSize);
	node.width = Math.max(settings.nodeMinWidth, textWidth + settings.nodePaddingX * 2);
	node.height = settings.nodeHeight;

	const visibleChildren = node.collapsed ? [] : node.children;
	for (const child of visibleChildren) {
		measureNodes(child, settings);
	}
}

/**
 * Compute subtree dimensions (used for layout).
 * For "right" direction: subtreeWidth = node width + gap + max child subtree width
 *                        subtreeHeight = sum of children subtreeHeights + gaps
 */
function computeSubtreeSizes(node: TreeNode, settings: TreeChartSettings): void {
	const visibleChildren = node.collapsed ? [] : node.children;

	for (const child of visibleChildren) {
		computeSubtreeSizes(child, settings);
	}

	if (visibleChildren.length === 0) {
		node.subtreeWidth = node.width;
		node.subtreeHeight = node.height;
	} else {
		if (settings.direction === "right") {
			const maxChildSubtreeWidth = Math.max(
				...visibleChildren.map((c) => c.subtreeWidth)
			);
			node.subtreeWidth =
				node.width + settings.horizontalGap + maxChildSubtreeWidth;

			const childrenTotalHeight = visibleChildren.reduce(
				(sum, c) => sum + c.subtreeHeight,
				0
			);
			const gaps = (visibleChildren.length - 1) * settings.verticalGap;
			node.subtreeHeight = Math.max(node.height, childrenTotalHeight + gaps);
		} else {
			// down
			const childrenTotalWidth = visibleChildren.reduce(
				(sum, c) => sum + c.subtreeWidth,
				0
			);
			const gaps = (visibleChildren.length - 1) * settings.horizontalGap;
			node.subtreeWidth = Math.max(node.width, childrenTotalWidth + gaps);

			const maxChildSubtreeHeight = Math.max(
				...visibleChildren.map((c) => c.subtreeHeight)
			);
			node.subtreeHeight =
				node.height + settings.verticalGap + maxChildSubtreeHeight;
		}
	}
}

/**
 * Assign x/y positions to each node.
 */
function assignPositions(
	node: TreeNode,
	x: number,
	y: number,
	settings: TreeChartSettings
): void {
	const visibleChildren = node.collapsed ? [] : node.children;

	if (settings.direction === "right") {
		// Node is vertically centered within its subtree band
		node.x = x;
		node.y = y + (node.subtreeHeight - node.height) / 2;

		const childX = x + node.width + settings.horizontalGap;
		let childY = y;
		for (const child of visibleChildren) {
			assignPositions(child, childX, childY, settings);
			childY += child.subtreeHeight + settings.verticalGap;
		}
	} else {
		// down
		node.x = x + (node.subtreeWidth - node.width) / 2;
		node.y = y;

		const childY = y + node.height + settings.verticalGap;
		let childX = x;
		for (const child of visibleChildren) {
			assignPositions(child, childX, childY, settings);
			childX += child.subtreeWidth + settings.horizontalGap;
		}
	}
}

/**
 * Full layout pass: measure, compute subtree sizes, assign positions.
 */
export function layoutTree(root: TreeNode, settings: TreeChartSettings): void {
	measureNodes(root, settings);
	computeSubtreeSizes(root, settings);
	assignPositions(root, 50, 50, settings);
}
