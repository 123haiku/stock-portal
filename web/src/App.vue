<script setup>
import { ref, onMounted } from 'vue';
import { api, session } from './api.js';
import LoginView from './views/LoginView.vue';
import ProductsView from './views/ProductsView.vue';
import QuoteBuilderView from './views/QuoteBuilderView.vue';

const user = ref(session.user);
const tab = ref('products');
const toast = ref(null);
const lowStockCount = ref(0);

function notify(text, tone = 'info') {
  toast.value = { text, tone };
  window.clearTimeout(notify._timer);
  notify._timer = window.setTimeout(() => (toast.value = null), 4500);
}

function onLoggedIn(payload) {
  user.value = payload.user;
  notify(`Signed in as ${payload.user.email}`, 'ok');
  refreshLowStock();
}

function logout() {
  session.clear();
  user.value = null;
  notify('Signed out', 'info');
}

async function refreshLowStock() {
  if (!session.token) return;
  try {
    const { data } = await api.get('/products/low-stock');
    lowStockCount.value = data.count;
  } catch {
    lowStockCount.value = 0;
  }
}

onMounted(refreshLowStock);
</script>

<template>
  <div class="min-h-screen bg-slate-100">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div class="flex items-center gap-2">
          <img src="/icon.svg" alt="" class="h-8 w-8" />
          <span class="font-semibold text-slate-800">Stock &amp; Quotation Portal</span>
        </div>

        <nav v-if="user" class="ml-auto flex items-center gap-1">
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium"
            :class="tab === 'products' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            @click="tab = 'products'"
          >
            Products
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium"
            :class="tab === 'quote' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            @click="tab = 'quote'"
          >
            Quotation
            <span v-if="lowStockCount" class="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">
              {{ lowStockCount }}
            </span>
          </button>
        </nav>

        <div v-if="user" class="flex items-center gap-2 text-sm text-slate-500">
          <span class="hidden sm:inline">{{ user.email }}</span>
          <span class="badge bg-slate-100 text-slate-600">{{ user.role }}</span>
          <button class="btn-ghost" @click="logout">Sign out</button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 py-6">
      <div
        v-if="toast"
        class="mb-4 rounded-lg px-4 py-2 text-sm"
        :class="toast.tone === 'ok' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
               : toast.tone === 'error' ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
               : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'"
      >
        {{ toast.text }}
      </div>

      <LoginView v-if="!user" @logged-in="onLoggedIn" @error="notify($event, 'error')" />

      <template v-else>
        <ProductsView
          v-if="tab === 'products'"
          :notify="notify"
          @stock-changed="refreshLowStock"
        />
        <QuoteBuilderView v-else :notify="notify" @quote-created="refreshLowStock" />
      </template>
    </main>

    <footer class="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-400">
      Demo build - SQLite via node:sqlite, JWT auth, transactional stock deduction.
    </footer>
  </div>
</template>
