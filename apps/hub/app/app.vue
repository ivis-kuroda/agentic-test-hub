<template>
  <UApp>
    <div class="min-h-screen">
      <header class="border-b border-default px-6 py-3 flex items-center gap-6">
        <NuxtLink to="/" class="font-semibold">agentic-test-hub</NuxtLink>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/viewpoints" class="text-muted hover:text-default">Viewpoints</NuxtLink>
          <NuxtLink to="/cases" class="text-muted hover:text-default">Cases</NuxtLink>
          <NuxtLink to="/matrices" class="text-muted hover:text-default">Matrices</NuxtLink>
        </nav>
      </header>
      <main class="p-6">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>
