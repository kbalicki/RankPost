const API = '';

// --- State ---
let state = {
    outlineData: null,
    articleHtml: '',
    sourceTexts: [],
    selectedCategories: [],
    allCategories: [],
    featuredImageUrl: null,
    styles: [],
    wpSites: [],
    uploadedFiles: [], // {filename, text, chars, error?}
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    loadWpSites();
    loadStyles();
    loadSettings();
    loadStructureTemplates();
    loadImageStyles();
    initGenerator();

    document.getElementById('target-length').addEventListener('change', (e) => {
        document.getElementById('target-length-custom').classList.toggle('hidden', e.target.value !== 'custom');
    });

    document.getElementById('meta-title').addEventListener('input', (e) => {
        document.getElementById('meta-title-count').textContent = `${e.target.value.length}/60`;
    });
    document.getElementById('meta-description').addEventListener('input', (e) => {
        document.getElementById('meta-desc-count').textContent = `${e.target.value.length}/155`;
    });

    // File upload
    const fileInput = document.getElementById('source-files');
    const dropZone = document.getElementById('file-drop-zone');

    fileInput.addEventListener('change', () => handleFileUpload(fileInput.files));

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFileUpload(e.dataTransfer.files);
    });
});

// --- Tabs ---
function showTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(`panel-${name}`).classList.remove('hidden');
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'articles') loadArticles();
    if (name === 'styles') { loadStyles(); loadStructureTemplates(); }
    if (name === 'settings') { loadSettings(); loadImageStyles(); }
    if (name === 'bulk') initBulk();
    if (name === 'rewrite') initRewrite();
    if (name === 'analytics') initAnalytics();
}

// --- Steps ---
function goToStep(n) {
    document.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
    document.getElementById(`step-${n}`).classList.remove('hidden');
    for (let i = 1; i <= 5; i++) {
        const dot = document.getElementById(`step-ind-${i}`);
        dot.classList.remove('active', 'done');
        if (i < n) dot.classList.add('done');
        if (i === n) dot.classList.add('active');
    }
}

// --- Loading ---
function showLoading(text) {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.remove('hidden');
}
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// --- API helpers ---
async function apiPost(endpoint, data) {
    const resp = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'API error');
    }
    return resp.json();
}

async function apiGet(endpoint) {
    const resp = await fetch(`${API}${endpoint}`);
    if (!resp.ok) throw new Error('API error');
    return resp.json();
}

async function apiDelete(endpoint) {
    const resp = await fetch(`${API}${endpoint}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('API error');
    return resp.json();
}

// --- File Upload ---
async function handleFileUpload(fileList) {
    if (!fileList.length) return;
    const formData = new FormData();
    for (const f of fileList) {
        formData.append('files', f);
    }
    showLoading('Przetwarzam pliki...');
    try {
        const resp = await fetch(`${API}/api/upload-files`, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Upload error');
        const data = await resp.json();
        for (const f of data.files) {
            if (!state.uploadedFiles.find(u => u.filename === f.filename)) {
                state.uploadedFiles.push(f);
            }
        }
        renderUploadedFiles();
    } catch (e) {
        alert('Blad uploadu: ' + e.message);
    } finally {
        hideLoading();
        document.getElementById('source-files').value = '';
    }
}

function renderUploadedFiles() {
    const container = document.getElementById('uploaded-files-list');
    if (!state.uploadedFiles.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = '<div style="padding:8px 4px 4px">' + state.uploadedFiles.map((f, i) => {
        const cls = f.error ? 'file-chip error' : 'file-chip ok';
        const info = f.error ? f.error : `${f.chars} znakow`;
        return `<span class="${cls}">${escapeHtml(f.filename)} (${info}) <span class="remove" onclick="removeUploadedFile(${i})">x</span></span>`;
    }).join('') + '</div>';
}

function removeUploadedFile(idx) {
    state.uploadedFiles.splice(idx, 1);
    renderUploadedFiles();
}

function getFileTexts() {
    return state.uploadedFiles.filter(f => f.text).map(f => f.text);
}

// --- Settings ---
async function loadSettings() {
    try {
        const data = await apiGet('/api/settings');
        const openaiEl = document.getElementById('settings-openai-status');
        const anthropicEl = document.getElementById('settings-anthropic-status');
        openaiEl.textContent = data.openai_api_key_set ? 'Ustawiony' : 'Brak';
        openaiEl.className = data.openai_api_key_set ? 'status-set' : 'status-unset';
        anthropicEl.textContent = data.anthropic_api_key_set ? 'Ustawiony' : 'Brak';
        anthropicEl.className = data.anthropic_api_key_set ? 'status-set' : 'status-unset';
        document.getElementById('settings-openai-key').value = data.openai_api_key || '';
        document.getElementById('settings-anthropic-key').value = data.anthropic_api_key || '';
        loadWpSitesList();
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

async function saveApiKeys() {
    const openaiKey = document.getElementById('settings-openai-key').value.trim();
    const anthropicKey = document.getElementById('settings-anthropic-key').value.trim();
    if (!openaiKey && !anthropicKey) return alert('Wpisz przynajmniej jeden klucz');
    try {
        await apiPost('/api/settings', { openai_api_key: openaiKey, anthropic_api_key: anthropicKey });
        alert('Klucze zapisane!');
        loadSettings();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

// --- WP Sites (settings panel) ---
async function loadWpSitesList() {
    try {
        const data = await apiGet('/api/wp-sites');
        state.wpSites = data.sites;
        const container = document.getElementById('wp-sites-list');
        if (!data.sites.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Brak serwisow. Dodaj pierwszy ponizej.</p>';
        } else {
            container.innerHTML = data.sites.map(s => `
                <div class="list-item">
                    <div class="list-item-info">
                        <p>${escapeHtml(s.name)}</p>
                        <p>${escapeHtml(s.url)}</p>
                    </div>
                    <div class="list-item-actions">
                        <button onclick="testWpSite('${escapeHtml(s.name)}')" class="btn-secondary">Test</button>
                        <button onclick="deleteWpSite(${s.id})" class="btn-danger">Usun</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Failed to load WP sites list', e);
    }
}

async function addWpSite() {
    const name = document.getElementById('new-wp-name').value.trim();
    const url = document.getElementById('new-wp-url').value.trim();
    const user = document.getElementById('new-wp-user').value.trim();
    const password = document.getElementById('new-wp-password').value.trim();
    if (!name || !url || !user || !password) return alert('Wypelnij wszystkie pola');
    try {
        await apiPost('/api/wp-sites', { name, url, user, app_password: password });
        document.getElementById('new-wp-name').value = '';
        document.getElementById('new-wp-url').value = '';
        document.getElementById('new-wp-user').value = '';
        document.getElementById('new-wp-password').value = '';
        loadWpSitesList();
        loadWpSites();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

async function deleteWpSite(id) {
    if (!confirm('Na pewno usunac ten serwis?')) return;
    try {
        await apiDelete(`/api/wp-sites/${id}`);
        loadWpSitesList();
        loadWpSites();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

async function testWpSite(name) {
    try {
        const data = await apiPost(`/api/wp-sites/${name}/test`, {});
        alert(data.message);
    } catch (e) {
        alert('Blad polaczenia: ' + e.message);
    }
}

// --- WP Sites (dropdown in form) ---
async function loadWpSites() {
    try {
        const data = await apiGet('/api/wp-sites');
        const sel = document.getElementById('wp-site');
        if (!data.sites.length) {
            sel.innerHTML = '<option value="">Brak serwisow - dodaj w Ustawieniach</option>';
        } else {
            sel.innerHTML = data.sites.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${escapeHtml(s.url)})</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to load WP sites', e);
    }
}

// --- Styles ---
async function loadStyles() {
    try {
        const data = await apiGet('/api/styles');
        state.styles = data.styles;
        renderStyleSelect();
        renderGenStyleSelect();
        renderStylesList();
    } catch (e) {
        console.error('Failed to load styles', e);
    }
}

function renderStyleSelect() {
    const sel = document.getElementById('style-select');
    sel.innerHTML = '<option value="">-- wybierz szablon --</option>' +
        state.styles.map(s => `<option value="${s.id}" data-desc="${encodeURIComponent(s.description)}">${escapeHtml(s.name)}</option>`).join('');
}

function renderStylesList() {
    const container = document.getElementById('styles-list');
    if (!container) return;
    if (!state.styles.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Brak szablonow</p>';
        return;
    }
    container.innerHTML = state.styles.map(s => `
        <div class="list-item">
            <div class="list-item-info">
                <p>${escapeHtml(s.name)}</p>
                <p>${escapeHtml(s.description)}</p>
            </div>
            <div class="list-item-actions">
                <button onclick="deleteStyle(${s.id})" class="btn-danger">Usun</button>
            </div>
        </div>
    `).join('');
}

async function createStyle() {
    const name = document.getElementById('new-style-name').value.trim();
    const desc = document.getElementById('new-style-desc').value.trim();
    if (!name || !desc) return alert('Podaj nazwe i opis stylu');
    try {
        await apiPost('/api/styles', { name, description: desc });
        document.getElementById('new-style-name').value = '';
        document.getElementById('new-style-desc').value = '';
        await loadStyles();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

async function deleteStyle(id) {
    if (!confirm('Na pewno usunac ten szablon?')) return;
    await apiDelete(`/api/styles/${id}`);
    await loadStyles();
}

// --- Get form values ---
function getFormData() {
    const styleSel = document.getElementById('style-select');
    const styleOption = styleSel.selectedOptions[0];
    const styleDesc = styleOption && styleOption.dataset.desc
        ? decodeURIComponent(styleOption.dataset.desc)
        : '';
    const customStyle = document.getElementById('style-custom').value.trim();

    const lengthSel = document.getElementById('target-length');
    let targetLength = parseInt(lengthSel.value);
    if (lengthSel.value === 'custom') {
        targetLength = parseInt(document.getElementById('target-length-custom').value) || 1200;
    }

    const urls = document.getElementById('source-urls').value.trim()
        .split('\n').map(u => u.trim()).filter(u => u);

    return {
        wp_site: document.getElementById('wp-site').value,
        topic: document.getElementById('topic').value.trim(),
        source_urls: urls,
        style_description: customStyle || styleDesc || 'Informacyjny',
        paragraphs_min: parseInt(document.getElementById('paragraphs-min').value) || 4,
        paragraphs_max: parseInt(document.getElementById('paragraphs-max').value) || 8,
        include_intro: document.getElementById('include-intro').checked,
        include_summary: document.getElementById('include-summary').checked,
        additional_notes: document.getElementById('additional-notes').value.trim(),
        language: document.getElementById('language').value,
        model: document.getElementById('ai-model').value,
        target_length: targetLength,
        generate_image: document.getElementById('generate-image').checked,
        generate_tags: document.getElementById('generate-tags').checked,
        tags_min: parseInt(document.getElementById('tags-min').value) || 3,
        tags_max: parseInt(document.getElementById('tags-max').value) || 8,
        generate_seo: document.getElementById('generate-seo').checked,
        cats_min: parseInt(document.getElementById('cats-min').value) || 1,
        cats_max: parseInt(document.getElementById('cats-max').value) || 3,
    };
}

function getEnrichments(prefix) {
    const enrichments = [];
    const el = (id) => document.getElementById(prefix + id);
    if (el('-enrich-lists') && el('-enrich-lists').checked)
        enrichments.push('lists:' + (el('-enrich-lists-count')?.value || '2-4'));
    if (el('-enrich-quotes') && el('-enrich-quotes').checked)
        enrichments.push('quotes:' + (el('-enrich-quotes-count')?.value || '1'));
    if (el('-enrich-faq') && el('-enrich-faq').checked)
        enrichments.push('faq:' + (el('-enrich-faq-count')?.value || '3'));
    if (el('-enrich-table') && el('-enrich-table').checked)
        enrichments.push('table');
    if (el('-enrich-tips') && el('-enrich-tips').checked)
        enrichments.push('tips:' + (el('-enrich-tips-count')?.value || '3'));
    if (el('-enrich-summary') && el('-enrich-summary').checked)
        enrichments.push('summary');
    return enrichments;
}

// --- Step 1 -> 2: Generate Outline ---
async function generateOutline() {
    const form = getFormData();
    if (!form.topic) return alert('Podaj temat artykulu');

    // Apply structure template if selected
    applyStructureTemplate();

    showLoading('Generuje outline artykulu...');
    try {
        const data = await apiPost('/api/outline', { ...form, file_texts: getFileTexts() });
        state.outlineData = data.outline;
        document.getElementById('outline-title').value = data.outline.title || form.topic;

        // Use pending structure template sections if available, otherwise AI-generated
        if (state._pendingStructure && state._pendingStructure.length) {
            renderOutlineSections(state._pendingStructure.map(s => ({
                heading: s.heading || s,
                key_points: s.key_points || []
            })));
            state._pendingStructure = null;
        } else {
            renderOutlineSections(data.outline.sections || []);
        }
        goToStep(2);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function renderOutlineSections(sections) {
    const container = document.getElementById('outline-sections');
    container.innerHTML = sections.map((s, i) => `
        <div class="section-card" data-idx="${i}">
            <div class="section-card-header">
                <input type="text" value="${escapeHtml(s.heading)}" class="input section-heading" placeholder="Naglowek sekcji">
                <button onclick="removeSection(${i})" class="btn-danger">X</button>
            </div>
            <textarea class="input section-points" style="height:60px;font-size:13px" placeholder="Kluczowe punkty (po jednym w linii)">${(s.key_points || []).join('\n')}</textarea>
        </div>
    `).join('');
}

function addSection() {
    const container = document.getElementById('outline-sections');
    const idx = container.children.length;
    const div = document.createElement('div');
    div.className = 'section-card';
    div.dataset.idx = idx;
    div.innerHTML = `
        <div class="section-card-header">
            <input type="text" class="input section-heading" placeholder="Naglowek sekcji">
            <button onclick="this.closest('[data-idx]').remove()" class="btn-danger">X</button>
        </div>
        <textarea class="input section-points" style="height:60px;font-size:13px" placeholder="Kluczowe punkty (po jednym w linii)"></textarea>
    `;
    container.appendChild(div);
}

function removeSection(idx) {
    const el = document.querySelector(`[data-idx="${idx}"]`);
    if (el) el.remove();
}

function getOutlineFromUI() {
    const title = document.getElementById('outline-title').value.trim();
    const sections = [];
    document.querySelectorAll('#outline-sections > div').forEach(div => {
        const heading = div.querySelector('.section-heading').value.trim();
        const points = div.querySelector('.section-points').value.trim()
            .split('\n').map(p => p.trim()).filter(p => p);
        if (heading) sections.push({ heading, key_points: points });
    });
    return { title, sections };
}

// --- Step 2 -> 3: Generate Article ---
async function generateArticle() {
    const outline = getOutlineFromUI();
    if (!outline.sections.length) return alert('Dodaj przynajmniej jedna sekcje');

    const form = getFormData();
    const wizEnrichments = getEnrichments('wiz');
    let enrichNotes = form.additional_notes;
    if (wizEnrichments.length) {
        const enrichMap = {
            lists: (c) => `Dodaj ${c} list punktowanych/numerowanych`,
            quotes: (c) => `Dodaj ${c} cytat(y/ow) ze zrodel (TYLKO prawdziwe, z podanych materialow). Uzyj <blockquote>`,
            faq: (c) => `Dodaj sekcje FAQ z ${c} pytaniami`,
            table: () => 'Dodaj tabele porownawcza HTML',
            tips: (c) => `Dodaj ${c} praktycznych wskazowek (Tip:)`,
            summary: () => 'Dodaj TL;DR na koncu',
        };
        const parts = wizEnrichments.map(e => {
            const [t, c] = e.split(':');
            return enrichMap[t] ? enrichMap[t](c || '') : '';
        }).filter(Boolean);
        enrichNotes = (enrichNotes + '\n\nWZBOGACENIA: ' + parts.join('. ') + '. Cytaty TYLKO z podanych zrodel - 0 halucynacji.').trim();
    }

    showLoading('Generuje tresc artykulu... To moze potrwac chwile.');
    try {
        const data = await apiPost('/api/generate-content', {
            outline,
            source_urls: form.source_urls,
            file_texts: getFileTexts(),
            style_description: form.style_description,
            additional_notes: enrichNotes,
            language: form.language,
            model: form.model,
            target_length: form.target_length,
        });
        state.articleHtml = data.content;
        state.outlineData = outline;
        document.getElementById('article-preview').innerHTML = data.content;
        document.getElementById('article-html').value = data.content;
        // Reset HTML toggle state
        document.getElementById('article-preview').classList.remove('hidden');
        document.getElementById('article-html').classList.add('hidden');
        const btn = document.getElementById('wiz-html-toggle');
        if (btn) { btn.style.background = ''; btn.style.color = ''; }
        goToStep(3);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function wizExecCmd(cmd, value) {
    document.execCommand(cmd, false, value || null);
    document.getElementById('article-preview').focus();
}

function wizToggleHtml() {
    const editor = document.getElementById('article-preview');
    const textarea = document.getElementById('article-html');
    const btn = document.getElementById('wiz-html-toggle');

    if (textarea.classList.contains('hidden')) {
        textarea.value = editor.innerHTML;
        editor.classList.add('hidden');
        textarea.classList.remove('hidden');
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
    } else {
        editor.innerHTML = textarea.value;
        textarea.classList.add('hidden');
        editor.classList.remove('hidden');
        btn.style.background = '';
        btn.style.color = '';
    }
}

function getWizArticleHtml() {
    const editor = document.getElementById('article-preview');
    if (editor.classList.contains('hidden')) {
        return document.getElementById('article-html').value;
    }
    return editor.innerHTML;
}

// --- SERP Preview ---
function updateSerpPreview() {
    const metaTitle = document.getElementById('meta-title').value || 'Tytul artykulu';
    const metaDesc = document.getElementById('meta-description').value || 'Opis artykulu pojawi sie tutaj...';
    const slug = document.getElementById('slug').value || 'artykul';
    const wpSite = document.getElementById('wp-site').value;

    // Try to get domain from WP sites
    const site = state.wpSites.find(s => s.name === wpSite);
    const domain = site ? site.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'example.com';

    document.getElementById('serp-title').textContent = metaTitle;
    document.getElementById('serp-desc').textContent = metaDesc;
    document.getElementById('serp-url').textContent = `${domain} > ${slug.replace(/-/g, ' > ')}`;
}

// --- Internal Linking ---
async function addInternalLinks() {
    const form = getFormData();
    const content = getWizArticleHtml();
    if (!content) return alert('Brak tresci artykulu');

    const customLinksText = document.getElementById('wiz-custom-links').value.trim();
    const customLinks = customLinksText ? customLinksText.split('\n').map(l => l.trim()).filter(l => l) : [];
    const linksPerArticle = parseInt(document.getElementById('wiz-links-count').value) || 3;

    if (!customLinks.length && !form.wp_site) {
        return alert('Podaj linki w polu tekstowym lub wybierz serwis WordPress');
    }

    showLoading('Dodaje linki wewnetrzne...');
    try {
        const result = await apiPost('/api/internal-links', {
            content,
            wp_site: form.wp_site,
            custom_links: customLinks,
            links_per_article: linksPerArticle,
            model: form.model,
        });
        document.getElementById('article-preview').innerHTML = result.updated_content;
        document.getElementById('article-html').value = result.updated_content;
        state.articleHtml = result.updated_content;
        alert(`Dodano ${result.links_added} linkow wewnetrznych`);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

// --- Step 3 -> 4: SEO & Tags ---
async function goToSeoStep() {
    const form = getFormData();
    const title = state.outlineData?.title || form.topic;
    state.articleHtml = getWizArticleHtml();
    const content = state.articleHtml;

    showLoading('Generuje SEO, tagi i kategorie...');
    try {
        const promises = [];

        if (form.generate_seo) {
            promises.push(apiPost('/api/seo-meta', { title, content, language: form.language, model: form.model }));
        } else {
            promises.push(Promise.resolve({ meta_title: title, meta_description: '', slug: '' }));
        }

        if (form.generate_tags) {
            promises.push(apiPost('/api/tags', {
                title, content,
                tags_min: form.tags_min, tags_max: form.tags_max,
                language: form.language, model: form.model,
            }));
        } else {
            promises.push(Promise.resolve({ tags: [] }));
        }

        if (form.wp_site) {
            promises.push(apiPost('/api/suggest-categories', { title, content, wp_site: form.wp_site, model: form.model, cats_min: form.cats_min, cats_max: form.cats_max }));
        } else {
            promises.push(Promise.resolve({ suggested_ids: [], all_categories: [] }));
        }

        if (form.generate_image) {
            promises.push(apiPost('/api/featured-image', { title }));
        } else {
            promises.push(Promise.resolve({ image_url: null }));
        }

        const [seoData, tagsData, catsData, imageData] = await Promise.all(promises);

        document.getElementById('meta-title').value = seoData.meta_title || '';
        document.getElementById('meta-description').value = seoData.meta_description || '';
        document.getElementById('slug').value = seoData.slug || '';
        document.getElementById('tags-list').value = (tagsData.tags || []).join(', ');

        state.allCategories = catsData.all_categories || [];
        state.selectedCategories = catsData.suggested_ids || [];
        renderCategories();

        state.featuredImageUrl = imageData.image_url;
        const imgPreview = document.getElementById('featured-image-preview');
        if (state.featuredImageUrl) {
            imgPreview.innerHTML = `<img src="${state.featuredImageUrl}" style="max-height:200px;border-radius:8px">`;
        } else {
            imgPreview.innerHTML = '<span style="color:var(--text-muted)">Brak</span>';
        }

        document.getElementById('meta-title').dispatchEvent(new Event('input'));
        document.getElementById('meta-description').dispatchEvent(new Event('input'));
        updateSerpPreview();

        goToStep(4);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function renderCategories() {
    const container = document.getElementById('categories-list');
    container.innerHTML = state.allCategories.map(c => {
        const selected = state.selectedCategories.includes(c.id);
        return `<span class="cat-chip ${selected ? 'selected' : ''}" onclick="toggleCategory(${c.id})">${escapeHtml(c.name)}</span>`;
    }).join('');
}

function toggleCategory(id) {
    const idx = state.selectedCategories.indexOf(id);
    if (idx >= 0) state.selectedCategories.splice(idx, 1);
    else state.selectedCategories.push(id);
    renderCategories();
}

// --- Step 5: Publish ---
const originalGoToStep = goToStep;
goToStep = function(n) {
    if (n === 5) {
        const form = getFormData();
        const title = document.getElementById('outline-title')?.value || state.outlineData?.title || '';
        document.getElementById('pub-title').textContent = title;
        document.getElementById('pub-site').textContent = form.wp_site;
        document.getElementById('pub-meta-title').textContent = document.getElementById('meta-title').value;
        document.getElementById('pub-slug').textContent = document.getElementById('slug').value;
        document.getElementById('pub-tags').textContent = document.getElementById('tags-list').value;
        document.getElementById('pub-categories').textContent = state.selectedCategories
            .map(id => state.allCategories.find(c => c.id === id)?.name || id)
            .join(', ');
    }
    originalGoToStep(n);
};

function toggleScheduleField() {
    const status = document.getElementById('publish-status').value;
    document.getElementById('schedule-field').classList.toggle('hidden', status !== 'future');
}

async function publishArticle() {
    const form = getFormData();
    if (!form.wp_site) return alert('Wybierz serwis WordPress');

    const title = document.getElementById('outline-title')?.value || state.outlineData?.title || '';
    const tagNames = document.getElementById('tags-list').value
        .split(',').map(t => t.trim()).filter(t => t);

    showLoading('Publikuje na WordPress...');
    try {
        const currentContent = getWizArticleHtml() || state.articleHtml;
        const publishStatus = document.getElementById('publish-status').value;
        const scheduledDate = publishStatus === 'future'
            ? document.getElementById('schedule-date').value
            : '';

        if (publishStatus === 'future' && !scheduledDate) {
            hideLoading();
            return alert('Wybierz date i godzine publikacji');
        }

        const result = await apiPost('/api/publish', {
            wp_site: form.wp_site,
            title,
            content: currentContent,
            category_ids: state.selectedCategories,
            tag_names: tagNames,
            meta_title: document.getElementById('meta-title').value,
            meta_description: document.getElementById('meta-description').value,
            slug: document.getElementById('slug').value,
            featured_image_url: state.featuredImageUrl,
            publish_status: publishStatus,
            scheduled_date: scheduledDate,
        });

        await apiPost('/api/articles', {
            title,
            content: currentContent,
            outline: state.outlineData,
            meta_title: document.getElementById('meta-title').value,
            meta_description: document.getElementById('meta-description').value,
            slug: document.getElementById('slug').value,
            tags: tagNames,
            categories: state.selectedCategories,
            wp_site: form.wp_site,
            settings: form,
        });

        const resultDiv = document.getElementById('publish-result');
        resultDiv.classList.remove('hidden');
        resultDiv.innerHTML = `
            <div class="success-box">
                <p>Opublikowano!</p>
                <p>Post ID: ${result.id} | Status: ${result.status}</p>
                ${result.link ? `<a href="${result.link}" target="_blank">${result.link}</a>` : ''}
            </div>
        `;
    } catch (e) {
        alert('Blad publikacji: ' + e.message);
    } finally {
        hideLoading();
    }
}

// --- Articles history ---
let currentArticleDetail = null;

async function loadArticles() {
    try {
        const data = await apiGet('/api/articles');
        const container = document.getElementById('articles-list');
        document.getElementById('article-detail').classList.add('hidden');
        container.classList.remove('hidden');
        if (!data.articles.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Brak artykulow</p>';
            return;
        }
        container.innerHTML = data.articles.map(a => `
            <div class="list-item" style="margin-bottom:8px;cursor:pointer" onclick="openArticleDetail(${a.id})">
                <div class="list-item-info">
                    <p>${escapeHtml(a.title || 'Bez tytulu')}</p>
                    <p>${a.wp_site || '-'} | ${a.status} | ${a.created_at}</p>
                </div>
                <div class="list-item-actions">
                    <button class="btn-secondary" style="font-size:11px;padding:4px 10px">Podglad</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load articles', e);
    }
}

async function openArticleDetail(id) {
    showLoading('Laduje artykul...');
    try {
        const article = await apiGet(`/api/articles/${id}`);
        currentArticleDetail = article;

        const tags = article.tags ? JSON.parse(article.tags) : [];
        const categories = article.categories ? JSON.parse(article.categories) : [];

        document.getElementById('detail-title').textContent = article.title || '-';
        document.getElementById('detail-status').textContent = article.status || '-';
        document.getElementById('detail-wp-site').textContent = article.wp_site || '-';
        document.getElementById('detail-wp-post-id').textContent = article.wp_post_id || '-';
        document.getElementById('detail-meta-title').textContent = article.meta_title || '-';
        document.getElementById('detail-meta-desc').textContent = article.meta_description || '-';
        document.getElementById('detail-slug').textContent = article.slug || '-';
        document.getElementById('detail-tags').textContent = tags.join(', ') || '-';
        document.getElementById('detail-categories').textContent = categories.join(', ') || '-';
        document.getElementById('detail-created').textContent = article.created_at || '-';
        document.getElementById('detail-updated').textContent = article.updated_at || '-';
        document.getElementById('detail-content').innerHTML = article.content || '<em>Brak tresci</em>';

        document.getElementById('articles-list').classList.add('hidden');
        document.getElementById('article-detail').classList.remove('hidden');
    } catch (e) {
        alert('Blad ladowania artykulu: ' + e.message);
    } finally {
        hideLoading();
    }
}

function closeArticleDetail() {
    currentArticleDetail = null;
    document.getElementById('article-detail').classList.add('hidden');
    document.getElementById('articles-list').classList.remove('hidden');
}

function resumeArticleInWizard() {
    if (!currentArticleDetail) return;
    const a = currentArticleDetail;
    const outline = a.outline ? JSON.parse(a.outline) : {};
    const tags = a.tags ? JSON.parse(a.tags) : [];
    const categories = a.categories ? JSON.parse(a.categories) : [];

    // Load into wizard state
    state.outlineData = outline;
    state.articleHtml = a.content || '';
    state.selectedCategories = categories;

    // Switch to Create tab
    showTab('create');

    // Fill outline step
    document.getElementById('outline-title').value = outline.title || a.title || '';
    if (outline.sections) renderOutlineSections(outline.sections);

    // Fill article step
    document.getElementById('article-html').value = a.content || '';
    document.getElementById('article-preview').innerHTML = a.content || '';

    // Fill SEO step
    document.getElementById('meta-title').value = a.meta_title || '';
    document.getElementById('meta-description').value = a.meta_description || '';
    document.getElementById('slug').value = a.slug || '';
    document.getElementById('tags-list').value = tags.join(', ');

    document.getElementById('meta-title').dispatchEvent(new Event('input'));
    document.getElementById('meta-description').dispatchEvent(new Event('input'));

    // Go to article step (3) so user can review
    if (a.content) {
        goToStep(3);
    } else if (outline.sections) {
        goToStep(2);
    } else {
        goToStep(1);
    }
}

async function deleteArticle() {
    if (!currentArticleDetail) return;
    if (!confirm('Na pewno usunac ten artykul?')) return;
    try {
        await apiDelete(`/api/articles/${currentArticleDetail.id}`);
        currentArticleDetail = null;
        loadArticles();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

// --- Generator ---
let genState = {
    uploadedFiles: [],
};

function initGenerator() {
    document.getElementById('gen-target-length').addEventListener('change', (e) => {
        document.getElementById('gen-target-length-custom').classList.toggle('hidden', e.target.value !== 'custom');
    });

    document.getElementById('gen-result-seo-title').addEventListener('input', (e) => {
        document.getElementById('gen-seo-title-count').textContent = `${e.target.value.length}/60`;
    });
    document.getElementById('gen-result-meta-desc').addEventListener('input', (e) => {
        document.getElementById('gen-meta-desc-count').textContent = `${e.target.value.length}/155`;
    });

    const fileInput = document.getElementById('gen-source-files');
    const dropZone = document.getElementById('gen-file-drop-zone');
    fileInput.addEventListener('change', () => genHandleFileUpload(fileInput.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        genHandleFileUpload(e.dataTransfer.files);
    });
}

async function genHandleFileUpload(fileList) {
    if (!fileList.length) return;
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    showLoading('Przetwarzam pliki...');
    try {
        const resp = await fetch(`${API}/api/upload-files`, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Upload error');
        const data = await resp.json();
        for (const f of data.files) {
            if (!genState.uploadedFiles.find(u => u.filename === f.filename)) {
                genState.uploadedFiles.push(f);
            }
        }
        genRenderUploadedFiles();
    } catch (e) {
        alert('Blad uploadu: ' + e.message);
    } finally {
        hideLoading();
        document.getElementById('gen-source-files').value = '';
    }
}

function genRenderUploadedFiles() {
    const container = document.getElementById('gen-uploaded-files-list');
    if (!genState.uploadedFiles.length) { container.innerHTML = ''; return; }
    container.innerHTML = '<div style="padding:8px 4px 4px">' + genState.uploadedFiles.map((f, i) => {
        const cls = f.error ? 'file-chip error' : 'file-chip ok';
        const info = f.error ? f.error : `${f.chars} znakow`;
        return `<span class="${cls}">${escapeHtml(f.filename)} (${info}) <span class="remove" onclick="genRemoveFile(${i})">x</span></span>`;
    }).join('') + '</div>';
}

function genRemoveFile(idx) {
    genState.uploadedFiles.splice(idx, 1);
    genRenderUploadedFiles();
}

function genGetFileTexts() {
    return genState.uploadedFiles.filter(f => f.text).map(f => f.text);
}

function genGetFormData() {
    const styleSel = document.getElementById('gen-style-select');
    const styleOption = styleSel.selectedOptions[0];
    const styleDesc = styleOption && styleOption.dataset.desc ? decodeURIComponent(styleOption.dataset.desc) : '';
    const customStyle = document.getElementById('gen-style-custom').value.trim();

    const lengthSel = document.getElementById('gen-target-length');
    let targetLength = parseInt(lengthSel.value);
    if (lengthSel.value === 'custom') {
        targetLength = parseInt(document.getElementById('gen-target-length-custom').value) || 1200;
    }

    const urls = document.getElementById('gen-source-urls').value.trim()
        .split('\n').map(u => u.trim()).filter(u => u);

    return {
        topic: document.getElementById('gen-topic').value.trim(),
        source_urls: urls,
        style_description: customStyle || styleDesc || 'Informacyjny',
        paragraphs_min: parseInt(document.getElementById('gen-paragraphs-min').value) || 4,
        paragraphs_max: parseInt(document.getElementById('gen-paragraphs-max').value) || 8,
        include_intro: document.getElementById('gen-include-intro').checked,
        include_summary: document.getElementById('gen-include-summary').checked,
        additional_notes: document.getElementById('gen-additional-notes').value.trim(),
        language: document.getElementById('gen-language').value,
        model: document.getElementById('gen-ai-model').value,
        target_length: targetLength,
        generate_tags: document.getElementById('gen-generate-tags').checked,
        tags_min: parseInt(document.getElementById('gen-tags-min').value) || 3,
        tags_max: parseInt(document.getElementById('gen-tags-max').value) || 8,
        generate_seo: document.getElementById('gen-generate-seo').checked,
    };
}

async function runGenerator() {
    const form = genGetFormData();
    if (!form.topic && !form.source_urls.length && !genGetFileTexts().length) {
        return alert('Podaj temat, linki zrodlowe lub dodaj pliki');
    }

    try {
        // Step 1: Generate outline
        showLoading('Generuje outline...');
        const outlineData = await apiPost('/api/outline', { ...form, file_texts: genGetFileTexts() });
        const outline = outlineData.outline;

        // Step 2: Generate article
        showLoading('Generuje tresc artykulu... To moze potrwac chwile.');
        const articleData = await apiPost('/api/generate-content', {
            outline,
            source_urls: form.source_urls,
            file_texts: genGetFileTexts(),
            style_description: form.style_description,
            additional_notes: form.additional_notes,
            language: form.language,
            model: form.model,
            target_length: form.target_length,
        });

        // Step 3: SEO & tags (parallel)
        showLoading('Generuje SEO i tagi...');
        const promises = [];
        if (form.generate_seo) {
            promises.push(apiPost('/api/seo-meta', {
                title: outline.title, content: articleData.content,
                language: form.language, model: form.model,
            }));
        } else {
            promises.push(Promise.resolve({ meta_title: '', meta_description: '' }));
        }

        if (form.generate_tags) {
            promises.push(apiPost('/api/tags', {
                title: outline.title, content: articleData.content,
                tags_min: form.tags_min, tags_max: form.tags_max,
                language: form.language, model: form.model,
            }));
        } else {
            promises.push(Promise.resolve({ tags: [] }));
        }

        const [seoData, tagsData] = await Promise.all(promises);

        // Show results
        document.getElementById('gen-result-title').value = outline.title || form.topic;
        document.getElementById('gen-result-content').innerHTML = articleData.content;
        document.getElementById('gen-result-html').value = articleData.content;
        document.getElementById('gen-result-seo-title').value = seoData.meta_title || '';
        document.getElementById('gen-result-meta-desc').value = seoData.meta_description || '';
        document.getElementById('gen-result-tags').value = (tagsData.tags || []).join(', ');

        document.getElementById('gen-result-seo-title').dispatchEvent(new Event('input'));
        document.getElementById('gen-result-meta-desc').dispatchEvent(new Event('input'));

        document.getElementById('gen-form-section').classList.add('hidden');
        document.getElementById('gen-results').classList.remove('hidden');
        genLoadWpSites();
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function genExecCmd(cmd, value) {
    document.execCommand(cmd, false, value || null);
    document.getElementById('gen-result-content').focus();
}

function genToggleHtml() {
    const editor = document.getElementById('gen-result-content');
    const textarea = document.getElementById('gen-result-html');
    const btn = document.getElementById('gen-html-toggle');

    if (textarea.classList.contains('hidden')) {
        textarea.value = editor.innerHTML;
        editor.classList.add('hidden');
        textarea.classList.remove('hidden');
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
    } else {
        editor.innerHTML = textarea.value;
        textarea.classList.add('hidden');
        editor.classList.remove('hidden');
        btn.style.background = '';
        btn.style.color = '';
    }
}

function genCopyAll() {
    const title = document.getElementById('gen-result-title').value;
    const editor = document.getElementById('gen-result-content');
    const html = editor.classList.contains('hidden')
        ? document.getElementById('gen-result-html').value
        : editor.innerHTML;
    const seoTitle = document.getElementById('gen-result-seo-title').value;
    const metaDesc = document.getElementById('gen-result-meta-desc').value;
    const tags = document.getElementById('gen-result-tags').value;

    const text = `TYTUL:\n${title}\n\nTRESC (HTML):\n${html}\n\nSEO TITLE:\n${seoTitle}\n\nMETA DESCRIPTION:\n${metaDesc}\n\nTAGI:\n${tags}`;
    navigator.clipboard.writeText(text).then(() => alert('Skopiowano do schowka!')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('Skopiowano do schowka!');
    });
}

function genDownloadHtml() {
    const title = document.getElementById('gen-result-title').value;
    const editor = document.getElementById('gen-result-content');
    const html = editor.classList.contains('hidden')
        ? document.getElementById('gen-result-html').value
        : editor.innerHTML;
    const seoTitle = document.getElementById('gen-result-seo-title').value;
    const metaDesc = document.getElementById('gen-result-meta-desc').value;
    const tags = document.getElementById('gen-result-tags').value;

    const fullHtml = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(seoTitle || title)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<meta name="keywords" content="${escapeHtml(tags)}">
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${html}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'artykul').replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';
    a.click();
    URL.revokeObjectURL(url);
}

async function genLoadWpSites() {
    try {
        const data = await apiGet('/api/wp-sites');
        const sel = document.getElementById('gen-wp-site');
        if (!data.sites.length) {
            sel.innerHTML = '<option value="">Brak serwisow - dodaj w Ustawieniach</option>';
        } else {
            sel.innerHTML = data.sites.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${escapeHtml(s.url)})</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to load WP sites for generator', e);
    }
}

async function genPublishToWp() {
    const wpSite = document.getElementById('gen-wp-site').value;
    if (!wpSite) return alert('Wybierz serwis WordPress');

    const title = document.getElementById('gen-result-title').value;
    const editor = document.getElementById('gen-result-content');
    const content = editor.classList.contains('hidden')
        ? document.getElementById('gen-result-html').value
        : editor.innerHTML;
    const tagNames = document.getElementById('gen-result-tags').value
        .split(',').map(t => t.trim()).filter(t => t);
    const metaTitle = document.getElementById('gen-result-seo-title').value;
    const metaDesc = document.getElementById('gen-result-meta-desc').value;
    const publishStatus = document.getElementById('gen-publish-status').value;

    showLoading('Publikuje na WordPress...');
    try {
        const result = await apiPost('/api/publish', {
            wp_site: wpSite,
            title,
            content,
            category_ids: [],
            tag_names: tagNames,
            meta_title: metaTitle,
            meta_description: metaDesc,
            slug: '',
            featured_image_url: null,
            publish_status: publishStatus,
        });

        await apiPost('/api/articles', {
            title,
            content,
            outline: {},
            meta_title: metaTitle,
            meta_description: metaDesc,
            slug: '',
            tags: tagNames,
            categories: [],
            wp_site: wpSite,
            settings: {},
        });

        const resultDiv = document.getElementById('gen-publish-result');
        resultDiv.classList.remove('hidden');
        resultDiv.innerHTML = `
            <div class="success-box">
                <p>Opublikowano!</p>
                <p>Post ID: ${result.id} | Status: ${result.status}</p>
                ${result.link ? `<a href="${result.link}" target="_blank">${result.link}</a>` : ''}
            </div>
        `;
    } catch (e) {
        alert('Blad publikacji: ' + e.message);
    } finally {
        hideLoading();
    }
}

function genReset() {
    document.getElementById('gen-results').classList.add('hidden');
    document.getElementById('gen-form-section').classList.remove('hidden');
    document.getElementById('gen-publish-result').classList.add('hidden');
}

function renderGenStyleSelect() {
    const sel = document.getElementById('gen-style-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- wybierz szablon --</option>' +
        state.styles.map(s => `<option value="${s.id}" data-desc="${encodeURIComponent(s.description)}">${escapeHtml(s.name)}</option>`).join('');
}

// --- Keyword Research ---
async function runKeywordResearch() {
    const keyword = document.getElementById('kw-keyword').value.trim();
    if (!keyword) return alert('Wpisz slowo kluczowe');

    showLoading('Szukam slow kluczowych...');
    try {
        const data = await apiPost('/api/keyword-research', {
            keyword,
            language: document.getElementById('kw-language').value,
        });

        document.getElementById('kw-results').classList.remove('hidden');

        document.getElementById('kw-suggestions').innerHTML = (data.suggestions || []).map(s =>
            `<span class="cat-chip" data-kw="${escapeHtml(s)}" style="cursor:pointer">${escapeHtml(s)}</span>`
        ).join('') || '<span style="color:var(--text-muted);font-size:13px">Brak wynikow</span>';
        document.querySelectorAll('#kw-suggestions .cat-chip[data-kw]').forEach(el =>
            el.addEventListener('click', () => kwCopyToClipboard(el.dataset.kw))
        );

        document.getElementById('kw-related').innerHTML = (data.related || []).map(s =>
            `<span class="cat-chip" data-kw="${escapeHtml(s)}" style="cursor:pointer">${escapeHtml(s)}</span>`
        ).join('') || '<span style="color:var(--text-muted);font-size:13px">Brak wynikow</span>';
        document.querySelectorAll('#kw-related .cat-chip[data-kw]').forEach(el =>
            el.addEventListener('click', () => kwCopyToClipboard(el.dataset.kw))
        );

        if (data.trends && data.trends.length) {
            document.getElementById('kw-trends').innerHTML = data.trends.map(t => `
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
                    <div style="flex:1;font-size:13px">${escapeHtml(t.query)}</div>
                    <div style="width:120px;background:var(--bg-input);border-radius:3px;height:6px;overflow:hidden">
                        <div style="height:100%;background:var(--green);width:${t.value}%"></div>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);width:30px;text-align:right">${t.value}</div>
                </div>
            `).join('');
        } else {
            document.getElementById('kw-trends').innerHTML = '<span style="color:var(--text-muted);font-size:13px">Brak danych trendow (wymaga pytrends)</span>';
        }
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function kwCopyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {}).catch(() => {});
}

// --- Content Score ---
async function wizContentScore() {
    const content = getWizArticleHtml();
    const title = state.outlineData?.title || document.getElementById('topic').value;
    if (!content) return alert('Brak tresci artykulu');

    showLoading('Analizuje jakosc artykulu...');
    try {
        const data = await apiPost('/api/content-score', {
            title,
            content,
            keywords: [],
            language: document.getElementById('language').value,
            model: document.getElementById('ai-model').value,
        });
        renderScoreResult('wiz-score-result', data);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function renderScoreResult(containerId, data) {
    const el = document.getElementById(containerId);
    el.classList.remove('hidden');
    const scoreColor = data.score >= 70 ? 'var(--green)' : data.score >= 40 ? '#e67e22' : 'var(--red)';
    el.innerHTML = `
        <div class="card" style="margin-bottom:0">
            <div class="card-title">Analiza jakosci</div>
            <div style="display:flex;gap:24px;margin-bottom:12px;flex-wrap:wrap">
                <div style="text-align:center">
                    <div style="font-size:32px;font-weight:700;color:${scoreColor}">${data.score || 0}</div>
                    <div style="font-size:11px;color:var(--text-muted)">Ogolna</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:32px;font-weight:700;color:${scoreColor}">${data.seo_score || 0}</div>
                    <div style="font-size:11px;color:var(--text-muted)">SEO</div>
                </div>
                <div style="font-size:13px;color:var(--text-secondary);display:flex;flex-direction:column;gap:2px">
                    <span>Slow: ${data.word_count} | H2: ${data.h2_count} | H3: ${data.h3_count}</span>
                    <span>Linki: ${data.link_count} | Obrazki: ${data.img_count} | Akapity: ${data.paragraph_count}</span>
                    <span>Czytelnosc: ${data.readability || '-'}</span>
                </div>
            </div>
            ${(data.tips || []).length ? '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">WSKAZOWKI</div>' +
                data.tips.map(t => `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:4px">• ${escapeHtml(t)}</p>`).join('') : ''}
        </div>
    `;
}

// --- Rewrite ---
async function runRewrite() {
    const url = document.getElementById('rw-source-url').value.trim();
    const text = document.getElementById('rw-source-text').value.trim();
    if (!url && !text) return alert('Podaj URL lub wklej tekst');

    const styleSel = document.getElementById('rw-style-select');
    const styleOption = styleSel.selectedOptions[0];
    const styleDesc = styleOption && styleOption.dataset.desc ? decodeURIComponent(styleOption.dataset.desc) : '';
    const customStyle = document.getElementById('rw-style-custom').value.trim();

    showLoading('Przepisuje artykul... To moze potrwac chwile.');
    try {
        const data = await apiPost('/api/rewrite', {
            source_url: url,
            source_text: text,
            style_description: customStyle || styleDesc || 'Informacyjny',
            additional_notes: document.getElementById('rw-additional-notes').value.trim(),
            language: document.getElementById('rw-language').value,
            model: document.getElementById('rw-ai-model').value,
            target_length: parseInt(document.getElementById('rw-target-length').value) || 1200,
        });

        document.getElementById('rw-result-title').value = data.title;
        document.getElementById('rw-result-content').innerHTML = data.content;
        document.getElementById('rw-result-html').value = data.content;
        document.getElementById('rewrite-form-section').classList.add('hidden');
        document.getElementById('rewrite-results').classList.remove('hidden');
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function rwExecCmd(cmd, value) {
    document.execCommand(cmd, false, value || null);
    document.getElementById('rw-result-content').focus();
}

function rwToggleHtml() {
    const editor = document.getElementById('rw-result-content');
    const textarea = document.getElementById('rw-result-html');
    const btn = document.getElementById('rw-html-toggle');
    if (textarea.classList.contains('hidden')) {
        textarea.value = editor.innerHTML;
        editor.classList.add('hidden');
        textarea.classList.remove('hidden');
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
    } else {
        editor.innerHTML = textarea.value;
        textarea.classList.add('hidden');
        editor.classList.remove('hidden');
        btn.style.background = '';
        btn.style.color = '';
    }
}

function rwCopyAll() {
    const editor = document.getElementById('rw-result-content');
    const html = editor.classList.contains('hidden')
        ? document.getElementById('rw-result-html').value
        : editor.innerHTML;
    navigator.clipboard.writeText(html).then(() => alert('Skopiowano HTML!')).catch(() => {});
}

async function rwScoreContent() {
    const editor = document.getElementById('rw-result-content');
    const content = editor.classList.contains('hidden')
        ? document.getElementById('rw-result-html').value
        : editor.innerHTML;
    const title = document.getElementById('rw-result-title').value;

    showLoading('Analizuje jakosc...');
    try {
        const data = await apiPost('/api/content-score', {
            title, content, keywords: [],
            language: document.getElementById('rw-language').value,
            model: document.getElementById('rw-ai-model').value,
        });
        renderScoreResult('rw-score-result', data);
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function rwReset() {
    document.getElementById('rewrite-results').classList.add('hidden');
    document.getElementById('rewrite-form-section').classList.remove('hidden');
    document.getElementById('rw-score-result').classList.add('hidden');
}

function initRewrite() {
    const sel = document.getElementById('rw-style-select');
    if (sel) {
        sel.innerHTML = '<option value="">-- wybierz --</option>' +
            state.styles.map(s => `<option value="${s.id}" data-desc="${encodeURIComponent(s.description)}">${escapeHtml(s.name)}</option>`).join('');
    }
}

// --- Structure Templates ---
let structureTemplates = [];

async function loadStructureTemplates() {
    try {
        const data = await apiGet('/api/structure-templates');
        structureTemplates = data.templates || [];
        renderStructureTemplatesList();
        renderStructureTemplateSelect();
    } catch (e) {
        console.error('Failed to load structure templates', e);
    }
}

function renderStructureTemplatesList() {
    const container = document.getElementById('structure-templates-list');
    if (!container) return;
    if (!structureTemplates.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Brak szablonow struktury</p>';
        return;
    }
    container.innerHTML = structureTemplates.map(t => `
        <div class="list-item">
            <div class="list-item-info">
                <p>${escapeHtml(t.name)}</p>
                <p>${escapeHtml(t.description)}</p>
            </div>
            <div class="list-item-actions">
                <button onclick="deleteStructureTemplate(${t.id})" class="btn-danger">Usun</button>
            </div>
        </div>
    `).join('');
}

function renderStructureTemplateSelect() {
    const sel = document.getElementById('structure-template-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- brak, wygeneruj automatycznie --</option>' +
        structureTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function applyStructureTemplate() {
    const sel = document.getElementById('structure-template-select');
    const tplId = parseInt(sel.value);
    if (!tplId) return;

    const tpl = structureTemplates.find(t => t.id === tplId);
    if (!tpl) return;

    const structure = typeof tpl.structure === 'string' ? JSON.parse(tpl.structure) : tpl.structure;
    if (structure.sections) {
        // Pre-fill outline when user reaches step 2
        state._pendingStructure = structure.sections;
    }
}

async function createStructureTemplate() {
    const name = document.getElementById('new-struct-name').value.trim();
    const desc = document.getElementById('new-struct-desc').value.trim();
    const sectionsJson = document.getElementById('new-struct-sections').value.trim();
    if (!name || !sectionsJson) return alert('Podaj nazwe i sekcje');

    try {
        const sections = JSON.parse(sectionsJson);
        await apiPost('/api/structure-templates', { name, description: desc, structure: { sections } });
        document.getElementById('new-struct-name').value = '';
        document.getElementById('new-struct-desc').value = '';
        document.getElementById('new-struct-sections').value = '';
        loadStructureTemplates();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

async function deleteStructureTemplate(id) {
    if (!confirm('Na pewno usunac?')) return;
    try {
        await apiDelete(`/api/structure-templates/${id}`);
        loadStructureTemplates();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

// --- Image Gallery ---
async function generateImageGallery() {
    const title = state.outlineData?.title || document.getElementById('topic').value;
    if (!title) return alert('Brak tytulu');

    showLoading('Generuje obrazki (to moze potrwac)...');
    try {
        const data = await apiPost('/api/image-gallery', { title, count: 4 });
        const gallery = document.getElementById('image-gallery');
        const grid = document.getElementById('image-gallery-grid');
        gallery.classList.remove('hidden');
        grid.innerHTML = data.images.map(url =>
            `<img src="${url}" data-gallery-url="${escapeHtml(url)}" style="width:100%;border-radius:6px;cursor:pointer;border:2px solid transparent;transition:border 0.1s">`
        ).join('');
        grid.querySelectorAll('img[data-gallery-url]').forEach(img =>
            img.addEventListener('click', () => selectGalleryImage(img.dataset.galleryUrl, img))
        );
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function selectGalleryImage(url, el) {
    state.featuredImageUrl = url;
    document.getElementById('featured-image-preview').innerHTML =
        `<img src="${url}" style="max-height:200px;border-radius:8px">`;
    // Highlight selected
    document.querySelectorAll('#image-gallery-grid img').forEach(img => img.style.borderColor = 'transparent');
    el.style.borderColor = 'var(--green)';
}

// --- Analytics ---
async function loadAnalytics() {
    const site = document.getElementById('analytics-wp-site').value;
    if (!site) return alert('Wybierz serwis WordPress');

    showLoading('Laduje statystyki...');
    try {
        const data = await apiGet(`/api/wp-sites/${encodeURIComponent(site)}/analytics`);
        document.getElementById('analytics-data').classList.remove('hidden');
        document.getElementById('stat-published').textContent = data.total_published;
        document.getElementById('stat-drafts').textContent = data.total_drafts;
        document.getElementById('stat-scheduled').textContent = data.total_scheduled;
        document.getElementById('stat-categories').textContent = data.total_categories;

        document.getElementById('analytics-posts-list').innerHTML = data.recent_posts.map(p => `
            <div class="list-item" style="margin-bottom:6px">
                <div class="list-item-info">
                    <p>${escapeHtml(p.title)}</p>
                    <p>${p.date} | ${p.status} | ${p.comments} komentarzy</p>
                </div>
                <div class="list-item-actions">
                    ${p.link ? `<a href="${p.link}" target="_blank" class="btn-secondary" style="font-size:11px;padding:4px 8px;text-decoration:none">Otworz</a>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        alert('Blad: ' + e.message);
    } finally {
        hideLoading();
    }
}

function initAnalytics() {
    apiGet('/api/wp-sites').then(data => {
        const sel = document.getElementById('analytics-wp-site');
        sel.innerHTML = '<option value="">-- wybierz --</option>' +
            data.sites.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    }).catch(() => {});
}

// --- Image Styles ---
let imageStyles = [];

async function loadImageStyles() {
    try {
        const data = await apiGet('/api/image-styles');
        imageStyles = data.styles || [];
        renderImageStyleSelects();
        renderImageStylesList();
    } catch (e) {
        console.error('Failed to load image styles', e);
    }
}

function renderImageStyleSelects() {
    const selectors = ['wiz-image-style', 'bulk-image-style'];
    for (const id of selectors) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        sel.innerHTML = imageStyles.map((s, i) =>
            `<option value="${escapeHtml(s.name)}"${i === 0 ? ' selected' : ''}>${escapeHtml(s.name)}</option>`
        ).join('') || '<option value="">Brak stylow</option>';
    }
}

function renderImageStylesList() {
    const container = document.getElementById('image-styles-list');
    if (!container) return;
    if (!imageStyles.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Brak stylow zdjec</p>';
        return;
    }
    container.innerHTML = imageStyles.map(s => `
        <div class="list-item" style="margin-bottom:6px">
            <div class="list-item-info">
                <p>${escapeHtml(s.name)}</p>
                <p style="font-size:11px;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.prompt)}</p>
            </div>
            <div class="list-item-actions">
                <button onclick="deleteImageStyle(${s.id})" class="btn-danger">Usun</button>
            </div>
        </div>
    `).join('');
}

async function addImageStyle() {
    const name = document.getElementById('new-imgstyle-name').value.trim();
    const prompt = document.getElementById('new-imgstyle-prompt').value.trim();
    if (!name || !prompt) return alert('Podaj nazwe i prompt');
    try {
        await apiPost('/api/image-styles', { name, prompt });
        document.getElementById('new-imgstyle-name').value = '';
        document.getElementById('new-imgstyle-prompt').value = '';
        loadImageStyles();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

async function deleteImageStyle(id) {
    if (!confirm('Na pewno usunac ten styl?')) return;
    try {
        await apiDelete(`/api/image-styles/${id}`);
        loadImageStyles();
    } catch (e) {
        alert('Blad: ' + e.message);
    }
}

// --- Bulk Generation ---
let bulkCancelled = false;
let bulkUploadedFiles = [];

function initBulk() {
    const sel = document.getElementById('bulk-style-select');
    if (sel) {
        sel.innerHTML = '<option value="">-- wybierz szablon --</option>' +
            state.styles.map(s => `<option value="${s.id}" data-desc="${encodeURIComponent(s.description)}">${escapeHtml(s.name)}</option>`).join('');
    }
    apiGet('/api/wp-sites').then(data => {
        const wpSel = document.getElementById('bulk-wp-site');
        if (wpSel) {
            wpSel.innerHTML = '<option value="">-- bez publikacji --</option>' +
                data.sites.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${escapeHtml(s.url)})</option>`).join('');
        }
    }).catch(() => {});

    // File upload
    const fileInput = document.getElementById('bulk-source-files');
    const dropZone = document.getElementById('bulk-file-drop-zone');
    if (fileInput) {
        fileInput.addEventListener('change', () => bulkHandleFileUpload(fileInput.files));
    }
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            bulkHandleFileUpload(e.dataTransfer.files);
        });
    }

    // Image style toggle
    const imgCheck = document.getElementById('bulk-generate-image');
    if (imgCheck) {
        imgCheck.addEventListener('change', () => {
            document.getElementById('bulk-image-style-row').classList.toggle('hidden', !imgCheck.checked);
        });
    }

    // Live distribution preview
    const topicsEl = document.getElementById('bulk-topics');
    const totalEl = document.getElementById('bulk-total-articles');
    if (topicsEl) topicsEl.addEventListener('input', bulkUpdatePreview);
    if (totalEl) totalEl.addEventListener('input', bulkUpdatePreview);
    bulkUpdatePreview();
}

function bulkToggleSchedule() {
    const status = document.getElementById('bulk-publish-status').value;
    document.getElementById('bulk-schedule-range').classList.toggle('hidden', status !== 'future');
}

function bulkRandomDate(from, to) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    const rand = new Date(start + Math.random() * (end - start));
    const h = Math.floor(Math.random() * 14) + 7; // 07:00-21:00
    const m = Math.floor(Math.random() * 60);
    rand.setHours(h, m, 0, 0);
    return rand.toISOString().slice(0, 19);
}

async function bulkHandleFileUpload(fileList) {
    if (!fileList.length) return;
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    showLoading('Przetwarzam pliki...');
    try {
        const resp = await fetch(`${API}/api/upload-files`, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Upload error');
        const data = await resp.json();
        for (const f of data.files) {
            if (!bulkUploadedFiles.find(u => u.filename === f.filename)) {
                bulkUploadedFiles.push(f);
            }
        }
        bulkRenderUploadedFiles();
    } catch (e) {
        alert('Blad uploadu: ' + e.message);
    } finally {
        hideLoading();
        document.getElementById('bulk-source-files').value = '';
    }
}

function bulkRenderUploadedFiles() {
    const container = document.getElementById('bulk-uploaded-files-list');
    if (!bulkUploadedFiles.length) { container.innerHTML = ''; return; }
    container.innerHTML = '<div style="padding:8px 4px 4px">' + bulkUploadedFiles.map((f, i) => {
        const cls = f.error ? 'file-chip error' : 'file-chip ok';
        const info = f.error ? f.error : `${f.chars} znakow`;
        return `<span class="${cls}">${escapeHtml(f.filename)} (${info}) <span class="remove" onclick="bulkRemoveFile(${i})">x</span></span>`;
    }).join('') + '</div>';
}

function bulkRemoveFile(idx) {
    bulkUploadedFiles.splice(idx, 1);
    bulkRenderUploadedFiles();
}

function bulkDistribute(phrases, total) {
    // Round-robin: distribute total articles across phrases
    const dist = phrases.map(() => 0);
    for (let i = 0; i < total; i++) {
        dist[i % phrases.length]++;
    }
    return dist;
}

function bulkUpdatePreview() {
    const text = document.getElementById('bulk-topics').value.trim();
    const phrases = text ? text.split('\n').map(t => t.trim()).filter(t => t) : [];
    const total = parseInt(document.getElementById('bulk-total-articles').value) || 1;
    const preview = document.getElementById('bulk-distribution-preview');
    if (!phrases.length) { preview.textContent = ''; return; }
    const dist = bulkDistribute(phrases, total);
    preview.textContent = dist.map((n, i) => `"${phrases[i].substring(0, 25)}${phrases[i].length > 25 ? '...' : ''}" × ${n}`).join(', ');
}

async function runBulkGeneration() {
    const phrasesText = document.getElementById('bulk-topics').value.trim();
    if (!phrasesText) return alert('Wpisz przynajmniej jedna fraze kluczowa');

    const phrases = phrasesText.split('\n').map(t => t.trim()).filter(t => t);
    if (!phrases.length) return alert('Wpisz przynajmniej jedna fraze kluczowa');

    const totalArticles = parseInt(document.getElementById('bulk-total-articles').value) || phrases.length;
    const distribution = bulkDistribute(phrases, totalArticles);

    const styleSel = document.getElementById('bulk-style-select');
    const styleOption = styleSel.selectedOptions[0];
    const styleDesc = styleOption && styleOption.dataset.desc ? decodeURIComponent(styleOption.dataset.desc) : '';
    const customStyle = document.getElementById('bulk-style-custom').value.trim();

    // Source URLs
    const sourceUrls = document.getElementById('bulk-source-urls').value.trim()
        .split('\n').map(u => u.trim()).filter(u => u);

    // File texts from uploaded PDFs
    const fileTexts = bulkUploadedFiles.filter(f => f.text).map(f => f.text);

    // Custom links
    const customLinksText = document.getElementById('bulk-custom-links').value.trim();
    const customLinks = customLinksText ? customLinksText.split('\n').map(l => l.trim()).filter(l => l) : [];
    const linksPerArticle = parseInt(document.getElementById('bulk-links-count').value) || 3;

    // Tag range
    const tagRange = document.getElementById('bulk-tag-range').value.split('-');
    const tagsMin = parseInt(tagRange[0]) || 4;
    const tagsMax = parseInt(tagRange[1]) || 8;

    // Enrichments - build "type:count" strings from checkboxes
    const enrichments = [];
    if (document.getElementById('bulk-enrich-lists').checked)
        enrichments.push('lists:' + document.getElementById('bulk-enrich-lists-count').value);
    if (document.getElementById('bulk-enrich-quotes').checked)
        enrichments.push('quotes:' + document.getElementById('bulk-enrich-quotes-count').value);
    if (document.getElementById('bulk-enrich-faq').checked)
        enrichments.push('faq:' + document.getElementById('bulk-enrich-faq-count').value);
    if (document.getElementById('bulk-enrich-table').checked)
        enrichments.push('table');
    if (document.getElementById('bulk-enrich-tips').checked)
        enrichments.push('tips:' + document.getElementById('bulk-enrich-tips-count').value);
    if (document.getElementById('bulk-enrich-summary').checked)
        enrichments.push('summary');

    // Scheduling
    const publishStatus = document.getElementById('bulk-publish-status').value;
    const dateFrom = document.getElementById('bulk-date-from').value;
    const dateTo = document.getElementById('bulk-date-to').value;

    const settings = {
        model: document.getElementById('bulk-ai-model').value,
        language: document.getElementById('bulk-language').value,
        style_description: customStyle || styleDesc || 'Informacyjny',
        target_length: parseInt(document.getElementById('bulk-target-length').value) || 1200,
        additional_notes: document.getElementById('bulk-additional-notes').value.trim(),
        generate_tags: document.getElementById('bulk-generate-tags').checked,
        generate_seo: document.getElementById('bulk-generate-seo').checked,
        generate_image: document.getElementById('bulk-generate-image').checked,
        tags_min: tagsMin,
        tags_max: tagsMax,
        cats_min: parseInt(document.getElementById('bulk-cats-min').value) || 1,
        cats_max: parseInt(document.getElementById('bulk-cats-max').value) || 3,
        enrichments: enrichments,
        image_style: document.getElementById('bulk-image-style').value,
        wp_site: document.getElementById('bulk-wp-site').value,
        publish_status: publishStatus,
        source_urls: sourceUrls,
        file_texts: fileTexts,
        custom_links: customLinks,
        links_per_article: linksPerArticle,
    };

    // Build task list from distribution
    const tasks = [];
    for (let p = 0; p < phrases.length; p++) {
        for (let n = 0; n < distribution[p]; n++) {
            tasks.push(phrases[p]);
        }
    }

    const totalTasks = tasks.length;
    bulkCancelled = false;
    document.getElementById('btn-bulk-run').disabled = true;
    document.getElementById('btn-bulk-cancel').classList.remove('hidden');
    document.getElementById('bulk-progress').classList.remove('hidden');
    document.getElementById('bulk-results-list').innerHTML = '';

    const bulkStartTime = Date.now();
    const articleTimes = []; // track time per article for ETA
    const generatedTitles = []; // track titles to avoid duplicates

    function bulkEta(done, total) {
        if (!articleTimes.length) return '';
        const avgMs = articleTimes.reduce((a, b) => a + b, 0) / articleTimes.length;
        const remainMs = avgMs * (total - done);
        if (remainMs < 60000) return `~${Math.round(remainMs / 1000)}s`;
        return `~${Math.round(remainMs / 60000)} min`;
    }

    for (let i = 0; i < totalTasks; i++) {
        if (bulkCancelled) break;
        const articleStart = Date.now();

        const phrase = tasks[i];
        const pct = Math.round(((i) / totalTasks) * 100);
        document.getElementById('bulk-progress-bar').style.width = pct + '%';
        document.getElementById('bulk-progress-text').textContent = `Artykul ${i + 1} z ${totalTasks}`;
        document.getElementById('bulk-progress-step').textContent = `Krok 1/6: Generuje tytul dla frazy "${phrase}"...`;
        document.getElementById('bulk-progress-eta').textContent = i > 0 ? `ETA: ${bulkEta(i, totalTasks)}` : '';

        // Step 1: Generate topic from keyword phrase (with deduplication)
        let topic = phrase;
        try {
            const topicData = await apiPost('/api/generate-topic', {
                keyword: phrase,
                language: settings.language,
                model: settings.model,
                avoid_titles: generatedTitles,
            });
            topic = topicData.topic || phrase;
        } catch (e) {
            // Fallback: use phrase as topic
        }

        document.getElementById('bulk-progress-step').textContent = `Krok 2/6: Generuje artykul "${topic.substring(0, 50)}${topic.length > 50 ? '...' : ''}"...`;

        // Per-article scheduled date
        let scheduledDate = '';
        if (publishStatus === 'future' && dateFrom && dateTo) {
            scheduledDate = bulkRandomDate(dateFrom, dateTo);
        }

        try {
            const result = await apiPost('/api/generate-single', {
                topic,
                ...settings,
                scheduled_date: scheduledDate,
            });

            articleTimes.push(Date.now() - articleStart);
            generatedTitles.push(result.title);

            const dateInfo = scheduledDate ? ` | ${scheduledDate.replace('T', ' ').substring(0, 16)}` : '';
            document.getElementById('bulk-results-list').innerHTML += `
                <div class="list-item" style="margin-bottom:6px">
                    <div class="list-item-info">
                        <p>${escapeHtml(result.title)}</p>
                        <p style="font-size:11px">Fraza: "${escapeHtml(phrase)}" | ${result.published ? 'Opublikowano' : 'Zapisano'}${dateInfo} ${result.wp_link ? `| <a href="${result.wp_link}" target="_blank">Link</a>` : ''}</p>
                    </div>
                    <span class="status-set">OK</span>
                </div>
            `;
        } catch (e) {
            document.getElementById('bulk-results-list').innerHTML += `
                <div class="list-item" style="margin-bottom:6px">
                    <div class="list-item-info">
                        <p>Fraza: "${escapeHtml(phrase)}" | Temat: "${escapeHtml(topic)}"</p>
                        <p>${escapeHtml(e.message)}</p>
                    </div>
                    <span class="status-unset">BLAD</span>
                </div>
            `;
        }
    }

    document.getElementById('bulk-progress-bar').style.width = '100%';
    const done = document.querySelectorAll('#bulk-results-list .status-set').length;
    const errors = document.querySelectorAll('#bulk-results-list .status-unset').length;
    const totalTime = Math.round((Date.now() - bulkStartTime) / 1000);
    const timeStr = totalTime >= 60 ? `${Math.floor(totalTime / 60)} min ${totalTime % 60}s` : `${totalTime}s`;
    document.getElementById('bulk-progress-eta').textContent = `Czas: ${timeStr}`;
    document.getElementById('bulk-progress-step').textContent = '';
    document.getElementById('bulk-progress-text').textContent = bulkCancelled
        ? `Anulowano. ${done} OK, ${errors} bledow z ${totalTasks} artykulow.`
        : `Gotowe! ${done} artykulow wygenerowanych z ${phrases.length} fraz.${errors ? ` ${errors} bledow.` : ''}`;
    document.getElementById('btn-bulk-run').disabled = false;
    document.getElementById('btn-bulk-cancel').classList.add('hidden');
}

function cancelBulk() {
    bulkCancelled = true;
}

// --- Dark Mode ---
function toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('rankpost-theme', newTheme);
    updateThemeUI(newTheme);
}

function updateThemeUI(theme) {
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    const label = document.getElementById('theme-label');
    if (theme === 'dark') {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
        label.textContent = 'Jasny motyw';
    } else {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
        label.textContent = 'Ciemny motyw';
    }
}

// Init theme on load
(function() {
    const saved = localStorage.getItem('rankpost-theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
        // UI update after DOM ready
        document.addEventListener('DOMContentLoaded', () => updateThemeUI(saved));
    }
})();

// --- Utils ---
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
