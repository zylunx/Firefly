// @ts-check
/**
 * 友链自助申请自动化处理脚本
 *
 * 配套 .github/workflows/friend-link-checker.yml 使用。
 * 由 actions/github-script 加载并调用，传入 { github, context, core }。
 *
 * 业务流程：
 *   1. 读取 Issue body，解析网站名称 / 链接 / 友链页面 / 描述 / 头像 / 标签
 *   2. 用 Playwright 访问对方友链页面，校验是否存在本站回链
 *   3. 校验通过：写入 src/config/friendsConfig.ts → Biome 格式化 → 提交 → 推送 → 评论 → 关闭 Issue
 *   4. 校验失败：评论失败原因 → 打 needs-update 标签
 *   5. issue_comment 事件：仅当评论者为 Issue 作者时，重新触发校验
 */

const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// ============================================================================
// 站点信息（务必改成你自己的）
// ============================================================================
const SITE_INFO = {
	name: "Firefly",
	url: "https://firefly.cuteleaf.cn/",
	avatar: "https://firefly.cuteleaf.cn/favicon/favicon.ico",
	desc: "Firefly 博客主题",
	friendPageUrl: "https://firefly.cuteleaf.cn/friends/",
};

// 用于回链识别的关键词（小写匹配）
// 通常用主域名 + 站名作为识别特征
const BACKLINK_MATCHERS = ["firefly.cuteleaf.cn", "firefly"];

// 友链配置文件路径（相对仓库根目录）
const FRIENDS_CONFIG_RELATIVE_PATH = "src/config/friendsConfig.ts";

// 标签
const LABEL_VERIFYING = "验证中";
const LABEL_NEEDS_UPDATE = "needs-update";

// ============================================================================
// 工具函数
// ============================================================================

/** 去掉 URL 末尾的斜杠，便于比较 */
function trimTrailingSlash(url) {
	return (url || "").trim().replace(/\/+$/, "");
}

/** 规范化 URL，无效时返回空字符串 */
function normalizeUrl(value) {
	try {
		return new URL(value.trim()).toString();
	} catch {
		return "";
	}
}

/** 转义字符串字面量内容，避免注入 */
function escapeString(value) {
	return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 从 Issue body 中解析字段
 * 兼容多种字段名称写法
 */
function parseIssueBody(body) {
	const result = {
		site_name: "",
		site_url: "",
		friend_page_url: "",
		site_desc: "",
		site_avatar: "",
		site_tag: "",
	};

	const sections = {};
	const lines = String(body || "").split(/\r?\n/);
	let currentKey = null;
	let buffer = [];

	const flush = () => {
		if (currentKey) {
			sections[currentKey] = buffer.join("\n").trim();
		}
		buffer = [];
	};

	for (const line of lines) {
		const m = line.match(/^###\s+(.+?)\s*$/);
		if (m) {
			flush();
			currentKey = m[1].trim();
		} else if (currentKey) {
			buffer.push(line);
		}
	}
	flush();

	const pick = (keys) => {
		for (const k of keys) {
			if (sections[k] != null && sections[k] !== "") {
				return sections[k];
			}
		}
		return "";
	};

	result.site_name = pick(["网站名称", "名称", "站点名称"]);
	result.site_url = pick(["网站链接", "站点链接", "链接", "网址", "地址"]);
	result.friend_page_url = pick([
		"友链页面 URL",
		"友链页面",
		"友链地址",
		"友链页面链接",
	]);
	result.site_desc = pick(["网站描述", "描述", "简介"]);
	result.site_avatar = pick(["网站头像 URL", "网站头像", "头像", "图标"]);
	result.site_tag = pick(["网站标签", "标签", "分类"]);

	// 标签字符串 -> 数组（支持中英文逗号）
	if (result.site_tag) {
		result.site_tag = result.site_tag
			.split(/[,，]/)
			.map((t) => t.trim())
			.filter(Boolean);
	} else {
		result.site_tag = [];
	}

	return result;
}

// ============================================================================
// Playwright 友链页校验
// ============================================================================

/**
 * 用浏览器访问对方友链页面，校验是否包含本站回链
 * @returns {Promise<{ok: boolean, reason: string, finalUrl?: string, status?: number}>}
 */
async function validateFriendPage(pageUrl) {
	let browser;
	try {
		browser = await chromium.launch({
			headless: true,
			args: ["--no-sandbox"],
		});
		const page = await browser.newPage();

		let response;
		let lastErr;
		// 重试 3 次
		for (let i = 0; i < 3; i++) {
			try {
				response = await page.goto(pageUrl, {
					waitUntil: "domcontentloaded",
					timeout: 12000,
				});
				if (response) {
					lastErr = null;
					break;
				}
			} catch (err) {
				lastErr = err;
			}
			await new Promise((r) => setTimeout(r, 2000));
		}

		if (!response) {
			return {
				ok: false,
				reason: `无法访问对方友链页面：${lastErr ? lastErr.message : "未知错误"}`,
			};
		}

		const status = response.status();
		const finalUrl = page.url();

		if (status >= 400 || status < 200) {
			return {
				ok: false,
				reason: `对方友链页面返回 HTTP ${status}`,
				finalUrl,
				status,
			};
		}

		// 同时抓取 HTML 内容与所有 a[href] 链接
		const htmlContent = (await page.content()) || "";
		const links = await page.evaluate(() =>
			Array.from(document.querySelectorAll("a[href]")).map((a) => a.href || ""),
		);

		const haystack = (
			htmlContent +
			"\n" +
			links.join("\n")
		).toLowerCase();

		const matched = BACKLINK_MATCHERS.some((kw) => haystack.includes(kw.toLowerCase()));

		if (!matched) {
			return {
				ok: false,
				reason: `在对方友链页面中未检测到本站回链（关键词：${BACKLINK_MATCHERS.join(", ")}）`,
				finalUrl,
				status,
			};
		}

		return { ok: true, finalUrl, status };
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
	}
}

// ============================================================================
// friendsConfig.ts 解析与渲染
// ============================================================================

/**
 * 从 friendsConfig.ts 文件内容中提取 friendsConfig 数组里的对象列表
 *
 * 这里不依赖 TS AST，采用"对象块拆分 + 字段正则提取"的轻量实现。
 * 优点是无额外依赖；缺点是若文件结构发生重大变化，需要同步调整。
 */
function parseFriendsConfig(content) {
	// 1. 截出 friendsConfig 数组主体
	// 注意：用 "friendsConfig:" 而非 "friendsConfig"，避免误匹配 import 路径中的 friendsConfig
	const declStart = content.indexOf("friendsConfig:");
	if (declStart === -1) {
		throw new Error("找不到 friendsConfig 声明");
	}
	// 找到 = 之后的 [（跳过类型标注 FriendLink[]）
	const eqPos = content.indexOf("=", declStart);
	if (eqPos === -1) {
		throw new Error("找不到 friendsConfig 的 = 赋值符号");
	}
	const bracketStart = content.indexOf("[", eqPos);
	if (bracketStart === -1) {
		throw new Error("找不到 friendsConfig 数组起始 [");
	}

	// 找到匹配的 ]（简单计数，不考虑字符串内的 ] —— 但项目当前文件结构安全）
	let depth = 0;
	let bracketEnd = -1;
	for (let i = bracketStart; i < content.length; i++) {
		const ch = content[i];
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) {
				bracketEnd = i;
				break;
			}
		}
	}
	if (bracketEnd === -1) {
		throw new Error("找不到 friendsConfig 数组结束 ]");
	}

	const arrayBody = content.slice(bracketStart + 1, bracketEnd);

	// 2. 拆出顶层对象块（每个以 `{` 开始、匹配 `}` 结束）
	const blocks = [];
	let objStart = -1;
	let objDepth = 0;
	for (let i = 0; i < arrayBody.length; i++) {
		const ch = arrayBody[i];
		if (ch === "{") {
			if (objDepth === 0) objStart = i;
			objDepth++;
		} else if (ch === "}") {
			objDepth--;
			if (objDepth === 0 && objStart !== -1) {
				blocks.push(arrayBody.slice(objStart, i + 1));
				objStart = -1;
			}
		}
	}

	// 3. 对每个对象块抽取字段
	const friends = blocks.map((block) => {
		/** 提取字符串字段值（支持值换行、跨多行） */
		const pickStr = (key) => {
			// 匹配 `key: "value"` 或 `key:\n\t"value"`
			const re = new RegExp(`${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m");
			const m = block.match(re);
			return m ? m[1] : "";
		};
		/** 提取数字字段值 */
		const pickNum = (key) => {
			const re = new RegExp(`${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
			const m = block.match(re);
			return m ? Number(m[1]) : undefined;
		};
		/** 提取布尔字段值 */
		const pickBool = (key) => {
			const re = new RegExp(`${key}\\s*:\\s*(true|false)`);
			const m = block.match(re);
			return m ? m[1] === "true" : undefined;
		};
		/** 提取字符串数组字段值（如 ["Blog", "Docs"]，支持跨行） */
		const pickStrArray = (key) => {
			const re = new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`);
			const m = block.match(re);
			if (!m) return undefined;
			return (m[1].match(/"((?:[^"\\\\]|\\\\.)*)"/g) || []).map((s) =>
				s.slice(1, -1),
			);
		};

		const weight = pickNum("weight");
		const enabled = pickBool("enabled");
		const issueId = pickNum("issue_id");

		return {
			title: pickStr("title"),
			imgurl: pickStr("imgurl"),
			desc: pickStr("desc"),
			siteurl: pickStr("siteurl"),
			tags: pickStrArray("tags") || [],
			weight: weight == null ? 0 : weight,
			enabled: enabled == null ? true : enabled,
			...(issueId == null ? {} : { issue_id: issueId }),
		};
	});

	return friends;
}

/**
 * 渲染单个友链对象为 TS 字面量（缩进：4 个 tab）
 */
function renderFriend(friend, indent = "\t\t\t") {
	const lines = [];
	lines.push(`${indent}{`);
	lines.push(`${indent}\ttitle: "${escapeString(friend.title)}",`);
	lines.push(`${indent}\timgurl: "${escapeString(friend.imgurl)}",`);
	lines.push(`${indent}\tdesc: "${escapeString(friend.desc)}",`);
	lines.push(`${indent}\tsiteurl: "${escapeString(friend.siteurl)}",`);
	const tags = (friend.tags || []).map((t) => `"${escapeString(t)}"`).join(", ");
	lines.push(`${indent}\ttags: [${tags}],`);
	lines.push(`${indent}\tweight: ${friend.weight},`);
	lines.push(`${indent}\tenabled: ${friend.enabled ? "true" : "false"},`);
	if (friend.issue_id != null) {
		lines.push(`${indent}\tissue_id: ${friend.issue_id},`);
	}
	lines.push(`${indent}},`);
	return lines.join("\n");
}

/**
 * 重写 friendsConfig.ts 文件
 *
 * 只替换 friendsConfig 数组部分，保留文件中其它内容（import / 注释 / friendsPageConfig / getEnabledFriends）
 */
function updateFriendsConfig(repoRoot, friends) {
	const filePath = path.join(repoRoot, FRIENDS_CONFIG_RELATIVE_PATH);
	const original = fs.readFileSync(filePath, "utf8");

	// 定位数组范围（用 "friendsConfig:" 避免误匹配 import 路径）
	const declStart = original.indexOf("friendsConfig:");
	if (declStart === -1) {
		throw new Error("找不到 friendsConfig 声明");
	}
	const eqPos = original.indexOf("=", declStart);
	if (eqPos === -1) {
		throw new Error("找不到 friendsConfig 的 = 赋值符号");
	}
	const bracketStart = original.indexOf("[", eqPos);

	let depth = 0;
	let bracketEnd = -1;
	for (let i = bracketStart; i < original.length; i++) {
		const ch = original[i];
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) {
				bracketEnd = i;
				break;
			}
		}
	}
	if (bracketEnd === -1) {
		throw new Error("无法定位 friendsConfig 数组结束位置");
	}

	// 渲染新数组
	const rendered =
		friends.length === 0
			? ""
			: "\n" + friends.map((f) => renderFriend(f)).join("\n");

	const next =
		original.slice(0, bracketStart + 1) +
		rendered +
		"\n" +
		original.slice(bracketEnd);

	fs.writeFileSync(filePath, next, "utf8");
}

/**
 * 调用仓库内的 Biome 对 friendsConfig.ts 进行格式化
 *
 * 这一步非常关键：脚本写入的 TS 字面量不一定符合仓库 Biome 格式要求，
 * 不格式化会导致后续 biome ci 报 "File content differs from formatting output"。
 */
function formatFriendsConfig(repoRoot) {
	const bin = path.join(repoRoot, "node_modules", ".bin", "biome");
	execFileSync(
		process.platform === "win32" ? `${bin}.cmd` : bin,
		["format", "--write", FRIENDS_CONFIG_RELATIVE_PATH],
		{ cwd: repoRoot, stdio: "inherit" },
	);
}

// ============================================================================
// Git 操作
// ============================================================================

function gitExec(repoRoot, args) {
	execFileSync("git", args, { cwd: repoRoot, stdio: "inherit" });
}

async function getDefaultBranch() {
	const { data } = await octokit.rest.repos.get({
		owner: context.repo.owner,
		repo: context.repo.repo,
	});
	return data.default_branch;
}

// ============================================================================
// GitHub API 封装
// ============================================================================

let octokit;
let context;
let core;

async function commentOnIssue(issueNumber, body) {
	await octokit.rest.issues.createComment({
		owner: context.repo.owner,
		repo: context.repo.repo,
		issue_number: issueNumber,
		body,
	});
}

async function addLabels(issueNumber, labels) {
	await octokit.rest.issues.addLabels({
		owner: context.repo.owner,
		repo: context.repo.repo,
		issue_number: issueNumber,
		labels,
	});
}

async function removeLabel(issueNumber, name) {
	try {
		await octokit.rest.issues.removeLabel({
			owner: context.repo.owner,
			repo: context.repo.repo,
			issue_number: issueNumber,
			name,
		});
	} catch (err) {
		// 标签可能本来就不存在，忽略
		core.warning(`removeLabel failed: ${err && err.message}`);
	}
}

async function closeIssue(issueNumber) {
	await octokit.rest.issues.update({
		owner: context.repo.owner,
		repo: context.repo.repo,
		issue_number: issueNumber,
		state: "closed",
		state_reason: "completed",
	});
}

// ============================================================================
// 失败/成功回复文案
// ============================================================================

function buildFailureMessage({ parsed, validation, issueNumber }) {
	const lines = [];
	lines.push("## ❌ 友链校验未通过");
	lines.push("");
	lines.push(`Issue #${issueNumber} 的友链申请未通过自动校验。`);
	lines.push("");
	lines.push("### 申请信息");
	lines.push(`- 网站名称：${parsed.site_name || "(未填写)"}`);
	lines.push(`- 网站链接：${parsed.site_url || "(未填写)"}`);
	lines.push(`- 友链页面：${parsed.friend_page_url || "(未填写)"}`);
	if (validation.finalUrl && validation.finalUrl !== parsed.friend_page_url) {
		lines.push(`- 实际跳转：${validation.finalUrl}`);
	}
	if (validation.status != null) {
		lines.push(`- HTTP 状态：${validation.status}`);
	}
	lines.push("");
	lines.push("### 失败原因");
	lines.push(validation.reason);
	lines.push("");
	lines.push("### 请按以下步骤修复");
	lines.push(`1. 先在你的站点友链页面加入本站信息：`);
	lines.push(`   - 站点名称：${SITE_INFO.name}`);
	lines.push(`   - 站点链接：${SITE_INFO.url}`);
	lines.push(`   - 站点头像：${SITE_INFO.avatar}`);
	lines.push(`   - 站点描述：${SITE_INFO.desc}`);
	lines.push(`2. 确认页面能正常打开，且回链 URL 指向 \`${SITE_INFO.url}\``);
	lines.push(`3. 修复后**直接回复本 Issue**（需为申请人本人评论），系统会自动重新校验`);
	lines.push("");
	lines.push(`> 已为本 Issue 打上 \`${LABEL_NEEDS_UPDATE}\` 标签。`);
	return lines.join("\n");
}

function buildSuccessMessage({ parsed, issueNumber }) {
	const lines = [];
	lines.push("## ✅ 友链已成功添加");
	lines.push("");
	lines.push(`Issue #${issueNumber} 的友链申请已通过校验并写入仓库。`);
	lines.push("");
	lines.push("### 已添加的友链信息");
	lines.push(`- 网站名称：${parsed.site_name}`);
	lines.push(`- 网站链接：${parsed.site_url}`);
	lines.push(`- 友链页面：${parsed.friend_page_url}`);
	if (parsed.site_desc) lines.push(`- 网站描述：${parsed.site_desc}`);
	if (parsed.site_avatar) lines.push(`- 网站头像：${parsed.site_avatar}`);
	if (parsed.site_tag && parsed.site_tag.length) {
		lines.push(`- 网站标签：${parsed.site_tag.join(", ")}`);
	}
	lines.push("");
	lines.push(
		"提交后会在下一次部署构建时出现在 [/friends/](https://firefly.cuteleaf.cn/friends/) 页面。",
	);
	lines.push("");
	lines.push("感谢互换友链！");
	return lines.join("\n");
}

// ============================================================================
// 主流程
// ============================================================================

async function processOpenedOrReopened({ issue, issueNumber }) {
	// 1. 解析 Issue body
	const body = issue.body || "";
	const parsed = parseIssueBody(body);

	if (!parsed.site_name || !parsed.site_url || !parsed.friend_page_url) {
		await commentOnIssue(
			issueNumber,
			[
				"## ⚠️ 表单字段缺失",
				"",
				"检测到必填字段缺失（网站名称 / 网站链接 / 友链页面 URL）。",
				"请编辑本 Issue 补全信息后再重新打开。",
			].join("\n"),
		);
		return;
	}

	// 2. URL 规范化
	const normalizedSiteUrl = normalizeUrl(parsed.site_url);
	const normalizedFriendPageUrl = normalizeUrl(parsed.friend_page_url);
	if (!normalizedSiteUrl || !normalizedFriendPageUrl) {
		await commentOnIssue(
			issueNumber,
			[
				"## ⚠️ URL 格式无效",
				"",
				`- 网站链接：\`${parsed.site_url}\``,
				`- 友链页面：\`${parsed.friend_page_url}\``,
				"",
				"请提供合法的 http/https URL。",
			].join("\n"),
		);
		return;
	}

	// 3. 打"验证中"标签
	await addLabels(issueNumber, [LABEL_VERIFYING]);
	if (issue.labels) {
		await removeLabel(issueNumber, LABEL_NEEDS_UPDATE);
	}

	// 4. 校验友链页面
	const validation = await validateFriendPage(normalizedFriendPageUrl);
	if (!validation.ok) {
		await commentOnIssue(
			issueNumber,
			buildFailureMessage({ parsed, validation, issueNumber }),
		);
		await removeLabel(issueNumber, LABEL_VERIFYING);
		await addLabels(issueNumber, [LABEL_NEEDS_UPDATE]);
		return;
	}

	// 5. 写入 friendsConfig.ts
	const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
	const filePath = path.join(repoRoot, FRIENDS_CONFIG_RELATIVE_PATH);
	const original = fs.readFileSync(filePath, "utf8");
	const friends = parseFriendsConfig(original);

	const newFriend = {
		title: parsed.site_name,
		imgurl: parsed.site_avatar || SITE_INFO.avatar,
		desc: parsed.site_desc || "",
		siteurl: normalizedSiteUrl,
		tags:
			parsed.site_tag && parsed.site_tag.length
				? parsed.site_tag
				: ["Blog"],
		weight: 5,
		enabled: true,
		issue_id: issueNumber,
	};

	const normalizedUrl = trimTrailingSlash(normalizedSiteUrl);
	const existingIndex = friends.findIndex(
		(f) => trimTrailingSlash(f.siteurl) === normalizedUrl,
	);

	if (existingIndex >= 0) {
		friends[existingIndex] = { ...friends[existingIndex], ...newFriend };
	} else {
		friends.push(newFriend);
	}

	updateFriendsConfig(repoRoot, friends);

	// 6. Biome 格式化
	formatFriendsConfig(repoRoot);

	// 7. Git 提交推送
	const defaultBranch = await getDefaultBranch();
	gitExec(repoRoot, ["config", "user.name", "github-actions[bot]"]);
	gitExec(repoRoot, [
		"config",
		"user.email",
		"github-actions[bot]@users.noreply.github.com",
	]);
	gitExec(repoRoot, ["add", FRIENDS_CONFIG_RELATIVE_PATH]);
	gitExec(repoRoot, [
		"commit",
		"-m",
		`🤝 更新友链: ${parsed.site_name}`,
	]);
	try {
		gitExec(repoRoot, ["pull", "--rebase", "origin", defaultBranch]);
	} catch (err) {
		core.warning(`git pull --rebase failed: ${err && err.message}`);
	}
	gitExec(repoRoot, ["push", "origin", `HEAD:${defaultBranch}`]);

	// 8. 评论成功并关闭 Issue
	await commentOnIssue(issueNumber, buildSuccessMessage({ parsed, issueNumber }));
	await removeLabel(issueNumber, LABEL_VERIFYING);
	await removeLabel(issueNumber, LABEL_NEEDS_UPDATE);
	await closeIssue(issueNumber);
}

async function processIssueComment({ issue, comment, issueNumber }) {
	// 仅当评论者为 Issue 作者时，触发重新校验
	if (!comment || !issue || comment.user?.login !== issue.user?.login) {
		core.info(
			`Comment author ${comment?.user?.login} is not the issue author ${issue?.user?.login}, skipping.`,
		);
		return;
	}

	// Issue 必须是 open 状态
	if (issue.state && issue.state !== "open") {
		core.info(`Issue state is ${issue.state}, skipping.`);
		return;
	}

	// 重新打开场景：复用 opened 流程
	core.info(`Re-validating friend request issue #${issueNumber}`);
	await processOpenedOrReopened({ issue, issueNumber });
}

// ============================================================================
// 入口
// ============================================================================

module.exports = async function handler({ github, context: ctx, core: c }) {
	octokit = github;
	context = ctx;
	core = c;

	const eventName = context.eventName;
	const action = context.payload.action;
	const issue = context.payload.issue;
	const issueNumber = issue?.number;

	if (!issueNumber) {
		core.info("No issue number found, skipping.");
		return;
	}

	// 仅处理包含友链申请字段标记的 Issue，避免误处理其它普通 Issue
	const body = issue.body || "";
	const isFriendRequest =
		body.includes("### 网站名称") && body.includes("### 网站链接");
	if (!isFriendRequest) {
		core.info("Issue body does not look like a friend request, skipping.");
		return;
	}

	core.info(
		`Processing friend request: event=${eventName} action=${action} issue=#${issueNumber}`,
	);

	if (eventName === "issues" && (action === "opened" || action === "reopened")) {
		await processOpenedOrReopened({ issue, issueNumber });
	} else if (eventName === "issue_comment" && action === "created") {
		await processIssueComment({
			issue,
			comment: context.payload.comment,
			issueNumber,
		});
	} else {
		core.info(`Event/action ${eventName}.${action} not handled, skipping.`);
	}
};
