import { defineStore } from 'pinia';
import { ref } from 'vue';
import { groupsApi } from '../api/groups';
import { propertiesApi } from '../api/properties';
import { settingsApi } from '../api/sync';
import type { GroupDto, PropertyDto, SettingsDto } from '../types/api';

export const useConfigStore = defineStore('config', () => {
  const groups = ref<GroupDto[]>([]);
  const properties = ref<PropertyDto[]>([]);
  const settings = ref<SettingsDto>({ defaultGroupId: null });
  const loading = ref(false);

  async function fetchGroups() {
    groups.value = await groupsApi.list();
  }

  async function fetchProperties() {
    properties.value = await propertiesApi.list();
  }

  async function fetchSettings() {
    settings.value = await settingsApi.get();
  }

  async function fetchAll() {
    loading.value = true;
    try {
      await Promise.all([fetchGroups(), fetchProperties(), fetchSettings()]);
    } finally {
      loading.value = false;
    }
  }

  return {
    groups,
    properties,
    settings,
    loading,
    fetchGroups,
    fetchProperties,
    fetchSettings,
    fetchAll,
  };
});
