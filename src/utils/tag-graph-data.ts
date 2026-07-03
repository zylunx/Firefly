import type { PostForList } from "./content-utils";

/**
 * 标签关系图谱数据结构
 */
export type TagGraphPost = {
	id: string;
	title: string;
};

export type TagGraphNode = {
	/** 标签名（唯一标识） */
	id: string;
	/** 显示名称 */
	name: string;
	/** 该标签下的文章数量 */
	value: number;
	/** 链接到 /archive/?tag=xxx */
	url: string;
	/** 该标签下的文章列表（用于 tooltip） */
	posts: TagGraphPost[];
};

export type TagGraphLink = {
	/** 源节点 ID */
	source: string;
	/** 目标节点 ID */
	target: string;
	/** 共现次数 */
	value: number;
};

export type TagGraphData = {
	nodes: TagGraphNode[];
	links: TagGraphLink[];
	/** 共现边显示阈值（默认 2） */
	threshold: number;
};

/**
 * 构建标签共现关系图谱
 *
 * @param posts 全部文章列表
 * @param getTagUrl 生成标签链接的函数
 * @param threshold 共现阈值，少于该值的边不显示（默认 2）
 */
export function buildTagGraphData(
	posts: PostForList[],
	getTagUrl: (tag: string) => string,
	threshold = 2,
): TagGraphData {
	const nodeMap = new Map<
		string,
		{ name: string; value: number; posts: TagGraphPost[] }
	>();
	const edgeMap = new Map<string, number>();

	for (const post of posts) {
		const tags = (post.data.tags || []).map((t) => t.trim()).filter(Boolean);
		const uniqueTags = Array.from(new Set(tags));

		// 累加每个标签的文章数量
		for (const tag of uniqueTags) {
			const existing = nodeMap.get(tag);
			if (existing) {
				existing.value += 1;
				existing.posts.push({ id: post.id, title: post.data.title });
			} else {
				nodeMap.set(tag, {
					name: tag,
					value: 1,
					posts: [{ id: post.id, title: post.data.title }],
				});
			}
		}

		// 为每对标签创建共现边
		for (let i = 0; i < uniqueTags.length; i++) {
			for (let j = i + 1; j < uniqueTags.length; j++) {
				const a = uniqueTags[i];
				const b = uniqueTags[j];
				// 用排序后的 pair 作为 key 保证无向边的唯一性
				const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
				edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
			}
		}
	}

	const nodes: TagGraphNode[] = [];
	for (const [id, info] of nodeMap.entries()) {
		// 限制 tooltip 显示的文章数量，避免过长
		const limitedPosts = info.posts.slice(0, 10);
		nodes.push({
			id,
			name: info.name,
			value: info.value,
			url: getTagUrl(id),
			posts: limitedPosts,
		});
	}

	const links: TagGraphLink[] = [];
	for (const [key, value] of edgeMap.entries()) {
		if (value < threshold) continue;
		const [source, target] = key.split("\u0000");
		links.push({ source, target, value });
	}

	return { nodes, links, threshold };
}
