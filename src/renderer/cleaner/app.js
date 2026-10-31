const api = window.capriCleaner;

const elements = {
  categories: [...document.querySelectorAll(".category-card input[type=checkbox]")],
  nodeModules: document.querySelector("#node-modules-option"),
  projectRow: document.querySelector("#project-row"),
  projectPath: document.querySelector("#project-path"),
  chooseProject: document.querySelector("#choose-project"),
  status: document.querySelector("#status"),
  scan: document.querySelector("#scan"),
  progressPanel: document.querySelector("#progress-panel"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  progressDetail: document.querySelector("#progress-detail"),
  cancelRun: document.querySelector("#cancel-run"),
  previewPanel: document.querySelector("#preview-panel"),
  planCode: document.querySelector("#plan-code"),
  previewRows: document.querySelector("#preview-rows"),
  scanWarnings: document.querySelector("#scan-warnings"),
  selectedSummary: document.querySelector("#selected-summary"),
  execute: document.querySelector("#execute"),
  resultPanel: document.querySelector("#result-panel"),
  resultFreed: document.querySelector("#result-freed"),
  resultFiles: document.querySelector("#result-files"),
  resultSkipped: document.querySelector("#result-skipped"),
  resultMessage: document.querySelector("#result-message"),
  failureDetails: document.querySelector("#failure-details"),
  failureList: document.querySelector("#failure-list")
};

let projectSelectionId = null;
let projectDisplayPath = "";
let currentPlan = null;
let currentRunId = null;
let busy = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function selectedCategories() {
  return elements.categories
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function updateScanButton() {
  const categories = selectedCategories();
  const needsProject =
    categories.includes("node_modules") && !projectSelectionId;
  elements.scan.disabled = busy || categories.length === 0 || needsProject;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  for (const input of elements.categories) input.disabled = busy;
  elements.chooseProject.disabled = busy;
  elements.execute.disabled = busy || !currentPlan;
  if (currentPlan && !busy) updateSelectionSummary();
  updateScanButton();
}

function showProgress(label, detail, indeterminate = true) {
  elements.progressPanel.hidden = false;
  elements.progressLabel.textContent = label;
  elements.progressDetail.textContent = detail;
  elements.progressValue.textContent = indeterminate ? "进行中" : "0%";
  elements.progressBar.classList.toggle("is-indeterminate", indeterminate);
  elements.progressBar.style.width = indeterminate ? "" : "0%";
  elements.cancelRun.hidden = !currentRunId;
}

function hideProgress() {
  elements.progressPanel.hidden = true;
  elements.progressBar.classList.remove("is-indeterminate");
  elements.cancelRun.hidden = true;
}

function selectedPreviewItems() {
  if (!currentPlan) return [];
  return currentPlan.items.filter((item) => {
    const checkbox = elements.previewRows.querySelector(
      `input[data-item-id="${CSS.escape(item.id)}"]`
    );
    return checkbox?.checked;
  });
}

function updateSelectionSummary() {
  const selected = selectedPreviewItems();
  const fileCount = selected.reduce((sum, item) => sum + item.fileCount, 0);
  const sizeBytes = selected.reduce((sum, item) => sum + item.sizeBytes, 0);
  elements.selectedSummary.textContent =
    `${selected.length} 项 · ${fileCount.toLocaleString("zh-CN")} 文件 · ${formatBytes(sizeBytes)}`;
  elements.execute.disabled = busy || selected.length === 0;
}

function renderPlan(plan) {
  currentPlan = plan;
  elements.previewRows.replaceChildren();
  elements.planCode.textContent = `PLAN ${plan.planId.slice(0, 8).toUpperCase()}`;

  for (const item of plan.items) {
    const row = document.createElement("tr");
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "row-check";
    checkbox.dataset.itemId = item.id;
    checkbox.checked = item.fileCount > 0 || item.directoryCount > 0;
    checkbox.disabled = !(item.fileCount > 0 || item.directoryCount > 0);
    checkbox.addEventListener("change", updateSelectionSummary);
    checkCell.append(checkbox);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = item.label;

    const pathCell = document.createElement("td");
    pathCell.className = "path-cell";
    pathCell.textContent = item.path;

    const countCell = document.createElement("td");
    countCell.textContent = item.fileCount.toLocaleString("zh-CN");

    const sizeCell = document.createElement("td");
    sizeCell.textContent = formatBytes(item.sizeBytes);

    row.append(checkCell, categoryCell, pathCell, countCell, sizeCell);
    elements.previewRows.append(row);
  }

  const warnings = plan.items.flatMap((item) => item.warnings || []);
  warnings.push(...(plan.warnings || []));
  elements.scanWarnings.replaceChildren();
  elements.scanWarnings.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `${warning.path || ""} ${warning.message || warning}`.trim();
    elements.scanWarnings.append(paragraph);
  }

  elements.previewPanel.hidden = false;
  updateSelectionSummary();
}

function renderComplete(result) {
  elements.resultPanel.hidden = false;
  elements.resultFreed.textContent = formatBytes(result.freedBytes);
  elements.resultFiles.textContent = result.deletedFiles.toLocaleString("zh-CN");
  elements.resultSkipped.textContent =
    (result.failureCount + result.skippedEntries).toLocaleString("zh-CN");
  elements.resultMessage.textContent = result.cancelled
    ? "清理已取消；已经删除的文件不会恢复。"
    : "清理计划执行结束。被占用、权限不足或不符合安全规则的文件已自动跳过。";

  elements.failureList.replaceChildren();
  elements.failureDetails.hidden = result.failures.length === 0;
  for (const failure of result.failures) {
    const item = document.createElement("li");
    item.textContent = `${failure.code} · ${failure.path} · ${failure.message}`;
    elements.failureList.append(item);
  }

  currentPlan = null;
  currentRunId = null;
  elements.execute.disabled = true;
  elements.previewPanel.hidden = true;
  hideProgress();
  setBusy(false);
}

for (const input of elements.categories) {
  input.addEventListener("change", () => {
    if (input === elements.nodeModules) {
      elements.projectRow.hidden = !input.checked;
    }
    updateScanButton();
  });
}

elements.chooseProject.addEventListener("click", async () => {
  try {
    const selection = await api.chooseProject();
    if (selection.cancelled) return;
    projectSelectionId = selection.selectionId;
    projectDisplayPath = selection.displayPath;
    elements.projectPath.textContent = projectDisplayPath;
    elements.projectPath.title = projectDisplayPath;
    setStatus("项目已选择。扫描只会检查该项目顶层的 node_modules。");
  } catch (error) {
    setStatus(error.message || "项目选择失败", true);
  }
  updateScanButton();
});

elements.scan.addEventListener("click", async () => {
  const categories = selectedCategories();
  if (categories.length === 0) {
    setStatus("请至少选择一个清理类别", true);
    return;
  }

  currentPlan = null;
  currentRunId = null;
  elements.previewPanel.hidden = true;
  elements.resultPanel.hidden = true;
  setBusy(true);
  showProgress("正在扫描本地目录…", "只读取路径、大小和文件数", true);
  setStatus("正在生成 dry-run 清理计划，不会删除任何文件。");

  try {
    const plan = await api.scan({
      categories,
      projectSelectionId
    });
    hideProgress();
    renderPlan(plan);
    setStatus(
      plan.items.length > 0
        ? "扫描完成。请核对路径和大小，确认后再执行清理。"
        : "扫描完成，但没有发现可清理内容。"
    );
  } catch (error) {
    hideProgress();
    setStatus(error.message || "扫描失败", true);
  } finally {
    setBusy(false);
  }
});

elements.execute.addEventListener("click", async () => {
  if (!currentPlan) return;
  const itemIds = selectedPreviewItems().map((item) => item.id);
  if (itemIds.length === 0) return;

  setBusy(true);
  try {
    const run = await api.execute({
      planId: currentPlan.planId,
      itemIds
    });
    if (run.cancelled) {
      setStatus("已取消清理。");
      setBusy(false);
      return;
    }

    currentRunId = run.runId;
    showProgress("正在清理已确认的文件…", "正在逐项删除", false);
    elements.cancelRun.hidden = false;
    setStatus("清理进行中。失败项会自动跳过。");
  } catch (error) {
    currentPlan = null;
    elements.previewPanel.hidden = true;
    setBusy(false);
    setStatus(error.message || "无法开始清理", true);
  }
});

elements.cancelRun.addEventListener("click", async () => {
  if (!currentRunId) return;
  elements.cancelRun.disabled = true;
  try {
    await api.cancel(currentRunId);
    elements.progressLabel.textContent = "正在取消清理…";
  } finally {
    elements.cancelRun.disabled = false;
  }
});

api.onProgress((progress) => {
  if (progress.phase === "scan") {
    elements.progressLabel.textContent = `正在扫描：${progress.groupLabel}`;
    elements.progressDetail.textContent =
      `${progress.scannedFiles.toLocaleString("zh-CN")} 个文件 · ${formatBytes(progress.discoveredBytes)}`;
    elements.progressValue.textContent = "扫描中";
    return;
  }

  const percent = progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.processedBytes / progress.totalBytes) * 100))
    : progress.totalFiles > 0
      ? Math.min(100, Math.round((progress.processedFiles / progress.totalFiles) * 100))
      : 0;
  elements.progressBar.classList.remove("is-indeterminate");
  elements.progressBar.style.width = `${percent}%`;
  elements.progressValue.textContent = `${percent}%`;
  elements.progressLabel.textContent = "正在清理已确认的文件…";
  elements.progressDetail.textContent =
    `${progress.processedFiles.toLocaleString("zh-CN")} / ${progress.totalFiles.toLocaleString("zh-CN")} 文件 · ${formatBytes(progress.processedBytes)}`;
});

api.onComplete(renderComplete);

api.onError((error) => {
  hideProgress();
  currentPlan = null;
  currentRunId = null;
  elements.previewPanel.hidden = true;
  elements.execute.disabled = true;
  setBusy(false);
  setStatus(`${error.code}: ${error.message}`, true);
});

api
  .getCapabilities()
  .then((capabilities) => {
    document.documentElement.dataset.platform = capabilities.platform;
  })
  .catch(() => {});

updateScanButton();
setTimeout(() => {
  if (!busy && !currentPlan && !elements.scan.disabled) {
    elements.scan.click();
  }
}, 0);
