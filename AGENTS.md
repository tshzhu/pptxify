# PPTXify 开发与维护手册

本文件适用于 `/scratch1/workspace/useful-tiny-tools/beamer-to-ppt`。同时继承
`/scratch1/workspace/AGENTS.md` 的工作区约束；如有冲突，以更严格的约束为准。

## 先记住这两套流程

### 日常开发：四步

1. `git pull --ff-only`，确认 `git status` 干净。
2. `npm ci`，修改 `src/`、`index.html`、`public/` 或文档。
3. 运行 `npm run check && npm run build:all`；涉及 CLI 打包时再运行
   `npm run pack:check`。
4. 做与改动相符的浏览器/CLI 回归，提交并推送 `main`。

### 发布 npm：六步

1. 按 SemVer 更新 `package.json` 和 `package-lock.json` 中的版本。
2. 运行 `npm ci`、`npm run check`、`npm run build:all`、
   `npm run pack:check`，再从 tarball 临时安装并运行 CLI。
3. 提交 release commit，推送并确认 commit 已在 `origin/main`。
4. 创建完全匹配版本的 tag，例如 `v1.0.1`，并推送该 tag。
5. `.github/workflows/publish.yml` 通过 npm Trusted Publishing/OIDC 自动执行
   `npm publish`；不要在 workflow 中添加 `NPM_TOKEN`。
6. 确认 npm 的 `latest`、CLI `--version`、GitHub Actions、tag 和 GitHub Release
   都指向同一版本。

## 项目边界与不变量

- 产品有两个入口：GitHub Pages 浏览器应用和 npm 上的 `pptxify` CLI。
- 两条路径均执行 PDF → PNG → 图片化 PPTX，保持 PDF 的物理页面尺寸。
- 所有转换都在用户本地运行，不上传 PDF、notes、图片或 PPTX。
- 输出 slide 是一张铺满页面的 PNG，不提供可编辑文本或图形对象。
- 浏览器与 CLI 共用 PPI、页数、像素、Canvas、文件大小和同页尺寸校验。
- speaker notes 只接受 `## page: N`，不兼容旧的 `## frame:`。
- CLI 命令名、npm 包名和仓库名保持小写 `pptxify`；产品品牌写作 `PPTXify`。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `index.html` | 浏览器页面骨架、标题、图标和交互控件 |
| `src/main.ts` | 浏览器 UI 状态、上传、转换、下载和 notes 交互 |
| `src/converter.ts` | 浏览器 PDF.js/Canvas/PptxGenJS 转换管线 |
| `src/cli.ts` | CLI 参数、Node Canvas、原子写入和退出行为 |
| `src/core.ts` | 浏览器/CLI 共享的检查、估算和有界有序并发 |
| `src/limits.ts` | PPI、文件、页面、像素和 Canvas 限制及错误类型 |
| `src/notes.ts` | `## page: N` notes 语法解析和校验 |
| `src/pptx-notes.ts` | 使用 JSZip 读取和修改 PPTX speaker-note XML |
| `src/styles.css` | 网站样式 |
| `public/icons/` | favicon、manifest 和应用图标 |
| `vite.config.ts` | 浏览器构建及 PDF.js 资源复制 |
| `tsconfig.cli.json` | 编译 `dist-cli/` 中的 CLI 模块 |
| `scripts/check-package.mjs` | npm tarball 文件白名单检查 |
| `.github/workflows/pages.yml` | `main` 更新时构建和部署 GitHub Pages |
| `.github/workflows/publish.yml` | `v*` tag 更新时通过 OIDC 发布 npm |

`dist/`、`dist-cli/`、`public/pdfjs/`、`node_modules/`、本地 `example/` 和 `.tmp/`
均是忽略内容。不要手工编辑或提交生成产物。本地 `example/` 不是仓库/包的一部分，
CI 和正式测试不能依赖其存在。

## 架构与数据流

### 浏览器

1. `main.ts` 接收 `File`，调用 `inspectPdfFile()` 做签名、大小、页数和尺寸检查。
2. 用户调整 PPI 时只重新计算像素估算，不重复读取 PDF。
3. `convertPdfToPptx()` 复用 inspection，PDF.js 在 Canvas 上渲染 PNG。
4. 小页面最多并行两页，大页面串行；`processInOrder()` 保证 slide 页序稳定。
5. PptxGenJS 使用与 PDF 相同的英寸尺寸创建 PPTX。
6. notes 修改只 patch PPTX XML，不重新渲染 PDF。

### CLI

1. `cli.ts` 解析一个 PDF 路径及 `--ppi`、`--output`、`--notes`、`--quiet`。
2. 在读取前后检查 100 MB 上限，校验 PDF header，再进入共享检查/估算逻辑。
3. PDF.js 资源必须用 Node 模块解析定位，不能假定依赖位于
   `pptxify/node_modules`；npm 可能把依赖提升到上级目录。
4. `@napi-rs/canvas` 渲染并编码 PNG，PptxGenJS 生成 Node Buffer。
5. 输出先写同目录临时文件，再 rename 到目标，失败时保留已有输出。
6. 进度写 stderr，成功路径写 stdout；成功为 0，参数错误通常为 2，转换失败为 1。

## 本地环境与常用命令

```sh
source /scratch1/workspace/env.sh
cd /scratch1/workspace/useful-tiny-tools/beamer-to-ppt
npm ci
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run check` | TypeScript 类型检查 |
| `npm run build` | 构建网站到 `dist/` |
| `npm run build:cli` | 构建 CLI 到 `dist-cli/` |
| `npm run build:all` | 构建网站和 CLI |
| `npm run pack:check` | dry-run npm tarball 并校验文件白名单 |
| `npm run preview` | 预览已有的 `dist/` |
| `node dist-cli/cli.js --help` | 运行 checkout 中构建的 CLI |

改变依赖时使用 npm 并提交 `package.json` 和 `package-lock.json`。依赖采用精确版本；
不要手工编辑 `node_modules`，不要提交 `dist/` 或 `dist-cli/`。

## 测试与验收

仓库当前没有独立的 `npm test` suite，因此每次改动至少完成：

```sh
npm run check
npm run build:all
npm run pack:check
node dist-cli/cli.js --help
node dist-cli/cli.js --version
```

涉及转换逻辑、依赖或发布时，再完成以下回归：

- 用一个多页、同尺寸 PDF 运行 72 PPI 和至少一个高 PPI 转换。
- 检查 PPTX 的 slide 数、`ppt/media/*.png` 数和 notes container 数等于 PDF 页数。
- 使用 `.md`/`.txt` notes 校验注入内容；确认非法、重复、越界或空 notes 失败。
- 检查无效 PDF、超 100 MB、超页数、mixed-size、非法 PPI 和同输入/输出路径。
- 对 tarball 做临时 prefix 安装，验证 `pptxify --version`、`--help` 和真实转换。
- 发布后从空目录运行 `npx pptxify@<version> --version` 和一次真实转换。

Vite 的大 chunk 提示当前是已知 warning，不等于构建失败。`npm audit --omit=dev`
目前仍可能报告 PptxGenJS → `image-size` 的上游 advisory；升级前先确认 PptxGenJS
正式版本兼容性，不要使用 `npm audit fix --force` 自动降级或破坏依赖图。

## npm 包边界

npm 包只发布 CLI。`package.json#files` 允许：

- `dist-cli/` 中 CLI 编译模块、declarations 和 source maps
- `README.md`
- `LICENSE`
- npm 自动包含的 `package.json`

不得包含 `dist/`、`src/`、`public/`、`index.html`、Vite/TypeScript 配置、测试数据或
维护脚本。`scripts/check-package.mjs` 会拒绝白名单之外的文件；任何新增 CLI 模块都
必须同步更新它的允许规则，并通过 tarball 安装测试。

运行时依赖必须放在 `dependencies`，构建/类型工具放在 `devDependencies`。当前 CLI
需要 `@napi-rs/canvas`、`@xmldom/xmldom`、`jszip`、`pdfjs-dist` 和 `pptxgenjs`。

## npm Trusted Publishing

### npm 侧一次性配置

在 <https://www.npmjs.com/package/pptxify/access> 的 Trusted Publisher 设置中填写：

- Provider：GitHub Actions
- Organization or user：`tshzhu`
- Repository：`pptxify`
- Workflow filename：`publish.yml`（只填文件名）
- Environment：留空（workflow 没有配置 environment）
- Allowed action：`npm publish`

也可使用支持 `npm trust` 的最新 npm CLI 执行一次：

```sh
npx --yes npm@latest trust github pptxify \
  --file publish.yml \
  --repo tshzhu/pptxify \
  --allow-publish \
  --yes
```

该信任关系只需配置一次；只有 workflow 文件名、仓库或 environment 改变时才更新。
Workflow 使用 GitHub-hosted runner、Node 24、最新 npm 和 `id-token: write`，不使用
长期 `NPM_TOKEN`。OIDC 发布会自动生成 npm provenance。

Trusted Publisher 首次成功后，可在 npm Publishing access 中启用“Require 2FA and
disallow tokens”，并撤销不再需要的写 token；执行前先确认 tag workflow 已成功发布。

### 发版步骤

以下示例发布 `1.0.1`：

```sh
# 1. 更新 package.json 与 package-lock.json 的版本
npm version 1.0.1 --no-git-tag-version

# 2. 验证
npm ci
npm run check
npm run build:all
npm run pack:check

# 3. 提交并推送 main
git add package.json package-lock.json README.md
git commit -m "release: prepare npm package v1.0.1"
git push origin main

# 4. 仅在 main 已同步后创建并推送 tag
git tag v1.0.1
git push origin v1.0.1
```

`publish.yml` 会再次构建和校验，并且只有在以下条件全部成立时发布：

- tag 以 `v` 开头并与 `package.json#version` 完全一致
- CLI `--version` 与 package version 一致
- tagged commit 可从 `origin/main` 到达
- npm 上尚不存在该版本
- tarball 文件白名单检查通过

npm 版本不可覆盖。若 workflow 在发布前失败，可修复后删除/重建错误 tag；若 npm
已发布成功，绝对不要移动或复用该 tag/version，应发布新的 patch 版本。

发布完成后验证：

```sh
npm view pptxify version dist-tags bin engines
npx --yes pptxify@1.0.1 --version
gh run list --workflow publish.yml --limit 5
gh release create v1.0.1 --verify-tag --generate-notes --title v1.0.1
```

## GitHub Pages

`pages.yml` 与 npm 发布完全分离：

- push 到 `main`：构建网站并部署 `dist/`
- push `v*` tag：运行 npm Trusted Publishing workflow
- tag push 不替代 main push；发版前必须先让 release commit 进入 `main`

Pages workflow 只需要 `contents: read`、`pages: write` 和 `id-token: write`，不得加入
npm token。发布 workflow 只需要 `contents: read` 和 `id-token: write`，不得获得 Pages
或仓库写权限。

## 故障排查

- **Trusted Publishing 无法认证**：检查 npm 中的用户、仓库、`publish.yml` 文件名和
  environment 是否逐字匹配；确认使用 GitHub-hosted runner、`id-token: write`、
  Node ≥22.14 和 npm ≥11.5.1。
- **tag/version mismatch**：同时更新 package 与 lock，重新构建，创建 `v<version>`。
- **tag 不在 main**：先推 release commit 到 main，再重新创建尚未发布的 tag。
- **版本已存在**：不能覆盖，提升 patch/minor/major 后重新走流程。
- **tarball 有网站文件**：检查 `package.json#files` 与 `pack:check` 白名单。
- **安装后找不到 PDF.js worker**：必须用 Node 模块解析定位 `pdfjs-dist`，不能拼接
  `pptxify/node_modules/pdfjs-dist` 固定路径。
- **本地可用、npm 安装后失败**：优先用空 prefix 安装 tarball复现，检查依赖提升、
  `engines`、bin shebang 和 tarball 文件清单。
- **Pages 成功但 npm 未发布**：两套 workflow 触发条件不同；确认是否推送了 tag。

## 当前发布基线

- npm package：`pptxify@1.0.0`
- npm dist-tag：`latest = 1.0.0`
- Git tag / GitHub Release：`v1.0.0`
- Node engine：`>=22`
- `v1.0.0` 是手工 bootstrap 发布；后续版本必须通过 `publish.yml`。
