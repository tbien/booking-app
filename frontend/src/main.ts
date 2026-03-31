import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Fetch user role before first render
const auth = useAuthStore();
auth.fetchRole().then(() => {
  app.mount('#app');
});
