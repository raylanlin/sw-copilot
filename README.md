# SW Copilot

**开源的 SolidWorks AI 自动化助手** — 用自然语言驱动 SolidWorks，自由选择任意 AI 后端。

---

## 为什么做这个？

市面上的 CAD AI 助手（如 MecAgent）要求绑定特定 AI 服务商，按月收费 $16-417，且底层模型能力有限。

SW Copilot 的理念是：**AI 后端由你决定**。你可以接入 Claude、GPT-4o、DeepSeek、Qwen、MiniMax，甚至 Ollama 本地模型。代码开源，个人免费使用（MIT + Commons Clause 非商用许可，商用需授权）。

## 架构亮点

- **零依赖 COM 连接**：通过 Windows 自带的 `cscript.exe` 执行 VBScript 连接 SolidWorks，无需安装 winax 等原生模块。支持 `GetObject` → `CreateObject` 自动 fallback，兼容 SW 未注册 ROT 的场景。
- **UTF-16LE+BOM 编码**：解决中文注释和字符串在 cscript 中的编译错误。
- **VBA → VBScript 转换器**：10 步自动转换（类型移除、错误处理替换、Sub 展开等），支持 AI 直接生成的 VBA 代码。
- **VBS 执行结果回传**：通过临时 JSON 文件，实现 cscript 脚本执行结果→Electron 主进程→前端 UI 的完整链路。

## 功能

- 自然语言 → SolidWorks 操作（VBA 宏 / Python 脚本）
- 支持 Anthropic 协议 + OpenAI 兼容协议
- 零插件安装，通过 COM 接口直连 SolidWorks
- 自动兼容中英文 SolidWorks 模板（基准面名称自动 fallback）
- 内置常用自动化模板（批量修改、导出、BOM 等）
- 脚本安全校验 + 执行超时保护
- 浅色 / 深色双主题
- 开源许可：MIT + Commons Clause（个人免费，商用需授权）

## 快速开始

### 安装

从 [Releases](https://github.com/raylanlin/sw-copilot/releases) 下载安装包，双击安装即可。

### 从源码运行

```bash
git clone https://github.com/raylanlin/sw-copilot.git
cd sw-copilot
npm install
npm run dev
```

### 配置

1. 启动 SolidWorks
2. 启动 SW Copilot
3. 点击 ⚙️ 设置
4. 选择 API 协议，填入 Base URL 和 API Key
5. 保存，开始对话

支持的服务商：

| 服务商 | 协议 | Base URL |
|--------|------|----------|
| Anthropic | Anthropic | https://api.anthropic.com |
| OpenAI | OpenAI 兼容 | https://api.openai.com/v1 |
| 百炼 | OpenAI 兼容 | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| MiniMax | OpenAI 兼容 | https://api.minimax.chat/v1 |
| DeepSeek | OpenAI 兼容 | https://api.deepseek.com |
| Ollama | OpenAI 兼容 | http://localhost:11434/v1 |

## 使用示例

```
你: 把装配体里所有零件的圆角半径统一改成 3mm
AI: [生成 VBA 脚本] → 检测到 8 个圆角特征，确认执行？

你: 导出当前零件为 STEP 和 PDF
AI: [生成导出脚本] → 导出完成 ✓

你: 在前视面画一个 50×30 的矩形然后拉伸 20mm
AI: [生成建模脚本] → 零件创建完成 ✓
```

## 技术栈

Electron + React + TypeScript + cscript/VBS (COM) + 原生 fetch/SSE（无 SDK 依赖）

## 系统要求

- Windows 10/11 (64-bit)
- SolidWorks 2017+
- Node.js 20+ (开发模式)

## 文档

- [技术架构](docs/ARCHITECTURE.md)
- [用户手册](docs/USER-GUIDE.md)
- [API 参考](docs/API-REFERENCE.md)
- [开发者指南](docs/DEVELOPMENT.md)
- [贡献指南](docs/CONTRIBUTING.md)
- [变更记录](CHANGELOG.md)

## 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](docs/CONTRIBUTING.md)。

特别欢迎：
- SolidWorks 实际环境测试报告
- 新的自动化模板
- 更多 CAD 软件适配（Inventor、CATIA、NX）
- UI/UX 改进
- 文档翻译

## 许可证

MIT License

## 致谢

- SolidWorks COM API 示例：[CodeStack](https://www.codestack.net/)
- MCP 生态：[SolidworksMCP-TS](https://github.com/vespo92/SolidworksMCP-TS)、[SolidPilot](https://github.com/eyfel/mcp-server-solidworks)
- 灵感来源：Cursor、Claude Code、MecAgent
