const state = {
  initialized: false,
  unlocked: false,
  entries: [],
  filteredEntries: [],
  editingId: null
};

const authView = document.getElementById("auth-view");
const vaultView = document.getElementById("vault-view");
const statusPill = document.getElementById("status-pill");
const entryList = document.getElementById("entry-list");
const searchInput = document.getElementById("search-input");
const newKeyBtn = document.getElementById("new-key-btn");
const lockBtn = document.getElementById("lock-btn");
const toast = document.getElementById("toast");

const dialog = document.getElementById("key-dialog");
const keyForm = document.getElementById("key-form");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("modal-close");

const nameField = document.getElementById("field-name");
const providerField = document.getElementById("field-provider");
const environmentField = document.getElementById("field-environment");
const tagsField = document.getElementById("field-tags");
const secretField = document.getElementById("field-secret");
const secretHelp = document.getElementById("field-secret-help");
const notesField = document.getElementById("field-notes");

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong");
  }
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 1800);
}

function setStatusText() {
  if (!state.initialized) {
    statusPill.textContent = "Vault not initialized";
    return;
  }
  statusPill.textContent = state.unlocked ? "Vault unlocked" : "Vault locked";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEntries() {
  const query = searchInput.value.trim().toLowerCase();
  state.filteredEntries = state.entries.filter((entry) => {
    if (!query) {
      return true;
    }
    const blob = [
      entry.name,
      entry.provider,
      entry.environment,
      entry.notes,
      ...(entry.tags || [])
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(query);
  });

  if (state.filteredEntries.length === 0) {
    const hasKeys = state.entries.length > 0;
    entryList.innerHTML = `
      <div class="empty-state">
        ${hasKeys ? "No keys match this search." : "No keys yet. Add your first key to get started."}
      </div>
    `;
    return;
  }

  entryList.innerHTML = state.filteredEntries
    .map((entry) => {
      const tags = (entry.tags || [])
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      return `
        <article class="entry">
          <div class="entry-main">
            <h3 class="entry-name">${escapeHtml(entry.name)}</h3>
            <p class="entry-meta">
              <span>${escapeHtml(entry.provider || "Unknown provider")}</span>
              <span>•</span>
              <span>${escapeHtml(entry.environment || "default")}</span>
            </p>
            ${entry.notes ? `<p class="entry-meta">${escapeHtml(entry.notes)}</p>` : ""}
            <div class="tags">${tags}</div>
          </div>
          <div class="entry-actions">
            <button type="button" class="btn btn-muted" data-action="copy" data-id="${entry.id}">Copy</button>
            <button type="button" class="btn btn-muted" data-action="reveal" data-id="${entry.id}">Reveal</button>
            <button type="button" class="btn btn-ghost" data-action="edit" data-id="${entry.id}">Edit</button>
            <button type="button" class="btn btn-danger" data-action="delete" data-id="${entry.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAuthView() {
  if (!state.initialized) {
    authView.innerHTML = `
      <div class="auth-card">
        <h2>Create your vault</h2>
        <p>
          This password encrypts your keys locally. Use a strong password (12+
          chars) and keep it safe.
        </p>
        <label>
          Master password
          <input id="init-pass" type="password" minlength="12" autocomplete="new-password" />
        </label>
        <label>
          Confirm password
          <input id="init-pass-confirm" type="password" minlength="12" autocomplete="new-password" />
        </label>
        <p id="auth-error" class="inline-error hidden"></p>
        <button id="create-vault-btn" class="btn btn-primary" type="button">Create vault</button>
      </div>
    `;
    const createVaultBtn = document.getElementById("create-vault-btn");
    createVaultBtn.addEventListener("click", handleInit);
    return;
  }

  authView.innerHTML = `
    <div class="auth-card">
      <h2>Unlock vault</h2>
      <p>Your vault auto-locks after 15 minutes of inactivity.</p>
      <label>
        Master password
        <input id="unlock-pass" type="password" autocomplete="current-password" />
      </label>
      <p id="auth-error" class="inline-error hidden"></p>
      <button id="unlock-vault-btn" class="btn btn-primary" type="button">Unlock</button>
    </div>
  `;
  const unlockBtn = document.getElementById("unlock-vault-btn");
  unlockBtn.addEventListener("click", handleUnlock);
}

function updateViews() {
  setStatusText();
  if (state.unlocked) {
    authView.classList.add("hidden");
    vaultView.classList.remove("hidden");
    renderEntries();
  } else {
    vaultView.classList.add("hidden");
    authView.classList.remove("hidden");
    renderAuthView();
  }
}

async function loadStatus() {
  const status = await api("/api/vault/status");
  state.initialized = status.initialized;
  state.unlocked = status.unlocked;
}

function showAuthError(message) {
  const node = document.getElementById("auth-error");
  node.textContent = message;
  node.classList.remove("hidden");
}

async function handleInit() {
  const pass = document.getElementById("init-pass").value;
  const confirm = document.getElementById("init-pass-confirm").value;
  if (pass !== confirm) {
    showAuthError("Passwords do not match");
    return;
  }
  try {
    await api("/api/vault/init", {
      method: "POST",
      body: { masterPassword: pass }
    });
    state.initialized = true;
    state.unlocked = true;
    await loadEntries();
    updateViews();
    showToast("Vault created");
  } catch (error) {
    showAuthError(error.message);
  }
}

async function handleUnlock() {
  const pass = document.getElementById("unlock-pass").value;
  try {
    await api("/api/vault/unlock", {
      method: "POST",
      body: { masterPassword: pass }
    });
    state.unlocked = true;
    await loadEntries();
    updateViews();
    showToast("Vault unlocked");
  } catch (error) {
    showAuthError(error.message);
  }
}

async function handleLock() {
  await api("/api/vault/lock", { method: "POST" });
  state.unlocked = false;
  state.entries = [];
  updateViews();
  showToast("Vault locked");
}

async function loadEntries() {
  const result = await api("/api/keys");
  state.entries = result.entries || [];
  renderEntries();
}

function openNewDialog() {
  state.editingId = null;
  modalTitle.textContent = "Add key";
  keyForm.reset();
  environmentField.value = "dev";
  secretField.required = true;
  secretField.placeholder = "";
  secretHelp.classList.add("hidden");
  dialog.showModal();
}

function openEditDialog(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  state.editingId = id;
  modalTitle.textContent = "Edit key";
  nameField.value = entry.name || "";
  providerField.value = entry.provider || "";
  environmentField.value = entry.environment || "";
  tagsField.value = (entry.tags || []).join(", ");
  secretField.value = "";
  secretField.required = false;
  secretField.placeholder = "Leave blank to keep the current secret";
  secretHelp.classList.remove("hidden");
  notesField.value = entry.notes || "";
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
  keyForm.reset();
  secretField.required = true;
  secretField.placeholder = "";
  secretHelp.classList.add("hidden");
  state.editingId = null;
}

function tagsFromInput(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function upsertKey(event) {
  event.preventDefault();
  const body = {
    name: nameField.value,
    provider: providerField.value,
    environment: environmentField.value,
    tags: tagsFromInput(tagsField.value),
    secret: secretField.value,
    notes: notesField.value
  };
  if (state.editingId && !body.secret.trim()) {
    const revealed = await api(`/api/keys/${state.editingId}/reveal`, { method: "POST" });
    body.secret = revealed.secret;
  }
  const isEditing = Boolean(state.editingId);
  const endpoint = isEditing ? `/api/keys/${state.editingId}` : "/api/keys";
  const method = isEditing ? "PUT" : "POST";
  try {
    await api(endpoint, { method, body });
    await loadEntries();
    closeDialog();
    showToast(isEditing ? "Key updated" : "Key added");
  } catch (error) {
    showToast(error.message);
  }
}

async function copySecret(id) {
  try {
    const { secret } = await api(`/api/keys/${id}/reveal`, { method: "POST" });
    await navigator.clipboard.writeText(secret);
    showToast("Copied to clipboard");
  } catch (error) {
    showToast(error.message);
  }
}

async function revealSecret(id) {
  try {
    const { secret } = await api(`/api/keys/${id}/reveal`, { method: "POST" });
    showToast(secret.length > 40 ? `${secret.slice(0, 40)}...` : secret);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteKey(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  const shouldDelete = window.confirm(`Delete "${entry.name}"?`);
  if (!shouldDelete) {
    return;
  }
  try {
    await api(`/api/keys/${id}`, { method: "DELETE" });
    await loadEntries();
    showToast("Key removed");
  } catch (error) {
    showToast(error.message);
  }
}

entryList.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-action]");
  if (!target) {
    return;
  }
  const id = target.dataset.id;
  const action = target.dataset.action;
  if (action === "copy") {
    copySecret(id);
    return;
  }
  if (action === "reveal") {
    revealSecret(id);
    return;
  }
  if (action === "edit") {
    openEditDialog(id);
    return;
  }
  if (action === "delete") {
    deleteKey(id);
  }
});

searchInput.addEventListener("input", renderEntries);
newKeyBtn.addEventListener("click", openNewDialog);
lockBtn.addEventListener("click", handleLock);
keyForm.addEventListener("submit", upsertKey);
modalClose.addEventListener("click", closeDialog);

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

document.addEventListener("keydown", (event) => {
  if (!state.unlocked) {
    return;
  }
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }
  if (event.key === "/" && !dialog.open) {
    event.preventDefault();
    searchInput.focus();
  }
});

async function boot() {
  try {
    await loadStatus();
    if (state.unlocked) {
      await loadEntries();
    }
    updateViews();
  } catch (error) {
    statusPill.textContent = error.message;
  }
}

boot();
