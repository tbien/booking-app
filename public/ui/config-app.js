// config-app.js - Vue aplikacja dla config.html

const { createApp, ref, onMounted } = Vue;

const ConfigApp = {
  setup() {
    // Stan aplikacji
    const loading = ref(true);
    const error = ref('');
    const properties = ref([]);
    const groups = ref([]);
    const editingId = ref(null);
    const editingGroupId = ref(null);

    // Formularze
    const propertyForm = ref({
      name: '',
      icalUrl: '',
      source: '',
      cleaningCost: 0,
      groupId: '',
    });

    const groupForm = ref({
      groupName: '',
    });

    // Edycja nieruchomości
    const editProperty = ref({
      name: '',
      icalUrl: '',
      source: '',
      cleaningCost: 0,
      groupId: '',
    });

    // Edycja grupy
    const editGroup = ref({
      name: '',
    });

    // Funkcja do ładowania grup
    const loadGroups = async () => {
      try {
        const res = await fetch('/ical/groups');
        const data = await res.json();
        groups.value = data.groups;
      } catch (err) {
        error.value = 'Błąd podczas ładowania grup';
        console.error(err);
      }
    };

    // Funkcja do ładowania nieruchomości
    const loadProperties = async () => {
      try {
        loading.value = true;
        const res = await fetch('/ical/properties');
        const data = await res.json();
        properties.value = data.properties;
      } catch (err) {
        error.value = 'Błąd podczas ładowania nieruchomości';
        console.error(err);
      } finally {
        loading.value = false;
      }
    };

    // Dodawanie nieruchomości
    const addProperty = async () => {
      try {
        // Walidacja URL
        new URL(propertyForm.value.icalUrl);

        const response = await fetch('/ical/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: propertyForm.value.name,
            icalUrl: propertyForm.value.icalUrl,
            source: propertyForm.value.source,
            cleaningCost: parseFloat(propertyForm.value.cleaningCost) || 0,
            groupId: propertyForm.value.groupId || undefined,
          }),
        });

        if (response.ok) {
          // Reset formularza
          propertyForm.value = {
            name: '',
            icalUrl: '',
            source: '',
            cleaningCost: 0,
            groupId: '',
          };

          await loadGroups(); // Odśwież liczniki grup
          await loadProperties();
        }
      } catch (err) {
        if (err instanceof TypeError) {
          alert('Nieprawidłowy URL dla iCal. Wprowadź prawidłowy adres URL.');
        } else {
          error.value = 'Błąd podczas dodawania nieruchomości';
          console.error(err);
        }
      }
    };

    // Dodawanie grupy
    const addGroup = async () => {
      try {
        const response = await fetch('/ical/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: groupForm.value.groupName,
          }),
        });

        if (response.ok) {
          groupForm.value.groupName = '';
          await loadGroups();
          await loadProperties(); // Odśwież tabele nieruchomości dla dropdown
        }
      } catch (err) {
        error.value = 'Błąd podczas dodawania grupy';
        console.error(err);
      }
    };

    // Usuwanie nieruchomości
    const deleteProperty = async (id) => {
      if (!confirm('Na pewno usunąć?')) return;

      try {
        await fetch('/ical/properties/' + id, { method: 'DELETE' });
        await loadGroups(); // Odśwież liczniki grup
        await loadProperties();
      } catch (err) {
        error.value = 'Błąd podczas usuwania nieruchomości';
        console.error(err);
      }
    };

    // Rozpoczęcie edycji nieruchomości
    const startEditProperty = (property) => {
      editingId.value = property._id;
      editProperty.value = {
        name: property.name,
        icalUrl: property.icalUrl,
        source: property.source,
        cleaningCost: property.cleaningCost || 0,
        groupId: property.groupId ? property.groupId._id : '',
      };
    };

    // Anulowanie edycji nieruchomości
    const cancelEditProperty = () => {
      editingId.value = null;
      editProperty.value = {
        name: '',
        icalUrl: '',
        source: '',
        cleaningCost: 0,
        groupId: '',
      };
    };

    // Zapisanie edycji nieruchomości
    const saveEditProperty = async (id) => {
      try {
        await fetch('/ical/properties/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editProperty.value.name,
            icalUrl: editProperty.value.icalUrl,
            source: editProperty.value.source,
            cleaningCost: parseFloat(editProperty.value.cleaningCost) || 0,
            groupId: editProperty.value.groupId || undefined,
          }),
        });

        editingId.value = null;
        await loadGroups(); // Odśwież liczniki grup
        await loadProperties();
      } catch (err) {
        error.value = 'Błąd podczas zapisywania nieruchomości';
        console.error(err);
      }
    };

    // Usuwanie grupy
    const deleteGroup = async (id) => {
      if (!confirm('Na pewno usunąć grupę?')) return;

      try {
        await fetch('/ical/groups/' + id, { method: 'DELETE' });
        await loadGroups();
        await loadProperties(); // Odśwież tabelę nieruchomości
      } catch (err) {
        error.value = 'Błąd podczas usuwania grupy';
        console.error(err);
      }
    };

    // Rozpoczęcie edycji grupy
    const startEditGroup = (group) => {
      editingGroupId.value = group._id;
      editGroup.value = {
        name: group.name,
      };
    };

    // Anulowanie edycji grupy
    const cancelEditGroup = () => {
      editingGroupId.value = null;
      editGroup.value = {
        name: '',
      };
    };

    // Zapisanie edycji grupy
    const saveEditGroup = async (id) => {
      try {
        await fetch('/ical/groups/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editGroup.value.name,
          }),
        });

        editingGroupId.value = null;
        await loadGroups();
        await loadProperties(); // Odśwież tabelę nieruchomości
      } catch (err) {
        error.value = 'Błąd podczas zapisywania grupy';
        console.error(err);
      }
    };

    // Inicjalizacja przy załadowaniu - ładowanie równoczesne
    onMounted(async () => {
      try {
        await Promise.all([loadGroups(), loadProperties()]);
      } catch (err) {
        error.value = 'Błąd podczas inicjalizacji';
        console.error(err);
      }
    });

    return {
      // Stan
      loading,
      error,
      properties,
      groups,
      editingId,
      editingGroupId,

      // Formularze
      propertyForm,
      groupForm,
      editProperty,
      editGroup,

      // Funkcje
      addProperty,
      addGroup,
      deleteProperty,
      startEditProperty,
      cancelEditProperty,
      saveEditProperty,
      deleteGroup,
      startEditGroup,
      cancelEditGroup,
      saveEditGroup,
      loadGroups,
      loadProperties,
    };
  },
};
