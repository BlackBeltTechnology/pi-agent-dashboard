/**
 * Flows plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.flows.*`. Component code resolves keys via the
 * scoped `useT()` hook, which auto-prefixes `plugin.flows.`.
 *
 * zh-CN and hu MUST keep parity (identical key sets). {var} placeholders are
 * preserved verbatim so `t(key, vars)` can interpolate.
 *
 * See change: make-all-ui-text-i18n.
 */
export const catalog = {
  "zh-CN": {
    abort: "中止",
    delete: "删除",
    run: "运行",
    abortRunningFlow: "中止正在运行的流程",
    back: "返回",
    expandGraph: "展开图表",
    flowGraph: "流程图",
    result: "结果",
    inputs: "输入",
    dismiss: "关闭",
    flowsHeading: "流程",
    editModeLabel: "编辑模式",
    runFlowTitle: "运行流程：{flowName}",
    taskPlaceholder: "描述任务（可选）…",
    summary: "摘要",
    waitingToStart: "等待开始…",
    noActivityYet: "暂无活动",
    closeAgentDetail: "关闭 {name} 详情",
    viewAgentDetail: "查看 {name} 详情",
    details: "详情",
    stepsCount: "{done}/{total} 个步骤",
    toggleAutonomousMode: "切换自主模式",
    abortFlow: "中止流程",
    newFlowOption: "+ 新建流程",
    newFlowOptionDesc: "使用 edit-flow 技能创建新流程",
    runFlowButton: "运行流程…",
    newEditButton: "新建 / 编辑…",
    runFlowDialogTitle: "运行流程",
    searchFlows: "搜索流程…",
    noFlowsAvailable: "没有可用的流程",
    newEditFlowTitle: "新建 / 编辑流程",
    pickFlowToEdit: "选择要编辑的流程，或 + 新建流程…",
    noFlowsYet: "还没有流程 — 选择 + 新建流程",
    deleteFlowTitle: "删除流程",
    deleteFlowConfirm: '删除流程 "{name}"？这将移除流程文件及所有关联的代理。',
  },
  hu: {
    abort: "Megszakítás",
    delete: "Törlés",
    run: "Futtatás",
    abortRunningFlow: "Futó folyamat megszakítása",
    back: "Vissza",
    expandGraph: "Gráf kibontása",
    flowGraph: "Folyamatgráf",
    result: "Eredmény",
    inputs: "Bemenetek",
    dismiss: "Bezárás",
    flowsHeading: "Folyamatok",
    editModeLabel: "Szerkesztő mód",
    runFlowTitle: "Folyamat futtatása: {flowName}",
    taskPlaceholder: "Írd le a feladatot (opcionális)…",
    summary: "Összefoglaló",
    waitingToStart: "Indulásra vár…",
    noActivityYet: "Még nincs tevékenység",
    closeAgentDetail: "{name} részleteinek bezárása",
    viewAgentDetail: "{name} részleteinek megtekintése",
    details: "Részletek",
    stepsCount: "{done}/{total} lépés",
    toggleAutonomousMode: "Autonóm mód váltása",
    abortFlow: "Folyamat megszakítása",
    newFlowOption: "+ Új folyamat",
    newFlowOptionDesc: "Új folyamat készítése az edit-flow készséggel",
    runFlowButton: "Folyamat futtatása…",
    newEditButton: "Új / Szerkesztés…",
    runFlowDialogTitle: "Folyamat futtatása",
    searchFlows: "Folyamatok keresése…",
    noFlowsAvailable: "Nincs elérhető folyamat",
    newEditFlowTitle: "Új / Folyamat szerkesztése",
    pickFlowToEdit: "Válassz folyamatot szerkesztésre, vagy + Új folyamat…",
    noFlowsYet: "Még nincs folyamat — válaszd a + Új folyamat lehetőséget",
    deleteFlowTitle: "Folyamat törlése",
    deleteFlowConfirm:
      'Törlöd a(z) "{name}" folyamatot? Ez eltávolítja a folyamatfájlt és a hozzá tartozó ügynököket.',
  },
};
