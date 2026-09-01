const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const STATE = { members: [], rooms: [], dishes: [] };
let essensWeek = null;
let editingDishId = null;

// ---------- helpers ----------

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  if (!res.ok) {
    let msg = "Fehler bei der Anfrage";
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch (e) {}
    toast(msg);
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function isoWeekday(date) {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}
function mondayOf(date) {
  const wd = isoWeekday(date);
  const d = new Date(date);
  d.setDate(d.getDate() - wd);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function formatDateLong(d) {
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}
function formatDateShort(d) {
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function weekRangeLabel(mondayIso) {
  const start = new Date(mondayIso + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

function roomOptions(selected) {
  return (
    `<option value="">– Raum –</option>` +
    STATE.rooms.map((r) => `<option value="${r.id}" ${selected === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")
  );
}
function memberOptions(includeEmpty, selected) {
  return (
    (includeEmpty ? `<option value="">– Person –</option>` : "") +
    STATE.members.map((m) => `<option value="${m.id}" ${selected === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")
  );
}

function renderTaskList(tasks, week, compact) {
  if (!tasks.length) return '<p class="empty-state">Keine Aufgaben.</p>';
  return tasks
    .map(
      (t) => `
    <div class="task-row ${t.done ? "done" : ""}">
      <input type="checkbox" data-toggle-task="${t.id}" ${t.done ? "checked" : ""}>
      <div class="task-main">
        <span class="room">${esc(t.room_name || "Allgemein")}</span> — <span class="activity">${esc(t.activity)}</span>
        ${t.member_name ? `<span class="badge" style="background:${t.member_color || "#6366f1"}">${esc(t.member_name)}</span>` : ""}
        ${!compact && t.notes ? `<div class="meta">${esc(t.notes)}</div>` : ""}
      </div>
      ${!compact ? `<button class="icon-btn" data-delete-task="${t.id}">✕</button>` : ""}
    </div>`
    )
    .join("");
}

function bindTaskToggles(container, week, refreshFn) {
  container.querySelectorAll("[data-toggle-task]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      await api(`/tasks/${cb.dataset.toggleTask}/toggle?week=${week}`, { method: "POST" });
      refreshFn();
    })
  );
}

function bindGotoLinks(container) {
  container.querySelectorAll("[data-goto]").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.goto)));
}

function mealSummary(e) {
  const name = e.dish_name || e.custom_text || "–";
  return `<p><strong>${esc(name)}</strong>${e.member_name ? ` <span class="badge" style="background:#6366f1">${esc(e.member_name)}</span>` : ""}</p>${
    e.wishes ? `<p class="meta">${esc(e.wishes)}</p>` : ""
  }`;
}

async function loadBaseData() {
  const [members, rooms, dishes] = await Promise.all([api("/members"), api("/rooms"), api("/dishes")]);
  STATE.members = members;
  STATE.rooms = rooms;
  STATE.dishes = dishes;
}

// ---------- Übersicht ----------

async function renderUebersicht() {
  await loadBaseData();
  const container = document.getElementById("view-uebersicht");
  const today = new Date();
  const todayWd = isoWeekday(today);
  const monday = fmtISO(mondayOf(today));
  const [tasksResp, mealResp, shopping] = await Promise.all([api(`/tasks?week=${monday}`), api(`/mealplan?week=${monday}`), api("/shopping")]);
  const todayTasks = tasksResp.tasks.filter((t) => t.weekday === todayWd);
  const openTasksWeek = tasksResp.tasks.filter((t) => !t.done).length;
  const todayMeal = mealResp.entries.find((e) => e.weekday === todayWd);
  const openShopping = shopping.filter((i) => !i.checked);

  container.innerHTML = `
    <h2>Übersicht — ${WEEKDAYS[todayWd]}, ${formatDateLong(today)}</h2>
    <div class="dashboard-grid">
      <div class="card">
        <h3>Heutige Putzaufgaben</h3>
        ${renderTaskList(todayTasks, monday, true)}
      </div>
      <div class="card">
        <h3>Heute kochen</h3>
        ${todayMeal ? mealSummary(todayMeal) : '<p class="empty-state">Für heute ist noch nichts geplant.</p>'}
        <button class="link-btn" data-goto="essensplan">Essensplan öffnen →</button>
      </div>
      <div class="card">
        <h3>Einkaufsliste</h3>
        <div class="stat"><span>Offene Artikel</span><span class="num">${openShopping.length}</span></div>
        <button class="link-btn" data-goto="einkauf">Einkaufsliste öffnen →</button>
      </div>
      <div class="card">
        <h3>Diese Woche</h3>
        <div class="stat"><span>Offene Putzaufgaben</span><span class="num">${openTasksWeek}</span></div>
        <div class="stat"><span>Favoriten gespeichert</span><span class="num">${STATE.dishes.length}</span></div>
        <button class="link-btn" data-goto="putzplan">Putzplan öffnen →</button>
      </div>
    </div>
  `;
  bindGotoLinks(container);
  bindTaskToggles(container, monday, renderUebersicht);
}

// ---------- Putzplan ----------

async function renderPutzplan() {
  await loadBaseData();
  const container = document.getElementById("view-putzplan");
  const monday = fmtISO(mondayOf(new Date()));
  const resp = await api(`/tasks?week=${monday}`);
  const tasks = resp.tasks;
  const days = WEEKDAYS.map((name, wd) => {
    const dayTasks = tasks.filter((t) => t.weekday === wd);
    const isToday = wd === isoWeekday(new Date());
    return `<div class="card day-card ${isToday ? "today" : ""}">
      <h3>${name}</h3>
      ${renderTaskList(dayTasks, monday, false)}
    </div>`;
  }).join("");

  container.innerHTML = `
    <h2>Putzplan</h2>
    <p class="empty-state">Wiederkehrender Wochenplan – die Haken werden jede Woche automatisch zurückgesetzt.</p>
    <div class="card">
      <h3>Neue Aufgabe</h3>
      <form id="task-form">
        <div class="form-row">
          <select name="weekday">${WEEKDAYS.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select>
          <select name="room_id">${roomOptions()}</select>
          <input name="activity" placeholder="Aktivität (z.B. Staubsaugen)" required>
          <select name="member_id">${memberOptions(true)}</select>
        </div>
        <div class="form-actions"><button class="primary" type="submit">Hinzufügen</button></div>
      </form>
    </div>
    <div class="day-grid">${days}</div>
  `;

  bindTaskToggles(container, monday, renderPutzplan);
  container.querySelectorAll("[data-delete-task]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Aufgabe wirklich löschen?")) return;
      await api(`/tasks/${btn.dataset.deleteTask}`, { method: "DELETE" });
      renderPutzplan();
    })
  );
  container.querySelector("#task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/tasks", {
      method: "POST",
      body: {
        weekday: Number(fd.get("weekday")),
        room_id: fd.get("room_id") ? Number(fd.get("room_id")) : null,
        activity: fd.get("activity"),
        member_id: fd.get("member_id") ? Number(fd.get("member_id")) : null,
      },
    });
    toast("Aufgabe hinzugefügt");
    renderPutzplan();
  });
}

// ---------- Essensplan ----------

async function renderEssensplan() {
  await loadBaseData();
  if (!essensWeek) essensWeek = fmtISO(mondayOf(new Date()));
  const container = document.getElementById("view-essensplan");
  const resp = await api(`/mealplan?week=${essensWeek}`);
  const entryByDay = {};
  resp.entries.forEach((e) => (entryByDay[e.weekday] = e));
  const weekLabel = weekRangeLabel(essensWeek);
  const isCurrentWeek = essensWeek === fmtISO(mondayOf(new Date()));

  const days = WEEKDAYS.map((name, wd) => {
    const e = entryByDay[wd];
    const isToday = isCurrentWeek && wd === isoWeekday(new Date());
    return `<div class="card day-card ${isToday ? "today" : ""}">
      <h3>${name}</h3>
      <select data-meal-dish="${wd}">
        <option value="">– Freitext / kein Gericht –</option>
        ${STATE.dishes.map((d) => `<option value="${d.id}" ${e && e.dish_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
      </select>
      <input data-meal-custom="${wd}" placeholder="oder freier Text..." value="${e && !e.dish_id ? esc(e.custom_text || "") : ""}" style="margin-top:6px">
      <textarea data-meal-wishes="${wd}" placeholder="Wünsche / Notizen" rows="2" style="margin-top:6px">${e ? esc(e.wishes || "") : ""}</textarea>
      <select data-meal-member="${wd}" style="margin-top:6px">${memberOptions(true, e ? e.member_id : null)}</select>
    </div>`;
  }).join("");

  container.innerHTML = `
    <h2>Essensplan</h2>
    <div class="week-nav">
      <button class="secondary" data-week="prev">← Vorherige Woche</button>
      <span class="label">${weekLabel}</span>
      <button class="secondary" data-week="next">Nächste Woche →</button>
      <button class="secondary" data-week="today">Heute</button>
    </div>
    <div class="day-grid">${days}</div>
  `;

  container.querySelectorAll("[data-week]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.week === "today") {
        essensWeek = fmtISO(mondayOf(new Date()));
      } else {
        const d = new Date(essensWeek + "T00:00:00");
        d.setDate(d.getDate() + (btn.dataset.week === "prev" ? -7 : 7));
        essensWeek = fmtISO(d);
      }
      renderEssensplan();
    })
  );

  const saveDay = async (wd) => {
    const dishSel = container.querySelector(`[data-meal-dish="${wd}"]`);
    const customInp = container.querySelector(`[data-meal-custom="${wd}"]`);
    const wishesInp = container.querySelector(`[data-meal-wishes="${wd}"]`);
    const memberSel = container.querySelector(`[data-meal-member="${wd}"]`);
    await api(`/mealplan?week=${essensWeek}`, {
      method: "POST",
      body: {
        weekday: wd,
        dish_id: dishSel.value ? Number(dishSel.value) : null,
        custom_text: customInp.value || null,
        wishes: wishesInp.value || null,
        member_id: memberSel.value ? Number(memberSel.value) : null,
      },
    });
    toast("Gespeichert");
  };
  WEEKDAYS.forEach((_, wd) => {
    container.querySelector(`[data-meal-dish="${wd}"]`).addEventListener("change", () => saveDay(wd));
    container.querySelector(`[data-meal-custom="${wd}"]`).addEventListener("blur", () => saveDay(wd));
    container.querySelector(`[data-meal-wishes="${wd}"]`).addEventListener("blur", () => saveDay(wd));
    container.querySelector(`[data-meal-member="${wd}"]`).addEventListener("change", () => saveDay(wd));
  });
}

// ---------- Favoriten ----------

async function renderFavoriten() {
  await loadBaseData();
  editingDishId = null;
  const container = document.getElementById("view-favoriten");
  container.innerHTML = `
    <h2>Favoriten</h2>
    <div class="card">
      <h3 id="dish-form-title">Neues Gericht</h3>
      <form id="dish-form">
        <div class="form-row">
          <input name="name" placeholder="Name des Gerichts" required>
          <input name="tags" placeholder="Tags (z.B. vegetarisch, schnell)">
        </div>
        <textarea name="notes" placeholder="Notizen" rows="2" style="margin-bottom:8px"></textarea>
        <div id="ingredient-rows"></div>
        <button type="button" class="secondary" id="add-ingredient-row">+ Zutat</button>
        <div class="form-actions">
          <button class="primary" type="submit">Speichern</button>
          <button class="secondary" type="button" id="cancel-edit" style="display:none">Abbrechen</button>
        </div>
      </form>
    </div>
    <div class="day-grid" id="dish-list"></div>
  `;
  renderIngredientRows(container, []);
  renderDishList(container);

  container.querySelector("#add-ingredient-row").addEventListener("click", () => addIngredientRow(container));
  container.querySelector("#dish-form").addEventListener("submit", (e) => onDishFormSubmit(e, container));
  container.querySelector("#cancel-edit").addEventListener("click", () => resetDishForm(container));
}

function renderIngredientRows(container, ingredients) {
  const wrap = container.querySelector("#ingredient-rows");
  wrap.innerHTML = "";
  if (ingredients.length === 0) addIngredientRow(container);
  else ingredients.forEach((ing) => addIngredientRow(container, ing));
}

function addIngredientRow(container, ing) {
  const wrap = container.querySelector("#ingredient-rows");
  const row = document.createElement("div");
  row.className = "form-row ingredient-row";
  row.innerHTML = `
    <input class="ing-name" placeholder="Zutat" value="${ing ? esc(ing.name) : ""}">
    <input class="ing-qty" placeholder="Menge" value="${ing ? esc(ing.quantity || "") : ""}">
    <input class="ing-unit" placeholder="Einheit" value="${ing ? esc(ing.unit || "") : ""}">
    <button type="button" class="icon-btn remove-ing">✕</button>
  `;
  row.querySelector(".remove-ing").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}

function collectIngredients(container) {
  return [...container.querySelectorAll(".ingredient-row")]
    .map((row) => ({
      name: row.querySelector(".ing-name").value.trim(),
      quantity: row.querySelector(".ing-qty").value.trim() || null,
      unit: row.querySelector(".ing-unit").value.trim() || null,
    }))
    .filter((i) => i.name);
}

async function onDishFormSubmit(e, container) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get("name"),
    tags: fd.get("tags") || null,
    notes: fd.get("notes") || null,
    ingredients: collectIngredients(container),
  };
  if (editingDishId) {
    await api(`/dishes/${editingDishId}`, { method: "PUT", body: payload });
    toast("Gericht aktualisiert");
  } else {
    await api("/dishes", { method: "POST", body: payload });
    toast("Gericht gespeichert");
  }
  renderFavoriten();
}

function resetDishForm(container) {
  editingDishId = null;
  container.querySelector("#dish-form").reset();
  container.querySelector("#dish-form-title").textContent = "Neues Gericht";
  container.querySelector("#cancel-edit").style.display = "none";
  renderIngredientRows(container, []);
}

function renderDishList(container) {
  const listEl = container.querySelector("#dish-list");
  if (!STATE.dishes.length) {
    listEl.innerHTML = '<p class="empty-state">Noch keine Favoriten gespeichert.</p>';
    return;
  }
  listEl.innerHTML = STATE.dishes
    .map(
      (d) => `
    <div class="card dish-card">
      <div class="actions">
        <button class="icon-btn" data-edit-dish="${d.id}">✎</button>
        <button class="icon-btn" data-delete-dish="${d.id}">✕</button>
      </div>
      <h3>${esc(d.name)}</h3>
      ${d.tags ? `<div class="tags">${esc(d.tags)}</div>` : ""}
      ${d.notes ? `<p>${esc(d.notes)}</p>` : ""}
      <ul>${d.ingredients.map((i) => `<li>${esc(i.name)}${i.quantity ? ` – ${esc(i.quantity)}${i.unit ? " " + esc(i.unit) : ""}` : ""}</li>`).join("")}</ul>
    </div>`
    )
    .join("");
  listEl.querySelectorAll("[data-edit-dish]").forEach((btn) => btn.addEventListener("click", () => startEditDish(container, Number(btn.dataset.editDish))));
  listEl.querySelectorAll("[data-delete-dish]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Gericht wirklich löschen?")) return;
      await api(`/dishes/${btn.dataset.deleteDish}`, { method: "DELETE" });
      renderFavoriten();
    })
  );
}

function startEditDish(container, id) {
  const d = STATE.dishes.find((x) => x.id === id);
  if (!d) return;
  editingDishId = id;
  const form = container.querySelector("#dish-form");
  form.name.value = d.name;
  form.tags.value = d.tags || "";
  form.notes.value = d.notes || "";
  renderIngredientRows(container, d.ingredients);
  container.querySelector("#dish-form-title").textContent = `Gericht bearbeiten: ${d.name}`;
  container.querySelector("#cancel-edit").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Einkaufsliste ----------

async function renderEinkauf() {
  const container = document.getElementById("view-einkauf");
  const items = await api("/shopping");
  const open = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const groupByCategory = (list) => {
    const groups = {};
    list.forEach((i) => {
      const cat = i.category || "Sonstiges";
      (groups[cat] = groups[cat] || []).push(i);
    });
    return groups;
  };
  const renderGroups = (list) => {
    if (!list.length) return '<p class="empty-state">Keine Artikel.</p>';
    const groups = groupByCategory(list);
    return Object.keys(groups)
      .sort()
      .map(
        (cat) => `
      <div class="category-header">${esc(cat)}</div>
      ${groups[cat]
        .map(
          (i) => `
        <div class="shopping-item ${i.checked ? "checked" : ""}">
          <input type="checkbox" data-toggle-item="${i.id}" ${i.checked ? "checked" : ""}>
          <span class="item-name">${esc(i.name)}</span>
          <span class="item-qty">${esc(i.quantity || "")} ${esc(i.unit || "")}</span>
          <button class="icon-btn" data-delete-item="${i.id}">✕</button>
        </div>`
        )
        .join("")}`
      )
      .join("");
  };

  container.innerHTML = `
    <h2>Einkaufsliste</h2>
    <div class="card">
      <form id="item-form" class="form-row">
        <input name="name" placeholder="Artikel" required>
        <input name="quantity" placeholder="Menge">
        <input name="unit" placeholder="Einheit">
        <input name="category" placeholder="Kategorie (optional)">
        <button class="primary" type="submit">+ Hinzufügen</button>
      </form>
    </div>
    <div class="form-actions" style="margin-bottom:14px">
      <button class="secondary" id="gen-from-plan">🍽 Aus Essensplan generieren</button>
      <button class="secondary" id="clear-checked">Erledigte löschen</button>
      <button class="secondary" id="clear-all">Liste leeren</button>
    </div>
    <div class="card">${renderGroups(open)}</div>
    ${checked.length ? `<h3 style="margin-top:20px">Erledigt</h3><div class="card">${renderGroups(checked)}</div>` : ""}
  `;

  container.querySelector("#item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/shopping", {
      method: "POST",
      body: { name: fd.get("name"), quantity: fd.get("quantity") || null, unit: fd.get("unit") || null, category: fd.get("category") || null },
    });
    renderEinkauf();
  });
  container.querySelectorAll("[data-toggle-item]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      await api(`/shopping/${cb.dataset.toggleItem}`, { method: "PUT", body: { checked: cb.checked } });
      renderEinkauf();
    })
  );
  container.querySelectorAll("[data-delete-item]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/shopping/${btn.dataset.deleteItem}`, { method: "DELETE" });
      renderEinkauf();
    })
  );
  container.querySelector("#gen-from-plan").addEventListener("click", async () => {
    const week = fmtISO(mondayOf(new Date()));
    const res = await api(`/shopping/generate?week=${week}`, { method: "POST" });
    toast(`${res.added} Artikel aus dem Essensplan ergänzt`);
    renderEinkauf();
  });
  container.querySelector("#clear-checked").addEventListener("click", async () => {
    if (!confirm("Erledigte Artikel löschen?")) return;
    await api("/shopping?only_checked=true", { method: "DELETE" });
    renderEinkauf();
  });
  container.querySelector("#clear-all").addEventListener("click", async () => {
    if (!confirm("Wirklich die gesamte Liste leeren?")) return;
    await api("/shopping", { method: "DELETE" });
    renderEinkauf();
  });
}

// ---------- Einstellungen ----------

async function renderEinstellungen() {
  await loadBaseData();
  const container = document.getElementById("view-einstellungen");
  container.innerHTML = `
    <h2>Einstellungen</h2>
    <div class="settings-grid">
      <div class="card">
        <h3>Haushaltsmitglieder</h3>
        <div class="pill-list" id="member-pills"></div>
        <form id="member-form" class="form-row">
          <input name="name" placeholder="Name" required>
          <input name="color" type="color" value="#6366f1">
          <button class="primary" type="submit">+ Hinzufügen</button>
        </form>
      </div>
      <div class="card">
        <h3>Räume</h3>
        <div class="pill-list" id="room-pills"></div>
        <form id="room-form" class="form-row">
          <input name="name" placeholder="Raum" required>
          <button class="primary" type="submit">+ Hinzufügen</button>
        </form>
      </div>
    </div>
  `;
  renderPills(container);
  container.querySelector("#member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/members", { method: "POST", body: { name: fd.get("name"), color: fd.get("color") } });
    renderEinstellungen();
  });
  container.querySelector("#room-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/rooms", { method: "POST", body: { name: fd.get("name") } });
    renderEinstellungen();
  });
}

function renderPills(container) {
  container.querySelector("#member-pills").innerHTML =
    STATE.members
      .map((m) => `<span class="pill" style="background:${m.color}22;color:${m.color}">${esc(m.name)} <button data-del-member="${m.id}">×</button></span>`)
      .join("") || '<span class="empty-state">Noch keine Mitglieder</span>';
  container.querySelector("#room-pills").innerHTML =
    STATE.rooms.map((r) => `<span class="pill">${esc(r.name)} <button data-del-room="${r.id}">×</button></span>`).join("") ||
    '<span class="empty-state">Noch keine Räume</span>';
  container.querySelectorAll("[data-del-member]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/members/${btn.dataset.delMember}`, { method: "DELETE" });
      renderEinstellungen();
    })
  );
  container.querySelectorAll("[data-del-room]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/rooms/${btn.dataset.delRoom}`, { method: "DELETE" });
      renderEinstellungen();
    })
  );
}

// ---------- Tab navigation ----------

const RENDERERS = {
  uebersicht: renderUebersicht,
  putzplan: renderPutzplan,
  essensplan: renderEssensplan,
  favoriten: renderFavoriten,
  einkauf: renderEinkauf,
  einstellungen: renderEinstellungen,
};

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  RENDERERS[name]();
}

async function init() {
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  await loadBaseData();
  switchTab("uebersicht");
}

init();
