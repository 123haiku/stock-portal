<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';

const props = defineProps({ notify: { type: Function, required: true } });
const emit = defineEmits(['stock-changed']);

const items = ref([]);
const query = ref('');
const lowOnly = ref(false);
const loading = ref(false);
const sortKey = ref('sku');
const sortDir = ref('asc');

const sorted = computed(() => {
  const rows = [...items.value];
  rows.sort((a, b) => {
    const x = a[sortKey.value];
    const y = b[sortKey.value];
    if (typeof x === 'number' && typeof y === 'number') return sortDir.value === 'asc' ? x - y : y - x;
    const cmp = String(x ?? '').localeCompare(String(y ?? ''));
    return sortDir.value === 'asc' ? cmp : -cmp;
  });
  return rows;
});

const lowCount = computed(() => items.value.filter((p) => p.stock_qty <= p.reorder_level).length);

function sortBy(key) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/products', {
      params: { q: query.value.trim(), lowStock: lowOnly.value ? 1 : 0 },
    });
    items.value = data.items;
    emit('stock-changed', data.count);
  } catch (err) {
    props.notify(err.message, 'error');
  } finally {
    loading.value = false;
  }
}

function toggleLow() {
  lowOnly.value = !lowOnly.value;
  load();
}

function reset() {
  query.value = '';
  lowOnly.value = false;
  load();
}

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <div class="card flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        v-model="query"
        class="field sm:max-w-xs"
        placeholder="Search SKU or product name"
        @keyup.enter="load"
      />
      <button class="btn-primary" @click="load" :disabled="loading">
        {{ loading ? 'Searching...' : 'Search' }}
      </button>
      <button
        class="btn"
        :class="lowOnly ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
        @click="toggleLow"
      >
        Low stock only
      </button>
      <button class="btn-ghost" @click="reset">Reset</button>
      <span class="ml-auto text-sm text-slate-500">
        {{ items.length }} rows
        <span v-if="lowCount" class="ml-2 text-amber-600">{{ lowCount }} below reorder level</span>
      </span>
    </div>

    <div class="card overflow-x-auto p-0">
      <table class="hidden w-full min-w-[720px] text-left text-sm md:table">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="cursor-pointer px-4 py-3" @click="sortBy('sku')">SKU</th>
            <th class="cursor-pointer px-4 py-3" @click="sortBy('name')">Product</th>
            <th class="px-4 py-3">Category</th>
            <th class="cursor-pointer px-4 py-3 text-right" @click="sortBy('unit_price')">Unit price</th>
            <th class="cursor-pointer px-4 py-3 text-right" @click="sortBy('stock_qty')">Stock</th>
            <th class="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in sorted" :key="p.id" class="border-b border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ p.sku }}</td>
            <td class="px-4 py-3 font-medium text-slate-800">{{ p.name }}</td>
            <td class="px-4 py-3 text-slate-500">{{ p.category || '-' }}</td>
            <td class="px-4 py-3 text-right tabular-nums">RM {{ p.unit_price.toFixed(2) }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ p.stock_qty }}</td>
            <td class="px-4 py-3">
              <span
                v-if="p.stock_qty <= p.reorder_level"
                class="badge bg-red-50 text-red-600 ring-1 ring-red-200"
              >
                Reorder (min {{ p.reorder_level }})
              </span>
              <span v-else class="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">In stock</span>
            </td>
          </tr>
          <tr v-if="!sorted.length">
            <td colspan="6" class="px-4 py-10 text-center text-slate-400">
              {{ loading ? 'Loading...' : 'No products match this filter.' }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile: card list instead of a horizontally scrolling table -->
      <ul class="divide-y divide-slate-100 md:hidden">
        <li v-for="p in sorted" :key="p.id" class="p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-mono text-xs text-slate-500">{{ p.sku }}</p>
              <p class="truncate font-medium text-slate-800">{{ p.name }}</p>
              <p class="text-xs text-slate-500">{{ p.category || '-' }}</p>
            </div>
            <div class="text-right">
              <p class="tabular-nums font-semibold text-slate-800">RM {{ p.unit_price.toFixed(2) }}</p>
              <p class="text-xs tabular-nums text-slate-500">{{ p.stock_qty }} in stock</p>
            </div>
          </div>
          <span
            v-if="p.stock_qty <= p.reorder_level"
            class="badge mt-2 bg-red-50 text-red-600 ring-1 ring-red-200"
          >
            Reorder (min {{ p.reorder_level }})
          </span>
          <span v-else class="badge mt-2 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">In stock</span>
        </li>
        <li v-if="!sorted.length" class="p-10 text-center text-sm text-slate-400">
          {{ loading ? 'Loading...' : 'No products match this filter.' }}
        </li>
      </ul>
    </div>
  </section>
</template>
