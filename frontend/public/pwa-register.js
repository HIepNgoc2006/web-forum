let deferredPrompt = null;

function setupPwaInstall() {
  const installBtn = document.getElementById('pwaInstallBtn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) {
      installBtn.classList.remove('hidden');
    }
  });

  if (installBtn) {
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      installBtn.classList.add('hidden');
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        installBtn.classList.remove('hidden');
      }
    }

    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          installBtn.classList.add('hidden');
        }
        deferredPrompt = null;
      } else {
        alert(
          'Để cài đặt 36chan làm App trên thiết bị này:\n\n' +
          '• iOS / Safari: Bấm nút Chia sẻ (Share) ➔ Chọn "Thêm vào Màn hình chính" (Add to Home Screen).\n' +
          '• Android / Desktop: Mở Menu trình duyệt ➔ chọn "Cài đặt ứng dụng" hoặc "Thêm vào Màn hình chính".'
        );
      }
    });
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPwaInstall);
} else {
  setupPwaInstall();
}
