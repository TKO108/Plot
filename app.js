/* ==========================================
   ChronoPlot Core Application Logic
========================================== */

const STORAGE_KEY = 'chronoplot_projects_v1';
const THEME_KEY = 'chronoplot_theme_v1';

// プリセットカラーパレット（重複防止チェック対応）
const COLOR_PALETTE = [
    '#ec4899', // Pink
    '#8b5cf6', // Purple
    '#6366f1', // Indigo
    '#38bdf8', // Sky
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#f43f5e', // Rose
    '#14b8a6', // Teal
    '#a855f7', // Violet
    '#3b82f6', // Blue
    '#eab308', // Yellow
    '#fb7185'  // Coral
];

// PSLOC解説定義
const PSLOC_DEFINITIONS = {
    L: {
        title: 'L：欠落（Lack）とは？',
        body: '主人公の活動や動機、葛藤の源泉となる「欠けているもの・満たされない思い」です。物語を通じて主人公が何を求め、なぜ行動するのかの原動力になります。'
    },
    O: {
        title: 'O：障害（Obstacle）とは？',
        body: '主人公の目的達成を阻む「具体的な事象・物・人物・環境」です。物語の緊張感や対立を生み出す壁となります。'
    },
    C: {
        title: 'C：変化（Change）とは？',
        body: '物語の最初と最後で、主人公や周囲の状況が「どのように変わっているか」です。成長・変質・価値観の転換など、物語の結末の核心を示します。'
    }
};

// アプリ全体状態
let projects = [];
let currentProjectId = null;
let activeDrawer = null;
let activeCharacterId = null;
let noteFolderFilter = 'all';

// キャンバス操作状態
let canvasMode = 'move'; // 'move' | 'select' | 'connect'
let selectedNoteIds = new Set();
let connectSourceNoteId = null;

// ビューポート（パン・ズーム）
let viewScale = 1;
let viewX = -2400;
let viewY = -2500;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// 付箋ドラッグ状態
let draggingNoteId = null;
let dragStartMouseX = 0;
let dragStartMouseY = 0;
let dragInitialPositions = new Map();
let hasDraggedMoved = false;

// ピンチズーム状態
let initialPinchDistance = null;
let initialPinchScale = 1;

// Undo / Redo スタック
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 40;

// グラフ状態
let isGraphVisible = true;
let graphMode = 'all'; // 'all' | 'single'

// ==========================================
// 初期化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadProjects();
    renderHomeView();
    setupCanvasEvents();
    setupKeyboardShortcuts();
    lucide.createIcons();
});

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    if (currentProjectId) {
        renderEmotionGraph();
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    msgEl.textContent = msg;
    toast.classList.remove('opacity-0', 'translate-y-[-10px]');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-10px]');
        toast.classList.remove('opacity-100', 'translate-y-0');
    }, 2200);
}

// ==========================================
// データ永続化 & プロジェクト構造
// ==========================================
function loadProjects() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        projects = raw ? JSON.parse(raw) : [];
    } catch (e) {
        projects = [];
    }
}

function saveProjects() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function getCurrentProject() {
    return projects.find(p => p.id === currentProjectId) || null;
}

function createDefaultProject(title, memo) {
    return {
        id: 'proj_' + Date.now(),
        title: title || '無題の物語',
        memo: memo || '',
        updatedAt: Date.now(),
        outlineColor: '#6366f1',
        template: {
            P: '',
            S: '',
            L: '',
            O: '',
            C: ''
        },
        stages: [
            { id: 'stg_1', title: '時代・世界観', content: '' },
            { id: 'stg_2', title: '主な舞台・場所', content: '' }
        ],
        characters: [],
        notes: [],
        connections: []
    };
}

// ==========================================
// Undo / Redo 履歴管理
// ==========================================
function pushHistory() {
    const proj = getCurrentProject();
    if (!proj) return;
    undoStack.push(JSON.stringify(proj));
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
    updateHistoryButtons();
}

function undo() {
    if (undoStack.length === 0) return;
    const proj = getCurrentProject();
    if (!proj) return;
    redoStack.push(JSON.stringify(proj));
    const prev = JSON.parse(undoStack.pop());
    const idx = projects.findIndex(p => p.id === currentProjectId);
    if (idx !== -1) projects[idx] = prev;
    saveProjects();
    refreshWorkspaceUI();
    updateHistoryButtons();
    showToast('操作を元に戻しました');
}

function redo() {
    if (redoStack.length === 0) return;
    const proj = getCurrentProject();
    if (!proj) return;
    undoStack.push(JSON.stringify(proj));
    const next = JSON.parse(redoStack.pop());
    const idx = projects.findIndex(p => p.id === currentProjectId);
    if (idx !== -1) projects[idx] = next;
    saveProjects();
    refreshWorkspaceUI();
    updateHistoryButtons();
    showToast('操作をやり直しました');
}

function updateHistoryButtons() {
    const uBtn = document.getElementById('btn-undo');
    const rBtn = document.getElementById('btn-redo');
    if (uBtn) uBtn.disabled = undoStack.length === 0;
    if (rBtn) rBtn.disabled = redoStack.length === 0;
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!currentProjectId) return;
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
        }
    });
}

// ==========================================
// HOME VIEW（プロジェクト一覧・作成・編集・削除）
// ==========================================
function renderHomeView() {
    const grid = document.getElementById('project-grid');
    const countEl = document.getElementById('project-count');
    countEl.textContent = `${projects.length} PROJECT${projects.length === 1 ? '' : 'S'}`;

    if (projects.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-16 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-cyber-border bg-white/50 dark:bg-cyber-panel/50">
                <i data-lucide="sparkles" class="w-10 h-10 mx-auto text-purple-400 mb-3"></i>
                <p class="font-bold text-sm">まだ物語プロジェクトがありません</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">右上の「新しい物語を作成」からプロットを始めましょう</p>
                <button onclick="openProjectModal()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white text-xs font-bold">最初の物語をつくる</button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    grid.innerHTML = projects.map(p => {
        const dateStr = new Date(p.updatedAt || Date.now()).toLocaleDateString('ja-JP');
        const noteCount = (p.notes || []).length;
        const charCount = (p.characters || []).length;
        return `
            <div onclick="openProject('${p.id}')" class="group relative rounded-2xl bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border hover:border-purple-400 dark:hover:border-purple-400 p-5 shadow-sm hover:shadow-xl transition cursor-pointer flex flex-col justify-between">
                <div>
                    <div class="flex items-start justify-between gap-2 mb-3">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500/15 via-purple-500/15 to-indigo-500/15 border border-purple-400/30 flex items-center justify-center text-purple-500 dark:text-purple-300">
                            <i data-lucide="folder-open" class="w-5 h-5"></i>
                        </div>
                        <div class="flex items-center gap-1" onclick="event.stopPropagation()">
                            <button onclick="openProjectModal('${p.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-cyber-card text-slate-400 hover:text-purple-400 transition" title="タイトル・メモを編集">
                                <i data-lucide="pencil" class="w-4 h-4"></i>
                            </button>
                            <button onclick="deleteProject('${p.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-500 transition" title="削除">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                    <h3 class="font-bold text-base mb-1.5 group-hover:text-purple-500 dark:group-hover:text-purple-300 transition line-clamp-1">${escapeHtml(p.title)}</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2.5em]">${escapeHtml(p.memo || 'メモなし')}</p>
                </div>

                <div class="mt-4 pt-3 border-t border-slate-100 dark:border-cyber-border flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <div class="flex items-center gap-3">
                        <span>付箋: ${noteCount}</span>
                        <span>キャラ: ${charCount}</span>
                    </div>
                    <span>${dateStr}</span>
                </div>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

function openProjectModal(editId = null) {
    const modal = document.getElementById('project-modal');
    const titleEl = document.getElementById('project-modal-title');
    const idInput = document.getElementById('edit-project-id');
    const titleInput = document.getElementById('input-project-title');
    const memoInput = document.getElementById('input-project-memo');

    if (editId) {
        const proj = projects.find(p => p.id === editId);
        if (!proj) return;
        titleEl.innerHTML = `<i data-lucide="pencil" class="w-5 h-5 text-purple-400"></i><span>物語の情報を編集</span>`;
        idInput.value = proj.id;
        titleInput.value = proj.title;
        memoInput.value = proj.memo || '';
    } else {
        titleEl.innerHTML = `<i data-lucide="folder-plus" class="w-5 h-5 text-purple-400"></i><span>新しい物語を作成</span>`;
        idInput.value = '';
        titleInput.value = '';
        memoInput.value = '';
    }

    modal.classList.remove('hidden');
    lucide.createIcons();
    setTimeout(() => titleInput.focus(), 50);
}

function closeProjectModal() {
    document.getElementById('project-modal').classList.add('hidden');
}

function saveProjectModal() {
    const editId = document.getElementById('edit-project-id').value;
    const title = document.getElementById('input-project-title').value.trim() || '無題の物語';
    const memo = document.getElementById('input-project-memo').value.trim();

    if (editId) {
        const proj = projects.find(p => p.id === editId);
        if (proj) {
            if (currentProjectId === editId) pushHistory();
            proj.title = title;
            proj.memo = memo;
            proj.updatedAt = Date.now();
            saveProjects();
            if (currentProjectId === editId) {
                document.getElementById('workspace-title').textContent = proj.title;
            }
            renderHomeView();
            showToast('物語情報を更新しました');
        }
    } else {
        const newProj = createDefaultProject(title, memo);
        projects.unshift(newProj);
        saveProjects();
        renderHomeView();
        openProject(newProj.id);
        showToast('新しい物語を作成しました');
    }
    closeProjectModal();
}

function deleteProject(id) {
    if (!confirm('この物語プロジェクトを削除しますか？')) return;
    projects = projects.filter(p => p.id !== id);
    saveProjects();
    renderHomeView();
    showToast('プロジェクトを削除しました');
}

// ==========================================
// WORKSPACE 遷移・全体更新
// ==========================================
function openProject(id) {
    currentProjectId = id;
    const proj = getCurrentProject();
    if (!proj) return;

    // データ後方互換補完
    if (!proj.template) proj.template = { P: '', S: '', L: '', O: '', C: '' };
    if (!proj.outlineColor) proj.outlineColor = '#6366f1';
    if (!proj.stages) proj.stages = [];
    if (!proj.characters) proj.characters = [];
    if (!proj.notes) proj.notes = [];
    if (!proj.connections) proj.connections = [];

    undoStack = [];
    redoStack = [];
    selectedNoteIds.clear();
    activeDrawer = null;
    activeCharacterId = null;

    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('workspace-view').classList.remove('hidden');
    document.getElementById('workspace-title').textContent = proj.title;
    document.getElementById('drawer-panel').classList.add('hidden');
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));

    setCanvasMode('move');
    resetViewport(false);
    refreshWorkspaceUI();
    updateHistoryButtons();
}

function goHome() {
    autoSaveTemplateIfOpen();
    currentProjectId = null;
    activeDrawer = null;
    document.getElementById('workspace-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    renderHomeView();
}

function refreshWorkspaceUI() {
    renderCanvasNotes();
    renderConnections();
    updateGraphTargetOptions();
    renderEmotionGraph();
    if (activeDrawer) {
        renderDrawerContent();
    }
}

// ==========================================
// 左サイドバー・ドロワー制御
// ==========================================
function toggleDrawer(type) {
    autoSaveTemplateIfOpen();

    if (activeDrawer === type) {
        closeDrawer();
        return;
    }

    activeDrawer = type;
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('nav-' + type);
    if (btn) btn.classList.add('active');

    document.getElementById('drawer-panel').classList.remove('hidden');
    renderDrawerContent();
}

function closeDrawer() {
    autoSaveTemplateIfOpen();
    activeDrawer = null;
    document.getElementById('drawer-panel').classList.add('hidden');
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
}

function autoSaveTemplateIfOpen() {
    if (activeDrawer !== 'template') return;
    const proj = getCurrentProject();
    if (!proj) return;
    const pEl = document.getElementById('tpl-P');
    if (!pEl) return;
    proj.template = {
        P: document.getElementById('tpl-P').value,
        S: document.getElementById('tpl-S').value,
        L: document.getElementById('tpl-L').value,
        O: document.getElementById('tpl-O').value,
        C: document.getElementById('tpl-C').value
    };
    proj.updatedAt = Date.now();
    saveProjects();
}

function renderDrawerContent() {
    const titleEl = document.getElementById('drawer-title');
    const contentEl = document.getElementById('drawer-content');
    const proj = getCurrentProject();
    if (!proj) return;

    if (activeDrawer === 'template') {
        titleEl.innerHTML = `<i data-lucide="layout-template" class="w-4 h-4 text-emerald-400"></i><span>簡易テンプレート (PSLOC)</span>`;
        const t = proj.template || { P: '', S: '', L: '', O: '', C: '' };
        contentEl.innerHTML = `
            <p class="text-[11px] text-slate-500 dark:text-slate-400">物語の核となる5要素を整理します（入力内容は自動で保存されます）。</p>
            <div class="space-y-3">
                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border">
                    <label class="block text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">P：主人公（Protagonist）</label>
                    <textarea id="tpl-P" rows="2" oninput="onTemplateInput()" placeholder="誰の物語か？" class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(t.P)}</textarea>
                </div>

                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border">
                    <label class="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1">S：舞台（Setting）</label>
                    <textarea id="tpl-S" rows="2" oninput="onTemplateInput()" placeholder="いつ・どこで起きる物語か？" class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(t.S)}</textarea>
                </div>

                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border">
                    <div class="flex items-center justify-between mb-1">
                        <label class="text-xs font-bold text-pink-600 dark:text-pink-400">L：欠落（Lack）</label>
                        <button onclick="showPslocHelp('L')" class="w-5 h-5 rounded-full bg-pink-500/15 text-pink-500 dark:text-pink-300 font-bold text-[11px] flex items-center justify-center hover:bg-pink-500/25" title="Lの解説を表示">？</button>
                    </div>
                    <textarea id="tpl-L" rows="2" oninput="onTemplateInput()" placeholder="主人公に欠けているもの・葛藤の源泉" class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(t.L)}</textarea>
                </div>

                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border">
                    <div class="flex items-center justify-between mb-1">
                        <label class="text-xs font-bold text-amber-600 dark:text-amber-400">O：障害（Obstacle）</label>
                        <button onclick="showPslocHelp('O')" class="w-5 h-5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 font-bold text-[11px] flex items-center justify-center hover:bg-amber-500/25" title="Oの解説を表示">？</button>
                    </div>
                    <textarea id="tpl-O" rows="2" oninput="onTemplateInput()" placeholder="立ちはだかる壁・敵・問題" class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(t.O)}</textarea>
                </div>

                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border">
                    <div class="flex items-center justify-between mb-1">
                        <label class="text-xs font-bold text-purple-600 dark:text-purple-400">C：変化（Change）</label>
                        <button onclick="showPslocHelp('C')" class="w-5 h-5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 font-bold text-[11px] flex items-center justify-center hover:bg-purple-500/25" title="Cの解説を表示">？</button>
                    </div>
                    <textarea id="tpl-C" rows="2" oninput="onTemplateInput()" placeholder="最初と最後でどう変わるか？" class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(t.C)}</textarea>
                </div>
            </div>
        `;
    } else if (activeDrawer === 'stage') {
        titleEl.innerHTML = `<i data-lucide="globe" class="w-4 h-4 text-indigo-400"></i><span>舞台設定</span>`;
        contentEl.innerHTML = `
            <div class="flex items-center justify-between">
                <p class="text-xs text-slate-500 dark:text-slate-400">世界観・時代・ルールを自由に追加</p>
                <button onclick="addStageItem()" class="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-400/30 text-xs font-bold flex items-center gap-1 hover:bg-indigo-500/25">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>枠を追加
                </button>
            </div>
            <div class="space-y-3">
                ${proj.stages.map(s => `
                    <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border space-y-2">
                        <div class="flex items-center gap-2">
                            <input type="text" value="${escapeHtml(s.title)}" onchange="updateStageItem('${s.id}', 'title', this.value)" placeholder="項目名（例：魔法体系）" class="flex-1 bg-transparent font-bold text-xs border-b border-slate-200 dark:border-cyber-border pb-1 focus:outline-none focus:border-indigo-400">
                            <button onclick="deleteStageItem('${s.id}')" class="text-slate-400 hover:text-rose-500 p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                        </div>
                        <textarea rows="3" onchange="updateStageItem('${s.id}', 'content', this.value)" placeholder="詳細を記述..." class="w-full bg-transparent text-xs focus:outline-none resize-none">${escapeHtml(s.content)}</textarea>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (activeDrawer === 'characters') {
        renderCharacterDrawer(titleEl, contentEl, proj);
    } else if (activeDrawer === 'notes') {
        renderNotesDrawer(titleEl, contentEl, proj);
    } else if (activeDrawer === 'connect') {
        renderConnectDrawer(titleEl, contentEl, proj);
    } else if (activeDrawer === 'pdf') {
        renderPdfDrawer(titleEl, contentEl, proj);
    }

    lucide.createIcons();
}

function onTemplateInput() {
    autoSaveTemplateIfOpen();
}

function showPslocHelp(key) {
    const def = PSLOC_DEFINITIONS[key];
    if (!def) return;
    document.getElementById('psloc-help-title').textContent = def.title;
    document.getElementById('psloc-help-body').textContent = def.body;
    document.getElementById('psloc-help-modal').classList.remove('hidden');
}

// ==========================================
// 舞台設定 CRUD
// ==========================================
function addStageItem() {
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();
    proj.stages.push({
        id: 'stg_' + Date.now(),
        title: '新しい舞台項目',
        content: ''
    });
    saveProjects();
    renderDrawerContent();
}

function updateStageItem(id, field, val) {
    const proj = getCurrentProject();
    if (!proj) return;
    const item = proj.stages.find(s => s.id === id);
    if (!item) return;
    pushHistory();
    item[field] = val;
    saveProjects();
}

function deleteStageItem(id) {
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();
    proj.stages = proj.stages.filter(s => s.id !== id);
    saveProjects();
    renderDrawerContent();
}

// ==========================================
// キャラクター設定（画像・No.・7項目・カラー適用＆重複禁止）
// ==========================================
function renderCharacterDrawer(titleEl, contentEl, proj) {
    titleEl.innerHTML = `<i data-lucide="users" class="w-4 h-4 text-pink-400"></i><span>キャラクター設定</span>`;

    if (activeCharacterId) {
        const char = proj.characters.find(c => c.id === activeCharacterId);
        if (!char) {
            activeCharacterId = null;
            renderDrawerContent();
            return;
        }

        const usedColors = getUsedColorsExcept(proj, char.id);
        const pendingColor = char._pendingColor || char.color;

        contentEl.innerHTML = `
            <button onclick="activeCharacterId = null; renderDrawerContent();" class="text-xs font-bold text-purple-500 dark:text-purple-300 flex items-center gap-1 hover:underline">
                <i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>キャラフォルダ一覧へ戻る
            </button>

            <!-- キャラ画像 & ナンバー -->
            <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border flex items-center gap-3">
                <div class="w-16 h-16 rounded-xl bg-slate-200 dark:bg-cyber-panel border border-slate-300 dark:border-cyber-border overflow-hidden flex items-center justify-center shrink-0">
                    ${char.image
                        ? `<img src="${char.image}" class="w-full h-full object-cover">`
                        : `<i data-lucide="user" class="w-7 h-7 text-slate-400"></i>`
                    }
                </div>
                <div class="flex-1 space-y-2">
                    <div class="flex items-center gap-2">
                        <label class="text-[11px] font-bold text-slate-500">キャラNo.</label>
                        <input type="number" min="1" value="${char.number || 1}" onchange="updateCharacterMeta('${char.id}', 'number', parseInt(this.value) || 1)" class="w-16 px-2 py-1 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border text-xs font-mono">
                    </div>
                    <div class="flex items-center gap-1.5">
                        <label class="px-2.5 py-1 rounded-lg bg-pink-500/15 text-pink-600 dark:text-pink-300 text-[11px] font-bold cursor-pointer hover:bg-pink-500/25">
                            画像を選択
                            <input type="file" accept="image/*" class="hidden" onchange="handleCharacterImageUpload(event, '${char.id}')">
                        </label>
                        ${char.image ? `<button onclick="removeCharacterImage('${char.id}')" class="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-rose-500">削除</button>` : ''}
                    </div>
                </div>
            </div>

            <!-- テーマカラー設定（重複不可 ＋ この色を適用） -->
            <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border space-y-2.5">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold">テーマカラー設定</span>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded text-white" style="background:${pendingColor}">選択中</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <!-- 左端：自由カラーピッカー -->
                    <label class="w-7 h-7 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center cursor-pointer overflow-hidden relative" title="自由な色を選択">
                        <input type="color" value="${pendingColor}" onchange="selectPendingCharacterColor('${char.id}', this.value)" class="opacity-0 absolute inset-0 w-full h-full cursor-pointer">
                        <i data-lucide="pipette" class="w-3.5 h-3.5 text-slate-500"></i>
                    </label>
                    ${COLOR_PALETTE.map(c => {
                        const isUsed = usedColors.includes(c.toLowerCase());
                        const isSelected = pendingColor.toLowerCase() === c.toLowerCase();
                        return `
                            <button type="button"
                                ${isUsed ? 'disabled' : `onclick="selectPendingCharacterColor('${char.id}', '${c}')"`}
                                class="w-7 h-7 rounded-lg transition relative ${isUsed ? 'opacity-20 cursor-not-allowed' : 'hover:scale-110'} ${isSelected ? 'ring-2 ring-offset-2 ring-purple-500 dark:ring-offset-cyber-card' : ''}"
                                style="background:${c}"
                                title="${isUsed ? '他のキャラまたは大筋で使用中' : c}">
                                ${isUsed ? '<span class="text-[10px] text-white font-bold">×</span>' : ''}
                            </button>
                        `;
                    }).join('')}
                </div>
                <button onclick="applyCharacterColor('${char.id}')" class="w-full py-2 rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-bold shadow-sm hover:opacity-95">
                    この色を適用
                </button>
            </div>

            <!-- プロフィール項目（デフォルト7項目＋追加・削除可） -->
            <div class="space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold">プロフィール項目</span>
                    <button onclick="addCharacterField('${char.id}')" class="px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 text-[11px] font-bold flex items-center gap-1">
                        <i data-lucide="plus" class="w-3 h-3"></i>項目追加
                    </button>
                </div>
                ${char.fields.map((f, idx) => `
                    <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border space-y-1">
                        <div class="flex items-center justify-between gap-2">
                            <input type="text" value="${escapeHtml(f.label)}" onchange="updateCharacterField('${char.id}', ${idx}, 'label', this.value)" class="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-transparent focus:outline-none">
                            <button onclick="deleteCharacterField('${char.id}', ${idx})" class="text-slate-400 hover:text-rose-500"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
                        </div>
                        <input type="text" value="${escapeHtml(f.value)}" onchange="updateCharacterField('${char.id}', ${idx}, 'value', this.value)" placeholder="未入力" class="w-full text-xs bg-transparent focus:outline-none">
                    </div>
                `).join('')}
            </div>

            <button onclick="deleteCharacter('${char.id}')" class="w-full py-2 rounded-xl border border-rose-500/40 text-rose-500 text-xs font-bold hover:bg-rose-500/10">
                このキャラクターを削除
            </button>
        `;
        return;
    }

    // キャラフォルダ一覧
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
    contentEl.innerHTML = `
        <div class="flex items-center justify-between">
            <p class="text-xs text-slate-500 dark:text-slate-400">登場人物フォルダ管理</p>
            <button onclick="addCharacter()" class="px-3 py-1.5 rounded-lg bg-pink-500/15 text-pink-600 dark:text-pink-300 border border-pink-400/30 text-xs font-bold flex items-center gap-1 hover:bg-pink-500/25">
                <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>キャラ追加
            </button>
        </div>

        <div class="space-y-2.5">
            ${sortedChars.length === 0 ? `<p class="text-xs text-center py-8 text-slate-400">キャラクターがまだ登録されていません</p>` : ''}
            ${sortedChars.map(c => {
                const nameField = c.fields.find(f => f.label === 'キャラ名');
                const dispName = (nameField && nameField.value) ? nameField.value : '名称未設定キャラ';
                return `
                    <div onclick="activeCharacterId = '${c.id}'; renderDrawerContent();" class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border hover:border-pink-400 cursor-pointer flex items-center gap-3 transition">
                        <div class="w-11 h-11 rounded-xl overflow-hidden bg-slate-200 dark:bg-cyber-panel flex items-center justify-center shrink-0 border-2" style="border-color:${c.color}">
                            ${c.image
                                ? `<img src="${c.image}" class="w-full h-full object-cover">`
                                : `<i data-lucide="user" class="w-5 h-5" style="color:${c.color}"></i>`
                            }
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded text-white font-bold" style="background:${c.color}">No.${c.number || '-'}</span>
                                <span class="font-bold text-xs truncate">${escapeHtml(dispName)}</span>
                            </div>
                            <p class="text-[11px] text-slate-400 truncate mt-0.5">${c.fields.slice(1, 4).map(f => f.value).filter(Boolean).join(' / ') || 'タップして詳細編集'}</p>
                        </div>
                        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function getUsedColorsExcept(proj, excludeCharId = null) {
    const used = [];
    if (excludeCharId !== 'outline' && proj.outlineColor) {
        used.push(proj.outlineColor.toLowerCase());
    }
    proj.characters.forEach(c => {
        if (c.id !== excludeCharId && c.color) {
            used.push(c.color.toLowerCase());
        }
    });
    return used;
}

function addCharacter() {
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();

    const used = getUsedColorsExcept(proj, null);
    const availableColor = COLOR_PALETTE.find(c => !used.includes(c.toLowerCase())) || '#ec4899';
    const nextNo = proj.characters.length + 1;

    const newChar = {
        id: 'char_' + Date.now(),
        number: nextNo,
        color: availableColor,
        image: '',
        fields: [
            { label: 'キャラ名', value: '' },
            { label: '性別', value: '' },
            { label: '種族', value: '' },
            { label: '年齢', value: '' },
            { label: '身長', value: '' },
            { label: '職業', value: '' },
            { label: '特徴', value: '' }
        ]
    };
    proj.characters.push(newChar);
    activeCharacterId = newChar.id;
    saveProjects();
    refreshWorkspaceUI();
}

function updateCharacterMeta(charId, field, val) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    pushHistory();
    char[field] = val;
    saveProjects();
    refreshWorkspaceUI();
}

function handleCharacterImageUpload(event, charId) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 240;
            let w = img.width;
            let h = img.height;
            if (w > h && w > maxDim) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
            } else if (h >= w && h > maxDim) {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

            const proj = getCurrentProject();
            const char = proj?.characters.find(c => c.id === charId);
            if (!char) return;
            pushHistory();
            char.image = dataUrl;
            saveProjects();
            renderDrawerContent();
            showToast('キャラクター画像を設定しました');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeCharacterImage(charId) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    pushHistory();
    char.image = '';
    saveProjects();
    renderDrawerContent();
}

function selectPendingCharacterColor(charId, color) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    const used = getUsedColorsExcept(proj, charId);
    if (used.includes(color.toLowerCase())) {
        showToast('この色は他のキャラまたは大筋で使用中です');
        return;
    }
    char._pendingColor = color;
    renderDrawerContent();
}

function applyCharacterColor(charId) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    const targetColor = char._pendingColor || char.color;
    const used = getUsedColorsExcept(proj, charId);
    if (used.includes(targetColor.toLowerCase())) {
        showToast('この色は既に使用されているため適用できません');
        return;
    }
    pushHistory();
    char.color = targetColor;
    delete char._pendingColor;
    saveProjects();
    refreshWorkspaceUI();
    showToast('キャラクターカラーを適用しました');
}

function addCharacterField(charId) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    pushHistory();
    char.fields.push({ label: '追加項目', value: '' });
    saveProjects();
    renderDrawerContent();
}

function updateCharacterField(charId, idx, key, val) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char || !char.fields[idx]) return;
    pushHistory();
    char.fields[idx][key] = val;
    saveProjects();
    refreshWorkspaceUI();
}

function deleteCharacterField(charId, idx) {
    const proj = getCurrentProject();
    const char = proj?.characters.find(c => c.id === charId);
    if (!char) return;
    pushHistory();
    char.fields.splice(idx, 1);
    saveProjects();
    renderDrawerContent();
}

function deleteCharacter(charId) {
    if (!confirm('このキャラクターを削除しますか？（関連付箋は大筋へ移行します）')) return;
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();
    proj.characters = proj.characters.filter(c => c.id !== charId);
    proj.notes.forEach(n => {
        if (n.targetId === charId) n.targetId = 'outline';
    });
    activeCharacterId = null;
    saveProjects();
    refreshWorkspaceUI();
    showToast('キャラクターを削除しました');
}

// ==========================================
// 付箋作成・大筋カラー設定・付箋フォルダ管理
// ==========================================
function renderNotesDrawer(titleEl, contentEl, proj) {
    titleEl.innerHTML = `<i data-lucide="sticky-note" class="w-4 h-4 text-amber-400"></i><span>付箋作成 & フォルダ一覧</span>`;

    const usedByChars = getUsedColorsExcept(proj, 'outline');
    const pendingOutline = proj._pendingOutlineColor || proj.outlineColor || '#6366f1';
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));

    // フィルタ済み付箋リスト
    const filteredNotes = proj.notes
        .filter(n => noteFolderFilter === 'all' || n.targetId === noteFolderFilter)
        .sort((a, b) => (a.number || 0) - (b.number || 0));

    contentEl.innerHTML = `
        <!-- 大筋付箋の共通カラー設定 -->
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border space-y-2">
            <div class="flex items-center justify-between">
                <span class="text-xs font-bold">大筋付箋の共通カラー</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded text-white" style="background:${pendingOutline}">大筋</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
                <label class="w-6 h-6 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center cursor-pointer overflow-hidden relative" title="自由な色を選択">
                    <input type="color" value="${pendingOutline}" onchange="selectPendingOutlineColor(this.value)" class="opacity-0 absolute inset-0 w-full h-full cursor-pointer">
                    <i data-lucide="pipette" class="w-3 h-3 text-slate-500"></i>
                </label>
                ${COLOR_PALETTE.map(c => {
                    const isUsed = usedByChars.includes(c.toLowerCase());
                    const isSelected = pendingOutline.toLowerCase() === c.toLowerCase();
                    return `
                        <button type="button"
                            ${isUsed ? 'disabled' : `onclick="selectPendingOutlineColor('${c}')"`}
                            class="w-6 h-6 rounded-lg transition ${isUsed ? 'opacity-20 cursor-not-allowed' : 'hover:scale-110'} ${isSelected ? 'ring-2 ring-offset-1 ring-purple-500 dark:ring-offset-cyber-card' : ''}"
                            style="background:${c}">
                        </button>
                    `;
                }).join('')}
            </div>
            <button onclick="applyOutlineColor()" class="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:opacity-95">
                この色を適用
            </button>
        </div>

        <!-- 新しい付箋を作成（色選択なし・対象色を自動適用） -->
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border space-y-2.5">
            <h4 class="text-xs font-bold flex items-center gap-1.5">
                <i data-lucide="plus-circle" class="w-3.5 h-3.5 text-amber-400"></i>
                <span>新しい付箋を作成</span>
            </h4>
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 mb-0.5">番号</label>
                    <input id="new-note-number" type="number" min="1" value="${proj.notes.length + 1}" class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border text-xs font-mono">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 mb-0.5">対象種類</label>
                    <select id="new-note-target" class="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border text-xs">
                        <option value="outline">大筋（メイン）</option>
                        ${sortedChars.map(c => {
                            const name = c.fields.find(f => f.label === 'キャラ名')?.value || `キャラNo.${c.number}`;
                            return `<option value="${c.id}">No.${c.number} ${escapeHtml(name)}</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>
            <input id="new-note-title" type="text" placeholder="シーン見出し（例：運命の出会い）" class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border text-xs">
            <textarea id="new-note-content" rows="2" placeholder="出来事や感情の詳細..." class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border text-xs resize-none"></textarea>
            <div>
                <div class="flex justify-between text-[10px] font-bold mb-0.5">
                    <span class="text-slate-400">エモーションレベル</span>
                    <span id="new-note-emo-disp" class="font-mono text-pink-500">0</span>
                </div>
                <input id="new-note-emotion" type="range" min="-10" max="10" value="0" oninput="document.getElementById('new-note-emo-disp').textContent = this.value" class="w-full accent-pink-500">
            </div>
            <button onclick="createNewNote()" class="w-full py-2 rounded-xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white text-xs font-bold shadow-sm hover:opacity-95">
                白紙に付箋を追加
            </button>
        </div>

        <!-- 付箋フォルダ（種類別一覧・出し入れ・編集） -->
        <div class="space-y-2">
            <div class="flex items-center justify-between">
                <span class="text-xs font-bold">付箋フォルダ（種類別一覧）</span>
                <span class="text-[10px] font-mono text-slate-400">${filteredNotes.length}枚</span>
            </div>

            <!-- 種類別フィルタタブ -->
            <div class="flex items-center gap-1 overflow-x-auto pb-1">
                <button onclick="noteFolderFilter='all'; renderDrawerContent();" class="px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${noteFolderFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-cyber-card text-slate-500'}">すべて</button>
                <button onclick="noteFolderFilter='outline'; renderDrawerContent();" class="px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${noteFolderFilter === 'outline' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-cyber-card text-slate-500'}">大筋</button>
                ${sortedChars.map(c => {
                    const name = c.fields.find(f => f.label === 'キャラ名')?.value || `No.${c.number}`;
                    return `<button onclick="noteFolderFilter='${c.id}'; renderDrawerContent();" class="px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${noteFolderFilter === c.id ? 'text-white' : 'bg-slate-100 dark:bg-cyber-card text-slate-500'}" style="${noteFolderFilter === c.id ? `background:${c.color}` : ''}">${escapeHtml(name)}</button>`;
                }).join('')}
            </div>

            <div class="space-y-2">
                ${filteredNotes.length === 0 ? `<p class="text-[11px] text-center py-4 text-slate-400">該当する付箋がありません</p>` : ''}
                ${filteredNotes.map(n => {
                    const color = getNoteColor(proj, n);
                    const targetLabel = getTargetLabel(proj, n.targetId);
                    return `
                        <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border flex items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1.5 mb-1">
                                    <span class="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold text-white" style="background:${color}">#${n.number}</span>
                                    <span class="text-[10px] font-bold truncate" style="color:${color}">${escapeHtml(targetLabel)}</span>
                                    ${n.hidden ? `<span class="text-[9px] px-1.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500">収納中</span>` : ''}
                                </div>
                                <p class="text-xs font-bold truncate">${escapeHtml(n.title || '無題の付箋')}</p>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                <button onclick="openNoteEditModal('${n.id}')" class="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-purple-400" title="編集">
                                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                                </button>
                                <button onclick="toggleNoteVisibility('${n.id}')" class="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-400" title="${n.hidden ? '白紙に出す' : 'フォルダにしまう'}">
                                    <i data-lucide="${n.hidden ? 'eye' : 'eye-off'}" class="w-3.5 h-3.5"></i>
                                </button>
                                <button onclick="deleteNote('${n.id}')" class="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950 text-slate-400 hover:text-rose-500" title="削除">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function selectPendingOutlineColor(color) {
    const proj = getCurrentProject();
    if (!proj) return;
    const used = getUsedColorsExcept(proj, 'outline');
    if (used.includes(color.toLowerCase())) {
        showToast('この色はキャラクターで使用中のため選べません');
        return;
    }
    proj._pendingOutlineColor = color;
    renderDrawerContent();
}

function applyOutlineColor() {
    const proj = getCurrentProject();
    if (!proj) return;
    const targetColor = proj._pendingOutlineColor || proj.outlineColor;
    const used = getUsedColorsExcept(proj, 'outline');
    if (used.includes(targetColor.toLowerCase())) {
        showToast('キャラクターと重複しているため適用できません');
        return;
    }
    pushHistory();
    proj.outlineColor = targetColor;
    delete proj._pendingOutlineColor;
    saveProjects();
    refreshWorkspaceUI();
    showToast('大筋付箋のカラーを適用しました');
}

function createNewNote() {
    const proj = getCurrentProject();
    if (!proj) return;

    const num = parseInt(document.getElementById('new-note-number').value) || (proj.notes.length + 1);
    const targetId = document.getElementById('new-note-target').value;
    const title = document.getElementById('new-note-title').value.trim() || `シーン ${num}`;
    const content = document.getElementById('new-note-content').value.trim();
    const emotion = parseInt(document.getElementById('new-note-emotion').value) || 0;

    // 現在のビューポート中央付近に配置
    const area = document.getElementById('canvas-area');
    const centerX = (-viewX + area.clientWidth / 2) / viewScale - 105 + (Math.random() * 40 - 20);
    const centerY = (-viewY + area.clientHeight / 2) / viewScale - 60 + (Math.random() * 40 - 20);

    pushHistory();
    proj.notes.push({
        id: 'note_' + Date.now(),
        number: num,
        targetId,
        title,
        content,
        emotion,
        x: Math.max(100, Math.min(5700, Math.round(centerX))),
        y: Math.max(100, Math.min(5700, Math.round(centerY))),
        hidden: false
    });

    saveProjects();
    refreshWorkspaceUI();
    showToast('付箋を白紙に追加しました');
}

function toggleNoteVisibility(noteId) {
    const proj = getCurrentProject();
    const note = proj?.notes.find(n => n.id === noteId);
    if (!note) return;
    pushHistory();
    note.hidden = !note.hidden;
    saveProjects();
    refreshWorkspaceUI();
}

function deleteNote(noteId) {
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();
    proj.notes = proj.notes.filter(n => n.id !== noteId);
    proj.connections = proj.connections.filter(c => c.from !== noteId && c.to !== noteId);
    selectedNoteIds.delete(noteId);
    saveProjects();
    refreshWorkspaceUI();
    showToast('付箋を削除しました');
}

// 付箋編集モーダル
function openNoteEditModal(noteId) {
    const proj = getCurrentProject();
    const note = proj?.notes.find(n => n.id === noteId);
    if (!note) return;

    const targetSelect = document.getElementById('edit-note-target');
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
    targetSelect.innerHTML = `
        <option value="outline">大筋（メイン）</option>
        ${sortedChars.map(c => {
            const name = c.fields.find(f => f.label === 'キャラ名')?.value || `No.${c.number}`;
            return `<option value="${c.id}">No.${c.number} ${escapeHtml(name)}</option>`;
        }).join('')}
    `;

    document.getElementById('edit-note-id').value = note.id;
    document.getElementById('edit-note-number').value = note.number;
    targetSelect.value = note.targetId;
    document.getElementById('edit-note-title').value = note.title;
    document.getElementById('edit-note-content').value = note.content || '';
    document.getElementById('edit-note-emotion').value = note.emotion || 0;
    document.getElementById('edit-note-emotion-val').textContent = note.emotion || 0;

    document.getElementById('note-edit-modal').classList.remove('hidden');
}

function closeNoteEditModal() {
    document.getElementById('note-edit-modal').classList.add('hidden');
}

function saveNoteEdit() {
    const proj = getCurrentProject();
    const noteId = document.getElementById('edit-note-id').value;
    const note = proj?.notes.find(n => n.id === noteId);
    if (!note) return;

    pushHistory();
    note.number = parseInt(document.getElementById('edit-note-number').value) || 1;
    note.targetId = document.getElementById('edit-note-target').value;
    note.title = document.getElementById('edit-note-title').value.trim() || `シーン ${note.number}`;
    note.content = document.getElementById('edit-note-content').value.trim();
    note.emotion = parseInt(document.getElementById('edit-note-emotion').value) || 0;

    // 種類が変わった場合、異なる種類の接続線を自動整理
    proj.connections = proj.connections.filter(conn => {
        const n1 = proj.notes.find(x => x.id === conn.from);
        const n2 = proj.notes.find(x => x.id === conn.to);
        return n1 && n2 && n1.targetId === n2.targetId;
    });

    saveProjects();
    closeNoteEditModal();
    refreshWorkspaceUI();
    showToast('付箋を更新しました');
}

// ==========================================
// 付箋つなぎ（同種のみ接続可能）
// ==========================================
function renderConnectDrawer(titleEl, contentEl, proj) {
    titleEl.innerHTML = `<i data-lucide="git-commit-horizontal" class="w-4 h-4 text-purple-400"></i><span>付箋つなぎ</span>`;

    contentEl.innerHTML = `
        <div class="p-3.5 rounded-xl bg-purple-500/10 border border-purple-400/30 space-y-2.5">
            <p class="text-xs leading-relaxed">白紙上の付箋を2枚順番にタップすると、流れを示すラインで結びます。<br><strong class="text-purple-500 dark:text-purple-300">※同じ種類（大筋同士、または同じキャラクター同士）のみ接続できます。</strong></p>
            <button onclick="startConnectMode()" class="w-full py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold shadow-sm">
                白紙で付箋をつなぐモードを開始
            </button>
        </div>

        <div class="space-y-2">
            <h4 class="text-xs font-bold">現在の接続一覧（${proj.connections.length}本）</h4>
            ${proj.connections.length === 0 ? `<p class="text-[11px] text-slate-400 py-4 text-center">まだ接続線がありません</p>` : ''}
            ${proj.connections.map((conn, idx) => {
                const n1 = proj.notes.find(n => n.id === conn.from);
                const n2 = proj.notes.find(n => n.id === conn.to);
                if (!n1 || !n2) return '';
                const color = getNoteColor(proj, n1);
                return `
                    <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border flex items-center justify-between gap-2 text-xs">
                        <div class="truncate flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full shrink-0" style="background:${color}"></span>
                            <span class="font-mono font-bold">#${n1.number}</span>
                            <span class="truncate">${escapeHtml(n1.title)}</span>
                            <span class="text-slate-400">→</span>
                            <span class="font-mono font-bold">#${n2.number}</span>
                        </div>
                        <button onclick="deleteConnection(${idx})" class="text-slate-400 hover:text-rose-500 p-1 shrink-0" title="接続解除">
                            <i data-lucide="unlink" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function startConnectMode() {
    canvasMode = 'connect';
    connectSourceNoteId = null;
    closeDrawer();
    document.getElementById('connect-banner').classList.remove('hidden');
    document.getElementById('connect-banner-text').textContent = '1枚目の付箋をタップしてください（同じ種類同士のみ接続可能）';
    renderCanvasNotes();
}

function cancelConnectMode() {
    connectSourceNoteId = null;
    document.getElementById('connect-banner').classList.add('hidden');
    setCanvasMode('move');
}

function handleNoteClickInConnectMode(noteId) {
    const proj = getCurrentProject();
    if (!proj) return;
    const clickedNote = proj.notes.find(n => n.id === noteId);
    if (!clickedNote) return;

    if (!connectSourceNoteId) {
        connectSourceNoteId = noteId;
        document.getElementById('connect-banner-text').textContent = `「#${clickedNote.number} ${clickedNote.title}」を選択中 → つなぐ2枚目をタップ`;
        renderCanvasNotes();
        return;
    }

    if (connectSourceNoteId === noteId) {
        connectSourceNoteId = null;
        document.getElementById('connect-banner-text').textContent = '1枚目の付箋をタップしてください';
        renderCanvasNotes();
        return;
    }

    const sourceNote = proj.notes.find(n => n.id === connectSourceNoteId);
    if (!sourceNote) return;

    // 同種チェック
    if (sourceNote.targetId !== clickedNote.targetId) {
        showToast('異なる種類の付箋同士はつなげません（同じ種類のみ可能）');
        return;
    }

    // 重複接続チェック
    const exists = proj.connections.some(c =>
        (c.from === sourceNote.id && c.to === clickedNote.id) ||
        (c.from === clickedNote.id && c.to === sourceNote.id)
    );
    if (exists) {
        showToast('この付箋同士は既に接続されています');
        connectSourceNoteId = null;
        renderCanvasNotes();
        return;
    }

    pushHistory();
    proj.connections.push({
        from: sourceNote.id,
        to: clickedNote.id
    });
    saveProjects();
    connectSourceNoteId = null;
    document.getElementById('connect-banner-text').textContent = '接続しました！続けてつなぐ場合は1枚目をタップ';
    renderCanvasNotes();
    renderConnections();
    showToast('同じ種類の付箋をつなぎました');
}

function deleteConnection(index) {
    const proj = getCurrentProject();
    if (!proj) return;
    pushHistory();
    proj.connections.splice(index, 1);
    saveProjects();
    renderConnections();
    renderDrawerContent();
    showToast('接続を解除しました');
}

// ==========================================
// キャンバス描画・操作（移動・複数選択・ピンチズーム・階層整列）
// ==========================================
function setCanvasMode(mode) {
    canvasMode = mode;
    if (mode !== 'connect') {
        connectSourceNoteId = null;
        document.getElementById('connect-banner').classList.add('hidden');
    }
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('mode-' + mode);
    if (activeBtn) activeBtn.classList.add('active');
}

function clearSelection() {
    selectedNoteIds.clear();
    renderCanvasNotes();
}

function getNoteColor(proj, note) {
    if (note.targetId === 'outline') {
        return proj.outlineColor || '#6366f1';
    }
    const char = proj.characters.find(c => c.id === note.targetId);
    return char ? char.color : '#6366f1';
}

function getTargetLabel(proj, targetId) {
    if (targetId === 'outline') return '大筋';
    const char = proj.characters.find(c => c.id === targetId);
    if (!char) return '大筋';
    const name = char.fields.find(f => f.label === 'キャラ名')?.value;
    return name ? `No.${char.number} ${name}` : `キャラNo.${char.number}`;
}

function renderCanvasNotes() {
    const proj = getCurrentProject();
    const layer = document.getElementById('notes-layer');
    if (!proj || !layer) return;

    const visibleNotes = proj.notes.filter(n => !n.hidden);

    layer.innerHTML = visibleNotes.map(n => {
        const color = getNoteColor(proj, n);
        const label = getTargetLabel(proj, n.targetId);
        const isSelected = selectedNoteIds.has(n.id);
        const isConnectSrc = connectSourceNoteId === n.id;

        return `
            <div data-note-id="${n.id}"
                 style="left:${n.x}px; top:${n.y}px; border-top: 4px solid ${color};"
                 class="sticky-note-card bg-white/95 dark:bg-cyber-card/95 backdrop-blur-md border border-slate-200 dark:border-cyber-border shadow-lg p-3 cursor-grab active:cursor-grabbing ${isSelected ? 'selected' : ''} ${isConnectSrc ? 'connect-source' : ''}">
                <div class="flex items-center justify-between gap-1 mb-1.5">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white shrink-0" style="background:${color}">#${n.number}</span>
                        <span class="text-[10px] font-bold truncate" style="color:${color}">${escapeHtml(label)}</span>
                    </div>
                    <button onpointerdown="event.stopPropagation()" onclick="openNoteEditModal('${n.id}')" class="p-1 rounded hover:bg-slate-100 dark:hover:bg-cyber-panel text-slate-400 hover:text-purple-400 shrink-0" title="編集">
                        <i data-lucide="pencil" class="w-3 h-3"></i>
                    </button>
                </div>
                <h4 class="font-bold text-xs mb-1 line-clamp-2">${escapeHtml(n.title)}</h4>
                ${n.content ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-3 leading-snug mb-2">${escapeHtml(n.content)}</p>` : ''}
                <div class="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-cyber-border/70 text-[10px] font-mono text-slate-400">
                    <span>EMO: <strong class="${n.emotion > 0 ? 'text-pink-500' : (n.emotion < 0 ? 'text-indigo-400' : '')}">${n.emotion > 0 ? '+' + n.emotion : n.emotion}</strong></span>
                    <button onpointerdown="event.stopPropagation()" onclick="toggleNoteVisibility('${n.id}')" class="hover:text-slate-600 dark:hover:text-white" title="フォルダにしまう">収納</button>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

function renderConnections() {
    const proj = getCurrentProject();
    const svg = document.getElementById('connections-svg');
    if (!proj || !svg) return;

    svg.innerHTML = proj.connections.map(conn => {
        const n1 = proj.notes.find(n => n.id === conn.from && !n.hidden);
        const n2 = proj.notes.find(n => n.id === conn.to && !n.hidden);
        if (!n1 || !n2) return '';

        const color = getNoteColor(proj, n1);
        const x1 = n1.x + 105;
        const y1 = n1.y + 55;
        const x2 = n2.x + 105;
        const y2 = n2.y + 55;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2 - 25;

        return `
            <g>
                <path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.85" />
                <circle cx="${x1}" cy="${y1}" r="4.5" fill="${color}" />
                <circle cx="${x2}" cy="${y2}" r="4.5" fill="${color}" />
            </g>
        `;
    }).join('');
}

// ==========================================
// キャンバス Pointer / Touch イベント（ドラッグ固定 & ピンチズーム）
// ==========================================
function setupCanvasEvents() {
    const viewport = document.getElementById('canvas-viewport');

    viewport.addEventListener('pointerdown', (e) => {
        const noteCard = e.target.closest('.sticky-note-card');

        // 付箋カード上での操作
        if (noteCard) {
            e.stopPropagation();
            const noteId = noteCard.dataset.noteId;

            if (canvasMode === 'connect') {
                handleNoteClickInConnectMode(noteId);
                return;
            }

            if (canvasMode === 'select') {
                if (selectedNoteIds.has(noteId)) selectedNoteIds.delete(noteId);
                else selectedNoteIds.add(noteId);
                renderCanvasNotes();
                return;
            }

            // 移動モード：白紙パンをロックして付箋ドラッグ開始
            draggingNoteId = noteId;
            hasDraggedMoved = false;
            dragStartMouseX = e.clientX;
            dragStartMouseY = e.clientY;
            dragInitialPositions.clear();

            const proj = getCurrentProject();
            if (!proj) return;

            if (selectedNoteIds.has(noteId) && selectedNoteIds.size > 1) {
                // 複数選択中の付箋をまとめて移動
                selectedNoteIds.forEach(id => {
                    const n = proj.notes.find(item => item.id === id);
                    if (n) dragInitialPositions.set(id, { x: n.x, y: n.y });
                });
            } else {
                const n = proj.notes.find(item => item.id === noteId);
                if (n) dragInitialPositions.set(noteId, { x: n.x, y: n.y });
            }

            noteCard.setPointerCapture(e.pointerId);
            return;
        }

        // 白紙（何も置かれていない場所）をタップしたとき
        if (selectedNoteIds.size > 0) {
            selectedNoteIds.clear();
            renderCanvasNotes();
        }

        isPanning = true;
        panStartX = e.clientX - viewX;
        panStartY = e.clientY - viewY;
        viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e) => {
        // 付箋ドラッグ中（白紙は絶対に動かさない）
        if (draggingNoteId) {
            const dx = (e.clientX - dragStartMouseX) / viewScale;
            const dy = (e.clientY - dragStartMouseY) / viewScale;

            if (!hasDraggedMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                pushHistory();
                hasDraggedMoved = true;
            }

            if (hasDraggedMoved) {
                const proj = getCurrentProject();
                if (!proj) return;
                dragInitialPositions.forEach((initPos, id) => {
                    const n = proj.notes.find(item => item.id === id);
                    if (n) {
                        n.x = Math.max(20, Math.min(5750, Math.round(initPos.x + dx)));
                        n.y = Math.max(20, Math.min(5750, Math.round(initPos.y + dy)));
                        const el = document.querySelector(`.sticky-note-card[data-note-id="${id}"]`);
                        if (el) {
                            el.style.left = n.x + 'px';
                            el.style.top = n.y + 'px';
                        }
                    }
                });
                renderConnections();
            }
            return;
        }

        // 白紙パン操作
        if (isPanning) {
            viewX = e.clientX - panStartX;
            viewY = e.clientY - panStartY;
            applyViewportTransform();
        }
    });

    const endPointer = () => {
        if (draggingNoteId) {
            if (hasDraggedMoved) {
                saveProjects();
            }
            draggingNoteId = null;
            hasDraggedMoved = false;
        }
        isPanning = false;
    };

    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);

    // PCホイールズーム
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        zoomAtPoint(viewScale + delta, e.clientX, e.clientY);
    }, { passive: false });

    // 2本指ピンチイン・ピンチアウト（iPhone / iPad対応）
    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPanning = false;
            draggingNoteId = null;
            initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1]);
            initialPinchScale = viewScale;
        }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance) {
            e.preventDefault();
            const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
            const scaleFactor = currentDist / initialPinchDistance;
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            zoomAtPoint(initialPinchScale * scaleFactor, midX, midY);
        }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
        initialPinchDistance = null;
    });
}

function getTouchDistance(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function zoomAtPoint(newScale, clientX, clientY) {
    const clamped = Math.max(0.35, Math.min(2.0, newScale));
    const rect = document.getElementById('canvas-viewport').getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const worldX = (px - viewX) / viewScale;
    const worldY = (py - viewY) / viewScale;

    viewScale = clamped;
    viewX = px - worldX * viewScale;
    viewY = py - worldY * viewScale;
    applyViewportTransform();
}

function zoomBy(delta) {
    const viewport = document.getElementById('canvas-viewport');
    const rect = viewport.getBoundingClientRect();
    zoomAtPoint(viewScale + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function applyViewportTransform() {
    const world = document.getElementById('canvas-world');
    if (world) {
        world.style.transform = `translate(${viewX}px, ${viewY}px) scale(${viewScale})`;
    }
    const ind = document.getElementById('zoom-indicator');
    if (ind) {
        ind.textContent = `${Math.round(viewScale * 100)}%`;
    }
}

function resetViewport(notify = true) {
    const proj = getCurrentProject();
    const area = document.getElementById('canvas-area');
    viewScale = 1;

    if (proj && proj.notes.some(n => !n.hidden)) {
        const visible = proj.notes.filter(n => !n.hidden);
        const minX = Math.min(...visible.map(n => n.x));
        const minY = Math.min(...visible.map(n => n.y));
        viewX = -minX + 60;
        viewY = -minY + 80;
    } else {
        viewX = -2500 + (area ? area.clientWidth / 4 : 100);
        viewY = -2500 + (area ? area.clientHeight / 4 : 100);
    }

    applyViewportTransform();
    if (notify) showToast('視点をリセットしました');
}

// ==========================================
// 階層的な番号整列（大筋を最上段、その下にキャラNo.順、左から若い番号順）
// ==========================================
function sortNotesByNumber() {
    const proj = getCurrentProject();
    if (!proj) return;
    const visible = proj.notes.filter(n => !n.hidden);
    if (visible.length === 0) {
        showToast('整列する付箋がありません');
        return;
    }

    pushHistory();

    // 階層順序リスト作成（0: 大筋、1〜: キャラNo.順）
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
    const rowOrder = ['outline', ...sortedChars.map(c => c.id)];

    const startX = 2550;
    const startY = 2550;
    const colGap = 240;
    const rowGap = 185;
    let currentRow = 0;

    rowOrder.forEach(targetId => {
        const groupNotes = visible
            .filter(n => n.targetId === targetId)
            .sort((a, b) => (a.number || 0) - (b.number || 0));

        if (groupNotes.length > 0) {
            groupNotes.forEach((note, colIdx) => {
                note.x = startX + colIdx * colGap;
                note.y = startY + currentRow * rowGap;
            });
            currentRow++;
        }
    });

    saveProjects();
    renderCanvasNotes();
    renderConnections();
    resetViewport(false);
    showToast('大筋を最上段、キャラNo.順に階層整列しました');
}

// ==========================================
// エモーションレベルグラフ（総合 / 単体切替・カスタムX軸）
// ==========================================
function toggleGraphPanel() {
    isGraphVisible = !isGraphVisible;
    const panel = document.getElementById('graph-panel');
    if (isGraphVisible) {
        panel.classList.remove('hidden');
        renderEmotionGraph();
    } else {
        panel.classList.add('hidden');
    }
}

function setGraphMode(mode) {
    graphMode = mode;
    const allBtn = document.getElementById('graph-mode-all');
    const singleBtn = document.getElementById('graph-mode-single');
    const selectEl = document.getElementById('graph-target-select');

    if (mode === 'all') {
        allBtn.classList.add('bg-pink-500', 'text-white');
        singleBtn.classList.remove('bg-pink-500', 'text-white');
        selectEl.classList.add('hidden');
    } else {
        singleBtn.classList.add('bg-pink-500', 'text-white');
        allBtn.classList.remove('bg-pink-500', 'text-white');
        selectEl.classList.remove('hidden');
    }
    renderEmotionGraph();
}

function updateGraphTargetOptions() {
    const proj = getCurrentProject();
    const selectEl = document.getElementById('graph-target-select');
    if (!proj || !selectEl) return;
    const currentVal = selectEl.value;
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));

    selectEl.innerHTML = `
        <option value="outline">大筋</option>
        ${sortedChars.map(c => {
            const name = c.fields.find(f => f.label === 'キャラ名')?.value || `キャラNo.${c.number}`;
            return `<option value="${c.id}">No.${c.number} ${escapeHtml(name)}</option>`;
        }).join('')}
    `;
    if ([...selectEl.options].some(o => o.value === currentVal)) {
        selectEl.value = currentVal;
    }
}

function renderEmotionGraph() {
    const proj = getCurrentProject();
    const container = document.getElementById('graph-container');
    if (!proj || !container || !isGraphVisible) return;

    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#475569' : '#cbd5e1';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // 表示対象シリーズ構築
    let seriesList = [];
    if (graphMode === 'all') {
        seriesList.push({
            id: 'outline',
            label: '大筋',
            color: proj.outlineColor || '#6366f1',
            notes: proj.notes.filter(n => !n.hidden && n.targetId === 'outline').sort((a, b) => a.number - b.number)
        });
        const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
        sortedChars.forEach(c => {
            const cNotes = proj.notes.filter(n => !n.hidden && n.targetId === c.id).sort((a, b) => a.number - b.number);
            if (cNotes.length > 0) {
                seriesList.push({
                    id: c.id,
                    label: getTargetLabel(proj, c.id),
                    color: c.color,
                    notes: cNotes
                });
            }
        });
    } else {
        const targetId = document.getElementById('graph-target-select').value || 'outline';
        const color = targetId === 'outline'
            ? (proj.outlineColor || '#6366f1')
            : (proj.characters.find(c => c.id === targetId)?.color || '#ec4899');
        seriesList.push({
            id: targetId,
            label: getTargetLabel(proj, targetId),
            color,
            notes: proj.notes.filter(n => !n.hidden && n.targetId === targetId).sort((a, b) => a.number - b.number)
        });
    }

    const allNumbers = [...new Set(seriesList.flatMap(s => s.notes.map(n => n.number)))].sort((a, b) => a - b);

    if (allNumbers.length === 0) {
        container.innerHTML = `<div class="w-full h-full flex items-center justify-center text-xs text-slate-400">白紙に付箋を配置すると感情グラフが描画されます</div>`;
        return;
    }

    const width = Math.max(container.clientWidth || 600, 320);
    const height = Math.max(container.clientHeight || 160, 130);
    const padLeft = 36;
    const padRight = 24;
    const padTop = 16;
    const padBottom = 26;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const getX = (num) => {
        if (allNumbers.length === 1) return padLeft + plotW / 2;
        const idx = allNumbers.indexOf(num);
        return padLeft + (idx / (allNumbers.length - 1)) * plotW;
    };
    const getY = (emo) => padTop + ((10 - emo) / 20) * plotH;

    const zeroY = getY(0);

    let svgParts = [];
    // 背景グリッド線（+10, 0, -10）
    [10, 0, -10].forEach(val => {
        const y = getY(val);
        svgParts.push(`<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="${axisColor}" stroke-dasharray="${val === 0 ? 'none' : '3 3'}" stroke-width="${val === 0 ? '1.5' : '1'}" />`);
        svgParts.push(`<text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" font-size="10" font-family="JetBrains Mono" fill="${textColor}">${val > 0 ? '+' + val : val}</text>`);
    });

    // X軸番号ラベル
    allNumbers.forEach(num => {
        const x = getX(num);
        svgParts.push(`<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="10" font-weight="bold" font-family="JetBrains Mono" fill="${textColor}">#${num}</text>`);
    });

    // 各シリーズの折れ線とポイント
    seriesList.forEach(series => {
        if (series.notes.length === 0) return;
        const points = series.notes.map(n => `${getX(n.number)},${getY(n.emotion || 0)}`).join(' ');
        if (series.notes.length > 1) {
            svgParts.push(`<polyline fill="none" stroke="${series.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}" />`);
        }
        series.notes.forEach(n => {
            const cx = getX(n.number);
            const cy = getY(n.emotion || 0);
            svgParts.push(`
                <g class="cursor-pointer" onclick="openNoteEditModal('${n.id}')">
                    <circle cx="${cx}" cy="${cy}" r="5" fill="${series.color}" stroke="#ffffff" stroke-width="1.5" />
                    <title>#${n.number} ${escapeHtml(n.title)} (EMO: ${n.emotion})</title>
                </g>
            `);
        });
    });

    container.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}">${svgParts.join('')}</svg>`;
}

// ==========================================
// PDF出力システム（単体出力 ＋ 複数選択一括出力）
// ==========================================
function renderPdfDrawer(titleEl, contentEl, proj) {
    titleEl.innerHTML = `<i data-lucide="file-down" class="w-4 h-4 text-rose-400"></i><span>PDF出力（単体・複数選択）</span>`;

    const sections = [
        { key: 'template', label: '簡易テンプレート (PSLOC)', desc: '主人公・舞台・欠落・障害・変化', icon: 'layout-template', color: 'text-emerald-500' },
        { key: 'stage', label: '舞台設定', desc: `${proj.stages.length}項目の世界観・舞台設定`, icon: 'globe', color: 'text-indigo-500' },
        { key: 'characters', label: 'キャラクター設定', desc: `${proj.characters.length}名の立ち絵・プロフィール`, icon: 'users', color: 'text-pink-500' },
        { key: 'canvas', label: '付箋が貼られた白紙＆一覧', desc: `全体マップ図 ＋ ${proj.notes.length}枚の付箋リスト`, icon: 'sticky-note', color: 'text-amber-500' },
        { key: 'graph', label: 'エモーションレベルグラフ', desc: '感情推移チャート（総合・個別）', icon: 'activity', color: 'text-purple-500' }
    ];

    contentEl.innerHTML = `
        <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            各項目を<strong>単体でPDF出力</strong>するか、チェックを入れて<strong>複数まとめて1冊の企画書PDF</strong>として出力できます。
        </p>

        <div class="flex items-center justify-between pt-1">
            <span class="text-xs font-bold">出力セクション選択</span>
            <div class="flex items-center gap-2 text-[11px]">
                <button onclick="toggleAllPdfChecks(true)" class="text-purple-500 dark:text-purple-300 font-bold hover:underline">全選択</button>
                <span class="text-slate-300">|</span>
                <button onclick="toggleAllPdfChecks(false)" class="text-slate-400 hover:underline">全解除</button>
            </div>
        </div>

        <div class="space-y-2">
            ${sections.map(sec => `
                <div class="p-3 rounded-xl bg-slate-50 dark:bg-cyber-card border border-slate-200 dark:border-cyber-border flex items-center justify-between gap-2">
                    <label class="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input type="checkbox" name="pdf-sec-check" value="${sec.key}" checked class="mt-1 w-4 h-4 rounded accent-purple-600 shrink-0">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5">
                                <i data-lucide="${sec.icon}" class="w-3.5 h-3.5 ${sec.color} shrink-0"></i>
                                <span class="font-bold text-xs truncate">${sec.label}</span>
                            </div>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">${sec.desc}</p>
                        </div>
                    </label>
                    <button onclick="exportPdfSections(['${sec.key}'])" class="px-2.5 py-1.5 rounded-lg bg-white dark:bg-cyber-panel border border-slate-200 dark:border-cyber-border hover:border-purple-400 text-[11px] font-bold shrink-0 transition" title="この項目のみPDF出力">
                        単体出力
                    </button>
                </div>
            `).join('')}
        </div>

        <button onclick="exportSelectedPdf()" class="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md hover:opacity-95 active:scale-95 transition">
            <i data-lucide="printer" class="w-4 h-4"></i>
            <span>選択した項目をまとめてPDF出力</span>
        </button>

        <div class="p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/20 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            <strong>iPhone / iPadでの保存手順：</strong><br>
            印刷画面が開いたら、プレビュー画像を<strong>2本指でピンチアウト（拡大）</strong>するか、右上の共有ボタンから「ファイルに保存」を選ぶとPDFとして保存できます。
        </div>
    `;
}

function toggleAllPdfChecks(checked) {
    document.querySelectorAll('input[name="pdf-sec-check"]').forEach(cb => {
        cb.checked = checked;
    });
}

function exportSelectedPdf() {
    const selected = [...document.querySelectorAll('input[name="pdf-sec-check"]:checked')].map(cb => cb.value);
    if (selected.length === 0) {
        showToast('出力する項目を1つ以上選択してください');
        return;
    }
    exportPdfSections(selected);
}

function exportPdfSections(sectionKeys) {
    const proj = getCurrentProject();
    if (!proj) return;

    const printContainer = document.getElementById('pdf-print-container');
    const dateStr = new Date().toLocaleDateString('ja-JP');

    let html = `
        <div style="border-bottom: 2px solid #8b5cf6; padding-bottom: 12px; margin-bottom: 20px;">
            <div style="font-size: 10px; color: #8b5cf6; font-weight: bold; letter-spacing: 0.1em;">CHRONOPLOT STORY ARCHITECTURE</div>
            <h1 style="font-size: 22px; font-weight: bold; margin: 4px 0; color: #0f172a;">${escapeHtml(proj.title)}</h1>
            ${proj.memo ? `<p style="font-size: 12px; color: #475569; margin: 4px 0;">${escapeHtml(proj.memo)}</p>` : ''}
            <div style="font-size: 10px; color: #94a3b8; margin-top: 6px;">出力日: ${dateStr}</div>
        </div>
    `;

    sectionKeys.forEach((key, index) => {
        const breakClass = index > 0 ? 'pdf-section-break' : '';

        if (key === 'template') {
            const t = proj.template || { P: '', S: '', L: '', O: '', C: '' };
            const items = [
                { code: 'P', title: '主人公（Protagonist）', val: t.P, color: '#10b981' },
                { code: 'S', title: '舞台（Setting）', val: t.S, color: '#6366f1' },
                { code: 'L', title: '欠落（Lack）', val: t.L, color: '#ec4899' },
                { code: 'O', title: '障害（Obstacle）', val: t.O, color: '#f59e0b' },
                { code: 'C', title: '変化（Change）', val: t.C, color: '#8b5cf6' }
            ];
            html += `
                <div class="${breakClass}" style="margin-bottom: 24px;">
                    <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #10b981; padding-left: 8px; margin-bottom: 12px;">簡易テンプレート（PSLOC）</h2>
                    <div style="display: grid; gap: 10px;">
                        ${items.map(it => `
                            <div class="pdf-avoid-break" style="border: 1px solid #e2e8f0; border-left: 4px solid ${it.color}; border-radius: 8px; padding: 10px 12px; background: #f8fafc;">
                                <div style="font-size: 11px; font-weight: bold; color: ${it.color}; margin-bottom: 4px;">${it.code}：${it.title}</div>
                                <div style="font-size: 12px; white-space: pre-wrap; color: #1e293b;">${escapeHtml(it.val || '（未記述）')}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        if (key === 'stage') {
            html += `
                <div class="${breakClass}" style="margin-bottom: 24px;">
                    <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #6366f1; padding-left: 8px; margin-bottom: 12px;">舞台設定</h2>
                    ${proj.stages.length === 0 ? '<p style="font-size:12px; color:#64748b;">舞台設定は登録されていません。</p>' : `
                        <div style="display: grid; gap: 10px;">
                            ${proj.stages.map(s => `
                                <div class="pdf-avoid-break" style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px;">
                                    <div style="font-size: 12px; font-weight: bold; color: #4f46e5; margin-bottom: 4px;">${escapeHtml(s.title)}</div>
                                    <div style="font-size: 12px; white-space: pre-wrap; color: #334155;">${escapeHtml(s.content || '（未記述）')}</div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            `;
        }

        if (key === 'characters') {
            const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
            html += `
                <div class="${breakClass}" style="margin-bottom: 24px;">
                    <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #ec4899; padding-left: 8px; margin-bottom: 12px;">キャラクター設定</h2>
                    ${sortedChars.length === 0 ? '<p style="font-size:12px; color:#64748b;">キャラクターは登録されていません。</p>' : `
                        <div style="display: grid; gap: 12px;">
                            ${sortedChars.map(c => {
                                const name = c.fields.find(f => f.label === 'キャラ名')?.value || '名称未設定';
                                return `
                                    <div class="pdf-avoid-break" style="border: 1px solid #e2e8f0; border-top: 4px solid ${c.color}; border-radius: 10px; padding: 12px; display: flex; gap: 12px; align-items: flex-start;">
                                        ${c.image ? `<img src="${c.image}" style="width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1; flex-shrink: 0;">` : ''}
                                        <div style="flex: 1;">
                                            <div style="font-size: 13px; font-weight: bold; margin-bottom: 6px;">
                                                <span style="background:${c.color}; color:#fff; padding: 1px 6px; border-radius: 4px; font-size: 10px; margin-right: 6px;">No.${c.number || '-'}</span>
                                                ${escapeHtml(name)}
                                            </div>
                                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; font-size: 11px;">
                                                ${c.fields.map(f => `
                                                    <div><strong style="color:#64748b;">${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value || '-')}</div>
                                                `).join('')}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            `;
        }

        if (key === 'canvas') {
            html += buildPdfCanvasSection(proj, breakClass);
        }

        if (key === 'graph') {
            html += buildPdfGraphSection(proj, breakClass);
        }
    });

    printContainer.innerHTML = html;

    // 印刷ダイアログ起動（iOS / PC対応）
    setTimeout(() => {
        window.print();
    }, 150);
}

// 白紙キャンバス全体図SVG ＋ 番号順テキスト一覧表生成
function buildPdfCanvasSection(proj, breakClass) {
    const visible = proj.notes.filter(n => !n.hidden);
    const allSorted = [...proj.notes].sort((a, b) => (a.number || 0) - (b.number || 0));

    let mapSvg = '<p style="font-size:12px; color:#64748b;">白紙上に配置された付箋はありません。</p>';

    if (visible.length > 0) {
        const pad = 40;
        const cardW = 190;
        const cardH = 95;
        const minX = Math.min(...visible.map(n => n.x)) - pad;
        const minY = Math.min(...visible.map(n => n.y)) - pad;
        const maxX = Math.max(...visible.map(n => n.x + cardW)) + pad;
        const maxY = Math.max(...visible.map(n => n.y + cardH)) + pad;
        const vbW = Math.max(400, maxX - minX);
        const vbH = Math.max(220, maxY - minY);

        const linesSvg = proj.connections.map(conn => {
            const n1 = visible.find(n => n.id === conn.from);
            const n2 = visible.find(n => n.id === conn.to);
            if (!n1 || !n2) return '';
            const color = getNoteColor(proj, n1);
            return `<line x1="${n1.x + cardW / 2}" y1="${n1.y + cardH / 2}" x2="${n2.x + cardW / 2}" y2="${n2.y + cardH / 2}" stroke="${color}" stroke-width="3" />`;
        }).join('');

        const cardsSvg = visible.map(n => {
            const color = getNoteColor(proj, n);
            const label = getTargetLabel(proj, n.targetId);
            const titleShort = (n.title || '').slice(0, 14);
            return `
                <g transform="translate(${n.x}, ${n.y})">
                    <rect width="${cardW}" height="${cardH}" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
                    <rect width="${cardW}" height="6" rx="3" fill="${color}" />
                    <text x="10" y="24" font-size="11" font-weight="bold" fill="${color}">#${n.number} ${escapeHtml(label)}</text>
                    <text x="10" y="44" font-size="12" font-weight="bold" fill="#0f172a">${escapeHtml(titleShort)}</text>
                    <text x="10" y="78" font-size="10" fill="#64748b">EMO: ${n.emotion > 0 ? '+' + n.emotion : n.emotion}</text>
                </g>
            `;
        }).join('');

        mapSvg = `
            <div class="pdf-avoid-break" style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px; background: #f8fafc; margin-bottom: 14px;">
                <svg width="100%" style="max-height: 360px;" viewBox="${minX} ${minY} ${vbW} ${vbH}">
                    ${linesSvg}
                    ${cardsSvg}
                </svg>
            </div>
        `;
    }

    const listHtml = allSorted.length === 0 ? '' : `
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
                <tr style="background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1; text-align: left;">
                    <th style="padding: 6px 8px; width: 45px;">No.</th>
                    <th style="padding: 6px 8px; width: 110px;">対象</th>
                    <th style="padding: 6px 8px;">見出し・内容</th>
                    <th style="padding: 6px 8px; width: 45px; text-align: right;">EMO</th>
                </tr>
            </thead>
            <tbody>
                ${allSorted.map(n => {
                    const color = getNoteColor(proj, n);
                    const label = getTargetLabel(proj, n.targetId);
                    return `
                        <tr class="pdf-avoid-break" style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 6px 8px; font-weight: bold; color: ${color};">#${n.number}</td>
                            <td style="padding: 6px 8px; font-weight: bold;">${escapeHtml(label)}</td>
                            <td style="padding: 6px 8px;">
                                <div style="font-weight: bold; color: #0f172a;">${escapeHtml(n.title)}</div>
                                ${n.content ? `<div style="color: #475569; margin-top: 2px; white-space: pre-wrap;">${escapeHtml(n.content)}</div>` : ''}
                            </td>
                            <td style="padding: 6px 8px; text-align: right; font-weight: bold;">${n.emotion > 0 ? '+' + n.emotion : n.emotion}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    return `
        <div class="${breakClass}" style="margin-bottom: 24px;">
            <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #f59e0b; padding-left: 8px; margin-bottom: 12px;">白紙キャンバス配置図 ＆ プロット付箋一覧</h2>
            ${mapSvg}
            ${listHtml}
        </div>
    `;
}

// PDF用エモーションレベルグラフSVG生成
function buildPdfGraphSection(proj, breakClass) {
    const seriesList = [];
    seriesList.push({
        label: '大筋',
        color: proj.outlineColor || '#6366f1',
        notes: proj.notes.filter(n => !n.hidden && n.targetId === 'outline').sort((a, b) => a.number - b.number)
    });
    const sortedChars = [...proj.characters].sort((a, b) => (a.number || 999) - (b.number || 999));
    sortedChars.forEach(c => {
        const cNotes = proj.notes.filter(n => !n.hidden && n.targetId === c.id).sort((a, b) => a.number - b.number);
        if (cNotes.length > 0) {
            seriesList.push({
                label: getTargetLabel(proj, c.id),
                color: c.color,
                notes: cNotes
            });
        }
    });

    const allNumbers = [...new Set(seriesList.flatMap(s => s.notes.map(n => n.number)))].sort((a, b) => a - b);

    if (allNumbers.length === 0) {
        return `
            <div class="${breakClass}" style="margin-bottom: 24px;">
                <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #8b5cf6; padding-left: 8px; margin-bottom: 12px;">エモーションレベルグラフ</h2>
                <p style="font-size:12px; color:#64748b;">グラフ描画対象の付箋データがありません。</p>
            </div>
        `;
    }

    const width = 680;
    const height = 220;
    const padLeft = 40;
    const padRight = 25;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const getX = (num) => {
        if (allNumbers.length === 1) return padLeft + plotW / 2;
        return padLeft + (allNumbers.indexOf(num) / (allNumbers.length - 1)) * plotW;
    };
    const getY = (emo) => padTop + ((10 - emo) / 20) * plotH;

    let svgBody = '';
    [10, 5, 0, -5, -10].forEach(val => {
        const y = getY(val);
        svgBody += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="${val === 0 ? '#64748b' : '#cbd5e1'}" stroke-dasharray="${val === 0 ? 'none' : '3 3'}" stroke-width="${val === 0 ? '1.5' : '1'}" />`;
        svgBody += `<text x="${padLeft - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#475569">${val > 0 ? '+' + val : val}</text>`;
    });

    allNumbers.forEach(num => {
        const x = getX(num);
        svgBody += `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="10" font-weight="bold" fill="#334155">#${num}</text>`;
    });

    seriesList.forEach(s => {
        if (s.notes.length === 0) return;
        const pts = s.notes.map(n => `${getX(n.number)},${getY(n.emotion || 0)}`).join(' ');
        if (s.notes.length > 1) {
            svgBody += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${pts}" />`;
        }
        s.notes.forEach(n => {
            svgBody += `<circle cx="${getX(n.number)}" cy="${getY(n.emotion || 0)}" r="4.5" fill="${s.color}" stroke="#ffffff" stroke-width="1.5" />`;
        });
    });

    const legendHtml = seriesList.filter(s => s.notes.length > 0).map(s => `
        <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; margin-right: 12px;">
            <span style="display:inline-block; width:10px; height:10px; border-radius:99px; background:${s.color};"></span>
            <strong>${escapeHtml(s.label)}</strong>
        </span>
    `).join('');

    return `
        <div class="${breakClass} pdf-avoid-break" style="margin-bottom: 24px;">
            <h2 style="font-size: 15px; font-weight: bold; border-left: 4px solid #8b5cf6; padding-left: 8px; margin-bottom: 10px;">エモーションレベルグラフ</h2>
            <div style="margin-bottom: 8px;">${legendHtml}</div>
            <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; background: #ffffff;">
                <svg width="100%" viewBox="0 0 ${width} ${height}">${svgBody}</svg>
            </div>
        </div>
    `;
}

// ==========================================
// ユーティリティ
// ==========================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
