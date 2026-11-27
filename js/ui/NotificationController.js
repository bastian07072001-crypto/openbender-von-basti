import { globalEventBus } from '../utils/EventBus.js';

export class NotificationController {
    constructor(containerId = 'notification-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = containerId;
            Object.assign(this.container.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            });
            document.body.appendChild(this.container);
        }

        globalEventBus.on('notify', (data) => this.show(data.message, data.type));
    }

    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        
        const colors = {
            info: '#2980b9',
            warning: '#e67e22',
            error: '#e74c3c',
            success: '#27ae60'
        };

        Object.assign(toast.style, {
            backgroundColor: colors[type] || colors.info,
            color: '#fff',
            padding: '10px 16px',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            transition: 'opacity 0.3s ease',
            opacity: '1'
        });

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}