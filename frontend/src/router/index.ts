import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'bookings',
      component: () => import('../views/BookingsView.vue'),
    },
    {
      path: '/config',
      name: 'config',
      component: () => import('../views/ConfigView.vue'),
      meta: { admin: true },
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('../views/CalendarView.vue'),
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.fetchRole();

  if (to.meta.public) return true;
  if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.meta.admin && !auth.isAdmin) return { name: 'bookings' };
  return true;
});

export default router;
