---
title: Firefly 归档页面美化
published: 2026-07-03T00:00:00.000Z
description: 对 Firefly 主题归档页面进行美化：颜色变量化、整体排版、虚线连接修复，并适配明暗模式。
tags:
  - Firefly
  - 美化
  - 教程
  - 归档
category: 技术分享
slug: firefly-archive-beautify
draft: false
image: https://img.laplace.de5.net/file/blog/4dyPmol2.webp
ai: >-
  对 Firefly 归档页面（/archive）进行美化。修改了 archive.astro 去掉双层 card-base 嵌套；将
  ArchivePanel.svelte 中的强色（oklch 0.15/0.9、white、#0d0d0d）替换为项目 --primary / --card-bg
  / --line-color / --meta-divider 主题变量，实现明暗模式与 hue 色相自动适配；调整 panel
  padding、年月块间距、链接行高提升宽松度；删除造成色块溢出的 translateX 悬停位移；修复 overflow:hidden
  裁断文章横线、以及 bottom 偏移导致的虚线断裂问题。
---

## 📖 概述

`/archive/` 是 Firefly 博客的**归档**页面，结构为**年 → 月 → 文章 + 筛选 + hover 高亮 SVG**。

`ArchivePanel.svelte` 原本存在大量**强制的黑白色**（`oklch(0.15 0 0)` / `oklch(0.9 0 0)` / `white` / `#0d0d0d`），与本项目基于 `--hue` 色相的主题系统冲突。本次美化将这些强色替换为项目主题变量，并优化整体排版与虚线连接。

本文整理了改动中**新增/修改的文件**、**采用的方法**以及**关键代码片段**。

---

## 📂 文件清单

### 修改文件（2 个）

| 路径 | 改动 |
| --- | --- |
| `src/pages/archive.astro` | 去掉双层 `card-base` 嵌套；调整内边距 |
| `src/components/controls/ArchivePanel.svelte` | 颜色变量化、整体排版、修复虚线、移除 translateX |

### 新增文件（0 个）

本次美化**没有新增任何文件**，所有变更都在原有 `archive.astro` 与 `ArchivePanel.svelte` 内完成。

### 未改动部分

- 数据源 `getSortedPostsList()` 与 `content-utils.ts`
- i18n 键（`archive` 早已存在，无新增）
- `MainGridLayout`、Swup 路由切换等基础设施

---

## 🛠️ 方法 & 关键代码

### 1. archive.astro：去掉双层卡片框

**问题**：原页面是 `card-base` 套 `card-base` 的双层嵌套，外层还包了一个 `flex + rounded` 的容器，整体产生**两道实线圆角框**叠加。

**方法**：移除中间层，保留外层 `MainGridLayout` 提供的页面布局与 ArchivePanel 自身的卡片即可。

**改动前**：
```astro
<MainGridLayout title={title}>
  <div class="flex w-full rounded-(--radius-large) overflow-hidden relative min-h-32">
    <div class="card-base z-10 px-4 py-6 md:px-9 relative w-full">
      <h1 class="sr-only">{title}</h1>
      <ArchivePanel sortedPosts={sortedPostsList} client:load />
    </div>
  </div>
</MainGridLayout>
```

**改动后**：
```astro
<MainGridLayout title={title}>
  <div class="w-full py-4 md:py-6 relative">
    <h1 class="sr-only">{title}</h1>
    <ArchivePanel sortedPosts={sortedPostsList} client:load />
  </div>
</MainGridLayout>
```

**说明**：Firefly 项目的 `MainGridLayout` 已自带 Banner 标题。水平 padding 交给 panel 内部 `padding: 1.25rem 1.5rem` 负责，避免双重间距。

---

### 2. 颜色变量化（去掉强制黑白）

**问题**：`ArchivePanel.svelte` 的 `.archive-panel` 段定义了 4 个 oklch 强色与 2 处 `:global(.dark)` 覆写，并有几个 `var(--page-bg, white)` / `var(--page-bg, #0d0d0d)` 的硬编码回退。

**方法**：将所有强色映射到 `variables.styl` 中已存在的主题变量。`variables.styl` 的 `:root` 与 `:root.dark` 已经会自动切换明暗模式与 `--hue` 色相，所以无需在组件内再做暗色覆写。

**关键 CSS**：

```css
.archive-panel {
  --tw: 2rem;
  --lc: var(--line-color);     /* 虚线 */
  --lh: var(--primary);        /* 高亮线：主色，自动适配明暗 */
  --nc: var(--meta-divider);   /* 普通节点 */
  --nh: var(--primary);        /* 高亮节点：主色 */
  --lw: 2.5px;
}
```

| 原值（强制） | 现值（项目变量） | 用途 |
| --- | --- | --- |
| `oklch(0.15 0 0)` | `var(--primary)` | 高亮线/高亮节点 |
| `oklch(0.82 0 0)` | `var(--line-color)` | 虚线回退 |
| `oklch(0.82 0 0)` | `var(--meta-divider)` | 普通节点回退 |
| `var(--page-bg, white)` | `var(--card-bg)` | 年节点打孔背景 |
| `var(--page-bg, white)` | `var(--card-bg)` | SVG drop-shadow |
| `var(--page-bg, #0d0d0d)` | `var(--card-bg)` | 暗色 drop-shadow |
| `:global(.dark) { --lh / --nh: oklch(...) }` | 删除 | 由 `:root.dark` 自动切换 |

**伪代码**：

```
原来：4 个 oklch() 强色 + 2 处 :global(.dark) 覆写 + 硬编码 white/#0d0d0d 回退
              ↓
现在：4 个 var(--primary) / var(--card-bg) / var(--line-color) / var(--meta-divider)
              ↓
效果：明暗模式、主题色相切换全部自动适配
```

---

### 3. 整体排版（宽松化）

**目标**：让文字与卡片边缘、年月块之间、标签之间都有舒展的间距。

**关键 CSS**（数值化呈现）：

```css
/* 卡片内边距 */
.archive-panel { padding: 1.25rem 1.5rem; }

/* 块间距 */
.ap-year-block       { margin-bottom: 2.75rem; }
.ap-year-block:last-child   { margin-bottom: 0; }
.ap-month-block      { margin-bottom: 1rem; }
.ap-month-block:last-child  { margin-bottom: 0; }
.ap-post-row                { min-height: 2.5rem; }
.ap-post-row:not(:last-child){ margin-bottom: 0.15rem; }

/* 标题行 */
.ap-year-header, .ap-month-header {
  min-height: calc(var(--tw) + 0.5rem);
}
.ap-year-label, .ap-month-label {
  gap: 0.75rem; padding-left: 0.75rem;
}

/* 文章链接 */
.ap-post-link {
  min-height: 2.75rem;
  padding: 0.4rem 1rem;
  gap: 1rem;
}

/* 子元素 */
.ap-date     { width: 3rem; }       /* 原 2.8rem */
.ap-meta     { gap: 0.45rem; }      /* 原 0.35rem */
.ap-meta-gap { width: 0.625rem; }   /* 原 0.5rem */

/* 移动端 */
@media (max-width: 768px) {
  .ap-post-link { padding: 0.45rem 0.7rem 0.5rem; }
}
```

---

### 4. 修复 hover 色块溢出

**问题**：`.ap-post-row:hover { transform: translateX(0.375rem); }` 让整行右移 6px，由于 `.ap-post-link` 是 `flex: 1`（占满 .ap-posts-area 剩余宽度），右边缘已贴齐容器边，悬停色块溢出右边界。

**方案**：删除 translateX，hover 反馈由三种机制承担：
- `btn-plain` 背景色变化
- `.ap-post-node` 节点放大（`scale(1.6)`）
- SVG `<path>` 高亮线从年节点连到悬停文章

```css
/* 删除 .ap-post-row:hover { transform: translateX(0.375rem); } */
```

`btn-plain` 自身的圆角背景由 `::before { inset: 0 }` 限制在 link 内部，`.ap-post-link` 也有 `overflow: hidden + border-radius` 兜底。

---

### 5. 修复虚线断裂

**问题 1**：在修第 4 项时为防止色块溢出，给 `.ap-post-list` 加了 `overflow: hidden`。但 `.ap-post-hline` 需要向左延伸 `tw/2` 连接月竖线，被裁掉左半段 → 横线与月竖线断开。

**问题 2**：`.ap-year-block::before` 与 `.ap-month-block::before` 的 `bottom: 1rem` 让竖线没有延伸到对应的最后一个分支节点中心，视觉上出现断点。

**修复**：

```css
/* 移除 overflow:hidden，由 .ap-post-link 自身 border-radius + overflow:hidden 兜底 */
.ap-post-list { list-style: none; margin: 0; padding: 0; }

/* 年竖线延伸到年块底部附近 */
.ap-year-block::before { bottom: 0.5rem; }  /* 原 1rem */

/* 月竖线精确止于最后一个文章节点中心（行高 2.5rem / 2） */
.ap-month-block::before { bottom: 1.25rem; } /* 原 1rem */
```

**虚线连接关系**（修复后）：

```
年节点 ●────┬─────● 月节点 ●───┬───● 文章节点 1
           │                  ├───● 文章节点 2
           │                  └───● 文章节点 N
           │
           └─────● 月节点 2 ──┬───● ...
                              └───● ...
```

- **年竖线**（X = `tw/2`）从年节点中心贯穿到年块底部
- **月横线**（长度 `tw`）从年主干向右连到月节点
- **月竖线**（X = `tw + tw/2`）从月节点贯穿到最后一个文章节点中心
- **文章横线** 从月分支向右连到各文章节点

修改后虚线连续无断裂。

---

### 6. 整体组件结构对照

| 结构 | Firefly 中的实现 | 备注 |
| --- | --- | --- |
| `MainGridLayout` 包装 | ✅ 保留 | 提供 Banner / 侧边栏 / 主题 |
| 页面标题 | 由 Banner 渲染 | 移除独立的标题组件 |
| `ArchivePanel` Svelte 组件 | ✅ 保留 | 主要改造对象 |
| `sortedPosts` Props | ✅ 不变 | `getSortedPostsList()` 已就绪 |
| `categoryColorPalette` | ✅ 不变 | 仍按字母排序、模 18 取色 |
| 渲染树（year / month / post） | ✅ 不变 | 增补 `:hover` / `:last-child` 类 |
| SVG hover 高亮 path | ✅ 不变 | 颜色改用 `--primary` |
| 响应式 ≤ 768px 隐藏时间线 | ✅ 保留 | 在 `@media` 内覆写 `::before` / `.ap-node` 等 |

---

## ✅ 验收结果

- `pnpm check`：0 errors / 0 warnings / 0 hints
- `pnpm build`：构建通过
- 明暗模式：虚线 / 节点 / 高亮线 / SVG drop-shadow 均自动切换，无强色残留
- 主题色相：切换 `--hue` 时高亮线/节点跟随
- 移动端：时间线隐藏，列表垂直排列正常

---

## 💡 关键设计点回顾

1. **颜色变量化优先**：组件内不出现任何 oklch / 十六进制强色，全部依赖 `variables.styl` 的 CSS 变量，使主题切换零成本
2. **删除代替覆写**：translateX 导致的溢出问题通过"删除规则 + 替换反馈机制"解决，比写 `overflow: hidden` 兜底更干净
3. **几何精确化**：竖线 `bottom` 用 `1.25rem`（= 文章行高 2.5rem / 2）精确对齐节点中心，避免视觉断点
4. **避免双重 `card-base`**：薄壳路由 + 单层卡片是项目内的常见范式，archive 页统一遵循
5. **响应式断点 ≤ 768px**：完整保留 mobile 下的隐藏策略（时间线 / 节点 / SVG 全部 `display: none`），但内边距仍存在以保持视觉密度
