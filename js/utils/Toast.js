export class Toast {
    /** aktion: { label, onClick } – Knopf im Toast, z.B. „Rückgängig“ (schliesst den Toast) */
    static show(message, type = 'warning', duration = 3000, aktion = null) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'info' ? 'ℹ️' : '⚠️';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        const schliessen = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        };
        if (aktion) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-aktion';
            btn.textContent = aktion.label;
            btn.addEventListener('click', () => { schliessen(); aktion.onClick(); });
            toast.appendChild(btn);
        }

        container.appendChild(toast);

        // Animation auslösen
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Nach Ablauf der Dauer wieder ausblenden und entfernen
        setTimeout(schliessen, duration);
    }
}