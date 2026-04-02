import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type UserRole = 'admin' | 'user' | null;

export const useAuthStore = defineStore('auth', () => {
  const role = ref<UserRole>(null);
  const loading = ref(true);

  const userId = ref<string | null>(null);

  const isAdmin = computed(() => role.value === 'admin');
  const isLoggedIn = computed(() => userId.value !== null);

  async function fetchRole() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        role.value = data.role || 'user';
        userId.value = data.userId || null;
      } else {
        role.value = 'user';
        userId.value = null;
      }
    } catch {
      role.value = 'user';
      userId.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function login(password: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      role.value = data.role || 'admin';
      userId.value = 'admin';
      return { success: true };
    }
    return { success: false, error: data.error || 'Nieprawidłowe hasło' };
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    role.value = 'user';
    userId.value = null;
  }

  return { role, loading, isAdmin, isLoggedIn, fetchRole, login, logout };
});
