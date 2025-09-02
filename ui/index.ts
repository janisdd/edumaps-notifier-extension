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
}

function addClickListener(boxData: BoxData) {
    let el = document.getElementById(boxData.boxId)
    if (el) {
        el.addEventListener('click', () => {
            console.log(`Box with id ${boxData.boxId} clicked`)

            chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
                const activeTab = tabs[0]
                const tabId = activeTab && typeof activeTab.id === 'number' ? activeTab.id : undefined
                if (typeof tabId !== 'number') return
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

(chrome.runtime.onMessage.addListener as any)((message: SiteNewBoxMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    console.log(message)

    if (message.type === 'BOX_CREATED') {
        let boxData: BoxData = {
            boxId: message.boxId,
            changed: new Date(message.createdAt)
        }

        let entry = createBoxChangedEntry(boxData)

        let container = document.getElementById('changed-boxes-list')
        if (container) {
            container.innerHTML = entry + container.innerHTML
            addClickListener(boxData)
        }
    }

    return false
})

// UI wiring for popup actions
document.addEventListener('DOMContentLoaded', () => {
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
        if (autoReloadMinutes) autoReloadMinutes.value = String(Math.max(1, resp?.minutes ?? 5))
        if (autoReloadEnabled) autoReloadEnabled.checked = Boolean(resp?.enabled)
    })

    // Load persisted changed boxes list
    const list = document.getElementById('changed-boxes-list') as HTMLDivElement | null
    chrome.storage.local.get('popupChangedListHtml', (items) => {
        const html = items['popupChangedListHtml'] as string | undefined
        if (list && html) {
            list.innerHTML = html
            attachItemClickHandlers()
        }
    })

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
        // clear stored baseline and popup list
        chrome.storage.local.remove(['capturedBoxesState', 'capturedBoxesStateAt', 'popupChangedListHtml'], () => {})
        const list = document.getElementById('changed-boxes-list') as HTMLDivElement | null
        if (list) list.innerHTML = ''
        const lastCapturedAtEl = document.getElementById('last-captured-at') as HTMLSpanElement | null
        if (lastCapturedAtEl) lastCapturedAtEl.innerText = ''
    })

    compareBtn?.addEventListener('click', async () => {
        try {
            const tabId = await getActiveTabId()
            chrome.tabs.sendMessage(tabId, { action: 'COMPARE_STATE' } as CompareStateMessage, undefined, (resp: CompareStateResponse) => {
                console.log('Compared', resp)
                const list = document.getElementById('changed-boxes-list')
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
                attachItemClickHandlers()
                chrome.storage.local.set({ popupChangedListHtml: (list as HTMLDivElement).innerHTML })
                // update last captured time label
                if (lastCapturedAtEl) lastCapturedAtEl.innerText = `Letzter Vergleich: ${formatData(now)}`
            })
        } catch (e) {
            console.warn(e)
        }
    })

    function persistAutoReload() {
        const minutes = Math.max(1, Number(autoReloadMinutes?.value ?? 5))
        const enabled = Boolean(autoReloadEnabled?.checked)
        ;(chrome.runtime.sendMessage as any)({ action: 'SET_AUTO_RELOAD', enabled, minutes } as SetAutoReloadMessage, () => {})
    }

    autoReloadEnabled?.addEventListener('change', persistAutoReload)
    autoReloadMinutes?.addEventListener('change', persistAutoReload)

    function attachItemClickHandlers() {
        const items = document.querySelectorAll('.changed-boxes-list .box-item') as NodeListOf<HTMLDivElement>
        items.forEach(item => {
            item.onclick = async () => {
                const id = item.getAttribute('data-box-id')
                if (!id) return
                try {
                    const tabId = await getActiveTabId()
                    const message: BoxChangedListClickedMessage = { action: 'showBox', boxId: id, tabId }
                    chrome.tabs.sendMessage(tabId, message)
                } catch {}
            }
        })
    }
})

