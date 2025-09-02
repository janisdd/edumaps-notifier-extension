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

function getAllBoxes(): Box[] {
	const allBoxeWraps = Array.from(document.querySelectorAll(`#main-content .box-wrap`)) as HTMLDivElement[]
	const allBoxes: Box[] = []

	for (let i = 0; i < allBoxeWraps.length; i++) {
		const boxWrapDiv = allBoxeWraps[i]
		const boxWrapId = boxWrapDiv.getAttribute("id")

		if (!boxWrapId) {
			console.warn("box wrapper without id found, skipping")
			continue
		}

		const boxDiv = boxWrapDiv.querySelector(".box-item") as HTMLDivElement

		const boxLabelEl = boxDiv.querySelector(".boxlabel") as HTMLElement
		const boxTitle = boxLabelEl.innerText

		const boxId = boxDiv.getAttribute("data-boxid")

		if (!boxId) {
			console.warn("box without id found, skipping")
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

	return allBoxes
}


function boxesToMap(boxes: Box[]): Map<string, Box> {
	const map = new Map<string, Box>()

	for (let i = 0; i < boxes.length; i++) {
		const box = boxes[i]
		map.set(box.id, box)
	}

	return map
}


function compareBoxStates(): ChangeInfo | null {

	const currBoxes = getAllBoxes()
	const currBoxesMap = boxesToMap(currBoxes)

	if (allKnownBoxesByBoxId.size === 0) {
		allKnownBoxesByBoxId = currBoxesMap
		allKnownBoxesArray = currBoxes

		console.info(`${allKnownBoxesArray.length} Initial boxes found`, allKnownBoxesArray);
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
	
	return {
		addedBoxes: newBoxes,
		removedBoxes: removedBoxes,
		allBoxes: currBoxes,
		allBoxesMap: currBoxesMap,
	}
}


async function checkBoxesChanged() {
	console.log("checkBoxesChanged called")
	const changeInfo = compareBoxStates()

	//first check
	if (!changeInfo) return

	for (let i = 0; i < changeInfo.addedBoxes.length; i++) {
		const addedBox = changeInfo.addedBoxes[i]

		const message: SiteNewBoxMessage = {
			type: 'BOX_CREATED',
			boxId: addedBox.id,
			boxWrapId: addedBox.wrapId,
			createdAt: (new Date()).toISOString()
		}
		
		await chrome.runtime.sendMessage(message)
	}

	// currently remobed boxes are not handled

	// update all known boxes

	if (changeInfo.removedBoxes.length === 0 && changeInfo.addedBoxes.length === 0) {
		// no new boxes and removed boxes -> no need to update
		return
	}

	allKnownBoxesByBoxId = changeInfo.allBoxesMap
	allKnownBoxesArray = changeInfo.allBoxes

}

//from edumaps
declare var anchor_scroll_done: boolean
declare function edu_anchor_scroll_to_box(boxIdWrapStr: string, aInt: number, tBool: boolean, rLink: null | HTMLAnchorElement): void
function _showBox(box: Box, tabId: number) {

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
		console.warn(`Could not find box wrapper with id #${box.wrapId}`)
		return
	}

	boxWrapperEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })

	boxWrapperEl.classList.add("hasbadge", "markbox", "doblink")

	setTimeout(() => {
		boxWrapperEl.classList.remove("hasbadge", "markbox", "doblink")
	}, 2000)
	
}

function main() {
	console.log(`main called`);
	
	const handler = setInterval(checkBoxesChanged, 5000)

	chrome.runtime.onMessage.addListener((message: BoxChangedListClickedMessage) => {
		console.log(message)

		if (message && message.action === 'showBox') {
			let boxId = message.boxId

			let knownBox = allKnownBoxesByBoxId.get(boxId)
			if (!knownBox) {
				console.warn(`Could not find box with id ${boxId}`)
				return false // void?
			}
			
			_showBox(knownBox, message.tabId)
			return false // void?
		}
	})

}
main()

