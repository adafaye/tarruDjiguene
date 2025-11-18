class Calendar {
    constructor() {
        this.currentDate = new Date();
        this.cycles = [];
        this.activities = [];
        this.predictions = null;
        this.selectedDate = null;
    }

    async init() {
        await this.loadData();
        this.render();
        this.bindEvents();
    }

    async loadData() {
        try {
            const [cycleRes, activityRes] = await Promise.all([
                Auth.makeAuthenticatedRequest('/api/cycles'),
                Auth.makeAuthenticatedRequest('/api/sexual-activities')
            ]);

            if (cycleRes?.ok) {
                const data = await cycleRes.json();
                this.cycles = data.cycles || [];
                this.predictions = data.predictions;
            }

            if (activityRes?.ok) {
                const data = await activityRes.json();
                this.activities = data.activities || [];
            }
        } catch (error) {
            console.error('Erreur lors du chargement des données:', error);
        }
    }

    render() {
        this.updateHeader();
        this.renderGrid();
    }

    updateHeader() {
        const header = document.getElementById('calendar-month-year');
        if (header) {
            const options = { year: 'numeric', month: 'long' };
            header.textContent = this.currentDate.toLocaleDateString('fr-FR', options);
        }
    }

    renderGrid() {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        grid.innerHTML = '';

        const dayHeaders = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        dayHeaders.forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header';
            header.textContent = day;
            grid.appendChild(header);
        });

        const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
        const startDate = new Date(firstDay);
        const dayOfWeek = firstDay.getDay();
        const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - offset);

        for (let i = 0; i < 42; i++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            const dayElement = this.createDayElement(date);
            grid.appendChild(dayElement);
        }
    }

    createDayElement(date) {
        const day = document.createElement('div');
        day.className = 'calendar-day';
        day.dataset.date = this.formatDate(date);

        const badge = document.createElement('span');
        badge.className = 'date-badge';
        badge.textContent = date.getDate();
        day.appendChild(badge);

        const today = new Date();
        const isCurrentMonth = date.getMonth() === this.currentDate.getMonth();
        const isToday = this.isSameDay(date, today);
        const isSelected = this.selectedDate && this.isSameDay(date, this.selectedDate);

        if (!isCurrentMonth) day.classList.add('other-month');
        if (isToday) day.classList.add('today');
        if (isSelected) day.classList.add('selected');

        this.addCycleIndicators(day, date);

        day.addEventListener('click', () => this.onDayClick(date));
        return day;
    }

    addCycleIndicators(dayElement, date) {
        const dateStr = this.formatDate(date);
        let tooltip = [];

        const isInPeriod = this.cycles.some(cycle => {
            const start = new Date(cycle.startDate);
            const end = cycle.endDate ? new Date(cycle.endDate) : new Date(start.getTime() + 5 * 86400000);
            return date >= start && date <= end;
        });

        if (isInPeriod) {
            dayElement.classList.add('period');
            tooltip.push('Règles');
        }

        if (this.predictions) {
            if (this.predictions.ovulation === dateStr) {
                dayElement.classList.add('ovulation');
                tooltip.push('Ovulation');
            } else if (this.isInFertileWindow(date)) {
                dayElement.classList.add('fertile');
                tooltip.push('Fenêtre fertile');
            }
        }

        const hasActivity = this.activities.some(activity => activity.date === dateStr);
        if (hasActivity) {
            dayElement.classList.add('activity');
            tooltip.push('Activité sexuelle');
        }

        if (tooltip.length > 0) {
            dayElement.title = tooltip.join(', ');
        }
    }

    isInFertileWindow(date) {
        if (!this.predictions?.fertileWindow) return false;
        const start = new Date(this.predictions.fertileWindow.start);
        const end = new Date(this.predictions.fertileWindow.end);
        return date >= start && date <= end;
    }

    isSameDay(d1, d2) {
        return d1.getFullYear() === d2.getFullYear() &&
            d1.getMonth() === d2.getMonth() &&
            d1.getDate() === d2.getDate();
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    onDayClick(date) {
        this.selectedDate = date;
        this.render(); // re-render to apply selected style
        console.log('Date sélectionnée:', this.formatDate(date));
    }

    bindEvents() {
        const prevBtn = document.getElementById('prev-month');
        const nextBtn = document.getElementById('next-month');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.currentDate.setMonth(this.currentDate.getMonth() - 1);
                this.render();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.currentDate.setMonth(this.currentDate.getMonth() + 1);
                this.render();
            });
        }
    }

    async refresh() {
        await this.loadData();
        this.render();
    }
}

// ✅ Classe CycleManager intégrée
class CycleManager {
    static async addPeriod(startDate, endDate = null, flow = 'medium') {
        try {
            const response = await Auth.makeAuthenticatedRequest('/api/cycles', {
                method: 'POST',
                body: JSON.stringify({ startDate, endDate, flow })
            });

            if (response?.ok) {
                return await response.json();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Erreur lors de l\'ajout du cycle');
            }
        } catch (error) {
            console.error('Erreur:', error);
            throw error;
        }
    }

    static async addActivity(date, protection = false) {
        try {
            const response = await Auth.makeAuthenticatedRequest('/api/sexual-activities', {
                method: 'POST',
                body: JSON.stringify({ date, protection })
            });

            if (response?.ok) {
                return await response.json();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Erreur lors de l\'ajout de l\'activité');
            }
        } catch (error) {
            console.error('Erreur:', error);
            throw error;
        }
    }
}
