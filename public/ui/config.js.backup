// config.js - Skrypty dla config.html

// Zmienne globalne
let editingId = null;
let editingGroupId = null;
let groups = [];

// Funkcja do ładowania grup
async function loadGroups() {
  const res = await fetch('/ical/groups');
  const data = await res.json();
  groups = data.groups;
  updateGroupSelects();
  updateGroupTable();
}

// Funkcja do aktualizacji selectów grup
function updateGroupSelects() {
  const selects = document.querySelectorAll('select[name="groupId"]');
  selects.forEach((select) => {
    select.innerHTML =
      '<option value="">Brak grupy</option>' +
      groups.map((g) => `<option value="${g._id}">${g.name}</option>`).join('');
  });
}

// Funkcja do aktualizacji tabeli grup
function updateGroupTable() {
  const tbody = document.querySelector('#groupTable tbody');
  tbody.innerHTML = groups
    .map((g) => {
      if (editingGroupId === g._id) {
        return `<tr>
      <td><input class="input" id="editGroupName" value="${g.name}"></td>
      <td>${g.propertyCount || 0}</td>
      <td>
        <button class="action-button primary" onclick="saveGroupEdit('${g._id}')">💾</button>
        <button class="action-button" onclick="cancelGroupEdit()">✖️</button>
      </td>
    </tr>`;
      }
      return `<tr>
    <td>${g.name}</td>
    <td>${g.propertyCount || 0}</td>
    <td>
      <button class="action-button" onclick="startGroupEdit('${g._id}')">✏️</button>
      <button class="action-button" onclick="delGroup('${
        g._id
      }')" style="color:#ff7ad9">🗑️</button>
    </td>
  </tr>`;
    })
    .join('');
}

// Funkcja do ładowania nieruchomości
async function load() {
  const res = await fetch('/ical/properties');
  const data = await res.json();
  const tbody = document.querySelector('#propTable tbody');
  tbody.innerHTML = data.properties
    .map((p) => {
      if (editingId === p._id) {
        return `<tr>
      <td><input class="input" id="editName" value="${p.name}"></td>
      <td><input class="input" id="editUrl" value="${p.icalUrl}"></td>
      <td><input class="input" id="editSource" value="${p.source}"></td>
      <td><input type="number" class="input" id="editCleaningCost" value="${
        p.cleaningCost || 0
      }" min="0" step="0.01"></td>
      <td><select class="filter-select" id="editGroupId">
        <option value="">Brak grupy</option>
        ${groups
          .map(
            (g) =>
              `<option value="${g._id}" ${
                p.groupId && p.groupId._id === g._id ? 'selected' : ''
              }>${g.name}</option>`,
          )
          .join('')}
      </select></td>
      <td>
        <button class="action-button primary" onclick="saveEdit('${p._id}')">💾</button>
        <button class="action-button" onclick="cancelEdit()">✖️</button>
      </td>
    </tr>`;
      }
      return `<tr>
    <td>${p.name}</td>
    <td class="muted" style="font-size:12px;word-break:break-all">${p.icalUrl}</td>
    <td>${p.source}</td>
    <td>${p.cleaningCost || 0}</td>
    <td>${p.groupId ? p.groupId.name : 'Brak'}</td>
    <td>
      <button class="action-button" onclick="startEdit('${p._id}')">✏️</button>
      <button class="action-button" onclick="del('${
        p._id
      }')" style="color:#ff7ad9">🗑️</button>
    </td>
  </tr>`;
    })
    .join('');
}

// Event listener dla formularza dodawania nieruchomości
function addProperty(e) {
  e.preventDefault();
  const form = e.target;

  // Walidacja URL
  try {
    new URL(form.icalUrl.value);
  } catch {
    alert('Nieprawidłowy URL dla iCal. Wprowadź prawidłowy adres URL.');
    return;
  }

  fetch('/ical/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name.value,
      icalUrl: form.icalUrl.value,
      source: form.source.value,
      cleaningCost: parseFloat(form.cleaningCost.value) || 0,
      groupId: form.groupId.value || undefined,
    }),
  }).then(() => {
    form.reset();
    loadGroups(); // Refresh group counts
    load();
  });
}

// Event listener dla formularza dodawania grupy
function addGroup(e) {
  e.preventDefault();
  const form = e.target;
  fetch('/ical/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.groupName.value,
    }),
  }).then(() => {
    form.reset();
    loadGroups();
    load(); // Refresh properties table to update group dropdown
  });
}

// Funkcje dla nieruchomości
window.del = async function (id) {
  if (!confirm('Na pewno usunąć?')) return;
  await fetch('/ical/properties/' + id, { method: 'DELETE' });
  await loadGroups(); // Refresh group counts
  load();
};

window.startEdit = function (id) {
  editingId = id;
  load();
};

window.cancelEdit = function () {
  editingId = null;
  load();
};

window.saveEdit = async function (id) {
  const name = document.getElementById('editName').value;
  const icalUrl = document.getElementById('editUrl').value;
  const source = document.getElementById('editSource').value;
  const cleaningCost = parseFloat(document.getElementById('editCleaningCost').value) || 0;
  const groupId = document.getElementById('editGroupId').value || undefined;
  await fetch('/ical/properties/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icalUrl, source, cleaningCost, groupId }),
  });
  editingId = null;
  await loadGroups(); // Refresh group counts
  load();
};

// Funkcje dla grup
window.delGroup = async function (id) {
  if (!confirm('Na pewno usunąć grupę?')) return;
  await fetch('/ical/groups/' + id, { method: 'DELETE' });
  await loadGroups();
  load(); // Refresh properties table
};

window.startGroupEdit = function (id) {
  editingGroupId = id;
  updateGroupTable();
};

window.cancelGroupEdit = function () {
  editingGroupId = null;
  updateGroupTable();
};

window.saveGroupEdit = async function (id) {
  const name = document.getElementById('editGroupName').value;
  await fetch('/ical/groups/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  editingGroupId = null;
  await loadGroups();
  load(); // Refresh properties table
};