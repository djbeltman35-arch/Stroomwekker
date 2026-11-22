document.getElementById('wis').onclick = async () => {
  const m = document.getElementById('wisMsg');
  let token = null; try { token = JSON.parse(localStorage.getItem('sw-token')); } catch {}
  if (!token) { m.textContent = 'Er zijn geen gegevens van dit apparaat bekend.'; return; }
  try {
    await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'delete' }) });
    ['sw-token','sw-alerts','sw-devices','sw-haspush','sw-alertstate'].forEach(k => localStorage.removeItem(k));
    const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager?.getSubscription(); await sub?.unsubscribe();
    m.textContent = '✓ Al je gegevens zijn gewist.';
  } catch { m.textContent = 'Wissen lukte niet. Probeer het later opnieuw.'; }
};
