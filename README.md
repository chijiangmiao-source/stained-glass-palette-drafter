# 彩窗玻璃色号映射工具

老建筑彩窗修复辅助工具：把低分辨率 PNG 复原稿的每个像素归入唯一色号，统计各色玻璃用量并导出采购清单。纯前端实现（TypeScript + Vue 3 + Vite），文件仅在浏览器内用标准能力解码，不上传、不调用任何外部服务。

## 功能规则

### 输入

- **图片**：PNG 文件，宽、高各 1–128 像素。
  - 完全透明（alpha = 0）的像素视为空格；
  - 任一像素透明度不是 0 或 255 时拒绝整图；
  - 非 PNG、解码失败、尺寸越界同样拒绝，并清除旧版图、明确报错。
- **色板**：2–16 个依次排列、互不重复的六位大写十六进制色值（如 `FF0000`），每行一个（也接受空格/制表符分隔）。色板非法时清除旧版图并明确报错。

### 映射

不透明像素直接采用 8 位 sRGB 整数，计算其与各色板颜色的三通道差值平方和并取最小者；并列时取色板中最靠前者。不做伽马转换、抖动或邻域修正。

### 展示

- 可缩放的编号网格（行、列编号均从 1 开始），空格以棋盘格表示；
- 悬停任一格子显示行号、列号、原色与目标色；
- 汇总每种色板颜色的片数。

### 导出

- 按行优先记录非空格像素，每行一条记录：`行号<TAB>列号<TAB>色板序号`（均从 1 开始）；
- 三个字段以单个制表符分隔，记录以 LF 分隔，文件末尾不换行；
- 无不透明像素时导出空文件；
- 网格、统计与导出内容同源，逐格一致。

## 本地开发

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 构建到 dist/
npm run typecheck    # vue-tsc 类型检查
npm run test:unit    # Vitest 单元测试（映射与导出核心逻辑）
npm run test:e2e     # Playwright 端到端测试（自动构建并自起 preview 服务）
npm run verify       # 一次性验收：单元测试 + 端到端测试
```

## Docker 发布与验收

```bash
# 发布页面（默认宿主端口 8080，可用 WEB_PORT 覆盖）
docker compose up -d web
WEB_PORT=9000 docker compose up -d web

# 一次性验收：构建并运行名为 verify 的服务（Vitest + Playwright），
# 针对 compose 网络内的 web 服务执行，结束后自动退出
docker compose up --exit-code-from verify verify
# 或者反复验收：
docker compose run --rm verify
```

- `web` 服务：多阶段构建，nginx 托管 `dist/` 静态页面，宿主端口由 `WEB_PORT` 控制（默认 8080）。
- `verify` 服务：基于官方 Playwright 镜像，先跑 Vitest 单元测试，再对 `http://web:80` 跑 Playwright 端到端测试，覆盖映射与导出，运行一次后退出。

## 目录结构

```
src/
  core/            # 纯逻辑：色板解析、像素映射、导出文本、PNG 解码、布局常量
  components/      # GridView（可缩放编号网格）、StatsTable（用量统计）
  App.vue          # 页面组装与状态流转
tests/
  unit/            # Vitest：色板校验、映射规则、导出格式
  e2e/             # Playwright：完整流程、错误处理、边界尺寸、导出下载
Dockerfile         # web 服务镜像（构建 + nginx 发布）
Dockerfile.verify  # verify 一次性验收镜像
docker-compose.yml # web + verify 编排，WEB_PORT 覆盖宿主端口
```
