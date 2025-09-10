type ClickModifiers = {
	ctrl: boolean
	shift: boolean
	alt: boolean
	meta: boolean
	button: number
}

type AddBoxToChangedListMessage = {
	boxChanged: {
		boxId: string
		changed: string // date as ISO string
	}
}


type BoxChangedListClickedMessage = {
	action: 'showBox'
	boxId: string
	tabId: number
}


type SiteNewBoxMessage = {
	type: 'BOX_CREATED'
	boxId: string
	boxWrapId: string
	createdAt: string // date as ISO string
}

// Popup -> Content script
type CaptureStateMessage = {
	action: 'CAPTURE_STATE'
}

type CompareStateMessage = {
	action: 'COMPARE_STATE'
}

type CaptureStateResponse = {
	ok: true
	capturedCount: number
}

type CompareStateResponse = {
	ok: true
	addedBoxIds: string[]
	removedBoxIds: string[]
}

// Popup -> Content script: fetch current boxes for UI
type GetCurrentBoxesMessage = {
	action: 'GET_CURRENT_BOXES'
}

type GetCurrentBoxesResponse = {
	ok: true
	boxes: Array<{ id: string; title: string }>
}

// Popup -> Service worker
type SetAutoReloadMessage = {
	action: 'SET_AUTO_RELOAD'
	enabled: boolean
	minutes: number
}

type GetAutoReloadStateMessage = {
	action: 'GET_AUTO_RELOAD_STATE'
}

type GetAutoReloadStateResponse = {
	enabled: boolean
	minutes: number
}

// Content script -> Service worker: summary about newly added boxes after compare
type NewBoxesFoundMessage = {
	type: 'NEW_BOXES_FOUND'
	count: number
}

type AutoCompareMessage = {
	action: 'AUTO_COMPARE'
	currentMap: Record<string, Box>
}

type CompareWithBaselineMessage = {
	action: 'COMPARE_WITH_BASELINE'
	currentMap: Record<string, Box>
}