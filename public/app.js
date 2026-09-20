document.getElementById('date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});

const today = new Date().toISOString().split('T')[0];
if (document.getElementById('paycheck-date')) document.getElementById('paycheck-date').value = today;
if (document.getElementById('expense-date')) document.getElementById('expense-date').value = today;

function getMondayOfThisWeek() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
    const diff = day === 0 ? -6 : 1 - day; // shift back to this week's Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    return monday.toISOString().split('T')[0];
}
if (document.getElementById('review-week-start')) document.getElementById('review-week-start').value = getMondayOfThisWeek();

let calendarViewDate = new Date();
let calendarSelectedDate = today;
let calendarMonthTasks = [];

// ── ANIMATED NUMBERS ─────────────────────────────────────
// Counts a dollar figure up (or down) from whatever it last showed to its
// new value, instead of just replacing the text instantly. Cheap visual
// trick, but it's one of the fastest ways to make a dashboard feel alive.

let lastShownBalance = 0;
let lastShownUnassigned = 0;

function animateDollarValue(el, from, to, duration = 700) {
    if (!el) return;
    if (typeof from !== 'number' || !isFinite(from)) from = 0;
    if (typeof to !== 'number' || !isFinite(to)) to = 0;

    const start = performance.now();
    const change = to - from;

    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const current = from + change * eased;
        el.textContent = `$${formatCurrency(current)}`;
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ── BALANCE SPARKLINE ────────────────────────────────────
// Draws a small line chart of the last 14 days of total balance directly
// as an inline SVG — no charting library needed for something this simple.
// Hidden entirely until there are at least 2 days of history to connect.

function renderBalanceSparkline(history) {
    const wrap = document.getElementById('balance-sparkline-wrap');
    const svg = document.getElementById('balance-sparkline');
    if (!wrap || !svg) return;

    if (!history || history.length < 2) {
        wrap.style.display = 'none';
        return;
    }

    const values = history.map(h => h.balance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;
    const width = 300;
    const height = 40;
    const padding = 3;

    const points = values.map((v, i) => {
        const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
        const y = height - padding - ((v - min) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a9eff';
    const areaPoints = `0,${height} ${points.join(' ')} ${width},${height}`;

    svg.innerHTML = `
        <polyline points="${areaPoints}" fill="${accentColor}" opacity="0.12" stroke="none"></polyline>
        <polyline points="${points.join(' ')}" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
    `;
    wrap.style.display = 'block';
}

// ── CURRENCY FORMATTING ──────────────────────────────────
// Adds thousands separators (12,345.67 instead of 12345.67) so dollar
// figures read the way every finance app formats them. Callers still write
// the literal "$" themselves — this only formats the number part.

function formatCurrency(amount) {
    const n = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (typeof n !== 'number' || !isFinite(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── APP TOASTS, CONFIRM & PROMPT MODALS ──────────────────
// Replaces the browser's native alert()/confirm()/prompt() popups — which
// are unstyled and look the same on every website — with small notifications
// and dialogs that match the app's own theme.

function showToast(message, type = 'error', duration = 4200) {
    const container = document.getElementById('app-toast-container') || (() => {
        const el = document.createElement('div');
        el.id = 'app-toast-container';
        document.body.appendChild(el);
        return el;
    })();

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('app-toast-out'), duration - 250);
    setTimeout(() => toast.remove(), duration);
}

function confirmAction(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-modal-overlay';
        overlay.innerHTML = `
            <div class="confirm-modal-card">
                <div class="confirm-modal-message"></div>
                <div class="confirm-modal-actions">
                    <button class="btn-small confirm-modal-cancel">Cancel</button>
                    <button class="btn-danger confirm-modal-confirm">Confirm</button>
                </div>
            </div>
        `;
        overlay.querySelector('.confirm-modal-message').textContent = message;
        document.body.appendChild(overlay);

        const cleanup = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('.confirm-modal-cancel').onclick = () => cleanup(false);
        overlay.querySelector('.confirm-modal-confirm').onclick = () => cleanup(true);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(false); }
        });
    });
}

function promptModal(message, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-modal-overlay';
        overlay.innerHTML = `
            <div class="confirm-modal-card">
                <div class="confirm-modal-message"></div>
                <input type="text" class="input-field prompt-modal-input" style="margin: 12px 0 0;">
                <div class="confirm-modal-actions">
                    <button class="btn-small confirm-modal-cancel">Cancel</button>
                    <button class="btn confirm-modal-confirm" style="width:auto; margin:0; padding:9px 18px;">Save</button>
                </div>
            </div>
        `;
        overlay.querySelector('.confirm-modal-message').textContent = message;
        const input = overlay.querySelector('.prompt-modal-input');
        input.value = defaultValue === null || defaultValue === undefined ? '' : String(defaultValue);
        document.body.appendChild(overlay);
        input.focus();
        input.select();

        const cleanup = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('.confirm-modal-cancel').onclick = () => cleanup(null);
        overlay.querySelector('.confirm-modal-confirm').onclick = () => cleanup(input.value);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    });
}

// ── SPENDING PACE RING ────────────────────────────────────
// A small circular progress ring (like a watch activity ring) instead of a
// flat text pill — shows at a glance how far through the month's budget
// you are, color-coded the same green/yellow/red as before.

function renderPaceRing(pace) {
    const wrap = document.getElementById('pace-badge-wrap');
    if (!wrap) return;

    if (!pace) {
        wrap.style.display = 'none';
        return;
    }

    const pct = Math.min(100, Math.max(0, pace.percentSpent || 0));
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct / 100);
    const colorVar = pace.status === 'red' ? '--danger' : pace.status === 'yellow' ? '--warning' : '--success';
    const color = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
    const labels = { green: 'On pace', yellow: 'Ahead', red: 'Over' };

    wrap.innerHTML = `
        <span class="brief-stat-label">Spending Pace</span>
        <div class="pace-ring-wrap" title="$${formatCurrency(pace.spent)} spent of $${formatCurrency(pace.limit)} — day ${pace.dayOfMonth} of ${pace.daysInMonth}">
            <svg width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="${radius}" fill="none" stroke="var(--border)" stroke-width="4"></circle>
                <circle cx="20" cy="20" r="${radius}" fill="none" stroke="${color}" stroke-width="4"
                    stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
                    stroke-linecap="round" transform="rotate(-90 20 20)"></circle>
            </svg>
            <span class="pace-ring-label" style="color:${color};">${labels[pace.status] || pace.status}</span>
        </div>
    `;
    wrap.style.display = 'flex';
}

// ── GETTING STARTED CHECKLIST ────────────────────────────
// Stays visible on the dashboard (unlike the one-time onboarding slides)
// until a new account has added at least one account, bill, and goal —
// so someone who stops halfway through setup still sees what's left.

function renderGettingStarted(data) {
    const card = document.getElementById('getting-started-card');
    const list = document.getElementById('getting-started-list');
    if (!card || !list) return;

    const steps = [
        { done: !!data.hasAccounts, label: 'Add an account (checking, savings, etc.)' },
        { done: !!data.hasBills, label: 'Add a recurring bill' },
        { done: !!data.hasGoals, label: 'Set a goal or daily task' }
    ];
    const doneCount = steps.filter(s => s.done).length;

    if (doneCount === steps.length) {
        card.style.display = 'none';
        return;
    }

    list.innerHTML = `
        <div class="getting-started-progress">${doneCount} of ${steps.length} done</div>
        ${steps.map(s => `
            <div class="getting-started-row ${s.done ? 'done' : ''}">
                <span class="getting-started-check">${s.done ? '✅' : '⬜'}</span>
                <span>${s.label}</span>
            </div>
        `).join('')}
    `;
    card.style.display = 'block';
}

// ── SETTINGS DROPDOWN (gear menu) ───────────────────────

function toggleSettingsMenu() {
    const dropdown = document.getElementById('settings-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('open');
}

// Closes the settings dropdown when you click anywhere outside of it.
document.addEventListener('click', function (event) {
    const wrap = document.getElementById('settings-menu-wrap');
    const dropdown = document.getElementById('settings-dropdown');
    if (!wrap || !dropdown) return;
    if (!wrap.contains(event.target)) {
        dropdown.classList.remove('open');
    }
});

// ── LIGHT / DARK THEME ─────────────────────────────────

function updateThemeToggleIcon() {
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (!icon || !label) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    icon.textContent = isLight ? '🌙' : '☀️';
    label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
}

function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('mcc-theme', 'dark'); } catch (error) {}
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        try { localStorage.setItem('mcc-theme', 'light'); } catch (error) {}
    }
    updateThemeToggleIcon();
}

updateThemeToggleIcon();

// ── PUSH NOTIFICATIONS ─────────────────────────────────

// Push subscription keys arrive base64url-encoded; the browser's subscribe()
// call needs them as raw bytes, so this converts between the two.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function updateNotifyBtnState() {
    const item = document.getElementById('notify-toggle-item');
    const icon = document.getElementById('notify-toggle-icon');
    const label = document.getElementById('notify-toggle-label');
    const testItem = document.getElementById('notify-test-item');
    if (!item || !icon || !label) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        item.style.display = 'none';
        if (testItem) testItem.style.display = 'none';
        return;
    }
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        icon.textContent = sub ? '🔔' : '🔕';
        label.textContent = sub ? 'Notifications On' : 'Notifications Off';
        // The "Send Test Notification" option only makes sense once
        // notifications are actually turned on for this device.
        if (testItem) testItem.style.display = sub ? 'flex' : 'none';
    } catch (error) {
        icon.textContent = '🔕';
        label.textContent = 'Notifications Off';
        if (testItem) testItem.style.display = 'none';
    }
}

async function promptMonthlyBudget() {
    const current = await fetch('/api/auth/me').then(r => r.json()).catch(() => null);
    const existing = current && current.user && current.user.monthlyBudgetLimit;
    const input = await promptModal(
        'Set a monthly spending limit to see a pace badge on your dashboard (how your spending compares to how far into the month you are). Leave blank to turn it off.',
        existing ? String(existing) : ''
    );
    if (input === null) return; // cancelled

    const trimmed = input.trim();
    const value = trimmed === '' ? null : parseFloat(trimmed);
    if (trimmed !== '' && (!Number.isFinite(value) || value < 0)) {
        showToast('Please enter a positive number, or leave it blank to turn the pace badge off.');
        return;
    }

    try {
        const res = await fetch('/api/settings/budget-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monthlyBudgetLimit: value })
        });
        if (!res.ok) {
            showToast('Could not save your monthly budget.');
            return;
        }
        loadDashboard();
    } catch (error) {
        showToast('Could not reach the server to save your monthly budget.');
    }
}

async function sendTestNotification() {
    try {
        const res = await fetch('/api/push/test', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Could not send a test notification.');
            return;
        }
        showToast('Test notification sent! It should arrive within a few seconds — check your notification shade if this tab isn\'t in the foreground.', 'success');
    } catch (error) {
        showToast('Could not reach the server to send a test notification.');
    }
}

async function toggleNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast('Push notifications are not supported in this browser.');
        return;
    }
    try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const existing = await reg.pushManager.getSubscription();

        if (existing) {
            await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: existing.endpoint })
            });
            await existing.unsubscribe();
            updateNotifyBtnState();
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast("Notifications were blocked. You can turn them back on in your browser's site settings.");
            return;
        }

        const keyData = await fetch('/api/push/vapid-public-key').then(r => r.json());
        if (!keyData.publicKey) {
            showToast('Notifications are not set up on the server yet.');
            return;
        }

        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
        });

        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });

        updateNotifyBtnState();
    } catch (error) {
        console.error('Notification setup error:', error);
        showToast('Something went wrong turning on notifications.');
    }
}

updateNotifyBtnState();

// ── AUTH GUARD ─────────────────────────────────────────

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/login.html';
            return;
        }
        const data = await res.json();
        const nameEl = document.getElementById('header-user-name');
        if (nameEl) nameEl.textContent = data.user.name || data.user.email;

        const greetEl = document.getElementById('brief-greeting');
        if (greetEl) {
            const hour = new Date().getHours();
            const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
            const firstName = (data.user.name || data.user.email.split('@')[0]).split(' ')[0];
            greetEl.textContent = `${timeGreeting}, ${firstName}`;
        }

        // Only load dashboard data once we know the user is logged in
        loadDashboard();
        loadMorningBrief();

        if (data.user && !data.user.onboarded) {
            startOnboarding();
        }
    } catch (error) {
        window.location.href = '/login.html';
    }
}

// ── FIRST-TIME ONBOARDING ────────────────────────────────

const onboardingSlides = [
    {
        icon: '👋',
        title: 'Welcome to Morning Command Center',
        body: 'This is your personal home base — your money, bills, goals, and daily plan, all in one place. Here\'s a quick tour of the essentials.'
    },
    {
        icon: '☀️',
        title: 'Your Morning Brief',
        body: 'Every day, the dashboard gives you an honest snapshot of your finances, your top priorities, and anything urgent — generated fresh each time you ask.'
    },
    {
        icon: '💰',
        title: 'Money, Bills & Goals',
        body: 'Track every account and card in Money, never miss a due date in Bills, and set goals with real dollar targets you can assign leftover balance toward.'
    },
    {
        icon: '📅',
        title: 'Your Planner & Calendar',
        body: 'Daily tasks, weekly reviews, and monthly reflections live in the Calendar and Planner tabs — built for the same kind of planning you\'d do on paper.'
    },
    {
        icon: '🚀',
        title: 'You\'re all set',
        body: 'Explore at your own pace — everything here adjusts to what you add. Let\'s get started.'
    }
];
let onboardingIndex = 0;

function startOnboarding() {
    onboardingIndex = 0;
    renderOnboardingSlide();
    document.getElementById('onboarding-overlay').style.display = 'flex';
}

function renderOnboardingSlide() {
    const slide = onboardingSlides[onboardingIndex];
    const slideEl = document.getElementById('onboarding-slide');
    slideEl.innerHTML = `
        <div class="onboarding-slide-icon">${slide.icon}</div>
        <div class="onboarding-slide-title">${slide.title}</div>
        <div class="onboarding-slide-body">${slide.body}</div>
    `;

    const dotsEl = document.getElementById('onboarding-dots');
    dotsEl.innerHTML = onboardingSlides.map((_, i) =>
        `<div class="onboarding-dot ${i === onboardingIndex ? 'active' : ''}"></div>`
    ).join('');

    const nextBtn = document.getElementById('onboarding-next-btn');
    nextBtn.textContent = onboardingIndex === onboardingSlides.length - 1 ? 'Get Started' : 'Next';
}

function onboardingNext() {
    if (onboardingIndex >= onboardingSlides.length - 1) {
        finishOnboarding();
        return;
    }
    onboardingIndex++;
    renderOnboardingSlide();
}

async function finishOnboarding() {
    document.getElementById('onboarding-overlay').style.display = 'none';
    try {
        await fetch('/api/onboarding/complete', { method: 'POST' });
    } catch (error) {
        // non-critical — worst case they see the walkthrough again next login
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        // even if this fails, still send them to the login screen
    }
    window.location.href = '/login.html';
}

// ── PAGE NAVIGATION (Home / Planner / Money) ───────────

function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageName).classList.add('active');

    // The Planner and Money section bars (back button + sub-tabs) only show
    // when you're actually inside that section.
    document.getElementById('section-bar-planner').classList.toggle('visible', pageName === 'planner');
    document.getElementById('section-bar-money').classList.toggle('visible', pageName === 'money');

    if (pageName === 'home') {
        loadDashboard();
    } else {
        // Load data for whichever sub-tab is currently showing inside this page
        const activeTab = document.querySelector('#page-' + pageName + ' .tab.active');
        if (activeTab) loadTabData(activeTab.id.replace('tab-', ''));
    }

    window.scrollTo(0, 0);
}

// ── SUB-TAB NAVIGATION (inside Planner / Money) ────────

function loadTabData(tabName) {
    if (tabName === 'calendar') loadCalendar();
    if (tabName === 'goals') loadGoals();
    if (tabName === 'rituals') loadRituals();
    if (tabName === 'review') loadWeeklyReviews();
    if (tabName === 'monthly') loadMonthlyTab();
    if (tabName === 'bills') loadBills();
    if (tabName === 'accounts') loadAccounts();
    if (tabName === 'cards') loadCards();
    if (tabName === 'expenses') loadExpenses();
}

function showTab(tabName, btn) {
    const tabEl = document.getElementById('tab-' + tabName);
    const parentPage = tabEl.closest('.page');
    parentPage.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');

    const subnav = btn.closest('.section-subnav');
    if (subnav) {
        subnav.querySelectorAll('.subnav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    loadTabData(tabName);
}

// ── CALENDAR ────────────────────────────────────────────

async function loadCalendar() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth(); // 0-indexed
    const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
    document.getElementById('calendar-month-title').textContent =
        calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    try {
        calendarMonthTasks = await fetch(`/api/tasks/month/${yearMonth}`).then(r => r.json());
    } catch (error) {
        calendarMonthTasks = [];
    }

    renderCalendarGrid(year, month);
    renderCalendarDayTasks();
}

function renderCalendarGrid(year, month) {
    const grid = document.getElementById('calendar-grid');
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = dayLabels.map(d => `<div class="calendar-daylabel">${d}</div>`).join('');

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === today;
        const isSelected = dateStr === calendarSelectedDate;
        const hasTasks = calendarMonthTasks.some(t => t.date === dateStr);
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" onclick="selectCalendarDay('${dateStr}')">
                ${day}
                ${hasTasks ? '<div class="calendar-day-dot"></div>' : ''}
            </div>
        `;
    }

    grid.innerHTML = html;
}

function changeCalendarMonth(delta) {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
    loadCalendar();
}

function selectCalendarDay(dateStr) {
    calendarSelectedDate = dateStr;
    renderCalendarGrid(calendarViewDate.getFullYear(), calendarViewDate.getMonth());
    renderCalendarDayTasks();
}

function formatTime12h(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function renderCalendarDayTasks() {
    const label = new Date(calendarSelectedDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
    });
    document.getElementById('calendar-selected-date').textContent = label;

    const dayTasks = calendarMonthTasks
        .filter(t => t.date === calendarSelectedDate)
        .sort((a, b) => {
            if (!a.time && !b.time) return 0;
            if (!a.time) return 1;
            if (!b.time) return -1;
            return a.time.localeCompare(b.time);
        });

    const list = document.getElementById('calendar-tasks-list');
    if (dayTasks.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🗓️</span><div class="empty-state-title">Nothing planned</div>Add a task for this day above</div>`;
        return;
    }
    list.innerHTML = dayTasks.map(t => `
        <div class="action-step ${t.completed ? 'done' : ''}" style="padding:8px 0;">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleCalendarTask('${t.id}')">
            <span>${t.time ? `<strong>${formatTime12h(t.time)}</strong> — ` : ''}${t.task_text}</span>
            <button class="step-remove" onclick="removeCalendarTask('${t.id}')" title="Remove">×</button>
        </div>
    `).join('');
}

function toggleRepeatOptions() {
    const show = document.getElementById('calendar-repeat-check').checked;
    document.getElementById('calendar-repeat-options').style.display = show ? 'block' : 'none';
}

async function addCalendarTask() {
    const textInput = document.getElementById('calendar-task-text');
    const taskText = textInput.value;
    const time = document.getElementById('calendar-task-time').value; // "" if not set
    if (!taskText.trim()) { showToast('Please enter a task.'); return; }

    const isRepeating = document.getElementById('calendar-repeat-check').checked;

    if (isRepeating) {
        const weekdayBoxes = document.querySelectorAll('.calendar-weekday-picker input[type="checkbox"]:checked');
        const weekdays = Array.from(weekdayBoxes).map(cb => parseInt(cb.value, 10));
        const until = document.getElementById('calendar-repeat-until').value;
        if (weekdays.length === 0) { showToast('Pick at least one day of the week to repeat on.'); return; }
        if (!until) { showToast('Pick a date to repeat until.'); return; }
        try {
            const res = await fetch('/api/tasks/recurring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskText, time: time || null, startDate: calendarSelectedDate, endDate: until, weekdays })
            });
            const data = await res.json();
            if (!res.ok) { showToast(data.error || "Couldn't add recurring task — give it another try."); return; }
        } catch (error) {
            showToast("Couldn't add recurring task — give it another try.");
            return;
        }
    } else {
        try {
            await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: calendarSelectedDate, taskText, time: time || null, source: 'manual' })
            });
        } catch (error) {
            showToast("Couldn't add task — give it another try.");
            return;
        }
    }

    textInput.value = '';
    document.getElementById('calendar-task-time').value = '';
    document.getElementById('calendar-repeat-check').checked = false;
    document.getElementById('calendar-repeat-options').style.display = 'none';
    document.querySelectorAll('.calendar-weekday-picker input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('calendar-repeat-until').value = '';
    loadCalendar();
}

async function toggleCalendarTask(id) {
    try {
        await fetch(`/api/tasks/${id}/toggle`, { method: 'POST' });
        loadCalendar();
    } catch (error) {
        showToast("Couldn't update task — give it another try.");
    }
}

async function removeCalendarTask(id) {
    try {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        loadCalendar();
    } catch (error) {
        showToast("Couldn't remove task — give it another try.");
    }
}

// ── DASHBOARD ──────────────────────────────────────────

async function loadDashboard() {
    try {
        const data = await fetch('/api/dashboard').then(r => r.json());

        // Total balance — shown as a quick stat next to the brief.
        // Full account-by-account detail lives in Money > Accounts.
        const statsEl = document.getElementById('brief-stats');
        const balanceEl = document.getElementById('brief-stat-balance');
        if (statsEl && balanceEl) {
            animateDollarValue(balanceEl, lastShownBalance, data.totalBalance);
            lastShownBalance = data.totalBalance;
            statsEl.style.display = 'flex';
        }

        // "Unassigned" — total balance minus whatever's already earmarked
        // toward a goal's dollar target (YNAB-style: give leftover money a job).
        const unassignedEl = document.getElementById('brief-stat-unassigned');
        if (unassignedEl && typeof data.unassignedBalance === 'number') {
            animateDollarValue(unassignedEl, lastShownUnassigned, data.unassignedBalance);
            lastShownUnassigned = data.unassignedBalance;
        }

        // Small 14-day balance trend chart, drawn above the stats row.
        renderBalanceSparkline(data.balanceHistory);

        // Trend arrow — compares today's balance to roughly a week ago.
        // Hidden entirely until there's enough history (getBalanceTrend
        // returns null for a brand new account with no older snapshot yet).
        const trendEl = document.getElementById('brief-stat-trend');
        if (trendEl) {
            if (data.balanceTrend) {
                const t = data.balanceTrend;
                const arrow = t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '→';
                trendEl.className = `brief-stat-trend trend-${t.direction}`;
                trendEl.textContent = t.direction === 'flat'
                    ? `No change over ${t.days} day${t.days === 1 ? '' : 's'}`
                    : `${arrow} $${formatCurrency(t.amount)} over ${t.days} day${t.days === 1 ? '' : 's'}`;
                trendEl.style.display = 'block';
            } else {
                trendEl.style.display = 'none';
            }
        }

        // Spending pace ring — only shows once the user has set a monthly
        // budget limit (via the gear menu). Green/yellow/red based on how
        // this month's spending compares to how far into the month we are.
        renderPaceRing(data.budgetPace);

        // Getting-started checklist — stays visible until an account, a
        // bill, and a goal have all been added at least once.
        renderGettingStarted(data);

        // Unified AI presence: the same pace/trend signals shown on the
        // dashboard also get a small callout on the Budget and Goals tabs,
        // so the insight follows you instead of living in only one place.
        const budgetCallout = document.getElementById('budget-insight-callout');
        if (budgetCallout) {
            if (data.budgetPace) {
                const p = data.budgetPace;
                const msgs = {
                    green: `You're on pace with your $${formatCurrency(p.limit)} monthly budget — $${formatCurrency(p.spent)} spent so far.`,
                    yellow: `You're a bit ahead of pace on your $${formatCurrency(p.limit)} monthly budget — $${formatCurrency(p.spent)} spent by day ${p.dayOfMonth}.`,
                    red: `You're running over pace on your $${formatCurrency(p.limit)} monthly budget — $${formatCurrency(p.spent)} spent by day ${p.dayOfMonth}.`
                };
                budgetCallout.innerHTML = `<span class="ai-insight-callout-icon">${p.status === 'red' ? '⚠️' : '💡'}</span><span>${msgs[p.status]}</span>`;
                budgetCallout.style.display = 'flex';
            } else {
                budgetCallout.style.display = 'none';
            }
        }

        const goalsCallout = document.getElementById('goals-insight-callout');
        if (goalsCallout) {
            if (typeof data.unassignedBalance === 'number' && data.unassignedBalance > 0.005) {
                goalsCallout.innerHTML = `<span class="ai-insight-callout-icon">💡</span><span>You have $${formatCurrency(data.unassignedBalance)} unassigned — give it a job by setting a dollar target on a goal below.</span>`;
                goalsCallout.style.display = 'flex';
            } else {
                goalsCallout.style.display = 'none';
            }
        }

        // Bills due soon
        const billsEl = document.getElementById('dash-bills');
        if (data.dueSoon.length === 0) {
            billsEl.innerHTML = `<div class="empty-state"><span class="empty-state-icon">✅</span><div class="empty-state-title">No bills due soon</div>Nothing due in the next 7 days</div>`;
        } else {
            billsEl.innerHTML = data.dueSoon.map(b => `
                <div class="dash-bill-row">
                    <div>
                        <div class="dash-bill-name">${b.name}</div>
                        <div class="dash-bill-due">Due: ${b.dueDate} of the month</div>
                        ${b.lastPaid ? `<div class="dash-bill-paid">✓ Paid</div>` : ''}
                    </div>
                    <div class="dash-bill-amount">$${formatCurrency(b.amount)}</div>
                </div>
            `).join('');
        }

        // Today's goals
        const goalsEl = document.getElementById('dash-goals');
        if (data.todayGoals.length === 0) {
            goalsEl.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🎯</span><div class="empty-state-title">No goals set yet</div>Add your goals in the Goals tab</div>`;
        } else {
            goalsEl.innerHTML = data.todayGoals.map(g => {
                const isCompleted = g.lastCompleted === today;
                return `
                <div class="dash-goal-row">
                    <div class="dash-goal-info">
                        <div class="dash-goal-title">${g.title}</div>
                        <div class="dash-goal-meta">${g.recurrence}${g.deadline ? ' · due ' + g.deadline : ''}</div>
                    </div>
                    ${g.streak > 0 ? `<div class="dash-goal-streak">🔥 ${g.streak}</div>` : ''}
                    <button class="dash-complete-btn ${isCompleted ? 'done' : ''}"
                        onclick="${isCompleted ? `uncompleteGoalDash('${g.id}')` : `completeGoalDash('${g.id}')`}">
                        ${isCompleted ? '✓ Done' : 'Mark Done'}
                    </button>
                </div>
            `}).join('');
        }

    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

// Splits the AI's ###SECTION### formatted reply into a lookup like
// { FINANCIAL: "...", PRIORITIES: "...\n...", HEADSUP: "...", MOTIVATION: "..." }
function parseBriefSections(raw) {
    const sections = {};
    const parts = raw.split(/###\s*([A-Z]+)\s*###/);
    // parts alternates: [beforeFirstMarker, MARKER, text, MARKER, text, ...]
    for (let i = 1; i < parts.length; i += 2) {
        const key = parts[i].trim();
        const value = (parts[i + 1] || '').trim();
        if (key && key !== 'END') sections[key] = value;
    }
    return sections;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderBriefHtml(raw) {
    const sections = parseBriefSections(raw);

    // If the AI didn't follow the format for some reason, fall back to showing
    // the raw text rather than an empty/broken-looking brief.
    if (!sections.FINANCIAL && !sections.PRIORITIES && !sections.MOTIVATION) {
        return `<div class="brief-block"><div class="brief-block-text">${escapeHtml(raw)}</div></div>`;
    }

    let html = '';

    if (sections.FINANCIAL) {
        html += `<div class="brief-line"><span class="brief-icon">💰</span><span class="brief-line-text">${escapeHtml(sections.FINANCIAL)}</span></div>`;
    }

    if (sections.PRIORITIES) {
        const items = sections.PRIORITIES.split('\n').map(l => l.trim()).filter(Boolean);
        html += `
            <div class="brief-line brief-priorities-header"><span class="brief-icon">🎯</span><span class="brief-label-text">Top Priorities</span></div>
            <ul class="brief-block-list">
                ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
        `;
    }

    if (sections.HEADSUP && sections.HEADSUP.toUpperCase() !== 'NONE') {
        html += `<div class="brief-line brief-alert-line"><span class="brief-icon">⚠️</span><span class="brief-line-text">${escapeHtml(sections.HEADSUP)}</span></div>`;
    }

    if (sections.MOTIVATION) {
        html += `<div class="brief-line brief-motivation-line"><span class="brief-icon">✨</span><span class="brief-line-text">${escapeHtml(sections.MOTIVATION)}</span></div>`;
    }

    return html;
}

async function loadMorningBrief() {
    const loading = document.getElementById('brief-loading');
    const content = document.getElementById('brief-content');
    const text = document.getElementById('brief-text');
    loading.style.display = 'block';
    content.style.display = 'none';
    try {
        const data = await fetch('/api/morning-brief', { method: 'POST' }).then(r => r.json());
        text.innerHTML = renderBriefHtml(data.brief || '');
        loading.style.display = 'none';
        content.style.display = 'block';

        const freshnessEl = document.getElementById('brief-freshness');
        if (freshnessEl) {
            const now = new Date();
            freshnessEl.textContent = `As of ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
        }
    } catch (error) {
        loading.innerHTML = '<div style="color:#ff6b6b;font-size:0.85rem;">Couldn\'t load your morning brief — check your connection and refresh.</div>';
    }
}

// ── CELEBRATION MICRO-INTERACTIONS ──────────────────────

// A small, self-dismissing toast for the little wins — completing a goal,
// paying off a bill — so those moments feel like something instead of
// just quietly updating a list. Pure CSS animation, no dependencies.
function celebrate(message) {
    const container = document.getElementById('celebration-container') || (() => {
        const el = document.createElement('div');
        el.id = 'celebration-container';
        document.body.appendChild(el);
        return el;
    })();

    const toast = document.createElement('div');
    toast.className = 'celebration-toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('celebration-toast-out'), 1800);
    setTimeout(() => toast.remove(), 2200);
}

async function completeGoalDash(id) {
    try {
        await fetch(`/api/goals/${id}/complete`, { method: 'POST' });
        loadDashboard();
        celebrate('🎉 Nice work — goal complete!');
    } catch (error) {
        showToast("Couldn't complete goal — give it another try.");
    }
}

async function uncompleteGoalDash(id) {
    try {
        await fetch(`/api/goals/${id}/uncomplete`, { method: 'POST' });
        loadDashboard();
    } catch (error) {
        showToast("Couldn't uncomplete goal — give it another try.");
    }
}

// ── GOALS ──────────────────────────────────────────────

async function loadGoals() {
    const list = document.getElementById('goals-list');
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading goals...</p>';
    try {
        const goals = await fetch('/api/goals').then(r => r.json());
        if (goals.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🎯</span><div class="empty-state-title">No goals yet</div>Add your first goal above to get started</div>`;
            return;
        }
        const groups = { daily: [], weekly: [], deadline: [], ongoing: [] };
        goals.forEach(g => {
            if (groups[g.recurrence]) groups[g.recurrence].push(g);
            else groups.ongoing.push(g);
        });
        const labels = { daily: 'Daily', weekly: 'Weekly', deadline: 'Has Deadline', ongoing: 'Ongoing' };
        let html = '';
        for (const [key, items] of Object.entries(groups)) {
            if (items.length === 0) continue;
            html += `<div style="margin-top:20px;margin-bottom:8px;color:#4a6080;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">${labels[key]}</div>`;
            html += items.map(g => {
                const isCompleted = g.lastCompleted === today;
                let deadlineColor = '';
                let deadlineLabel = '';
                if (g.deadline) {
                    const daysLeft = Math.floor((new Date(g.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                    deadlineColor = daysLeft <= 3 ? 'goal-deadline-urgent' : daysLeft <= 14 ? 'goal-deadline-soon' : '';
                    deadlineLabel = ` · ${daysLeft} days left`;
                }
                return `
                <div class="goal-item ${isCompleted ? 'bill-paid' : ''}">
                    <div class="goal-info">
                        <div class="goal-title">${g.title}</div>
                        <div class="goal-meta">${g.category}${g.deadline ? `<span class="${deadlineColor}"> · Due ${g.deadline}${deadlineLabel}</span>` : ''}</div>
                        ${g.streak > 0 ? `<div class="goal-streak">🔥 ${g.streak} day streak</div>` : ''}
                        ${g.notes ? `<div class="goal-meta" style="margin-top:3px;">${g.notes}</div>` : ''}
                        ${g.whyIWantIt ? `<div class="goal-why">💭 ${g.whyIWantIt}</div>` : ''}
                        ${g.reward ? `<div class="goal-reward">🎁 Reward: ${g.reward}</div>` : ''}
                        ${g.targetAmount ? renderGoalMoneyProgress(g) : ''}
                        ${renderActionSteps(g)}
                    </div>
                    <div class="bill-actions">
                        <button class="btn-small ${isCompleted ? 'done' : ''}"
                            onclick="${isCompleted ? `uncompleteGoal('${g.id}')` : `completeGoal('${g.id}')`}"
                            style="${isCompleted ? 'border-color:#1F7A3C;color:#1F7A3C;' : ''}">
                            ${isCompleted ? '✓ Done' : 'Mark Done'}
                        </button>
                        ${g.targetAmount ? `<button class="btn-small" onclick="assignToGoal('${g.id}', ${g.savedAmount || 0}, ${g.targetAmount})">Assign $</button>` : ''}
                        <button class="btn-danger" onclick="removeGoal('${g.id}')">Remove</button>
                    </div>
                </div>
            `}).join('');
        }
        list.innerHTML = html;
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load goals</div>Check your connection and try again</div>`;
    }
}

async function addGoal() {
    const title = document.getElementById('goal-title').value;
    const category = document.getElementById('goal-category').value;
    const recurrence = document.getElementById('goal-recurrence').value;
    const deadline = document.getElementById('goal-deadline').value;
    const notes = document.getElementById('goal-notes').value;
    const whyIWantIt = document.getElementById('goal-why').value;
    const reward = document.getElementById('goal-reward').value;
    const targetAmount = document.getElementById('goal-target').value;
    if (!title.trim()) { showToast('Please enter a goal title.'); return; }
    try {
        await fetch('/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, category, recurrence, deadline, notes, whyIWantIt, reward, targetAmount })
        });
        document.getElementById('goal-title').value = '';
        document.getElementById('goal-deadline').value = '';
        document.getElementById('goal-notes').value = '';
        document.getElementById('goal-why').value = '';
        document.getElementById('goal-reward').value = '';
        document.getElementById('goal-target').value = '';
        loadGoals();
    } catch (error) {
        showToast("Couldn't add goal — give it another try.");
    }
}

// Prompts for a dollar amount and moves it into (or, with a negative
// number, back out of) a goal's saved-so-far total. Refreshes both the
// Goals tab and the dashboard since "Unassigned" balance changes too.
async function assignToGoal(goalId, currentSaved, targetAmount) {
    const input = await promptModal(
        `How much would you like to assign to this goal? (Currently $${formatCurrency(currentSaved)} of $${formatCurrency(targetAmount)}). Enter a negative number to move money back out.`,
        ''
    );
    if (input === null) return;
    const amount = parseFloat(input);
    if (!Number.isFinite(amount) || amount === 0) {
        showToast('Please enter a non-zero number.');
        return;
    }
    try {
        const res = await fetch(`/api/goals/${goalId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        if (!res.ok) {
            showToast('Could not update this goal.');
            return;
        }
        loadGoals();
        loadDashboard();
    } catch (error) {
        showToast('Could not reach the server.');
    }
}

// Shows a small progress bar for a goal with a dollar target — e.g. saving
// $500 toward something, with however much has been "assigned" so far.
function renderGoalMoneyProgress(g) {
    const saved = g.savedAmount || 0;
    const target = g.targetAmount;
    const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
    return `
        <div class="goal-money-progress">
            <div class="goal-money-bar"><div class="goal-money-fill" style="width:${pct}%"></div></div>
            <div class="goal-money-label">$${formatCurrency(saved)} of $${formatCurrency(target)} (${pct}%)</div>
        </div>
    `;
}

// ── GOAL ACTION STEPS ──────────────────────────────────

function renderActionSteps(g) {
    const steps = g.actionSteps || [];
    const stepsHtml = steps.map(s => `
        <div class="action-step ${s.completed ? 'done' : ''}">
            <input type="checkbox" ${s.completed ? 'checked' : ''} onchange="toggleActionStep('${g.id}', '${s.id}')">
            <span>${s.text}</span>
            <button class="step-remove" onclick="removeActionStep('${g.id}', '${s.id}')" title="Remove step">×</button>
        </div>
    `).join('');
    return `
        <div class="action-steps">
            ${stepsHtml}
            <div class="action-step-add">
                <input type="text" placeholder="Add a step..." id="new-step-${g.id}"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();addActionStep('${g.id}');}">
                <button class="btn-small" onclick="addActionStep('${g.id}')">Add</button>
            </div>
        </div>
    `;
}

async function addActionStep(goalId) {
    const input = document.getElementById('new-step-' + goalId);
    const stepText = input.value;
    if (!stepText.trim()) return;
    try {
        await fetch(`/api/goals/${goalId}/steps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stepText })
        });
        loadGoals();
    } catch (error) {
        showToast("Couldn't add step — give it another try.");
    }
}

async function toggleActionStep(goalId, stepId) {
    try {
        await fetch(`/api/goals/${goalId}/steps/${stepId}/toggle`, { method: 'POST' });
        loadGoals();
    } catch (error) {
        showToast("Couldn't update step — give it another try.");
    }
}

async function removeActionStep(goalId, stepId) {
    try {
        await fetch(`/api/goals/${goalId}/steps/${stepId}`, { method: 'DELETE' });
        loadGoals();
    } catch (error) {
        showToast("Couldn't remove step — give it another try.");
    }
}

async function completeGoal(id) {
    try {
        await fetch(`/api/goals/${id}/complete`, { method: 'POST' });
        loadGoals();
        loadDashboard();
        celebrate('🎉 Nice work — goal complete!');
    } catch (error) {
        showToast("Couldn't complete goal — give it another try.");
    }
}

async function uncompleteGoal(id) {
    try {
        await fetch(`/api/goals/${id}/uncomplete`, { method: 'POST' });
        loadGoals();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't uncomplete goal — give it another try.");
    }
}

async function removeGoal(id) {
    if (!(await confirmAction('Remove this goal?'))) return;
    try {
        await fetch(`/api/goals/${id}`, { method: 'DELETE' });
        loadGoals();
    } catch (error) {
        showToast("Couldn't remove goal — give it another try.");
    }
}

// ── WEEKLY REVIEW ──────────────────────────────────────

let cachedReviews = [];

async function loadWeeklyReviews() {
    const list = document.getElementById('reviews-list');
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading past reviews...</p>';
    try {
        cachedReviews = await fetch('/api/weekly-reviews').then(r => r.json());
        if (cachedReviews.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📝</span><div class="empty-state-title">No reviews yet</div>Save your first weekly review above</div>`;
            return;
        }
        list.innerHTML = cachedReviews.map(r => `
            <div class="bill-item">
                <div class="bill-info">
                    <div class="bill-name">Week of ${r.weekStart}</div>
                    ${r.mainGoal ? `<div class="bill-details">Main goal: ${r.mainGoal}</div>` : ''}
                    ${r.wins ? `<div class="bill-details">🏆 ${r.wins}</div>` : ''}
                    ${r.improveNextWeek ? `<div class="bill-details">🔧 ${r.improveNextWeek}</div>` : ''}
                </div>
                <div class="bill-actions">
                    <button class="btn-small" onclick="editWeeklyReview('${r.id}')">Edit</button>
                    <button class="btn-danger" onclick="removeWeeklyReview('${r.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load reviews</div>Check your connection and try again</div>`;
    }
}

function editWeeklyReview(id) {
    const r = cachedReviews.find(rev => String(rev.id) === String(id));
    if (!r) return;
    document.getElementById('review-week-start').value = r.weekStart;
    document.getElementById('review-main-goal').value = r.mainGoal || '';
    document.getElementById('review-wins').value = r.wins || '';
    document.getElementById('review-improve').value = r.improveNextWeek || '';
    document.getElementById('review-week-start').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveWeeklyReview() {
    const weekStart = document.getElementById('review-week-start').value;
    const mainGoal = document.getElementById('review-main-goal').value;
    const wins = document.getElementById('review-wins').value;
    const improveNextWeek = document.getElementById('review-improve').value;
    if (!weekStart) { showToast('Please choose the week start date.'); return; }
    try {
        await fetch('/api/weekly-reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekStart, mainGoal, wins, improveNextWeek })
        });
        document.getElementById('review-main-goal').value = '';
        document.getElementById('review-wins').value = '';
        document.getElementById('review-improve').value = '';
        document.getElementById('review-week-start').value = getMondayOfThisWeek();
        loadWeeklyReviews();
    } catch (error) {
        showToast("Couldn't save weekly review — give it another try.");
    }
}

async function removeWeeklyReview(id) {
    if (!(await confirmAction('Remove this weekly review?'))) return;
    try {
        await fetch('/api/weekly-reviews/' + id, { method: 'DELETE' });
        loadWeeklyReviews();
    } catch (error) {
        showToast("Couldn't remove weekly review — give it another try.");
    }
}

// ── DAILY RITUALS ───────────────────────────────────────

async function loadRituals() {
    try {
        const tasks = await fetch(`/api/tasks/${today}`).then(r => r.json());
        renderRitualList('morning', tasks.filter(t => t.source === 'ritual-morning'));
        renderRitualList('evening', tasks.filter(t => t.source === 'ritual-evening'));
    } catch (error) {
        document.getElementById('ritual-morning-list').innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load</div>Check your connection and try again</div>`;
        document.getElementById('ritual-evening-list').innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load</div>Check your connection and try again</div>`;
    }
    loadDailyReflection();
}

function renderRitualList(period, items) {
    const list = document.getElementById(`ritual-${period}-list`);
    if (items.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${period === 'morning' ? '🌅' : '🌙'}</span><div class="empty-state-title">Nothing added yet</div>Add your ${period} routine above</div>`;
        return;
    }
    list.innerHTML = items.map(t => `
        <div class="action-step ${t.completed ? 'done' : ''}" style="padding:8px 0;">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleRitualItem('${t.id}')">
            <span>${t.task_text}</span>
            <button class="step-remove" onclick="removeRitualItem('${t.id}')" title="Remove">×</button>
        </div>
    `).join('');
}

async function addRitualItem(period) {
    const input = document.getElementById(`ritual-${period}-text`);
    const taskText = input.value;
    if (!taskText.trim()) return;
    try {
        await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, taskText, source: `ritual-${period}` })
        });
        input.value = '';
        loadRituals();
    } catch (error) {
        showToast("Couldn't add item — give it another try.");
    }
}

async function toggleRitualItem(id) {
    try {
        await fetch(`/api/tasks/${id}/toggle`, { method: 'POST' });
        loadRituals();
    } catch (error) {
        showToast("Couldn't update item — give it another try.");
    }
}

async function removeRitualItem(id) {
    try {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        loadRituals();
    } catch (error) {
        showToast("Couldn't remove item — give it another try.");
    }
}

async function loadDailyReflection() {
    try {
        const r = await fetch(`/api/reflections/${today}`).then(res => res.json());
        document.getElementById('reflection-gratitude').value = r.gratitude || '';
        document.getElementById('reflection-affirmation').value = r.affirmation || '';
    } catch (error) {
        // leave fields blank
    }
}

async function saveDailyReflection() {
    const gratitude = document.getElementById('reflection-gratitude').value;
    const affirmation = document.getElementById('reflection-affirmation').value;
    const btn = event.target;
    try {
        await fetch('/api/reflections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, gratitude, affirmation })
        });
        const original = btn.textContent;
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (error) {
        showToast("Couldn't save — give it another try.");
    }
}

// ── MONTHLY REFLECTION (wheel of life) ──────────────────

const WHEEL_CATEGORIES = [
    { key: 'health', label: 'Health' },
    { key: 'career', label: 'Career' },
    { key: 'financial', label: 'Financial' },
    { key: 'personal', label: 'Personal' },
    { key: 'family', label: 'Family' },
    { key: 'home', label: 'Home' }
];

let cachedMonthlyReflections = [];

function getCurrentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function wheelPoint(index, value, radius) {
    // Index 0 starts at the top, going clockwise around 6 evenly spaced axes
    const angle = (Math.PI * 2 * index) / WHEEL_CATEGORIES.length - Math.PI / 2;
    const r = (value / 10) * radius;
    return { x: 110 + r * Math.cos(angle), y: 110 + r * Math.sin(angle) };
}

function updateWheelChart() {
    const radius = 85;
    const values = WHEEL_CATEGORIES.map(c => parseInt(document.getElementById(`wheel-${c.key}`).value, 10));

    WHEEL_CATEGORIES.forEach(c => {
        document.getElementById(`wheel-${c.key}-val`).textContent = document.getElementById(`wheel-${c.key}`).value;
    });

    // Faint background rings at 20/40/60/80/100% so the chart has a scale to read against
    let gridRings = '';
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach(pct => {
        const pts = WHEEL_CATEGORIES.map((c, i) => wheelPoint(i, pct * 10, radius));
        gridRings += `<polygon points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#1a2744" stroke-width="1" />`;
    });

    let axisLines = '';
    WHEEL_CATEGORIES.forEach((c, i) => {
        const p = wheelPoint(i, 10, radius);
        axisLines += `<line x1="110" y1="110" x2="${p.x}" y2="${p.y}" stroke="#1a2744" stroke-width="1" />`;
    });

    const dataPoints = WHEEL_CATEGORIES.map((c, i) => wheelPoint(i, values[i], radius));
    const dataPolygon = `<polygon points="${dataPoints.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(74,158,255,0.25)" stroke="#4a9eff" stroke-width="2" />`;
    const dataDots = dataPoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#4a9eff" />`).join('');

    let labels = '';
    WHEEL_CATEGORIES.forEach((c, i) => {
        const p = wheelPoint(i, 12.5, radius);
        labels += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" fill="#a8b8d0" font-size="11">${c.label}</text>`;
    });

    document.getElementById('wheel-chart-container').innerHTML = `
        <svg viewBox="0 0 220 220" style="width:100%; max-width:320px; display:block; margin: 12px auto;">
            ${gridRings}
            ${axisLines}
            ${dataPolygon}
            ${dataDots}
            ${labels}
        </svg>
    `;
}

async function loadMonthlyTab() {
    if (document.getElementById('monthly-month') && !document.getElementById('monthly-month').value) {
        document.getElementById('monthly-month').value = getCurrentYearMonth();
    }
    updateWheelChart();
    await loadMonthlyReflections();
}

async function loadMonthlyReflections() {
    const list = document.getElementById('monthly-reflections-list');
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading past months...</p>';
    try {
        cachedMonthlyReflections = await fetch('/api/monthly-reflections').then(r => r.json());
        if (cachedMonthlyReflections.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🎡</span><div class="empty-state-title">No reflections yet</div>Save your first one above</div>`;
            return;
        }
        list.innerHTML = cachedMonthlyReflections.map(r => `
            <div class="bill-item">
                <div class="bill-info">
                    <div class="bill-name">${r.month}</div>
                    <div class="bill-details">Health ${r.health} · Career ${r.career} · Financial ${r.financial} · Personal ${r.personal} · Family ${r.family} · Home ${r.home}</div>
                    ${r.notes ? `<div class="bill-details">${r.notes}</div>` : ''}
                </div>
                <div class="bill-actions">
                    <button class="btn-small" onclick="editMonthlyReflection('${r.id}')">Edit</button>
                    <button class="btn-danger" onclick="removeMonthlyReflection('${r.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load reflections</div>Check your connection and try again</div>`;
    }
}

function editMonthlyReflection(id) {
    const r = cachedMonthlyReflections.find(rev => String(rev.id) === String(id));
    if (!r) return;
    document.getElementById('monthly-month').value = r.month;
    WHEEL_CATEGORIES.forEach(c => {
        document.getElementById(`wheel-${c.key}`).value = r[c.key];
    });
    document.getElementById('monthly-notes').value = r.notes || '';
    updateWheelChart();
    document.getElementById('monthly-month').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveMonthlyReflection() {
    const month = document.getElementById('monthly-month').value;
    if (!month) { showToast('Please choose a month.'); return; }
    const body = { month, notes: document.getElementById('monthly-notes').value };
    WHEEL_CATEGORIES.forEach(c => {
        body[c.key] = document.getElementById(`wheel-${c.key}`).value;
    });
    try {
        await fetch('/api/monthly-reflections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        loadMonthlyReflections();
    } catch (error) {
        showToast("Couldn't save reflection — give it another try.");
    }
}

async function removeMonthlyReflection(id) {
    if (!(await confirmAction('Remove this reflection?'))) return;
    try {
        await fetch('/api/monthly-reflections/' + id, { method: 'DELETE' });
        loadMonthlyReflections();
    } catch (error) {
        showToast("Couldn't remove reflection — give it another try.");
    }
}

// ── BUDGET ─────────────────────────────────────────────

async function getBudget() {
    const amount = document.getElementById('paycheck-amount').value;
    const date = document.getElementById('paycheck-date').value;
    if (!amount || !date) { showToast('Please enter your paycheck amount and date.'); return; }
    const btn = event.target;
    const result = document.getElementById('budget-result');
    btn.disabled = true;
    btn.textContent = 'Calculating...';
    result.className = 'result visible';
    result.innerHTML = '<span class="loading">Claude is breaking down your paycheck across all accounts...</span>';
    try {
        const response = await fetch('/api/budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paycheckAmount: amount, paycheckDate: date })
        });
        const data = await response.json();
        result.textContent = data.result;
    } catch (error) {
        result.textContent = 'Something went wrong. Please try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Break It Down';
    }
}

// ── BILLS ──────────────────────────────────────────────

// Remembers past bills/expenses so the add-forms can suggest and autofill
// from what's already been entered — no need to retype an amount for a
// bill you pay every month.
let cachedBillsForAutofill = [];
let cachedExpensesForAutofill = [];

function autofillBillAmount() {
    const nameInput = document.getElementById('bill-name');
    const amountInput = document.getElementById('bill-amount');
    if (!nameInput || !amountInput) return;
    const typed = nameInput.value.trim().toLowerCase();
    if (!typed) return;
    const match = cachedBillsForAutofill.find(b => b.name.toLowerCase() === typed);
    if (match) {
        amountInput.value = match.amount;
    }
}

function autofillExpenseFields() {
    const descInput = document.getElementById('expense-description');
    const amountInput = document.getElementById('expense-amount');
    const categorySelect = document.getElementById('expense-category');
    if (!descInput) return;
    const typed = descInput.value.trim().toLowerCase();
    if (!typed) return;
    const match = cachedExpensesForAutofill.find(e => (e.description || '').toLowerCase() === typed);
    if (match) {
        if (amountInput) amountInput.value = match.amount;
        if (categorySelect && match.category) categorySelect.value = match.category;
    }
}

async function loadBills() {
    const list = document.getElementById('bills-list');
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading bills...</p>';
    try {
        const accounts = await fetch('/api/accounts').then(r => r.json());
        const cards = await fetch('/api/creditcards').then(r => r.json());
        const bills = await fetch('/api/bills').then(r => r.json());

        cachedBillsForAutofill = bills;
        const billNameList = document.getElementById('bill-name-suggestions');
        if (billNameList) {
            const uniqueNames = [...new Set(bills.map(b => b.name))];
            billNameList.innerHTML = uniqueNames.map(n => `<option value="${n}"></option>`).join('');
        }

        if (bills.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📋</span><div class="empty-state-title">No bills yet</div>Add your first bill above to get started</div>`;
            return;
        }
        const accountOptions = [
            '<optgroup label="Bank Accounts">',
            ...accounts.map(a => `<option value="${a.id}" data-balance="${a.balance}" data-name="${a.name}">${a.name} ($${formatCurrency(a.balance)})</option>`),
            '</optgroup>',
            '<optgroup label="Credit Cards">',
            ...cards.map(c => `<option value="${c.id}" data-balance="${(c.limit - c.balance)}" data-name="${c.name}">${c.name} (Available: $${formatCurrency((c.limit - c.balance))})</option>`),
            '</optgroup>'
        ].join('');
        list.innerHTML = bills.map(bill => {
            const isPaid = !!bill.lastPaid;
            return `
            <div class="bill-item ${isPaid ? 'bill-paid' : ''}" id="bill-${bill.id}">
                <div class="bill-info">
                    <div class="bill-name">${bill.name}</div>
                    <div class="bill-details">Due: ${bill.dueDate} of the month · ${bill.frequency} · ${bill.type}</div>
                    ${isPaid ? `<div class="bill-paid-label">✓ Paid on ${bill.lastPaid}</div>` : ''}
                </div>
                <div class="bill-actions">
                    <span class="bill-amount">$${formatCurrency(bill.amount)}</span>
                    ${!isPaid ? `
                        <select class="inline-select" id="account-for-${bill.id}">
                            <option value="">Pay from...</option>
                            ${accountOptions}
                        </select>
                        <button class="btn-small" onclick="payBill('${bill.id}', '${bill.name}', ${bill.amount})">Mark Paid</button>
                    ` : `
                        <button class="btn-small" style="border-color:#3a1515;color:#ff6b6b;" onclick="unpayBill('${bill.id}')">Unmark</button>
                    `}
                    <button class="btn-danger" onclick="removeBill('${bill.id}')">Remove</button>
                </div>
            </div>
        `}).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load bills</div>Check your connection and try again</div>`;
    }
}

async function addBill() {
    const name = document.getElementById('bill-name').value;
    const amount = document.getElementById('bill-amount').value;
    const dueDate = document.getElementById('bill-due').value;
    const type = document.getElementById('bill-type').value;
    const frequency = document.getElementById('bill-frequency').value;
    if (!name || !amount || !dueDate) { showToast('Please fill in the bill name, amount, and due date.'); return; }
    try {
        await fetch('/api/bills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, amount, dueDate, type, frequency })
        });
        document.getElementById('bill-name').value = '';
        document.getElementById('bill-amount').value = '';
        document.getElementById('bill-due').value = '';
        loadBills();
    } catch (error) {
        showToast("Couldn't add bill — give it another try.");
    }
}

async function payBill(id, name, amount) {
    const select = document.getElementById('account-for-' + id);
    const accountId = select.value;
    const accountName = select.options[select.selectedIndex]?.dataset?.name;
    const currentBalance = parseFloat(select.options[select.selectedIndex]?.dataset?.balance || 0);
    if (!accountId) { showToast('Please select which account or card to pay this bill from.'); return; }
    const newBalance = (currentBalance - amount).toFixed(2);
    if (newBalance < 0) {
        if (!(await confirmAction(`Warning: This will overdraft ${accountName} by $${formatCurrency(Math.abs(newBalance))}. Continue?`))) return;
    }
    try {
        await fetch(`/api/bills/${id}/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, billName: name, amount, paidFrom: accountName, accountId, newAccountBalance: newBalance, type: 'bill' })
        });
        loadBills();
        loadDashboard();
        celebrate(`✅ ${name} paid`);
    } catch (error) {
        showToast("Couldn't mark bill as paid — give it another try.");
    }
}

async function unpayBill(id) {
    if (!(await confirmAction('Unmark this bill as paid? The amount will be returned to the account it was paid from.'))) return;
    try {
        await fetch(`/api/bills/${id}/unpay`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        loadBills();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't unmark bill — give it another try.");
    }
}

async function removeBill(id) {
    if (!(await confirmAction('Remove this bill?'))) return;
    try {
        await fetch('/api/bills/' + id, { method: 'DELETE' });
        loadBills();
    } catch (error) {
        showToast("Couldn't remove bill — give it another try.");
    }
}

// ── ACCOUNTS ───────────────────────────────────────────

async function loadAccounts() {
    const list = document.getElementById('accounts-list');
    if (!list) return;
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading accounts...</p>';
    try {
        const accounts = await fetch('/api/accounts').then(r => r.json());
        if (accounts.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🏦</span><div class="empty-state-title">No accounts yet</div>Add your first account above</div>`;
            return;
        }
        list.innerHTML = accounts.map(a => `
            <div class="bill-item">
                <div class="bill-info">
                    <div class="bill-name">${a.name}</div>
                    <div class="bill-details">${a.type} · ${a.allocation}% of paycheck${a.notes ? ' · ' + a.notes : ''}</div>
                </div>
                <div class="bill-actions">
                    <span class="bill-amount">$${formatCurrency(a.balance)}</span>
                    <input type="number" placeholder="New balance" class="inline-input" id="bal-${a.id}">
                    <button class="btn-small" onclick="updateBalance('${a.id}')">Update</button>
                    <button class="btn-danger" onclick="removeAccount('${a.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load accounts</div>Check your connection and try again</div>`;
    }
}

async function addAccount() {
    const name = document.getElementById('account-name').value;
    const type = document.getElementById('account-type').value;
    const balance = document.getElementById('account-balance').value;
    const allocation = document.getElementById('account-allocation').value;
    const notes = document.getElementById('account-notes').value;
    if (!name || !balance) { showToast('Please enter the account name and current balance.'); return; }
    try {
        await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type, balance, allocation: allocation || 0, notes })
        });
        document.getElementById('account-name').value = '';
        document.getElementById('account-balance').value = '';
        document.getElementById('account-allocation').value = '';
        document.getElementById('account-notes').value = '';
        loadAccounts();
    } catch (error) {
        showToast("Couldn't add account — give it another try.");
    }
}

async function updateBalance(id) {
    const input = document.getElementById('bal-' + id);
    const newBalance = input.value;
    if (!newBalance) { showToast('Please enter a new balance.'); return; }
    try {
        await fetch('/api/accounts/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ balance: newBalance })
        });
        loadAccounts();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't update balance — give it another try.");
    }
}

async function removeAccount(id) {
    if (!(await confirmAction('Remove this account?'))) return;
    try {
        await fetch('/api/accounts/' + id, { method: 'DELETE' });
        loadAccounts();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't remove account — give it another try.");
    }
}

// ── CREDIT CARDS ───────────────────────────────────────

async function loadCards() {
    const list = document.getElementById('cards-list');
    if (!list) return;
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading cards...</p>';
    try {
        const cards = await fetch('/api/creditcards').then(r => r.json());
        if (cards.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">💳</span><div class="empty-state-title">No cards yet</div>Add your first card above</div>`;
            return;
        }
        list.innerHTML = cards.map(c => {
            const util = c.limit > 0 ? ((c.balance / c.limit) * 100).toFixed(0) : 0;
            const color = util > 80 ? '#ff6b6b' : util > 50 ? '#f0a500' : '#4a9eff';
            return `
            <div class="bill-item">
                <div class="bill-info">
                    <div class="bill-name">${c.name}</div>
                    <div class="bill-details">Used for: ${c.purpose} · Paid from: ${c.linkedAccount} · Limit: $${formatCurrency(c.limit)}</div>
                    <div class="bill-details" style="color:${color}">Utilization: ${util}%</div>
                </div>
                <div class="bill-actions">
                    <span class="bill-amount" style="color:#ff6b6b;">$${formatCurrency(c.balance)}</span>
                    <input type="number" placeholder="New balance" class="inline-input" id="card-bal-${c.id}">
                    <button class="btn-small" onclick="updateCardBalance('${c.id}')">Update</button>
                    <button class="btn-danger" onclick="removeCard('${c.id}')">Remove</button>
                </div>
            </div>
        `}).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load cards</div>Check your connection and try again</div>`;
    }
}

async function addCard() {
    const name = document.getElementById('card-name').value;
    const balance = document.getElementById('card-balance').value;
    const limit = document.getElementById('card-limit').value;
    const purpose = document.getElementById('card-purpose').value;
    const linkedAccount = document.getElementById('card-linked').value;
    if (!name || !balance || !limit) { showToast('Please enter the card name, balance, and limit.'); return; }
    try {
        await fetch('/api/creditcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, balance, limit, purpose, linkedAccount })
        });
        document.getElementById('card-name').value = '';
        document.getElementById('card-balance').value = '';
        document.getElementById('card-limit').value = '';
        document.getElementById('card-purpose').value = '';
        document.getElementById('card-linked').value = '';
        loadCards();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't add card — give it another try.");
    }
}

async function updateCardBalance(id) {
    const input = document.getElementById('card-bal-' + id);
    const newBalance = input.value;
    if (!newBalance) { showToast('Please enter a new balance.'); return; }
    try {
        await fetch('/api/creditcards/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ balance: newBalance })
        });
        loadCards();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't update card balance — give it another try.");
    }
}

async function removeCard(id) {
    if (!(await confirmAction('Remove this card?'))) return;
    try {
        await fetch('/api/creditcards/' + id, { method: 'DELETE' });
        loadCards();
        loadDashboard();
    } catch (error) {
        showToast("Couldn't remove card — give it another try.");
    }
}

// ── EXPENSES ───────────────────────────────────────────

async function loadExpenses() {
    const list = document.getElementById('expenses-list');
    list.innerHTML = '<p class="loading" style="padding:16px 0;">Loading expenses...</p>';
    try {
        const expenses = await fetch('/api/expenses').then(r => r.json());

        cachedExpensesForAutofill = expenses;
        const expenseDescList = document.getElementById('expense-description-suggestions');
        if (expenseDescList) {
            const uniqueDescs = [...new Set(expenses.map(e => e.description).filter(Boolean))];
            expenseDescList.innerHTML = uniqueDescs.map(d => `<option value="${d}"></option>`).join('');
        }

        if (expenses.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">🧾</span><div class="empty-state-title">No expenses yet</div>Log your first expense above</div>`;
            return;
        }
        const recent = expenses.slice(-10).reverse();
        list.innerHTML = recent.map(exp => `
            <div class="expense-item">
                <div class="expense-info">
                    <div class="expense-category">${exp.category}</div>
                    <div class="expense-desc">${exp.description}</div>
                    <div class="expense-date">${exp.date}</div>
                </div>
                <span class="expense-amount">-$${formatCurrency(parseFloat(exp.amount))}</span>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Couldn't load expenses</div>Check your connection and try again</div>`;
    }
}

async function addExpense() {
    const category = document.getElementById('expense-category').value;
    const description = document.getElementById('expense-description').value;
    const amount = document.getElementById('expense-amount').value;
    const date = document.getElementById('expense-date').value;
    if (!description || !amount) { showToast('Please enter a description and amount.'); return; }
    const result = document.getElementById('expense-result');
    try {
        await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, description, amount, date })
        });
        result.className = 'result visible';
        result.textContent = `Logged $${formatCurrency(parseFloat(amount))} for ${description}.`;
        document.getElementById('expense-description').value = '';
        document.getElementById('expense-amount').value = '';
        loadExpenses();
    } catch (error) {
        showToast("Couldn't log expense — give it another try.");
    }
}

// ── INIT ───────────────────────────────────────────────

checkAuth();
