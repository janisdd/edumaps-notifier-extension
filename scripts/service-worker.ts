/// <reference path="../node_modules/chrome-types/index.d.ts"/>


let isEnabled = false;
//keep track of tabs that have the helper injected
let injectedTabsSet = new Set<number>()

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed")
})

function updateBadge() {
	chrome.action.setBadgeText({ text: isEnabled ? "ON" : "OFF" });
	chrome.action.setBadgeBackgroundColor({ color: isEnabled ? "#0f0" : "#f00" });
  }


type NotificationTuple = {
	notificationId: string
	boxId: string
	boxWrapId: string
	sourceTabId: number
}

let newlyCreatedBoxIds: string[] = []
let notificationTuples: Array<NotificationTuple> = []

// Add this listener
chrome.runtime.onMessage.addListener((message: SiteNewBoxMessage, sender) => {

	if (!isEnabled) {
		return false
	}

	if (message.type === 'BOX_CREATED' && sender.tab?.id) {
		let boxId = message.boxId as string
		newlyCreatedBoxIds.push(boxId)
		createNewBoxNotification(boxId, message.boxWrapId, sender.tab.id)
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

  notificationTuples.push({notificationId: nId, boxId: boxId, boxWrapId: boxWrapId, sourceTabId: sourceTabId})

}


chrome.notifications.onClicked.addListener((notificationId: string) => {

	if (!isEnabled) {
		return
	}

	let tuple = notificationTuples.find(p => p.notificationId === notificationId)
	
	if (!tuple) {
		console.error("notification clicked but no tuple found, notificationId: " + notificationId)
		return
	}

	const message: BoxChangedListClickedMessage = {
		action: 'showBox',
		boxId: tuple.boxId,
		tabId: tuple.sourceTabId
	}

	chrome.tabs.sendMessage(tuple.sourceTabId, message); 
	// injectHelper(tuple.sourceTabId)

	// chrome.scripting.executeScript({
	// 	target: { tabId: tuple.sourceTabId },
	// 	args: [tuple.boxWrapId],
	// 	func: (boxWrapId: string) => {
	// 		// window.anchor_scroll_done = false
	// 		// window.edu_anchor_scroll_to_box(boxWrapId, -1, false, null)
	// 		// console.log("scroll to box done for tab " + tuple.sourceTabId)
	// 		console.log("calling edu_anchor_scroll_to_box for tab " + boxWrapId)
	// 		document.dispatchEvent(
	// 			new CustomEvent("callEduAnchorScroll", { detail: { boxWrapId } })
	// 		  )
	// 	}
	//   });

})

chrome.notifications.onClosed.addListener((notificationId, byUser) => {
	console.log("notification closed, notificationId: " + notificationId)
	let index = notificationTuples.findIndex(p => p.notificationId === notificationId)
	notificationTuples.splice(index, 1)
})

//not needed or used
function injectHelper(tabId: number) {
	injectedTabsSet.add(tabId)
	chrome.scripting.executeScript({
	  target: { tabId },
	  files: ["injections/injected.js"]   // <- injects the file
	});
  }


  //when the extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
	console.log("tab clicked, tab id: " + tab.id)
	if (!tab.id) {
		console.error("tab clicked but no tab id found")
		return
	}
	isEnabled = !isEnabled;  // Toggle
	// if (isEnabled) {
	// 	injectHelper(tab.id)
	// }
	updateBadge();

  })

  //TODO currently only works with one tab...

  // Reset badge when tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {

	if (injectedTabsSet.has(tabId)) {
		injectedTabsSet.delete(tabId)
		isEnabled = false
		updateBadge()
	}
  })
  
  // Reset badge when tab is reloaded (status changes to 'complete')
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete") {
		if (injectedTabsSet.has(tabId)) {
			injectedTabsSet.delete(tabId)
			isEnabled = false
			updateBadge()
		}
	}
  });