/// <reference path="../node_modules/chrome-types/index.d.ts"/>


chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed")
})


type NotificationTuple = {
	notificationId: string
	boxId: string
	boxWrapId: string
	sourceTabId: number
}

let newlyCreatedBoxIds: string[] = []
// let notificationTuples: Array<NotificationTuple> = []

const STORAGE_AUTO_RELOAD_ENABLED = 'autoReloadEnabled'
const STORAGE_AUTO_RELOAD_MINUTES = 'autoReloadMinutes'
const ALARM_AUTO_RELOAD = 'autoReloadAlarm'

// Add this listener
chrome.runtime.onMessage.addListener((message: SiteNewBoxMessage, sender) => {

	if (message.type === 'BOX_CREATED' && sender.tab?.id) {
		let boxId = message.boxId as string
		newlyCreatedBoxIds.push(boxId)
		createNewBoxNotification(boxId, message.boxWrapId, sender.tab.id)
	}
	return false
})

// Also handle summary notifications for newly added boxes
chrome.runtime.onMessage.addListener((message: any) => {
	if (message && message.type === 'NEW_BOXES_FOUND' && typeof message.count === 'number' && message.count > 0) {
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

let nId = await chrome.notifications.create({
    type: 'basic',
    iconUrl: '/imgs/icon.png',
    title: 'Neue Box gefunden',
    message: `Box mit id ${boxId} gefunden`,
    buttons: [{ title: 'Anzeigen' }],
    priority: 0,
  })

//   notificationTuples.push({notificationId: nId, boxId: boxId, boxWrapId: boxWrapId, sourceTabId: sourceTabId})

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

// Manage auto-reload from popup
chrome.runtime.onMessage.addListener((message: SetAutoReloadMessage | GetAutoReloadStateMessage, sender, sendResponse: (response?: any) => void) => {
    if (!message || !('action' in message)) return false

    if (message.action === 'SET_AUTO_RELOAD') {
        const m = message as SetAutoReloadMessage
        chrome.storage.local.set({ [STORAGE_AUTO_RELOAD_ENABLED]: m.enabled, [STORAGE_AUTO_RELOAD_MINUTES]: m.minutes }, () => {
            chrome.alarms.clear(ALARM_AUTO_RELOAD, () => {
                if (m.enabled && m.minutes >= 1) {
                    chrome.alarms.create(ALARM_AUTO_RELOAD, { periodInMinutes: Math.max(1, m.minutes) })
                }
                sendResponse({ ok: true })
            })
        })
        return true
    }

    if (message.action === 'GET_AUTO_RELOAD_STATE') {
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
                        chrome.storage.local.set({ initializeBaselineOnNextLoad: true }, () => {
                            chrome.tabs.reload(target.id as number)
                        })
                    } else {
                        chrome.tabs.reload(target.id as number)
                    }
                })
            }
        })
    })
})