import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Language = "en" | "zh-CN";

const STORAGE_KEY = "pi-dashboard-language";

export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

const normalizeLanguage = (value: string | null | undefined): Language | null => {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "zh" || v === "zh-cn" || v.startsWith("zh-hans")) return "zh-CN";
  if (v === "en" || v.startsWith("en-")) return "en";
  return null;
};

const envDefaultLanguage = normalizeLanguage((import.meta as any).env?.VITE_PI_DASHBOARD_DEFAULT_LANGUAGE);

const detectInitialLanguage = (): Language => {
  try {
    const stored = normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore storage access failures */
  }
  if (envDefaultLanguage) return envDefaultLanguage;
  const browserLanguage = normalizeLanguage(window.navigator.language);
  return browserLanguage ?? "en";
};

const en: Record<string, string> = {};

const zhCN: Record<string, string> = {
  "common.add": "添加",
  "common.back": "返回",
  "common.browsePackages": "浏览包",
  "common.checkNow": "立即检查",
  "common.checking": "检查中...",
  "common.connected": "已连接",
  "common.connecting": "正在连接...",
  "common.enable": "启用",
  "common.failed": "失败",
  "common.hidden": "隐藏",
  "common.home": "主页",
  "common.install": "安装",
  "common.language": "语言",
  "common.loading": "加载中...",
  "common.remove": "移除",
  "common.restart": "重启",
  "common.restarting": "正在重启...",
  "common.save": "保存",
  "common.saving": "保存中...",
  "common.search": "搜索",
  "common.settings": "设置",
  "common.test": "测试",
  "common.testing": "测试中...",
  "common.updateAll": "全部更新 ({count})",
  "common.queued": "已排队",
  "common.queuedCount": "{count} 个排队中",
  "connection.connecting": "正在连接...",
  "connection.authRequired": "会话已过期",
  "connection.offline": "服务器离线",
  "connection.signIn": "登录",
  "landing.activeSessions": "{count} 个活跃会话",
  "landing.addFolder": "添加文件夹",
  "landing.addFolderCta": "添加文件夹...",
  "landing.addFolderDescription": "把项目目录固定到侧栏，这样就能在里面启动 Pi 会话。",
  "landing.credentialsConfigured": "凭据已配置",
  "landing.openSettings": "打开设置",
  "landing.pickSession": "从左侧选择一个会话继续",
  "landing.pinnedFolders": "已固定 {count} 个文件夹",
  "landing.selectSession": "选择一个会话开始",
  "landing.setupCredentials": "配置凭据",
  "landing.setupCredentialsDescription": "接入一个 LLM 提供商（Anthropic、OpenAI 等），让会话可以访问模型。",
  "landing.startSession": "启动会话",
  "landing.startSessionDescription": "+Session：在 {path} 中启动一个 Pi 会话。",
  "landing.startSessionDescriptionFallback": "+Session：在已固定的文件夹中启动第一个 Pi 会话。",
  "landing.step": "步骤 {step}",
  "landing.stepsHint": "三个快速步骤，启动你的第一个会话。",
  "landing.requiresCredentials": "需要先配置凭据",
  "landing.requiresFolder": "需要先固定文件夹",
  "landing.setCredentialsFirst": "请先配置凭据",
  "landing.pinFolderFirst": "请先固定文件夹",
  "landing.welcome": "欢迎使用 pi-dashboard",
  "sessionList.addToWorkspace": "添加到工作区",
  "sessionList.emptyWorkspace": "空工作区。请在文件夹操作里使用“+ 添加到工作区”分配文件夹。",
  "sessionList.filterFolders": "按路径筛选文件夹",
  "sessionList.folderPlaceholder": "文件夹...",
  "sessionList.hiddenCount": "{count} 个已隐藏",
  "sessionList.hideEnded": "隐藏已结束",
  "sessionList.hideEndedCount": "隐藏 {count} 个已结束会话",
  "sessionList.noActiveSessions": "没有活跃会话",
  "sessionList.noSessionsMatch": "没有会话匹配搜索条件",
  "sessionList.pinDirectory": "固定目录",
  "sessionList.removeFromWorkspace": "从工作区移除",
  "sessionList.searchSessions": "搜索会话",
  "sessionList.sessionFailed": "+Session 失败",
  "sessionList.sessionPlaceholder": "会话...",
  "sessionList.settings": "设置",
  "sessionList.showEnded": "{count} 个已结束",
  "sessionList.showEndedCount": "显示 {count} 个已结束会话",
  "sessionList.unpinDirectory": "取消固定目录",
  "sessionList.viewReadme": "查看 README.md",
  "command.compactDescription": "压缩会话上下文",
  "command.forceStop": "强制停止 - 终止进程",
  "command.inlineTerminal": "打开内联终端",
  "command.killing": "正在终止进程...",
  "command.newDescription": "启动新会话",
  "command.placeholder": "输入消息、/命令、!shell 或 @文件...",
  "command.previewDescription": "在会话内预览文件或 URL",
  "command.reloadDescription": "重新加载扩展、技能、提示词和主题",
  "command.send": "发送",
  "command.stop": "停止",
  "settings.advanced": "高级",
  "settings.apiProxy": "API 代理",
  "settings.auth": "认证",
  "settings.authDescription": "配置 OAuth 提供商来保护外部（隧道）访问。本机 localhost 始终开放。",
  "settings.autoShutdown": "自动关闭",
  "settings.backgroundPolling": "后台轮询 (OpenSpec)",
  "settings.browsePackages": "浏览包",
  "settings.bypassUrls": "绕过认证的 URL 前缀",
  "settings.bypassUrlsHint": "每行一个，请求这些路径时跳过认证",
  "settings.chatDisplay": "聊天显示",
  "settings.chatDisplayAdvancedDescription": "控制聊天消息流中显示哪些内容。",
  "settings.chatDisplayDescription": "隐藏你不需要的聊天元素。单会话覆盖项在聊天视图的“View”弹窗里。",
  "settings.contextUsageBar": "上下文用量条",
  "settings.debugEvents": "调试事件",
  "settings.defaultModel": "默认模型",
  "settings.capturePiOutput": "捕获 pi 会话输出（调试）",
  "settings.capturePiOutputHint": "将每个会话的完整 pi stdout/stderr 归档到 keeper-<id>.log 以便调试。长会话会占用大量磁盘空间——除非正在诊断会话，否则请关闭。仅对新生成的会话生效。",
  "settings.devBuildOnReload": "重新加载时开发构建",
  "settings.developer": "开发者",
  "settings.detecting": "检测中...",
  "settings.editor": "编辑器 (code-server)",
  "settings.editorDescription": "配置由 code-server 驱动的内置 VS Code 编辑器。",
  "settings.enableOpenSpec": "启用 OpenSpec",
  "settings.enableWatchdog": "启用看门狗",
  "settings.enableZrokTunnel": "启用 Zrok 隧道",
  "settings.failedLoad": "设置加载失败",
  "settings.general": "常规",
  "settings.httpPort": "HTTP 端口",
  "settings.interface": "界面",
  "settings.interfaceDescription": "切换仪表盘界面语言。选择会保存在当前浏览器中。",
  "settings.language": "界面语言",
  "settings.loading": "正在加载设置...",
  "settings.llmProviders": "LLM 提供商",
  "settings.llmProvidersDescription": "注册兼容 OpenAI 的自定义 API 端点来访问模型。",
  "settings.memoryLimits": "内存限制",
  "settings.memoryLimitsDescription": "限制服务器内存占用。设为 0 表示禁用限制。需要重启服务器。",
  "settings.noChanges": "没有需要保存的更改",
  "settings.packages": "包",
  "settings.piGatewayPort": "Pi 网关端口",
  "settings.plugins": "插件",
  "settings.probeInterval": "探测间隔（秒）",
  "settings.probeTimeout": "探测超时（秒）",
  "settings.providers": "提供商",
  "settings.providerAuth": "提供商认证",
  "settings.restartFailed": "重启失败",
  "settings.restartRequired": "已保存。部分更改需要重启服务器后生效。",
  "settings.restartServer": "重启服务器",
  "settings.saved": "设置已保存",
  "settings.saveFailed": "保存设置失败",
  "settings.security": "安全",
  "settings.servers": "服务器",
  "settings.sessions": "会话",
  "settings.showDebugEvents": "显示调试事件（raw events、flow:list-flows、resources_discover）",
  "settings.spawnStrategy": "+Session 策略",
  "settings.tunnel": "隧道",
  "settings.worktreeButtons": "在文件夹和 OpenSpec 行里显示 worktree 启动按钮",
  "settings.tokenStatsBar": "Token 统计栏",
  "settings.reasoningBlocks": "推理块",
  "settings.toolResultBodies": "工具结果正文",
  "settings.turnMetadata": "轮次元数据分隔符",
  "settings.toolCallsHeader": "工具调用 - 显示这些类型",
  "settings.toolRead": "读取",
  "settings.toolBash": "Bash",
  "settings.toolEdit": "编辑 / 写入",
  "settings.toolAgent": "Agent",
  "settings.toolOther": "其他",
  "settings.resetDefaults": "恢复默认",
  "settings.addProvider": "添加提供商",
  "settings.addLocalNetwork": "+ 添加本地网络",
  "settings.allowedUsers": "允许用户",
  "settings.allowedUsersHint": "每行一个：用户名、邮箱或 *@domain",
  "settings.trustedNetworks": "可信网络",
  "settings.trustedNetworksDescription": "匹配这些网络或主机的设备无需认证即可访问仪表盘。支持精确 IP、通配符或 CIDR。",
  "settings.trustedNetworksWarning": "可信网络中的任何人都能无需认证完整访问仪表盘。请只用于你控制的私有网络。",
  "settings.knownServers": "已知服务器",
  "settings.networkDiscovery": "网络发现",
  "settings.core": "核心",
  "settings.recommendedExtensions": "推荐扩展",
  "settings.otherPackages": "其他包",
  "settings.piEcosystem": "Pi 生态",
  "settings.piEcosystemDescription": "Pi 工具链、推荐扩展，以及 Pi 当前加载的其他包。",
  "settings.noCorePackages": "未检测到 Pi 生态核心包。",
  "settings.noRecommendedExtensions": "尚未安装推荐扩展。",
  "settings.otherPackagesHint": "本地开发和用户添加的包会显示在这里。",
  "settings.lastChecked": "上次检查：{time}",
  "settings.providerName": "提供商名称",
  "settings.baseUrlFirst": "请先填写 Base URL 和 API Key",
  "settings.pingModels": "请求提供商的 /models 端点",
  "settings.connectedModels": "已连接 · {count} 个模型",
  "settings.connectedOnly": "已连接",
  "status.generating": "正在生成...",
  "status.refreshOpenSpec": "刷新 OpenSpec 数据",
  "status.runningTool": "正在运行 {tool}...",
  "status.thinking": "正在思考...",
  "extension.modules": "扩展模块",
  "extension.noModules": "没有可用模块",
  "extension.searchModules": "搜索模块...",
  "shell.chatError": "聊天视图发生错误",
  "shell.error": "Shell 发生错误",
  "shell.reloadPage": "重新加载页面",
  "packages.installed": "已安装包",
  "packages.installing": "正在安装 {source}...",
  "packages.noPackages": "没有找到包",
  "packages.packageCount": "{count} 个包",
  "packages.searchPlaceholder": "在 npm 上搜索 Pi 包...",
  "time.daysAgo": "{count} 天前",
  "time.hoursAgo": "{count} 小时前",
  "time.justNow": "刚刚",
  "time.minutesAgo": "{count} 分钟前",
  "time.secondsAgo": "{count} 秒前",
};

const dictionaries: Record<Language, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
};

type Vars = Record<string, string | number>;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Vars, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const fallbackI18n: I18nContextValue = {
  language: "en",
  setLanguage: () => {},
  t: (_key, vars, fallback) => {
    const template = fallback ?? _key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
  },
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore storage access failures */
    }
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const translate = (key: string, vars?: Vars, fallback?: string) => {
      const template = dictionaries[language][key] ?? fallback ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
    };
    return {
      language,
      setLanguage: setLanguageState,
      t: translate,
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  return context ?? fallbackI18n;
}
