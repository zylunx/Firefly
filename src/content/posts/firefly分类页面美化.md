---
title: Firefly 分类页面美化
published: 2026-07-03T00:00:00.000Z
description: 对 Firefly 主题分类页进行改造，新增分类玫瑰图与标签关系图谱，并适配暗色模式。
tags:
  - Firefly
  - 美化
  - 教程
  - 分类
category: 技术分享
draft: false
slug: firefly-category-beautify
image: https://img.laplace.de5.net/file/blog/dcaq5pYz.webp
ai: >-
  本文记录了对 Firefly 主题的 /categories/ 页面进行改造的全过程。新增了 PageTitle、CategoryRose（ECharts
  南丁格尔玫瑰图）、TagGraph（ECharts 力导向图）三大组件，配合标签图数据工具、专属样式与多语言文案，将原本简易的卡片列表升级为带可视化图表的现代分类聚合页。亮点是 CDN 延迟加载
  ECharts 5.6.0、Swup 路由切换的实例生命周期管理、MutationObserver 主题适配与 i18n 五语言覆盖。
---

## 📖 概述

`/categories/` 是博客的**分类标签**聚合页面。改造前是一个简单的卡片网格；我们将它升级为包含**分类玫瑰图** + **标签关系图谱**的现代化可视化页面。

本文整理了改造过程中**新增/修改的文件**、**采用的方法**以及**关键代码片段**。

---

## 📂 文件清单

### 新增文件（5 个）

| 路径 | 作用 |
| --- | --- |
| `src/utils/tag-graph-data.ts` | 标签共现图谱构建算法 |
| `src/components/common/PageTitle.astro` | 通用页面标题组件（stacked / inline） |
| `src/components/widget/CategoryRose.astro` | 分类玫瑰图 + 列表 |
| `src/components/widget/TagGraph.astro` | 标签关系图谱 |
| `src/styles/pages/categories.css` | 分类页专属样式 |

### 修改文件（9 个）

| 路径 | 改动 |
| --- | --- |
| `src/pages/categories/index.astro` | 重写为薄壳路由页，仅组合子组件 |
| `src/utils/content-utils.ts` | 新增 `getTagGraphData()` |
| `src/styles/main.css` | 引入 `./pages/categories.css` |
| `src/i18n/i18nKey.ts` | 新增 8 个枚举 key |
| `src/i18n/languages/zh_CN.ts` | 中文简体翻译 |
| `src/i18n/languages/zh_TW.ts` | 中文繁体翻译 |
| `src/i18n/languages/en.ts` | 英文翻译 |
| `src/i18n/languages/ja.ts` | 日文翻译 |
| `src/i18n/languages/ru.ts` | 俄文翻译 |

---

## 🛠️ 方法 & 关键代码

### 1. 数据层：标签共现图谱算法

新建 `src/utils/tag-graph-data.ts`，核心思路是**遍历文章 → 聚合标签 → 枚举组合生成边**。

```ts
// 伪代码
function buildTagGraphData(posts, getTagUrl, threshold = 2) {
  for (const post of posts) {
    const tags = unique(post.data.tags);
    // 节点：每个标签的 value = 文章数，posts = 文章列表
    for (const tag of tags) nodeMap[tag].value += 1;
    // 边：任意两标签组合，统计共现次数
    for (let i = 0; i < tags.length; i++)
      for (let j = i + 1; j < tags.length; j++)
        edgeMap[`${min(a,b)}\0${max(a,b)}`] += 1;
  }
  // 过滤掉 value < threshold 的边
  return { nodes, links, threshold };
}
```

然后在 `content-utils.ts` 中暴露一个面向页面的封装：

```ts
export async function getTagGraphData(threshold = 2) {
  const posts = await getSortedPostsList();
  return buildTagGraphData(posts, getTagUrl, threshold);
}
```

### 2. 通用标题组件 `PageTitle.astro`

支持 `stacked`（eyebrow 在上、title 在下）和 `inline`（横排）两种变体，BEM 命名，CSS 变量绑定主题色。

```astro
---
interface Props {
  title: string;
  eyebrow?: string;
  variant?: "stacked" | "inline";
}
const { title, eyebrow, variant = "stacked" } = Astro.props;
---
<div class:list={["page-title", `page-title--${variant}`]}>
  {eyebrow && <span class="page-title__eyebrow">{eyebrow}</span>}
  <h1 class="page-title__title">{title}</h1>
</div>
```

### 3. CategoryRose 玫瑰图

**ECharts 配置要点**（南丁格尔玫瑰图 + 暗色适配）：

```ts
{
  tooltip: { trigger: "item", /* 显示百分比 */ },
  series: [{
    type: "pie",
    radius: ["20%", "75%"],
    roseType: "area",           // 玫瑰图核心
    itemStyle: { borderRadius: 6 },
    label: { color: isDark() ? "..." : "..." },
    data: [...],
    animationType: "scale",     // 入场动画
    animationDelay: i => i * 100
  }]
}
```

**CDN 延迟加载** + **全局只绑定一次**监听（防止 Swup 路由切换导致重复绑定）：

```ts
if (!window.__categoryRoseBound) {
  window.__categoryRoseBound = true;
  document.addEventListener("astro:page-load", ensureEchartsThenInit);
  document.addEventListener("swup:contentReplaced", ensureEchartsThenInit);
  document.addEventListener("swup:willReplaceContent", destroyCategoryRose);
}
```

**销毁逻辑**：dispose chart + disconnect observer + remove resize 监听，避免内存泄漏。

**主题切换**：用 `MutationObserver` 监听 `<html>` 的 `class` 变化，重新 `setOption()` 重算颜色。

### 4. TagGraph 力导向图

**ECharts 配置要点**（type: graph + layout: force）：

```ts
{
  tooltip: { /* 节点/边不同 formatter */ },
  legend: { data: ["高频", "常用", "低频"] },
  series: [{
    type: "graph",
    layout: "force",
    roam: true,            // 可拖拽缩放
    draggable: true,
    focusNodeAdjacency: true,  // 悬停聚焦
    emphasis: { focus: "adjacency", /* 线条变粗 */ },
    blur: { opacity: 0.15 },  // 非邻节点灰化
    force: { repulsion: 220, edgeLength: [60, 160] },
    categories: [...],     // 3 个分类
    data: nodes, links: links
  }]
}
```

**节点大小**（24~78px 之间，用 sqrt 避免小节点过小）：

```ts
function nodeSymbolSize(value) {
  const scaled = Math.sqrt(value) * 14;
  return Math.max(24, Math.min(78, scaled));
}
```

**节点颜色**按文章数分档：

| 文章数 | 类别 | 颜色 |
| --- | --- | --- |
| `value >= 5` | 高频 | `#fb7185`（红） |
| `value >= 2` | 常用 | `#fbbf24`（黄） |
| `value < 2` | 低频 | `#94a3b8`（灰） |

### 5. 路由页面（薄壳）

`src/pages/categories/index.astro` 仅 30 行左右，负责**并行取数据 + 组合组件**：

```astro
---
const [categories, tagGraph] = await Promise.all([
  getCategoryList(),
  getTagGraphData(),
]);
---
<MainGridLayout title={i18n(I18nKey.categoriesPageTitle)}>
  <div class="categories-page card-base">
    <PageTitle title={...} eyebrow="Taxonomy" variant="stacked" />
    <CategoryRose categories={categories} />
    {categories.length > 0 && tagGraph.nodes.length > 0 && (
      <Fragment>
        <hr class="categories-page__divider" />
        <TagGraph data={tagGraph} />
      </Fragment>
    )}
  </div>
</MainGridLayout>
```

### 6. 样式

- 使用 `card-base` 提供圆角与背景，**自定义 padding** 由 `.categories-page` 提供
- `.category-rose__layout` 桌面端横排（图表 flex:1 + 列表 220px），≤768px 上下排列
- `.tag-graph__chart` 固定高度 620px，响应式递减至 360px
- **暗色模式**用项目约定的 `:where(.dark)` 选择器，例如：

```css
.category-rose__list a { color: rgba(0,0,0,0.85); }
:where(.dark) .category-rose__list a { color: rgba(255,255,255,0.85); }
```

### 7. i18n 国际化

新增 8 个 key 覆盖五种语言：

```ts
enum I18nKey {
  taxonomy = "taxonomy",                       // eyebrow 副标题
  categoriesPageTitle = "categoriesPageTitle", // "分类标签"
  tagGraphTitle = "tagGraphTitle",             // 标签图谱标题
  tagGraphCount = "tagGraphCount",             // "N 个标签"
  totalPostsLabel = "totalPostsLabel",         // "共 N 篇文章"
  highFrequencyTag = "highFrequencyTag",
  commonTag = "commonTag",
  lowFrequencyTag = "lowFrequencyTag",
}
```

| 语言 | categoriesPageTitle |
| --- | --- |
| zh_CN | 分类标签 |
| zh_TW | 分類標籤 |
| en | Categories & Tags |
| ja | カテゴリとタグ |
| ru | Категории и теги |

---

## ✅ 验收结果

- `pnpm check`：0 errors / 0 warnings / 0 hints
- `pnpm lint`：通过
- 暗色模式：分类名 / 汇总行 / 图例文字均正确切换为白色

---

## 💡 关键设计点回顾

1. **数据先行**：`buildTagGraphData` 是纯函数，便于单测；`getTagGraphData` 负责注入 `getTagUrl`，职责分离
2. **薄壳路由**：页面文件只组合不实现，便于后续换实现（如 Svelte 化）
3. **生命周期管理**：`astro:page-load` 初始化 / `swup:willReplaceContent` 销毁，避免 Swup 切换后的内存泄漏
4. **共享 ECharts 加载**：两个组件共用 `window.echarts` 与 `__echartsLoading`，避免重复加载
5. **CDN 兜底**：ECharts 5.6.0 通过 `cdn.jsdelivr.net` 延迟加载，首屏不阻塞
6. **可访问性**：`aria-label`、`role="img"` 给图表命名；列表用 `<nav>` 包裹
