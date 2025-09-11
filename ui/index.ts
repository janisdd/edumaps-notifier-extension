/// <reference path="../node_modules/chrome-types/index.d.ts"/>

type BoxData = {
    boxId: string
    changed: Date
}

type PopupChangeEntry = {
    type: 'added' | 'removed'
    boxId: string
    at: string // ISO string
}

/**
 * return the date in hh:ss - dd.MM.yy format
 */
function formatData(date: Date): string {
    let hours = date.getHours().toString().padStart(2, '0')
    let minutes = date.getMinutes().toString().padStart(2, '0')
    let day = date.getDate().toString().padStart(2, '0')
    let month = (date.getMonth() + 1).toString().padStart(2, '0') // Monate sind 0-indexiert
    let year = date.getFullYear().toString().slice(-2) // Nur die letzten zwei Ziffern des Jahres

    return `${hours}:${minutes} - ${day}.${month}.${year}`
}


function createBoxChangedEntry(boxData: BoxData) {
	const log = createPopupLogger('createBoxChangedEntry')
	log.debug('start', { boxId: boxData.boxId })
    let boxTemplate = `
    <div class="box-item" id="${boxData.boxId}">
        <div class="content">
            Box mit Id ${boxData.boxId} wurde geändert
        </div>

        <div class="time">
            ${formatData(boxData.changed)}
        </div>
    </div>
`
    log.debug('done')
}

function renderChangeEntry(entry: PopupChangeEntry): string {
    const cls = entry.type === 'removed' ? 'box-item removed' : 'box-item'
    const label = entry.type === 'removed' ? 'Entfernte Box' : 'Neue Box'
    const when = formatData(new Date(entry.at))
    return `<div class="${cls}" data-box-id="${entry.boxId}"><div class="content">${label}: ${entry.boxId}</div><div class="time">${when}</div></div>`
}

function renderChangeList(entries: PopupChangeEntry[]): string {
    return entries.map(renderChangeEntry).join('')
}

function attachAddedItemClickHandlers() {
    const items = document.querySelectorAll('#added-boxes-list .box-item') as NodeListOf<HTMLDivElement>
    items.forEach(item => {
        item.onclick = () => {
            const id = item.getAttribute('data-box-id')
            if (!id) return
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0]
                if (!tab || typeof tab.id !== 'number') return
                const tabId = tab.id
                const message: BoxChangedListClickedMessage = { action: 'showBox', boxId: id, tabId }
                popupLog.info('sending showBox to content script', { boxId: id, tabId })
                chrome.tabs.sendMessage(tabId, message)
            })
        }
    })
}

function addClickListener(boxData: BoxData) {
    const log = createPopupLogger('addClickListener')
    let el = document.getElementById(boxData.boxId)
    if (el) {
        el.addEventListener('click', () => {
            log.info('clicked', { boxId: boxData.boxId })

            chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
                const activeTab = tabs[0]
                const tabId = activeTab && typeof activeTab.id === 'number' ? activeTab.id : undefined
                if (typeof tabId !== 'number') { log.warn('no active tab id'); return }
                const message: BoxChangedListClickedMessage = {
                    action: 'showBox',
                    boxId: boxData.boxId,
                    tabId: tabId
                }
                chrome.tabs.sendMessage(tabId, message)
            })
        })
    }
}


// Simple structured logger for this file
function createPopupLogger(namespace: string) {
	const base = (level: 'debug' | 'info' | 'warn' | 'error') => (...args: any[]) => {
		const ts = new Date().toISOString()
		const prefix = `[${ts}] [popup]` + (namespace ? ` [${namespace}]` : '')
		const method = level === 'debug' ? console.debug
			: level === 'info' ? console.info
			: level === 'warn' ? console.warn
			: console.error
		method(prefix, ...args)
	}
	return { debug: base('debug'), info: base('info'), warn: base('warn'), error: base('error') }
}

const popupLog = createPopupLogger('');

// Fixed popup height in pixels; lists will scroll within this height
const LIST_HEIGHT_PX: number = 500;

// Only show UI when current tab URL starts with this
const EDU_URL_PREFIX = 'https://www.edumaps.de';

function isEduUrl(url: string | undefined): boolean {
    return typeof url === 'string' && url.startsWith(EDU_URL_PREFIX)
}

function toggleUiVisibility(showEduUi: boolean) {
    const edu = document.getElementById('edu-ui') as HTMLDivElement | null
    const notEdu = document.getElementById('not-edu') as HTMLDivElement | null
    if (edu) edu.style.display = showEduUi ? 'block' : 'none'
    if (notEdu) notEdu.style.display = showEduUi ? 'none' : 'block'
}

(chrome.runtime.onMessage.addListener as any)((message: SiteNewBoxMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    popupLog.debug('onMessage(SiteNewBoxMessage): received', message)

    if (message.type === 'BOX_CREATED') {
        const entry: PopupChangeEntry = { type: 'added', boxId: message.boxId, at: message.createdAt }
        const container = document.getElementById('added-boxes-list')
        if (container) {
            container.innerHTML = renderChangeEntry(entry) + container.innerHTML
            attachAddedItemClickHandlers()
        }
        chrome.storage.local.get('popupChangedList', (items) => {
            const list = Array.isArray(items['popupChangedList']) ? (items['popupChangedList'] as PopupChangeEntry[]) : []
            chrome.storage.local.set({ popupChangedList: [...list, entry] }, () => {})
        })
    }

    if ((message as any)?.type === 'NEW_BOXES_FOUND') {
        // Re-render the added list from storage and update the timestamp label
        const addedListEl = document.getElementById('added-boxes-list') as HTMLDivElement | null
        chrome.storage.local.get(['popupChangedList'], (items) => {
            const list = Array.isArray(items['popupChangedList']) ? (items['popupChangedList'] as PopupChangeEntry[]) : []
            if (addedListEl) {
                addedListEl.innerHTML = renderChangeList(list)
                attachAddedItemClickHandlers()
            }
        })
        const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
        chrome.storage.local.get('capturedBoxesStateAt', (st) => {
            const iso = st['capturedBoxesStateAt'] as string | undefined
            if (iso && lastCapturedAtEl) {
                const d = new Date(iso)
                lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(d)}`
            }
        })
    }

    return false
})

// UI wiring for popup actions
document.addEventListener('DOMContentLoaded', () => {
    popupLog.info('DOMContentLoaded')
    // Expose popup height to CSS so only lists scroll within
    document.documentElement.style.setProperty('--popup-height', LIST_HEIGHT_PX + 'px')

    let eduUiInitialized = false

    function initEduUI() {
        if (eduUiInitialized) return
        eduUiInitialized = true

        const captureBtn = document.getElementById('capture-state') as HTMLButtonElement | null
        const clearBtn = document.getElementById('clear-state') as HTMLButtonElement | null
        const compareBtn = document.getElementById('compare-state') as HTMLButtonElement | null
        const autoReloadEnabled = document.getElementById('auto-reload-enabled') as HTMLInputElement | null
        const autoReloadMinutes = document.getElementById('auto-reload-minutes') as HTMLInputElement | null

        function getActiveTabId(): Promise<number> {
            return new Promise((resolve, reject) => {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    const tab = tabs[0]
                    if (tab && tab.id !== undefined) resolve(tab.id)
                    else reject(new Error('No active tab'))
                })
            })
        }

        // Enable/disable compare based on baseline presence
        function refreshCompareEnabled() {
            chrome.storage.local.get('capturedBoxesState', (items) => {
                const hasBaseline = Boolean(items['capturedBoxesState'])
                if (compareBtn) compareBtn.disabled = !hasBaseline
            })
        }

        // Load current auto-reload state
        ;(chrome.runtime.sendMessage as any)({ action: 'GET_AUTO_RELOAD_STATE' } as GetAutoReloadStateMessage, (resp: GetAutoReloadStateResponse) => {
            popupLog.debug('GET_AUTO_RELOAD_STATE response', resp)
            if (autoReloadMinutes) autoReloadMinutes.value = String(Math.max(1, resp?.minutes ?? 5))
            if (autoReloadEnabled) autoReloadEnabled.checked = Boolean(resp?.enabled)
        })
        refreshCompareEnabled()
        captureBtn?.addEventListener('click', async () => {
            popupLog.info('capture-state clicked')
            try {
                const tabId = await getActiveTabId()
                chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STATE' } as CaptureStateMessage, undefined, (resp: CaptureStateResponse) => {
                    popupLog.info('Captured response', resp)
                    refreshCompareEnabled()
                    // update last captured time label
                    const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
                    const now = new Date()
                    if (lastCapturedAtEl) lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(now)}`
                    // refresh current boxes list in UI immediately
                    loadCurrentBoxes()
                    // switch to "Aktuelle Boxen" tab after capture
                    activateTab('current')
                })
            } catch (e) {
                popupLog.warn('capture-state failed', e)
            }
        })

        // Load persisted added/removed boxes list from JSON and render
        const addedList = document.getElementById('added-boxes-list') as HTMLDivElement | null
        chrome.storage.local.get('popupChangedList', (items) => {
            const list = Array.isArray(items['popupChangedList']) ? (items['popupChangedList'] as PopupChangeEntry[]) : []
            if (addedList && list.length > 0) {
                addedList.innerHTML = renderChangeList(list)
                attachAddedItemClickHandlers()
            }
        })

        // Load current boxes into Current tab
        loadCurrentBoxes()

        // Load last captured timestamp
        const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
        chrome.storage.local.get('capturedBoxesStateAt', (items) => {
            const iso = items['capturedBoxesStateAt'] as string | undefined
            if (iso && lastCapturedAtEl) {
                const d = new Date(iso)
                lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(d)}`
            }
        })

        clearBtn?.addEventListener('click', async () => {
            popupLog.info('clear-state clicked')
            // clear stored baseline and popup list JSON
            chrome.storage.local.remove(['capturedBoxesState', 'capturedBoxesStateAt', 'popupChangedList', 'popupChangedListHtml'], () => { refreshCompareEnabled() })
            const list = document.getElementById('added-boxes-list') as HTMLDivElement | null
            if (list) list.innerHTML = ''
            const currentList = document.getElementById('current-boxes-list') as HTMLDivElement | null
            if (currentList) currentList.innerHTML = ''
            const lastCapturedAtEl2 = document.getElementById('last-captured-at') as HTMLSpanElement | null
            if (lastCapturedAtEl2) lastCapturedAtEl2.innerText = ''
        })

        compareBtn?.addEventListener('click', async () => {
            popupLog.info('compare-state clicked')
            try {
                const tabId = await getActiveTabId()
                chrome.tabs.sendMessage(tabId, { action: 'COMPARE_STATE' } as CompareStateMessage, undefined, (resp: CompareStateResponse) => {
                    popupLog.info('Compared response', resp)
                    const list = document.getElementById('added-boxes-list')
                    if (!list || !resp) return
                    // clear old entries before showing new ones
                    ;(list as HTMLDivElement).innerHTML = ''
                    const now = new Date()
                    const jsonEntries: PopupChangeEntry[] = [
                        ...resp.addedBoxIds.map(id => ({ type: 'added' as const, boxId: id, at: now.toISOString() })),
                        ...resp.removedBoxIds.map(id => ({ type: 'removed' as const, boxId: id, at: now.toISOString() })),
                    ]
                    ;(list as HTMLDivElement).innerHTML = renderChangeList(jsonEntries)
                    attachAddedItemClickHandlers()
                    chrome.storage.local.set({ popupChangedList: jsonEntries })
                    // update last captured time label
                    const lastCapturedAtEl3 = document.getElementById('last-captured-at') as HTMLSpanElement | null
                    if (lastCapturedAtEl3) lastCapturedAtEl3.innerText = `Letzter Vergleich: ${formatData(now)}`
                    // switch to "Neue Boxen" tab after comparing
                    activateTab('added')
                })
            } catch (e) {
                popupLog.warn('compare-state failed', e)
            }
        })

        function persistAutoReload() {
            const minutes = Math.max(1, Number(autoReloadMinutes?.value ?? 5))
            const enabled = Boolean(autoReloadEnabled?.checked)
            popupLog.info('persistAutoReload', { enabled, minutes })
            ;(chrome.runtime.sendMessage as any)({ action: 'SET_AUTO_RELOAD', enabled, minutes } as SetAutoReloadMessage, () => {})
        }

        autoReloadEnabled?.addEventListener('change', persistAutoReload)
        autoReloadMinutes?.addEventListener('change', persistAutoReload)

        function attachAddedItemClickHandlers() {
            const items = document.querySelectorAll('#added-boxes-list .box-item') as NodeListOf<HTMLDivElement>
            items.forEach(item => {
                item.onclick = async () => {
                    const id = item.getAttribute('data-box-id')
                    if (!id) return
                    try {
                        const tabId = await getActiveTabId()
                        const message: BoxChangedListClickedMessage = { action: 'showBox', boxId: id, tabId }
                        popupLog.info('sending showBox to content script', { boxId: id, tabId })
                        chrome.tabs.sendMessage(tabId, message)
                    } catch {}
                }
            })
        }

        function attachCurrentItemClickHandlers() {
            const items = document.querySelectorAll('#current-boxes-list .box-item') as NodeListOf<HTMLDivElement>
            items.forEach(item => {
                item.onclick = async () => {
                    const id = item.getAttribute('data-box-id')
                    if (!id) return
                    try {
                        const tabId = await getActiveTabId()
                        const message: BoxChangedListClickedMessage = { action: 'showBox', boxId: id, tabId }
                        popupLog.info('sending showBox to content script', { boxId: id, tabId })
                        chrome.tabs.sendMessage(tabId, message)
                    } catch {}
                }
            })
        }

        function renderCurrentBoxes(boxes: Array<{ id: string; title: string }>) {
            const list = document.getElementById('current-boxes-list') as HTMLDivElement | null
            if (!list) return
            const now = new Date()
            const entries = boxes.map(b => `<div class=\"box-item\" data-box-id=\"${b.id}\"><div class=\"content\">${b.title || b.id}</div><div class=\"time\">${formatData(now)}</div></div>`)
            list.innerHTML = entries.join('')
            attachCurrentItemClickHandlers()
        }

        function loadCurrentBoxes() {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                const tab = tabs[0]
                if (!tab || typeof tab.id !== 'number') return
                const tabId = tab.id
                chrome.tabs.sendMessage(tabId, { action: 'GET_CURRENT_BOXES' } as GetCurrentBoxesMessage, undefined, (resp: GetCurrentBoxesResponse) => {
                    if (!resp || !resp.ok) return
                    renderCurrentBoxes(resp.boxes)
                })
            })
        }

        // Tab switching wiring
        const tabCurrent = document.getElementById('tab-current') as HTMLButtonElement | null
        const tabAdded = document.getElementById('tab-added') as HTMLButtonElement | null
        const panelCurrent = document.getElementById('panel-current') as HTMLDivElement | null
        const panelAdded = document.getElementById('panel-added') as HTMLDivElement | null

        function activateTab(which: 'current' | 'added') {
            tabCurrent?.classList.toggle('active', which === 'current')
            tabAdded?.classList.toggle('active', which === 'added')
            panelCurrent?.classList.toggle('active', which === 'current')
            panelAdded?.classList.toggle('active', which === 'added')
        }

        tabCurrent?.addEventListener('click', () => activateTab('current'))
        tabAdded?.addEventListener('click', () => activateTab('added'))

        // expose functions used inside init to outer scope for later refresh
        ;(window as any)._edu_loadCurrentBoxes = loadCurrentBoxes
    }

    function refreshUiForActiveTab() {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            const tab = tabs[0]
            const url = tab?.url
            const isEdu = isEduUrl(url)
            toggleUiVisibility(isEdu)
            if (isEdu) {
                initEduUI()
                if ((window as any)._edu_loadCurrentBoxes) {
                    try { (window as any)._edu_loadCurrentBoxes() } catch {}
                }
            }
        })
    }

    // Listen to active tab switches and URL updates while popup is open
    chrome.tabs.onActivated.addListener(() => refreshUiForActiveTab())
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
        if (!tab || !tab.active) return
        if (typeof changeInfo.url === 'string' || changeInfo.status === 'complete') {
            refreshUiForActiveTab()
        }
    })

    // Initial render
    refreshUiForActiveTab()

    // Keep UI in sync with background updates while popup is open
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return
        if (changes['popupChangedList']) {
            const list = Array.isArray(changes['popupChangedList'].newValue) ? (changes['popupChangedList'].newValue as PopupChangeEntry[]) : []
            const addedListEl = document.getElementById('added-boxes-list') as HTMLDivElement | null
            if (addedListEl) {
                addedListEl.innerHTML = renderChangeList(list)
                attachAddedItemClickHandlers()
            }
        }
        if (changes['capturedBoxesStateAt']) {
            const iso = changes['capturedBoxesStateAt'].newValue as string | undefined
            const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
            if (iso && lastCapturedAtEl) {
                const d = new Date(iso)
                lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(d)}`
            }
        }
    })
})

