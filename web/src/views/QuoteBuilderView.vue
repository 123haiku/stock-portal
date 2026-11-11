<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';

const props = defineProps({ notify: { type: Function, required: true } });
const emit = defineEmits(['quote-created']);

const TAX_RATE = 0.06;

const catalog = ref([]);
const search = ref('');
const cart = ref([]);
const customerName = ref('');
const note = ref('');
const submitting = ref(false);
const lastQuote = ref(null);

const matches = computed(() => {
  const q = search.value.trim().toLowerCase();
  const pool = catalog.value.filter((p) => !cart.value.some((l) => l.productId === p.id));
  if (!q) return pool.slice(0, 8);
  return pool
    .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    .slice(0, 8);
});

const subtotal = computed(() =>
  cart.value.reduce((sum, l) => sum + l.unit_price * l.qty, 0),
);
const tax = computed(() => subtotal.value * TAX_RATE);
const total = computed(() => subtotal.value + tax.value);

function money(value) {
  return value.toFixed(2);
}

async function loadCatalog() {
  try {
    const { data } = await api.get('/products', { params: { limit: 200 } });
    catalog.value = data.items;
  } catch (err) {
    props.notify(err.message, 'error');
  }
}

function add(product) {
  cart.value.push({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unit_price: product.unit_price,
    stock_qty: product.stock_qty,
    qty: 1,
  });
  search.value = '';
}

function remove(index) {
  cart.value.splice(index, 1);
}

function clampQty(line) {
  // Keep the quantity inside what the server will accept so the API error is a
  // real edge case, not a typo in the UI.
  const max = line.stock_qty || 1;
  if (!Number.isFinite(line.qty) || line.qty < 1) line.qty = 1;
  if (line.qty > max) line.qty = max;
}

async function submit() {
  if (!customerName.value.trim()) {
    props.notify('Customer name is required before generating a quote.', 'error');
    return;
  }
  if (!cart.value.length) {
    props.notify('Add at least one product to the quotation.', 'error');
    return;
  }

  submitting.value = true;
  try {
    const { data } = await api.post('/quotes', {
      customerName: customerName.value.trim(),
      note: note.value.trim() || undefined,
      items: cart.value.map((l) => ({ productId: l.productId, qty: l.qty })),
    });
    lastQuote.value = data;
    cart.value = [];
    customerName.value = '';
    note.value = '';
    props.notify(`Quote ${data.quoteNo} created - total RM ${money(data.total)}`, 'ok');
    emit('quote-created', data);
    await loadCatalog();
  } catch (err) {
    // A stock conflict is the interesting failure path: the transaction rolled back
    // and nothing was deducted, so the user can adjust and retry.
    props.notify(err.message, 'error');
    await loadCatalog();
  } finally {
    submitting.value = false;
  }
}

async function printQuote() {
  window.print();
}

onMounted(loadCatalog);
</script>

<template>
  <section class="grid gap-4 lg:grid-cols-3">
    <div class="space-y-4 lg:col-span-2">
      <div class="card">
        <h2 class="text-base font-semibold text-slate-800">Add products</h2>
        <p class="mt-1 text-sm text-slate-500">Type a SKU or name. Only in-stock products are listed.</p>
        <input v-model="search" class="field mt-3" placeholder="e.g. drill, PT-0101" />

        <ul class="mt-3 divide-y divide-slate-100">
          <li
            v-for="p in matches"
            :key="p.id"
            class="flex items-center gap-3 py-2 text-sm"
          >
            <span class="font-mono text-xs text-slate-500">{{ p.sku }}</span>
            <span class="font-medium text-slate-800">{{ p.name }}</span>
            <span class="ml-auto tabular-nums text-slate-600">RM {{ money(p.unit_price) }}</span>
            <span
              class="w-16 text-right tabular-nums"
              :class="p.stock_qty <= p.reorder_level ? 'text-red-600' : 'text-slate-400'"
            >
              {{ p.stock_qty }} left
            </span>
            <button class="btn-primary px-3 py-1" :disabled="p.stock_qty < 1" @click="add(p)">Add</button>
          </li>
          <li v-if="!matches.length" class="py-6 text-center text-sm text-slate-400">
            No matching product available.
          </li>
        </ul>
      </div>

      <div class="card overflow-x-auto">
        <h2 class="text-base font-semibold text-slate-800">Quote lines</h2>
        <table v-if="cart.length" class="mt-3 w-full min-w-[520px] text-sm">
          <thead class="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th class="py-2 text-left">SKU</th>
              <th class="py-2 text-left">Product</th>
              <th class="py-2 text-right">Qty</th>
              <th class="py-2 text-right">Unit</th>
              <th class="py-2 text-right">Line total</th>
              <th class="py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in cart" :key="line.productId" class="border-b border-slate-100">
              <td class="py-2 font-mono text-xs text-slate-500">{{ line.sku }}</td>
              <td class="py-2 text-slate-800">{{ line.name }}</td>
              <td class="py-2 text-right">
                <input
                  v-model.number="line.qty"
                  type="number"
                  min="1"
                  :max="line.stock_qty"
                  class="w-16 rounded border border-slate-300 px-2 py-1 text-right"
                  @change="clampQty(line)"
                />
              </td>
              <td class="py-2 text-right tabular-nums">RM {{ money(line.unit_price) }}</td>
              <td class="py-2 text-right tabular-nums">RM {{ money(line.unit_price * line.qty) }}</td>
              <td class="py-2 text-right">
                <button class="text-xs text-red-600 hover:underline" @click="remove(index)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="mt-4 text-sm text-slate-400">No lines yet. Search above and press Add.</p>
      </div>
    </div>

    <aside class="space-y-4">
      <div class="card space-y-3">
        <h2 class="text-base font-semibold text-slate-800">Quotation summary</h2>

        <label class="block">
          <span class="text-sm font-medium text-slate-700">Customer</span>
          <input v-model="customerName" class="field mt-1" placeholder="e.g. Acme Hardware Sdn Bhd" />
        </label>

        <label class="block">
          <span class="text-sm font-medium text-slate-700">Note (optional)</span>
          <textarea v-model="note" rows="2" class="field mt-1" placeholder="Delivery terms, validity..."></textarea>
        </label>

        <dl class="space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div class="flex justify-between">
            <dt class="text-slate-500">Subtotal</dt>
            <dd class="tabular-nums">RM {{ money(subtotal) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-slate-500">SST (6%)</dt>
            <dd class="tabular-nums">RM {{ money(tax) }}</dd>
          </div>
          <div class="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd class="tabular-nums">RM {{ money(total) }}</dd>
          </div>
        </dl>

        <button class="btn-primary w-full" :disabled="submitting || !cart.length" @click="submit">
          {{ submitting ? 'Generating...' : 'Generate quotation' }}
        </button>
      </div>

      <div v-if="lastQuote" class="card">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-slate-800">{{ lastQuote.quoteNo }}</h2>
          <button class="btn-ghost px-3 py-1 text-xs" @click="printQuote">Print</button>
        </div>
        <p class="mt-1 text-sm text-slate-500">{{ lastQuote.customerName }}</p>
        <ul class="mt-3 space-y-1 text-sm">
          <li v-for="line in lastQuote.lines" :key="line.productId" class="flex justify-between">
            <span>{{ line.sku }} x {{ line.qty }}</span>
            <span class="tabular-nums">RM {{ money(line.lineTotal) }}</span>
          </li>
        </ul>
        <p class="mt-3 flex justify-between border-t border-slate-200 pt-2 font-semibold">
          <span>Total</span>
          <span class="tabular-nums">RM {{ money(lastQuote.total) }}</span>
        </p>
      </div>
    </aside>
  </section>
</template>
