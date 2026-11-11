<script setup>
import { ref } from 'vue';
import { api, session } from '../api.js';

const emit = defineEmits(['logged-in', 'error']);

const email = ref('admin@portal.local');
const password = ref('demo1234');
const busy = ref(false);

async function submit() {
  busy.value = true;
  try {
    const { data } = await api.post('/auth/login', {
      email: email.value.trim(),
      password: password.value,
    });
    session.save(data.token, data.user);
    emit('logged-in', data);
  } catch (err) {
    emit('error', err.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-10 max-w-sm">
    <form class="card space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-lg font-semibold text-slate-800">Sign in</h1>
        <p class="mt-1 text-sm text-slate-500">Demo credentials are pre-filled.</p>
      </div>

      <label class="block">
        <span class="text-sm font-medium text-slate-700">Email</span>
        <input v-model="email" type="email" class="field mt-1" autocomplete="username" required />
      </label>

      <label class="block">
        <span class="text-sm font-medium text-slate-700">Password</span>
        <input v-model="password" type="password" class="field mt-1" autocomplete="current-password" required />
      </label>

      <button type="submit" class="btn-primary w-full" :disabled="busy">
        {{ busy ? 'Signing in...' : 'Sign in' }}
      </button>

      <p class="text-xs text-slate-400">
        admin@portal.local / sales@portal.local - password: demo1234
      </p>
    </form>
  </div>
</template>
