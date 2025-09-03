type Box = {
	wrapId: string
	id: string
	title: string
	top: number
	left: number
}


type ChangeInfo = {
	addedBoxes: Box[]
	removedBoxes: Box[]
	allBoxes: Box[]
	allBoxesMap: Map<string, Box>
}

let allKnownBoxesByBoxId = new Map<string, Box>()
let allKnownBoxesArray: Box[] = []

const STORAGE_CAPTURED_STATE_KEY = 'capturedBoxesState'
const STORAGE_CAPTURED_STATE_AT_KEY = 'capturedBoxesStateAt'

// Simple structured logger for this file (scoped per file)
function createContentLogger(namespace: string) {
	const base = (level: 'debug' | 'info' | 'warn' | 'error') => (...args: any[]) => {
		const ts = new Date().toISOString()
		const prefix = `[${ts}] [content-script]` + (namespace ? ` [${namespace}]` : '')
		// Map to appropriate console method
		const method = level === 'debug' ? console.debug
			: level === 'info' ? console.info
			: level === 'warn' ? console.warn
			: console.error
		method(prefix, ...args)
	}
	return {
		debug: base('debug'),
		info: base('info'),
		warn: base('warn'),
		error: base('error'),
	}
}

const csLog = createContentLogger('')

function getAllBoxes(): Box[] {
	csLog.debug('getAllBoxes: start')
	const allBoxeWraps = Array.from(document.querySelectorAll(`#main-content .box-wrap`)) as HTMLDivElement[]
	const allBoxes: Box[] = []

	for (let i = 0; i < allBoxeWraps.length; i++) {
		const boxWrapDiv = allBoxeWraps[i]
		const boxWrapId = boxWrapDiv.getAttribute("id")

		if (!boxWrapId) {
			csLog.warn('getAllBoxes: box wrapper without id found, skipping')
			continue
		}

		const boxDiv = boxWrapDiv.querySelector(".box-item") as HTMLDivElement

		const boxLabelEl = boxDiv.querySelector(".boxlabel") as HTMLElement
		const boxTitle = boxLabelEl.innerText

		const boxId = boxDiv.getAttribute("data-boxid")

		if (!boxId) {
			csLog.warn('getAllBoxes: box without id found, skipping')
			continue
		}

		let rect = boxDiv.getBoundingClientRect()
		const box: Box = {
			wrapId: boxWrapId,
			id: boxId,
			title: boxTitle,
			top: rect.top,
			left: rect.left
		}
		allBoxes.push(box)
		
	}

	csLog.info('getAllBoxes: done', { count: allBoxes.length })
	return allBoxes
}


function boxesToMap(boxes: Box[]): Map<string, Box> {
	csLog.debug('boxesToMap: start', { count: boxes.length })
	const map = new Map<string, Box>()

	for (let i = 0; i < boxes.length; i++) {
		const box = boxes[i]
		map.set(box.id, box)
	}

	csLog.debug('boxesToMap: done', { count: map.size })
	return map
}

function getAllBoxesData(): { boxes: Box[], boxesMap: Map<string, Box> } {
	csLog.debug('getAllBoxesData: start')
	const currBoxes = getAllBoxes()
	const currBoxesMap = boxesToMap(currBoxes)

	const result = {
		boxes: currBoxes,
		boxesMap: currBoxesMap
	}
	csLog.debug('getAllBoxesData: done', { boxes: result.boxes.length })
	return result
}

function compareBoxStates(): ChangeInfo | null {
	csLog.debug('compareBoxStates: start')
	const currBoxes = getAllBoxes()
	const currBoxesMap = boxesToMap(currBoxes)

	if (allKnownBoxesByBoxId.size === 0) {
		allKnownBoxesByBoxId = currBoxesMap
		allKnownBoxesArray = currBoxes

		csLog.info('compareBoxStates: initial snapshot', { count: allKnownBoxesArray.length })
		return null
	}

	let removedBoxes: Box[] = []

	// compare
	let oldBoxesArrayCopy = [...allKnownBoxesArray]

	let newBoxes: Box[] = []
	for (let i = 0; i < currBoxes.length; i++) {
		const box = currBoxes[i]
		const oldBox = allKnownBoxesByBoxId.get(box.id)

		if (oldBox) {
			// box is still there -> ok
			let oldBoxIndex = oldBoxesArrayCopy.findIndex(p => p.id === box.id)
			oldBoxesArrayCopy.splice(oldBoxIndex, 1)

		} else {
			//box is not found in old boxes -> new
			newBoxes.push(box)
		}
	}

	// if old box is not in new boxes -> it was deleted
	for (let i = 0; i < oldBoxesArrayCopy.length; i++) {
		const oldBox = oldBoxesArrayCopy[i]
		removedBoxes.push(oldBox)
	}
	
	const result = {
		addedBoxes: newBoxes,
		removedBoxes: removedBoxes,
		allBoxes: currBoxes,
		allBoxesMap: currBoxesMap,
	}
	csLog.info('compareBoxStates: diff computed', { added: newBoxes.length, removed: removedBoxes.length, total: currBoxes.length })
	return result
}


async function checkBoxesChanged() {
	csLog.info('checkBoxesChanged: called')
	const changeInfo = compareBoxStates()

	//first check
	if (!changeInfo) {
		csLog.debug('checkBoxesChanged: initial call, no changes yet')
		return
	}

	for (let i = 0; i < changeInfo.addedBoxes.length; i++) {
		const addedBox = changeInfo.addedBoxes[i]

		const message: SiteNewBoxMessage = {
			type: 'BOX_CREATED',
			boxId: addedBox.id,
			boxWrapId: addedBox.wrapId,
			createdAt: (new Date()).toISOString()
		}
		
		csLog.info('checkBoxesChanged: notifying service worker for new box', { boxId: addedBox.id, wrapId: addedBox.wrapId })
		await chrome.runtime.sendMessage(message)
	}

	// currently remobed boxes are not handled

	// update all known boxes

	if (changeInfo.removedBoxes.length === 0 && changeInfo.addedBoxes.length === 0) {
		// no new boxes and removed boxes -> no need to update
		csLog.debug('checkBoxesChanged: no changes detected')
		return
	}

	allKnownBoxesByBoxId = changeInfo.allBoxesMap
	allKnownBoxesArray = changeInfo.allBoxes
	csLog.debug('checkBoxesChanged: state updated', { total: allKnownBoxesArray.length })
}

//from edumaps
declare var anchor_scroll_done: boolean
declare function edu_anchor_scroll_to_box(boxIdWrapStr: string, aInt: number, tBool: boolean, rLink: null | HTMLAnchorElement): void
function _showBox(box: Box, tabId: number) {
	const l = createContentLogger('_showBox')
	l.info('start', { boxId: box.id, wrapId: box.wrapId, tabId })
	//create a tmp anchor el like this:
	// <a class="inline selfopener" href="#fotosammlung">xyz</a>

	// const anchorEl = document.createElement("a")
	// anchorEl.className = "inline selfopener"
	// anchorEl.href = `#${box.wrapId}`
	// anchorEl.innerText = box.title

	// const anchorElRect = anchorEl.getBoundingClientRect()
	// const scrollDiv = document.querySelector("#outer-wrapper") as HTMLDivElement

	// const scrollToX = box.left
	// const scrollToY = box.top

	// scrollDiv.scrollTo(scrollToX, scrollToY)

	//get box wrapper: id: box-id
	const boxWrapperEl = document.querySelector(`#${box.wrapId}`)
	if (!boxWrapperEl) {
		l.warn('wrapper not found', { wrapId: box.wrapId })
		return
	}

	boxWrapperEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })

	boxWrapperEl.classList.add("hasbadge", "markbox", "doblink")

	setTimeout(() => {
		boxWrapperEl.classList.remove("hasbadge", "markbox", "doblink")
	}, 2000)
	l.info('done')
}

function main() {
	csLog.info('main: start')

	// Automatically compute compare without overwriting baseline and persist a rendered result for the popup
	chrome.storage.local.get(['capturedBoxesState', 'initializeBaselineOnNextLoad'], (items) => {
		const prevMapObj = items['capturedBoxesState'] as Record<string, Box> | undefined
		const shouldInit = Boolean(items['initializeBaselineOnNextLoad'])
		csLog.debug('main: storage loaded', { hasBaseline: Boolean(prevMapObj), shouldInit })
		if (!prevMapObj) {
			if (shouldInit) {
				csLog.info('main: initializing baseline on next load flag present, capturing baseline')
				const current = getAllBoxes()
				const baselineObj: Record<string, Box> = {}
				for (let i = 0; i < current.length; i++) baselineObj[current[i].id] = current[i]
				const capturedAt = (new Date()).toISOString()
				chrome.storage.local.set({ capturedBoxesState: baselineObj, capturedBoxesStateAt: capturedAt, initializeBaselineOnNextLoad: false })
			}
			return
		}
		const current = getAllBoxes()
		const currentMap = boxesToMap(current)
		const prevIds = new Set(Object.keys(prevMapObj))
		const currentIds = new Set(Array.from(currentMap.keys()))
		const added: string[] = []
		const removed: string[] = []
		for (const id of currentIds) if (!prevIds.has(id)) added.push(id)
		for (const id of prevIds) if (!currentIds.has(id)) removed.push(id)
		const now = new Date()
		const entries: string[] = []
		for (const id of added) entries.push(`<div class=\"box-item\" data-box-id=\"${id}\"><div class=\"content\">Neue Box: ${id}</div><div class=\"time\">${now.toISOString()}</div></div>`)
		chrome.storage.local.set({ popupChangedListHtml: entries.join(''), capturedBoxesStateAt: now.toISOString() })
		if (added.length > 0) {
			const msg: NewBoxesFoundMessage = { type: 'NEW_BOXES_FOUND', count: added.length }
			csLog.info('main: notifying NEW_BOXES_FOUND', { count: added.length })
			chrome.runtime.sendMessage(msg)
		}
	})
	// const handler = setInterval(checkBoxesChanged, 5000)

	chrome.runtime.onMessage.addListener((message: BoxChangedListClickedMessage) => {
		csLog.debug('onMessage(BoxChangedListClickedMessage): received', message)

		if (message && message.action === 'showBox') {
			let boxId = message.boxId
			// known box data is somehow outdated, so we need to update it
			const { boxes, boxesMap } = getAllBoxesData()

			let knownBox = boxesMap.get(boxId)
			if (!knownBox) {
				csLog.warn('showBox: unknown box id', { boxId })
				return false // void?
			}
			
			_showBox(knownBox, message.tabId)
			return false // void?
		}
	})

	// Listen for popup actions: capture/compare
	chrome.runtime.onMessage.addListener((message: CaptureStateMessage | CompareStateMessage, _sender, sendResponse: (response?: any) => void) => {
		if (!message || !('action' in message)) {
			csLog.warn('onMessage: missing or invalid action')
			return false
		}

		if (message.action === 'CAPTURE_STATE') {
			csLog.info('onMessage: CAPTURE_STATE')
			const boxes = getAllBoxes()
			const mapObj: Record<string, Box> = {}
			for (let i = 0; i < boxes.length; i++) {
				const b = boxes[i]
				mapObj[b.id] = b
			}
			const capturedAt = (new Date()).toISOString()
			chrome.storage.local.set({ [STORAGE_CAPTURED_STATE_KEY]: mapObj, [STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, () => {
				csLog.info('CAPTURE_STATE: stored', { count: boxes.length })
				sendResponse({ ok: true, capturedCount: boxes.length } as CaptureStateResponse)
			})
			return true
		}

		if (message.action === 'COMPARE_STATE') {
			csLog.info('onMessage: COMPARE_STATE')
			chrome.storage.local.get(STORAGE_CAPTURED_STATE_KEY, (items) => {
				const prevMapObj = items[STORAGE_CAPTURED_STATE_KEY] as Record<string, Box> | undefined
				const current = getAllBoxes()
				const currentMap = boxesToMap(current)

				const added: string[] = []
				const removed: string[] = []

				if (!prevMapObj) {
					// no previous baseline: set baseline but report no changes
					// set new baseline to current
					csLog.info('COMPARE_STATE: no baseline found, creating one')
					const baselineObj: Record<string, Box> = {}
					for (let i = 0; i < current.length; i++) baselineObj[current[i].id] = current[i]
					const capturedAt = (new Date()).toISOString()
					chrome.storage.local.set({ [STORAGE_CAPTURED_STATE_KEY]: baselineObj, [STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, () => {
						sendResponse({ ok: true, addedBoxIds: [], removedBoxIds: [] } as CompareStateResponse)
					})
					return true
				}

				const prevIds = new Set(Object.keys(prevMapObj))
				const currentIds = new Set(Array.from(currentMap.keys()))

				for (const id of currentIds) {
					if (!prevIds.has(id)) added.push(id)
				}
				for (const id of prevIds) {
					if (!currentIds.has(id)) removed.push(id)
				}

				// set new baseline to current
				const baselineObj: Record<string, Box> = {}
				for (let i = 0; i < current.length; i++) baselineObj[current[i].id] = current[i]
				const capturedAt = (new Date()).toISOString()
				chrome.storage.local.set({ [STORAGE_CAPTURED_STATE_KEY]: baselineObj, [STORAGE_CAPTURED_STATE_AT_KEY]: capturedAt }, async () => {
					// notify service worker if there are new boxes
					if (added.length > 0) {
						const msg: NewBoxesFoundMessage = { type: 'NEW_BOXES_FOUND', count: added.length }
						csLog.info('COMPARE_STATE: notifying NEW_BOXES_FOUND', { count: added.length })
						await chrome.runtime.sendMessage(msg)
					}
					csLog.info('COMPARE_STATE: done', { added: added.length, removed: removed.length })
					sendResponse({ ok: true, addedBoxIds: added, removedBoxIds: removed } as CompareStateResponse)
				})
			})
			return true
		}

		return false
	})

}
main()

