<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { computed, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isAdmin = computed(() => auth.isAdmin);
const isLoggedIn = computed(() => auth.isLoggedIn);
const menuOpen = ref(false);

watch(
  () => route.path,
  () => {
    menuOpen.value = false;
  },
);

async function logout() {
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="app">
    <nav class="topnav">
      <div class="nav-left">
        <RouterLink to="/" class="brand">📅 Booking App</RouterLink>
        <div class="nav-links" :class="{ open: menuOpen }">
          <RouterLink to="/" class="nav-link" active-class="active" @click="menuOpen = false"
            >Rezerwacje</RouterLink
          >
          <RouterLink
            to="/calendar"
            class="nav-link"
            active-class="active"
            @click="menuOpen = false"
            >Kalendarz</RouterLink
          >
          <RouterLink
            to="/config"
            class="nav-link"
            active-class="active"
            v-if="isAdmin"
            @click="menuOpen = false"
            >Konfiguracja</RouterLink
          >
        </div>
      </div>
      <div class="nav-right">
        <span class="role-badge">{{ isAdmin ? 'ADMIN' : 'USER' }}</span>
        <RouterLink v-if="!isLoggedIn" to="/login" class="btn-login">Zaloguj</RouterLink>
        <button v-else class="btn-logout" @click="logout">Wyloguj</button>
        <button
          class="hamburger"
          :class="{ active: menuOpen }"
          @click="menuOpen = !menuOpen"
          aria-label="Menu"
        >
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  --bg-primary: #0b1020;
  --bg-secondary: #111633;
  --bg-tertiary: #0d1330;
  --bg-hover: #0f1430;
  --bg-card: #131836;
  --border-color: #1f2752;
  --border-hover: #273066;
  --text-primary: #e4e8ff;
  --text-muted: #8ea2ff;
  --text-secondary: #aab5ff;
  --accent-pink: #ff7ad9;
  --accent-blue: #6fe7ff;
  --accent-green: #22c55e;
  --accent-red: #ef4444;
  --accent-purple: #4a2457;
  --font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
}

main {
  max-width: 1280px;
  margin: 24px auto;
  padding: 0 20px;
}

.topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 0 20px;
  height: 52px;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--text-primary);
  text-decoration: none;
  margin-right: 16px;
}

.nav-link {
  color: var(--text-muted);
  text-decoration: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: all 0.15s;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.nav-link.active {
  color: var(--accent-blue);
  background: rgba(111, 231, 255, 0.08);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.role-badge {
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 3px 10px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-logout {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.15s;
}

.btn-logout:hover {
  border-color: var(--accent-red);
  color: var(--accent-red);
}

.btn-login {
  border: 1px solid var(--border-color);
  color: var(--accent-blue);
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  text-decoration: none;
  transition: all 0.15s;
}

.btn-login:hover {
  border-color: var(--accent-blue);
  background: rgba(111, 231, 255, 0.08);
}

/* Shared utilities */
.btn {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-primary {
  background: #4299e1;
  color: #fff;
}

.btn-primary:hover {
  background: #3182ce;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.input {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
  transition: border-color 0.15s;
}

.input:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.select {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.hamburger {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 4px;
  margin-left: 4px;
}

.hamburger span {
  display: block;
  width: 22px;
  height: 2px;
  background: var(--text-muted);
  border-radius: 2px;
  transition: all 0.2s;
}

.hamburger.active span:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.hamburger.active span:nth-child(2) {
  opacity: 0;
}

.hamburger.active span:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

@media (max-width: 430px) {
  main {
    padding: 0 12px;
    margin: 16px auto;
  }

  .topnav {
    position: relative;
    padding: 0 12px;
  }

  .nav-left {
    flex: 1;
  }

  .brand {
    font-size: 0.9rem;
    margin-right: 0;
  }

  .nav-links {
    display: none;
    flex-direction: column;
    align-items: stretch;
    position: absolute;
    top: 52px;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    padding: 8px 0;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .nav-links.open {
    display: flex;
  }

  .nav-link {
    padding: 12px 20px;
    border-radius: 0;
    font-size: 0.95rem;
  }

  .role-badge {
    display: none;
  }

  .hamburger {
    display: flex;
  }

  .btn-logout,
  .btn-login {
    padding: 5px 10px;
    font-size: 0.8rem;
  }
}
</style>
