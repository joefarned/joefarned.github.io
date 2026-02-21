export interface TreeNode {
	id: string;
	text: string;
	children: TreeNode[];
	collapsed: boolean;
	// Layout positions computed during rendering
	x: number;
	y: number;
	width: number;
	height: number;
	// Subtree dimensions
	subtreeWidth: number;
	subtreeHeight: number;
	// Color for the branch
	color: string;
}

export interface TreeChartSettings {
	horizontalGap: number;
	verticalGap: number;
	nodeMinWidth: number;
	nodeHeight: number;
	nodePaddingX: number;
	nodePaddingY: number;
	fontSize: number;
	direction: "right" | "down";
	theme: "auto" | "light" | "dark";
}

export const DEFAULT_SETTINGS: TreeChartSettings = {
	horizontalGap: 40,
	verticalGap: 20,
	nodeMinWidth: 80,
	nodeHeight: 36,
	nodePaddingX: 16,
	nodePaddingY: 8,
	fontSize: 14,
	direction: "right",
	theme: "auto",
};

export const BRANCH_COLORS = [
	"#4A90D9", // blue
	"#E06C75", // red
	"#98C379", // green
	"#E5C07B", // yellow
	"#C678DD", // purple
	"#56B6C2", // cyan
	"#D19A66", // orange
	"#BE5046", // dark red
];
