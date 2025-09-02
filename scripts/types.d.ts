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