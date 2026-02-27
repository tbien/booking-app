// config-app.js - Vue aplikacja dla config.html (nowy model: Property + sources)

const { createApp, ref, onMounted, onUnmounted } = Vue;

const ConfigApp = {
  setup() {
    const loading = ref(true);
    const error = ref('');
    const properties = ref([]);
    const groups = ref([]);

    // Active sidebar section
    const activeSection = ref('properties');

    // Currently expanded property (for sources panel in cards view)
    const expandedPropertyId = ref(null);
    const propertySources = ref([]);
    const sourcesLoading = ref(false);

    // ── Drawer state ──────────────────────────────────────────────────────
    const drawerOpen = ref(false);
    const drawerMode = ref('add'); // 'add' | 'edit'
    const drawerTab = ref('data'); // 'data' | 'sources'
    const drawerPropertyId = ref(null); // property id being edited
    const drawerSaving = ref(false);
    const drawerError = ref('');
    const drawerForm = ref({ name: '', displayName: '', cleaningCost: 0, groupId: '' });

    const openDrawerAdd = () => {
      drawerForm.value = { name: '', displayName: '', cleaningCost: 0, groupId: '' };
      drawerMode.value = 'add';
      drawerTab.value = 'data';
      drawerError.value = '';
      drawerOpen.value = true;
    };

    const openDrawerEdit = (property) => {
      drawerForm.value = {
        name: property.name,
        displayName: property.displayName,
        cleaningCost: property.cleaningCost || 0,
        groupId: property.groupId || '',
      };
      drawerPropertyId.value = property.id;
      drawerMode.value = 'edit';
      drawerTab.value = 'data';
      drawerError.value = '';
      drawerOpen.value = true;
    };

    const switchDrawerToSources = async () => {
      drawerTab.value = 'sources';
      if (drawerPropertyId.value) {
        await loadSources(drawerPropertyId.value);
      }
    };

    const closeDrawer = () => {
      drawerOpen.value = false;
      drawerError.value = '';
      expandedPropertyId.value = null;
    };

    const submitDrawer = async () => {
      drawerError.value = '';
      drawerSaving.value = true;
      try {
        if (drawerMode.value === 'add') {
          const res = await fetch('/ical/properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: drawerForm.value.name,
              displayName: drawerForm.value.displayName,
              cleaningCost: parseFloat(drawerForm.value.cleaningCost) || 0,
              groupId: drawerForm.value.groupId || undefined,
            }),
          });
          const data = await res.json();
          if (data.success) {
            await loadProperties();
            showToast('Nieruchomość dodana ✓');
            closeDrawer();
          } else {
            drawerError.value = data.error || 'Błąd dodawania';
          }
        } else {
          const res = await fetch('/ical/properties/' + drawerPropertyId.value, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: drawerForm.value.displayName,
              cleaningCost: parseFloat(drawerForm.value.cleaningCost) || 0,
              groupId: drawerForm.value.groupId || null,
            }),
          });
          const data = await res.json();
          if (data.success) {
            await loadProperties();
            showToast('Nieruchomość zaktualizowana ✓');
            closeDrawer();
          } else {
            drawerError.value = data.error || 'Błąd zapisu';
          }
        }
      } catch (err) {
        drawerError.value = 'Błąd połączenia';
      } finally {
        drawerSaving.value = false;
      }
    };

    // Close drawer on Escape
    const onKeydown = (e) => {
      if (e.key === 'Escape' && drawerOpen.value) closeDrawer();
    };
    onMounted(() => window.addEventListener('keydown', onKeydown));
    onUnmounted(() => window.removeEventListener('keydown', onKeydown));

    // Add source form
    const sourceForm = ref({ icalUrl: '', source: '' });

    // Edit source
    const editingSourceId = ref(null);
    const editSourceForm = ref({ icalUrl: '', source: '' });

    // Group forms
    const groupForm = ref({ groupName: '' });
    const editingGroupId = ref(null);
    const editGroupForm = ref({ name: '' });

    // App settings
    const settings = ref({ defaultGroupId: '' });
    const settingsSaving = ref(false);
    const settingsMsg = ref('');

    const toast = ref('');
    let toastTimer = null;
    const showToast = (msg) => {
      toast.value = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.value = '';
      }, 3000);
    };

    // ── Modal dialog ───────────────────────────────────────────────────────
    const modal = ref({ open: false, type: 'confirm', title: '', message: '', resolve: null });

    const showConfirm = (title, message) =>
      new Promise((resolve) => {
        modal.value = { open: true, type: 'confirm', title, message, resolve };
      });

    const showAlert = (message, title = 'Błąd') =>
      new Promise((resolve) => {
        modal.value = { open: true, type: 'alert', title, message, resolve };
      });

    const confirmModal = () => {
      const resolve = modal.value.resolve;
      modal.value = { ...modal.value, open: false };
      resolve(true);
    };

    const dismissModal = () => {
      const resolve = modal.value.resolve;
      modal.value = { ...modal.value, open: false };
      resolve(false);
    };

    // ── Settings ──────────────────────────────────────────────────────────
    const loadSettings = async () => {
      try {
        const res = await fetch('/ical/settings');
        const data = await res.json();
        if (data.success && data.settings) {
          settings.value.defaultGroupId =
            data.settings.defaultGroupId?._id || data.settings.defaultGroupId || '';
        }
      } catch (err) {
        console.error(err);
      }
    };

    const saveSettings = async () => {
      settingsSaving.value = true;
      settingsMsg.value = '';
      try {
        const res = await fetch('/ical/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultGroupId: settings.value.defaultGroupId || null }),
        });
        const data = await res.json();
        settingsMsg.value = data.success ? '✅ Zapisano' : '❌ ' + data.error;
      } catch (err) {
        settingsMsg.value = '❌ Błąd zapisu';
      } finally {
        settingsSaving.value = false;
        setTimeout(() => {
          settingsMsg.value = '';
        }, 3000);
      }
    };

    // ── Groups ────────────────────────────────────────────────────────────
    const loadGroups = async () => {
      try {
        const res = await fetch('/ical/groups');
        const data = await res.json();
        groups.value = data.groups;
      } catch (err) {
        error.value = 'Błąd ładowania grup';
      }
    };

    const addGroup = async () => {
      try {
        const res = await fetch('/ical/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: groupForm.value.groupName }),
        });
        const data = await res.json();
        if (data.success) {
          groupForm.value.groupName = '';
          await loadGroups();
          showToast('Grupa dodana ✓');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd dodawania grupy';
      }
    };

    const startEditGroup = (group) => {
      editingGroupId.value = group._id;
      editGroupForm.value = { name: group.name };
    };
    const cancelEditGroup = () => {
      editingGroupId.value = null;
    };

    const saveEditGroup = async (id) => {
      try {
        await fetch('/ical/groups/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editGroupForm.value.name }),
        });
        editingGroupId.value = null;
        await loadGroups();
      } catch (err) {
        error.value = 'Błąd zapisu grupy';
      }
    };

    const deleteGroup = async (id) => {
      if (!await showConfirm('Usuń grupę', 'Na pewno usunąć tę grupę?')) return;
      try {
        await fetch('/ical/groups/' + id, { method: 'DELETE' });
        await loadGroups();
        await loadProperties();
      } catch (err) {
        error.value = 'Błąd usuwania grupy';
      }
    };

    // ── Properties ────────────────────────────────────────────────────────
    const loadProperties = async () => {
      try {
        loading.value = true;
        const res = await fetch('/ical/properties');
        const data = await res.json();
        properties.value = data.properties || [];
      } catch (err) {
        error.value = 'Błąd ładowania nieruchomości';
      } finally {
        loading.value = false;
      }
    };

    const deleteProperty = async (id) => {
      if (!await showConfirm('Usuń nieruchomość', 'Na pewno usunąć tę nieruchomość i wszystkie jej źródła iCal? Tej operacji nie można cofnąć.')) return;
      try {
        const res = await fetch('/ical/properties/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          await loadProperties();
          if (expandedPropertyId.value === id) expandedPropertyId.value = null;
          showToast('Nieruchomość usunięta');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd usuwania nieruchomości';
      }
    };

    const copyExportUrl = (url) => {
      navigator.clipboard.writeText(url).then(() => showToast('Link skopiowany ✓'));
    };

    const regenerateToken = async (id) => {
      if (!await showConfirm('Regeneruj token', 'Stary link do kalendarza iCal przestanie działać. Wygenerowany zostanie nowy token. Kontynuować?')) return;
      try {
        const res = await fetch('/ical/properties/' + id + '/regenerate-export-token', {
          method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
          await loadProperties();
          showToast('Token zregenerowany ✓');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd regeneracji tokenu';
      }
    };

    // ── Sources ───────────────────────────────────────────────────────────
    const toggleSources = async (propertyId) => {
      if (expandedPropertyId.value === propertyId) {
        expandedPropertyId.value = null;
        return;
      }
      expandedPropertyId.value = propertyId;
      await loadSources(propertyId);
    };

    const loadSources = async (propertyId) => {
      sourcesLoading.value = true;
      try {
        const res = await fetch('/ical/properties/' + propertyId + '/sources');
        const data = await res.json();
        propertySources.value = data.sources || [];
        sourceForm.value = { icalUrl: '', source: '' };
        editingSourceId.value = null;
      } catch (err) {
        error.value = 'Błąd ładowania źródeł';
      } finally {
        sourcesLoading.value = false;
      }
    };

    const addSource = async (propertyId) => {
      try {
        new URL(sourceForm.value.icalUrl);
      } catch {
        await showAlert('Podany adres nie jest prawidłowym URL-em iCal.', 'Nieprawidłowy URL');
        return;
      }
      try {
        const res = await fetch('/ical/properties/' + propertyId + '/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            icalUrl: sourceForm.value.icalUrl,
            source: sourceForm.value.source,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await loadSources(propertyId);
          showToast('Źródło dodane ✓');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd dodawania źródła';
      }
    };

    const startEditSource = (source) => {
      editingSourceId.value = source.id;
      editSourceForm.value = { icalUrl: source.icalUrl, source: source.source };
    };
    const cancelEditSource = () => {
      editingSourceId.value = null;
    };

    const saveEditSource = async (propertyId, sourceId) => {
      try {
        const res = await fetch('/ical/properties/' + propertyId + '/sources/' + sourceId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            icalUrl: editSourceForm.value.icalUrl,
            source: editSourceForm.value.source,
          }),
        });
        const data = await res.json();
        if (data.success) {
          editingSourceId.value = null;
          await loadSources(propertyId);
          showToast('Źródło zaktualizowane ✓');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd zapisu źródła';
      }
    };

    const deleteSource = async (propertyId, sourceId) => {
      if (!await showConfirm('Usuń źródło', 'Na pewno usunąć to źródło iCal?')) return;
      try {
        const res = await fetch('/ical/properties/' + propertyId + '/sources/' + sourceId, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (data.success) {
          await loadSources(propertyId);
          showToast('Źródło usunięte');
        } else {
          await showAlert(data.error);
        }
      } catch (err) {
        error.value = 'Błąd usuwania źródła';
      }
    };

    // ── Init ──────────────────────────────────────────────────────────────
    onMounted(async () => {
      try {
        await Promise.all([loadGroups(), loadProperties(), loadSettings()]);
      } catch (err) {
        error.value = 'Błąd inicjalizacji';
      }
    });

    return {
      loading,
      error,
      toast,
      properties,
      groups,
      activeSection,
      expandedPropertyId,
      propertySources,
      sourcesLoading,
      // drawer
      drawerOpen,
      drawerMode,
      drawerTab,
      drawerPropertyId,
      drawerSaving,
      drawerError,
      drawerForm,
      openDrawerAdd,
      openDrawerEdit,
      switchDrawerToSources,
      closeDrawer,
      submitDrawer,
      // modal
      modal,
      confirmModal,
      dismissModal,
      // sources
      sourceForm,
      editingSourceId,
      editSourceForm,
      // groups
      groupForm,
      editingGroupId,
      editGroupForm,
      // settings
      settings,
      settingsSaving,
      settingsMsg,
      // methods
      deleteProperty,
      copyExportUrl,
      regenerateToken,
      toggleSources,
      addSource,
      startEditSource,
      cancelEditSource,
      saveEditSource,
      deleteSource,
      addGroup,
      startEditGroup,
      cancelEditGroup,
      saveEditGroup,
      deleteGroup,
      saveSettings,
    };
  },
};
