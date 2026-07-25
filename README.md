# OmniTool

OmniTool 是一个本地优先的浏览器工具箱。当前提供双重验证（TOTP）工具，后续可以在同一套界面中继续添加更多工具。

## 当前功能

- 添加 Base32 密钥或完整的 `otpauth://` 链接
- 临时粘贴密钥直接生成验证码，不创建或保存账户
- 通过 `/2fa/<Base32密钥>` 链接自动填入并生成验证码
- 生成 6 或 8 位 TOTP 验证码
- 支持 SHA-1、SHA-256、SHA-512 和自定义周期参数
- 一键复制、删除账户
- 自动亮色 / 暗色适配，可手动切换
- 中文 / English 切换
- 开屏、切换、进入和退出动画，支持系统“减少动态效果”
- 页面内显示全站累计访问次数和使用次数
- 响应式桌面和移动端界面
- 零运行时依赖，不加载第三方脚本、字体或分析服务

## 隐私与安全

- 站点只向同源 Worker 提交匿名的访问和使用计数，不记录 IP、设备指纹、账户名、密钥或验证码。
- “使用次数”包括成功使用快速生成器，以及复制已保存账户的验证码；每 30 秒的自动刷新不会计数。
- 2FA 数据使用浏览器 Web Crypto 生成的非导出 AES-GCM 密钥加密，并保存在当前站点的 IndexedDB 中。
- 使用 `/2fa/<密钥>` 链接时，路径会随首次请求发送给 Cloudflare；页面读取后会立即将地址栏清理为 `/2fa`，但仍不建议通过不可信渠道分享这类链接。
- 全站累计数字保存在 Cloudflare Durable Object 中，与本机 2FA 数据完全分离。
- 安全响应头由 [`src/worker.js`](src/worker.js) 统一添加，包括严格的内容安全策略（CSP）。
- 清除站点数据会永久移除已保存的账户。

浏览器存储不等同于系统钥匙串或硬件安全密钥。能够使用当前设备和浏览器会话的人仍可生成验证码；部署站点的 GitHub 和 Cloudflare 账户也应启用强密码、2FA 和最小权限。

## 本地开发

需要 Node.js 22：

```bash
npm run build
npm run test
```

构建产物位于 `dist/`。本地预览可使用任意静态文件服务器，例如：

```bash
python -m http.server 4173 --directory dist
```

也可以一次完成测试和构建：

```bash
npm run check
```

TOTP 实现通过 RFC 4226 HOTP 与 RFC 6238 TOTP 标准向量验证。

## 通过 GitHub 部署到 Cloudflare Workers

1. 将代码推送到 GitHub 仓库：`https://github.com/mibgb65-cloud/OmniTool`
2. 登录 Cloudflare，进入 **Workers & Pages**。
3. 选择 **Create application → Import a repository**。
4. 授权 GitHub，并选择 `mibgb65-cloud/OmniTool`。
5. 使用以下构建设置：

   | 设置 | 值 |
   | --- | --- |
   | Project name | `omnitool` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Path / Root directory | `/` |
   | API token | 让 Cloudflare 自动创建 |

6. 选择 **Deploy**。

`wrangler.jsonc` 会将 `dist/` 作为静态资源部署，并由 Worker 添加安全响应头和全站计数接口。首次部署时，Wrangler 会通过迁移配置自动创建 SQLite Durable Object 命名空间，不需要手动填写数据库 ID。`.node-version` 已将构建环境固定为 Node.js 22.16.0。此后向 `main` 推送会自动更新生产环境。

Cloudflare 官方说明：[Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) · [Static assets](https://developers.cloudflare.com/workers/static-assets/) · [Durable Objects](https://developers.cloudflare.com/durable-objects/)

## 项目结构

```text
src/
  app.js       页面交互与状态
  i18n.js      中英文文案
  styles.css   亮暗色与响应式样式
  totp.js      Base32、HOTP、TOTP、otpauth 解析
  vault.js     IndexedDB 与本机加密存储
  worker.js    Worker 静态资源、全站计数与安全响应头
public/
  favicon.svg  站点图标
scripts/
  build.mjs    零依赖静态构建
tests/
  totp.test.mjs
  worker.test.mjs
```
