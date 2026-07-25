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
  secretInput: document.querySelector("#secretInput"),
  themeButton: document.querySelector("#themeButton"),
  toggleSecretButton: document.querySelector("#toggleSecretButton"),
  toast: document.querySelector("#toast"),
};

const mediaTheme = window.matchMedia("(prefers-color-scheme: dark)");
const state = {
  accounts: [],
  language: readPreference("language") || (navigator.language.startsWith("zh") ? "zh" : "en"),
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

function openAddDialog() {
  elements.addForm.reset();
  elements.secretInput.type = "password";
  elements.toggleSecretButton.querySelector("span").textContent = t("show");
  elements.formError.textContent = "";
  elements.addDialog.showModal();
  window.setTimeout(() => elements.secretInput.focus(), 0);
}

function closeAddDialog() {
  elements.addDialog.close();
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

async function deleteAccount(account) {
  if (!window.confirm(t("deleteConfirm", { name: account.issuer }))) {
    return;
  }

  const nextAccounts = state.accounts.filter((item) => item.id !== account.id);

  try {
    await saveAccounts(nextAccounts);
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
  updateCodes();
}

async function updateCodes() {
  if (state.accounts.length === 0) {
    return;
  }

  const now = Date.now();

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

  const nextAccounts = [
    ...state.accounts,
    {
      ...account,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    },
  ];

  try {
    await saveAccounts(nextAccounts);
    state.accounts = nextAccounts;
    closeAddDialog();
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
  state.language = state.language === "zh" ? "en" : "zh";
  writePreference("language", state.language);
  applyLanguage();
  renderAccounts();
});
elements.themeButton.addEventListener("click", () => {
  state.theme = getEffectiveTheme() === "dark" ? "light" : "dark";
  writePreference("theme", state.theme);
  applyTheme();
});
elements.addDialog.addEventListener("click", (event) => {
  if (event.target === elements.addDialog) {
    closeAddDialog();
  }
});
mediaTheme.addEventListener("change", () => {
  if (!state.theme) {
    applyTheme();
  }
});

applyTheme();
applyLanguage();
renderAccounts();

try {
  state.accounts = await loadAccounts();
  renderAccounts();
} catch {
  showToast(t("storageError"));
}

window.setInterval(updateCodes, 1000);
