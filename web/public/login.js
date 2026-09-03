const params = new URLSearchParams(location.search);
const errorEl = document.getElementById('error');
if (params.get('error') === 'expired') {
  errorEl.textContent = 'Ссылка истекла. Запросите новую в Telegram → Веб-кабинет.';
  errorEl.classList.remove('hidden');
}

fetch('/api/config')
  .then((res) => res.json())
  .then((cfg) => {
    if (!cfg.botUsername) return;
    window.onTelegramAuth = async function onTelegramAuth(user) {
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(user),
      });
      if (!res.ok) {
        errorEl.textContent = 'Вход через Telegram не принят';
        errorEl.classList.remove('hidden');
        return;
      }
      location.href = '/';
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset.telegramLogin = cfg.botUsername;
    script.dataset.size = 'large';
    script.dataset.onauth = 'onTelegramAuth(user)';
    script.dataset.requestAccess = 'write';
    document.getElementById('tg-login').append(script);
  })
  .catch(() => undefined);
