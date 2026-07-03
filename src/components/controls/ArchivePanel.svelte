<script lang="ts">
import { onMount, tick } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getPostUrlBySlug } from "@/utils/url-utils";

// ===== 类型定义 =====
interface Post {
	id: string;
	data: {
		title: string;
		tags: string[];
		category?: string | null;
		published: Date;
	};
}
interface MonthGroup {
	month: number;
	posts: Post[];
}
interface YearGroup {
	year: number;
	months: MonthGroup[];
	totalCount: number;
}
interface ActiveFilter {
	labelKey: I18nKey;
	values: string[];
}
interface PostMetaTag {
	name: string;
}

// ===== Props =====
export let tags: string[] = [];
export let categories: string[] = [];
export let sortedPosts: Post[] = [];

// ===== 状态 =====
let yearGroups: YearGroup[] = [];
let activeFilters: ActiveFilter[] = [];
let primaryFilter: ActiveFilter | null = null;
let secondaryFilters: ActiveFilter[] = [];
let filteredPostCount = 0;
let categoryColors: Map<string, string> = new Map();
let hoveredPostId: string | null = null;
let highlightedYear: number | null = null;
let highlightedMonth: string | null = null;

// ===== 高亮 SVG path 状态 =====
// 用一条 SVG path 绘制从年节点 → 月节点 → 文章节点的整条高亮线
let highlightPathD = "";

// DOM 引用
let panelEl: HTMLElement;
// yearBlock refs: yearGroup.year -> HTMLElement
let yearBlockRefs: Map<number, HTMLElement> = new Map();
// monthBlock refs: `${year}-${month}` -> HTMLElement
let monthBlockRefs: Map<string, HTMLElement> = new Map();
// postRow refs: postId -> HTMLElement
let postRowRefs: Map<string, HTMLElement> = new Map();

// ===== 分类颜色调色板 =====
const categoryColorPalette = [
	"#fbbf24",
	"#fb7185",
	"#34d399",
	"#60a5fa",
	"#a78bfa",
	"#f472b6",
	"#2dd4bf",
	"#fb923c",
	"#22d3ee",
	"#818cf8",
	"#e879f9",
	"#a3e635",
	"#f87171",
	"#a78bfa",
	"#06b6d4",
	"#f59e0b",
	"#f43f5e",
	"#10b981",
];

// ===== 工具函数 =====
function formatDate(date: Date): string {
	const m = (date.getMonth() + 1).toString().padStart(2, "0");
	const d = date.getDate().toString().padStart(2, "0");
	return `${m}-${d}`;
}
function formatMonth(month: number): string {
	return `${month}${i18n(I18nKey.month)}`;
}
function getCategoryColor(name: string): string {
	const color = categoryColors.get(name);
	return color ? `color: ${color}` : "";
}
function normalizeCategoryName(name: string | null | undefined): string {
	return (name || "").trim();
}
function normalizeTags(tags: string[] | undefined | null): string[] {
	return Array.from(
		new Set(
			(tags || []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
		),
	);
}
function initializeCategoryColors(posts: Post[]): void {
	categoryColors = new Map();
	const set = new Set<string>();
	for (const p of posts) {
		const cat = normalizeCategoryName(p.data.category);
		if (cat) set.add(cat);
	}
	const sorted = Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
	for (let i = 0; i < sorted.length; i++) {
		categoryColors.set(
			sorted[i],
			categoryColorPalette[i % categoryColorPalette.length],
		);
	}
}

function groupByYearMonth(posts: Post[]): YearGroup[] {
	const yearMap = new Map<number, Map<number, Post[]>>();
	for (const post of posts) {
		const y = post.data.published.getFullYear();
		const mo = post.data.published.getMonth() + 1;
		if (!yearMap.has(y)) yearMap.set(y, new Map<number, Post[]>());
		const mm = yearMap.get(y);
		if (!mm) continue;
		if (!mm.has(mo)) mm.set(mo, []);
		const postsList = mm.get(mo);
		if (postsList) postsList.push(post);
	}
	return Array.from(yearMap.keys())
		.sort((a, b) => b - a)
		.map((year) => {
			const mm = yearMap.get(year);
			if (!mm) return { year, months: [], totalCount: 0 };
			const months = Array.from(mm.keys())
				.sort((a, b) => b - a)
				.map((month) => {
					const postsForMonth = mm.get(month) ?? [];
					return { month, posts: postsForMonth };
				});
			return {
				year,
				months,
				totalCount: months.reduce((s, m) => s + m.posts.length, 0),
			};
		});
}

function formatFilterValues(f: ActiveFilter): string {
	const prefix = f.labelKey === I18nKey.tags ? "#" : "";
	return f.values.map((v) => `${prefix}${v}`).join(" / ");
}
function getPostCategoryName(post: Post): string {
	return (
		normalizeCategoryName(post.data.category) || i18n(I18nKey.uncategorized)
	);
}
function getPostMetaTags(post: Post): PostMetaTag[] {
	return normalizeTags(post.data.tags)
		.slice(0, 3)
		.map((tag) => ({ name: tag }));
}
function getPostMetaMoreCount(post: Post): number {
	return Math.max(0, normalizeTags(post.data.tags).length - 3);
}
function resolvePrimaryFilter(filters: ActiveFilter[]): ActiveFilter | null {
	return filters.find((f) => f.labelKey === I18nKey.tags) ?? filters[0] ?? null;
}
function formatFilterSummary(filters: ActiveFilter[]): string {
	return filters
		.map((f) => `${i18n(f.labelKey)}: ${formatFilterValues(f)}`)
		.join("  ·  ");
}

// ===== 高亮 SVG path 计算 =====
/**
 * 计算从年节点中心到悬停文章节点中心的 SVG path。
 * 路径：年节点中心 → 向下到月节点 Y → 向右到月节点 X → 向下到文章节点 Y → 向右到文章节点 X
 * 拐角处用圆弧 (arc) 连接，保证视觉连续。
 */
async function computeHighlight(postId: string) {
	await tick();
	if (!panelEl) {
		highlightPathD = "";
		return;
	}

	// 找到悬停文章所在的年/月
	let targetYear: number | null = null;
	let targetMonth: number | null = null;
	for (const yg of yearGroups) {
		for (const mg of yg.months) {
			if (mg.posts.some((p) => p.id === postId)) {
				targetYear = yg.year;
				targetMonth = mg.month;
				break;
			}
		}
		if (targetYear !== null) break;
	}
	if (targetYear === null || targetMonth === null) {
		highlightPathD = "";
		highlightedYear = null;
		highlightedMonth = null;
		return;
	}

	highlightedYear = targetYear;
	highlightedMonth = `${targetYear}-${targetMonth}`;

	const panelRect = panelEl.getBoundingClientRect();
	const tw =
		Number.parseFloat(getComputedStyle(panelEl).getPropertyValue("--tw")) * 16; // rem→px
	const r = 4; // 拐角圆弧半径

	const yearBlock = yearBlockRefs.get(targetYear);
	const monthBlock = monthBlockRefs.get(`${targetYear}-${targetMonth}`);
	const postRow = postRowRefs.get(postId);

	if (!yearBlock || !monthBlock || !postRow) {
		highlightPathD = "";
		return;
	}

	const yr = yearBlock.getBoundingClientRect();
	const mr = monthBlock.getBoundingClientRect();
	const pr = postRow.getBoundingClientRect();

	// 各节点中心坐标（相对于 panel）
	const x0 = yr.left - panelRect.left + tw / 2; // 年竖线 X
	const y0 = yr.top - panelRect.top + tw / 2; // 年节点中心 Y
	const x1 = mr.left - panelRect.left + tw / 2; // 月竖线 X
	const y1 = mr.top - panelRect.top + tw / 2; // 月节点中心 Y
	const x2 = pr.left - panelRect.left + tw / 2; // 文章竖线 X
	const y2 = pr.top - panelRect.top + pr.height / 2; // 文章节点中心 Y

	// 路径（所有拐角均为外拐角，圆弧向外凸出）：
	// M x0 y0
	// L x0 (y1 - r)               // 年竖线向下，预留拐角
	// A r r 0 0 0 (x0 + r) y1     // 第一个圆弧：外拐角（逆时针）
	// L (x1 - r) y1               // 月横线
	// A r r 0 0 0 x1 (y1 + r)     // 第二个拐角：外拐角（逆时针）
	// L x1 (y2 - r)               // 月竖线向下，预留拐角
	// A r r 0 0 0 (x1 + r) y2     // 第三个圆弧：外拐角（逆时针）
	// L x2 y2                     // 文章横线
	const d = [
		`M ${x0} ${y0}`,
		`L ${x0} ${y1 - r}`,
		`A ${r} ${r} 0 0 0 ${x0 + r} ${y1}`,
		`L ${x1 - r} ${y1}`,
		`A ${r} ${r} 0 0 0 ${x1} ${y1 + r}`,
		`L ${x1} ${y2 - r}`,
		`A ${r} ${r} 0 0 0 ${x1 + r} ${y2}`,
		`L ${x2} ${y2}`,
	].join(" ");

	highlightPathD = d;
}

async function onPostEnter(postId: string) {
	hoveredPostId = postId;
	await computeHighlight(postId);
}

function onPostLeave() {
	hoveredPostId = null;
	highlightedYear = null;
	highlightedMonth = null;
	highlightPathD = "";
}

// ===== Svelte use: 指令（注册 DOM 引用） =====
function registerYearBlock(node: HTMLElement, year: number) {
	yearBlockRefs.set(year, node);
	return {
		destroy() {
			yearBlockRefs.delete(year);
		},
	};
}
function registerMonthBlock(
	node: HTMLElement,
	{ year, month }: { year: number; month: number },
) {
	monthBlockRefs.set(`${year}-${month}`, node);
	return {
		destroy() {
			monthBlockRefs.delete(`${year}-${month}`);
		},
	};
}
function registerPostRow(node: HTMLElement, postId: string) {
	postRowRefs.set(postId, node);
	return {
		destroy() {
			postRowRefs.delete(postId);
		},
	};
}

// ===== 生命周期 =====
onMount(() => {
	const params = new URLSearchParams(window.location.search);
	tags = params.has("tag") ? params.getAll("tag") : [];
	categories = params.has("category") ? params.getAll("category") : [];
	const uncategorized = params.get("uncategorized");

	let filtered: Post[] = sortedPosts;
	const currentFilters: ActiveFilter[] = [];
	if (categories.length > 0)
		currentFilters.push({ labelKey: I18nKey.categories, values: categories });
	if (uncategorized)
		currentFilters.push({
			labelKey: I18nKey.categories,
			values: [i18n(I18nKey.uncategorized)],
		});
	if (tags.length > 0)
		currentFilters.push({ labelKey: I18nKey.tags, values: tags });

	activeFilters = currentFilters;
	primaryFilter = resolvePrimaryFilter(activeFilters);
	secondaryFilters = primaryFilter
		? activeFilters.filter((f) => f !== primaryFilter)
		: [];

	if (tags.length > 0)
		filtered = filtered.filter(
			(p) =>
				Array.isArray(p.data.tags) && p.data.tags.some((t) => tags.includes(t)),
		);
	if (categories.length > 0)
		filtered = filtered.filter(
			(p) => p.data.category && categories.includes(p.data.category),
		);
	if (uncategorized) filtered = filtered.filter((p) => !p.data.category);

	filtered = filtered
		.slice()
		.sort((a, b) => b.data.published.getTime() - a.data.published.getTime());
	filteredPostCount = filtered.length;
	initializeCategoryColors(filtered);
	yearGroups = groupByYearMonth(filtered);
});
</script>

<div class="archive-panel card-base" bind:this={panelEl}>

	<!-- 筛选器摘要 -->
	{#if primaryFilter}
		<div class="mb-6">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
				<div class="min-w-0 text-sm text-75">
					<span class="text-50">{i18n(primaryFilter.labelKey)}</span>
					<span class="mx-2 text-30">/</span>
					<span class="font-semibold text-(--primary)">{formatFilterValues(primaryFilter)}</span>
					{#if secondaryFilters.length > 0}
						<span class="ml-2 text-50">· {formatFilterSummary(secondaryFilters)}</span>
					{/if}
				</div>
				<div class="shrink-0 text-xs text-50">
					{filteredPostCount} {i18n(filteredPostCount === 1 ? I18nKey.postCount : I18nKey.postsCount)}
					<span class="mx-1.5 text-30">·</span>
					{yearGroups.length} {i18n(I18nKey.year)}
				</div>
			</div>
		</div>
	{/if}

	<!-- 年份列表 -->
	{#each yearGroups as yearGroup (yearGroup.year)}
		<div
			class="ap-year-block"
			use:registerYearBlock={yearGroup.year}
		>
			<!-- 年份标题行 -->
			<div class="ap-year-header">
				<div class="ap-col">
					<div
						class="ap-node ap-year-node"
						class:highlighted={highlightedYear === yearGroup.year}
					></div>
				</div>
				<div class="ap-year-label">
					<h2 class="ap-h1">{yearGroup.year}{i18n(I18nKey.year)}</h2>
					<span class="ap-count">
						共 {yearGroup.totalCount} {i18n(yearGroup.totalCount === 1 ? I18nKey.postCount : I18nKey.postsCount)}
					</span>
				</div>
			</div>

			<!-- 月份区域 -->
			<div class="ap-months-area">
				{#each yearGroup.months as monthGroup (monthGroup.month)}
					<div
						class="ap-month-block"
						use:registerMonthBlock={{ year: yearGroup.year, month: monthGroup.month }}
					>
						<!-- 月份标题行 -->
						<div class="ap-month-header">
							<div class="ap-col">
								<div class="ap-hline ap-month-hline"></div>
								<div
									class="ap-node ap-month-node"
									class:highlighted={highlightedMonth === `${yearGroup.year}-${monthGroup.month}`}
								></div>
							</div>
							<div class="ap-month-label">
								<h3 class="ap-h2">{formatMonth(monthGroup.month)}</h3>
								<span class="ap-count">
									{monthGroup.posts.length} {i18n(monthGroup.posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}
								</span>
							</div>
						</div>

						<!-- 文章区域 -->
						<div class="ap-posts-area">
							<ul class="ap-post-list">
								{#each monthGroup.posts as post, postIdx (post.id)}
									{@const postTags = getPostMetaTags(post)}
									{@const postMoreCount = getPostMetaMoreCount(post)}
									{@const catColor = getCategoryColor(getPostCategoryName(post))}
									<li
										class="ap-post-row"
										class:last={postIdx === monthGroup.posts.length - 1}
										use:registerPostRow={post.id}
									>
										<div class="ap-col">
											<div class="ap-hline ap-post-hline"></div>
											<div
												class="ap-node ap-post-node"
												class:hovered={hoveredPostId === post.id}
											></div>
										</div>
										<a
											href={getPostUrlBySlug(post.id)}
											aria-label={post.data.title}
											class="ap-post-link group btn-plain"
											on:mouseenter={() => onPostEnter(post.id)}
											on:mouseleave={onPostLeave}
										>
											<span class="ap-date">{formatDate(post.data.published)}</span>
											<span class="ap-post-content">
												<span class="ap-title group-hover:text-(--primary)">
													{post.data.title}
												</span>
												<span class="ap-meta">
													<span class="ap-category" style={catColor}>
														#{getPostCategoryName(post)}
													</span>
													{#if postTags.length > 0}
														<span class="ap-meta-gap" aria-hidden="true"></span>
														{#each postTags as tag, i (tag.name)}
															<span class="ap-tag">
																{tag.name}
															</span>
															{#if i < postTags.length - 1}
																<span class="ap-meta-divider" aria-hidden="true">/</span>
															{/if}
														{/each}
													{/if}
													{#if postMoreCount > 0}
														<span class="ap-tag-more">
															+{postMoreCount}
														</span>
													{/if}
												</span>
											</span>
										</a>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<!-- 高亮 SVG 线：一条连续 path 覆盖虚线，拐角带圆弧 -->
	{#if highlightPathD}
		<svg class="ap-highlight-svg" aria-hidden="true">
			<path d={highlightPathD} fill="none" stroke="var(--lh)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{/if}

</div>

<style>
.archive-panel {
	--tw: 2rem;
	/* 时间线虚线颜色：跟随项目主题色相 */
	--lc: var(--line-color);
	/* 高亮线颜色：使用主题色，自动适配明暗模式 */
	--lh: var(--primary);
	/* 普通节点颜色：使用分隔线色，保证小节点可见 */
	--nc: var(--meta-divider);
	/* 高亮节点颜色：使用主题色，自动适配明暗模式 */
	--nh: var(--primary);
	--lw: 2.5px;
	position: relative; /* 高亮覆盖层的定位基准 */
	/* 整体内边距，让文字与卡片边缘有宽松的呼吸感 */
	padding: 1.25rem 1.5rem;
}

/* ── 年份块 ── */
.ap-year-block {
	position: relative;
	margin-bottom: 2.75rem;
}
.ap-year-block:last-child {
	margin-bottom: 0;
}

/* 年竖线：从年节点中心延伸到最后一个月的横线连接处 */
.ap-year-block::before {
	content: "";
	position: absolute;
	left: calc(var(--tw) / 2);
	top: calc(var(--tw) / 2);
	/* 让年竖线延伸到年块底部附近，保持与最后一个月分支的连接 */
	bottom: 0.5rem;
	width: 0;
	border-left: var(--lw) dashed var(--lc);
	z-index: 0;
}

.ap-months-area { padding-left: var(--tw); }

/* ── 月份块 ── */
.ap-month-block {
	position: relative;
	margin-bottom: 1rem;
}
.ap-month-block:last-child {
	margin-bottom: 0;
}

/* 月竖线：从月节点中心延伸到最后一个文章节点中心 */
.ap-month-block::before {
	content: "";
	position: absolute;
	left: calc(var(--tw) / 2);
	top: calc(var(--tw) / 2);
	/* 文章行 min-height 2.5rem，节点居中，约 1.25rem 处；略留余量保证相连 */
	bottom: 1.25rem;
	width: 0;
	border-left: var(--lw) dashed var(--lc);
	z-index: 0;
}

.ap-posts-area { padding-left: var(--tw); }
/* 不设 overflow:hidden，否则会裁掉向左延伸连接月竖线的文章横线 */
.ap-post-list  { list-style: none; margin: 0; padding: 0; }

/* ── 文章行 ── */
.ap-post-row {
	position: relative;
	display: flex;
	align-items: center;
	min-height: 2.5rem;
}
.ap-post-row:not(:last-child) {
	margin-bottom: 0.15rem;
}
/* 移除 translateX 位移，避免 hover 背景色块溢出容器；改由节点缩放与 SVG 高亮线提供反馈 */

/* 文章间竖线（已移除，避免与横线重叠形成虚线） */
.ap-post-row::before {
	content: none;
}

/* ── 节点列 ── */
.ap-col {
	position: relative;
	width: var(--tw);
	flex-shrink: 0;
	align-self: stretch;
}

/* ── 节点通用 ── */
.ap-node {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	border-radius: 50%;
	z-index: 2;
	transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.ap-node.highlighted,
.ap-node.hovered {
	z-index: 3;
}

.ap-year-node {
	top: calc(50% - 0.375rem);
	width: 0.75rem; height: 0.75rem;
	border: 2px solid var(--nc);
	/* 用卡片背景色"打孔"虚线，使节点清晰可见 */
	background: var(--card-bg);
}
.ap-year-node.highlighted {
	background: var(--nh);
	border-color: var(--nh);
}

.ap-month-node {
	top: calc(50% - 0.25rem);
	width: 0.5rem; height: 0.5rem;
	background: var(--nc);
}
.ap-month-node.highlighted {
	background: var(--nh);
	transform: translateX(-50%) scale(1.5);
}

.ap-post-node {
	top: calc(50% - 0.2rem);
	width: 0.4rem; height: 0.4rem;
	background: var(--nc);
}
.ap-post-node.hovered {
	background: var(--nh);
	transform: translateX(-50%) scale(1.6);
}

/* ── 横线（静态虚线） ── */
.ap-hline {
	position: absolute;
	height: 0;
	border-top: var(--lw) dashed var(--lc);
	z-index: 1;
}
.ap-month-hline {
	top: 50%;
	left: calc(-1 * var(--tw) / 2);
	width: var(--tw);
}
.ap-post-hline {
	top: 50%;
	left: calc(-1 * var(--tw) / 2);
	width: var(--tw);
}

/* ══════════════════════════════════════════════════
   高亮 SVG 线
   一条连续 path 覆盖虚线，拐角带圆弧
══════════════════════════════════════════════════ */
.ap-highlight-svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	z-index: 1;
	overflow: visible;
}
.ap-highlight-svg path {
	/* 用卡片背景色作为阴影色，覆盖下方虚线，形成"擦除"效果 */
	filter: drop-shadow(0 0 2px var(--card-bg)) drop-shadow(0 0 2px var(--card-bg));
}

/* ── 标题行 ── */
.ap-year-header, .ap-month-header {
	display: flex; align-items: center; min-height: calc(var(--tw) + 0.5rem);
}
.ap-year-label, .ap-month-label {
	display: flex; align-items: baseline; gap: 0.75rem; padding-left: 0.75rem; flex: 1;
}
.ap-h1 { font-size: 1.375rem; font-weight: 700; color: var(--deep-text); margin: 0; }
.ap-h2 { font-size: 1.05rem;  font-weight: 600; color: var(--deep-text); margin: 0; }
.ap-count { font-size: 0.75rem; color: var(--content-meta); }

/* ── 文章链接 ── */
.ap-post-link {
	display: flex; align-items: center; gap: 1rem;
	flex: 1; min-height: 2.75rem;
	/* 右侧留出呼吸空间，避免 hover 色块与文字贴到卡片右边 */
	padding: 0.4rem 1rem;
	margin-left: 0;
	border-radius: 0.5rem; text-decoration: none; overflow: hidden;
}
.ap-date {
	font-size: 0.875rem; color: var(--content-meta);
	font-variant-numeric: tabular-nums; white-space: nowrap;
	flex-shrink: 0; width: 3rem; text-align: right;
}
.ap-post-content {
	display: flex;
	align-items: center;
	gap: 1rem;
	flex: 1;
	min-width: 0;
}
.ap-category {
	font-size: 0.8rem; font-weight: 700;
	white-space: nowrap; flex-shrink: 0;
	color: var(--content-meta);
}
.ap-meta {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex-shrink: 0;
	min-width: 0;
	white-space: nowrap;
}
.ap-meta-gap {
	display: inline-block;
	width: 0.625rem;
	flex-shrink: 0;
}
.ap-meta-divider {
	color: var(--meta-divider);
	font-size: 0.8rem;
	font-weight: 700;
	flex-shrink: 0;
	margin: 0 0.05rem;
}
.ap-tag {
	font-size: 0.8rem;
	font-weight: 700;
	white-space: nowrap;
	flex-shrink: 0;
}
.ap-tag-more {
	color: var(--content-meta);
	font-size: 0.8rem;
	font-weight: 700;
	white-space: nowrap;
	flex-shrink: 0;
}
.ap-title {
	font-size: 0.9rem; font-weight: 500; color: var(--deep-text);
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	flex: 1; min-width: 0; transition: color 0.15s ease; display: block;
}

/* 暗色模式由 variables.styl 中的 --primary / --meta-divider / --card-bg 自动适配，无需覆写 */

@media (max-width: 768px) {
	.archive-panel { --tw: 1.5rem; }
	.ap-post-link {
		align-items: flex-start;
		gap: 0.5rem;
		min-height: auto;
		padding: 0.45rem 0.7rem 0.5rem;
	}
	.ap-date {
		width: 2.6rem;
		font-size: 0.78rem;
		margin-top: 0.1rem;
	}
	.ap-post-content {
		flex: 1;
		min-width: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
	}
	.ap-title {
		width: 100%;
		font-size: 0.92rem;
		white-space: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		text-overflow: ellipsis;
		overflow-wrap: anywhere;
	}
	.ap-meta {
		width: 100%;
		flex-wrap: wrap;
		gap: 0.2rem;
		white-space: normal;
	}
	.ap-meta-gap {
		display: none;
	}
	.ap-category { font-size: 0.75rem; }
	.ap-tag,
	.ap-tag-more,
	.ap-meta-divider { font-size: 0.72rem; }

	/* 移动端隐藏时间线虚线、节点与高亮层，保留标题与文章列表 */
	.ap-year-block::before,
	.ap-month-block::before {
		content: none;
	}
	.ap-hline,
	.ap-node,
	.ap-col,
	.ap-highlight-layer {
		display: none;
	}
	.ap-months-area,
	.ap-posts-area {
		padding-left: 0.5rem;
	}
}
</style>
