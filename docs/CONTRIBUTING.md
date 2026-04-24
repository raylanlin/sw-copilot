# 贡献指南

感谢你对 SW Copilot 的关注！以下是参与贡献的指南。

---

## 开发环境搭建

### 前置要求

- Node.js >= 20.0.0
- npm >= 10.0.0
- Python >= 3.10
- Git
- SolidWorks 2017+（测试时需要）
- Visual Studio Build Tools（编译 winax 原生模块）

### 获取代码

```bash
git clone https://github.com/yourname/sw-copilot.git
cd sw-copilot
npm install
```

如果 `npm install` 在编译 winax 时报错，安装 VS Build Tools：

```bash
npm install --global windows-build-tools
```

### 启动开发模式

```bash
npm run dev
```

这会同时启动 Electron 主进程和 React 渲染进程的热重载。

---

## 项目结构

```
src/
├── main/          # Electron 主进程（Node.js）
│   ├── llm/       # AI 服务适配器
│   ├── com/        # SolidWorks COM 桥接
│   ├── scripts/    # 脚本引擎与安全校验
│   └── store/      # 持久化配置
├── renderer/       # Electron 渲染进程（React）
│   ├── components/ # UI 组件
│   ├── hooks/      # React Hooks
│   └── themes/     # 主题定义
└── shared/         # 主进程/渲染进程共享类型
```

---

## 贡献方式

### 1. 报告 Bug

在 Issues 中提交 bug 报告，请包含：

- 操作系统版本
- SolidWorks 版本
- SW Copilot 版本
- 复现步骤
- 期望行为 vs 实际行为
- 错误日志（如有）

### 2. 提交自动化模板

在 `src/main/scripts/templates/` 目录下添加新模板：

- VBA 模板：`.vba` 文件
- Python 模板：`.py` 文件

模板文件头部添加元信息注释：

```vba
' @name: 批量导出钣金展开图
' @description: 将装配体中所有钣金零件的展开图导出为 DXF
' @category: export
' @author: your-github-username
```

### 3. 适配新的 CAD 软件

如果你想为其他 CAD 软件（Inventor、CATIA、NX 等）添加支持：

1. 在 `src/main/com/` 下创建新的桥接模块
2. 实现与 `SolidWorksBridge` 相同的接口
3. 注册对应的工具函数
4. 更新系统提示词以包含新软件的 API 知识

### 4. 改进 UI

- 遵循现有的主题系统（light/dark 两套配色）
- 所有颜色值通过主题对象 `t` 引用，不要硬编码
- 保持浅灰 + 深灰的整体风格

---

## 代码规范

- TypeScript 严格模式
- 使用 ESLint + Prettier
- 组件使用函数式组件 + Hooks
- 文件命名：kebab-case
- 变量命名：camelCase
- 类型命名：PascalCase
- 提交信息遵循 Conventional Commits

```
feat: 添加干涉检查工具
fix: 修复 COM 连接心跳检测误报
docs: 更新百炼配置说明
chore: 升级 Electron 到 v29
```

---

## Pull Request 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 开发并测试
4. 提交 PR，描述改动内容和测试结果
5. 等待代码审查

---

## 许可证

贡献的代码将以 MIT 许可证发布。
