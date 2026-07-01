---
title: 给 Firefly 主题加上 AI 总结功能
published: 2026-07-01T00:00:00.000Z
description: 本文介绍了如何为 Firefly 博客主题添加 AI 文章总结功能，包括自动化脚本生成、环境变量配置和 UI 展示。
image: 'https://img.laplace.de5.net/file/blog/cXW6zl1G.webp'
tags:
  - Firefly
  - AI
  - 教程
category: 技术分享
draft: false
slug: firefly-ai-post-summary
ai: >-
  为 Firefly 主题新增 AI 文章总结功能：构建前自动扫描文章，对缺少的调用 AI 接口生成总结并写入 Front-matter。文章详情页展示美观
  AI 总结框，支持 OpenAI 及兼容服务（如 DeepSeek、Ollama），环境变量优先，幂等且容错。接入指南提供配置与验证步骤。
---

## 功能介绍

为 Firefly 主题添加了 **AI 文章总结功能**。该功能会在构建前自动扫描所有文章，对缺少 AI 总结的文章调用 AI 接口生成总结，并将总结结果写入文章的 Front-matter 中，最终在文章详情页展示一个美观的 AI 总结框。

### 功能特性

| 特性 | 说明 |
|---|---|
| 自动化生成 | 构建前自动扫描并生成缺失的 AI 总结 |
| 幂等性 | 多次运行不会重复生成已有的总结 |
| 并发控制 | 支持配置并发请求数，避免 API 限流 |
| 多服务商兼容 | 支持 OpenAI 及兼容接口（DeepSeek、Ollama、智谱等） |
| 环境变量优先 | 优先读取系统环境变量，适配 CI/CD 部署 |
| 容错处理 | 未配置 API Key 不会影响正常构建 |

---

## 修改的文件清单

本次改动涉及以下文件：

| 文件路径 | 类型 | 说明 |
|---|---|---|
| `scripts/generate-ai-summary.js` | **新增** | AI 总结生成脚本（核心功能） |
| `src/components/features/AiSummary.astro` | **新增** | AI 总结展示组件 |
| `src/content.config.ts` | **修改** | Content Collections Schema 中添加 `ai` 字段 |
| `src/pages/posts/[...slug].astro` | **修改** | 文章详情页引入 AI 总结组件 |
| `package.json` | **修改** | 添加 `ai-summary` 脚本和构建命令 |
| `.env.example` | **新增** | 环境变量示例文件 |

### 详细说明

#### 1. `scripts/generate-ai-summary.js`（新增）

AI 总结生成的核心脚本，主要功能：

- 扫描 `src/content/posts/` 下的所有 `.md` / `.mdx` 文件
- 检查每个文件的 Front-matter 是否已有 `ai` 字段
- 对缺少总结的文章，提取正文纯文本并调用 AI API 生成总结
- 将生成的总结写入原文件的 Front-matter 的 `ai` 字段
- 支持 `--force`（强制重新生成）和 `--dry-run`（预览模式）参数

#### 2. `src/components/features/AiSummary.astro`（新增）

AI 总结的 UI 展示组件，特点：

- 展示在文章封面图之后、正文之前
- 带有 AI 图标和"AI 总结"标题
- 使用主题色的左边框和背景色，视觉区分明确
- 支持深色/浅色主题自适应
- 仅当 Front-matter 中有 `ai` 字段时才渲染

#### 3. `src/content.config.ts`（修改）

在 posts 集合的 Schema 中添加了 `ai` 字段：

```typescript
ai: z.string().optional().default(""),
```

#### 4. `src/pages/posts/[...slug].astro`（修改）

在文章详情页中引入 AiSummary 组件并添加条件渲染：

```astro
import AiSummary from "@/components/features/AiSummary.astro";

// 在文章内容区域添加
{
  entry.data.ai && (
    <AiSummary summary={entry.data.ai} />
  )
}
```

#### 5. `package.json`（修改）

添加了以下脚本：

```json
{
  "scripts": {
    "ai-summary": "node scripts/generate-ai-summary.js",
    "build": "node scripts/generate-ai-summary.js && node scripts/generate-icons.js && ..."
  }
}
```

构建命令会在执行其他步骤之前先运行 AI 总结脚本。

#### 6. `.env.example`（新增）

提供了环境变量的配置模板和说明文档。

---

## 用户接入指南

### 前提条件

- Node.js >= 22
- pnpm 包管理器
- 一个支持 OpenAI 兼容接口的 AI 服务（OpenAI、DeepSeek、Ollama 等）

### 步骤一：配置 API Key

有两种方式配置 API Key，**二选一**：

#### 方式一：本地开发使用 `.env` 文件

在项目根目录创建 `.env` 文件：

```json
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
```

#### 方式二：CI/CD 部署使用环境变量（推荐）

在 GitHub Actions、Cloudflare Pages、Vercel 等部署平台中设置环境变量：

| 环境变量名 | 是否必填 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | **必填** | AI API 的 Key |
| `OPENAI_BASE_URL` | 可选 | API 地址（默认 `https://api.openai.com/v1`） |
| `AI_MODEL` | 可选 | 模型名称（默认 `gpt-4o-mini`） |
| `AI_MAX_CONTENT_LENGTH` | 可选 | 截取正文的最大字符数（默认 `4000`） |
| `AI_SUMMARY_MAX_TOKENS` | 可选 | 生成总结的最大 token 数（默认 `300`） |
| `AI_CONCURRENCY` | 可选 | 并发请求数（默认 `3`） |

> **优先级：系统环境变量 > .env 文件**。在 CI/CD 平台设置的环境变量会自动覆盖 `.env` 中的同名变量。

### 步骤二：运行脚本

#### 手动运行

```bash
pnpm ai-summary
```

#### 构建时自动运行

```bash
pnpm build
```

构建命令已包含 AI 总结脚本，会自动在构建前生成缺失的总结。

### 步骤三：验证效果

运行完成后，检查文章的 Front-matter 中是否已自动添加 `ai` 字段：

```yaml
---
title: 我的文章
ai: 这篇文章主要讨论了...
---
```

启动开发服务器查看效果：

```bash
pnpm dev
```

---

## 常用操作

### 预览模式（不实际调用 AI）

```bash
pnpm ai-summary -- --dry-run
```

### 强制重新生成所有总结

```bash
pnpm ai-summary -- --force
```

### 重新生成单篇文章的总结

手动删除该文章 Front-matter 中的 `ai` 字段，然后运行：

```bash
pnpm ai-summary
```

### 不配置 API Key 会怎样？

未配置 API Key 时，脚本会输出提示信息并**跳过 AI 总结生成**，但**不会阻止构建**。你的博客仍然可以正常构建和部署，只是不会有 AI 总结。

---

## 兼容的 AI 服务商

只要支持 OpenAI 兼容接口的服务都可以使用：

| 服务商 | `OPENAI_BASE_URL` 示例 |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` |
| Ollama（本地） | `http://localhost:11434/v1` |
| 其他兼容服务 | 对应的 API 地址 |

---

## Front-matter 示例

### 处理前

```yaml
---
title: 我的博客文章
published: 2026-07-01
description: 这是一篇示例文章
tags:
  - 示例
---
```

### 处理后

```yaml
---
title: 我的博客文章
published: 2026-07-01
description: 这是一篇示例文章
tags:
  - 示例
ai: 这篇文章是一篇示例文章，演示了 Firefly 主题的基本功能...
---
```

---

## 注意事项

1. **API Key 安全**：不要将 API Key 硬编码到代码中，务必使用 `.env` 文件或平台环境变量
2. **`.env` 已在 `.gitignore` 中**：本地的 `.env` 文件不会被提交到 Git 仓库
3. **总结长度**：默认生成的总结不超过 100 字（约 300 tokens），保持简洁
4. **幂等性**：已有的 `ai` 字段不会被覆盖，只有缺失时才会生成
5. **错误容忍**：单篇文章的 AI 调用失败不会影响其他文章的处理和整体构建
