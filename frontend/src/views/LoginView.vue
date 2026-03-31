<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    const result = await auth.login(password.value);
    if (result.success) {
      const redirect = (route.query.redirect as string) || '/';
      router.push(redirect);
    } else {
      error.value = result.error || 'Nieprawidłowe hasło';
    }
  } catch {
    error.value = 'Błąd połączenia z serwerem';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-box">
      <div class="lock-icon">🔐</div>
      <h1>Panel Admina</h1>
      <p class="subtitle">Zaloguj się aby zarządzać rezerwacjami</p>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <form @submit.prevent="submit">
        <label for="password">Hasło</label>
        <input
          id="password"
          v-model="password"
          type="password"
          placeholder="Wpisz hasło admina"
          autocomplete="current-password"
          autofocus
        />
        <button type="submit" class="login-btn" :disabled="loading || !password">
          {{ loading ? 'Logowanie...' : 'Zaloguj się' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 80px);
}

.login-box {
  background: #16213e;
  border: 1px solid #0f3460;
  border-radius: 12px;
  padding: 40px 36px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.lock-icon {
  text-align: center;
  font-size: 2.5rem;
  margin-bottom: 12px;
}

h1 {
  margin: 0 0 8px;
  font-size: 1.4rem;
  color: #e2e8f0;
  text-align: center;
}

.subtitle {
  text-align: center;
  color: #94a3b8;
  font-size: 0.875rem;
  margin-bottom: 28px;
}

label {
  display: block;
  font-size: 0.8rem;
  color: #94a3b8;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

input[type='password'] {
  width: 100%;
  box-sizing: border-box;
  background: #0f3460;
  border: 1px solid #1e4a7a;
  color: #e2e8f0;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  margin-bottom: 20px;
  transition: border-color 0.2s;
}

input[type='password']:focus {
  border-color: #4299e1;
}

.login-btn {
  width: 100%;
  background: #4299e1;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 11px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.login-btn:hover {
  background: #3182ce;
}

.login-btn:disabled {
  background: #4a5568;
  cursor: not-allowed;
}

.error-msg {
  background: rgba(229, 62, 62, 0.15);
  border: 1px solid rgba(229, 62, 62, 0.4);
  color: #fc8181;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 0.875rem;
  margin-bottom: 16px;
}
</style>
