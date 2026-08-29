# GitHub 与 Cloudflare Pages 公网部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有唛头打印工作台完整推送到用户指定的 GitHub 仓库，并通过 Cloudflare Pages 自动构建为固定的 HTTPS 公网网站。

**Architecture:** 应用保持纯静态 React/Vite 架构，不增加后端或云端数据层。GitHub 的 `main` 分支是唯一生产源码，Cloudflare Pages 连接该分支，使用 pnpm 构建并发布 `dist`；业务文件、OCR 内容和草稿仍由每个访问者的浏览器本地处理与保存。

**Tech Stack:** Git、GitHub、Cloudflare Pages、React、TypeScript、Vite、pnpm、Vitest、浏览器 `localStorage` 与打印 API。

**Spec:** `docs/superpowers/specs/2026-08-29-public-github-cloudflare-deployment-design.md`

## Global Constraints

- 网站无需登录，知道网址的人都可以打开。
- 每台电脑、每个浏览器配置文件独立保存草稿，不跨设备共享。
- Excel、图片、OCR 内容和草稿继续在浏览器本地处理，不上传到应用服务器。
- 不增加后端、数据库、账号系统或云同步。
- GitHub 远端固定为 `https://github.com/hhhhez-fc/-.git`，不得强制推送或覆盖未知远端历史。
- Cloudflare Pages 生产分支为 `main`，构建命令为 `pnpm build`，输出目录为 `dist`。
- Node.js 构建版本固定为 `22.16.0`；Cloudflare 官方 Pages 构建镜像支持通过 `.node-version` 固定该版本。
- 仓库和部署配置不得包含 GitHub、Cloudflare 或其他服务的令牌。

---

## File Structure

- Create: `.gitignore` — 排除依赖、构建产物、缓存、日志、本地环境变量和 TypeScript 增量文件。
- Create: `.node-version` — 固定 Cloudflare Pages 使用的 Node.js 版本。
- Preserve: `package.json` — 继续使用现有 `pnpm build` 和 `pnpm test` 脚本，不引入部署专用运行时依赖。
- Preserve: `pnpm-lock.yaml` — Cloudflare 依据锁文件使用 pnpm 安装完全相同的依赖树。
- Preserve: `vite.config.ts` — 应用部署在 `*.pages.dev` 根路径，无需修改 Vite `base`。
- Use: `docs/superpowers/specs/2026-08-29-public-github-cloudflare-deployment-design.md` — 部署验收的需求来源。

### Task 1: 仓库卫生与可复现构建配置

**Files:**
- Create: `.gitignore`
- Create: `.node-version`

**Interfaces:**
- Consumes: 现有 Vite 根目录、`pnpm-lock.yaml` 和 TypeScript 构建输出约定。
- Produces: Git 可安全跟踪的文件集合，以及 Cloudflare 构建环境读取的 Node.js `22.16.0` 版本声明。

- [ ] **Step 1: 记录当前未跟踪文件，确认依赖和产物尚未被提交**

Run:

```powershell
git status --short
```

Expected: `node_modules/`、`dist/`、`.pnpm-store/` 和 `tsconfig.tsbuildinfo` 显示为未跟踪内容，当前只有部署设计提交处于历史中。

- [ ] **Step 2: 创建精确的忽略规则**

Create `.gitignore` with:

```gitignore
node_modules/
dist/
.pnpm-store/
coverage/
*.log
*.tsbuildinfo

.env
.env.*
!.env.example

.DS_Store
Thumbs.db
.vscode/
.idea/
```

- [ ] **Step 3: 固定 Cloudflare 构建 Node.js 版本**

Create `.node-version` with:

```text
22.16.0
```

- [ ] **Step 4: 验证忽略规则确实覆盖所有本地产物**

Run:

```powershell
$paths = @('node_modules/.probe', 'dist/index.html', '.pnpm-store/.probe', 'tsconfig.tsbuildinfo')
git check-ignore -v -- $paths
```

Expected: 四个路径分别匹配 `node_modules/`、`dist/`、`.pnpm-store/` 和 `*.tsbuildinfo`；命令不返回未匹配项。

- [ ] **Step 5: 提交仓库卫生配置**

Run:

```powershell
git add -- .gitignore .node-version
git diff --cached --check
git commit -m "chore: prepare reproducible Pages builds"
```

Expected: `git diff --cached --check` 无输出，提交成功且只包含两个新文件。

### Task 2: 完整源码基线与发布前验证

**Files:**
- Add: `DESIGN.md`
- Add: `UX-CONTRACT.md`
- Add: `index.html`
- Add: `package.json`
- Add: `pnpm-lock.yaml`
- Add: `pnpm-workspace.yaml`
- Add: `premium-audit.json`
- Add: `premium-ui.json`
- Add: `src/**`
- Add: `tests/**`
- Add: `tsconfig.json`
- Add: `vite.config.ts`
- Add: `docs/superpowers/specs/2026-08-28-label-printing-webapp-design.md`
- Add: `docs/superpowers/plans/2026-08-28-label-printing-webapp.md`
- Add: `docs/superpowers/plans/2026-08-29-github-cloudflare-deployment.md`

**Interfaces:**
- Consumes: Task 1 的忽略规则和 Node.js 构建版本声明。
- Produces: 通过全部 Vitest 测试和 Vite 生产构建、可安全推送的完整源码提交。

- [ ] **Step 1: 运行现有测试基线**

Run:

```powershell
pnpm test
```

Expected: Vitest 退出码为 `0`，所有现有测试文件与测试用例通过。

- [ ] **Step 2: 运行生产构建**

Run:

```powershell
pnpm build
```

Expected: TypeScript 和 Vite 均退出码为 `0`，生成 `dist/index.html`。

- [ ] **Step 3: 验证构建产物存在但被 Git 忽略**

Run:

```powershell
Test-Path -LiteralPath '.\dist\index.html'
git check-ignore -v -- dist/index.html
```

Expected: 第一条输出 `True`；第二条显示由 `.gitignore` 的 `dist/` 规则排除。

- [ ] **Step 4: 扫描将要提交的项目文件，阻止明显凭据进入仓库**

Run:

```powershell
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!.pnpm-store/**' -g '!.git/**' "github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY"
```

Expected: 无匹配、退出码为 `1`；若发现匹配，停止提交，移除凭据并撤销对应令牌后重新扫描。

- [ ] **Step 5: 暂存完整项目并检查文件集合**

Run:

```powershell
git add --all
git status --short
git diff --cached --check
```

Expected: `node_modules/`、`dist/`、`.pnpm-store/` 和 `tsconfig.tsbuildinfo` 不在暂存区；源码、测试、文档和锁文件均已暂存；空白检查无输出。

- [ ] **Step 6: 创建完整源码基线提交**

Run:

```powershell
git commit -m "feat: add label printing workbench"
git status --short
```

Expected: 提交成功；工作树干净。

### Task 3: 安全同步用户指定的 GitHub 仓库

**Files:**
- Modify: `.git/config` — 已存在的 `origin` 必须保持为用户指定 URL；该文件不进入提交。

**Interfaces:**
- Consumes: Task 2 的完整、已验证 `main` 历史和 `origin=https://github.com/hhhhez-fc/-.git`。
- Produces: GitHub 上与本地一致的 `main` 分支，为 Cloudflare Git 集成提供源码。

- [ ] **Step 1: 验证远端地址并只读检查远端分支**

Run:

```powershell
git remote get-url origin
git ls-remote --heads origin
```

Expected: 第一条输出 `https://github.com/hhhhez-fc/-.git`。第二条若无输出表示空仓库；若出现分支，进入 Step 2 比较历史，禁止直接覆盖。

- [ ] **Step 2: 对非空远端进行安全历史审计**

仅当 Step 1 返回远端分支时运行：

```powershell
git fetch origin --prune
git log --oneline --decorate --graph --all -20
git diff --stat main...origin/main
```

Expected: 若 `origin/main` 仅包含 README、LICENSE 或 `.gitignore` 等初始化文件，使用 `git merge origin/main --allow-unrelated-histories --no-edit` 合并并重新运行 `pnpm test` 与 `pnpm build`。若远端包含未知应用源码或敏感内容，停止并向用户报告，不执行覆盖、删除或强制推送。

- [ ] **Step 3: 获取 GitHub 写入授权**

如果 `git push` 触发登录，使用 Git Credential Manager 打开的 GitHub 官方授权页面登录 `hhhhez-fc`。不得把密码、个人访问令牌或授权响应写入项目文件、命令历史或聊天文本。

- [ ] **Step 4: 推送并设置上游分支**

Run:

```powershell
git push -u origin main
git status -sb
git ls-remote --heads origin main
```

Expected: 推送成功；状态显示 `main...origin/main` 且无领先或落后；远端 `main` 的对象 ID 与 `git rev-parse HEAD` 一致。

### Task 4: 建立 Cloudflare Pages 的 GitHub 自动部署

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: Task 3 的 GitHub `main` 分支、`pnpm-lock.yaml`、`.node-version` 和 `pnpm build`。
- Produces: 连接 `hhhhez-fc/-` 的 Cloudflare Pages 项目、成功的生产部署和固定 `https://<project>.pages.dev` 地址。

- [ ] **Step 1: 登录 Cloudflare 并进入 Pages 创建流程**

在官方 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Pages → Connect to Git**。若未登录，暂停自动操作，让用户在官方页面完成登录或免费注册后继续；不得读取或记录密码、验证码。

- [ ] **Step 2: 授权 Cloudflare GitHub App 读取目标仓库**

选择 GitHub 账号 `hhhhez-fc`，把仓库访问权限限制为 `hhhhez-fc/-`，然后返回 Cloudflare 并选择该仓库。

- [ ] **Step 3: 配置生产构建**

Set exactly:

```text
Production branch: main
Framework preset: React (Vite) / Vite
Build command: pnpm build
Build output directory: dist
Root directory: /
```

`.node-version` 已固定 Node.js `22.16.0`，不添加业务数据、令牌或其他环境变量。

- [ ] **Step 4: 首次部署并检查构建日志**

点击 **Save and Deploy**，等待生产构建完成。

Expected: 依赖安装使用 pnpm；TypeScript 与 Vite 构建成功；部署状态为 `Success`；Cloudflare 返回固定的 `https://<project>.pages.dev` 地址。若项目子域名已占用，只调整 Cloudflare 项目名，不修改 GitHub 仓库或应用标题。

- [ ] **Step 5: 验证部署提交来源**

在部署详情中核对生产分支为 `main`，部署提交哈希与以下命令一致：

```powershell
git rev-parse HEAD
```

Expected: Cloudflare 显示的提交前缀与本地 `HEAD` 前缀相同。

### Task 5: 公网功能、独立存储与自动更新验收

**Files:**
- No repository file changes unless verification exposes a deployment-specific defect.

**Interfaces:**
- Consumes: Task 4 的固定 HTTPS 地址和成功生产部署。
- Produces: 经验证的公网应用，以及可交付给用户的最终网址与更新流程。

- [ ] **Step 1: 从公网地址验证首屏与静态资源**

在浏览器打开 Cloudflare 返回的固定 HTTPS 地址，并检查页面标题为“唛头打印工作台”、主要录入区可见、开发者控制台没有资源 404 或启动异常。

- [ ] **Step 2: 验证 Excel 导入与本地草稿恢复**

导入 `tests/fixtures/sample-regions.csv`，确认生成唛头记录；修改一条内容，等待界面显示“已保存在本机”，刷新同一页面并确认修改仍存在。

- [ ] **Step 3: 验证不同浏览器上下文不共享草稿**

在无痕窗口打开同一 HTTPS 地址。

Expected: 无痕窗口不显示 Step 2 的草稿，证明数据没有从服务器或另一个浏览器配置文件同步。

- [ ] **Step 4: 验证图片、OCR 与打印入口**

导入一张 PNG/JPEG，确认图片预览或 OCR 流程可以启动；进入打印审阅并打开浏览器打印预览，确认毫米尺寸、页数和内容没有因公网部署改变。取消打印，不向物理打印机发送测试任务。

- [ ] **Step 5: 验证 Git 推送能触发自动部署**

在不改代码的情况下使用 Cloudflare Dashboard 的 **Retry deployment** 或查看 Git 集成状态，确认生产项目已开启 `main` 分支自动部署。后续实际代码提交推送到 `main` 时应自动开始新构建，无需手工上传 `dist`。

- [ ] **Step 6: 最终一致性检查**

Run:

```powershell
pnpm test
pnpm build
git status -sb
git rev-parse HEAD
git ls-remote --heads origin main
```

Expected: 测试与构建通过；工作树干净；本地 `HEAD` 与远端 `main` 对象 ID 一致；公网地址仍能加载当前版本。

---

## Completion Evidence

- 本地 `pnpm test` 和 `pnpm build` 的成功输出。
- GitHub `main` 与本地 `HEAD` 相同的提交 ID。
- Cloudflare Pages 成功部署详情中的同一提交前缀。
- 可从其他浏览器上下文打开的固定 HTTPS 地址。
- 同一浏览器刷新可恢复草稿、无痕窗口不共享草稿的验证结果。
- Excel 导入、图片/OCR 入口与打印预览在公网部署上均可工作。
