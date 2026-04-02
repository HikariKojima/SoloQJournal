<script>
import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';

injectAnalytics({ mode: dev ? 'development' : 'production' });
  let { children } = $props();
  import "../app.css";
</script>

{@render children()}
