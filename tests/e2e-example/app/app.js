// Waits until sw.js controls the page, so without serviceWorkers: 'block' the worker answers /api/items
const controlledBySw = async () => {
    const registration = await navigator.serviceWorker?.register('/sw.js').catch(() => null);
    if (!registration) return;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
};

const render = (items) => {
    const list = document.querySelector('[data-testid="item-list"]');
    for (const item of items) {
        const li = document.createElement('li');
        li.dataset.testid = 'item';
        li.textContent = item.display_name;
        list.append(li);
    }
    document.querySelector('[data-testid="empty"]').hidden = items.length > 0;
};

await controlledBySw();
const response = await fetch('/api/items');
const { items = [] } = await response.json();
render(items);
