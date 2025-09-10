/// <reference path="../node_modules/chrome-types/index.d.ts"/>

type BoxData = {
    boxId: string
    changed: Date
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
            Box mit Id ${boxData} wurde geändert
        </div>

        <div class="time">
            ${formatData(boxData.changed)}
        </div>
    </div>
`
    log.debug('done')
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

(chrome.runtime.onMessage.addListener as any)((message: SiteNewBoxMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    popupLog.debug('onMessage(SiteNewBoxMessage): received', message)

    if (message.type === 'BOX_CREATED') {
        let boxData: BoxData = {
            boxId: message.boxId,
            changed: new Date(message.createdAt)
        }

        let entry = createBoxChangedEntry(boxData)

        let container = document.getElementById('added-boxes-list')
        if (container) {
            container.innerHTML = entry + container.innerHTML
            addClickListener(boxData)
        }
    }

    return false
})

// UI wiring for popup actions
document.addEventListener('DOMContentLoaded', () => {
    popupLog.info('DOMContentLoaded')
    // Expose popup height to CSS so only lists scroll within
    document.documentElement.style.setProperty('--popup-height', LIST_HEIGHT_PX + 'px')
    const clearBtn = document.getElementById('clear-state') as HTMLButtonElement | null
    const compareBtn = document.getElementById('compare-state') as HTMLButtonElement | null
    const autoReloadEnabled = document.getElementById('auto-reload-enabled') as HTMLInputElement | null
    const autoReloadMinutes = document.getElementById('auto-reload-minutes') as HTMLInputElement | null

    function getActiveTabId(): Promise<number> {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0]
                if (tab && tab.id !== undefined) resolve(tab.id)
                else reject(new Error('No active tab'))
            })
        })
    }

    // Load current auto-reload state
    ;(chrome.runtime.sendMessage as any)({ action: 'GET_AUTO_RELOAD_STATE' } as GetAutoReloadStateMessage, (resp: GetAutoReloadStateResponse) => {
        popupLog.debug('GET_AUTO_RELOAD_STATE response', resp)
        if (autoReloadMinutes) autoReloadMinutes.value = String(Math.max(1, resp?.minutes ?? 5))
        if (autoReloadEnabled) autoReloadEnabled.checked = Boolean(resp?.enabled)
    })

    // Load persisted added boxes list
    const addedList = document.getElementById('added-boxes-list') as HTMLDivElement | null
    chrome.storage.local.get('popupChangedListHtml', (items) => {
        const html = items['popupChangedListHtml'] as string | undefined
        if (addedList && html) {
            addedList.innerHTML = html
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
        // clear stored baseline and popup list
        chrome.storage.local.remove(['capturedBoxesState', 'capturedBoxesStateAt', 'popupChangedListHtml'], () => {})
        const list = document.getElementById('added-boxes-list') as HTMLDivElement | null
        if (list) list.innerHTML = ''
        const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
        if (lastCapturedAtEl) lastCapturedAtEl.innerText = ''
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
                const entries: string[] = []
                for (const id of resp.addedBoxIds) {
                    entries.push(`<div class=\"box-item\" data-box-id=\"${id}\"><div class=\"content\">Neue Box: ${id}</div><div class=\"time\">${formatData(now)}</div></div>`) 
                }
                for (const id of resp.removedBoxIds) {
                    entries.push(`<div class=\"box-item removed\" data-box-id=\"${id}\"><div class=\"content\">Entfernte Box: ${id}</div><div class=\"time\">${formatData(now)}</div></div>`) 
                }
                ;(list as HTMLDivElement).innerHTML = entries.join('')
                attachAddedItemClickHandlers()
                chrome.storage.local.set({ popupChangedListHtml: (list as HTMLDivElement).innerHTML })
                // update last captured time label
                if (lastCapturedAtEl) lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(now)}`
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
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
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
})

