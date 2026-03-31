<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import { propertiesApi } from '../api/properties';
import { groupsApi } from '../api/groups';
import { settingsApi } from '../api/sync';
import type { PropertyDto, SourceDto, GroupDto } from '../types/api';

const config = useConfigStore();

// ── State ─────────────────────────────────────────────────
const activeSection = ref<'properties' | 'groups' | 'settings'>('properties');
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' });

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message, type };
  setTimeout(() => (toast.value.show = false), 3500);
}

// ── Properties ────────────────────────────────────────────
const propertyDrawer = ref<{
  open: boolean;
  mode: 'create' | 'edit';
  property: any;
  activeTab: 'data' | 'sources';
  sources: SourceDto[];
}>({
  open: false,
  mode: 'create',
  property: { displayName: '', groupId: null, cleaningCost: 0 },
  activeTab: 'data',
  sources: [],
});
const newSource = ref({ icalUrl: '', source: '' });

function openCreateProperty() {
  propertyDrawer.value = {
    open: true,
    mode: 'create',
    property: { displayName: '', groupId: null, cleaningCost: 0 },
    activeTab: 'data',
    sources: [],
  };
}

async function openEditProperty(p: PropertyDto) {
  propertyDrawer.value = {
    open: true,
    mode: 'edit',
    property: {
      id: p.id,
      displayName: p.displayName,
      groupId: p.groupId,
      cleaningCost: p.cleaningCost,
    },
    activeTab: 'data',
    sources: [],
  };
  try {
    propertyDrawer.value.sources = await propertiesApi.listSources(p.id);
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function saveProperty() {
  try {
    const p = propertyDrawer.value.property;
    if (propertyDrawer.value.mode === 'create') {
      await propertiesApi.create({
        displayName: p.displayName,
        groupId: p.groupId || null,
        cleaningCost: p.cleaningCost,
      });
      showToast('Nieruchomość dodana ✓');
    } else {
      await propertiesApi.update(p.id, {
        displayName: p.displayName,
        groupId: p.groupId || null,
        cleaningCost: p.cleaningCost,
      });
      showToast('Nieruchomość zaktualizowana ✓');
    }
    propertyDrawer.value.open = false;
    await config.fetchProperties();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function deleteProperty(id: string) {
  if (!confirm('Na pewno usunąć tę nieruchomość?')) return;
  try {
    await propertiesApi.delete(id);
    showToast('Nieruchomość usunięta');
    await config.fetchProperties();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function regenerateToken(id: string) {
  if (!confirm('Regeneracja tokenu sprawi, że stary link przestanie działać. Kontynuować?')) return;
  try {
    await propertiesApi.regenerateToken(id);
    showToast('Token wygenerowany ✓');
    await config.fetchProperties();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function openSourcesTab(p: PropertyDto) {
  await openEditProperty(p);
  propertyDrawer.value.activeTab = 'sources';
  newSource.value = { icalUrl: '', source: '' };
}

async function addSource() {
  if (!propertyDrawer.value.property?.id || !newSource.value.icalUrl || !newSource.value.source)
    return;
  try {
    await propertiesApi.addSource(propertyDrawer.value.property.id, newSource.value);
    showToast('Źródło dodane ✓');
    newSource.value = { icalUrl: '', source: '' };
    propertyDrawer.value.sources = await propertiesApi.listSources(
      propertyDrawer.value.property.id,
    );
    await config.fetchProperties();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function deleteSource(sourceId: string) {
  if (!propertyDrawer.value.property?.id) return;
  try {
    await propertiesApi.deleteSource(propertyDrawer.value.property.id, sourceId);
    showToast('Źródło usunięte');
    propertyDrawer.value.sources = await propertiesApi.listSources(
      propertyDrawer.value.property.id,
    );
    await config.fetchProperties();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => showToast('Skopiowano ✓'));
}

// ── Groups ────────────────────────────────────────────────
const groupForm = ref({ name: '' });
const editingGroup = ref<GroupDto | null>(null);
const editGroupName = ref('');

async function createGroup() {
  if (!groupForm.value.name.trim()) return;
  try {
    await groupsApi.create(groupForm.value.name.trim());
    showToast('Grupa dodana ✓');
    groupForm.value.name = '';
    await config.fetchGroups();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

function startEditGroup(g: GroupDto) {
  editingGroup.value = g;
  editGroupName.value = g.name;
}

async function saveGroup() {
  if (!editingGroup.value || !editGroupName.value.trim()) return;
  try {
    await groupsApi.update(editingGroup.value.id, editGroupName.value.trim());
    showToast('Grupa zaktualizowana ✓');
    editingGroup.value = null;
    await config.fetchGroups();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

async function deleteGroup(id: string) {
  if (!confirm('Na pewno usunąć tę grupę?')) return;
  try {
    await groupsApi.delete(id);
    showToast('Grupa usunięta');
    await config.fetchGroups();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

// ── Settings ──────────────────────────────────────────────
const settingsForm = ref({ defaultGroupId: '' as string | null });

async function saveSettings() {
  try {
    await settingsApi.update(settingsForm.value.defaultGroupId || null);
    showToast('Ustawienia zapisane ✓');
    await config.fetchSettings();
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

// ── Init ──────────────────────────────────────────────────
onMounted(async () => {
  await config.fetchAll();
  settingsForm.value.defaultGroupId = config.settings.defaultGroupId;
});
</script>

<template>
  <div class="config-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <h2>⚙ Konfiguracja</h2>
      <nav class="sidebar-nav">
        <button
          :class="['sidebar-btn', activeSection === 'properties' ? 'active' : '']"
          @click="activeSection = 'properties'"
        >
          🏠 Nieruchomości
        </button>
        <button
          :class="['sidebar-btn', activeSection === 'groups' ? 'active' : '']"
          @click="activeSection = 'groups'"
        >
          📁 Grupy
        </button>
        <button
          :class="['sidebar-btn', activeSection === 'settings' ? 'active' : '']"
          @click="activeSection = 'settings'"
        >
          ⚙ Ustawienia
        </button>
      </nav>
    </aside>

    <!-- Main content -->
    <div class="config-main">
      <!-- Properties section -->
      <section v-if="activeSection === 'properties'">
        <div class="section-header">
          <h3>Nieruchomości</h3>
          <button class="btn btn-primary" @click="openCreateProperty">+ Dodaj</button>
        </div>

        <div v-if="config.loading" class="loading">Ładowanie...</div>
        <div v-else class="property-grid">
          <div v-for="p in config.properties" :key="p.id" class="property-card">
            <div class="property-card-body">
              <div class="property-card-header">
                <span class="property-name">{{ p.displayName }}</span>
                <span v-if="p.groupName" class="property-group-badge">{{ p.groupName }}</span>
              </div>
              <div class="property-meta">
                <span class="meta-chip">📥 {{ p.sourcesCount }} źródeł</span>
                <span v-if="p.cleaningCost" class="meta-chip">🧹 {{ p.cleaningCost }} PLN</span>
              </div>
              <div class="property-feed" v-if="p.exportUrl">
                <div class="feed-url-text">{{ p.exportUrl }}</div>
                <div class="feed-actions">
                  <button
                    class="btn-icon"
                    title="Kopiuj link"
                    @click="copyToClipboard(p.exportUrl)"
                  >
                    📋
                  </button>
                  <button class="btn-icon" title="Regeneruj token" @click="regenerateToken(p.id)">
                    🔄
                  </button>
                </div>
              </div>
            </div>
            <div class="property-actions">
              <button class="btn btn-secondary btn-sm" @click="openSourcesTab(p)">Źródła</button>
              <button class="btn btn-secondary btn-sm" @click="openEditProperty(p)">Edytuj</button>
              <button class="btn btn-danger btn-sm" @click="deleteProperty(p.id)">Usuń</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Groups section -->
      <section v-if="activeSection === 'groups'">
        <h3>Grupy</h3>
        <div class="group-create-form">
          <input
            v-model="groupForm.name"
            class="input"
            type="text"
            placeholder="Nazwa grupy"
            @keyup.enter="createGroup"
          />
          <button class="btn btn-primary" @click="createGroup">Dodaj grupę</button>
        </div>
        <div class="groups-list">
          <div v-for="g in config.groups" :key="g.id" class="group-item">
            <template v-if="editingGroup?.id === g.id">
              <input v-model="editGroupName" class="input" type="text" @keyup.enter="saveGroup" />
              <button class="btn btn-primary btn-sm" @click="saveGroup">Zapisz</button>
              <button class="btn btn-secondary btn-sm" @click="editingGroup = null">Anuluj</button>
            </template>
            <template v-else>
              <span class="group-name">{{ g.name }}</span>
              <span class="group-meta">{{ g.propertyCount }} nieruchomości</span>
              <button class="btn-icon" @click="startEditGroup(g)">✏️</button>
              <button class="btn-icon" @click="deleteGroup(g.id)">🗑</button>
            </template>
          </div>
          <div v-if="!config.groups.length" class="empty-state">
            Brak grup. Dodaj pierwszą powyżej.
          </div>
        </div>
      </section>

      <!-- Settings section -->
      <section v-if="activeSection === 'settings'">
        <h3>Ustawienia</h3>
        <div class="settings-form">
          <div class="field">
            <label>Domyślna grupa</label>
            <select v-model="settingsForm.defaultGroupId" class="input">
              <option :value="null">— brak —</option>
              <option v-for="g in config.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
          <button class="btn btn-primary" @click="saveSettings">Zapisz ustawienia</button>
        </div>
      </section>
    </div>

    <!-- Property create/edit drawer -->
    <Transition name="drawer">
      <div
        v-if="propertyDrawer.open"
        class="drawer-overlay"
        @click.self="propertyDrawer.open = false"
      >
        <div class="drawer-panel">
          <div class="drawer-header">
            <h3>
              {{
                propertyDrawer.mode === 'create' ? '🏠 Nowa nieruchomość' : '✏️ Edytuj nieruchomość'
              }}
            </h3>
            <button class="drawer-close" @click="propertyDrawer.open = false">✕</button>
          </div>

          <!-- Tabs (only in edit mode) -->
          <div v-if="propertyDrawer.mode === 'edit'" class="drawer-tabs">
            <button
              :class="['drawer-tab', propertyDrawer.activeTab === 'data' ? 'active' : '']"
              @click="propertyDrawer.activeTab = 'data'"
            >
              Dane
            </button>
            <button
              :class="['drawer-tab', propertyDrawer.activeTab === 'sources' ? 'active' : '']"
              @click="propertyDrawer.activeTab = 'sources'"
            >
              Źródła iCal ({{ propertyDrawer.sources.length }})
            </button>
          </div>

          <div class="drawer-body">
            <!-- Tab: Dane -->
            <template
              v-if="propertyDrawer.mode === 'create' || propertyDrawer.activeTab === 'data'"
            >
              <div class="field">
                <label>Nazwa wyświetlana</label>
                <input v-model="propertyDrawer.property.displayName" class="input" type="text" />
              </div>
              <div class="field">
                <label>Grupa</label>
                <select v-model="propertyDrawer.property.groupId" class="input">
                  <option :value="null">— brak —</option>
                  <option v-for="g in config.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
              </div>
              <div class="field">
                <label>Koszt sprzątania (PLN)</label>
                <input
                  v-model.number="propertyDrawer.property.cleaningCost"
                  class="input"
                  type="number"
                  min="0"
                />
              </div>
              <button
                class="btn btn-primary"
                style="width: 100%; margin-top: 16px"
                @click="saveProperty"
              >
                {{ propertyDrawer.mode === 'create' ? 'Dodaj nieruchomość' : 'Zapisz zmiany' }}
              </button>
            </template>

            <!-- Tab: Źródła iCal -->
            <template
              v-if="propertyDrawer.mode === 'edit' && propertyDrawer.activeTab === 'sources'"
            >
              <div v-for="s in propertyDrawer.sources" :key="s.id" class="source-item">
                <div class="source-info">
                  <span class="source-name">{{ s.source || s.name }}</span>
                  <span class="source-url">{{ s.icalUrl }}</span>
                </div>
                <button class="btn-icon" @click="deleteSource(s.id)">🗑</button>
              </div>
              <div v-if="!propertyDrawer.sources.length" class="empty-state">Brak źródeł iCal.</div>

              <h4 style="margin-top: 20px">Dodaj źródło</h4>
              <div class="field">
                <label>Nazwa źródła (np. Booking.com)</label>
                <input v-model="newSource.source" class="input" type="text" />
              </div>
              <div class="field">
                <label>URL iCal</label>
                <input
                  v-model="newSource.icalUrl"
                  class="input"
                  type="url"
                  placeholder="https://..."
                />
              </div>
              <button class="btn btn-primary" style="width: 100%" @click="addSource">
                Dodaj źródło
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Teleport to="body">
      <div :class="['toast', toast.show ? 'active' : '', toast.type]">{{ toast.message }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.config-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  min-height: calc(100vh - 100px);
}

/* Sidebar */
.sidebar {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 20px 16px;
  height: fit-content;
  position: sticky;
  top: 76px;
}
.sidebar h2 {
  font-size: 1.1rem;
  margin: 0 0 16px;
}
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  text-align: left;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.15s;
}
.sidebar-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.sidebar-btn.active {
  background: rgba(111, 231, 255, 0.08);
  color: var(--accent-blue);
  font-weight: 600;
}

/* Main */
.config-main {
  min-width: 0;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.loading {
  color: var(--text-muted);
}

/* Property grid */
.property-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.property-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.property-card:hover {
  border-color: var(--border-hover);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
.property-card-body {
  padding: 14px 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.property-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.property-name {
  font-weight: 700;
  font-size: 1rem;
  color: var(--text-primary);
  line-height: 1.3;
}
.property-group-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}
.property-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.meta-chip {
  font-size: 0.78rem;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  padding: 2px 8px;
  border-radius: 6px;
}
.property-feed {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.feed-url-text {
  font-size: 0.7rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  font-family: monospace;
}
.feed-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.property-actions {
  display: flex;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.12);
}

/* Groups */
.group-create-form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.group-create-form .input {
  flex: 1;
}
.groups-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
}
.group-item .input {
  flex: 1;
}
.group-name {
  font-weight: 600;
}
.group-meta {
  font-size: 0.82rem;
  color: var(--text-muted);
  flex: 1;
}
.empty-state {
  color: var(--text-muted);
  font-size: 0.9rem;
  padding: 16px 0;
}

/* Settings */
.settings-form {
  max-width: 400px;
}

/* Fields */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.field label {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.input {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
  width: 100%;
  box-sizing: border-box;
}
.input:focus {
  outline: none;
  border-color: var(--accent-blue);
}

/* Buttons */
.btn {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
}
.btn-sm {
  padding: 5px 12px;
  font-size: 0.82rem;
}
.btn-primary {
  background: #4299e1;
  color: #fff;
}
.btn-primary:hover {
  background: #3182ce;
}
.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}
.btn-secondary:hover {
  border-color: var(--border-hover);
}
.btn-danger {
  background: transparent;
  color: var(--accent-red);
  border: 1px solid var(--accent-red);
}
.btn-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}
.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
  opacity: 0.6;
}
.btn-icon:hover {
  opacity: 1;
}

/* Drawer tabs */
.drawer-tabs {
  display: flex;
  border-bottom: 1px solid #2d3748;
  padding: 0 20px;
}
.drawer-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 10px 16px;
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.15s;
  margin-bottom: -1px;
}
.drawer-tab:hover {
  color: var(--text-primary);
}
.drawer-tab.active {
  color: var(--accent-blue);
  border-bottom-color: var(--accent-blue);
  font-weight: 600;
}

/* Drawer */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 500;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 420px;
  max-width: 95vw;
  height: 100%;
  background: #1a1f2e;
  border-left: 1px solid #2d3748;
  display: flex;
  flex-direction: column;
}
.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  border-bottom: 1px solid #2d3748;
}
.drawer-header h3 {
  margin: 0;
  font-size: 1rem;
}
.drawer-close {
  background: none;
  border: none;
  color: #64748b;
  font-size: 1.1rem;
  cursor: pointer;
}
.drawer-close:hover {
  color: #e2e8f0;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Source items */
.source-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #2d3748;
}
.source-info {
  flex: 1;
  min-width: 0;
}
.source-name {
  font-weight: 600;
  font-size: 0.9rem;
  display: block;
}
.source-url {
  font-size: 0.78rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

/* Drawer transitions */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.22s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 8px;
  padding: 12px 18px;
  font-size: 0.85rem;
  color: #e2e8f0;
  z-index: 2000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s;
  pointer-events: none;
  max-width: 320px;
}
.toast.active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.toast.success {
  border-left: 3px solid #68d391;
}
.toast.error {
  border-left: 3px solid #fc8181;
}

@media (max-width: 768px) {
  .config-layout {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: static;
  }
}

@media (max-width: 430px) {
  .sidebar {
    padding: 12px;
  }

  .sidebar h2 {
    font-size: 0.95rem;
    margin-bottom: 10px;
  }

  .sidebar-nav {
    flex-direction: row;
    gap: 6px;
  }

  .sidebar-btn {
    flex: 1;
    text-align: center;
    padding: 8px 4px;
    font-size: 0.85rem;
  }

  .drawer-panel {
    max-width: 100vw;
    width: 100%;
  }

  .drawer-body {
    padding: 14px;
  }

  .property-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
