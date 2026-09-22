# Facebook 个人主页帖子与完整照片集抓取

[![Run on Apify](https://img.shields.io/badge/Run%20on-Apify-2f7df6)](https://apify.com/spbotdel/facebook-profile-posts-cn)
[![AI agents](https://img.shields.io/badge/AI%20agents-MCP%20ready-6f42c1)](https://docs.apify.com/integrations/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

抓取 **Facebook 公开个人主页的最新与历史帖子**，输出干净的机器可读 JSON：正文、Facebook 发布时间、作者、互动数据、稳定帖子链接，以及**全部可恢复的照片链接**（包括藏在 `+N` 缩略图后面的照片）。

> **一个计费结果 = 一个个人主页帖子。**展开的照片链接包含在同一条数据、同一个按帖计费的价格里，不按照片收费。不需要你提供 Facebook 账号或 Cookie。

| 适合 | 不适合 |
| --- | --- |
| 公开个人主页、最新帖监控、历史回填、图片多的帖子、AI agent、MCP、API 与定时任务 | 私密/需登录的主页、小组、公共主页、Marketplace 搜索、评论展开、视频下载 |

## 为什么需要它：丢照片问题

Facebook 经常只显示几张预览图加一个 `+N` 角标，剩下的照片藏在单独的照片集里。只看预览的采集器会返回一条看起来正常的帖子，却悄悄丢掉大部分照片。

本 Actor 把照片完整度当作帖子的一部分：识别照片集 token、可疑 `+N` 布局，展开可恢复的照片集，并输出照片质量字段。

## 快速开始

1. 填入公开个人主页链接（支持数字 ID 与个性化地址），`maxPostsPerProfile` 填想要的条数。
2. 保持 **Expand all photos（展开全部照片）** 开启；置顶旧帖可用 Omit pinned posts 排除。
3. 日常监控：传入 `knownPostIds` 或 `sinceDate`，遇到已知帖子即停止，不重复花钱。
4. 历史回填：拿上一次 `SUMMARY.pointer.nextCursor`，用 `startCursor` 继续向更早翻页。

## 定价

**每 1000 个帖子 $4.99**（Free/Bronze 计划），另加每次运行 `$0.00005` 的启动事件。
付费 Apify 计划享受 Store 折扣：Silver `$4.74`，Gold/Platinum/Diamond `$4.49`/1000 帖。

| 数量 | 费用 |
| ---: | ---: |
| 20 帖 | `$0.0998` |
| 100 帖 | `$0.4990` |
| 1000 帖 | `$4.9900` |

- 一个 dataset 条目 = 一个公开个人主页帖子；
- 所有找回的照片链接都含在同一条结果里；
- 不按照片数量收费；
- 以 [Actor 页面](https://apify.com/spbotdel/facebook-profile-posts-cn)的价格卡为准。

## 常见问题

### 需要 Facebook 账号或 Cookie 吗？

不需要。只采集公开主页可见的内容。若 Facebook 临时弹出登录墙，Actor 会在 `SUMMARY` 中如实报告。

### 中文主页支持吗？

支持。正文、作者名中的中文（简体/繁体）会原样输出，照片集展开不受语言影响。

### 能采评论或私密主页吗？

评论展开与私密主页不在本 Actor 范围内。只需要公开帖子与照片——选它。

## 限制

公开主页可见什么，就采什么：被删除、被设限、过期的媒体拿不到；视频仅返回可恢复的链接，不保证下载。

## 反馈

英文原版：[facebook-profile-posts-all-photos-scraper](https://apify.com/spbotdel/facebook-profile-posts-all-photos-scraper)。遇到问题请附 run ID 与 `SUMMARY`，不要贴 Cookie 或 token。
