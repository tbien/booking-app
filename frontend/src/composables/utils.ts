import { ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * Debounced save helper — returns a function that will call `saveFn`
 * after `delay` ms of inactivity.
 */
export function useDebouncedSave(delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const saving = ref(false);

  function save(fn: () => Promise<void>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      saving.value = true;
      try {
        await fn();
      } finally {
        saving.value = false;
      }
    }, delay);
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
  });

  return { saving, save };
}

/**
 * Intersection Observer infinite scroll for a sentinel element.
 */
export function useInfiniteScroll(onIntersect: () => void) {
  const sentinel = ref<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    if (!sentinel.value || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onIntersect();
      },
      { rootMargin: '100px', threshold: 0.1 },
    );
    observer.observe(sentinel.value);
  });

  onBeforeUnmount(() => observer?.disconnect());

  return { sentinel };
}
