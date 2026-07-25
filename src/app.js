import { translate } from "./i18n.js";
import {
  generateTotp,
  getRemainingSeconds,
  normalizeBase32,
  parseOtpAuthUri,
} from "./totp.js";
import { loadAccounts, saveAccounts } from "./vault.js";

const elements = {
  accountCount: document.querySelector("#accountCount"),
  accountsGrid: document.querySelector("#accountsGrid"),
  accountTemplate: document.querySelector("#accountCardTemplate"),
  addDialog: document.querySelector("#addDialog"),
  addForm: document.querySelector("#addForm"),
  accountInput: document.querySelector("#accountInput"),
  cancelButton: document.querySelector("#cancelButton"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  emptyTemplate: document.querySelector("#emptyStateTemplate"),
  formError: document.querySelector("#formError"),
  issuerInput: document.querySelector("#issuerInput"),
  languageButton: document.querySelector("#languageButton"),
  openAddButton: document.querySelector("#openAddButton"),
  quickClearButton: document.querySelector("#quickClearButton"),
  quickCode: document.querySelector("#quickCode"),
  quickCopyButton: document.querySelector("#quickCopyButton"),
  quickError: document.querySelector("#quickError"),
  quickForm: document.querySelector("#quickForm"),
  quickProgress: document.querySelector("#quickProgress"),
  quickResult: document.querySelector("#quickResult"),
  quickSecretInput: document.querySelector("#quickSecretInput"),
  quickTimerLabel: document.querySelector("#quickTimerLabel"),
  quickToggleSecretButton: document.querySelector("#quickToggleSecretButton"),
  secretInput: document.querySelector("#secretInput"),
  themeButton: document.querySelector("#themeButton"),
  toggleSecretButton: document.querySelector("#toggleSecretButton"),
  toast: document.querySelector("#toast"),
  useCount: document.querySelector("#useCount"),
  visitCount: document.querySelector("#visitCount"),
};

const mediaTheme = window.matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let activeViewTransition = null;
let dialogClosePromise = null;
let quickResultTimer = null;
let statsRequest = Promise.resolve();

const state = {
  accounts: [],
  enteringAccountId: null,
  language: readPreference("language") || (navigator.language.startsWith("zh") ? "zh" : "en"),
  quickConfig: null,
  stats: null,
  theme: readPreference("theme"),
  toastTimer: null,
};

function readPreference(key) {
  try {
    return localStorage.getItem(`omnitool-${key}`);
  } catch {
    return null;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(`omnitool-${key}`, value);
  } catch {
    // Preferences can remain session-only when localStorage is unavailable.
  }
}

function waitForMotion(duration) {
  if (reducedMotion.matches) {
    return Promise.resolve();
  }

  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function runViewTransition(update) {
  if (reducedMotion.matches || !document.startViewTransition) {
    update();
    return;
  }

  if (activeViewTransition) {
    activeViewTransition.finished.then(
      () => runViewTransition(update),
      () => runViewTransition(update),
    );
    return;
  }

  activeViewTransition = document.startViewTransition(update);
  const clearTransition = () => {
    activeViewTransition = null;
  };
  activeViewTransition.finished.then(clearTransition, clearTransition);
}

function t(key, variables) {
  return translate(state.language, key, variables);
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  elements.languageButton.querySelector("[aria-hidden]").textContent =
    state.language === "zh" ? "EN" : "中";
  applyTranslations();
  elements.toggleSecretButton.querySelector("span").textContent = t(
    elements.secretInput.type === "password" ? "show" : "hide",
  );
  elements.quickToggleSecretButton.querySelector("span").textContent = t(
    elements.quickSecretInput.type === "password" ? "show" : "hide",
  );
  renderStats();
  updateCodes();
}

function getEffectiveTheme() {
  return state.theme || (mediaTheme.matches ? "dark" : "light");
}

function applyTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#09090b" : "#f5f5f7";
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2200);
}

function renderStats() {
  if (!state.stats) {
    return;
  }

  const formatter = new Intl.NumberFormat(state.language === "zh" ? "zh-CN" : "en");
  elements.visitCount.textContent = formatter.format(state.stats.visits);
  elements.useCount.textContent = formatter.format(state.stats.uses);
}

function recordStat(metric) {
  statsRequest = statsRequest
    .then(async () => {
      const response = await fetch(`/api/stats/${metric}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("STATS_UNAVAILABLE");
      }

      state.stats = await response.json();
      renderStats();
    })
    .catch(() => {});

  return statsRequest;
}

function openAddDialog() {
  if (dialogClosePromise) {
    return;
  }

  elements.addForm.reset();
  elements.secretInput.type = "password";
  elements.toggleSecretButton.querySelector("span").textContent = t("show");
  elements.formError.textContent = "";
  elements.addDialog.classList.remove("is-closing");
  elements.addDialog.showModal();
  window.setTimeout(() => elements.secretInput.focus(), 0);
}

async function closeAddDialog() {
  if (!elements.addDialog.open) {
    return;
  }

  if (dialogClosePromise) {
    return dialogClosePromise;
  }

  elements.addDialog.classList.add("is-closing");
  dialogClosePromise = waitForMotion(180).then(() => {
    elements.addDialog.close();
    elements.addDialog.classList.remove("is-closing");
    dialogClosePromise = null;
  });

  return dialogClosePromise;
}

function getInitials(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}

function formatCode(code) {
  const split = Math.ceil(code.length / 2);
  return `${code.slice(0, split)} ${code.slice(split)}`;
}

function findCard(accountId) {
  return [...elements.accountsGrid.querySelectorAll(".account-card")].find(
    (card) => card.dataset.accountId === accountId,
  );
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.className = "clipboard-fallback";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function parseQuickConfig() {
  const value = elements.quickSecretInput.value.trim();

  if (value.toLowerCase().startsWith("otpauth://")) {
    return parseOtpAuthUri(value);
  }

  return {
    secret: normalizeBase32(value),
    digits: 6,
    period: 30,
    algorithm: "SHA-1",
  };
}

async function updateQuickCode(timestamp = Date.now()) {
  const config = state.quickConfig;

  if (!config) {
    return;
  }

  const remaining = getRemainingSeconds(config.period, timestamp);
  elements.quickProgress.max = config.period;
  elements.quickProgress.value = remaining;
  elements.quickTimerLabel.textContent = t("seconds", { count: remaining });

  try {
    const code = await generateTotp(config.secret, { ...config, timestamp });

    if (state.quickConfig !== config) {
      return;
    }

    elements.quickCode.textContent = formatCode(code);
    elements.quickCopyButton.dataset.code = code;
    return true;
  } catch {
    elements.quickCode.textContent = t("codeUnavailable");
    delete elements.quickCopyButton.dataset.code;
    return false;
  }
}

function resetQuickResultVisual() {
  elements.quickCode.textContent = "••• •••";
  elements.quickProgress.value = 30;
  elements.quickTimerLabel.textContent = "";
  delete elements.quickCopyButton.dataset.code;
}

function showQuickResult() {
  window.clearTimeout(quickResultTimer);
  elements.quickResult.hidden = false;
  elements.quickResult.classList.remove("is-leaving", "is-entering");
  void elements.quickResult.offsetWidth;
  elements.quickResult.classList.add("is-entering");
  quickResultTimer = window.setTimeout(() => {
    elements.quickResult.classList.remove("is-entering");
  }, reducedMotion.matches ? 0 : 260);
}

function hideQuickResult() {
  window.clearTimeout(quickResultTimer);

  if (elements.quickResult.hidden) {
    resetQuickResultVisual();
    return;
  }

  elements.quickResult.classList.remove("is-entering");
  elements.quickResult.classList.add("is-leaving");

  const finish = () => {
    elements.quickResult.hidden = true;
    elements.quickResult.classList.remove("is-leaving");
    resetQuickResultVisual();
  };

  if (reducedMotion.matches) {
    finish();
    return;
  }

  quickResultTimer = window.setTimeout(finish, 170);
}

async function generateQuickCode() {
  elements.quickError.textContent = "";
  elements.quickSecretInput.setAttribute("aria-invalid", "false");

  try {
    state.quickConfig = parseQuickConfig();
    resetQuickResultVisual();
    showQuickResult();
    const generated = await updateQuickCode();

    if (generated) {
      recordStat("use");
    }
  } catch {
    state.quickConfig = null;
    hideQuickResult();
    elements.quickError.textContent = t("invalidSecret");
    elements.quickSecretInput.setAttribute("aria-invalid", "true");
  }
}

function clearQuickCode({ focus = true } = {}) {
  state.quickConfig = null;
  elements.quickForm.reset();
  elements.quickSecretInput.type = "password";
  elements.quickSecretInput.setAttribute("aria-invalid", "false");
  elements.quickToggleSecretButton.querySelector("span").textContent = t("show");
  hideQuickResult();
  elements.quickError.textContent = "";

  if (focus) {
    elements.quickSecretInput.focus();
  }
}

async function deleteAccount(account) {
  if (!window.confirm(t("deleteConfirm", { name: account.issuer }))) {
    return;
  }

  const nextAccounts = state.accounts.filter((item) => item.id !== account.id);

  try {
    await saveAccounts(nextAccounts);
    const card = findCard(account.id);
    card?.classList.add("is-leaving");
    await waitForMotion(180);
    state.accounts = nextAccounts;
    renderAccounts();
    showToast(t("deleted"));
  } catch {
    showToast(t("storageError"));
  }
}

function createAccountCard(account) {
  const fragment = elements.accountTemplate.content.cloneNode(true);
  applyTranslations(fragment);
  const card = fragment.querySelector(".account-card");
  const avatar = fragment.querySelector(".account-avatar");
  const title = fragment.querySelector(".account-identity h3");
  const subtitle = fragment.querySelector(".account-identity p");
  const codeButton = fragment.querySelector(".code-button");
  const deleteButton = fragment.querySelector(".delete-button");

  card.dataset.accountId = account.id;

  if (account.id === state.enteringAccountId) {
    card.classList.add("is-entering");
  }

  avatar.textContent = getInitials(account.issuer);
  title.textContent = account.issuer;
  subtitle.textContent = account.account;
  codeButton.setAttribute("aria-label", `${t("copyCode")}: ${account.issuer}`);
  codeButton.addEventListener("click", async () => {
    const value = codeButton.dataset.code;

    if (!value) {
      return;
    }

    try {
      await copyText(value);
      recordStat("use");
      showToast(t("copied"));
    } catch {
      showToast(t("codeUnavailable"));
    }
  });
  deleteButton.addEventListener("click", () => deleteAccount(account));

  return fragment;
}

function renderAccounts() {
  elements.accountsGrid.replaceChildren();
  elements.accountCount.textContent = String(state.accounts.length);

  if (state.accounts.length === 0) {
    const fragment = elements.emptyTemplate.content.cloneNode(true);
    applyTranslations(fragment);
    fragment.querySelector(".empty-add-button").addEventListener("click", openAddDialog);
    elements.accountsGrid.append(fragment);
    return;
  }

  state.accounts.forEach((account) => {
    elements.accountsGrid.append(createAccountCard(account));
  });
  state.enteringAccountId = null;
  updateCodes();
}

async function updateCodes() {
  const now = Date.now();
  await updateQuickCode(now);

  if (state.accounts.length === 0) {
    return;
  }

  await Promise.all(
    state.accounts.map(async (account) => {
      const card = findCard(account.id);

      if (!card) {
        return;
      }

      const remaining = getRemainingSeconds(account.period, now);
      const progress = card.querySelector(".timer-progress");
      const timerLabel = card.querySelector(".timer-label");
      progress.max = account.period;
      progress.value = remaining;
      timerLabel.textContent = t("seconds", { count: remaining });

      try {
        const code = await generateTotp(account.secret, {
          algorithm: account.algorithm,
          digits: account.digits,
          period: account.period,
          timestamp: now,
        });
        const codeButton = card.querySelector(".code-button");
        codeButton.dataset.code = code;
        card.querySelector(".code-value").textContent = formatCode(code);
      } catch {
        card.querySelector(".code-value").textContent = t("codeUnavailable");
      }
    }),
  );
}

function parseFormAccount() {
  const rawSecret = elements.secretInput.value.trim();

  if (rawSecret.toLowerCase().startsWith("otpauth://")) {
    return parseOtpAuthUri(rawSecret);
  }

  const issuer = elements.issuerInput.value.trim();
  const account = elements.accountInput.value.trim();

  if (!issuer || !account) {
    throw new Error("MISSING_DETAILS");
  }

  return {
    issuer,
    account,
    secret: normalizeBase32(rawSecret),
    digits: 6,
    period: 30,
    algorithm: "SHA-1",
  };
}

async function handleAddSubmit(event) {
  event.preventDefault();
  elements.formError.textContent = "";

  let account;

  try {
    account = parseFormAccount();
    await generateTotp(account.secret, account);
  } catch (error) {
    elements.formError.textContent =
      error.message === "MISSING_DETAILS" ? t("missingDetails") : t("invalidSecret");
    return;
  }

  const duplicate = state.accounts.some(
    (item) =>
      item.issuer.toLowerCase() === account.issuer.toLowerCase() &&
      item.account.toLowerCase() === account.account.toLowerCase(),
  );

  if (duplicate) {
    elements.formError.textContent = t("duplicateAccount");
    return;
  }

  const newAccount = {
    ...account,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const nextAccounts = [...state.accounts, newAccount];

  try {
    await saveAccounts(nextAccounts);
    await closeAddDialog();
    state.accounts = nextAccounts;
    state.enteringAccountId = newAccount.id;
    renderAccounts();
    showToast(t("added"));
  } catch {
    elements.formError.textContent = t("storageError");
  }
}

function tryFillOtpAuthDetails() {
  const value = elements.secretInput.value.trim();

  if (!value.toLowerCase().startsWith("otpauth://")) {
    return;
  }

  try {
    const parsed = parseOtpAuthUri(value);
    elements.issuerInput.value = parsed.issuer;
    elements.accountInput.value = parsed.account;
    elements.formError.textContent = "";
  } catch {
    // The user may still be pasting the URI, so validation waits for submit.
  }
}

elements.openAddButton.addEventListener("click", openAddDialog);
elements.quickForm.addEventListener("submit", (event) => {
  event.preventDefault();
  generateQuickCode();
});
elements.quickSecretInput.addEventListener("input", () => {
  state.quickConfig = null;
  hideQuickResult();
  elements.quickError.textContent = "";
  elements.quickSecretInput.setAttribute("aria-invalid", "false");
});
elements.quickSecretInput.addEventListener("paste", () => {
  window.setTimeout(generateQuickCode, 0);
});
elements.quickToggleSecretButton.addEventListener("click", () => {
  const willShow = elements.quickSecretInput.type === "password";
  elements.quickSecretInput.type = willShow ? "text" : "password";
  elements.quickToggleSecretButton.querySelector("span").textContent = t(
    willShow ? "hide" : "show",
  );
});
elements.quickCopyButton.addEventListener("click", async () => {
  const code = elements.quickCopyButton.dataset.code;

  if (!code) {
    return;
  }

  try {
    await copyText(code);
    showToast(t("copied"));
  } catch {
    showToast(t("codeUnavailable"));
  }
});
elements.quickClearButton.addEventListener("click", () => clearQuickCode());
elements.closeDialogButton.addEventListener("click", closeAddDialog);
elements.cancelButton.addEventListener("click", closeAddDialog);
elements.addForm.addEventListener("submit", handleAddSubmit);
elements.secretInput.addEventListener("input", tryFillOtpAuthDetails);
elements.toggleSecretButton.addEventListener("click", () => {
  const willShow = elements.secretInput.type === "password";
  elements.secretInput.type = willShow ? "text" : "password";
  elements.toggleSecretButton.querySelector("span").textContent = t(willShow ? "hide" : "show");
});
elements.languageButton.addEventListener("click", () => {
  runViewTransition(() => {
    state.language = state.language === "zh" ? "en" : "zh";
    writePreference("language", state.language);
    applyLanguage();
    renderAccounts();
  });
});
elements.themeButton.addEventListener("click", () => {
  runViewTransition(() => {
    state.theme = getEffectiveTheme() === "dark" ? "light" : "dark";
    writePreference("theme", state.theme);
    applyTheme();
  });
});
elements.addDialog.addEventListener("click", (event) => {
  if (event.target === elements.addDialog) {
    closeAddDialog();
  }
});
elements.addDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAddDialog();
});
mediaTheme.addEventListener("change", () => {
  if (!state.theme) {
    runViewTransition(applyTheme);
  }
});

applyTheme();
applyLanguage();
renderAccounts();
recordStat("visit");

try {
  state.accounts = await loadAccounts();
  renderAccounts();
} catch {
  showToast(t("storageError"));
}

window.requestAnimationFrame(() => {
  document.body.classList.add("is-ready");
});

window.setInterval(updateCodes, 1000);
