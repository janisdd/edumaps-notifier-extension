/// <reference path="../node_modules/chrome-types/index.d.ts"/>


chrome.runtime.onInstalled.addListener(() => {
  console.log("[service-worker] Extension installed")
})


type SwBox = {
	wrapId: string
	id: string
	title: string
	top: number
	left: number
}

type NotificationTuple = {
	notificationId: string
	boxId: string
	boxWrapId: string
	sourceTabId: number
}

// Map of boxId -> chrome notificationId
let newBoxNotificationMap: Record<string, string> = {}
// Flag used to distinguish automatic baseline capture from manual capture
let isAutoCapturingBaseline = false
// let notificationTuples: Array<NotificationTuple> = []

const STORAGE_AUTO_RELOAD_ENABLED = 'autoReloadEnabled'
const STORAGE_AUTO_RELOAD_MINUTES = 'autoReloadMinutes'
const ALARM_AUTO_RELOAD = 'autoReloadAlarm'

const SW_STORAGE_CAPTURED_STATE_KEY = 'capturedBoxesState'
const SW_STORAGE_CAPTURED_STATE_AT_KEY = 'capturedBoxesStateAt'

// Simple structured logger for this file
function createSwLogger(namespace: string) {
	const base = (level: 'debug' | 'info' | 'warn' | 'error') => (...args: any[]) => {
		const ts = new Date().toISOString()
		const prefix = `[${ts}] [service-worker]` + (namespace ? ` [${namespace}]` : '')
		const method = level === 'debug' ? console.debug
			: level === 'info' ? console.info
			: level === 'warn' ? console.warn
			: console.error
		method(prefix, ...args)
	}
	return { debug: base('debug'), info: base('info'), warn: base('warn'), error: base('error') }
}

const log = createSwLogger('')

// Helpers to manage notification map and lifecycle
async function clearNewBoxNotificationsAndMap() {
	const l = createSwLogger('clearNewBoxNotificationsAndMap')
	try {
		const ids = Object.values(newBoxNotificationMap)
		if (ids.length > 0) l.info('clearing notifications', { count: ids.length })
		await Promise.all(ids.map(id => {
			return new Promise<void>((resolve) => {
				try {
					chrome.notifications.clear(id, () => resolve())
				} catch {
					resolve()
				}
			})
		}))
	} finally {
		newBoxNotificationMap = {}
	}
}

function clearNewBoxMapOnly() {
	newBoxNotificationMap = {}
}

// Clear notifications and map whenever a new baseline is captured (manual capture writes this key)
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local') return
	if (changes && changes[SW_STORAGE_CAPTURED_STATE_KEY]) {
		const l = createSwLogger('storage.onChanged')
		if (isAutoCapturingBaseline) {
			l.info('captured state changed (auto) -> clearing map only')
			clearNewBoxMapOnly()
		} else {
			l.info('captured state changed (manual) -> clearing notifications and map')
			clearNewBoxNotificationsAndMap()
		}
	}
})

// Add this listener
chrome.runtime.onMessage.addListener((message: SiteNewBoxMessage, sender) => {
	log.debug('onMessage(SiteNewBoxMessage): received', { type: (message as any)?.type, fromTab: sender.tab?.id })

	if (message.type === 'BOX_CREATED' && sender.tab?.id) {
		const boxId = message.boxId as string
		if (newBoxNotificationMap[boxId]) {
			log.debug('BOX_CREATED: notification already exists for box, skipping', { boxId })
			return false
		}
		log.info('BOX_CREATED: creating notification', { boxId, boxWrapId: message.boxWrapId, tabId: sender.tab.id })
		createNewBoxNotification(boxId, message.boxWrapId, sender.tab.id)
	}
	return false
})

// Also handle summary notifications for newly added boxes
chrome.runtime.onMessage.addListener((message: any) => {
	if (message && message.type === 'NEW_BOXES_FOUND' && typeof message.count === 'number' && message.count > 0) {
		log.info('NEW_BOXES_FOUND: creating summary notification', { count: message.count })
		chrome.notifications.create({
			type: 'basic',
			iconUrl: '/imgs/icon.png',
			title: 'Neue Boxen gefunden',
			message: `${message.count} neue Box(en) gefunden`,
			priority: 0,
		})
	}
	return false
})


async function createNewBoxNotification(boxId: string, boxWrapId: string, sourceTabId: number) {
const l = createSwLogger('createNewBoxNotification')
l.info('start', { boxId, boxWrapId, sourceTabId })
try {
let nId = await chrome.notifications.create({
    type: 'basic',
    iconUrl: '/imgs/icon.png',
    title: 'Neue Box gefunden',
    message: `Box mit id ${boxId} gefunden`,
    buttons: [{ title: 'Anzeigen' }],
    priority: 0,
  })
l.info('created', { notificationId: nId })
// Track mapping so we don't notify for the same box twice until baseline resets
newBoxNotificationMap[boxId] = nId
//   notificationTuples.push({notificationId: nId, boxId: boxId, boxWrapId: boxWrapId, sourceTabId: sourceTabId})
} catch (e) {
l.error('failed to create notification', e)
}
}


// chrome.notifications.onClicked.addListener((notificationId: string) => {

// 	let tuple = notificationTuples.find(p => p.notificationId === notificationId)
	
// 	if (!tuple) {
// 		console.error("notification clicked but no tuple found, notificationId: " + notificationId)
// 		return
// 	}

// 	const message: BoxChangedListClickedMessage = {
// 		action: 'showBox',
// 		boxId: tuple.boxId,
// 		tabId: tuple.sourceTabId
// 	}

// 	chrome.tabs.sendMessage(tuple.sourceTabId, message); 
// })

// chrome.notifications.onClosed.addListener((notificationId, byUser) => {
// 	console.log("notification closed, notificationId: " + notificationId)
// 	let index = notificationTuples.findIndex(p => p.notificationId === notificationId)
// 	notificationTuples.splice(index, 1)
// })


//TODO currently only works with one tab...

// --- Comparison logic owned by service worker ---

function diffBoxIds(prev: Record<string, SwBox> | undefined, current: Record<string, SwBox>): { added: string[]; removed: string[] } {
	const prevIds = new Set(Object.keys(prev || {}))
	const currentIds = new Set(Object.keys(current))
	const added: string[] = []
	const removed: string[] = []
	for (const id of currentIds) if (!prevIds.has(id)) added.push(id)
	for (const id of prevIds) if (!currentIds.has(id)) removed.push(id)
	return { added, removed }
}

async function compareWithBaseline(current: Record<string, SwBox>, updateBaseline: boolean): Promise<{ addedBoxIds: string[]; removedBoxIds: string[] }> {
	return new Promise((resolve) => {
		chrome.storage.local.get([SW_STORAGE_CAPTURED_STATE_KEY], (items) => {
			const prevMapObj = items[SW_STORAGE_CAPTURED_STATE_KEY] as Record<string, SwBox> | undefined
			const capturedAt = (new Date()).toISOString()
			if (updateBaseline && !prevMapObj) {
				chrome.storage.local.set({ [SW_STORAGE_CAPTURED_STATE_KEY]: current, [SW_STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, async () => {
					// New state captured (manual): clear notifications and map
					await clearNewBoxNotificationsAndMap()
					resolve({ addedBoxIds: [], removedBoxIds: [] })
				})
				return
			}
			const { added, removed } = diffBoxIds(prevMapObj, current)
			if (updateBaseline) {
				chrome.storage.local.set({ [SW_STORAGE_CAPTURED_STATE_KEY]: current, [SW_STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, async () => {
					// Use map to determine truly new boxes for summary; but baseline is being reset now
					const trulyNew = added.filter(id => !newBoxNotificationMap[id])
					if (trulyNew.length > 0) {
						const msg: NewBoxesFoundMessage = { type: 'NEW_BOXES_FOUND', count: trulyNew.length }
						log.info('compareWithBaseline: notifying NEW_BOXES_FOUND', { count: trulyNew.length })
						await chrome.runtime.sendMessage(msg)
					}
					// New state captured (manual): clear notifications and map
					await clearNewBoxNotificationsAndMap()
					resolve({ addedBoxIds: added, removedBoxIds: removed })
				})
			} else {
				chrome.storage.local.set({ [SW_STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, () => resolve({ addedBoxIds: added, removedBoxIds: removed }))
			}
		})
	})
}

// Handle compare requests and auto-compare from content script
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse: (response?: any) => void) => {
	if (!message || !('action' in message)) return false

	if (message.action === 'COMPARE_WITH_BASELINE') {
		const current = (message.currentMap || {}) as Record<string, SwBox>
		log.info('onMessage: COMPARE_WITH_BASELINE', { currentCount: Object.keys(current).length })
		compareWithBaseline(current, false).then((resp) => {
			sendResponse({ ok: true, addedBoxIds: resp.addedBoxIds, removedBoxIds: resp.removedBoxIds } as CompareStateResponse)
		})
		return true
	}

	if (message.action === 'AUTO_COMPARE') {
		const current = (message.currentMap || {}) as Record<string, SwBox>
		log.info('onMessage: AUTO_COMPARE', { currentCount: Object.keys(current).length })
		chrome.storage.local.get([SW_STORAGE_CAPTURED_STATE_KEY, 'initializeBaselineOnNextLoad'], (items) => {
			const hasBaseline = Boolean(items[SW_STORAGE_CAPTURED_STATE_KEY])
			const shouldInit = Boolean(items['initializeBaselineOnNextLoad'])
			if (!hasBaseline) {
				if (shouldInit) {
					log.info('AUTO_COMPARE: initializing baseline on next load flag present, capturing baseline')
					const capturedAt = (new Date()).toISOString()
					isAutoCapturingBaseline = true
					chrome.storage.local.set({ [SW_STORAGE_CAPTURED_STATE_KEY]: current, [SW_STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt, initializeBaselineOnNextLoad: false }, () => {
						// Automatic capture: if there are no new boxes (relative to map), clear the map.
						// In this branch baseline did not exist before, so treat as no new boxes and clear map only.
						clearNewBoxMapOnly()
						isAutoCapturingBaseline = false
					})
				}
				return false
			}
			const prev = items[SW_STORAGE_CAPTURED_STATE_KEY] as Record<string, SwBox>
			const { added } = diffBoxIds(prev, current)
			const trulyNew = added.filter(id => !newBoxNotificationMap[id])
			const now = new Date()
			if (trulyNew.length > 0) {
				chrome.storage.local.get(['popupChangedList'], (st) => {
					const prevList = Array.isArray(st['popupChangedList']) ? (st['popupChangedList'] as any[]) : []
					const newEntries = trulyNew.map(id => ({ type: 'added', boxId: id, at: now.toISOString() }))
					const merged = [...prevList, ...newEntries]
					chrome.storage.local.set({ popupChangedList: merged, [SW_STORAGE_CAPTURED_STATE_AT_KEY]: now.toISOString() }, () => {})
				})
				const msg: NewBoxesFoundMessage = { type: 'NEW_BOXES_FOUND', count: trulyNew.length }
				log.info('AUTO_COMPARE: notifying NEW_BOXES_FOUND', { count: trulyNew.length })
				chrome.runtime.sendMessage(msg)
			} else {
				chrome.storage.local.set({ [SW_STORAGE_CAPTURED_STATE_AT_KEY]: now.toISOString() }, () => {})
			}
			return false
		})
		return false
	}

	return false
})

// Manage auto-reload from popup
chrome.runtime.onMessage.addListener((message: SetAutoReloadMessage | GetAutoReloadStateMessage, sender, sendResponse: (response?: any) => void) => {
    if (!message || !('action' in message)) return false

    if (message.action === 'SET_AUTO_RELOAD') {
        const m = message as SetAutoReloadMessage
        log.info('SET_AUTO_RELOAD', { enabled: m.enabled, minutes: m.minutes })
        chrome.storage.local.set({ [STORAGE_AUTO_RELOAD_ENABLED]: m.enabled, [STORAGE_AUTO_RELOAD_MINUTES]: m.minutes }, () => {
            chrome.alarms.clear(ALARM_AUTO_RELOAD, () => {
                if (m.enabled && m.minutes >= 1) {
                    chrome.alarms.create(ALARM_AUTO_RELOAD, { periodInMinutes: Math.max(1, m.minutes) })
                }
                log.debug('SET_AUTO_RELOAD: alarm updated')
                sendResponse({ ok: true })
            })
        })
        return true
    }

    if (message.action === 'GET_AUTO_RELOAD_STATE') {
        log.debug('GET_AUTO_RELOAD_STATE')
        chrome.storage.local.get([STORAGE_AUTO_RELOAD_ENABLED, STORAGE_AUTO_RELOAD_MINUTES], (items) => {
            const enabled = Boolean(items[STORAGE_AUTO_RELOAD_ENABLED])
            const minutes = Number(items[STORAGE_AUTO_RELOAD_MINUTES] ?? 5)
            sendResponse({ enabled, minutes } as GetAutoReloadStateResponse)
        })
        return true
    }
    return false
})

// Alarm handler: reload the active tab if checkbox enabled
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name !== ALARM_AUTO_RELOAD) return
    log.info('onAlarm', { name: alarm.name })
    chrome.storage.local.get([STORAGE_AUTO_RELOAD_ENABLED], (items) => {
        if (!items[STORAGE_AUTO_RELOAD_ENABLED]) return
        // Find any edumaps tab (popup might be focused so active tab might be the popup's window)
        chrome.tabs.query({ url: ['https://www.edumaps.de/*'] }, (tabs) => {
            const target = tabs && tabs.length > 0 ? tabs[0] : undefined
            if (target && target.id) {
                // If no baseline exists, set a flag to initialize on next load
                chrome.storage.local.get('capturedBoxesState', (st) => {
                    const hasBaseline = Boolean(st['capturedBoxesState'])
                    if (!hasBaseline) {
                        log.info('onAlarm: no baseline, setting initialize flag and reloading', { tabId: target.id })
                        chrome.storage.local.set({ initializeBaselineOnNextLoad: true }, () => {
                            chrome.tabs.reload(target.id as number)
                        })
                    } else {
                        log.info('onAlarm: reloading tab', { tabId: target.id })
                        chrome.tabs.reload(target.id as number)
                    }
                })
            }
        })
    })
})