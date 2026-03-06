(function () {
  const byId = (id) => document.getElementById(id);

  function setupSidebar() {
    const sidebar = byId('app-sidebar');
    const backdrop = byId('sidebar-backdrop');
    const toggle = byId('sidebar-toggle');

    if (!sidebar || !backdrop || !toggle) return;

    const open = () => {
      sidebar.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
    };

    const close = () => {
      sidebar.classList.add('-translate-x-full');
      backdrop.classList.add('hidden');
    };

    toggle.addEventListener('click', open);
    backdrop.addEventListener('click', close);
  }

  function setupProfileMenu() {
    const toggle = byId('profile-toggle');
    const menu = byId('profile-menu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function () {
      menu.classList.toggle('invisible');
      menu.classList.toggle('opacity-0');
    });

    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.add('invisible', 'opacity-0');
      }
    });
  }

  function setupConfirmModal() {
    const modal = byId('app-modal');
    const message = byId('modal-message');
    const confirmBtn = byId('modal-confirm');
    const cancelBtn = byId('modal-cancel');
    let pendingForm = null;

    if (!modal || !message || !confirmBtn || !cancelBtn) return;

    const open = (form, msg) => {
      pendingForm = form;
      message.textContent = msg || 'Confirmer cette action ?';
      modal.classList.remove('hidden', 'pointer-events-none');
      modal.classList.add('flex');
    };

    const close = () => {
      pendingForm = null;
      modal.classList.add('hidden', 'pointer-events-none');
      modal.classList.remove('flex');
    };

    document.querySelectorAll('form[data-confirm]').forEach((form) => {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        open(form, form.getAttribute('data-confirm'));
      });
    });

    confirmBtn.addEventListener('click', function () {
      if (pendingForm) pendingForm.submit();
      close();
    });

    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  }

  function setupLoader() {
    const loader = byId('global-loader');
    if (!loader) return;

    document.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', function () {
        loader.classList.remove('hidden');
        loader.classList.add('flex');
      });
    });
  }

  function setupToasts() {
    const stack = byId('toast-stack');
    if (!stack) return;
    setTimeout(() => {
      stack.querySelectorAll('.toast').forEach((toast) => {
        toast.style.transition = 'all .2s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        setTimeout(() => toast.remove(), 220);
      });
    }, 3500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupSidebar();
    setupProfileMenu();
    setupConfirmModal();
    setupLoader();
    setupToasts();
  });
})();
